import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAssetPipeline } from '../server/asset-pipeline.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const input = () => ({ id: randomUUID(), image, cleanImage: image, reference: image, description: 'An open faceted pot', heightMm: 80 });
function tetraGlb({ color = true } = {}) {
  const positions = Buffer.from(new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,0, 0,0,1, 1,0,0, 0,0,0, 0,1,0, 0,0,1, 1,0,0, 0,0,1, 0,1,0]).buffer);
  const data = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: positions.length }], bufferViews: [{ buffer: 0, byteLength: positions.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 12, type: 'VEC3', min: [0,0,0], max: [1,1,1] }] };
  const uv = Buffer.from(new Float32Array(Array.from({ length: 24 }, (_, i) => i % 2)).buffer);
  const binary = color ? Buffer.concat([positions, uv]) : positions;
  if (color) {
    data.buffers[0].byteLength = binary.length;
    data.bufferViews.push({ buffer: 0, byteOffset: positions.length, byteLength: uv.length });
    data.accessors.push({ bufferView: 1, componentType: 5126, count: 12, type: 'VEC2' });
    data.meshes[0].primitives[0].attributes.TEXCOORD_0 = 1;
    data.meshes[0].primitives[0].material = 0;
    data.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: .8 } }];
    data.textures = [{ source: 0 }]; data.images = [{ uri: image }];
  }
  const text = JSON.stringify(data), json = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4, ' '));
  const bytes = Buffer.alloc(28 + json.length + binary.length);
  bytes.write('glTF'); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  bytes.writeUInt32LE(binary.length, 20 + json.length); bytes.writeUInt32LE(0x004e4942, 24 + json.length); binary.copy(bytes, 28 + json.length);
  return bytes;
}
async function setup(t, overrides = {}) {
  const outputRoot = await mkdtemp(join(tmpdir(), 'asset-pipeline-'));
  let imageCalls = 0, submits = 0;
  const options = { outputRoot, pollMs: 1, getEnv: () => ({ FAL_KEY: 'fal-secret' }),
    getCredentials: async () => ({ key: 'tripo-secret', base: 'https://tripo.test' }),
    imageRunner: async (id, prompt, options) => {
      imageCalls++;
      assert.equal(id, 'klein-9b'); assert.equal(options.imageUrls.length, 3);
      assert.match(prompt, /An open faceted pot/);
      return { status: 'ok', bytes: Buffer.from(image.split(',')[1], 'base64'), stages: [], requests: [], alpha: { validCutout: true } };
    },
    fetchImpl: async (url, options) => {
      if (url.endsWith('/upload/sts')) return Response.json({ code: 0, data: { image_token: 'image-token' } });
      if (url === 'https://tripo.test/task') {
        submits++;
        const payload = JSON.parse(options.body);
        assert.equal(payload.model_version, 'P1-20260311'); assert.equal(payload.export_uv, false); assert.equal(payload.texture, true); assert.equal(payload.pbr, false); assert.equal(payload.texture_quality, 'standard');
        return Response.json({ code: 0, data: { task_id: 'saved-task' } });
      }
      if (url.endsWith('/task/saved-task')) return Response.json({ code: 0, data: { status: 'success', progress: 100, output: { base_model: 'https://mesh.test/model.glb' } } });
      if (url === 'https://mesh.test/model.glb') { assert.equal(options.headers, undefined); return new Response(tetraGlb()); }
      throw new Error('Unexpected request');
    }, ...overrides,
  };
  const middleware = createAssetPipeline(options);
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(outputRoot, { recursive: true, force: true }); });
  const post = (body, headers = {}) => fetch(url + '/api/asset-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const wait = async id => { for (let i = 0; i < 200; i++) { const job = await (await fetch(url + '/api/asset-jobs/' + id)).json(); if (job.status !== 'running') return job; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('Job did not finish'); };
  return { url, post, wait, outputRoot, options, counts: () => ({ imageCalls, submits }) };
}

test('drawing → cutout → P1 → real local STL completes; duplicate POST cannot charge twice', async t => {
  const s = await setup(t), body = input();
  assert.equal((await s.post(body)).status, 202);
  const job = await s.wait(body.id);
  assert.equal(job.status, 'done'); assert.equal(job.triangles, 4); assert.equal(job.appearance, 'color'); assert.equal(job.colorInfo.hasSurfaceColor, true);
  assert.deepEqual(Buffer.from(await (await fetch(s.url + job.glbUrl)).arrayBuffer()), tetraGlb());
  assert.ok(Math.abs(job.dimensionsMm[2] - 80) < 0.001);
  const stl = Buffer.from(await (await fetch(s.url + job.stlUrl)).arrayBuffer());
  assert.equal(stl.readUInt32LE(80), 4); assert.equal(stl.length, 284);
  assert.equal((await s.post(body)).status, 200);
  assert.deepEqual(s.counts(), { imageCalls: 1, submits: 1 });
  const report = await readFile(join(s.outputRoot, body.id, 'job.json'), 'utf8');
  assert.ok(!report.includes('secret')); assert.ok(!report.includes('image-token')); assert.ok(!report.includes('https://mesh.test'));
});

