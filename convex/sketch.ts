"use node";
// Sketch -> color GLB, as one Convex action.
//
// This is the pipeline verified in COLOR_PIPELINE.md, moved out of the local Node
// server (server/asset-pipeline.js) so keys stay in the Convex deployment and the
// finished object lands in Convex storage where every player in the room can see it.
//
//   transparent sketch + prompt -> fal FLUX.2 Klein 9B edit (isolated object on white)
//   optional room + sketch -> Qwen prompt writer -> text only joins the above
//                         -> fal BiRefNet                (transparent cutout)
//                         -> Tripo P1 image_to_model     (textured GLB)
//                         -> inspectGlb requireColor     (reject the gray base mesh)
//                         -> Convex storage
//
// Progress is written onto the asset row, so the client just watches it with
// useQuery — no job endpoint and no polling loop. These are internal actions kicked
// off by assets.startSketch / assets.resumeSketch, which return the asset id straight
// away; the client never holds a minute-long request open.
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { credentials, makeApi, generationPayload, waitForTask, MODEL } from "./tripo";
// Reused verbatim from the CLI: Klein + BiRefNet + the PNG alpha check.
import { inspectPng, runWorkflow } from "../scripts/image-benchmark/providers.mjs";
import { buildImagePrompt, writeSketchPrompt } from "../scripts/sketch-prompt.mjs";

// providers.mjs is plain JS. convex/tsconfig.json has allowJs, so its inference (which
// only sees the defaults, losing `env`, `imageUrls` and onProgress's argument) wins over
// the ambient declaration in pipeline-modules.d.ts. Restate the call shape for both.
const runSketchWorkflow = runWorkflow as unknown as (
  id: "klein-9b",
  prompt: string,
  options: { env: Record<string, string | undefined>; imageUrls: string[]; onProgress?: (stage: string) => void },
) => Promise<{ status: "ok" | "failed" | "invalid-alpha"; error?: string; bytes: Uint8Array }>;
// Pure GLB container inspection — no three.js, safe to bundle.
import { inspectGlb, modelArtifact } from "../scripts/glb-assets.mjs";
const TASK_TIMEOUT_MS = 300_000;

const redact = (message: string) => {
  let out = message;
  for (const secret of [process.env.TRIPO_API_KEY, process.env.FAL_KEY]) {
    if (secret?.trim()) out = out.split(secret.trim()).join("[redacted]");
  }
  return out;
};

/**
 * One paid Tripo task per run. The task ID is stored before polling starts, so a
 * reload or a retry resumes the existing task instead of submitting another one.
 */
