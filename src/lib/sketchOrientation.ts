// "Which way was this drawn facing?"
//
// The sketch pipeline gives us no pose to work from. Klein is asked for "a clear three-quarter
// product view, complete and centered" (convex/sketch.ts), so the cutout is a re-framed product
// shot that remembers nothing about the drawn viewpoint, and Tripo returns geometry with no
// canonical-orientation metadata. The one artefact still standing in the user's viewpoint is
// their own ink.
//
// So we solve it geometrically instead of asking a model: render the finished mesh from the
// frozen drawing camera at a sweep of yaws about the surface normal, and keep the yaw whose
// silhouette best matches the strokes. Everything here is pure — the renderer is injected — so
// the scoring can be tested against synthetic silhouettes with no GL context.
import { Euler, Quaternion, Vector3 } from "three";
import type { DrawingAnchor, DrawingBounds, Stroke } from "./drawingPlacement.ts";

export type Mask = { data: Uint8Array; width: number; height: number };
export type Box = { minX: number; minY: number; maxX: number; maxY: number };
export type YawMatch = { yaw: number; score: number; confident: boolean; targetSize: number };
/** Renders the mesh at each yaw, in the ink's screen frame. One call so it can batch. */
export type RenderSilhouettes = (yaws: number[], width: number, height: number) => Mask[];

const STEPS = 36;        // 10 degrees; refined below
const RESOLUTION = 192;  // long edge, in pixels
// Below this relative gap between the best and the typical yaw, the object is rotationally
// ambiguous (a vase, a ball, a sphere-ish blob) and any winner is noise. Keep facing the camera.
const MIN_CONFIDENCE = .15;

/** The capture's aspect, recovered from the stored perspective matrix (e[5]/e[0] = f/(f/a)). */
export function anchorAspect(anchor: DrawingAnchor): number {
  const sx = anchor.projection[0], sy = anchor.projection[5];
  return sx > 1e-9 && sy > 1e-9 ? sy / sx : 16 / 9;
}

export function inkFrame(anchor: DrawingAnchor, resolution = RESOLUTION) {
  const aspect = anchorAspect(anchor);
  return aspect >= 1
    ? { width: resolution, height: Math.max(1, Math.round(resolution / aspect)) }
    : { width: Math.max(1, Math.round(resolution * aspect)), height: resolution };
}

/**
 * Strokes to a binary mask, without a canvas — a distance-to-segment test per pixel in each
 * segment's padded bbox. At this resolution that is a few thousand tests and it keeps the
 * whole scorer runnable under `node --test`.
 */
export function rasterizeInk(strokes: Stroke[], width: number, height: number): Mask {
  const data = new Uint8Array(width * height);
  const scale = Math.max(width, height);
  for (const stroke of strokes) {
    const radius = Math.max(.75, stroke.width * scale / 2);
    const points = stroke.points;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[i + 1] ?? points[i];
      const ax = a.x * width, ay = a.y * height, bx = b.x * width, by = b.y * height;
      const loX = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1));
      const hiX = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + radius + 1));
      const loY = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1));
      const hiY = Math.min(height - 1, Math.ceil(Math.max(ay, by) + radius + 1));
      const dx = bx - ax, dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      for (let y = loY; y <= hiY; y++) for (let x = loX; x <= hiX; x++) {
        const px = x + .5 - ax, py = y + .5 - ay;
        const t = lenSq > 1e-9 ? Math.min(1, Math.max(0, (px * dx + py * dy) / lenSq)) : 0;
        const ox = px - t * dx, oy = py - t * dy;
        if (ox * ox + oy * oy <= radius * radius) data[y * width + x] = 1;
      }
    }
  }
  return { data, width, height };
}

export function maskBox({ data, width, height }: Mask): Box | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!data[y * width + x]) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** Set pixels touching an unset pixel or the border — the outline a user actually draws. */
export function maskEdge({ data, width, height }: Mask): Mask {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!data[i]) continue;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1
      || !data[i - 1] || !data[i + 1] || !data[i - width] || !data[i + width]) out[i] = 1;
  }
  return { data: out, width, height };
}

const DIAG = Math.SQRT2;
/** Two-pass chamfer distance to the nearest set pixel, in pixels. */
export function distanceTransform({ data, width, height }: Mask): Float32Array {
  const far = width + height;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = data[i] ? 0 : far;
  const relax = (i: number, j: number, w: number) => { const v = d[j] + w; if (v < d[i]) d[i] = v; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (y > 0) {
      relax(i, i - width, 1);
      if (x > 0) relax(i, i - width - 1, DIAG);
      if (x < width - 1) relax(i, i - width + 1, DIAG);
    }
    if (x > 0) relax(i, i - 1, 1);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (y < height - 1) {
      relax(i, i + width, 1);
      if (x < width - 1) relax(i, i + width + 1, DIAG);
      if (x > 0) relax(i, i + width - 1, DIAG);
    }
    if (x < width - 1) relax(i, i + 1, 1);
  }
  return d;
}

/**
 * Move `mask` so its bbox sits on `target`'s, at a *uniform* scale. Uniform matters: the
 * silhouette's aspect ratio is one of the strongest yaw cues (a chair face-on is not a chair
 * edge-on), so stretching it to fill the box would erase the signal we are measuring.
 */
