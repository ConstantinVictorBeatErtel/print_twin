# Spatial Intelligence + Generative 3D Hackathon — Prep Sheet

World Labs × Tripo × mint.gg × Convex.dev · Saturday Sept 5, 2026 · SF
Hacking window: 10:00 AM → 6:00 PM (8 hours). Demo: 2 minutes per team. Judged per track.

---

## 0. The one-paragraph mental model

All four sponsors slot into one pipeline, and the winning demos will show the whole pipeline end to end:

```
prompt / photo ──► World Labs (Marble)  ──► explorable world (Gaussian splat .spz + collider .glb)
prompt / photo ──► Tripo                ──► game-ready objects (.glb, optionally rigged/animated)
                   mint.gg              ──► agentic generation via MCP + Three.js "skills" + CDN assets
                   Convex               ──► real-time multiplayer state, agents, storage, scheduling
                   Three.js + Spark     ──► the browser renders all of it
```

mint.gg is **not** a game engine — it's an AI agent + REST/MCP API for generating 3D content and an open-source set of Three.js agent skills. The "playable experience" is *your own* Three.js web app (vanilla or React Three Fiber), which is exactly what the starter repo sets up.

---

## 1. The four APIs — what each one is for

### World Labs — Marble / World API
| | |
|---|---|
| Purpose | Text / image / multi-image / 360° pano / video → a navigable 3D world. Output = Gaussian splats (`.spz` at full / 500k / 100k), an auto-generated **collider mesh** (`.glb`, usable for physics + raycasts), a 2560×1280 equirect pano, and optional textured HQ mesh export. |
| Base URL | `https://api.worldlabs.ai/marble/v1` |
| Auth | Header `WLT-Api-Key: <key>` — keep it server-side |
| Flow | `POST /worlds:generate` → `operation_id` → poll `GET /operations/{id}` every ~5s until `done` → `GET /worlds/{world_id}` for asset URLs |
| Models | `marble-1.0-draft` (fast, cheap ≈ $0.18), `marble-1.1` (≈ $1.26, ~5 min), `marble-1.1-plus` (bigger/outdoor) |
| Rendering | **Spark** (`@sparkjsdev/spark`, open-source Three.js splat renderer by World Labs). Load `spz_urls["500k"]` into `SplatMesh`. Coordinates are OpenCV (+y down) → flip with `mesh.scale.set(1,-1,-1)`. |
| Pricing | Prepaid credits only, $1 = 1,250 credits, min $5. **No free API tier** — event keys/credits will be handed out at check-in. PLY export + polling are free. |
| Signup | Marble app: https://marble.worldlabs.ai · API console + keys: https://platform.worldlabs.ai |
| Docs | https://docs.worldlabs.ai · LLM index: https://docs.worldlabs.ai/llms.txt · Examples: https://github.com/worldlabsai/worldlabs-api-examples · Agent skill: `npx skills add worldlabsai/marble-developer-api-skill --skill marble-developer-api` |
| Also | **Atlas** (announced Sept 1, 2026) — early access only, don't plan on it. **RTFM** — demo only, no API. |

### Tripo — 3D asset generation
| | |
|---|---|
| Purpose | Text→3D, image→3D, multiview→3D; then re-texture (PBR), convert (GLB/FBX/OBJ/USDZ/STL), quad remesh, smart low-poly, part segmentation, **auto-rig + animation retarget**. |
| Base URL | `https://openapi.tripo3d.ai/v3` (v3 is current; v2 at `api.tripo3d.ai/v2/openapi` still works) |
| Auth | `Authorization: Bearer tsk_…` |
| Flow | `POST /generation/text-to-model` (or `image-to-model`) → `task_id` → poll `GET /tasks/{id}` every 2s → `output.model_url`. **Model URLs expire in 5 minutes — download immediately** (the starter repo stores them in Convex file storage). |
| Models | `P1-20260311` — game-ready low-poly, ~10s untextured / ~60s textured. `v3.1-20260211` (H3.1) — high fidelity PBR, ~40s / ~120s. |
| SDKs | `npm i tripo3d-sdk-js` (v3), `pip install tripo3d`, `npm i -g tripo-cli`, MCP: `uvx tripo-mcp`. Plugins for Unity/Unreal/Blender/Godot. |
| Pricing | 1 credit = $0.01. **300 free credits on signup** (2-week expiry) ≈ 10–15 textured models. P1 text→3D ≈ 30–60 credits; H3.1 ≈ 10–30. Rig ≈ 25. |
| Signup | https://platform.tripo3d.ai → API Keys (shown once) |
| Docs | https://developers.tripo3d.ai/en/docs/quick-start · SDK: https://github.com/VAST-AI-Research/tripo-js-sdk |
| Gotcha | GLBs are meshopt-compressed by default — set `MeshoptDecoder` on your GLTFLoader (done in starter). |

