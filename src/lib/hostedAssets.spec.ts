import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostedModelUrl, hostedRoom } from './hostedAssets';
import models from './prebakedAssetManifest.json';
import room from '../../public/room/manifest.json';

describe('production demo assets', () => {
  it('ships byte-identical copies of all curated models and previews', () => {
    for (const model of models) for (const file of model.files) {
      expect(hostedModelUrl(file.sourceUrl)).toBe(file.path);
      const bytes = readFileSync(new URL(`../../public${file.path}`, import.meta.url));
      expect(bytes.length).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      if (file.path.endsWith('.glb')) {
        expect(bytes.toString('ascii', 0, 4)).toBe('glTF');
        expect(bytes.readUInt32LE(4)).toBe(2);
      }
    }
  });

  it('keeps live generations on their original storage URLs', () => {
    const url = 'https://vivid-sparrow-412.convex.cloud/api/storage/new-live-model';
    expect(hostedModelUrl(url)).toBe(url);
    expect(hostedModelUrl(null)).toBeNull();
  });

  it('serves only the matching full-resolution room from Vercel', () => {
    const world = { worldId: room.worldId, splatFileName: 'splat-full_res.spz', splatUrl: 'https://original/room', colliderUrl: 'https://original/collider' };
    expect(hostedRoom(world)).toMatchObject({ splatUrl: '/room/assets/splat-full_res.spz', colliderUrl: '/room/assets/collider.glb' });
    const other = { ...world, worldId: 'another-world' };
    expect(hostedRoom(other)).toBe(other);
    const lowerResolution = { ...world, splatFileName: 'splat-500k.spz' };
    expect(hostedRoom(lowerResolution)).toBe(lowerResolution);
  });
});
