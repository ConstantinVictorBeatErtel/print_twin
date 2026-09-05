// World Labs Marble: generate → poll → cache assets in Convex storage.
import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const BASE = "https://api.worldlabs.ai/marble/v1";
const headers = () => ({
  "WLT-Api-Key": process.env.WLT_API_KEY ?? "",
  "Content-Type": "application/json",
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const worlds = await ctx.db.query("worlds").order("desc").collect();
    return Promise.all(
      worlds.map(async (w) => ({
        ...w,
        splatUrl: w.splatStorageId ? await ctx.storage.getUrl(w.splatStorageId) : null,
        colliderUrl: w.colliderStorageId ? await ctx.storage.getUrl(w.colliderStorageId) : null,
        panoUrl: w.panoStorageId ? await ctx.storage.getUrl(w.panoStorageId) : null,
      })),
    );
  },
});

/** Resolve an already imported provider world before uploading its files again. */
export const byWorldId = query({
  args: { worldId: v.string() },
  handler: async (ctx, { worldId }) => {
    const world = await ctx.db.query('worlds').withIndex('by_worldId', (q) => q.eq('worldId', worldId))
      .filter((q) => q.eq(q.field('status'), 'ready')).first();
    return world ? { _id: world._id, splatUrl: world.splatStorageId ? await ctx.storage.getUrl(world.splatStorageId) : null } : null;
  },
});

export const create = internalMutation({
  args: { name: v.string(), prompt: v.string(), model: v.string() },
  handler: (ctx, args) => ctx.db.insert("worlds", { ...args, status: "generating" }),
});

export const update = internalMutation({
  args: {
    id: v.id("worlds"),
    patch: v.object({
      status: v.optional(v.union(v.literal("generating"), v.literal("ready"), v.literal("failed"))),
      worldId: v.optional(v.string()),
      operationId: v.optional(v.string()),
      splatStorageId: v.optional(v.id("_storage")),
      colliderStorageId: v.optional(v.id("_storage")),
      panoStorageId: v.optional(v.id("_storage")),
      spzUrl: v.optional(v.string()),
      metricScale: v.optional(v.number()),
      groundOffset: v.optional(v.number()),
      error: v.optional(v.string()),
    }),
  },
  handler: (ctx, { id, patch }) => ctx.db.patch(id, patch),
});

/**
 * Generate a world from text. Runs as one long action (Marble ~1–5 min; actions get 10 min).
 * Usage from the client: const gen = useAction(api.worlds.generateFromText); gen({ prompt, model: "marble-1.0-draft" })
 */
export const generateFromText = action({
  args: { prompt: v.string(), model: v.optional(v.string()), name: v.optional(v.string()) },
  // Explicit return type: the handler calls internal.worlds.* from this same
  // module, so without it TS hits a circular inference (TS7022/TS7023).
  handler: async (ctx, { prompt, model = "marble-1.0-draft", name }): Promise<Id<"worlds">> => {
    const id = await ctx.runMutation(internal.worlds.create, { name: name ?? prompt.slice(0, 40), prompt, model });
    try {
      const op = await post("worlds:generate", {
        display_name: (name ?? prompt).slice(0, 64),
        model,
        world_prompt: { type: "text", text_prompt: prompt },
      });
      await ctx.runMutation(internal.worlds.update, { id, patch: { operationId: op.operation_id } });

      let opState = op;
      while (!opState.done) {
        await sleep(5000);
        opState = await get(`operations/${op.operation_id}`);
      }
      const worldId: string = opState.response.world_id;
      const world = await get(`worlds/${worldId}`);

      const spzUrl: string = world.assets.splats.spz_urls["500k"] ?? world.assets.splats.spz_urls.full_res;
      const colliderUrl: string | undefined = world.assets.mesh?.collider_mesh_url;
      const panoUrl: string | undefined = world.assets.imagery?.pano_url;
      const meta = world.assets.splats.semantics_metadata ?? {};

      // Cache everything — signed URLs expire and venue Wi-Fi is unreliable.
      const splatStorageId = await ctx.storage.store(await (await fetch(spzUrl)).blob());
      const colliderStorageId = colliderUrl ? await ctx.storage.store(await (await fetch(colliderUrl)).blob()) : undefined;
      const panoStorageId = panoUrl ? await ctx.storage.store(await (await fetch(panoUrl)).blob()) : undefined;

      await ctx.runMutation(internal.worlds.update, {
        id,
        patch: {
          status: "ready", worldId, spzUrl, splatStorageId, colliderStorageId, panoStorageId,
          metricScale: meta.metric_scale_factor, groundOffset: meta.ground_plane_offset,
        },
      });
      return id;
    } catch (e: any) {
      await ctx.runMutation(internal.worlds.update, { id, patch: { status: "failed", error: String(e?.message ?? e) } });
      throw e;
    }
  },
});