### mint.gg — agentic 3D generation + Three.js skills
| | |
|---|---|
| Purpose | Chat/agent that generates models, **worlds (Gaussian splats — appears to be World Labs under the hood)**, asset packs, PBR materials, images, audio, rigging/animation. Plus open-source agent skills that teach Claude Code / Cursor / Codex how to build Three.js experiences with Mint assets. |
| REST | `https://api.mint.gg/v1`, Bearer key from https://platform.mint.gg. `POST /v1/models:generate`, `/v1/worlds`, `/v1/pricing:estimate`; poll `/v1/operations/{id}`. |
| MCP | `https://mcp.mint.gg/mcp` (OAuth, 47 tools). Claude Code / Codex / Cursor install instructions on that page. |
| Skills | `npx skills add mintdotgg/mint-threejs-skills -a claude-code -g -y` — sets convention: TS + Vite + Three.js, `mint-assets.json` + `scripts/sync-mint-assets.mjs`, **Draco-capable GLTFLoader required**. |
| Formats | Models: GLB. Worlds: PLY / SPZ / RAD + collider GLB + pano. |
| Pricing | **5,000 welcome credits** on signup; redemption codes under Account → Redeem (expect a hackathon code). Smart topology 394 credits, optimization 20; estimate everything else via `pricing:estimate`. |
| Examples | https://play.mint.gg (50+ Three.js games, all open source: https://github.com/mintdotgg/mint-playground) · R3F template: https://github.com/mintdotgg/3d-web-starter · SIGGRAPH 2026 hackathon guide (best quickstart): https://docs.mint.gg/events/world-model-genai-hackathon-siggraph2026.md |
| Not there | No CLI, no npm SDK, no in-app scripting, no multiplayer → **Convex is the multiplayer layer.** |

