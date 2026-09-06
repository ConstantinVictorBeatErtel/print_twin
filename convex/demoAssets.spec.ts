/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { matchDemoObject } from './demoAssets';

const modules = import.meta.glob('./**/*.ts');

test('the demo keywords pick their object, and the first one named wins', () => {
  expect(matchDemoObject('Draw a couch with the same vibe as the ones on stage')?.name).toBe('couch');
  expect(matchDemoObject('a big walnut dinner table here')?.name).toBe('table');
  expect(matchDemoObject('a colorful flower vase in the corner')?.name).toBe('flower vase');
  expect(matchDemoObject('put a dinosaur in the corner')?.name).toBe('dinosaur');
  expect(matchDemoObject('a vase standing on the table')?.name).toBe('flower vase');
  expect(matchDemoObject('a stepstool by the door')).toBeNull();
});

/** The whole point of the stand-in: no keys, no fal, no Tripo — and a real mesh at ten seconds. */
test('a demo sketch replays the stages and adopts the pre-generated mesh', async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const glbStorageId = await t.run((ctx) => ctx.storage.store(new Blob(['glb'])));
  const source = await t.run((ctx) => ctx.db.insert('assets', {
    prompt: 'Draw a couch like the ones on stage', description: 'Draw a couch like the ones on stage',
    model: 'P1-20260311', status: 'ready' as const, stage: 'done' as const, glbStorageId, hasSurfaceColor: true,
  }));
  const imageStorageId = await t.run((ctx) => ctx.storage.store(new Blob(['png'])));

  const id = await t.mutation(api.assets.startSketch, { imageStorageId, description: 'add a couch here' });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ status: 'generating', stage: 'image' });

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    status: 'ready', stage: 'done', progress: 100, glbStorageId,
  });
  expect(id).not.toBe(source);
  vi.useRealTimers();
});

test('?live=1 refuses to fake it, and says which key is missing', async () => {
  vi.stubEnv('FAL_KEY', '');
  const t = convexTest(schema, modules);
  const imageStorageId = await t.run((ctx) => ctx.storage.store(new Blob(['png'])));
  await expect(t.mutation(api.assets.startSketch, { imageStorageId, description: 'add a couch here', live: true }))
    .rejects.toThrow('FAL_KEY');
  vi.unstubAllEnvs();
});
