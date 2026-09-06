// Demo stand-ins: four objects the live demo always draws, already generated.
//
// The real pipeline (fal Klein -> BiRefNet -> Tripo, convex/sketch.ts) takes one to two
// minutes and costs money on every attempt — too long to hold a room full of people, and
// too likely to hand back a mesh nobody has seen before. So when the description names one
// of the four demo objects, `assets.startSketch` inserts an ordinary asset row and walks it
// through the same stages on a fixed clock, then finishes by pointing the row at the GLB of
// an object that was generated for real earlier. Everything downstream — the progress card,
// the orientation solve, the auto-placement — runs exactly as it does for a live sketch,
// because the row it watches is the same shape.
//
// `?live=1` skips all of this and generates for real. Anything that is not one of the four
// keywords generates for real too, so the demo can still take a request from the audience.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

/** Each fake stage lasts this long, and the object lands one step after the last one. */
export const DEMO_STEP_MS = 2500;

/** image (0s) -> cutout (2.5s) -> mesh (5s) -> pulling the mesh (7.5s) -> placed (10s). */
const DEMO_STEPS = [
  { stage: "cutout", progress: 0 },
  { stage: "mesh", progress: 12 },
  { stage: "mesh", progress: 68 },
] as const;

export type DemoObject = {
  name: string;
  /** Matched as whole words against the lowercased description. */
  keywords: string[];
  /**
   * Rows in this deployment's asset library, best first. IDs are deployment-specific, so a
   * deployment that does not have them falls back to a keyword search over the library.
   */
  assetIds: string[];
};

export const DEMO_OBJECTS: DemoObject[] = [
  {
    name: "dinosaur",
    keywords: ["dinosaur", "dino", "t-rex", "trex", "raptor", "godzilla", "charizard"],
    assetIds: ["jd79wec51qf5tgknyn1fk4581x8dxr99", "jd7dfc5q6xdqejer147ctsavgd8dx7p8"],
  },
  {
    name: "flower vase",
    keywords: ["vase", "flowers", "flower", "bouquet"],
    assetIds: ["jd721tnvg7a391njp5fjhf1fjh8dwk2y", "jd7cq7me0rept6ae2amhscdxn98dxv07"],
  },
  {
    name: "couch",
    keywords: ["couch", "sofa", "loveseat"],
    assetIds: ["jd787zynvkjrtygd7mp247cdrd8dwczf", "jd756zfaehb9asqqa4e23cwpks8dxygj"],
  },
  {
    name: "table",
    keywords: ["table", "desk"],
    assetIds: ["jd7788ky4qnrxaec0d6qwmrpqh8dwa9v", "jd7a32zfvb6w8gcfw1372e50dx8dtgk8"],
  },
];

/**
 * Which demo object a description asks for, or null for anything else. A sentence can name
 * two of them ("a vase on the table") — the one named first wins, because that is the one
 * the sentence is about.
 */
export function matchDemoObject(description: string): DemoObject | null {
  const text = description.toLowerCase();
  let best: { at: number; object: DemoObject } | null = null;
  for (const object of DEMO_OBJECTS) {
    for (const keyword of object.keywords) {
      const at = text.search(new RegExp(`\\b${keyword}\\b`));
      if (at >= 0 && (!best || at < best.at)) best = { at, object };
    }
  }
  return best?.object ?? null;
}

const usable = (doc: Doc<"assets"> | null): doc is Doc<"assets"> =>
  Boolean(doc && doc.status === "ready" && doc.glbStorageId);

/**
 * The pre-generated row to hand back. Prefers the curated IDs; if this deployment does not
 * have them (a fresh backend, or a restore), it takes the newest ready object in the library
 * whose own description names the same thing.
 */
export async function findDemoSource(ctx: MutationCtx, demo: DemoObject): Promise<Doc<"assets"> | null> {
  for (const raw of demo.assetIds) {
    const id = ctx.db.normalizeId("assets", raw);
    const doc = id ? await ctx.db.get(id) : null;
    if (usable(doc)) return doc;
  }
  const library = await ctx.db.query("assets").order("desc").collect();
  return library.find((doc) => usable(doc) && matchDemoObject(doc.description ?? doc.prompt) === demo) ?? null;
}

/** Insert the row the client watches and start the clock. Returns immediately, like the real one. */
export async function startDemoSketch(ctx: MutationCtx, description: string, source: Doc<"assets">): Promise<Id<"assets">> {
  const id = await ctx.db.insert("assets", {
    prompt: description, description, model: source.model, status: "generating", stage: "image", progress: 0,
  });
  await ctx.scheduler.runAfter(DEMO_STEP_MS, internal.demoAssets.advance, { id, sourceId: source._id, step: 0 });
  return id;
}

/** One beat of the fake pipeline; the last one adopts the pre-generated mesh. */
export const advance = internalMutation({
  args: { id: v.id("assets"), sourceId: v.id("assets"), step: v.number() },
  handler: async (ctx, { id, sourceId, step }) => {
    const asset = await ctx.db.get(id);
    // Gone, or already failed/finished by something else: stop the clock rather than
    // resurrect a row the room has moved on from.
    if (!asset || asset.status !== "generating") return;

    const source = await ctx.db.get(sourceId);
    if (!usable(source)) {
      await ctx.db.patch(id, { status: "failed", error: "The pre-generated demo object is missing from this deployment. Add ?live=1 to generate it for real." });
      return;
    }

    const beat = DEMO_STEPS[step];
    if (beat) {
      await ctx.db.patch(id, {
        stage: beat.stage, progress: beat.progress,
        // The cutout is what the card shows while the mesh "builds", same as a live run.
        ...(beat.stage === "cutout" ? { cutoutStorageId: source.cutoutStorageId } : {}),
      });
      await ctx.scheduler.runAfter(DEMO_STEP_MS, internal.demoAssets.advance, { id, sourceId, step: step + 1 });
      return;
    }

    await ctx.db.patch(id, {
      status: "ready", stage: "done", progress: 100,
      glbStorageId: source.glbStorageId,
      thumbnailUrl: source.thumbnailUrl,
      hasSurfaceColor: source.hasSurfaceColor ?? true,
    });
  },
});
