// Turning "what is under the cursor" into "how the object sits there".
//
// surfacePick.ts answers where the ray hit and which way the surface faces; this decides what
// that means. Marble ships no semantic labels, so the triangle normal is the only thing that
// separates a floor from a table top from a wall, and an object should land differently on
// each: stand on a floor, lie back against a wall, hang from a ceiling.
//
// There is no override and no fudge factor. Whatever surface the cursor is over is the surface
// the object goes on, sitting exactly on it. The ghost preview and the click that commits it
// both call `poseOnSurface`, so a placed object cannot drift from the preview it was judged by.
import * as THREE from "three";
import { orientTo, type PickSource, type SurfacePick } from "./surfacePick.ts";

export type SurfaceKind = "floor" | "wall" | "ceiling";
export type Pose = { position: THREE.Vector3; quaternion: THREE.Quaternion; kind: SurfaceKind };

const UP = new THREE.Vector3(0, 1, 0);
const COLLIDER_FLOOR_Y = 0.65;
// A splat normal is a screen-space finite difference over a fuzzy Gaussian field, so it is
// noisy by construction. Only call one a wall when it is unambiguously vertical.
const SPLAT_WALL_Y = 0.35;

export function surfaceKind(normal: THREE.Vector3, source: PickSource = "collider"): SurfaceKind {
  const limit = source === "splat" ? SPLAT_WALL_Y : COLLIDER_FLOOR_Y;
  if (normal.y > limit) return "floor";
  if (normal.y < -limit) return "ceiling";
  return "wall";
}

/**
 * `normal` already points back at the camera (surfacePick.ts flips it), so for a wall you are
 * facing it points into the room, and for a ceiling it points down.
 */
export function orientOnSurface(
  normal: THREE.Vector3,
  point: THREE.Vector3,
  camera: THREE.Camera,
  source: PickSource = "collider",
): THREE.Quaternion {
  const kind = surfaceKind(normal, source);
  // Floor / table top: stand on it, yawed to face the camera.
  if (kind === "floor") return orientTo(UP, point, camera);
  // Ceiling: +Y follows the downward normal, so the object hangs by its base.
  if (kind === "ceiling") return orientTo(normal, point, camera);
  // Wall: the object's back (-Z) goes into the wall and +Y stays world up, so it lies flat
  // against the wall instead of standing on its base and jutting out of it.
  const forward = normal.clone().normalize();
  const up = UP.clone().addScaledVector(forward, -UP.dot(forward));
  if (up.lengthSq() < 1e-8) return orientTo(normal, point, camera); // normal is (anti)parallel to up
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, forward);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
}

/** The complete pose for a hit. `yaw` is the user's own turn, about the object's own up axis. */
export function poseOnSurface(hit: SurfacePick, camera: THREE.Camera, yaw = 0): Pose {
  const quaternion = orientOnSurface(hit.normal, hit.point, camera, hit.source);
  quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
  return { position: hit.point.clone(), quaternion, kind: surfaceKind(hit.normal, hit.source) };
}