### Convex.dev — real-time backend
| | |
|---|---|
| Purpose | Reactive database + TypeScript functions. Every `useQuery` is a live subscription; mutations are ACID transactions; actions call external APIs (World Labs, Tripo, LLMs); scheduler + crons; file storage; vector search; auth. |
| Quickstart | `npm create convex@latest` or `npm i convex && npx convex dev` (creates dev deployment, writes `.env.local`, codegens `convex/_generated`). |
| Components | `@convex-dev/agent` (persistent LLM agents/NPCs with threads + tools), `@convex-dev/presence` (who's in a room), `@convex-dev/rate-limiter`, `@convex-dev/workflow` (durable multi-step pipelines — perfect for generate→poll→store), `@convex-dev/sharded-counter`, `@convex-dev/aggregate` (leaderboards). Register in `convex/convex.config.ts`. |
| Multiplayer rules | Don't send 60 Hz mutations. 1–10 Hz per client, one doc per player, one shared room query, lerp remote positions client-side, optimistic updates for local player. AI Town pattern for server-authoritative sims: one scheduled mutation/sec simulates 60 ticks and writes a history buffer. |
| Free tier | 1M function calls/mo, 0.5 GB DB, 1 GB files — plenty for one day if you throttle. Pro is $25/dev/mo (that's the giveaway "membership"). |
| MCP | `npx -y convex@latest mcp start` — lets Claude Code inspect tables, run functions, read logs. |
| Docs | https://docs.convex.dev · https://stack.convex.dev/building-a-multiplayer-game · https://github.com/get-convex/multiplayer-cursors · https://github.com/a16z-infra/ai-town |
| Gotcha | Convex 1.39 (May 2026) had a bad release; if `npm create convex` misbehaves, pin `convex@latest` explicitly or a known-good version. Chef (their AI app builder) is being sunset — don't build on it. |

---

## 2. Accounts & setup to-do (do tonight)

Everything below is free. Event API keys come at check-in, but having accounts already means keys can be dropped straight into `.env`.

**Accounts**
- [ ] World Labs — Marble app account at https://marble.worldlabs.ai (free plan, ~4 worlds/mo in-app). Then sign in to https://platform.worldlabs.ai. *Don't buy API credits yet — wait for the event key.* Optionally pre-generate 2–3 worlds in the Marble app tonight using your free credits so you have assets even if the API is slow tomorrow.
- [ ] Tripo — https://platform.tripo3d.ai → create API key (300 free credits). Generate one test asset tonight to confirm the pipeline.
- [ ] mint.gg — sign in at https://mint.gg, then https://platform.mint.gg → API key. Connect MCP at https://mcp.mint.gg (OAuth). 5,000 welcome credits.
- [ ] Convex — https://dashboard.convex.dev (GitHub login). Run `npx convex dev` once in the starter repo so a dev deployment exists.
- [ ] LLM key for NPC/agent features — Anthropic or OpenAI key (Convex agent component uses the Vercel AI SDK; either works).
- [ ] GitHub repo for the project (judges + teammates).
- [ ] Check whether the event has a Discord/Luma/Devpost submission page and register.

**Local machine**
- [ ] Node ≥ 20, pnpm or npm, Python 3.11+ (only if you want `tripo-mcp`/`uvx`).
- [ ] Clone the starter repo (attached zip) → `npm install` → `npx convex dev` → `npm run dev`. Confirm a splat renders (use a public sample `.spz` from https://sparkjs.dev/examples/ if you don't have a world yet).
- [ ] Claude Code / Cursor: install the three agent skills — `npx skills add mintdotgg/mint-threejs-skills -a claude-code -g -y`, `npx skills add worldlabsai/marble-developer-api-skill --skill marble-developer-api`, and the Convex MCP (`npx -y convex@latest mcp start`).
- [ ] Bookmark: docs.worldlabs.ai/llms.txt, docs.mint.gg/llms.txt, docs.convex.dev, developers.tripo3d.ai.
- [ ] Charger, HDMI/USB-C adapter for demo, phone hotspot fallback (venue Wi-Fi + 100 people + splat downloads = pain).
- [ ] Screen recorder (QuickTime / OBS) — record a backup demo video by 5:30 PM no matter what.

---

## 3. Hackathon idea list

Ideas are grouped by track, with the YC Fall 2026 RFS theme they map to and a feasibility rating for an 8-hour build. ★★★ = confidently demoable solo in a day; ★★ = needs a teammate or tight scope; ★ = ambitious.

### Top 3 recommendations (best fit for you + sponsors + judging)

**1. "Are You Here?" — spatial proof-of-humanness** (Physical AI / Simulation, or Creative) · YC: *Proving You're Human* · ★★★
A world model generates a never-seen-before 3D space; a person must navigate it and answer grounded spatial questions ("how many chairs are behind you?", "walk to the red door") within a time budget. Humans do this effortlessly; VLM bots looking at screenshots fail at persistent spatial state. Privacy-preserving (no biometrics), unique per session, un-farmable because worlds are generated on demand. Stack: Marble draft world (~$0.18, pre-generate a pool tonight) + collider mesh for walking + Convex for session/challenge state and scoring + Convex agent as the "adversary bot" that tries to pass the same challenge live in the demo. Your digital-ID background makes this a story judges will remember. Demo beat: human passes, bot fails, side by side.

**2. Infinite Rooms — co-op prompt-to-dungeon crawler** (Gaming & Interactive Worlds) · YC: *Multiplayer AI* · ★★
Every player in a room types a prompt; each becomes a new Marble world stitched as a "door". Tripo P1 generates the loot/enemies in that room in ~10s; Convex syncs players, doors, and inventory in real time. Uses all four sponsors visibly. Scope control: pre-generate 4 worlds, generate only the objects live.

**3. Memory Palace** (Creative 3D & VFX) · YC: *AI for the Aging Population* / consumer AI · ★★★
Turn notes/photos into a walkable palace: each memory becomes a Tripo object placed in a Marble world; a Convex agent NPC walks with you and recalls things when you approach objects (vector search over your notes). Emotional, cinematic, and a clean 2-minute demo. Optional angle: a senior's childhood home rebuilt from 3–4 old photos (multi-image → world).

### Gaming & Interactive Worlds
- **Prompt Party** — Jackbox-style: players submit prompts on phones (Convex), worlds/objects generate, everyone votes on the best. Zero physics, all vibes. ★★★
- **AI Town in a Marble world** — port the AI Town pattern (LLM NPCs with memories, server-authoritative tick) into a generated village; NPCs are Tripo-rigged characters. ★
- **Text-to-tabletop** — DM types "goblin ambush at a river crossing", get a battle map (world) + minis (Tripo, rigged) with turn state in Convex; players on phones move minis. ★★
- **Escape room generator** — Marble interior + Tripo puzzle objects + LLM writes riddles; multiplayer via Convex presence. ★★
- **Kid's bedtime story → playable level** — record a story, extract nouns, generate the world and objects, walk through it. ★★★

### Physical AI & Simulation
- **Photo-to-twin robot nav sandbox** — 4 phone photos of a real room → Marble world + collider mesh → an embodied agent (Convex agent with "move/look" tools) must find an object; export the collider to Isaac Sim / MuJoCo for the "training environment" story. YC: *New OS for the physical world*, *Data for the Real World*. ★★
- **Sim-to-real data factory** — generate N variations of a warehouse, drop Tripo objects at random poses, auto-render labeled views (bounding boxes from the collider mesh) as a synthetic dataset; Convex workflow orchestrates the batch. ★★
- **Job-site digital twin with a punch-list agent** — construction photos → world; foreman drops Tripo-generated markers; agent tracks tasks. ★★
- **Home-care walkthrough** — generate a senior's home and let a family member place "check on this" markers a monitoring agent reasons about. YC: *AI for the Aging Population*. ★★

### Creative 3D & VFX
- **Prompt-to-previz** — script line → world → auto camera path → export shot as video (Marble Studio / Three.js capture); Convex stores the shot list; a director agent suggests coverage. ★★
- **Music-reactive world** — audio drives splat opacity/color, Tripo instruments float in; pure spectacle, strong 2-min demo. (Bonus: you can play something live on ukulele/guitar.) ★★★
- **Virtual staging** — photo of an empty apartment → furnished world with Tripo furniture, swap styles live. Real-estate pitch. ★★★
- **Collaborative world editor** — multiple people place Tripo objects into one Marble world with Convex-synced transforms (Figma for 3D). ★★

### Wildcards from the rest of the YC list
- *Self-maintaining APIs* → a Claude Code skill that keeps a Three.js project's asset manifest in sync with Mint/Tripo (meta, but sponsors love dev tools). ★★★
- *A cloud for small software* → one-click "publish this world as a shareable app" (Convex deploy + static host) — good add-on feature to any idea above.

---

## 4. Day-of strategy

**Judging math.** Two minutes, six winners across three tracks, each track judged separately. Pick the track with the least competition — Physical AI & Simulation will almost certainly have the fewest entries at a game-heavy event, and "Creative" is the catch-all for anything that's just cool. The Gaming track will be crowded.

**Timeline**
- 9:15–10:00 partner talks: write down the demo each sponsor shows — judges are those sponsors.
- 10:00–10:30: kick off world generations *first* (5 min each on marble-1.1, much less on draft). Generation time is dead time; run it in the background from the start.
- 10:30–1:00: core loop working with placeholder assets. No polish.
- 1:00–4:00: real assets, multiplayer, agent.
- 4:00–5:00: polish only what's on screen during the demo.
- 5:00–5:30: **record backup video. Write the 2-minute script.** Rehearse twice with a timer.
- 5:30–6:00: submit early; fix nothing risky.

**Demo script (2 min)**: 15s problem/hook → 60s live demo (or video if Wi-Fi dies) → 20s how it uses each sponsor → 15s what's next. Have the app already open in a second tab; never cold-start on stage.

**Risk list**: Wi-Fi (download all splats + GLBs to Convex storage / local disk early), signed URL expiry (Tripo 5 min, World Labs undocumented — cache everything), CORS on asset URLs (proxy through Convex HTTP action if needed), meshopt/Draco decoders on GLTFLoader, OpenCV→Three.js axis flip on splats, mobile GPU choking on full-res splats (use 100k/500k).

---

## 5. Sources
World Labs: worldlabs.ai/blog/marble-world-model, worldlabs.ai/blog/announcing-the-world-api, worldlabs.ai/blog/atlas, docs.worldlabs.ai/api/reference, docs.worldlabs.ai/api/pricing, docs.worldlabs.ai/api/rendering-spz, sparkjs.dev, github.com/worldlabsai/worldlabs-api-examples
Tripo: developers.tripo3d.ai/en/docs/quick-start, developers.tripo3d.ai/en/pricing, developers.tripo3d.ai/en/models/v3-1, developers.tripo3d.ai/en/models/p1, github.com/VAST-AI-Research/tripo-js-sdk, github.com/VAST-AI-Research/tripo-python-sdk
mint.gg: mint.gg/about, docs.mint.gg/developers/quickstart.md, docs.mint.gg/developers/api-overview.md, docs.mint.gg/integrations/mcp.md, mcp.mint.gg, github.com/mintdotgg/mint-threejs-skills, github.com/mintdotgg/mint-playground, docs.mint.gg/events/world-model-genai-hackathon-siggraph2026.md
Convex: docs.convex.dev/quickstart/react, docs.convex.dev/production/state/limits, convex.dev/pricing, docs.convex.dev/agents/getting-started, github.com/get-convex/presence, github.com/get-convex/multiplayer-cursors, stack.convex.dev/building-a-multiplayer-game, github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md, docs.convex.dev/ai/convex-mcp-server
YC: ycombinator.com/rfs (Fall 2026)
