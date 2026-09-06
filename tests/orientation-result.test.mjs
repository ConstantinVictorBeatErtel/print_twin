import test from "node:test";
import assert from "node:assert/strict";
import { orientationSchema, orientationPrompt, parseOrientation } from "../convex/orientationResult.ts";

test("the schema pins view to the real indices, because numeric bounds get ignored", () => {
  const { name, strict, schema } = orientationSchema(8);
  assert.equal(name, "orientation");
  assert.equal(strict, true);
  assert.deepEqual(schema.properties.view.enum, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(schema.required, ["view", "confidence", "reasoning"]);
  assert.equal(schema.additionalProperties, false);
  // Every property carries a description: OpenRouter's own guidance is that these steer the model.
  for (const [key, property] of Object.entries(schema.properties)) {
    assert.ok(property.description?.length > 10, `${key} needs a description`);
  }
});

test("a clean structured reply is taken at face value", () => {
  const parsed = parseOrientation('{"view":3,"confidence":"high","reasoning":"handle points left"}', 8);
  assert.deepEqual(parsed, { view: 3, confidence: "high", reasoning: "handle points left" });
});

test("a reply wrapped in prose or a code fence is still usable", () => {
  // OpenRouter routes to whichever provider is up, and structured-output support varies by
  // provider endpoint — the same model slug can honour `strict` on one and not the other.
  const fenced = 'Looking at the views:\n```json\n{"view": 6, "confidence": "medium", "reasoning": "spout right"}\n```\nHope that helps!';
  assert.deepEqual(parseOrientation(fenced, 8), { view: 6, confidence: "medium", reasoning: "spout right" });
  // Braces inside strings must not end the object early.
  const braces = '{"view":2,"confidence":"low","reasoning":"looks like a {cup} from every side"}';
  assert.equal(parseOrientation(braces, 8).reasoning, "looks like a {cup} from every side");
});

test("an unusable reply is null rather than a bad yaw", () => {
  // An out-of-range index is the dangerous one: the caller turns it straight into a yaw, so a
  // 9-of-8 would index past the end and spin the object by `undefined` radians.
  assert.equal(parseOrientation('{"view":9,"confidence":"high","reasoning":"x"}', 8), null);
  assert.equal(parseOrientation('{"view":0,"confidence":"high","reasoning":"x"}', 8), null);
  assert.equal(parseOrientation('{"view":2.5,"confidence":"high","reasoning":"x"}', 8), null);
  assert.equal(parseOrientation('{"confidence":"high"}', 8), null);
  assert.equal(parseOrientation("I could not tell from these views.", 8), null);
  assert.equal(parseOrientation("", 8), null);
  assert.equal(parseOrientation(null, 8), null);
  assert.equal(parseOrientation({ view: 3 }, 8), null, "content is a string on the wire, not an object");
});

test("an unrecognised confidence degrades to low rather than being trusted", () => {
  const parsed = parseOrientation('{"view":4,"confidence":"very sure","reasoning":"x"}', 8);
  assert.equal(parsed.confidence, "low", "an unknown confidence must not be treated as high");
  assert.equal(parseOrientation('{"view":4,"confidence":"high"}', 8).reasoning, "");
});

test("the prompt names both images and asks only about orientation", () => {
  const prompt = orientationPrompt("a faceted ceramic pot", 8);
  assert.match(prompt, /a faceted ceramic pot/);
  assert.match(prompt, /1 to 8/);
  assert.match(prompt, /orientation only/i, "size and likeness must be explicitly out of scope");
  assert.match(prompt, /low confidence/i, "the model needs a way to say it cannot tell");
});
