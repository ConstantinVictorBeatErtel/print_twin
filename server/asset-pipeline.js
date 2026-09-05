import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeImage } from './image-api.js';
import { runWorkflow } from '../scripts/image-benchmark/providers.mjs';
import { credentials, makeApi, generationPayload, waitForTask, convertGlb, MODEL } from '../scripts/image-to-stl.mjs';

import { inspectGlb, modelArtifact } from '../scripts/glb-assets.mjs';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });
const labels = { image: 'Creating object image', background: 'Removing background', mesh: 'Building shape and color', export: 'Exporting print copy', done: 'Color GLB ready' };

export function validateAssetInput(body) {
  if (!body || !ID.test(body.id)) throw fail(400, 'A valid request ID is required.');
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 8000) throw fail(400, 'Enter a description between 1 and 8,000 characters.');
  const heightMm = Number(body.heightMm ?? 100);
  if (!Number.isFinite(heightMm) || heightMm < 10 || heightMm > 1000) throw fail(400, 'Choose a height from 10 to 1,000 mm.');
  const imageUrls = [body.image];
  decodeImage(body.image, 'Drawing');
  if (body.cleanImage) { decodeImage(body.cleanImage, 'Clean view'); imageUrls.push(body.cleanImage); }
  if (body.reference) { decodeImage(body.reference, 'Reference'); imageUrls.push(body.reference); }
  const prompt = [
    'Create a polished isolated object from the annotated scene in image 1 and the user description.',
    'The colored drawing marks identify the object or desired outline. Interpret those marks as instructions; remove all drawing ink from the result.',
    body.cleanImage ? 'Image 2 shows the same scene without drawing marks for context.' : '',
    body.reference ? `Image ${imageUrls.length} is the design reference; follow its shape and style.` : '',
    'Preserve the requested colors, surface patterns and material appearance in the object; drawing ink color is only an annotation unless requested.',
    'Show only the requested object, complete and centered, in a clear three-quarter product view with visible depth and padding.',
    'Remove the room, plants unless requested, surrounding objects, text, UI, cast shadows and ground plane. Use a plain white background for clean extraction. Preserve requested holes, openings and geometric features.',
    'User request: ' + body.description.trim(),
  ].filter(Boolean).join('\n');
  return { id: body.id, description: body.description.trim(), heightMm, imageUrls, prompt };
}

