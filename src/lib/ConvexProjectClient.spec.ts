// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import type { ConvexReactClient } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { zipSync, strToU8 } from 'fflate';
import { ConvexProjectClient, DEMO_JOB, DEMO_WORLD_ID } from './ConvexProjectClient';
import { worldTransform } from './worldTransform';

afterEach(() => vi.unstubAllGlobals());

function backend(existing = false) {
  const imports: unknown[] = [];
  const query = vi.fn(async () => existing ? { _id: 'convex-world', splatUrl: 'https://storage.test/splat' } : null);
  const mutation = vi.fn(async (reference, args) => {
    if (getFunctionName(reference) === 'worlds:generateUploadUrl') return 'https://storage.test/upload';
    imports.push(args);
    return 'convex-world';
  });
  return { client: new ConvexProjectClient({ query, mutation } as unknown as ConvexReactClient), imports, query, mutation };
}

test('an existing hosted demo needs no local files or upload', async () => {
  const { client, mutation } = backend(true);
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await client.ensureDemoWorld()).toBe('convex-world');
  expect(fetcher).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
});

test('concurrent demo entries import one manifest with the original metadata', async () => {
  const { client, imports } = backend();
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') return Response.json({ storageId: 'storage-id' });
    if (url.endsWith('manifest.json')) return Response.json({
      worldId: DEMO_WORLD_ID, displayName: 'Demo room',
      assets: { 'splat-500k': { path: 'assets/splat-500k.spz' }, collider: { path: 'assets/collider.glb' } },
      coordinates: { semantics: { metric_scale_factor: 2, ground_plane_offset: 3 } },
    });
    return new Response('asset');
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await Promise.all([client.ensureDemoWorld(), client.ensureDemoWorld()])).toEqual(['convex-world', 'convex-world']);
  expect(imports).toHaveLength(1);
  expect(imports[0]).toMatchObject({ worldId: DEMO_WORLD_ID, splatFileName: 'splat-500k.spz', metricScale: 2, groundOffset: 3, reuseExisting: true });
  expect(fetcher.mock.calls.filter(([url]) => url === `/world-assets/${DEMO_JOB}/manifest.json`)).toHaveLength(1);
  expect(fetcher.mock.calls.every(([url]) => !url.includes('worldlabs.ai'))).toBe(true);
});

test('ZIP import uses the existing parser and the same Convex import contract', async () => {
  const { client, imports } = backend();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ storageId: 'storage-id' })));
  const archive = zipSync({
    'manifest.json': strToU8(JSON.stringify({ displayName: 'ZIP room', worldId: 'zip-world', preferredSplat: 'splat-500k', assets: { 'splat-500k': { path: 'assets/splat-500k.spz' } } })),
    'assets/splat-500k.spz': strToU8('splat'),
  });
  await client.importZip(new File([archive], 'world.zip'));
  expect(imports[0]).toMatchObject({ name: 'ZIP room', worldId: 'zip-world', splatFileName: 'splat-500k.spz' });
});

test('failed saved asset reads do not register a ready world and can retry', async () => {
  const { client, imports } = backend();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  await expect(client.ensureDemoWorld()).rejects.toThrow('saved room');
  await expect(client.ensureDemoWorld()).rejects.toThrow('saved room');
  expect(imports).toEqual([]);
});

test('Convex viewer applies the same scale and ground offset as the CLI manifest', () => {
  expect(worldTransform(2, 3)).toEqual({ scale: [2, -2, -2], position: [0, 3, 0] });
});
