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
