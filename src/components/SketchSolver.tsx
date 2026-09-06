// The GL half of "which way was this drawn facing?" — see src/lib/sketchOrientation.ts for the
// matching itself, which is pure and lives outside this file.
//
// Mounted inside <Canvas> for the same reason DrawingBridge is: it needs the app's live
// WebGLRenderer. Spinning up a second context to do this would burn one of the browser's
// handful of them and lose the shared GPU state.
//
// Two consumers, one piece of machinery. `solveYaw` renders flat silhouettes for the chamfer
// sweep; `renderViews` renders shaded, numbered views for the vision model. Both go through
// `renderAtlas`, which draws every yaw into one tiled render target and reads it back in a
// single readRenderTargetPixels — thirty-six separate readbacks would each stall the pipeline
// and visibly hitch the walk loop; one does not.
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { cameraForAnchor, drawingBounds, type DrawingAnchor } from "../lib/drawingPlacement";
import { inkFrame, matchSketchYaw, viewYaws, type Mask, type YawMatch } from "../lib/sketchOrientation";
import { fitToTarget } from "../lib/fit";

export type ContactSheet = { dataUrl: string; yaws: number[] };
export type SketchSolverApi = {
  /** Chamfer-match the ink against silhouettes of the mesh. `window` narrows it to one sector. */
  solveYaw: (model: THREE.Object3D, anchor: DrawingAnchor, baseSize: number,
    window?: { center: number; span: number }) => YawMatch | null;
  /** A numbered contact sheet of the mesh at `views` yaws, seen from where the sketch was drawn. */
  renderViews: (model: THREE.Object3D, anchor: DrawingAnchor, baseSize: number, views: number) => ContactSheet | null;
  /** The ink alone on white, cropped to what was drawn. */
  renderInk: (anchor: DrawingAnchor) => string | null;
};

// Every object the sheet shows has to read against the background, so it can be neither white
// nor black. A neutral slate keeps a pale ceramic and a dark chair equally legible.
const SHEET_BACKGROUND = 0x9aa0a6;
const SHEET_LONG_EDGE = 2048;
// A near-top-down drawing renders to views that are genuinely hard to tell apart. Clamping the
// elevation changes only what the model is shown, never what a yaw means.
const MIN_ELEVATION = 5 * Math.PI / 180, MAX_ELEVATION = 45 * Math.PI / 180;

export function SketchSolver({ solveRef }: { solveRef: React.MutableRefObject<SketchSolverApi | null> }) {
  const { gl } = useThree();

  useEffect(() => {
    // A failed orientation guess must never cost the user their object: every caller treats
    // null as "fall back to the pose the anchor already gave us".
    const guard = <T,>(run: () => T | null): T | null => { try { return run(); } catch { return null; } };
    solveRef.current = {
      solveYaw: (model, anchor, baseSize, window) => guard(() => solve(gl, model, anchor, baseSize, window)),
      renderViews: (model, anchor, baseSize, views) => guard(() => contactSheet(gl, model, anchor, baseSize, views)),
      renderInk: (anchor) => guard(() => inkImage(anchor)),
    };
    return () => { solveRef.current = null; };
  }, [gl, solveRef]);

  return null;
}

/** Model + anchor posed exactly as Asset and PlacementGhost pose it, so what we render is what the user gets. */
function poseModel(model: THREE.Object3D, anchor: DrawingAnchor, baseSize: number, material?: THREE.Material) {
  const clone = model.clone(true);
  if (material) {
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = material; // geometry is shared with the original; its materials are untouched
    });
  }
  const fit = fitToTarget(model, 1);
  clone.position.copy(fit.offset);
  const group = new THREE.Group();
  group.add(clone);
  group.position.fromArray(anchor.position);
  group.scale.setScalar(fit.scale * baseSize);
  const anchorQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...anchor.rotation as [number, number, number]));
  return { group, anchorQuat };
}

type Atlas = { pixels: Uint8Array; atlasWidth: number; columns: number; rows: number };

/**
 * Draw `yaws` into one tiled target and read it back once.
 *
 * Every piece of renderer state this borrows has to go back exactly as it was. The viewport
 * especially: WebGLRenderer.render() does not reset it and R3F only sets it on resize, so
 * leaving it on the last tile makes the whole app render into a small corner and the rest of
 * the canvas stay black until the window is resized.
 */
