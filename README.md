# Print the World

> **Working local drawing-to-3D viewer:** `npm ci` → `npm run dev:local` → open [localhost:5174/local.html](http://127.0.0.1:5174/local.html). Use the gear icon to enter your fal and Tripo keys. The room and pipeline are included; no Convex setup is needed. See [Draw directly into the placement viewer](#draw-directly-into-the-placement-viewer).


Capture the room you are standing in, explore a generated 3D version of it, sketch
objects into your view, and prepare what you like for a physical 3D print.
Product architecture and scope decisions are in [HACKATHON_PLAN.md](HACKATHON_PLAN.md).

The repo now holds two halves of that pipeline:

| Part | Path | What it does |
| --- | --- | --- |
| Capture CLI | `scripts/`, `tests/` | Local World Labs capture-to-world pipeline. Turns a phone video or photos into a room splat + collider, checkpointed and resumable. |
| Web app | `src/`, `convex/` | React 19 + Three.js/Spark viewer that renders the room, with Convex for state, storage, and multiplayer. Third-party API calls run in Convex actions so keys stay server-side. |

`docs/` carries both the capture write-ups and the per-vendor API references.
See `CLAUDE.md` for the agent-oriented overview.

## Setup

Requires Node 22+ and Python 3 (HEIC conversion uses macOS `sips`).

```sh
npm install
python3 -m pip install -r requirements-media.txt
cp .env.example .env.local
```

Set `WORLDLABS_API_KEY` in `.env.local` using a key from
[World Labs Platform](https://platform.worldlabs.ai). API billing is separate from
Marble website credits. Keep the key server-side. `.env.local`, captures, and
downloaded worlds are ignored by Git.

## Capture a room

```sh
npm run world -- credits
python3 scripts/prepare_capture.py /absolute/path/to/capture.MOV
npm run world -- generate --input data/captures/prepared/capture.mp4 --job room-01 --dry-run
npm run world -- generate --input data/captures/prepared/capture.mp4 --job room-01
```

`generate` spends API credits. Its default model is `marble-1.1-plus`; video and
multi-image generation are currently 1,600–3,100 credits ($1.28–$2.48). The CLI
requires enough prepaid balance for the documented maximum before submitting. This
is a local preflight, not a provider spending cap; simultaneous usage elsewhere can
change the balance. `--model marble-1.1` is a fixed 1,600-credit video/multi-image
alternative. [Pricing](https://docs.worldlabs.ai/api/pricing).

The initial authorized run uses `data/captures/prepared/IMG_6872.mp4`, job
`hackathon-room-video-01`. Inspect or resume it with:

```sh
npm run world -- resume --job hackathon-room-video-01
```

This run completed successfully.
[Result and quality assessment](docs/FIRST_WORLD_RESULT.md).
[Download the full room and prepared captures](https://github.com/ConstantinVictorBeatErtel/print_twin/releases/tag/room-capture-2026-09-05).
The release includes the full-resolution splat and all other returned room assets.
[Capture-to-world workflow and people removal](docs/ROOM_CREATION_WORKFLOW.md).
The original room contains people. The user subsequently supplied a stage-view
capture and authorized proceeding: `hackathon-stage-no-people-01` is complete,
using five cleaned photos. Its panorama shows no visible people and faces into
the hall from the demo stage.
[Open the stage world](https://marble.worldlabs.ai/world/82f39764-5224-4574-8328-8a747f42ed3e),
[download its full assets and cleaned inputs](https://github.com/ConstantinVictorBeatErtel/print_twin/releases/tag/stage-room-2026-09-05),
or read the [generation and quality record](docs/STAGE_WORLD_RESULT.md).

The latest version adds three cleaned rear-stage photos, completing an eight-view
reconstruction with the screen, cabinet, exit sign and plants behind the stage.
[Open the updated room](https://marble.worldlabs.ai/world/262dd7ba-d156-46a1-8445-f62bc60e1265),
[download full assets and all inputs](https://github.com/ConstantinVictorBeatErtel/print_twin/releases/tag/stage-rear-2026-09-05),
or read the [rear capture and quality record](docs/STAGE_REAR_UPDATE.md).
No people are visible in its panorama; physical calibration and browser navigation
remain unverified.

The CLI waits up to 20 minutes by default. `--wait 0` submits and checks once;
`resume` continues polling/downloading using the saved operation, without creating
another world. `--poll` accepts 1–60 seconds. A completed job exits immediately.

### Other input modes

Single image:

```sh
npm run world -- generate --input data/captures/prepared/IMG_6879.jpg --job room-image-01
```

Multiple images of one space, in reconstruction mode:

```sh
npm run world -- generate \
  --input data/captures/prepared/IMG_6873.jpg \
  --input data/captures/prepared/IMG_6874.jpg \
  --input data/captures/prepared/IMG_6875.jpg \
  --input data/captures/prepared/IMG_6876.jpg \
  --job room-photos-01 --dry-run
```

Accepts 2–8 images with identical dimensions. No fabricated azimuths are supplied.
One video and multiple images are separate API input modes; videos are not
concatenated or mixed with stills. Single-image inputs are explicitly treated as
ordinary photos, not panoramas. Text-only, panorama, and HQ mesh export workflows
are outside this first implementation.

### Outputs

Each job creates `data/worlds/JOB/`:

- `job.json`: input hashes, uploaded media IDs, exact generation request, operation ID, status, and before/after credit observations.
- `world.json`: original provider response, including asset URLs and semantics.
- `manifest.json`: portable integration record with relative asset paths, byte sizes, SHA-256 checksums, model, world ID, and coordinate metadata.
- `assets/`: all returned SPZ resolutions (the first run includes 100k, 150k, 500k, and full resolution); GLB collider; panorama; thumbnail (when returned).

Working files remain local and ignored by Git. The first room's binary assets and
prepared inputs are also distributed in the public GitHub release linked above, as
requested; raw provider responses and credentials remain local. To display a world
later, store the assets in the chosen application storage and map manifest paths to
URLs. Start the laptop viewer with the 500k SPZ in Three.js + Spark; keep the
collider separate. No provider key is needed to render already downloaded assets.

`splatToApp` applies provider metric scale, then ground offset, then a 180-degree X
rotation. It is a column-major matrix. Missing/invalid metadata produces a null
matrix. `colliderToApp` deliberately stays null until collider/splat landmark
alignment is verified. `calibration: unmeasured` means provider metric metadata has
not been checked against physical measurements. Do not enable measured placement
just because the generation succeeded.
[Rendering reference](https://docs.worldlabs.ai/api/rendering-spz).

### Failure recovery

Uploads and downloads are checkpointed; completed downloads are reused after
checking their hashes. Generation POSTs are not automatically retried. If a request
timed out after submission, `job.json` remains `submitting` and the CLI refuses to
submit again. Inspect the Platform for that operation and attach it:

```sh
npm run world -- resume --job room-01 --operation OPERATION_ID
```

Only attach the operation belonging to that capture. Failed provider operations
remain failed; a new job name is an explicit new paid attempt. If the CLI is killed,
a `.lock` file can remain; verify its recorded PID is no longer running before
removing it. This local CLI is not yet a shared job queue.

## Run the web app

### Local room placement editor

`npm run dev:local` opens a server at `http://127.0.0.1:5174`; visit
`/local.html` for the full-resolution room and local object placement, without
Convex or API keys. `npm run build:local` checks and builds this entry point into
`dist-local`. The existing Convex application remains at the normal root entry.

This checkout has the verified `stage-rear-2026-09-05` release's
`assets/splat-full_res.spz` and `assets/collider.glb` under `public/room/`, plus the generated pot at `public/models/plantpot.glb`. These three runtime assets are included in this branch; capture manifests and generated job outputs stay local.

- Import self-contained `.glb` files, or choose **Place** beside the supplied pot.
- Move the cursor over the room to preview placement; click to commit. Scroll to
  resize, set a rotation in the panel, and press Esc or right-click to cancel.
- Select placed objects in the list or scene to move, resize, rotate, adjust
  position, place another instance, or remove them. Undo and redo cover placements
  and edits in the current session. Moving preserves the object's size and rotation.
- Objects and imported model files are saved in this browser's IndexedDB for this
  room and restored after reload. Keep the same origin/port; clearing browser site
  data removes these local scenes. Saving failures are displayed in the panel.
- Click to capture the mouse for 360° looking; H releases it. WASD/arrows walk, Q/E change elevation, and Shift speeds up movement.

Placement prefers the room collider and falls back to splat raycasting. No guessed
ground plane is used. **Surface inspection** reveals the collider wireframe to
check alignment. Coordinates and object sizes use the original room units; this
is visual placement, with no collision or physical calibration. Local drawing generation uses the Settings keys. Multiplayer uses the separate Convex application below.

### Convex application

```sh
npx convex dev            # login, creates deployment, writes .env.local (VITE_CONVEX_URL)
npx convex env set WLT_API_KEY <key>
npx convex env set TRIPO_API_KEY <key>
npm run dev               # http://localhost:5173/?room=lobby
```

Backend secrets are set on the Convex deployment, not read from `.env.local`. Sanity
check without any API keys: the scene renders a grid; once a world is generated (or
imported with `api.worlds.importExisting` from the Convex dashboard using a
`world_id` made in the Marble app), it replaces the grid. Multiplayer test: open two
tabs at `http://localhost:5173/?room=test` and click "join multiplayer" in both.

The web half was written ahead of the event from public docs and has not yet been
run against a live deployment — expect to fix a type or two on first build. Wiring
the capture CLI's `manifest.json` output into Convex storage is the open seam
between the two halves.

## Tests

```sh
npm test
python3 scripts/verify_world.py data/worlds/hackathon-room-video-01
```

Tests cover request mode validation, coordinate transforms, API credential
isolation, generation/download/resume behavior, corrupted download recovery,
insufficient credits, provider failures, and ambiguous submission handling. The
verifier checks saved checksums, SPZ headers (and gzip CRC for legacy files), GLB
structure, and image decoding. Capture assessment and source links:
[docs/CAPTURE_REVIEW.md](docs/CAPTURE_REVIEW.md).


## Draw directly into the placement viewer

This branch includes the room splat, collider, starter model and full generation server. No parent workspace is required. Use Node **22.18+** (or Node 24):

```sh
npm ci
npm run dev:local
```

Open **http://127.0.0.1:5174/local.html**, then click the gear icon for **Settings**. Enter **FAL_KEY** (fal images/background removal) and **TRIPO_API_KEY** (Tripo color models). Tripo CLI login can supply the Tripo key instead. No OpenAI, World Labs, Mint, Anthropic or Convex key is needed for this local viewer with its bundled room. Those services belong to the optional capture CLI / multiplayer app described elsewhere in this README.

Settings save immediately to `.local/api-keys.json` on the local server with owner-only file permissions. They are not encrypted at rest; protect access to this computer. The file, `.env.local`, generated jobs, and outputs are ignored by Git. The browser receives only configured/missing status; input values are cleared after save. Leave a field blank to preserve its key, or choose **Remove saved key** to return to an environment/CLI fallback. Local settings override server environment values; `.env.local` is also supported and requires a server restart when edited manually. Saving through the modal requires no restart or generation request.

The settings endpoint accepts only same-origin requests on loopback. This is a single-user local server, not a hosted multi-user credential service; keep the provided localhost binding. Both dev and `npm run preview:local` supply the generation API. `npm run build:local` produces the viewer build. A static host alone cannot run generation.

Generation code and results now live at `server/asset-pipeline.js` and `asset-output/` inside this repository.

1. Click the room to capture and hide the mouse for continuous 360° turning; use WASD / arrows to walk, Q/E to fly and Shift to move faster.
2. Press **H** to release the mouse (or **Esc**), then **Draw an object**. Drawing freezes navigation and overlays the exact current view.
3. Sketch the object with its bottom touching a table, floor or wall. The green dot identifies the contact point; no generation starts without a real room/splat surface hit.
4. Describe the object and choose **Create in room**. The fast Klein → background removal → Tripo P1 pipeline runs in the background. Press H or click **Resume look** to recapture the mouse and explore while waiting. Browser pointer lock needs this click/key gesture; drawing and placement release it automatically.
5. As soon as the GLB is available, mouse look pauses and the object enters the placement preview in your hand, before STL export finishes. Move over a room surface and click to place; scroll to resize or Esc/right-click to cancel. Cancelled previews remain in the model library. Color GLB and geometry-only 100 mm print-height STL downloads appear in the result card. **Objects** opens import, Place, selection, transforms, undo and redo.

The sketch's bottom-centre ray, saved camera projection and generated mesh bounds suggest an initial size. Final position comes from the surface under the cursor when you click, using the existing upright/rotation placement controls. A single drawing cannot uniquely specify depth: accuracy follows the reconstructed collider (or approximate splat fallback), and the model's proportions determine its final silhouette. Move/scale controls remain available for adjustment.

Model blobs and scene placements persist in IndexedDB. The generation ID, camera and anchor are saved before submission; a reload reconnects by ID and never submits another paid generation. Network failures expose Reconnect; saved provider tasks expose Resume task. Dismiss recovery stops tracking that result, not server-side generation. A completed model is added to the library only once. Generation completion does not change placements or undo history; only clicking the preview places an instance. Reloaded library models can be picked up again with Place.

Performance: fixed 1× display resolution, 500k visible splat LOD budget from the full-resolution room, paused 3D rendering during drawing, capped snapshot dimensions, 500 ms status polling, immediate GLB placement preview and standard color textures on P1 with extra PBR maps disabled. Generation time varies by provider load. The earlier geometry-only annotated-pot test on 2026-09-05 finished in approximately 13 seconds (not a promise for textured generation), with placement, download links and undo/redo verified.

Validation: `npm test` covers API settings, the generation API, GLB color preservation, surface anchoring, captured-camera fitting, persistence and undo/redo; `npm run build:local` type-checks and builds the placement viewer. `vite preview --config vite.local.config.ts` inside `github-main` serves the built local viewer and the same API; a static file host alone does not provide generation endpoints.


Color preservation: new jobs generate standard image-aligned textures and retain the finished GLB unchanged. Scene models and the root viewer preview use the original embedded materials. The model library also exposes GLB downloads after reload. STL remains a separate no-color print derivative. Existing gray objects remain gray. Research and implementation notes: [COLOR_PIPELINE.md](COLOR_PIPELINE.md).
