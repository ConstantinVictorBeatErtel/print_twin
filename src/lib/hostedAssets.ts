import room from '../../public/room/manifest.json';
import models from './prebakedAssetManifest.json';

/** Curated files from demo-prebaked-objects are bundled in Vercel's static output. */
const bundled = new Map(models.flatMap(model => model.files.map(file => [file.sourceUrl, file.path] as const)));
export function hostedModelUrl(url: string | null): string | null {
  return url ? bundled.get(url) ?? url : null;
}

export function hostedRoom<T extends { worldId?: string; splatFileName?: string; splatUrl: string | null; colliderUrl: string | null }>(world: T): T {
  if (world.worldId !== room.worldId || world.splatFileName !== 'splat-full_res.spz') return world;
  return { ...world, splatUrl: '/room/assets/splat-full_res.spz', colliderUrl: '/room/assets/collider.glb' };
}
