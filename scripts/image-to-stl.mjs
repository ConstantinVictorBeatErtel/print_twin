#!/usr/bin/env node
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Box3, Group, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { geometryOnlyGlb, inspectGlb, modelArtifact } from './glb-assets.mjs';

export const MODEL = 'P1-20260311';
const HELP = `Image → Tripo P1 color GLB + geometry-only STL

  npm run image:stl -- image.png [--out output-dir] [--height-mm 100]
  npm run image:stl -- --task-id UUID [--out output-dir]
  npm run image:stl -- --glb model.glb [--out output-dir]

Options:
  --height-mm N   STL height in millimeters (default 100)
  --timeout N     Polling deadline in seconds (default 300)
  --poll-ms N     Polling interval in milliseconds (default 1000, minimum 500)
  --profile NAME Select a saved Tripo CLI profile
  --task-id UUID Resume an existing generation; no new generation charge
  --glb PATH     Export an STL copy of a downloaded GLB entirely offline
  --geometry-only Skip color generation for the fastest geometry-only result
  --out DIR      New output folder (resume/offline modes may reuse a folder)

Authentication: TRIPO_API_KEY or the existing login in ~/.tripo/config.json.
Each image invocation submits ONE paid task. No automatic POST retries or
model fallbacks. Timeouts leave the remote task running; resume by task ID.
GLB preserves embedded colors/materials in native Y-up units. Texturing adds time.
STL has no color; it is Z-up, centered on the bed, and scaled to the requested height.
`;

export function generationPayload(fileToken, type, { color = true } = {}) {
  return { type: 'image_to_model', model_version: MODEL,
    file: { type, file_token: fileToken }, texture: color, pbr: false, export_uv: false,
    ...(color ? { texture_quality: 'standard', texture_alignment: 'original_image' } : {}) };
}

export async function credentials(env = process.env) {
  let config = {};
  try { config = JSON.parse(await readFile(join(env.TRIPO_HOME || join(homedir(), '.tripo'), 'config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read Tripo CLI config: ' + error.message); }
  const name = env.TRIPO_PROFILE || config.active_profile || 'default';
  const profile = config.profiles?.[name] || (name === 'default' ? config : {});
  const key = env.TRIPO_API_KEY || profile.api_key;
  if (!key) throw new Error(`No Tripo API key for profile "${name}". Run ./tripo login or set TRIPO_API_KEY.`);
  const region = env.TRIPO_REGION || profile.region || 'ov';
  if (!['ov', 'cn'].includes(region)) throw new Error('TRIPO_REGION must be ov or cn.');
  return { key, base: `https://api.tripo3d.${region === 'cn' ? 'com' : 'ai'}/v2/openapi` };
}

export function makeApi({ key, base }, fetchImpl = fetch) {
  return async (path, { method = 'GET', body, timeoutMs = 60000 } = {}) => {
    const headers = { Authorization: `Bearer ${key}` };
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    // A failed POST can still have created a paid task. Never retry it implicitly.
    let response;
    try { response = await fetchImpl(base + path, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) }); }
    catch { throw new Error(`${method} ${path}: network failure/timeout. ${method === 'POST' ? 'Submission outcome may be unknown; check Tripo task history before submitting again.' : 'Resume the same task ID.'}`); }
    let result;
    try { result = await response.json(); }
    catch { throw new Error(`${method} ${path}: non-JSON response (HTTP ${response.status}); check task history before repeating a submission.`); }
    if (!response.ok || result.code !== 0) {
      throw new Error(`Tripo HTTP ${response.status}, code ${result.code}: ${result.message || 'API error'}`);
    }
    if (!result.data) throw new Error(`Tripo ${path} returned no data; check task history before repeating a submission.`);
    return result.data;
  };
}