export const run = internalAction({
  args: {
    id: v.id("assets"),
    sketchStorageId: v.id("_storage"), // ink alone on transparency; no room pixels
    backgroundStorageId: v.optional(v.id("_storage")), // prompt writer ONLY
    sketchBounds: v.optional(v.object({ left: v.number(), top: v.number(), right: v.number(), bottom: v.number() })),
    description: v.string(),
  },
  handler: async (ctx, { id, sketchStorageId, backgroundStorageId, sketchBounds, description }): Promise<Id<"assets">> => {
    const text = description.trim();
    const patch = (p: Record<string, unknown>) =>
      ctx.runMutation(internal.assets.update, { id, patch: p as any });

    try {
      const sketch = await ctx.storage.get(sketchStorageId);
      if (!sketch) throw new Error("The drawing is no longer in storage. Sketch it again.");
      const sketchBytes = Buffer.from(await sketch.arrayBuffer());
      if (!inspectPng(sketchBytes).validCutout) throw new Error("The sketch must contain visible strokes on a transparent background.");
      // fal accepts base64 file inputs. Sending bytes also works when Convex storage
      // is local and its URLs cannot be fetched by the remote image model.
      const sketchDataUrl = `data:image/png;base64,${sketchBytes.toString("base64")}`;
      let contextualPrompt: string | undefined;
      if (backgroundStorageId) {
        if (!sketchBounds) throw new Error("Room context requires the sketch position.");
        const background = await ctx.storage.get(backgroundStorageId);
        if (!background) throw new Error("The background is no longer in storage. Sketch again or turn off room context.");
        const backgroundDataUrl = `data:image/png;base64,${Buffer.from(await background.arrayBuffer()).toString("base64")}`;
        await patch({ stage: "prompt" });
        const written = await writeSketchPrompt({ description: text, sketchDataUrl, backgroundDataUrl, bounds: sketchBounds }, {
          env: process.env,
          onSubmitted: async (requestId, model) => { await patch({ promptRequestId: requestId, promptModel: model }); },
        });
        contextualPrompt = written.prompt;
        await patch({ promptDurationMs: written.durationMs });
      }
      const imagePrompt = buildImagePrompt(text, contextualPrompt);
      await patch({ stage: "image", imagePrompt });

      // Klein edit + BiRefNet cutout + alpha validation, in one call.
      const result = await runSketchWorkflow("klein-9b", imagePrompt, {
        env: process.env,
        imageUrls: [sketchDataUrl],
        onProgress: (name) => { if (name === "backgroundRemoval") void patch({ stage: "cutout" }); },
      });
      if (result.status !== "ok") {
        throw new Error(result.error || "No usable transparent image was produced. 3D generation was not started.");
      }
      const cutout = new Blob([result.bytes as BlobPart], { type: "image/png" });
      const cutoutStorageId = await ctx.storage.store(cutout);
      await patch({ stage: "mesh", cutoutStorageId });

      const api = makeApi(credentials());
      const form = new FormData();
      form.append("file", cutout, "object.png");
      const uploaded = await api("/upload/sts", { method: "POST", body: form });
      if (!uploaded.image_token) throw new Error("Tripo upload returned no image token.");

      const submitted = await api("/task", { method: "POST", body: generationPayload(uploaded.image_token, "png", { color: true }) });
      if (!submitted.task_id) throw new Error("Tripo returned no task ID. Check its task history before creating again.");
      // Persist before polling: a retry must never resubmit paid work.
      await patch({ taskId: submitted.task_id });

      const task = await waitForTask(api, submitted.task_id, {
        timeoutMs: TASK_TIMEOUT_MS, pollMs: 2000,
        onProgress: (t: any) => { if (typeof t.progress === "number") void patch({ progress: t.progress }); },
      });

      const glbStorageId = await downloadModel(ctx, task);
      await patch({
        status: "ready", stage: "done", progress: 100, glbStorageId,
        thumbnailUrl: task.output?.rendered_image_url,
        hasSurfaceColor: true,
      });
      return id;
    } catch (e: any) {
      await patch({ status: "failed", error: redact(String(e?.message ?? e)) });
      throw e;
    }
  },
});

/**
 * Pick up a task that was already paid for — the mesh finished but the download,
 * the color check or the deploy did not. Never submits a new task.
 */
export const resumeRun = internalAction({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }): Promise<Id<"assets">> => {
    const asset = await ctx.runQuery(internal.assets.byId, { id: assetId });
    if (!asset) throw new Error("That object no longer exists.");
    if (!asset.taskId) throw new Error("This object has no saved Tripo task to resume.");
    const patch = (p: Record<string, unknown>) =>
      ctx.runMutation(internal.assets.update, { id: assetId, patch: p as any });
    await patch({ status: "generating", stage: "mesh", error: undefined });
    try {
      const api = makeApi(credentials());
      const task = await waitForTask(api, asset.taskId, {
        timeoutMs: TASK_TIMEOUT_MS, pollMs: 2000,
        onProgress: (t: any) => { if (typeof t.progress === "number") void patch({ progress: t.progress }); },
      });
      const glbStorageId = await downloadModel(ctx, task);
      await patch({
        status: "ready", stage: "done", progress: 100, glbStorageId,
        thumbnailUrl: task.output?.rendered_image_url, hasSurfaceColor: true,
      });
      return assetId;
    } catch (e: any) {
      await patch({ status: "failed", error: redact(String(e?.message ?? e)) });
      throw e;
    }
  },
});

/**
 * Tripo artifact URLs expire in minutes, so download immediately. `modelArtifact`
 * prefers the finished textured model over the gray base mesh; `inspectGlb` then
 * refuses a result that carries no base-color texture or vertex colors at all.
 */
async function downloadModel(ctx: { storage: { store: (b: Blob) => Promise<Id<"_storage">> } }, task: any): Promise<Id<"_storage">> {
  const { url } = modelArtifact(task, { color: true });
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Mesh download failed (HTTP ${response.status}). Resume the saved task.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  inspectGlb(bytes, { requireColor: true });
  return await ctx.storage.store(new Blob([bytes as BlobPart], { type: "model/gltf-binary" }));
}
