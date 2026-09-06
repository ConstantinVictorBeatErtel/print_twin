import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { anchorDrawing } from "../src/lib/drawingPlacement.ts";
import { resolveSketchPose, VIEW_COUNT } from "../src/lib/sketchPose.ts";

const outline = [{ width: .004, points: [{ x: .4, y: .3 }, { x: .6, y: .3 }, { x: .6, y: .65 }, { x: .4, y: .65 }, { x: .4, y: .3 }] }];

function room() {
  const scene = new T.Scene();
  const floor = new T.Mesh(new T.BoxGeometry(20, .1, 20), new T.MeshBasicMaterial({ side: T.DoubleSide }));
  floor.position.y = -.05; floor.userData.collider = true; scene.add(floor);
  const camera = new T.PerspectiveCamera(65, 16 / 9, .02, 100);
  camera.position.set(1, 2, 4); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return anchorDrawing(outline, camera, scene);
}

function model() {
  const group = new T.Group();
  group.add(new T.Mesh(new T.BoxGeometry(1, 2, 1)));
  return group;
}

/** Records what the ladder reached for, so a test can assert what it did *not* touch. */
function tools({ vision, yaw = null, choice = null }) {
  const calls = { store: 0, orient: 0, renderViews: 0, window: undefined };
  return {
    calls,
    vision,
    store: async () => { calls.store++; return "storage-id"; },
    orient: async () => { calls.orient++; return choice; },
    solver: {
      renderViews: () => { calls.renderViews++; return { dataUrl: "data:image/png;base64,x", yaws: [] }; },
      renderInk: () => "data:image/png;base64,y",
      solveYaw: (_m, _a, size, window) => {
        calls.window = window;
        return yaw === null ? null : { yaw, score: 0.1, confident: true, targetSize: size };
      },
    },
  };
}

test("the vision rung is off unless asked for, and costs nothing when off", async () => {
  const t = tools({ vision: undefined, yaw: 0.4 });
  const pose = await resolveSketchPose(model(), room(), "a chair", t);

  // The whole point of the flag: no renders, no uploads, no round trip.
  assert.equal(t.calls.renderViews, 0, "rendered a contact sheet with vision off");
  assert.equal(t.calls.store, 0, "uploaded images with vision off");
  assert.equal(t.calls.orient, 0, "called the vision model with vision off");
  // ...and the geometric sweep still runs, over the full circle.
  assert.equal(t.calls.window, undefined, "the sweep was narrowed without a vision answer");
  assert.equal(pose.facing, "sketched");
  assert.ok(Array.isArray(pose.position) && pose.position.length === 3);
});

test("switched off is reported as a normal placement, not as a broken deployment", async () => {
  // A symmetric object with vision off must not claim orientation matching is unavailable —
  // that copy exists for a missing key, and would send someone debugging their env vars.
  const t = tools({ vision: false, yaw: null });
  const pose = await resolveSketchPose(model(), room(), "a vase", t);
  assert.equal(pose.facing, "camera");
});

test("with the flag on, a confident pick narrows the sweep to that view's sector", async () => {
  const t = tools({ vision: true, yaw: 1.2, choice: { view: 3, confidence: "high", reasoning: "handle left" } });
  const pose = await resolveSketchPose(model(), room(), "a mug", t);

  assert.equal(t.calls.orient, 1);
  assert.equal(t.calls.store, 2, "the contact sheet and the ink both upload");
  assert.ok(t.calls.window, "a confident pick should narrow the sweep");
  assert.ok(Math.abs(t.calls.window.center - 2 * (2 * Math.PI / VIEW_COUNT)) < 1e-9, "view 3 is two steps round from view 1");
  assert.equal(t.calls.window.span, 2 * Math.PI / VIEW_COUNT);
  assert.equal(pose.facing, "vision");
  assert.equal(pose.debug.view, 3);
});

test("a low-confidence answer falls through to the full sweep rather than a coin-flip sector", async () => {
  const t = tools({ vision: true, yaw: 0.7, choice: { view: 5, confidence: "low", reasoning: "symmetric" } });
  const pose = await resolveSketchPose(model(), room(), "a ball", t);
  assert.equal(t.calls.window, undefined, "a low-confidence sector must not narrow the sweep");
  assert.equal(pose.facing, "sketched");
});
