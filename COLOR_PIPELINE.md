# Color asset pipeline — research and implementation

Research checked September 5, 2026. This change concerns generated objects; the room remains a Gaussian splat.

## Format decision

| Format | Appearance | Role here |
| --- | --- | --- |
| GLB / glTF 2.0 | Base-color textures, vertex colors and material factors; GLB can embed the images and mesh buffers in one file | Canonical generated object, scene placement, preview, browser persistence and primary download |
| Loose glTF | Same rendering model, potentially with separate image/buffer files | Not used for saved imports: dependent files can disappear or signed links expire |
| STL | Geometry; no standard color/material information | Secondary print export, explicitly labeled “no color” |
| 3MF | Manufacturing format with color/property support | Relevant to a future color-print workflow, but not needed to render these objects in the web viewer |

Sources: [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html), [3MF Consortium FAQ](https://3mf.io/resources/faq/), [3MF materials extension](https://3mf.io/wp-content/uploads/sites/106/2025/02/3MF_Materials_Extension_v1_2_1.pdf).

Changing an extension cannot recreate missing appearance. Existing gray GLBs/STLs stay gray; new generation must actually create color. A color GLB also does not automatically configure a printer's physical materials.

## Why the old result was gray

The scene already imported GLBs. The generation payload explicitly disabled textures and PBR, the downloader preferred `base_model`, and the separate root-app preview loaded the STL into a single orange material. These were three independent points where color was absent or hidden.

## Provider findings and chosen settings

Tripo P1 supports image-to-model texture generation. Texture work adds processing time. Standard texture quality and image-aligned color are supported; disabling early UV export defers unwrapping to texturing. We retain P1 and use `texture: true`, `pbr: false`, `texture_quality: standard`, `texture_alignment: original_image`, `export_uv: false`. The optional roughness/metalness/normal generation is unnecessary for the immediate goal of preserving visible color.

Sources: [P1 image-to-model parameters](https://docs.tripo3d.ai/model-generation/image-to-model-p1-20260311.html), [P1 generation overview](https://platform.tripo3d.ai/docs/generation).

The task response can include separate `model`, `base_model`, and `pbr_model` URLs. Color mode selects `pbr_model`, then `model`/`model_url`, then a base result only if its contents pass appearance verification. Artifact URLs are downloaded immediately and never used as permanent browser references.

Source: [Tripo task outputs](https://platform.tripo3d.ai/docs/task).

A separate texture-processing endpoint is another option for existing geometry. It supports reference-image guidance and quality choices, but would add a second paid submission and another recoverable task lifecycle. New objects use one integrated generation task instead.

Source: [Tripo texture endpoint](https://developers.tripo3d.ai/en/docs/models-texture).

## Implemented flow

1. Capture drawing and clean scene; create an isolated colored object image with Klein/BiRefNet.
2. Submit a single color-enabled P1 task and persist its ID before polling. Failed submissions are not automatically retried.
3. Select the finished GLB, check its container and self-contained resources, and require a connected base-color texture with UV coordinates or vertex-color attributes. Merely including an unused image does not pass this check. This verifies appearance data, not artistic fidelity to every requested detail.
4. Save the downloaded GLB unchanged. The room opens a placement preview with the sketch-derived size, retaining original materials and embedded images. The user clicks a room surface to place it; generation completion alone does not add a scene instance. IndexedDB stores the original blob, so colors survive a reload and another download.
5. Create the STL from a temporary GLB copy with appearance references removed. This avoids image decoding/DOM APIs during Node conversion. Its geometry is independently rotated and scaled for printing; the color GLB is never overwritten or altered. STL failure leaves the GLB available.
6. Preview the GLB directly in both viewers. The root preview no longer substitutes a flat material. GLB downloads remain available from the local model library after the job card is dismissed.

Three.js GLTFLoader configures the color-space treatment of glTF textures. We preserve those materials rather than applying a blanket color conversion. The root preview explicitly outputs sRGB. Texture and ImageBitmap resources are disposed when models are removed.

Sources: [Three.js color management](https://threejs.org/manual/en/color-management.html), [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html).

## Commands and compatibility

- Room viewer: `npm run dev`, then `http://localhost:5173`.
- CLI color generation: `npm run image:glb -- image.png --out tripo-output/new-color-object`.
- Explicit fastest geometry-only mode: add `--geometry-only`.
- `image:glb` produces a color GLB and geometry-only STL.
- Offline STL copy: `npm run image:glb -- --glb existing-color.glb --height-mm 100`.
- Resume a provider task: `npm run image:glb -- --task-id TASK_ID`. This retrieves existing output; it does not add color to a task originally generated without it.

The previous 13.24-second live result was a geometry-only baseline, not a color-generation promise. Color generation has an additional texture stage and depends on provider load.

## Verification

The original workspace color verification passed 55 tests and both Vite builds. The pipeline now runs as a Convex action (`convex/sketch.ts`) rather than a local Node server; run `npm test` and `npm run build`. Checks cover default color flags and explicit geometry mode, finished-versus-base model selection, rejection of colorless output, self-contained resources, binary GLB preservation through STL conversion, early GLB availability, export failure recovery, scene placement and persistence validation.

The live three-color ceramic object completed in **71.5 seconds**: image generation 15.86 s, model plus texture generation 55.60 s, STL conversion 0.013 s. These are observed timings for one object, not a controlled comparison or latency guarantee. The final `model` artifact is a 404,796-byte GLB with one embedded JPEG texture, one connected base-color material, and 4,692 triangles. Its blue, yellow and red colors were visually verified in the room, after a full reload, and in the standalone GLB preview. The geometry-only STL was also successfully exported, without changing the canonical GLB bytes.

Original workstation artifacts (generated output is not committed): `asset-output/d7943013-6680-4591-a94b-7b842f05ce70/model.glb`, `model.stl`, `job.json`, and `color-verification.json`. The manual preview fixture is `/tests/fixtures/color-preview.html?job=d7943013-6680-4591-a94b-7b842f05ce70` on the root Vite server.
