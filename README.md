# Print the World

The first implementation is a local World Labs capture-to-world pipeline plus a laptop/phone room viewer. The product architecture is in [HACKATHON_PLAN.md](HACKATHON_PLAN.md). Convex persistence, AI object generation, and printing are later stages.

## Website

### Capture entry flow

The web app opens on a small capture screen. Choose one photo or video (or use the phone's native camera buttons), then select **Create my world**. The Vite server saves the upload, starts the existing World Labs CLI with `marble-1.1-plus`, and exposes the persisted job at `/api/capture/:job`. The browser polls that job through uploading, generating, and opening states, then enters the generated room at `/?job=<job>`.

The capture endpoint is a local development seam: the World Labs key stays server-side in `.env.local`, and the generated job plus downloaded assets stay under ignored `data/` paths. It intentionally supports one image or one video so the entry path stays small.

The underlying viewer still supports the checked-in demo world at `data/worlds/hackathon-room-video-01` when opened with `/?job=hackathon-room-video-01`.

```sh
cd web && npm install && npm run dev
# or from repo root: npm run web
```

Open `http://localhost:5173`. Click the canvas to look, WASD to move, Q/E for up/down, then **Draw** to freeze the view and sketch. Phone layout (100k splat, touch look + joystick): `http://localhost:5173/m` or `http://<lan-ip>:5173/m`.

If the world is missing, the UI shows: generate it with `npm run world -- resume --job hackathon-room-video-01`.

## iPhone (Expo shell)

The native app is an Expo WKWebView around the phone web layout at `/m`. Spark cannot run in React Native; do not put `three` or `@sparkjsdev/spark` in `mobile/`.

1. On the laptop, start the website with LAN bind (`npm run web` already uses `server.host: true`).
2. Find the laptop IP: `ipconfig getifaddr en0`.
3. Phone and laptop on the same Wi-Fi.
4. Start Expo:

```sh
cd mobile && npm install && npx expo start
# or from repo root: npm run mobile
```

5. Open in Expo Go and set the viewer URL to `http://<lan-ip>:5173/m` (not `localhost` — that is the phone itself). App Transport Security allows LAN HTTP for this demo.

## Setup

Requires Node 22+, Python 3, and these media helpers (HEIC conversion uses macOS `sips`):

```sh
python3 -m pip install -r requirements-media.txt
cp .env.example .env.local
```

Set `WORLDLABS_API_KEY` in `.env.local` using a key from [World Labs Platform](https://platform.worldlabs.ai). API billing is separate from Marble website credits. Keep the key server-side. `.env.local`, captures, and downloaded worlds are ignored by Git.

```sh
npm run world -- credits
python3 scripts/prepare_capture.py /absolute/path/to/capture.MOV
npm run world -- generate --input data/captures/prepared/capture.mp4 --job room-01 --dry-run
npm run world -- generate --input data/captures/prepared/capture.mp4 --job room-01
```

`generate` spends API credits. Its default model is `marble-1.1-plus`; video and multi-image generation are currently 1,600–3,100 credits ($1.28–$2.48). The CLI requires enough prepaid balance for the documented maximum before submitting. This is a local preflight, not a provider spending cap; simultaneous usage elsewhere can change the balance. `--model marble-1.1` is a fixed 1,600-credit video/multi-image alternative. [Pricing](https://docs.worldlabs.ai/api/pricing).

The initial authorized run uses `data/captures/prepared/IMG_6872.mp4`, job `hackathon-room-video-01`. Inspect or resume it with:

```sh
npm run world -- resume --job hackathon-room-video-01
```

This run completed successfully. [Result and quality assessment](docs/FIRST_WORLD_RESULT.md).

[Download the full room and prepared captures](https://github.com/ConstantinVictorBeatErtel/print_twin/releases/tag/room-capture-2026-09-05). The release includes the full-resolution splat and all other returned room assets. [Capture-to-world workflow and planned people removal](docs/ROOM_CREATION_WORKFLOW.md). The current room contains people; the next version should be unoccupied, and new generation is currently on hold at the user's request.

The CLI waits up to 20 minutes by default. `--wait 0` submits and checks once; `resume` continues polling/downloading using the saved operation, without creating another world. `--poll` accepts 1–60 seconds. A completed job exits immediately.

## Other input modes

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

Accepts 2–8 images with identical dimensions. No fabricated azimuths are supplied. One video and multiple images are separate API input modes; videos are not concatenated or mixed with stills. Single-image inputs are explicitly treated as ordinary photos, not panoramas. Text-only, panorama, and HQ mesh export workflows are outside this first implementation.

## Outputs

Each job creates `data/worlds/JOB/`:

- `job.json`: input hashes, uploaded media IDs, exact generation request, operation ID, status, and before/after credit observations.
- `world.json`: original provider response, including asset URLs and semantics.
- `manifest.json`: portable integration record with relative asset paths, byte sizes, SHA-256 checksums, model, world ID, and coordinate metadata.
- `assets/`: all returned SPZ resolutions (the first run includes 100k, 150k, 500k, and full resolution); GLB collider; panorama; thumbnail (when returned).

Working files remain local and ignored by Git. The first room's binary assets and prepared inputs are also distributed in the public GitHub release linked above, as requested; raw provider responses and credentials remain local. To display a world later, store the assets in the chosen application storage and map manifest paths to URLs. Start the laptop viewer with the 500k SPZ in Three.js + Spark; keep the collider separate. No provider key is needed to render already downloaded assets.

`splatToApp` applies provider metric scale, then ground offset, then a 180-degree X rotation. It is a column-major matrix. Missing/invalid metadata produces a null matrix. `colliderToApp` deliberately stays null until collider/splat landmark alignment is verified. `calibration: unmeasured` means provider metric metadata has not been checked against physical measurements. Do not enable measured placement just because the generation succeeded. [Rendering reference](https://docs.worldlabs.ai/api/rendering-spz).

## Failure recovery

Uploads and downloads are checkpointed; completed downloads are reused after checking their hashes. Generation POSTs are not automatically retried. If a request timed out after submission, `job.json` remains `submitting` and the CLI refuses to submit again. Inspect the Platform for that operation and attach it:

```sh
npm run world -- resume --job room-01 --operation OPERATION_ID
```

Only attach the operation belonging to that capture. Failed provider operations remain failed; a new job name is an explicit new paid attempt. If the CLI is killed, a `.lock` file can remain; verify its recorded PID is no longer running before removing it. This local CLI is not yet a shared job queue.

```sh
npm test
python3 scripts/verify_world.py data/worlds/hackathon-room-video-01
```

Tests cover request mode validation, coordinate transforms, API credential isolation, generation/download/resume behavior, corrupted download recovery, insufficient credits, provider failures, and ambiguous submission handling. The verifier checks saved checksums, SPZ headers (and gzip CRC for legacy files), GLB structure, and image decoding. Capture assessment and source links: [docs/CAPTURE_REVIEW.md](docs/CAPTURE_REVIEW.md).
