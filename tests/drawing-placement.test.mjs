import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { drawingBounds, anchorDrawing, fitDrawing, cameraForAnchor, contactPoint, decimate } from "../src/lib/drawingPlacement.ts";

function room() {
  const scene = new T.Scene();
  const floor = new T.Mesh(new T.BoxGeometry(20, .1, 20), new T.MeshBasicMaterial({ side: T.DoubleSide }));
  floor.position.y = -.05; floor.userData.collider = true; floor.visible = false; scene.add(floor);
  const camera = new T.PerspectiveCamera(65, 16 / 9, .02, 100);
  camera.position.set(1, 2, 4); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return { scene, camera };
}
const bounds = { left: .4, right: .6, top: .3, bottom: .65 };
// A closed rectangular outline over `bounds`, symmetric so its base centroid is x = .5.
const outline = [{ width: .004, points: [{ x: .4, y: .3 }, { x: .6, y: .3 }, { x: .6, y: .65 }, { x: .4, y: .65 }, { x: .4, y: .3 }] }];
test("drawing needs an outline, bounds combine all strokes without viewport pixels", () => {
  assert.equal(drawingBounds([]), null);
  assert.equal(drawingBounds([{ points: [{ x: .5, y: .5 }] }]), null);
  assert.deepEqual(drawingBounds([{ points: [{ x: .4, y: .3 }, { x: .6, y: .5 }] }, { points: [{ x: .5, y: .65 }] }]), bounds);
});
test("drawing base is anchored to its exact screen ray on a real surface", () => {
  const { camera, scene } = room();
  const anchor = anchorDrawing(outline, camera, scene);
  assert.equal(anchor.source, "collider");
  assert.ok(Math.abs(anchor.position[1]) < 1e-7);
  const base = new T.Vector3().fromArray(anchor.position).project(camera);
  assert.ok(Math.abs(base.x - (bounds.left + bounds.right - 1)) < 1e-7);
  assert.ok(Math.abs(base.y - (1 - bounds.bottom * 2)) < 1e-7);
  assert.throws(() => anchorDrawing(outline, camera, new T.Scene()), /No nearby room surface/);
});
test("generation uses the captured camera after walking away, with a fitted visible size", () => {
  const { camera, scene } = room();
  const anchor = anchorDrawing(outline, camera, scene);
  const model = new T.Group();
  const mesh = new T.Mesh(new T.BoxGeometry(2, 4, 1)); mesh.position.set(3, 8, -2); model.add(mesh);
  const before = fitDrawing(model, anchor);
  camera.position.set(50, 5, 9); camera.rotation.y += 1; camera.updateMatrixWorld();
  const restored = JSON.parse(JSON.stringify(anchor));
  assert.deepEqual(fitDrawing(model, restored), JSON.parse(JSON.stringify(before)));
  assert.deepEqual(before.position, anchor.position);
  assert.ok(before.targetSize > .02 && before.targetSize < 10);
  const bbox = new T.Box3().setFromObject(model), center = bbox.getCenter(new T.Vector3());
  model.position.set(-center.x, -bbox.min.y, -center.z);
  const placed = new T.Group(); placed.add(model); placed.position.fromArray(before.position); placed.rotation.set(...before.rotation); placed.scale.setScalar(before.targetSize / 4); placed.updateMatrixWorld(true);
  const points = [];
  for (const x of [2, 4]) for (const y of [6, 10]) for (const z of [-2.5, -1.5]) points.push(new T.Vector3(x, y, z).applyMatrix4(model.matrixWorld).project(cameraForAnchor(anchor)));
  const w = Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));
  const h = Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y));
  const occupancy = Math.max(w / .4, h / .7);
  assert.ok(occupancy > .999 && occupancy <= 1.00001, `Footprint occupancy: ${occupancy}`);
});

test("the contact point follows the ink resting on the surface, not the bounding box corner", () => {
  // A stroke whose tail flicks out to the right widens the box, but the object still sits
  // where the mass of ink meets the table.
  const tail = [{ width: .004, points: [
    { x: .4, y: .3 }, { x: .5, y: .3 }, { x: .5, y: .65 }, { x: .4, y: .65 }, { x: .4, y: .3 }, { x: .9, y: .32 },
  ] }];
  const box = drawingBounds(tail);
  assert.equal(box.right, .9);
  assert.ok(Math.abs(contactPoint(tail, box).x - .45) < 1e-9, "base ignores the tail");
  assert.ok(Math.abs((box.left + box.right) / 2 - .45) > .1, "the box centre would have been wrong");
  // With no ink in the base band at all, fall back to the box.
  assert.deepEqual(contactPoint([], box), { x: (box.left + box.right) / 2, y: box.bottom });
});

test("the anchor carries decimated ink, keeping every stroke's endpoints", () => {
  const { camera, scene } = room();
  assert.deepEqual(anchorDrawing(outline, camera, scene).strokes, outline);
  const long = [{ width: .004, points: Array.from({ length: 5000 }, (_, i) => ({ x: .4 + i / 25000, y: .6 })) }];
  const small = decimate(long, 600);
  const points = small[0].points;
  assert.ok(points.length <= 600 && points.length > 100, `kept ${points.length}`);
  assert.deepEqual(points[0], long[0].points[0]);
  assert.deepEqual(points.at(-1), long[0].points.at(-1));
});
