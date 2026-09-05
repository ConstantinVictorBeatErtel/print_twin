import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { convertGlb, generationPayload, makeApi, waitForTask } from '../scripts/image-to-stl.mjs';

function boxGlb() {
  const geometry = new BoxGeometry(2, 4, 6).toNonIndexed();
  const positions = Buffer.from(geometry.attributes.position.array.buffer);
  const description = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [5, 8, 2], scale: [2, 1, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: positions.length }],
    bufferViews: [{ buffer: 0, byteLength: positions.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 12, type: 'VEC3', min: [-1, -2, -3], max: [1, 2, 3] }],
  };
  const text = JSON.stringify(description);
  const json = Buffer.from(text.padEnd(Math.ceil(Buffer.byteLength(text) / 4) * 4, ' '));
  const glb = Buffer.alloc(28 + json.length + positions.length);
  glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
  glb.writeUInt32LE(positions.length, 20 + json.length); glb.writeUInt32LE(0x004e4942, 24 + json.length);
  positions.copy(glb, 28 + json.length);
  return glb;
}

test('GLB → STL preserves node scale, rotates to Z-up, sets height, and rests on bed', async () => {
  const { stl, triangles } = await convertGlb(boxGlb(), 80);
  assert.equal(triangles, 12);
  const geometry = new STLLoader().parse(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.length));
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  for (const [actual, expected] of [[bounds.min.x, -40], [bounds.max.x, 40], [bounds.min.y, -60], [bounds.max.y, 60], [bounds.min.z, 0], [bounds.max.z, 80]]) {
    assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} ≈ ${expected}`);
  }
});

test('rejects invalid mesh data and height', async () => {
  await assert.rejects(convertGlb(Buffer.from('not a mesh')), /GLB/);
  await assert.rejects(convertGlb(boxGlb(), 0), /Height/);
});

test('fast request disables texture, PBR, and UV processing', () => {
  assert.deepEqual(generationPayload('test-token', 'png', { color: false }), {
    type: 'image_to_model', model_version: 'P1-20260311', file: { type: 'png', file_token: 'test-token' },
    texture: false, pbr: false, export_uv: false,
  });
});

test('failed paid POST is never retried', async () => {
  let calls = 0;
  const api = makeApi({ key: 'test-key', base: 'https://example.invalid' }, async () => { calls++; throw new Error('connection reset'); });
  await assert.rejects(api('/task', { method: 'POST', body: {} }), /outcome may be unknown/);
  assert.equal(calls, 1);
});

test('API envelope errors fail even with HTTP 200', async () => {
  const api = makeApi({ key: 'test-key', base: 'https://example.invalid' }, async () => Response.json({ code: 2015, message: 'deprecated' }));
  await assert.rejects(api('/task'), /2015.*deprecated/);
});

test('polls the same task until success and stops on terminal failure', async () => {
  let calls = 0;
  const api = async (path) => { assert.equal(path, '/task/test-id'); return { status: ++calls === 1 ? 'running' : 'success' }; };
  const task = await waitForTask(api, 'test-id', { timeoutMs: 1000, pollMs: 1 });
  assert.equal(task.status, 'success'); assert.equal(calls, 2);
  await assert.rejects(waitForTask(async () => ({ status: 'failed' }), 'test-id', { timeoutMs: 1000, pollMs: 1 }), /failed/);
  await assert.rejects(waitForTask(async () => ({ status: 'running' }), 'test-id', { timeoutMs: 5, pollMs: 1 }), /resume with --task-id test-id/);
});


test('default generation requests image-aligned color without expensive PBR maps', () => {
  const payload = generationPayload('color-token', 'png');
  assert.equal(payload.texture, true); assert.equal(payload.pbr, false);
  assert.equal(payload.texture_quality, 'standard'); assert.equal(payload.texture_alignment, 'original_image');
  assert.equal(payload.export_uv, false); // defer UV unwrapping to the texturing stage
});
