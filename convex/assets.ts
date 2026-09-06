// Tripo v3: generate object → poll → download GLB into Convex storage (URL dies in 5 min).
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
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
      ...a,
      glbUrl: a.glbStorageId ? await ctx.storage.getUrl(a.glbStorageId) : null,
      cutoutUrl: a.cutoutStorageId ? await ctx.storage.getUrl(a.cutoutStorageId) : null,
    })));
  },
});

/** Resume needs the saved Tripo task ID; actions cannot read the database directly. */
export const byId = internalQuery({
  args: { id: v.id("assets") },
  handler: (ctx, { id }) => ctx.db.get(id),
});

export const create = internalMutation({
  args: { prompt: v.string(), model: v.string(), description: v.optional(v.string()), stage: v.optional(v.string()) },
  handler: (ctx, args) => ctx.db.insert("assets", { ...args, stage: args.stage as any, status: "generating" }),
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
      stage: v.optional(v.union(v.literal("image"), v.literal("cutout"), v.literal("mesh"), v.literal("done"))),
      progress: v.optional(v.number()),
      cutoutStorageId: v.optional(v.id("_storage")),
      hasSurfaceColor: v.optional(v.boolean()),
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

// ---- sketch -> object (fal + Tripo colour pipeline lives in sketch.ts) ----

/**
 * Start a sketch generation and hand back the asset id immediately, so the viewer can
 * show progress from the first second. The paid work runs in a scheduled Node action;
 * the client never holds a minute-long request open, and a reload reconnects by id.
 */
export const startSketch = mutation({
  args: {
    imageStorageId: v.id("_storage"),
    cleanStorageId: v.optional(v.id("_storage")),
    description: v.string(),
  },
  handler: async (ctx, { imageStorageId, cleanStorageId, description }): Promise<Id<"assets">> => {
    const text = description.trim();
    if (!text) throw new Error("Describe what you drew before generating.");
    if (text.length > 8000) throw new Error("Keep the description under 8,000 characters.");
    // Fail before creating a row: an unconfigured deployment should say so plainly
    // rather than leaving a failed object in everyone's library.
    for (const key of ["FAL_KEY", "TRIPO_API_KEY"]) {
      if (!process.env[key]?.trim()) throw new Error(`${key} is not set on this deployment. Run \`npx convex env set ${key} <key>\`.`);
    }
    const id = await ctx.db.insert("assets", {
      prompt: text, description: text, model: "P1-20260311", status: "generating", stage: "image",
    });
    await ctx.scheduler.runAfter(0, internal.sketch.run, { id, imageStorageId, cleanStorageId, description: text });
    return id;
  },
});

/** Retry the download/colour check for a Tripo task that was already paid for. */
export const resumeSketch = mutation({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset) throw new Error("That object no longer exists.");
    if (!asset.taskId) throw new Error("This object has no saved Tripo task to resume.");
    await ctx.db.patch(assetId, { status: "generating", stage: "mesh", error: undefined });
    await ctx.scheduler.runAfter(0, internal.sketch.resumeRun, { assetId });
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
  args: { room: v.string(), assetId: v.id("assets"), position: v.array(v.number()), rotation: v.optional(v.array(v.number())), scale: v.optional(v.number()), targetSize: v.optional(v.number()) },
  handler: (ctx, { room, assetId, position, rotation = [0, 0, 0], scale = 1, targetSize }) =>
    ctx.db.insert("placements", { room, assetId, position, rotation, scale, targetSize }),
});

/** Undo for a placement, and the Remove button. Deleting a placement never touches its asset. */
export const removePlacement = mutation({
  args: { id: v.id("placements") },
  handler: async (ctx, { id }) => { await ctx.db.delete("placements", id); },
});

/** Move / resize / rotate an object already in the room. */
export const updatePlacement = mutation({
  args: {
    id: v.id("placements"),
    position: v.optional(v.array(v.number())),
    rotation: v.optional(v.array(v.number())),
    scale: v.optional(v.number()),
    targetSize: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const next = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    if (Object.keys(next).length) await ctx.db.patch(id, next);
  },
});

/** Remove every object placed in a room. Irreversible — placements have no undo. */
export const clearRoom = mutation({
  args: { room: v.string() },
  handler: async (ctx, { room }) => {
    const ps = await ctx.db.query("placements").withIndex("by_room", (q) => q.eq("room", room)).collect();
    for (const p of ps) await ctx.db.delete("placements", p._id);
    return ps.length;
  },
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
