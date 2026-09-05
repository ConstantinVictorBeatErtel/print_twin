import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { orientOnSurface, poseOnSurface, surfaceKind } from "../src/lib/placementPose.ts";

const camera = new THREE.PerspectiveCamera(65, 16 / 9, .02, 100);
camera.position.set(0, 1.6, 3);
camera.lookAt(0, 1, 0);
camera.updateMatrixWorld();

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const close = (a, b, tolerance = 1e-6) => assert.ok(a.distanceTo(b) < tolerance, `${a.toArray()} != ${b.toArray()}`);
/** Where the object's own axis ends up in the room. */
const axis = (quaternion, v) => v.clone().applyQuaternion(quaternion);

test("a surface is classified by its normal, and splat normals are trusted less", () => {
  assert.equal(surfaceKind(V(0, 1, 0)), "floor");
  assert.equal(surfaceKind(V(0, -1, 0)), "ceiling");
  assert.equal(surfaceKind(V(1, 0, 0)), "wall");
  // 30 degrees off vertical is still a wall from the collider, but too uncertain from a splat.
  assert.equal(surfaceKind(V(0, .5, .866)), "wall");
  assert.equal(surfaceKind(V(0, .5, .866), "splat"), "floor");
  assert.equal(surfaceKind(V(0, .2, .98), "splat"), "wall");
});

test("objects stand on floors, lie back against walls and hang from ceilings", () => {
  const point = V(0, 1, 0);
  close(axis(orientOnSurface(V(0, 1, 0), point, camera), V(0, 1, 0)), V(0, 1, 0));
  close(axis(orientOnSurface(V(0, -1, 0), point, camera), V(0, 1, 0)), V(0, -1, 0));

  for (const normal of [V(0, 0, 1), V(1, 0, 0), V(-.6, .2, .8).normalize()]) {
    const q = orientOnSurface(normal, point, camera);
    // +Z points out of the wall, so the object's back is the side touching it…
    close(axis(q, V(0, 0, 1)), normal.clone().normalize());
    // …and it is not tipped over: its own up stays as close to world up as the wall allows.
    assert.ok(axis(q, V(0, 1, 0)).y > .9);
  }
});

test("the object sits exactly on the point that was picked, on every kind of surface", () => {
  for (const [normal, kind] of [[V(0, 1, 0), "floor"], [V(0, 0, 1), "wall"], [V(0, -1, 0), "ceiling"]]) {
    const point = V(.4, 1.5, -.2);
    const pose = poseOnSurface({ point, normal, source: "collider" }, camera);
    assert.equal(pose.kind, kind);
    close(pose.position, point);
    // The pose must not alias the pick: committing it copies, it does not move the hit.
    assert.notEqual(pose.position, point);
  }
});

test("yaw turns the object about its own up axis, on any surface", () => {
  const hit = { point: V(0, 1.5, 0), normal: V(0, 0, 1), source: "collider" };
  const turned = poseOnSurface(hit, camera, Math.PI / 2);
  close(axis(turned.quaternion, V(0, 1, 0)), V(0, 1, 0));       // still upright on the wall
  close(axis(turned.quaternion, V(0, 0, 1)), V(1, 0, 0));       // but turned a quarter
});
