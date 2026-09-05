// Tripo v3: generate object → poll → download GLB into Convex storage (URL dies in 5 min).
import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const BASE = "https://openapi.tripo3d.ai/v3";
const headers = () => ({
  Authorization: `Bearer ${process.env.TRIPO_API_KEY ?? ""}`,
  "Content-Type": "application/json",
});
const TERMINAL = ["success", "failed", "cancelled", "banned", "expired"];

export const list = query({
  args: {},
  handler: async (ctx) => {
    const assets = await ctx.db.query("assets").order("desc").collect();
    return Promise.all(assets.map(async (a) => ({
      ...a, glbUrl: a.glbStorageId ? await ctx.storage.getUrl(a.glbStorageId) : null,
    })));
  },
});

export const create = internalMutation({
  args: { prompt: v.string(), model: v.string() },
  handler: (ctx, args) => ctx.db.insert("assets", { ...args, status: "generating" }),
});

export const update = internalMutation({
  args: {
    id: v.id("assets"),
    patch: v.object({
      status: v.optional(v.union(v.literal("generating"), v.literal("ready"), v.literal("failed"))),
      taskId: v.optional(v.string()),
      glbStorageId: v.optional(v.id("_storage")),
      thumbnailUrl: v.optional(v.string()),
      error: v.optional(v.string()),
    }),
  },
  handler: (ctx, { id, patch }) => ctx.db.patch(id, patch),
});

/** Text → 3D. P1 (~10–60s) for game props; v3.1-20260211 for hero quality. */
export const generateFromText = action({
  args: { prompt: v.string(), model: v.optional(v.string()), texture: v.optional(v.boolean()) },
  // Explicit return type: the handler calls internal.assets.* from this same
  // module, so without it TS hits a circular inference (TS7022/TS7023).
  handler: async (ctx, { prompt, model = "P1-20260311", texture = true }): Promise<Id<"assets">> => {
    const id = await ctx.runMutation(internal.assets.create, { prompt, model });
    try {
      const created = await post("generation/text-to-model", { prompt, model, texture, pbr: texture, auto_size: true });
      const taskId: string = created.data.task_id;
      await ctx.runMutation(internal.assets.update, { id, patch: { taskId } });

      let task;
      const deadline = Date.now() + 5 * 60_000;
      do {
        await sleep(2000);
        task = (await get(`tasks/${taskId}`)).data;
      } while (!TERMINAL.includes(task.status) && Date.now() < deadline);
      if (task.status !== "success") throw new Error(`Tripo task ${task.status}: ${JSON.stringify(task)}`);

      // Download immediately — model_url expires in 5 minutes.
      const glb = await (await fetch(task.output.model_url)).blob();
      const glbStorageId = await ctx.storage.store(glb);
      await ctx.runMutation(internal.assets.update, {
        id, patch: { status: "ready", glbStorageId, thumbnailUrl: task.output.rendered_image_url },
      });
      return id;
    } catch (e: any) {
      await ctx.runMutation(internal.assets.update, { id, patch: { status: "failed", error: String(e?.message ?? e) } });
      throw e;
    }
  },
});

/** Image → 3D from a public image URL (or a file_token from POST /files). */
export const generateFromImage = action({
  args: { imageUrlOrToken: v.string(), model: v.optional(v.string()) },
  handler: async (ctx, { imageUrlOrToken, model = "P1-20260311" }): Promise<Id<"assets">> => {
    const id = await ctx.runMutation(internal.assets.create, { prompt: `image:${imageUrlOrToken}`, model });
    try {
      // NOTE: verify the field name (`input` vs `file`) against your first live response.
      const created = await post("generation/image-to-model", { input: imageUrlOrToken, model, texture: true, pbr: true, auto_size: true });
      const taskId: string = created.data.task_id;
      let task;
      do { await sleep(2000); task = (await get(`tasks/${taskId}`)).data; } while (!TERMINAL.includes(task.status));
      if (task.status !== "success") throw new Error(`Tripo task ${task.status}`);
      const glbStorageId = await ctx.storage.store(await (await fetch(task.output.model_url)).blob());
      await ctx.runMutation(internal.assets.update, { id, patch: { status: "ready", taskId, glbStorageId, thumbnailUrl: task.output.rendered_image_url } });
      return id;
    } catch (e: any) {
      await ctx.runMutation(internal.assets.update, { id, patch: { status: "failed", error: String(e?.message ?? e) } });
      throw e;
    }
  },
});

// ---- placements (objects placed in a room) ----
export const placementsInRoom = query({
  args: { room: v.string() },
  handler: async (ctx, { room }) => {
    const ps = await ctx.db.query("placements").withIndex("by_room", (q) => q.eq("room", room)).collect();
    return Promise.all(ps.map(async (p) => {
      const asset = await ctx.db.get(p.assetId);
      return { ...p, glbUrl: asset?.glbStorageId ? await ctx.storage.getUrl(asset.glbStorageId) : null };
    }));
  },
});

export const place = mutation({
  args: { room: v.string(), assetId: v.id("assets"), position: v.array(v.number()), rotation: v.optional(v.array(v.number())), scale: v.optional(v.number()) },
  handler: (ctx, { room, assetId, position, rotation = [0, 0, 0], scale = 1 }) =>
    ctx.db.insert("placements", { room, assetId, position, rotation, scale }),
});

export const movePlacement = mutation({
  args: { id: v.id("placements"), position: v.array(v.number()), rotation: v.optional(v.array(v.number())) },
  handler: async (ctx, { id, position, rotation }) => { await ctx.db.patch(id, { position, ...(rotation ? { rotation } : {}) }); },
});

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}/${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Tripo ${path}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}
async function get(path: string) {
  const r = await fetch(`${BASE}/${path}`, { headers: headers() });
  const j = await r.json();
  if (!r.ok) throw new Error(`Tripo ${path}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
