// The request schema and response parsing for the orientation call, with no Convex or network
// imports — so `node --test` can exercise the parsing without a deployment or an API key.
//
// OpenRouter is a gateway, and its own docs note that structured-output support varies by
// *provider endpoint*, not just by model. `strict: true` is therefore a request, not a
// guarantee: the same model slug can return clean JSON through one provider and a fenced code
// block through another. Everything here is written to survive that.

export type Confidence = "high" | "medium" | "low";
export type OrientationChoice = { view: number; confidence: Confidence; reasoning: string };

const CONFIDENCE: Confidence[] = ["high", "medium", "low"];

/** The `json_schema` body for `response_format`. `view` is an enum, not a range: JSON-schema numeric bounds are widely ignored, an enum of the actual indices is not. */
export function orientationSchema(views: number) {
  return {
    name: "orientation",
    strict: true,
    schema: {
      type: "object",
      properties: {
        view: {
          type: "integer",
          enum: Array.from({ length: views }, (_, i) => i + 1),
          description: `The number printed on the view whose orientation matches the sketch, 1 to ${views}.`,
        },
        confidence: {
          type: "string",
          enum: CONFIDENCE,
          description:
            "high when one view clearly matches; low when the object looks the same from "
            + "several sides, or the generated shape is too different from the sketch to tell.",
        },
        reasoning: {
          type: "string",
          description: "One sentence naming the feature that decided it (which way a handle, back, spout or front points).",
        },
      },
      required: ["view", "confidence", "reasoning"],
      additionalProperties: false,
    },
  };
}

/** The first balanced `{...}` run in a string — for models that wrap JSON in prose or a fence. */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * A choice we are willing to act on, or null. An out-of-range `view` must land here rather
 * than downstream: the caller turns it straight into a yaw, so a hallucinated 9-of-8 would
 * become `undefined` radians and silently spin the object.
 */
export function parseOrientation(content: unknown, views: number): OrientationChoice | null {
  if (typeof content !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const embedded = firstJsonObject(content);
    if (!embedded) return null;
    try { parsed = JSON.parse(embedded); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { view, confidence, reasoning } = parsed as Record<string, unknown>;
  if (typeof view !== "number" || !Number.isInteger(view) || view < 1 || view > views) return null;
  return {
    view,
    confidence: CONFIDENCE.includes(confidence as Confidence) ? confidence as Confidence : "low",
    reasoning: typeof reasoning === "string" ? reasoning : "",
  };
}

export function orientationPrompt(description: string, views: number) {
  return [
    `A person sketched an object into a photo of their room and described it as: "${description}".`,
    "A 3D model was then generated from that sketch. Your job is to work out which way round it should be turned.",
    "",
    "The first image is the person's sketch, as they drew it.",
    `The second image is the generated model, photographed from the same place the person was standing, turned to ${views} evenly spaced angles and numbered 1 to ${views}.`,
    "",
    `Reply with the number of the view whose orientation matches the sketch — the one where the object's front, back and sides point the same way they do in the drawing.`,
    "Judge orientation only. The generated model will not be a perfect likeness, and its size and position in the frame carry no meaning; look at which way it faces.",
    "Use asymmetric features to decide: which side a handle, spout, back, screen, opening or nose points towards.",
    "Answer with low confidence if the object looks nearly the same from several of these angles, or if the model is too unlike the sketch to judge.",
  ].join("\n");
}