function renderAtlas(
  gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  group: THREE.Group, anchorQuat: THREE.Quaternion,
  yaws: number[], width: number, height: number, background: number,
): Atlas | null {
  const columns = Math.max(1, Math.min(yaws.length, Math.floor(gl.capabilities.maxTextureSize / width)));
  const rows = Math.ceil(yaws.length / columns);
  if (rows * height > gl.capabilities.maxTextureSize) return null;
  const atlasWidth = columns * width, atlasHeight = rows * height;
  const target = new THREE.WebGLRenderTarget(atlasWidth, atlasHeight);

  const previousClear = gl.getClearColor(new THREE.Color());
  const previousAlpha = gl.getClearAlpha();
  const previousViewport = gl.getViewport(new THREE.Vector4());
  const previousScissor = gl.getScissor(new THREE.Vector4());
  const previousScissorTest = gl.getScissorTest();
  const spin = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  gl.setClearColor(background, 1);
  gl.setRenderTarget(target);
  // The scissor confines each tile's autoClear to its own cell, so one target holds them all.
  gl.setScissorTest(true);
  try {
    yaws.forEach((yaw, i) => {
      const column = i % columns, row = Math.floor(i / columns);
      // readRenderTargetPixels reads bottom-up, so lay the grid out bottom-up too.
      const x = column * width, y = (rows - 1 - row) * height;
      gl.setViewport(x, y, width, height);
      gl.setScissor(x, y, width, height);
      group.quaternion.copy(anchorQuat).multiply(spin.setFromAxisAngle(axis, yaw));
      group.updateMatrixWorld(true);
      gl.render(scene, camera);
    });
    const pixels = new Uint8Array(atlasWidth * atlasHeight * 4);
    gl.readRenderTargetPixels(target, 0, 0, atlasWidth, atlasHeight, pixels);
    return { pixels, atlasWidth, columns, rows };
  } finally {
    gl.setRenderTarget(null);
    gl.setViewport(previousViewport);
    gl.setScissor(previousScissor);
    gl.setScissorTest(previousScissorTest);
    gl.setClearColor(previousClear, previousAlpha);
    target.dispose();
  }
}

function solve(
  gl: THREE.WebGLRenderer, model: THREE.Object3D, anchor: DrawingAnchor, baseSize: number,
  window?: { center: number; span: number },
) {
  const camera = cameraForAnchor(anchor);
  // Flat white on black: we want a silhouette, so lighting, colour and texture are noise.
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const { group, anchorQuat } = poseModel(model, anchor, baseSize, material);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(group);

  try {
    return matchSketchYaw(anchor, (yaws, width, height) => {
      const atlas = renderAtlas(gl, scene, camera, group, anchorQuat, yaws, width, height, 0x000000);
      if (!atlas) return [];
      return yaws.map((_, i) => tile(atlas, i, width, height));
    }, { baseSize, window });
  } finally {
    material.dispose();
  }
}

/**
 * The mesh at `views` evenly spaced yaws, shaded and numbered, as one PNG.
 *
 * The camera keeps the anchor camera's azimuth toward the object, so "view k" means "turned by
 * yaw k, seen from where you were standing" — the same convention composeYaw uses, which is
 * what makes the model's answer directly applicable. Only the distance changes, to frame the
 * object rather than show it as a speck across the room.
 */
function contactSheet(
  gl: THREE.WebGLRenderer, model: THREE.Object3D, anchor: DrawingAnchor, baseSize: number, views: number,
): ContactSheet | null {
  const { group, anchorQuat } = poseModel(model, anchor, baseSize);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SHEET_BACKGROUND);
  scene.add(group);
  // Matches the room's own lighting, so the sheet looks like the object the user will see.
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(3, 5, 2);
  scene.add(key);

  group.quaternion.copy(anchorQuat);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return null;
  const centre = box.getCenter(new THREE.Vector3());

  // A radius that holds for every yaw: the object turns about the vertical axis through its
  // anchor, so take the furthest horizontal reach from that axis and combine it with the half
  // height. Sizing off one yaw's bounding box would let a long object clip when it turns.
  let horizontal = 0;
  for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {
    horizontal = Math.max(horizontal, Math.hypot(x - group.position.x, z - group.position.z));
  }
  const radius = Math.max(1e-4, Math.hypot(horizontal, (box.max.y - box.min.y) / 2));

  // fov is baked into the stored projection: element 5 is 1/tan(fov/2).
  const fov = 2 * Math.atan(1 / (anchor.projection[5] || 1));
  const anchorCamera = cameraForAnchor(anchor);
  const eye = new THREE.Vector3().setFromMatrixPosition(anchorCamera.matrixWorld);
  const direction = eye.clone().sub(centre);
  if (direction.lengthSq() < 1e-8) direction.set(0, 0.5, 1);
  const spherical = new THREE.Spherical().setFromVector3(direction);
  // Spherical phi is measured from +Y, so clamping elevation means clamping phi from the equator.
  spherical.phi = Math.min(Math.PI / 2 - MIN_ELEVATION, Math.max(Math.PI / 2 - MAX_ELEVATION, spherical.phi));
  spherical.radius = radius / Math.sin(fov / 2) * 1.15;
  const camera = new THREE.PerspectiveCamera(fov * 180 / Math.PI, 1, Math.max(0.01, spherical.radius - radius * 4), spherical.radius + radius * 4);
  camera.position.copy(centre).add(new THREE.Vector3().setFromSpherical(spherical));
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);

  const columns = views <= 4 ? views : Math.ceil(views / 2);
  const rows = Math.ceil(views / columns);
  const tileSize = Math.max(64, Math.floor(SHEET_LONG_EDGE / Math.max(columns, rows)));
  const yaws = viewYaws(views);
  const atlas = renderAtlas(gl, scene, camera, group, anchorQuat, yaws, tileSize, tileSize, SHEET_BACKGROUND);
  if (!atlas) return null;

  return { dataUrl: label(atlas, views, tileSize), yaws };
}

