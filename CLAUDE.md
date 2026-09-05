# Spatial Hack starter — context for coding agents

One-day hackathon (World Labs × Tripo × mint.gg × Convex). Goal: ship a 2-minute demo by 6 PM. Bias to working code over abstractions.

This repo holds two halves: the **capture CLI** (`scripts/`, `tests/`) that turns a
phone capture into a World Labs room, and the **web app** (`src/`, `convex/`) that
renders it. `README.md` covers both; `HACKATHON_PLAN.md` has the product architecture.

## Read first
- `HACKATHON_PLAN.md` — product concept, architecture review, scope decisions
- `docs/ROOM_CREATION_WORKFLOW.md` — capture → world pipeline, people removal
- `docs/00-hackathon-prep-sheet.md` — event, tracks, judging, idea list, day plan
- `docs/01-worldlabs.md` — Marble World API (worlds → .spz splats + collider .glb), Spark renderer
- `docs/02-tripo.md` — Tripo v3 API (text/image → GLB, rig, convert). URLs expire in 5 min.
- `docs/03-mint.md` — mint.gg API/MCP + Three.js agent skills
- `docs/04-convex.md` — Convex concepts, components, multiplayer rules

## Stack
Vite + React 19 + TypeScript · react-three-fiber + drei · `@sparkjsdev/spark` (Gaussian splats) · Convex (backend, storage, realtime).
All third-party API calls happen in **Convex actions** (`convex/worlds.ts`, `convex/assets.ts`) so keys stay server-side. Generated assets are cached into Convex file storage; the client only ever loads Convex storage URLs.

## Commands
```
npm install
python3 -m pip install -r requirements-media.txt   # capture CLI media helpers
npm run world -- credits                           # World Labs CLI (needs WORLDLABS_API_KEY in .env.local)
npm test                                           # capture CLI + Convex/client integration tests
npx convex dev                     # first run: login + create deployment, writes .env.local
npx convex env set WLT_API_KEY ... ; npx convex env set TRIPO_API_KEY ... ; npx convex env set MINT_API_KEY ...
npm run dev                        # convex dev + vite
```
Multiplayer test: open two tabs at `http://localhost:5173/?room=test`, click "join multiplayer" in both.

## Conventions
- Coordinates: Marble splats/colliders are OpenCV (+y down) → `scale=[s,-s,-s]` (via `worldTransform` in `SplatWorld.tsx`). Metric scale via `metricScale`/`groundOffset`, read off the world document — never hardcode them.
- GLB loading: always through `gltfLoader` in `src/components/Asset.tsx` (Draco + meshopt decoders attached).
- Multiplayer: one doc per player, ≤5–10 Hz mutations, lerp remote players. Never send per-frame mutations.
- Generation is slow (Tripo 10–120s, Marble 1–5 min): kick it off early, show status in UI, never block the render loop.
- Keep the demo path (`src/App.tsx`) working at all times; put experiments behind `?feature=` flags.

## Capture integration
`src/App.tsx` hosts the Galatea capture entry and three-second demo transition, then
hands off to `src/WorldApp.tsx` — the first-person room viewer. `src/lib/ConvexProjectClient.ts`
bridges saved CLI manifests and `readWorldZip` results into Convex storage via
`api.worlds.importUploaded`. Demo entry reuses the saved stage world, with indexed
provider-world-ID lookup and duplicate prevention; it does not generate from the selected
capture. The URL's `world` is the Convex ID and default room ID; legacy `job` URLs import
through the same bridge.

Root `vite.config.ts` serves only saved `/world-assets/` files. `web/src/` is legacy code,
not a second active viewer. A fresh backend needs the saved local assets or a ZIP import;
neither backend data nor room binaries are in Git.

## The room viewer (`src/WorldApp.tsx`)
Navigation is first-person (`LocalWalk.tsx`: pointer lock, WASD/arrows, Q/E, Shift, H to
release) — there is no OrbitControls. Room geometry, the object library, placements and
players all come from Convex; nothing is stored in IndexedDB.

- Placement: `src/lib/surfacePick.ts` raycasts the Marble collider for a real triangle
  normal (inverse-transpose normal matrix, flipped toward the camera), falls back to two
  probe rays against the splat, and `orientTo` stands the object's +Y on that normal.
  `plane` is disabled — a miss places nothing rather than inventing a depth. Do not
  "simplify" this; it is what makes objects land on tables.
- Sizes: `fit.ts` normalizes every GLB so its longest dimension is `targetSize` metres and
  its bottom-centre sits at the anchor. `PlacementGhost` and `Asset` run identical maths,
  so a committed object does not jump.
- Sketching: `DrawingLayer` freezes the frame, `drawingPlacement.ts` anchors the drawing's
  bottom-centre to a surface and stores the camera matrices; `fitDrawing` uses them to
  estimate a size. The anchor's *position* is deliberately discarded — you still click
  where the object goes.
- Undo/redo is an inverse-operation stack (`src/lib/placementHistory.ts`), not array
  snapshots: placements are shared, so replaying a snapshot would revert other players.

## Sketch -> object pipeline
`assets.startSketch` (mutation) validates keys, inserts the row, returns its id and
schedules `internal.sketch.run` (`"use node"`). That action reuses the CLI modules
verbatim — `scripts/image-benchmark/providers.mjs` for fal Klein + BiRefNet,
`scripts/glb-assets.mjs` for `inspectGlb`/`modelArtifact` — plus `convex/tripo.ts`, which
is a copy of the four Tripo helpers from `scripts/image-to-stl.mjs` (copied, not imported,
to keep three.js out of the Convex bundle). `convex/pipeline-modules.d.ts` types both JS
modules. Progress is patched onto the asset row, so the client watches it with `useQuery`
instead of polling. STL export runs in the browser (`src/lib/stlExport.ts`).

Needs `FAL_KEY` and `TRIPO_API_KEY` in the Convex environment. The Tripo endpoint here is
`api.tripo3d.ai/v2/openapi`, not the `openapi.tripo3d.ai/v3` one used by the older
`assets.generateFromText`/`generateFromImage` actions.

## Where to extend
- NPC/agent: `npm i @convex-dev/agent ai @ai-sdk/anthropic`, enable in `convex/convex.config.ts`, add `convex/npc.ts`.
- Presence UI: `npm i @convex-dev/presence`.
- Physics/walking: `npm i @react-three/rapier`, use the collider GLB as a `TrimeshCollider`.
- First-person controls: drei `PointerLockControls` + raycast against `userData.collider` meshes for ground height.
- Mint assets: install `mintdotgg/mint-threejs-skills` and use `mint-assets.json` + sync script per the skill.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
