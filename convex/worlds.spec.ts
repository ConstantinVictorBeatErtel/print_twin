/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

test('local imports reuse the provider world and preserve ZIP metadata', async () => {
  const t = convexTest(schema, modules);
  const splatStorageId = await t.run((ctx) => ctx.storage.store(new Blob(['splat'])));
  const input = { name: 'Demo', worldId: 'saved-world', splatStorageId, splatFileName: 'splat-500k.spz', metricScale: 2, groundOffset: 3, reuseExisting: true };
  const id = await t.mutation(api.worlds.importUploaded, input);
  expect(await t.mutation(api.worlds.importUploaded, input)).toBe(id);
  const worlds = await t.query(api.worlds.list, {});
  expect(worlds).toHaveLength(1);
  expect(worlds[0]).toMatchObject({ _id: id, metricScale: 2, groundOffset: 3, splatFileName: 'splat-500k.spz', status: 'ready' });
  expect((await t.query(api.worlds.byWorldId, { worldId: 'saved-world' }))?._id).toBe(id);
});

test('an imported world uses the existing placement and multiplayer tables', async () => {
  const t = convexTest(schema, modules);
  const splatStorageId = await t.run((ctx) => ctx.storage.store(new Blob(['splat'])));
  const room = await t.mutation(api.worlds.importUploaded, { name: 'Demo', splatStorageId });
  const assetId = await t.run((ctx) => ctx.db.insert('assets', { prompt: 'fixture', model: 'fixture', status: 'ready' }));
  await t.mutation(api.assets.place, { room, assetId, position: [1, 0, 2] });
  expect(await t.query(api.assets.placementsInRoom, { room })).toHaveLength(1);
  expect(await t.query(api.assets.placementsInRoom, { room: 'different-world' })).toHaveLength(0);
  for (const sessionId of ['browser-a', 'browser-b']) {
    await t.mutation(api.players.join, { room, sessionId, name: sessionId, color: '#fff' });
  }
  expect(await t.query(api.players.inRoom, { room })).toHaveLength(2);
  expect(await t.query(api.players.inRoom, { room: 'different-world' })).toHaveLength(0);
});