/** Blit the atlas into a 2D canvas (flipping the GL readback) and number each tile. */
function label(atlas: Atlas, views: number, size: number): string {
  const { columns, rows } = atlas;
  const canvas = document.createElement("canvas");
  canvas.width = columns * size;
  canvas.height = rows * size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const source = (canvas.height - 1 - y) * atlas.atlasWidth * 4;
    const destination = y * canvas.width * 4;
    image.data.set(atlas.pixels.subarray(source, source + canvas.width * 4), destination);
  }
  ctx.putImageData(image, 0, 0);

  const font = Math.round(size * 0.16);
  ctx.font = `bold ${font}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.lineWidth = Math.max(3, font * 0.14);
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#fff";
  for (let i = 0; i < views; i++) {
    const x = (i % columns) * size, y = Math.floor(i / columns) * size;
    ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    // Outlined so the number survives whatever colour the object happens to be behind it.
    ctx.strokeText(String(i + 1), x + font * 0.4, y + font * 0.3);
    ctx.fillText(String(i + 1), x + font * 0.4, y + font * 0.3);
  }
  return canvas.toDataURL("image/png");
}

/**
 * The ink alone on white, cropped to the drawing with a margin. Cropping matters: the contact
 * sheet shows the object filling its tile, so the sketch should too — otherwise the model is
 * comparing a full-frame scribble against eight close-ups.
 */
function inkImage(anchor: DrawingAnchor): string | null {
  const bounds = drawingBounds(anchor.strokes ?? []);
  if (!bounds) return null;
  const frame = inkFrame(anchor, SHEET_LONG_EDGE / 2);
  const canvas = document.createElement("canvas");
  const margin = 0.08;
  const left = Math.max(0, bounds.left - margin), top = Math.max(0, bounds.top - margin);
  const right = Math.min(1, bounds.right + margin), bottom = Math.min(1, bounds.bottom + margin);
  canvas.width = Math.max(16, Math.round((right - left) * frame.width));
  canvas.height = Math.max(16, Math.round((bottom - top) * frame.height));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(-left * frame.width, -top * frame.height);

  // Same maths as DrawingLayer.paintStrokes: widths are a fraction of the frame's width.
  ctx.strokeStyle = ctx.fillStyle = "#111";
  ctx.lineCap = ctx.lineJoin = "round";
  for (const stroke of anchor.strokes) {
    ctx.lineWidth = Math.max(2, stroke.width * frame.width);
    ctx.beginPath();
    const first = stroke.points[0];
    if (!first) continue;
    ctx.moveTo(first.x * frame.width, first.y * frame.height);
    for (const p of stroke.points) ctx.lineTo(p.x * frame.width, p.y * frame.height);
    if (stroke.points.length === 1) { ctx.arc(first.x * frame.width, first.y * frame.height, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
    else ctx.stroke();
  }
  return canvas.toDataURL("image/png");
}

/** One cell of the atlas, thresholded and flipped back to the ink's top-left origin. */
function tile(atlas: Atlas, index: number, width: number, height: number): Mask {
  const { pixels, atlasWidth, columns, rows } = atlas;
  const column = index % columns, row = Math.floor(index / columns);
  const originX = column * width, originY = (rows - 1 - row) * height;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const source = (originY + height - 1 - y) * atlasWidth + originX;
    for (let x = 0; x < width; x++) {
      if (pixels[(source + x) * 4] > 127) data[y * width + x] = 1;
    }
  }
  return { data, width, height };
}
