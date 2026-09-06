// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { createRequire } from 'node:module';
import { afterEach, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const { PNG } = createRequire(import.meta.url)('pngjs');
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function sketchPng(kind: 'sketch' | 'opaque' | 'blank') {
  const png = new PNG({ width: 8, height: 8 });
  png.data.fill(0);
  if (kind === 'opaque') png.data.fill(255);
  if (kind === 'sketch') {
    for (let y = 2; y < 6; y++) {
      const offset = (y * 8 + 4) * 4;
      png.data.set([255, 84, 136, 255], offset);
    }
  }
  return PNG.sync.write(png);
}

test('fal receives exactly one inline transparent sketch and the complete description', async () => {
  const t = convexTest(schema, modules);
  const bytes = sketchPng('sketch');
  const sketchStorageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: 'image/png' })));
  const id = await t.run((ctx) => ctx.db.insert('assets', { prompt: 'fixture', model: 'fixture', status: 'generating' }));
  const description = 'A blue ceramic pot.\nPreserve the three drainage holes, gold rim, and ribbed sides.';
  vi.stubEnv('FAL_KEY', 'test-key');
  // Stop at the external request boundary; no paid image or 3D jobs are created.
  const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(t.action(internal.sketch.run, { id, sketchStorageId, description })).rejects.toThrow('Provider HTTP 500');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://queue.fal.run/fal-ai/flux-2/klein/9b/edit');
  const payload = JSON.parse(options.body as string);
  expect(payload.image_urls).toEqual([`data:image/png;base64,${bytes.toString('base64')}`]);
  expect(payload.prompt).toContain('sketch on a transparent background in image 1');
  expect(payload.prompt).toContain('User request: ' + description);
  expect(payload.prompt).not.toContain('Image 2');
  expect(payload.prompt).not.toContain('annotated scene');
  const sent = PNG.sync.read(Buffer.from(payload.image_urls[0].split(',')[1], 'base64'));
  expect(sent.data[3]).toBe(0);
  expect(sent.data[(2 * 8 + 4) * 4 + 3]).toBe(255);
});

test.each(['opaque', 'blank'] as const)('rejects a %s PNG before contacting the image model', async (kind) => {
  const t = convexTest(schema, modules);
  const sketchStorageId = await t.run((ctx) => ctx.storage.store(new Blob([sketchPng(kind)], { type: 'image/png' })));
  const id = await t.run((ctx) => ctx.db.insert('assets', { prompt: 'fixture', model: 'fixture', status: 'generating' }));
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(t.action(internal.sketch.run, { id, sketchStorageId, description: 'A pot' })).rejects.toThrow('visible strokes on a transparent background');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('Qwen gets the background but Klein gets only the sketch and the saved contextual prompt', async () => {
  const t = convexTest(schema, modules);
  const sketch = sketchPng('sketch');
  const background = sketchPng('opaque');
  const sketchStorageId = await t.run((ctx) => ctx.storage.store(new Blob([sketch], { type: 'image/png' })));
  const backgroundStorageId = await t.run((ctx) => ctx.storage.store(new Blob([background], { type: 'image/png' })));
  const id = await t.run((ctx) => ctx.db.insert('assets', { prompt: 'fixture', model: 'fixture', status: 'generating', promptMode: 'context' }));
  const description = 'Make a holder that matches this table, with THREE holes.\nKeep the front open.';
  const bounds = { left: 0.2, top: 0.3, right: 0.6, bottom: 0.7 };
  vi.stubEnv('FAL_KEY', 'test-key');
  vi.stubEnv('SKETCH_PROMPT_MODEL', 'qwen/qwen3.8-27b');
  const rewritten = 'An oak holder with three holes and an open front, isolated on white.';
  const requests: { url: string; payload?: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    requests.push({ url, payload: options.body ? JSON.parse(options.body as string) : undefined });
    if (url.endsWith('/openrouter/router/vision')) return Response.json({ request_id: 'qwen-test', status_url: 'https://queue.fal.run/status/qwen-test', response_url: 'https://queue.fal.run/result/qwen-test' });
    if (url.includes('/status/')) return Response.json({ status: 'COMPLETED' });
    if (url.includes('/result/')) return Response.json({ output: rewritten });
    return new Response('{}', { status: 500 }); // stop before paid image generation
  }));

  await expect(t.action(internal.sketch.run, { id, sketchStorageId, backgroundStorageId, sketchBounds: bounds, description })).rejects.toThrow('Provider HTTP 500');
  const vision = requests[0];
  expect(vision.url).toBe('https://queue.fal.run/openrouter/router/vision');
  expect(vision.payload.model).toBe('qwen/qwen3.8-27b');
  expect(vision.payload.image_urls).toEqual([`data:image/png;base64,${sketch.toString('base64')}`, `data:image/png;base64,${background.toString('base64')}`]);
  expect(vision.payload.prompt).toContain(description);
  expect(JSON.parse(vision.payload.prompt.match(/\{[^}]+\}/)![0])).toEqual(bounds);
  expect(vision.payload.enable_web_search).toBe(false);
  const klein = requests.at(-1)!;
  expect(klein.url).toBe('https://queue.fal.run/fal-ai/flux-2/klein/9b/edit');
  expect(klein.payload.image_urls).toEqual([vision.payload.image_urls[0]]);
  expect(klein.payload.prompt).toContain(rewritten);
  expect(klein.payload.prompt).toContain(description);
  const asset = await t.run((ctx) => ctx.db.get(id));
  expect(asset).toMatchObject({ imagePrompt: klein.payload.prompt, promptRequestId: 'qwen-test', promptModel: 'qwen/qwen3.8-27b' });
  expect(asset?.promptDurationMs).toBeGreaterThanOrEqual(0);
});

test.each(['', '<think>reasoning only</think>', 'x'.repeat(8001)])('invalid VLM output stops before Klein', async (output) => {
  const t = convexTest(schema, modules);
  const sketchStorageId = await t.run((ctx) => ctx.storage.store(new Blob([sketchPng('sketch')])));
  const backgroundStorageId = await t.run((ctx) => ctx.storage.store(new Blob([sketchPng('opaque')])));
  const id = await t.run((ctx) => ctx.db.insert('assets', { prompt: 'fixture', model: 'fixture', status: 'generating' }));
  vi.stubEnv('FAL_KEY', 'test-key');
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    if (url.endsWith('/vision')) return Response.json({ request_id: 'bad-output', status_url: 'https://queue.fal.run/status/bad-output', response_url: 'https://queue.fal.run/result/bad-output' });
    if (url.includes('/status/')) return Response.json({ status: 'COMPLETED' });
    return Response.json({ output });
  }));
  await expect(t.action(internal.sketch.run, { id, sketchStorageId, backgroundStorageId, sketchBounds: { left: 0, top: 0, right: 1, bottom: 1 }, description: 'A pot' })).rejects.toThrow('invalid prompt');
  expect(urls.some((url) => url.includes('klein') || url.includes('tripo'))).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe('failed');
});
