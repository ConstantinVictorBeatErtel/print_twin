// Deciding where and how a finished sketch goes into the room.
//
// Position and size come from the anchor, which was measured against the real collider when the
// drawing was made. Only the *yaw* is in question, and there are three answers of falling
// quality — this is the ladder that walks down them, so JobWatcher can stay a component that
// places things rather than one that also arbitrates orientation strategies.
//
//   1. the vision model picks one of N rendered views, and the chamfer sweep refines inside
//      that sector. Best: it reasons about which way a handle or a back points, so it survives
//      the generated mesh not being a faithful likeness of the sketch.
//   2. the chamfer sweep alone, over the full circle. Works when the mesh does resemble the
//      drawing; noisy when it does not, which is why its confidence gate exists.
//   3. the yaw orientOnSurface already gave the anchor — facing whoever drew it.
//
// Every rung falls to the next on any failure. A missing API key, a dead endpoint, an
// unparseable reply and a rotationally symmetric vase all land somewhere sensible, because
// losing an object the user waited two minutes for is a far worse outcome than a wrong yaw.
import type { Object3D } from "three";
import type { Id } from "../../convex/_generated/dataModel";
import { fitDrawing, type DrawingAnchor } from "./drawingPlacement.ts";
import { composeYaw, viewYaws, type YawMatch } from "./sketchOrientation.ts";
import type { SketchSolverApi } from "../components/SketchSolver";

/** How the object ended up facing the way it does — shown on the generation card. */
export type Facing = "vision" | "sketched" | "camera" | "unavailable";

export type SketchPose = {
  position: number[];
  rotation: number[];
  targetSize: number;
  facing: Facing;
  /** Only for the ?debug=1 readout; nothing behavioural reads these. */
  debug: { view?: number; reasoning?: string; score?: number; confident?: boolean };
};

export type OrientationChoice = { view: number; confidence: string; reasoning: string };

export type PoseTools = {
  solver: SketchSolverApi | null;
  /** Uploads a data URL to Convex storage and returns the storage id. */
  store: (dataUrl: string) => Promise<Id<"_storage">>;
  orient: (args: { viewsStorageId: Id<"_storage">; sketchStorageId: Id<"_storage">; description: string; views: number })
    => Promise<OrientationChoice | null>;
  /**
   * Rung 1 is **off by default** (`?vision=1` turns it on). Two image uploads and a round trip
   * to a hosted model add seconds to every sketch, on top of a generation pipeline that already
   * runs one to two minutes — too much to spend by default on an answer the chamfer sweep
   * often gets right for free. Rungs 2 and 3 are unaffected either way.
   */
  vision?: boolean;
};

export const VIEW_COUNT = 8;

export async function resolveSketchPose(
  model: Object3D, anchor: DrawingAnchor, description: string, tools: PoseTools,
): Promise<SketchPose> {
  const fit = fitDrawing(model, anchor);
  const base = { position: fit.position, targetSize: fit.targetSize };
  const solver = tools.solver;
  if (!solver) return { ...base, rotation: fit.rotation, facing: "camera", debug: {} };

  const vision = await askVision(model, anchor, description, tools, solver);
  const choice = vision.choice;

  // A confident pick narrows the sweep to that sector; anything else sweeps the full circle.
  const window = choice
    ? { center: viewYaws(VIEW_COUNT)[choice.view - 1], span: 2 * Math.PI / VIEW_COUNT }
    : undefined;
  const match: YawMatch | null = solver.solveYaw(model, anchor, fit.targetSize, window);

  const debug = { view: choice?.view, reasoning: choice?.reasoning, score: match?.score, confident: match?.confident };
  if (match?.confident) {
    return {
      position: fit.position,
      rotation: composeYaw(fit.rotation, match.yaw),
      targetSize: match.targetSize,
      facing: choice ? "vision" : "sketched",
      debug,
    };
  }
  // Nothing to stand behind. Distinguish "we never got to ask" from "we asked and the object
  // is genuinely ambiguous" — otherwise an unconfigured deployment looks like a symmetric vase.
  return { ...base, rotation: fit.rotation, facing: vision.unavailable ? "unavailable" : "camera", debug };
}

/**
 * Render the contact sheet and the ink, upload both, ask.
 *
 * `unavailable` separates "the call could not be made" (no key, no network, upload failed) from
 * "the model looked and could not tell" — the card says different things about each, and a
 * deployment missing its key should say so rather than silently blaming the object's shape.
 */
async function askVision(
  model: Object3D, anchor: DrawingAnchor, description: string, tools: PoseTools, solver: SketchSolverApi,
): Promise<{ choice: OrientationChoice | null; unavailable: boolean }> {
  // Switched off is not the same as broken: fall through to the sweep silently, without the
  // card claiming orientation matching is unavailable on this deployment.
  if (!tools.vision) return { choice: null, unavailable: false };
  try {
    const sheet = solver.renderViews(model, anchor, 1, VIEW_COUNT);
    const ink = solver.renderInk(anchor);
    if (!sheet || !ink) return { choice: null, unavailable: true };
    const [viewsStorageId, sketchStorageId] = await Promise.all([tools.store(sheet.dataUrl), tools.store(ink)]);
    const choice = await tools.orient({ viewsStorageId, sketchStorageId, description, views: VIEW_COUNT });
    // The action returns null for a reply it could not use, and throws only when the
    // deployment is unconfigured. Either way the sweep still has an answer.
    if (!choice) return { choice: null, unavailable: false };
    // "low" means the model looked and could not tell — a coin-flip sector is worse than the
    // full sweep, so treat it as no answer rather than as a weak one.
    if (choice.confidence === "low") return { choice: null, unavailable: false };
    if (!Number.isInteger(choice.view) || choice.view < 1 || choice.view > VIEW_COUNT) return { choice: null, unavailable: false };
    return { choice, unavailable: false };
  } catch {
    return { choice: null, unavailable: true };
  }
}
