import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { emptyHistory, sceneHistory, validPlacement } from "../src/lib/localScene.ts";
import { validateGlb } from "../src/lib/localModel.ts";
import { fitToTarget } from "../src/lib/fit.ts";
import { pickSurface, orientTo } from "../src/lib/surfacePick.ts";

const placement = { id: "one", modelId: "plantpot", position: [1, 2, 3], rotation: [0, 0, 0], scale: 1, targetSize: 0.3 };

test("placement move and removal undo/redo preserve exact transforms", () => {
  let state = sceneHistory(emptyHistory, { type: "set", placements: [placement] });
  const moved = { ...placement, position: [3, 4, 5], scale: 2 };
  state = sceneHistory(state, { type: "set", placements: [moved] });
  state = sceneHistory(state, { type: "set", placements: [] });
  state = sceneHistory(state, { type: "undo" });
  assert.deepEqual(state.present, [moved]);
  state = sceneHistory(state, { type: "undo" });
  assert.deepEqual(state.present, [placement]);
  state = sceneHistory(state, { type: "redo" });
  assert.deepEqual(state.present, [moved]);
  state = sceneHistory(state, { type: "set", placements: [placement] });
  assert.equal(state.future.length, 0);
});

test("restoring a scene does not create an undo step that clears saved objects", () => {
  const restored = sceneHistory(emptyHistory, { type: "restore", placements: [placement] });
  assert.equal(sceneHistory(restored, { type: "undo" }), restored);
});

test("saved placements reject invalid positions and scales", () => {
  assert.ok(validPlacement(placement));
  for (const patch of [{ position: [1, 2] }, { rotation: [0, NaN, 0] }, { scale: 0 }, { scale: Infinity }, { targetSize: -1 }]) {
    assert.equal(validPlacement({ ...placement, ...patch }), false);
  }
});

test("model normalization anchors its bottom center at the placement point", () => {
  const model = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2));
  mesh.position.set(4, 8, -2);
  model.add(mesh);
  const fit = fitToTarget(model, 0.5);
  model.position.copy(fit.offset);
  const anchor = new THREE.Group();
  anchor.add(model);
  anchor.scale.setScalar(fit.scale * 2);
  anchor.position.set(1, 2, 3);
  const box = new THREE.Box3().setFromObject(anchor);
  assert.equal(box.min.y, 2);
  assert.equal(box.getCenter(new THREE.Vector3()).x, 1);
  assert.equal(box.getCenter(new THREE.Vector3()).z, 3);
  assert.equal(box.getSize(new THREE.Vector3()).y, 1);
});

test("surface placement hits an invisible transformed collider and can disable the fallback plane", () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  camera.position.set(0, 2, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 8), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  floor.position.y = -0.05;
  floor.userData.collider = true;
  const hidden = new THREE.Group();
  hidden.visible = false;
  hidden.add(floor);
  scene.add(hidden);
  scene.updateMatrixWorld(true);
  const hit = pickSurface(new THREE.Raycaster(), camera, new THREE.Vector2(), scene, { collider: true, splat: false, plane: false });
  assert.equal(hit.source, "collider");
  assert.ok(Math.abs(hit.point.y) < 1e-7);
  assert.ok(hit.normal.y > 0.99);
  const orientation = orientTo(hit.normal, hit.point, camera);
  assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(orientation).y > 0.99);
  assert.equal(pickSurface(new THREE.Raycaster(), camera, new THREE.Vector2(), new THREE.Scene(), { collider: false, splat: false, plane: false }), null);
});

function glb(json) {
  const text = JSON.stringify(json);
  const bytes = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4, " "));
  const buffer = new ArrayBuffer(20 + bytes.length);
  const view = new DataView(buffer);
  [0x46546c67, 2, buffer.byteLength, bytes.length, 0x4e4f534a].forEach((n, i) => view.setUint32(i * 4, n, true));
  new Uint8Array(buffer, 20).set(bytes);
  return buffer;
}

test("GLB import accepts embedded models and rejects external resources or damaged files", () => {
  validateGlb(glb({ meshes: [{}], buffers: [{ byteLength: 24 }], images: [{ uri: "data:image/png;base64,AA==" }] }));
  assert.throws(() => validateGlb(new ArrayBuffer(10)), /too short/);
  assert.throws(() => validateGlb(glb({ meshes: [{}], images: [{ uri: "textures/missing.png" }] })), /self-contained/);
  assert.throws(() => validateGlb(glb({ meshes: [{}], buffers: [{ uri: "https://example.com/model.bin" }] })), /self-contained/);
  assert.throws(() => validateGlb(glb({})), /no mesh/);
});
