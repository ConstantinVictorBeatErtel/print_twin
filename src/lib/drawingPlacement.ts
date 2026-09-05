import { Box3, Euler, Matrix4, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3, type Object3D } from "three";
import { pickSurface, type PickSource } from "./surfacePick.ts";
import { orientOnSurface } from "./placementPose.ts";

export type Point = { x: number; y: number };
export type DrawingBounds = { left: number; top: number; right: number; bottom: number };
export type DrawingAnchor = {
  position: number[]; rotation: number[]; source: PickSource;
  bounds: DrawingBounds; cameraWorld: number[]; projection: number[];
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

// The bottom centre of the drawing is the object's contact point. Never invent a depth:
// only the room collider or a real splat hit can establish this anchor.
export function anchorDrawing(bounds: DrawingBounds, camera: PerspectiveCamera, scene: Object3D): DrawingAnchor {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const pointer = new Vector2(bounds.left + bounds.right - 1, 1 - 2 * bounds.bottom);
  const hit = pickSurface(new Raycaster(), camera, pointer, scene, { collider: true, splat: true, plane: false });
  if (!hit || hit.point.distanceTo(camera.position) > 50) throw new Error("No nearby room surface at the base of your drawing. Draw with the bottom touching a table, floor or wall.");
  // Same rule as the placement ghost (placementPose.ts), so an anchored sketch and a
  // hand-placed object never disagree about what counts as a floor.
  const euler = new Euler().setFromQuaternion(orientOnSurface(hit.normal, hit.point, camera, hit.source));
  return { bounds, position: hit.point.toArray(), rotation: [euler.x, euler.y, euler.z], source: hit.source,
    cameraWorld: camera.matrixWorld.toArray(), projection: camera.projectionMatrix.toArray() };
}

export function cameraForAnchor(anchor: DrawingAnchor) {
  const camera = new PerspectiveCamera();
  camera.matrixWorld.fromArray(anchor.cameraWorld);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  camera.projectionMatrix.fromArray(anchor.projection);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return camera;
}

/**
 * The four world-space corners of the rectangle the drawing occupied, at the depth its base
 * was anchored to. Returned bottom-left, bottom-right, top-right, top-left — enough to hang
 * the sketch in the room exactly where it was drawn while the mesh is still being built.
 */
export function drawingQuad(anchor: DrawingAnchor): Vector3[] {
  const camera = cameraForAnchor(anchor);
  const depth = new Vector3().fromArray(anchor.position).project(camera).z;
  const { left, top, right, bottom } = anchor.bounds;
  return ([[left, bottom], [right, bottom], [right, top], [left, top]] as const)
    .map(([u, v]) => new Vector3(2 * u - 1, 1 - 2 * v, depth).unproject(camera));
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
