import { Box3, Euler, Matrix4, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3, type Object3D } from "three";
import { orientTo, pickSurface, type PickSource } from "./surfacePick.ts";

export type Point = { x: number; y: number };
export type Stroke = { points: Point[]; width: number };
export type DrawingBounds = { left: number; top: number; right: number; bottom: number };
export type DrawingAnchor = {
  position: number[]; rotation: number[]; source: PickSource;
  bounds: DrawingBounds; cameraWorld: number[]; projection: number[];
  // The ink itself, in the same 0..1 top-left space the canvas records. Klein re-poses the
  // object into a centred three-quarter product view, so the cutout remembers nothing about
  // how it was drawn — these strokes are the only record of the drawn viewpoint, and what
  // sketchOrientation matches the generated mesh's silhouette against.
  strokes: Stroke[];
};
/** The size the sketch implies, plus the anchor pose it was measured against. */
export type DrawingFit = { position: number[]; rotation: number[]; targetSize: number; scale: number };

export function drawingBounds(strokes: { points: Point[] }[]): DrawingBounds | null {
  const points = strokes.flatMap((s) => s.points);
  if (!points.length) return null;
  const bounds = { left: 1, top: 1, right: 0, bottom: 0 };
  for (const p of points) {
    bounds.left = Math.min(bounds.left, p.x); bounds.right = Math.max(bounds.right, p.x);
    bounds.top = Math.min(bounds.top, p.y); bounds.bottom = Math.max(bounds.bottom, p.y);
  }
  return bounds.right - bounds.left >= .008 && bounds.bottom - bounds.top >= .008 ? bounds : null;
}

/** Fraction of the drawing's height treated as "the base" when locating the contact point. */
const BASE_BAND = .12;

/**
 * Where the object actually touches the room. Averaging the ink across the bottom band beats
 * the bounding box's bottom-centre: one sloppy diagonal tail widens the box and drags that
 * corner sideways, while the mass of ink resting on the table does not move.
 */
export function contactPoint(strokes: Stroke[], bounds: DrawingBounds): Point {
  const cutoff = bounds.bottom - BASE_BAND * (bounds.bottom - bounds.top);
  const base = strokes.flatMap((s) => s.points).filter((p) => p.y >= cutoff);
  if (!base.length) return { x: (bounds.left + bounds.right) / 2, y: bounds.bottom };
  return { x: base.reduce((sum, p) => sum + p.x, 0) / base.length, y: bounds.bottom };
}

/** The anchor rides through localStorage as JSON, so keep the ink to a sane size. */
const MAX_POINTS = 600;
export function decimate(strokes: Stroke[], max = MAX_POINTS): Stroke[] {
  const total = strokes.reduce((n, s) => n + s.points.length, 0);
  if (total <= max) return strokes;
  const step = Math.ceil(total / max);
  return strokes.map((s) => ({
    ...s,
    // Endpoints always survive: they are what closes an outline.
    points: s.points.filter((_, i) => i % step === 0 || i === s.points.length - 1),
  }));
}

// The base of the drawing is the object's contact point. Never invent a depth:
// only the room collider or a real splat hit can establish this anchor.
export function anchorDrawing(strokes: Stroke[], camera: PerspectiveCamera, scene: Object3D): DrawingAnchor {
  const bounds = drawingBounds(strokes);
  if (!bounds) throw new Error("Draw an outline first.");
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const base = contactPoint(strokes, bounds);
  const pointer = new Vector2(2 * base.x - 1, 1 - 2 * base.y);
  const hit = pickSurface(new Raycaster(), camera, pointer, scene, { collider: true, splat: true, plane: false });
  if (!hit || hit.point.distanceTo(camera.position) > 50) throw new Error("No nearby room surface at the base of your drawing. Draw with the bottom touching a table, floor or wall.");
  const normal = hit.source === "splat" || hit.normal.y > .65 ? new Vector3(0, 1, 0) : hit.normal;
  const euler = new Euler().setFromQuaternion(orientTo(normal, hit.point, camera));
  return { bounds, position: hit.point.toArray(), rotation: [euler.x, euler.y, euler.z], source: hit.source,
    cameraWorld: camera.matrixWorld.toArray(), projection: camera.projectionMatrix.toArray(),
    strokes: decimate(strokes) };
}

export function cameraForAnchor(anchor: DrawingAnchor) {
  const camera = new PerspectiveCamera();
  camera.matrixWorld.fromArray(anchor.cameraWorld);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  camera.projectionMatrix.fromArray(anchor.projection);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return camera;
}

// Match the generated model's projected footprint, accounting for aspect ratio, camera
// tilt and model depth. The original contact point stays fixed even if the user walks away.
export function fitDrawing(model: Object3D, anchor: DrawingAnchor): DrawingFit {
  const box = new Box3().setFromObject(model);
  if (box.isEmpty()) throw new Error("The generated model has no visible geometry.");
  const size = box.getSize(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (largest < 1e-8) throw new Error("The generated model is too small to place.");
  const centre = box.getCenter(new Vector3());
  const offset = new Vector3(-centre.x, -box.min.y, -centre.z);
  const rotation = new Quaternion().setFromEuler(new Euler(...anchor.rotation as [number, number, number]));
  const position = new Vector3().fromArray(anchor.position);
  const camera = cameraForAnchor(anchor);
  const corners: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    corners.push(new Vector3(x, y, z).add(offset).divideScalar(largest).applyQuaternion(rotation));
  }
  const wantedWidth = 2 * (anchor.bounds.right - anchor.bounds.left);
  const wantedHeight = 2 * (anchor.bounds.bottom - anchor.bounds.top);
  const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  let low = .001, high = 10;
  for (let i = 0; i < 24; i++) {
    const scale = (low + high) / 2;
    const projected = corners.map((p) => p.clone().multiplyScalar(scale).add(position));
    const behind = projected.some((p) => p.clone().applyMatrix4(camera.matrixWorldInverse).z >= -.02);
    projected.forEach((p) => p.applyMatrix4(viewProjection));
    const width = Math.max(...projected.map((p) => p.x)) - Math.min(...projected.map((p) => p.x));
    const height = Math.max(...projected.map((p) => p.y)) - Math.min(...projected.map((p) => p.y));
    if (behind || Math.max(width / wantedWidth, height / wantedHeight) > 1) high = scale;
    else low = scale;
  }
  return { position: [...anchor.position], rotation: [...anchor.rotation], targetSize: low, scale: 1 };
}
