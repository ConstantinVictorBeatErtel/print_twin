# Sketch context prompting

The transparent-sketch baseline is commit `f208587` on
`codex/sketch-context-prompts`. This branch adds an optional visual prompt writer
before Klein image generation.

## Data flow

1. The browser captures the room when drawing starts. It exports the ink separately
   as a cropped transparent PNG, keeping the captured camera and drawing bounds.
2. With **Use room context to refine the prompt** enabled, it uploads the clean
   room PNG and transparent sketch to Convex. The normalized drawing rectangle
   tells the prompt writer where the cropped sketch belongs in the room.
3. `sketch.run` sends the two images inline to fal's `openrouter/router/vision`,
   selecting `qwen/qwen3.8-27b`. The existing Convex `FAL_KEY` authenticates this call.
4. Qwen translates visual context into concrete object attributes. Its instructions
   preserve explicit user requirements and avoid describing the surrounding room as
   part of the output object. The image prompt includes the complete original user
   description and the existing object-isolation instructions.
5. Klein receives exactly one image: the transparent sketch. Only text from the
   context stage reaches Klein; the room PNG is never included in `image_urls`.
6. BiRefNet removes the generated background and Tripo builds the color GLB as before.

When the checkbox is off, the browser uploads no background, no VLM call is made,
and Klein receives the transparent sketch with the baseline prompt.

## Configuration and inspection

Default: `qwen/qwen3.8-27b`. To try another vision model supported by fal's router,
set `SKETCH_PROMPT_MODEL` in the Convex deployment. A separate OpenRouter API key
is not needed. Requests use a 90-second timeout, a 1,024-token output budget,
temperature 0.2, no web search, and no automatic application-level paid retries.

The asset preserves `description`, `promptMode`, `imagePrompt`, `promptModel`,
`promptRequestId`, and `promptDurationMs`. Expand **Image prompt** in the generation
card to inspect the exact prompt and the writer's model/latency. These fields remain
in Convex after reload. Provider failures, blank/invalid responses, and timeouts
stop generation before Klein; there is no silent fallback that would confuse the
context-versus-baseline comparison. Existing Tripo tasks can still be resumed.

## Validation

- Automated tests check that Qwen receives sketch + background + user description
  + drawing bounds, while Klein receives only the original sketch and final text.
- Tests verify that the complete original user message survives rewriting, prompt
  metadata is persisted, invalid VLM responses stop before image generation, and
  opaque/blank sketch inputs never reach either model.
- A live prompt-only smoke test on September 5, 2026 succeeded with
  `qwen/qwen3.8-27b` through fal in 3.88 seconds. Inputs were entirely synthetic:
  a pink pot outline and a simple green room/brown table illustration. Qwen returned
  a faceted, open-top, sage-green ceramic pot prompt with a drainage hole. This
  confirms model access and the image-input path; it does not establish improvement
  in generated images or 3D geometry. No Klein or Tripo job ran in that smoke test.

For qualitative comparison, use both checkbox modes and inspect the saved prompts
and generated object images. Check fidelity to the requested shape, whether context
references become useful object attributes, and whether room furniture/backgrounds
leak into the generated object. Multiple examples are needed before choosing a
default based on quality; the single smoke test is not a quality benchmark.

API references: [fal vision router](https://fal.ai/models/openrouter/router/vision/api),
[Qwen3.8 27B](https://openrouter.ai/qwen/qwen3.8-27b),
[Klein edit](https://fal.ai/models/fal-ai/flux-2/klein/9b/edit/api).