test('invalid input, cross-origin POST and missing credentials never generate', async t => {
  const s = await setup(t, { getCredentials: async () => { throw new Error('no key'); } });
  assert.equal((await s.post({ ...input(), heightMm: -5 })).status, 400);
  assert.equal((await s.post({ ...input(), image: 'bad' })).status, 400);
  assert.equal((await s.post(input(), { Origin: 'https://other.test' })).status, 403);
  assert.equal((await s.post(input())).status, 503);
  assert.deepEqual(s.counts(), { imageCalls: 0, submits: 0 });
});

test('invalid alpha prevents any Tripo calls', async t => {
  const s = await setup(t, { imageRunner: async () => ({ status: 'invalid-alpha', stages: [] }), fetchImpl: () => assert.fail('No Tripo call allowed') });
  const body = input(); await s.post(body);
  const job = await s.wait(body.id);
  assert.equal(job.status, 'failed'); assert.equal(job.canResume, false);
  assert.match(job.error, /transparent/);
});

test('concurrent requests are blocked while existing generation remains reconnectable', async t => {
  let release;
  const s = await setup(t, { imageRunner: () => new Promise(resolve => { release = resolve; }) });
  const body = input(); await s.post(body);
  assert.equal((await s.post(input())).status, 409);
  assert.equal((await s.post(body)).status, 200);
  const status = await (await fetch(s.url + '/api/asset-status')).json();
  assert.equal(status.activeJob, body.id); assert.ok(!JSON.stringify(status).includes('secret'));
  release({ status: 'invalid-alpha', stages: [] }); await s.wait(body.id);
});

test('mesh download failure resumes saved task without another image or paid POST', async t => {
  const s = await setup(t);
  const upstream = s.options.fetchImpl;
  // The closure is consulted by middleware through this stable wrapper.
  let failDownload = true;
  const second = await setup(t, { fetchImpl: (url, options) => url === 'https://mesh.test/model.glb' && failDownload ? new Response('unavailable', { status: 503 }) : upstream(url, options) });
  const body = input(); await second.post(body);
  const failed = await second.wait(body.id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.canResume, true); assert.equal(failed.taskId, 'saved-task');
  failDownload = false;
  const resumed = await fetch(second.url + `/api/asset-jobs/${body.id}/resume`, { method: 'POST' });
  assert.equal(resumed.status, 202);
  assert.equal((await second.wait(body.id)).status, 'done');
  assert.equal(s.counts().submits, 1); assert.equal(second.counts().imageCalls, 1);
});

test('GLB becomes available for scene insertion while STL export is still running', async t => {
  let finishExport;
  const s = await setup(t, { convert: () => new Promise(resolve => { finishExport = resolve; }) });
  const body = input(); await s.post(body);
  let job;
  for (let i = 0; i < 100; i++) {
    job = await (await fetch(s.url + '/api/asset-jobs/' + body.id)).json();
    if (job.glbUrl && finishExport) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(job.status, 'running'); assert.equal(job.stage, 'export'); assert.equal(job.stlUrl, null);
  const response = await fetch(s.url + job.glbUrl);
  assert.equal(response.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString(), 'glTF');
  finishExport({ stl: Buffer.alloc(84), triangles: 0, dimensions_mm: [10, 10, 80] });
  assert.equal((await s.wait(body.id)).status, 'done');
});

test('color generation downloads the finished model instead of the gray base mesh', async t => {
  const basic = await setup(t);
  const s = await setup(t, { fetchImpl: async (url, options) => {
    if (url.endsWith('/task/saved-task')) return Response.json({ code: 0, data: { status: 'success', output: {
      base_model: 'https://mesh.test/gray.glb', model: 'https://mesh.test/color.glb',
    } } });
    if (url === 'https://mesh.test/gray.glb') assert.fail('Must not choose the gray base mesh');
    if (url === 'https://mesh.test/color.glb') return new Response(tetraGlb());
    return basic.options.fetchImpl(url, options);
  } });
  const body = input(); await s.post(body);
  const job = await s.wait(body.id);
  assert.equal(job.status, 'done'); assert.equal(job.artifactField, 'model');
  assert.equal(job.colorInfo.texturedPrimitives, 1); assert.equal(job.colorInfo.embeddedImages, 1);
});

test('a gray artifact is not silently accepted as a successful color asset', async t => {
  const basic = await setup(t);
  const s = await setup(t, { fetchImpl: (url, options) => url === 'https://mesh.test/model.glb' ? new Response(tetraGlb({ color: false })) : basic.options.fetchImpl(url, options) });
  const body = input(); await s.post(body);
  const job = await s.wait(body.id);
  assert.equal(job.status, 'failed'); assert.match(job.error, /without surface color/);
  assert.equal(job.glbUrl, null); assert.equal(job.canResume, true);
});

test('STL export failure keeps the verified color GLB downloadable and resumable', async t => {
  const s = await setup(t, { convert: async () => { throw new Error('STL export unavailable'); } });
  const body = input(); await s.post(body);
  const job = await s.wait(body.id);
  assert.equal(job.status, 'failed'); assert.equal(job.canResume, true); assert.ok(job.glbUrl); assert.equal(job.stlUrl, null);
  assert.deepEqual(Buffer.from(await (await fetch(s.url + job.glbUrl)).arrayBuffer()), tetraGlb());
});
