import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry } from 'three';
import { inspectGlb, readGlb, geometryOnlyGlb, modelArtifact } from '../scripts/glb-assets.mjs';
import { convertGlb } from '../scripts/image-to-stl.mjs';

function coloredBox({ external = false, textured = true } = {}) {
  const geometry = new BoxGeometry(1, 2, 1).toNonIndexed();
  const positions = Buffer.from(geometry.attributes.position.array.buffer);
  const uv = Buffer.from(geometry.attributes.uv.array.buffer);
  const binary = Buffer.concat([positions, uv]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, .2, .1, 1], ...(textured ? { baseColorTexture: { index: 0 } } : {}) } }],
    textures: [{ source: 0 }], images: [{ uri: external ? 'https://example.invalid/texture.png' : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' }],
    buffers: [{ byteLength: binary.length }], bufferViews: [{ buffer: 0, byteLength: positions.length }, { buffer: 0, byteOffset: positions.length, byteLength: uv.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 12, type: 'VEC3', min: [-.5, -1, -.5], max: [.5, 1, .5] }, { bufferView: 1, componentType: 5126, count: uv.length / 8, type: 'VEC2' }] };
  const text = Buffer.from(JSON.stringify(json)); const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(padded);
  const glb = Buffer.alloc(28 + padded.length + binary.length);
  glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20);
  glb.writeUInt32LE(binary.length, 20 + padded.length); glb.writeUInt32LE(0x004e4942, 24 + padded.length); binary.copy(glb, 28 + padded.length);
  return glb;
}

test('offline STL conversion of a textured GLB preserves the canonical color bytes', async () => {
  const bytes = coloredBox(), original = Buffer.from(bytes);
  const info = inspectGlb(bytes, { requireColor: true });
  assert.equal(info.texturedPrimitives, 1); assert.equal(info.embeddedImages, 1);
  const converted = await convertGlb(bytes, 90);
  assert.equal(converted.triangles, 12); assert.ok(Math.abs(converted.dimensions_mm[2] - 90) < 1e-6);
  assert.deepEqual(bytes, original);
  const temporary = readGlb(geometryOnlyGlb(bytes));
  assert.equal(temporary.json.images, undefined); assert.equal(temporary.json.materials, undefined);
  assert.deepEqual(temporary.chunks[1].data, readGlb(bytes).chunks[1].data);
});

test('color verification rejects external dependencies and unused texture images', () => {
  assert.throws(() => inspectGlb(coloredBox({ external: true })), /self-contained/);
  assert.throws(() => inspectGlb(coloredBox({ textured: false }), { requireColor: true }), /without surface color/);
  const bytes = coloredBox(); bytes.writeUInt32LE(0xfffffffc, 12);
  assert.throws(() => inspectGlb(bytes), /chunk length/);
});

test('artifact preference honors textured and geometry modes and validates transport', () => {
  const task = { output: { base_model: 'https://mesh.test/base.glb', model: { url: 'https://mesh.test/color.glb' }, pbr_model: 'https://mesh.test/pbr.glb' } };
  assert.equal(modelArtifact(task).field, 'pbr_model');
  assert.equal(modelArtifact(task, { color: false }).field, 'base_model');
  assert.throws(() => modelArtifact({ output: { model: 'http://mesh.test/plain.glb' } }), /non-HTTPS/);
});
