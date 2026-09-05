import { setTimeout as sleep } from 'node:timers/promises';
import { PNG } from 'pngjs';

export const WORKFLOWS = {
  'ideogram-turbo': { name: 'Ideogram 4 Turbo · transparent', key: 'IDEOGRAM_API_KEY', endpoint: 'https://api.ideogram.ai/v1/ideogram-v4/generate-transparent' },
  'ideogram-instant': { name: 'Ideogram 4 Instant + BiRefNet', key: 'FAL_KEY', endpoint: 'ideogram/v4/instant' },
  'klein-9b': { name: 'FLUX.2 Klein 9B + BiRefNet', key: 'FAL_KEY', endpoint: 'fal-ai/flux-2/klein/9b' },
};

export function missingKeys(ids, env) {
  return [...new Set(ids.map(id => WORKFLOWS[id].key))].filter(key => !env[key]?.trim());
}

export function inspectPng(bytes) {
  const png = PNG.sync.read(bytes, { checkCRC: true });
  let clear = 0, partial = 0, visible = 0;
  for (let i = 3; i < png.data.length; i += 4) {
    const alpha = png.data[i];
    if (alpha === 0) clear++;
    if (alpha > 0 && alpha < 255) partial++;
    if (alpha > 0) visible++;
  }
  const pixels = png.width * png.height;
  return { width: png.width, height: png.height, transparentPixels: clear, partialAlphaPixels: partial,
    transparentPercent: 100 * clear / pixels, visiblePercent: 100 * visible / pixels,
    // A blank PNG or a uniformly translucent image is not a successful cutout.
    validCutout: clear > 0 && visible > 0 };
}

function queueUrl(value) {
  const url = new URL(value);
  if (url.origin !== 'https://queue.fal.run' || url.username || url.password) throw new Error('Unexpected fal queue URL.');
  return url.href;
}

export async function runWorkflow(id, prompt, { env, fetchImpl = fetch, timeoutMs = 180_000, pollMs = 250, onProgress = () => {}, imageUrls } = {}) {
  const workflow = WORKFLOWS[id];
  if (!workflow) throw new Error(`Unknown workflow: ${id}`);
  if (!prompt?.trim()) throw new Error('A prompt is required.');
  if (imageUrls && (id !== 'klein-9b' || !Array.isArray(imageUrls) || !imageUrls.length || imageUrls.length > 4)) throw new Error('Klein editing requires one to four images.');
  if (missingKeys([id], env).length) throw new Error(`Missing ${workflow.key}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  const stages = [];
  const requests = [];
  const key = env[workflow.key].trim();
  const signal = controller.signal;
  const json = async (url, options = {}) => {
    const response = await fetchImpl(url, { ...options, signal, redirect: 'error' });
    if (!response.ok) {
      // Do not echo provider bodies: they can contain credentials, prompts or signed URLs.
      throw new Error(`Provider HTTP ${response.status}${[401, 403].includes(response.status) ? ': check API key and model access' : response.status === 429 ? ': check billing or rate limits' : ''}`);
    }
    return response.json();
  };
  const timed = async (name, fn) => {
    onProgress(name);
    const t = performance.now();
    try { return await fn(); }
    finally { stages.push({ name, ms: performance.now() - t }); }
  };
  const fal = async (endpoint, input) => {
    const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json', 'X-Fal-No-Retry': '1' };
    const job = await json(`https://queue.fal.run/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(input) });
    const statusUrl = queueUrl(job.status_url);
    const responseUrl = queueUrl(job.response_url);
    const record = { endpoint, requestId: job.request_id, inferenceMs: null };
    requests.push(record);
    try {
      while (true) {
        const status = await json(statusUrl, { headers });
        if (status.status === 'COMPLETED') {
          if (status.error) throw new Error('fal job failed; inspect the request ID in the fal dashboard.');
          if (typeof status.metrics?.inference_time === 'number') record.inferenceMs = status.metrics.inference_time * 1000;
          return await json(responseUrl, { headers });
        }
        if (!['IN_QUEUE', 'IN_PROGRESS'].includes(status.status)) throw new Error('Unexpected fal job status.');
        await sleep(pollMs, undefined, { signal });
      }
    } catch (error) {
      // Best effort cancellation prevents abandoned queued work after a timeout.
      if (job.cancel_url) {
        try { await fetchImpl(queueUrl(job.cancel_url), { method: 'PUT', headers, redirect: 'error', signal: AbortSignal.timeout(5000) }); } catch {}
      }
      throw error;
    }
  };
  try {
    let imageUrl;
    if (id === 'ideogram-turbo') {
      const form = new FormData();
      form.set('text_prompt', prompt);
      form.set('aspect_ratio', '1x1');
      form.set('output_resolution', '1K');
      form.set('rendering_speed', 'TURBO');
      const result = await timed('generation', () => json(workflow.endpoint, { method: 'POST', headers: { 'Api-Key': key }, body: form }));
      if (result.data?.[0]?.is_image_safe === false) throw new Error('Provider safety check did not return an image.');
      imageUrl = result.data?.[0]?.url;
    } else {
      const input = { prompt, image_size: 'square_hd', num_images: 1, output_format: 'png', enable_safety_checker: true };
      if (id === 'ideogram-instant') input.expansion_model = 'Medium';
      else input.num_inference_steps = 4;
      if (imageUrls) input.image_urls = imageUrls;
      const result = await timed('generation', () => fal(workflow.endpoint + (imageUrls ? '/edit' : ''), input));
      if (result.has_nsfw_concepts?.some(Boolean)) throw new Error('Provider safety check did not return an image.');
      imageUrl = result.images?.[0]?.url;
      if (!imageUrl) throw new Error('Generation returned no image.');
      const removed = await timed('backgroundRemoval', () => fal('fal-ai/birefnet', {
        image_url: imageUrl, model: 'General Use (Light)', operating_resolution: '1024x1024',
        refine_foreground: true, output_format: 'png',
      }));
      imageUrl = removed.image?.url;
    }
    if (!imageUrl || new URL(imageUrl).protocol !== 'https:') throw new Error('Provider returned no HTTPS image URL.');
    const bytes = await timed('download', async () => {
      // Downloads use no API authorization headers.
      const response = await fetchImpl(imageUrl, { signal });
      if (!response.ok) throw new Error(`Image download HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    });
    const downloadCompleteMs = performance.now() - started;
    const alpha = await timed('validation', () => inspectPng(bytes));
    return { id, status: alpha.validCutout ? 'ok' : 'invalid-alpha', stages, requests, alpha, bytes,
      downloadCompleteMs, totalMs: performance.now() - started };
  } catch (error) {
    return { id, status: 'failed', stages, requests, totalMs: performance.now() - started,
      error: signal.aborted ? 'Workflow timed out. A running provider job may still be billed.' : error.message.replaceAll(key, '[redacted]') };
  } finally { clearTimeout(timer); }
}

export function summarize(results, ids) {
  return ids.map(id => {
    const rows = results.filter(row => row.id === id);
    const good = rows.filter(row => row.status === 'ok');
    const times = good.map(row => row.totalMs).sort((a, b) => a - b);
    const middle = Math.floor(times.length / 2);
    const median = times.length ? (times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2) : null;
    return { id, attempts: rows.length, validCutouts: good.length,
      failed: rows.filter(row => row.status === 'failed').length,
      invalidAlpha: rows.filter(row => row.status === 'invalid-alpha').length,
      medianMs: median, minMs: times.length ? times[0] : null, maxMs: times.length ? times.at(-1) : null };
  });
}
