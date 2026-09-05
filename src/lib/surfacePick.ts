// "What is under the mouse?" for a World Labs room.
//
// Marble gives no semantic labelling — `semantics_metadata` only carries metric_scale_factor
// and ground_plane_offset. So surface understanding comes from geometry: we raycast the room
// and read the *surface normal* at the hit, which is what separates a floor from a table top
// from a wall.
//
// Three targets, in falling order of trustworthiness:
//   1. the Marble collider GLB (invisible, tagged userData.collider in SplatWorld.tsx)
//   2. the Gaussian splat itself, via Spark's SplatMesh.raycast (approximate, no face normal)
//   3. a y=0 ground plane, so placement still works before a world is loaded
import * as THREE from "three";

export type PickSource = "collider" | "splat" | "plane";
export type SurfacePick = { point: THREE.Vector3; normal: THREE.Vector3; source: PickSource };

type SplatLike = THREE.Object3D & {
  raycast: (r: THREE.Raycaster, out: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[]) => void;
};

const UP = new THREE.Vector3(0, 1, 0);
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const normalMatrix = new THREE.Matrix3();

/** Collect raycast targets. Cheap enough to redo per pick — the scene holds a handful of nodes. */
function targets(scene: THREE.Object3D) {
  const colliders: THREE.Object3D[] = [];
  let splat: SplatLike | null = null;
  scene.traverse((o) => {
    if (o.userData.collider) colliders.push(o);
    else if (o.userData.splat) splat = o as SplatLike;
  });
  return { colliders, splat: splat as SplatLike | null };
}

/** Nearest point along the current ray, ignoring normals. Used for the splat normal estimate. */
function hitPoint(
  raycaster: THREE.Raycaster,
  colliders: THREE.Object3D[],
  splat: SplatLike | null,
): THREE.Vector3 | null {
  const hit = raycaster.intersectObjects(colliders, false)[0];
  if (hit) return hit.point.clone();
  if (splat) {
    const out: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[] = [];
    splat.raycast(raycaster, out);
    out.sort((a, b) => a.distance - b.distance);
    if (out[0]) return out[0].point.clone();
  }
  return null;
}

/** `allow` lets the debug panel disable a source to see what the others would have answered. */
export function pickSurface(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  pointer: THREE.Vector2,
  scene: THREE.Object3D,
  allow: Record<PickSource, boolean> = { collider: true, splat: true, plane: true },
): SurfacePick | null {
  const found = targets(scene);
  const colliders = allow.collider ? found.colliders : [];
  const splat = allow.splat ? found.splat : null;
  raycaster.setFromCamera(pointer, camera);
  const dir = raycaster.ray.direction;

  // 1. Collider mesh — the only source with a real triangle normal.
  const hit = raycaster.intersectObjects(colliders, false)[0];
  if (hit?.face) {
    const normal = hit.face.normal
      .clone()
      .applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld))
      .normalize();
    // The room transform is scale=[s,-s,-s] (negative determinant, mirrored winding), and the
    // collider renders DoubleSide, so face orientation alone can't say which side we hit.
    // Point the normal back at the camera.
    if (normal.dot(dir) > 0) normal.negate();
    return { point: hit.point.clone(), normal, source: "collider" };
  }

  // 2. Splat. Spark returns {distance, point, object} with no face, so estimate the normal from
  // two extra rays a few pixels away and the plane through the three hit points.
  if (splat) {
    const point = hitPoint(raycaster, [], splat);
    if (point) {
      const normal = estimateNormal(raycaster, camera, pointer, [], splat, point, dir);
      return { point, normal, source: "splat" };
    }
  }

  // 3. Ground plane — placement still works with no world loaded.
  if (!allow.plane) return null;
  const onPlane = raycaster.ray.intersectPlane(GROUND, new THREE.Vector3());
  if (onPlane) return { point: onPlane, normal: UP.clone(), source: "plane" };
  return null;
}

const EPS = 0.006; // NDC offset for the probe rays (~a few pixels)

function estimateNormal(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  pointer: THREE.Vector2,
  colliders: THREE.Object3D[],
  splat: SplatLike | null,
  centre: THREE.Vector3,
  dir: THREE.Vector3,
): THREE.Vector3 {
  const probe = new THREE.Vector2();
  raycaster.setFromCamera(probe.set(pointer.x + EPS, pointer.y), camera);
  const a = hitPoint(raycaster, colliders, splat);
  raycaster.setFromCamera(probe.set(pointer.x, pointer.y + EPS), camera);
  const b = hitPoint(raycaster, colliders, splat);
  raycaster.setFromCamera(pointer, camera); // restore
  if (!a || !b) return UP.clone();

  const normal = a.sub(centre).cross(b.sub(centre));
  if (normal.lengthSq() < 1e-12) return UP.clone();
  normal.normalize();
  if (normal.dot(dir) > 0) normal.negate();
  return normal;
}

/** Quaternion that stands an object's +Y along `normal`, yawed so its +Z faces the camera. */
export function orientTo(normal: THREE.Vector3, point: THREE.Vector3, camera: THREE.Camera) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, normal);
  const toCamera = camera.position.clone().sub(point).projectOnPlane(normal);
  if (toCamera.lengthSq() < 1e-8) return q;
  toCamera.normalize();
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q).projectOnPlane(normal);
  if (forward.lengthSq() < 1e-8) return q;
  forward.normalize();
  const angle = Math.atan2(normal.dot(new THREE.Vector3().crossVectors(forward, toCamera)), forward.dot(toCamera));
  return q.premultiply(new THREE.Quaternion().setFromAxisAngle(normal, angle));
}