export async function waitForTask(api, taskId, { timeoutMs, pollMs, onProgress = () => {} }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await api('/task/' + encodeURIComponent(taskId), { timeoutMs: Math.max(1, Math.min(30000, deadline - Date.now())) });
    onProgress(task);
    if (task.status === 'success') return task;
    if (['failed', 'cancelled', 'canceled', 'banned', 'expired', 'unknown'].includes(task.status)) {
      throw new Error(`Task ${taskId}: ${task.status}${task.error_msg ? ' — ' + task.error_msg : ''}`);
    }
    await new Promise(r => setTimeout(r, Math.max(0, Math.min(pollMs, deadline - Date.now()))));
  }
  throw new Error(`Timed out. Remote task continues; resume with --task-id ${taskId}.`);
}

export async function convertGlb(bytes, heightMm = 100) {
  if (!Number.isFinite(heightMm) || heightMm <= 0) throw new Error('Height must be positive.');
  // This derivative is geometry-only; the canonical GLB is never modified.
  bytes = geometryOnlyGlb(bytes);
  globalThis.ProgressEvent ??= class ProgressEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  };
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  // Preserve node transforms; a separate wrapper rotates glTF Y-up into STL Z-up.
  const orientation = new Group();
  orientation.rotation.x = Math.PI / 2;
  orientation.add(gltf.scene);
  const root = new Group();
  root.add(orientation);
  root.updateMatrixWorld(true);
  let bounds = new Box3().setFromObject(root);
  const size = bounds.getSize(new Vector3());
  if (!size.toArray().every(n => Number.isFinite(n) && n > 0)) throw new Error('Mesh has empty, flat, or invalid bounds.');
  root.scale.setScalar(heightMm / size.z);
  root.updateMatrixWorld(true);
  bounds = new Box3().setFromObject(root);
  root.position.set(-(bounds.min.x + bounds.max.x) / 2, -(bounds.min.y + bounds.max.y) / 2, -bounds.min.z);
  root.updateMatrixWorld(true);
  const view = new STLExporter().parse(root, { binary: true });
  const stl = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  const triangles = stl.readUInt32LE(80);
  if (!triangles || stl.length !== 84 + triangles * 50) throw new Error('Invalid binary STL output.');
  for (let i = 84; i < stl.length; i += 50) {
    for (let j = 0; j < 48; j += 4) if (!Number.isFinite(stl.readFloatLE(i + j))) throw new Error('Non-finite STL coordinate.');
  }
  return { stl, triangles, dimensions_mm: new Box3().setFromObject(root).getSize(new Vector3()).toArray() };
}

async function saveJson(path, value) {
  await writeFile(path + '.tmp', JSON.stringify(value, null, 2) + '\n');
  await rename(path + '.tmp', path);
}

