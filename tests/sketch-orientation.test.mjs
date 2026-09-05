import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {
  rasterizeInk, maskBox, maskEdge, distanceTransform, alignToBox, chamfer,
  matchSketchYaw, composeYaw, inkFrame,
} from "../src/lib/sketchOrientation.ts";

/** A 16:9 anchor whose ink is the outline of `shape`, drawn at yaw `truth`. */
function anchor(strokes) {
  const camera = new T.PerspectiveCamera(65, 16 / 9, .02, 100);
  camera.position.set(0, 1.6, 3); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return {
    position: [0, 0, 0], rotation: [0, 0, 0], source: "collider",
    bounds: { left: .3, top: .25, right: .7, bottom: .75 },
    cameraWorld: camera.matrixWorld.toArray(), projection: camera.projectionMatrix.toArray(),
    strokes,
  };
}

/** A filled polygon mask, so a fake renderer can stand in for the GPU. */
function polygonMask(points, width, height) {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) data[y * width + x] = 1;
  }
  return { data, width, height };
}

/** An L, rotated about its centre — asymmetric, so every yaw looks different. */
function ell(yaw, width, height) {
  const cx = width / 2, cy = height / 2, s = Math.min(width, height) * .3;
  const corners = [[-1, -1], [1, -1], [1, -.4], [-.3, -.4], [-.3, 1], [-1, 1]];
  return polygonMask(corners.map(([x, y]) => [
    cx + (x * Math.cos(yaw) - y * Math.sin(yaw)) * s,
    cy + (x * Math.sin(yaw) + y * Math.cos(yaw)) * s,
  ]), width, height);
}

const circle = (width, height) => {
  const cx = width / 2, cy = height / 2, r = Math.min(width, height) * .3;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (Math.hypot(x - cx, y - cy) <= r) data[y * width + x] = 1;
  }
  return { data, width, height };
};

/** The strokes a user would draw if they traced `mask`'s outline. */
function strokesFor(mask) {
  const edge = maskEdge(mask);
  const points = [];
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    if (edge.data[y * mask.width + x]) points.push({ x: (x + .5) / mask.width, y: (y + .5) / mask.height });
  }
  // Isolated dots, not a polyline: rasterizeInk fills each point's own radius.
  return points.map((p) => ({ width: .006, points: [p] }));
}

test("ink rasterizes into the drawn box, and its edge and distance transform agree", () => {
  const mask = rasterizeInk([{ width: .02, points: [{ x: .25, y: .5 }, { x: .75, y: .5 }] }], 100, 100);
  const box = maskBox(mask);
  assert.ok(box.minX <= 26 && box.maxX >= 74, `x ${box.minX}..${box.maxX}`);
  assert.ok(box.maxY - box.minY <= 4, "a thin horizontal stroke stays thin");
  const distance = distanceTransform(mask);
  assert.equal(distance[50 * 100 + 50], 0, "on the ink");
  assert.ok(distance[10 * 100 + 50] > 35, "far above the ink");
  assert.equal(maskBox({ data: new Uint8Array(16), width: 4, height: 4 }), null);
});

test("a mask aligned onto a box keeps its aspect ratio rather than stretching to fit", () => {
  const tall = polygonMask([[10, 10], [20, 10], [20, 70], [10, 70]], 80, 80);
  const wide = { minX: 0, minY: 30, maxX: 79, maxY: 49 };
  const aligned = maskBox(alignToBox(tall, maskBox(tall), wide));
  const ratio = (aligned.maxY - aligned.minY + 1) / (aligned.maxX - aligned.minX + 1);
  assert.ok(ratio > 3, `a stretched fit would be ~0.25, got ${ratio.toFixed(2)}`);
});

test("chamfer scores a matching silhouette far better than a rotated one", () => {
  const width = 96, height = 54;
  const target = ell(0, width, height);
  const ink = rasterizeInk(strokesFor(target), width, height);
  const distance = distanceTransform(ink);
  const box = maskBox(ink);
  const score = (mask) => chamfer(ink, distance, alignToBox(mask, maskBox(mask), box));
  assert.ok(score(target) < score(ell(Math.PI / 2, width, height)), "the drawn pose wins");
  assert.equal(chamfer(ink, distance, { data: new Uint8Array(width * height), width, height }), Infinity);
});

test("the sweep recovers the yaw the object was drawn at", () => {
  const truth = Math.PI / 2;
  const { width, height } = inkFrame(anchor([]));
  const a = anchor(strokesFor(ell(truth, width, height)));
  const match = matchSketchYaw(a, (yaws, w, h) => yaws.map((yaw) => ell(yaw, w, h)), { baseSize: .5 });
  assert.ok(match.confident, `expected a confident match, score ${match.score}`);
  const error = Math.abs(Math.atan2(Math.sin(match.yaw - truth), Math.cos(match.yaw - truth)));
  assert.ok(error < .2, `recovered ${(match.yaw * 180 / Math.PI).toFixed(1)}deg, wanted ${(truth * 180 / Math.PI).toFixed(1)}deg`);
  assert.ok(match.targetSize > .1 && match.targetSize < 2, `targetSize ${match.targetSize}`);
});

test("a rotationally symmetric object reports no confident yaw", () => {
  const { width, height } = inkFrame(anchor([]));
  const a = anchor(strokesFor(circle(width, height)));
  const match = matchSketchYaw(a, (yaws, w, h) => yaws.map(() => circle(w, h)), { baseSize: .5 });
  assert.equal(match.confident, false, "a circle looks the same from every angle");
  assert.equal(matchSketchYaw(anchor([]), () => [], {}), null, "no ink, no answer");
  assert.equal(matchSketchYaw(a, () => [], {}), null, "no silhouettes, no answer");
});

test("yaw composes about the object's own up, so it stays standing on a sloped surface", () => {
  const normal = new T.Vector3(.4, 1, .2).normalize();
  const base = new T.Euler().setFromQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), normal));
  const rotation = [base.x, base.y, base.z];
  assert.deepEqual(composeYaw(rotation, 0).map((n) => +n.toFixed(9)), rotation.map((n) => +n.toFixed(9)));
  for (const yaw of [.3, Math.PI / 2, -2.1]) {
    const up = new T.Vector3(0, 1, 0)
      .applyQuaternion(new T.Quaternion().setFromEuler(new T.Euler(...composeYaw(rotation, yaw))));
    assert.ok(up.distanceTo(normal) < 1e-6, `yaw ${yaw} tilted the object off the surface`);
  }
});
