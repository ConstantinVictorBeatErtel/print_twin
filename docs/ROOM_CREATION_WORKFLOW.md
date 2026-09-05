# Room creation from images and video

## Current decision

User update, September 5, 2026: future room versions should contain **no people**. Preserve the room architecture, furniture, and layout. The user explicitly asked **not to generate a new world yet**. Only documentation and distribution of the existing room are authorized in this update; no cleanup image or replacement world has been generated.

The current room remains `b7fc3a55-8fc1-4ef0-8ac8-705c3abe7d5a`. It contains people. The process below distinguishes the working capture pipeline from the planned cleanup step.

## Where to record

For this demo, stand in an open aisle beside the chosen placement table, far enough back to see its whole top, edges, and adjacent floor. Prefer that useful viewpoint over the room's exact geometric center. Do not record while seated behind laptops or people. If the center provides a clear view of the target area, it is a good choice for broad coverage.

Hold the phone level at chest/eye height, preferably landscape. Keep the same lens, zoom, exposure, and focus throughout. Rotate slowly in place through 180–360 degrees during one continuous 20–30 second shot, with no cuts. Include the floor and table surfaces as well as the ceiling. Wait for the immediate area to be empty if possible. A clean partial sweep is more useful than a fast, blurred full rotation.

For photos, take 4–8 sharp overlapping views from approximately that same position. Use the same dimensions and orientation. Preserve recognizable overlap such as table corners, columns, and windows. Keep additional close-ups of the placement surface as references; do not automatically mix a distant close-up into the reconstruction set.

Measure one recognizable span in millimeters for scale calibration and a different nearby span for verification. Capture advice follows [World Labs video guidance](https://docs.worldlabs.ai/marble/create/prompt-guides/video-prompt) and [multi-image guidance](https://docs.worldlabs.ai/marble/create/prompt-guides/multi-image-prompt); choosing the demo table's viewpoint is our project-specific recommendation.

## Implemented pipeline

1. Preserve the original input. Make prepared JPEG copies of HEIC photos with orientation baked and metadata omitted. Make upright SDR H.264 MP4 copies of iPhone HDR videos, with audio and metadata removed.
2. Validate decoded image sizes and video duration/file size. Reconstruction uses 2–8 same-size images; video uses one continuous clip of at most 30 seconds/100 MB.
3. Record file names and SHA-256 hashes. Choose one input mode: single image, multi-image reconstruction, or video.
4. Prepare a signed upload through `POST /marble/v1/media-assets:prepare_upload`. Upload each prepared file with the returned method and headers. Keep the World Labs key on the API host only.
5. Build the world request. For multiple photos, set `world_prompt.type: multi-image` and `reconstruct_images: true`; provide the uploaded media references without inventing azimuth angles. Set `model: marble-1.1-plus` explicitly.
6. After the user resumes generation, check API credits, save submission intent, and submit `POST /marble/v1/worlds:generate` once. Save its operation ID before polling. Do not automatically repeat a paid submission after an uncertain timeout.
7. Poll the saved operation, fetch the completed world, and download every returned SPZ resolution, collider GLB, panorama, and thumbnail. Save the exact provider response locally.
8. Write the portable manifest with relative file paths, hashes, model, world ID, scale metadata, and separate splat/collider transform status. Validate file integrity and inspect output quality.
9. In the viewer, verify collider alignment and independently measured scale before using the scene to claim physical fit.

The code lives in `scripts/prepare_capture.py`, `scripts/world.mjs`, `scripts/worldlabs.mjs`, and `scripts/verify_world.py`. The existing run's observations are in [FIRST_WORLD_RESULT.md](FIRST_WORLD_RESULT.md).

## Reproducing from photos without starting generation

Install the media dependencies described in the root README, then prepare new inputs:

```sh
python3 scripts/prepare_capture.py /path/to/front.HEIC /path/to/right.HEIC /path/to/back.HEIC /path/to/left.HEIC
```

Preview the request locally:

```sh
npm run world -- generate \
  --input data/captures/prepared/front.jpg \
  --input data/captures/prepared/right.jpg \
  --input data/captures/prepared/back.jpg \
  --input data/captures/prepared/left.jpg \
  --job room-without-people-01 \
  --model marble-1.1-plus \
  --prompt "An unoccupied version of the same room. Preserve the architecture, windows, columns, lighting, furniture positions, table edges, and floor layout. No people or human silhouettes." \
  --dry-run
```

`--dry-run` performs local validation only. A text request for an unoccupied room is guidance, **not a reliable people-removal step**. Do not remove `--dry-run` while generation is on hold. Later generations are stochastic and are not guaranteed to reproduce identical geometry from the same files.

## Planned people removal

Best input: a clean capture in which the important table/floor surfaces are actually visible. Existing captures are sufficient for a visual cleanup attempt, but covered surfaces must be inferred when no reference reveals them.

For the existing room, the preferred refinement experiment is to edit its panorama first, inspect that result, and only then create a new world. World Labs documents selected-area changes and a panorama preview before the final Create world action in [Pano Edit](https://docs.worldlabs.ai/marble/edit/pano-edit). A draft edit request is:

> Remove every person, human silhouette, and reflection of a person. Preserve the existing architecture, windows, columns, ceiling beams, lighting, tables, chairs, laptops, and other stationary objects. Fill only the areas exposed by removal, using visible adjacent surfaces and reference images. Preserve the panorama projection, framing, and dimensions. Do not redesign the room or add new furniture.

Review for remaining faces/limbs, floating bags/clothing, broken chair legs, altered table edges, and inconsistent floors. Keep original and cleaned inputs separately, with edit prompt, hashes, provider/model, and review notes. Mark filled occluded areas as inferred. A cleaned image is not proof that the underlying room geometry is correct.

For a fresh multi-image set, any edits must remain consistent across overlapping views. Review all views together before submitting them. Independent edits can disagree about hidden furniture; clean capture is preferable when possible.

This cleanup stage is **documented, not implemented or run**. The current CLI treats single images as non-panoramas, so a cleaned 360-degree panorama must use Marble's supported editing workflow or a future explicitly implemented panorama input mode. Do not pass it to the current ordinary-photo command. No automated cleanup or later generation has been scheduled.

## Download and provenance

The [first room release](https://github.com/ConstantinVictorBeatErtel/print_twin/releases/tag/room-capture-2026-09-05) contains all generated binary assets, a portable manifest, validation results, generation provenance, and a separate archive of all 13 prepared source captures. The current release still contains people.

`scripts/package_room.py` packages the files without API credentials, temporary signed provider URLs, audio, or original device metadata. The original HEIC/MOV files remain local and untouched. Asset SHA-256 checksums permit verification after download. This repository and its release downloads are public; the original Marble world itself keeps its existing account permissions.