export async function main(args = process.argv.slice(2)) {
  const { values: opts, positionals } = parseArgs({ args, allowPositionals: true, options: {
    out: { type: 'string' }, 'height-mm': { type: 'string', default: '100' },
    timeout: { type: 'string', default: '300' }, 'poll-ms': { type: 'string', default: '1000' },
    'geometry-only': { type: 'boolean', default: false }, profile: { type: 'string' }, 'task-id': { type: 'string' }, glb: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (opts.help) { console.log(HELP); return; }
  if (positionals.length + Number(!!opts['task-id']) + Number(!!opts.glb) !== 1) throw new Error(HELP);
  const height = Number(opts['height-mm']), timeoutMs = Number(opts.timeout) * 1000, pollMs = Number(opts['poll-ms']);
  if (![height, timeoutMs, pollMs].every(n => Number.isFinite(n) && n > 0) || pollMs < 500 || timeoutMs > 2147483647) throw new Error('Invalid height, timeout, or poll interval (minimum 500ms).');
  if (opts['task-id'] && !/^[a-zA-Z0-9_-]+$/.test(opts['task-id'])) throw new Error('Invalid task ID.');
  if (opts.profile) process.env.TRIPO_PROFILE = opts.profile;
  const started = performance.now();
  const input = positionals[0] && resolve(positionals[0]);
  let imageBytes, imageType;
  if (input) {
    imageType = ({ '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' })[extname(input).toLowerCase()];
    if (!imageType) throw new Error('Use a PNG, JPEG, or WebP image.');
    const info = await stat(input);
    if (!info.isFile() || !info.size || info.size > 10 * 1024 * 1024) throw new Error('Image must be a nonempty file up to 10 MiB.');
    imageBytes = await readFile(input);
  }
  let glbBytes = opts.glb ? await readFile(resolve(opts.glb)) : null;
  const api = opts.glb ? null : makeApi(await credentials());
  const out = resolve(opts.out || join('tripo-output', `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`));
  if (input) {
    await mkdir(dirname(out), { recursive: true });
    await mkdir(out); // Refuse an existing folder before incurring any charge.
  } else await mkdir(out, { recursive: true });
  const reportPath = join(out, 'run.json');
  const report = { started_at: new Date().toISOString(), mode: input ? 'generate' : opts.glb ? 'offline' : 'resume', input, model: input ? MODEL : undefined, height_mm: height, appearance: opts['geometry-only'] ? 'geometry' : 'color', timings_ms: {} };
  await saveJson(reportPath, report);
  try {
    let taskId = opts['task-id'];
    if (input) {
      console.error(`Uploading ${basename(input)}; one paid ${MODEL} generation will be submitted.`);
      let stage = performance.now();
      const form = new FormData();
      form.append('file', new Blob([imageBytes], { type: `image/${imageType}` }), basename(input));
      const uploaded = await api('/upload/sts', { method: 'POST', body: form });
      if (!uploaded.image_token) throw new Error('Upload returned no image token.');
      report.timings_ms.upload = performance.now() - stage;
      const payload = generationPayload(uploaded.image_token, imageType, { color: !opts['geometry-only'] });
      await saveJson(join(out, 'request.json'), payload);
      report.status = 'submitting';
      await saveJson(reportPath, report);
      stage = performance.now();
      const submitted = await api('/task', { method: 'POST', body: payload });
      taskId = submitted.task_id;
      if (!taskId) throw new Error('Submission returned no task ID; check Tripo history before retrying.');
      console.error(`Task: ${taskId} (resume with --task-id ${taskId})`);
      report.task_id = taskId;
      report.timings_ms.submit = performance.now() - stage;
      report.status = 'submitted';
      await saveJson(reportPath, report);
    }
    if (!glbBytes) {
      report.task_id = taskId;
      await saveJson(reportPath, report);
      let stage = performance.now(), last;
      const task = await waitForTask(api, taskId, { timeoutMs, pollMs, onProgress(task) {
        const label = `${task.status} ${task.progress ?? '?'}%`;
        if (label !== last) console.error(label);
        last = label;
      } });
      report.timings_ms.wait = performance.now() - stage;
      report.credits = task.consumed_credit ?? task.credits_consumed;
      report.model = task.input?.model_version;
      // Signed URLs stay out of the report; resume refreshes them from the API.
      const { url, field } = modelArtifact(task, { color: !opts['geometry-only'] });
      report.artifactField = field;
      stage = performance.now();
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status}); resume the same task.`);
      glbBytes = Buffer.from(await response.arrayBuffer());
      report.timings_ms.download = performance.now() - stage;
    }
    const stage = performance.now();
    // Preserve the downloaded mesh for offline recovery if conversion fails.
    report.colorInfo = inspectGlb(glbBytes, { requireColor: Boolean(input) && !opts['geometry-only'] });
    await writeFile(join(out, 'model.glb'), glbBytes);
    const converted = await convertGlb(glbBytes, height);
    await writeFile(join(out, 'model.stl'), converted.stl);
    report.timings_ms.convert_and_write = performance.now() - stage;
    Object.assign(report, { status: 'success', triangles: converted.triangles, dimensions_mm: converted.dimensions_mm, stl_bytes: converted.stl.length });
    report.timings_ms.total = performance.now() - started;
    await saveJson(reportPath, report);
    console.log(JSON.stringify({ ...report, glb: join(out, 'model.glb'), stl: join(out, 'model.stl'), report: reportPath }, null, 2));
  } catch (error) {
    report.failed_stage = report.status;
    report.status = 'error';
    report.error = error.message;
    report.timings_ms.total = performance.now() - started;
    await saveJson(reportPath, report);
    if (report.task_id) console.error(`Resume without regenerating: npm run image:stl -- --task-id ${report.task_id}`);
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
