// Normalizing a generated GLB into the room's frame.
//
// Tripo is called with `auto_size: true` but its output is not reliably metric, so a raw
// GLB dropped into a room-scale Marble world reads as either giant or invisible. We measure
// the mesh once on load and derive (a) a uniform scale that brings its largest dimension to
// a target size in metres and (b) the offset that moves its bottom-centre onto the origin,
// so a placement anchor means "the object sits here" rather than "the model origin is here".
//
// Both the placement ghost and the committed Asset run this, so the object does not jump
// when you click. The `scale` stored in Convex is a *relative multiplier on top of* this.
import * as THREE from "three";

export const TARGET_SIZE = 0.5; // metres, longest dimension

export type Fit = { scale: number; offset: THREE.Vector3 };

export function fitToTarget(obj: THREE.Object3D, target = TARGET_SIZE): Fit {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return { scale: 1, offset: new THREE.Vector3() };
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  const scale = largest > 1e-6 ? target / largest : 1;
  // Model-local units: the parent group carries `scale`, which scales this offset too.
  return { scale, offset: new THREE.Vector3(-centre.x, -box.min.y, -centre.z) };
}