export function alignToBox(mask: Mask, from: Box, target: Box): Mask {
  const { data, width, height } = mask;
  const fw = from.maxX - from.minX + 1, fh = from.maxY - from.minY + 1;
  const tw = target.maxX - target.minX + 1, th = target.maxY - target.minY + 1;
  const scale = Math.sqrt((tw / fw) * (th / fh));
  const fcx = (from.minX + from.maxX) / 2, fcy = (from.minY + from.maxY) / 2;
  const tcx = (target.minX + target.maxX) / 2, tcy = (target.minY + target.maxY) / 2;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.round((x + .5 - tcx) / scale + fcx - .5);
    const sy = Math.round((y + .5 - tcy) / scale + fcy - .5);
    if (sx >= 0 && sy >= 0 && sx < width && sy < height && data[sy * width + sx]) out[y * width + x] = 1;
  }
  return { data: out, width, height };
}

/**
 * Symmetric chamfer, normalised by the ink's diagonal so it is scale-free. Both directions are
 * needed: ink->silhouette alone lets a tiny shape hide inside a big scribble and score zero,
 * silhouette->ink alone rewards a shape that covers only part of the drawing.
 */
export function chamfer(ink: Mask, inkDistance: Float32Array, silhouette: Mask): number {
  const edge = maskEdge(silhouette);
  const silDistance = distanceTransform(edge);
  let forward = 0, forwardCount = 0, backward = 0, backwardCount = 0;
  for (let i = 0; i < ink.data.length; i++) {
    if (edge.data[i]) { forward += inkDistance[i]; forwardCount++; }
    if (ink.data[i]) { backward += silDistance[i]; backwardCount++; }
  }
  if (!forwardCount || !backwardCount) return Infinity;
  const box = maskBox(ink)!;
  const diagonal = Math.hypot(box.maxX - box.minX + 1, box.maxY - box.minY + 1) || 1;
  return (forward / forwardCount + backward / backwardCount) / diagonal;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Ink bbox in pixels, from the anchor's normalised bounds. */
export function boundsToBox(bounds: DrawingBounds, width: number, height: number): Box {
  return {
    minX: Math.floor(bounds.left * width), maxX: Math.min(width - 1, Math.ceil(bounds.right * width)),
    minY: Math.floor(bounds.top * height), maxY: Math.min(height - 1, Math.ceil(bounds.bottom * height)),
  };
}

/**
 * The yaw, about the anchor's surface normal, whose silhouette best matches the ink — plus the
 * size that yaw implies. Returns `confident: false` when no yaw stands out, which the caller
 * should read as "leave it facing the camera".
 */
export function matchSketchYaw(
  anchor: DrawingAnchor,
  renderSilhouettes: RenderSilhouettes,
  { steps = STEPS, resolution = RESOLUTION, baseSize = 1 }: { steps?: number; resolution?: number; baseSize?: number } = {},
): YawMatch | null {
  if (!anchor.strokes?.length) return null;
  const { width, height } = inkFrame(anchor, resolution);
  const ink = rasterizeInk(anchor.strokes, width, height);
  const inkBox = maskBox(ink);
  if (!inkBox) return null;
  const inkDistance = distanceTransform(ink);

  const score = (yaws: number[]) => {
    const rendered = renderSilhouettes(yaws, width, height);
    return yaws.map((yaw, i) => {
      const silhouette = rendered[i];
      const box = silhouette && maskBox(silhouette);
      if (!box) return { yaw, score: Infinity, box: null };
      return { yaw, score: chamfer(ink, inkDistance, alignToBox(silhouette, box, inkBox)), box };
    });
  };

  const coarse = score(Array.from({ length: steps }, (_, i) => i * 2 * Math.PI / steps));
  const usable = coarse.filter((c) => Number.isFinite(c.score));
  if (usable.length < 3) return null;
  const best = usable.reduce((a, b) => (b.score < a.score ? b : a));

  // Refine around the coarse winner, then judge confidence on the *coarse* sweep — a local
  // refinement always improves the score and would otherwise fake certainty.
  const span = Math.PI / steps;
  const fine = score([-span, -span / 2, span / 2, span].map((d) => best.yaw + d));
  const winner = [best, ...fine.filter((f) => Number.isFinite(f.score))].reduce((a, b) => (b.score < a.score ? b : a));

  const typical = median(usable.map((c) => c.score));
  const confident = typical > 0 && (typical - best.score) / typical >= MIN_CONFIDENCE;

  // The winning silhouette also sizes the object better than fitDrawing's 8-corner AABB search,
  // which overestimates anything that is not box-shaped.
  let targetSize = baseSize;
  if (winner.box) {
    const inkW = inkBox.maxX - inkBox.minX + 1, inkH = inkBox.maxY - inkBox.minY + 1;
    const silW = winner.box.maxX - winner.box.minX + 1, silH = winner.box.maxY - winner.box.minY + 1;
    const ratio = Math.sqrt((inkW / silW) * (inkH / silH));
    if (Number.isFinite(ratio) && ratio > 0) targetSize = baseSize * Math.min(4, Math.max(.25, ratio));
  }
  return { yaw: winner.yaw, score: winner.score, confident, targetSize };
}

/**
 * Anchor rotation with a yaw about the object's *own* +Y — which, after orientTo, is the
 * surface normal. Post-multiplying is what PlacementGhost does; pre-multiplying would spin the
 * object about world up and tilt anything standing on a sloped surface.
 */
export function composeYaw(rotation: number[], yaw: number): number[] {
  const q = new Quaternion().setFromEuler(new Euler(...rotation as [number, number, number]));
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
  const euler = new Euler().setFromQuaternion(q, "XYZ");
  return [euler.x, euler.y, euler.z];
}