/** Short-lived URL the browser POSTs one extracted zip asset to. See src/lib/worldZip.ts. */
export const generateUploadUrl = mutation({
  args: {},
  handler: (ctx) => ctx.storage.generateUploadUrl(),
});

/**
 * Register a world whose assets were unzipped and uploaded by the client
 * (`hackathon-room-full.zip` from scripts/package_room.py, or any zip with a splat
 * plus an optional collider). No provider call, so it works with the venue Wi-Fi down.
 */
export const importUploaded = mutation({
  args: {
    name: v.string(),
    splatStorageId: v.id("_storage"),
    splatFileName: v.optional(v.string()),
    colliderStorageId: v.optional(v.id("_storage")),
    panoStorageId: v.optional(v.id("_storage")),
    worldId: v.optional(v.string()),
    model: v.optional(v.string()),
    prompt: v.optional(v.string()),
    metricScale: v.optional(v.number()),
    groundOffset: v.optional(v.number()),
    reuseExisting: v.optional(v.boolean()),
  },
  handler: async (ctx, a): Promise<Id<"worlds">> => {
    if (a.reuseExisting && a.worldId) {
      const existing = await ctx.db.query('worlds').withIndex('by_worldId', (q) => q.eq('worldId', a.worldId))
        .filter((q) => q.eq(q.field('status'), 'ready')).first();
      if (existing?.splatStorageId && await ctx.storage.getUrl(existing.splatStorageId)) return existing._id;
    }
    return ctx.db.insert("worlds", {
      name: a.name,
      prompt: a.prompt ?? "",
      model: a.model ?? "upload",
      status: "ready",
      worldId: a.worldId,
      splatStorageId: a.splatStorageId,
      splatFileName: a.splatFileName,
      colliderStorageId: a.colliderStorageId,
      panoStorageId: a.panoStorageId,
      metricScale: a.metricScale,
      groundOffset: a.groundOffset,
    });
  },
});

/** Import a world you already generated in the Marble app (paste the world_id). Costs nothing. */
export const importExisting = action({
  args: { worldId: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { worldId, name }): Promise<Id<"worlds">> => {
    const world = await get(`worlds/${worldId}`);
    const id = await ctx.runMutation(internal.worlds.create, {
      name: name ?? world.display_name ?? worldId, prompt: world.caption ?? "", model: world.model ?? "unknown",
    });
    const spzUrl: string = world.assets.splats.spz_urls["500k"] ?? world.assets.splats.spz_urls.full_res;
    const colliderUrl: string | undefined = world.assets.mesh?.collider_mesh_url;
    const meta = world.assets.splats.semantics_metadata ?? {};
    const splatStorageId = await ctx.storage.store(await (await fetch(spzUrl)).blob());
    const colliderStorageId = colliderUrl ? await ctx.storage.store(await (await fetch(colliderUrl)).blob()) : undefined;
    await ctx.runMutation(internal.worlds.update, {
      id, patch: { status: "ready", worldId, spzUrl, splatStorageId, colliderStorageId,
        metricScale: meta.metric_scale_factor, groundOffset: meta.ground_plane_offset },
    });
    return id;
  },
});

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}/${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`WorldLabs ${path}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}
async function get(path: string) {
  const r = await fetch(`${BASE}/${path}`, { headers: headers() });
  const j = await r.json();
  if (!r.ok) throw new Error(`WorldLabs ${path}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