export function createAssetPipeline({ outputRoot, getEnv = () => process.env, fetchImpl = fetch,
  imageRunner = runWorkflow, getCredentials = credentials, convert = convertGlb, pollMs = 500 } = {}) {
  let active = null;
  const jobs = new Map();
  const folder = id => join(outputRoot, id);
  async function save(job) {
    job.updatedAt = new Date().toISOString();
    const file = join(folder(job.id), 'job.json');
    await writeFile(file + '.tmp', JSON.stringify(job, null, 2));
    await rename(file + '.tmp', file);
  }
  async function get(id) {
    if (jobs.has(id)) return jobs.get(id);
    try {
      const job = JSON.parse(await readFile(join(folder(id), 'job.json'), 'utf8'));
      if (job.status === 'running') {
        job.status = 'interrupted';
        job.error = job.taskId ? 'Server restarted. Resume the saved 3D task.' : 'Server restarted. Check provider task history before creating again.';
      }
      jobs.set(id, job);
      return job;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  const snapshot = job => ({ ...job, canResume: ['failed', 'interrupted'].includes(job.status) && Boolean(job.taskId),
    imageUrl: job.imageReady ? `/api/asset-jobs/${job.id}/object.png` : null,
    stlUrl: job.status === 'done' ? `/api/asset-jobs/${job.id}/model.stl` : null,
    glbUrl: job.meshReady ? `/api/asset-jobs/${job.id}/model.glb` : null,
  });

  async function execute(job, input, tripo, env) {
    const start = performance.now();
    const previouslyElapsed = job.totalMs || 0;
    let stageStart = performance.now();
    const stage = name => { job.stage = name; job.label = labels[name]; job.stageStartedAt = new Date().toISOString(); stageStart = performance.now(); };
    const finishStage = name => { job.timings[name] = performance.now() - stageStart; };
    try {
      if (input) {
        stage('image');
        const imageStart = performance.now();
        const result = await imageRunner('klein-9b', input.prompt, { env, fetchImpl, imageUrls: input.imageUrls,
          onProgress(name) { if (name === 'backgroundRemoval') stage('background'); },
        });
        job.imageTimings = result.stages;
        job.imageRequests = result.requests;
        if (result.status !== 'ok') throw new Error(result.error || 'No usable transparent image returned. 3D generation was not started.');
        await writeFile(join(folder(job.id), 'object.png'), result.bytes);
        job.imageReady = true;
        job.alpha = result.alpha;
        job.timings.image = performance.now() - imageStart;
        await save(job);
      }
      const api = makeApi(tripo, fetchImpl);
      if (!job.taskId) {
        stage('mesh');
        job.label = 'Uploading object to Tripo';
        const form = new FormData();
        form.append('file', new Blob([await readFile(join(folder(job.id), 'object.png'))], { type: 'image/png' }), 'object.png');
        const uploaded = await api('/upload/sts', { method: 'POST', body: form });
        if (!uploaded.image_token) throw new Error('Tripo upload returned no image token.');
        job.submission = 'pending';
        job.label = job.appearance === 'color' ? 'Building shape and color' : 'Building 3D shape';
        await save(job);
        const submitted = await api('/task', { method: 'POST', body: generationPayload(uploaded.image_token, 'png', { color: job.appearance === 'color' }) });
        if (!submitted.task_id) throw new Error('No task ID returned. Check Tripo history before creating again.');
        job.taskId = submitted.task_id;
        job.submission = 'submitted';
        await save(job); // Persist before polling; refresh/reconnect never resubmits.
      } else stage('mesh');
      let glb;
      if (job.meshReady) glb = await readFile(join(folder(job.id), 'model.glb'));
      else {
        const task = await waitForTask(api, job.taskId, { timeoutMs: 300000, pollMs,
          onProgress(task) { job.progress = task.progress ?? null; },
        });
        job.credits = task.consumed_credit ?? task.credits_consumed;
        const { url, field } = modelArtifact(task, { color: job.appearance === 'color' });
        job.artifactField = field;
        job.label = 'Downloading GLB';
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error('Mesh download failed. Resume the saved task.');
        glb = Buffer.from(await response.arrayBuffer());
        job.colorInfo = inspectGlb(glb, { requireColor: job.appearance === 'color' });
        await writeFile(join(folder(job.id), 'model.glb'), glb);
        job.meshReady = true;
        await save(job);
      }
      finishStage('mesh');
      stage('export');
      const converted = await convert(glb, job.heightMm);
      await writeFile(join(folder(job.id), 'model.stl'), converted.stl);
      finishStage('export');
      Object.assign(job, { status: 'done', stage: 'done', label: job.appearance === 'color' ? labels.done : 'GLB and STL ready', triangles: converted.triangles,
        dimensionsMm: converted.dimensions_mm, stlBytes: converted.stl.length, progress: 100 });
    } catch (error) {
      job.status = 'failed';
      job.error = String(error.message).split(tripo.key).join('[redacted]').split(env.FAL_KEY || '\u0000').join('[redacted]');
    } finally {
      job.totalMs = previouslyElapsed + performance.now() - start;
      try { await save(job); } finally { active = null; }
    }
  }

  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Expected JSON.');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 36 * 1024 * 1024) throw fail(413, 'Images are too large.'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks)); } catch { throw fail(400, 'Invalid JSON.'); }
  }

  return async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (path !== '/api/asset-status' && !path?.startsWith('/api/asset-jobs')) return next();
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin))) throw fail(403, 'Use the pipeline from this viewer.');
      const env = getEnv();
      if (path === '/api/asset-status' && req.method === 'GET') {
        let tripo = false;
        try { tripo = Boolean((await getCredentials(env)).key); } catch {}
        send(200, { fal: Boolean(env.FAL_KEY?.trim()), tripo, configured: Boolean(env.FAL_KEY?.trim()) && tripo, activeJob: active }); return;
      }
      if (path === '/api/asset-jobs' && req.method === 'POST') {
        const input = validateAssetInput(await body(req));
        const previous = await get(input.id);
        if (previous) { send(200, snapshot(previous)); return; }
        if (active) throw fail(409, 'An asset is already building. Reconnect to it before starting another.');
        if (!env.FAL_KEY?.trim()) throw fail(503, 'Open Settings and add your fal API key.');
        const tripo = await getCredentials(env).catch(() => { throw fail(503, 'Open Settings and add your Tripo API key, or sign in with the Tripo CLI.'); });
        // Recheck after credential I/O so concurrent POSTs cannot both start paid work.
        if (active) throw fail(409, 'An asset is already building.');
        active = input.id;
        try { await mkdir(folder(input.id), { recursive: true }); } catch (error) { active = null; throw error; }
        const job = { id: input.id, description: input.description, heightMm: input.heightMm, model: MODEL, appearance: 'color', primaryFormat: 'glb',
          createdAt: new Date().toISOString(), status: 'running', stage: 'image', label: labels.image, timings: {} };
        jobs.set(job.id, job);
        try { await save(job); } catch (error) { active = null; throw error; }
        void execute(job, input, tripo, env).catch(() => { job.status = 'failed'; job.error = 'Could not save the local job report.'; });
        send(202, snapshot(job)); return;
      }
      const match = /^\/api\/asset-jobs\/([^/]+)(?:\/(resume|object\.png|model\.stl|model\.glb))?$/.exec(path);
      if (!match || !ID.test(match[1])) throw fail(404, 'Asset not found.');
      const job = await get(match[1]);
      if (!job) throw fail(404, 'Asset not found.');
      if (!match[2] && req.method === 'GET') { send(200, snapshot(job)); return; }
      if (match[2] === 'resume' && req.method === 'POST') {
        if (active) throw fail(409, 'An asset is already building.');
        if (!snapshot(job).canResume) throw fail(400, 'There is no saved 3D task to resume.');
        const tripo = await getCredentials(env);
        if (active) throw fail(409, 'An asset is already building.');
        active = job.id; job.status = 'running'; delete job.error;
        void execute(job, null, tripo, env).catch(() => { job.status = 'failed'; job.error = 'Could not save the local job report.'; });
        send(202, snapshot(job)); return;
      }
      const ready = { 'object.png': job.imageReady, 'model.glb': job.meshReady, 'model.stl': job.status === 'done' };
      if (req.method !== 'GET' || !ready[match[2]]) throw fail(404, 'This file is not ready yet.');
      const bytes = await readFile(join(folder(job.id), match[2]));
      res.writeHead(200, { 'Content-Type': { 'object.png': 'image/png', 'model.stl': 'model/stl', 'model.glb': 'model/gltf-binary' }[match[2]],
        'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      res.end(bytes);
    } catch (error) { if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : 'The local asset pipeline could not process this request.' }); }
  };
}
