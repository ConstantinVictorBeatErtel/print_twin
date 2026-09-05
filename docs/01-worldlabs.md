# World Labs — Marble World API (reference for agents)

Base URL: `https://api.worldlabs.ai/marble/v1`
Auth header: `WLT-Api-Key: $WLT_API_KEY` (server-side only — never in browser code)
Console/keys: https://platform.worldlabs.ai · Docs: https://docs.worldlabs.ai · LLM index: https://docs.worldlabs.ai/llms.txt
OpenAPI + agent skill: `npx skills add worldlabsai/marble-developer-api-skill --skill marble-developer-api`

## Endpoints
- `POST /worlds:generate` → `{ operation_id, done }`
- `GET /operations/{operation_id}` → `{ done, response: { world_id }, cost: { total_credits } }` — poll every ~5s
- `GET /worlds/{world_id}` → world with `assets`
- `GET /worlds` — list
- `POST /worlds/{world_id}:export` — `{ asset_type: "splats"|"mesh", format: "ply"|"glb", resolution: "full_res"|"500k"|"150k"|"100k", mesh_variant: "textured"|"vertex_colored" }` (PLY sync + free; HQ mesh async, 3,500 credits, slow — avoid in a hackathon)
- `POST /media-assets:prepare_upload` `{ filename, kind }` → signed PUT URL, then reference `{ source: "media_asset", media_asset_id }`
- `GET /credits` — balance

## Generate request
```json
{
  "display_name": "Lounge",
  "model": "marble-1.0-draft",
  "world_prompt": { "type": "text", "text_prompt": "A cozy jazz lounge, warm light", "disable_recaption": false }
}
```
- `world_prompt.type`: `text` | `image` | `multi-image` | `video`
- image content: `{ "uri": "https://..." }` | `{ "media_asset_id": "..." }` | `{ "data_base64": "..." }`; `is_pano: "auto"|true|false`
- multi-image: array of `{ azimuth: 0|90|180|270, content }`, max 4 (8 with `reconstruct_images: true`)
- `model`: `marble-1.0-draft` (fast/cheap ~230 credits ≈ $0.18) | `marble-1.1` (~1,580 ≈ $1.26, ~5 min) | `marble-1.1-plus` (large/outdoor, 1,500–3,000)
- optional: `seed`, `tags`, `permission: { public: true }` (makes https://marble.worldlabs.ai/world/{world_id} shareable)

## World response (what you use)
```
assets.splats.spz_urls.{full_res,500k,100k}      // Gaussian splats — load 500k on desktop, 100k on mobile
assets.splats.semantics_metadata.{metric_scale_factor, ground_plane_offset}
assets.mesh.collider_mesh_url                     // GLB, 100–200k tris — hidden mesh for raycast/physics
assets.imagery.pano_url                           // 2560x1280 equirect PNG — use as skybox / thumbnail
```
Asset URLs are signed; expiry undocumented → download and cache (Convex file storage) immediately.

## Rendering with Spark (Three.js)
`npm i @sparkjsdev/spark three@0.180` — Spark 2.1.0.
```js
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
scene.add(new SparkRenderer({ renderer }));       // once
const world = new SplatMesh({ url: spzUrl });
world.scale.set(1, -1, -1);                        // OpenCV (+y down, +z fwd) -> Three.js
scene.add(world);
```
Metric units: multiply positions by `metric_scale_factor`, subtract `ground_plane_offset` from Y.
Collider: `GLTFLoader` → apply same transform → `visible=false` → use for raycasts / Rapier trimesh.
Hosted viewer for quick checks: https://sparkjs.dev/viewer/ · examples: https://sparkjs.dev/examples/

## Pricing / limits
Prepaid credits, $1 = 1,250, min $5, no free API tier (event provides keys). 402 = out of credits, 429 = rate limited (no published numbers), 400 = policy/invalid.

## Node snippet
```js
const B = "https://api.worldlabs.ai/marble/v1";
const H = { "WLT-Api-Key": process.env.WLT_API_KEY, "Content-Type": "application/json" };
const op = await (await fetch(`${B}/worlds:generate`, { method: "POST", headers: H, body: JSON.stringify(req) })).json();
let o; while (!(o = await (await fetch(`${B}/operations/${op.operation_id}`, { headers: H })).json()).done) await new Promise(r => setTimeout(r, 5000));
const world = await (await fetch(`${B}/worlds/${o.response.world_id}`, { headers: H })).json();
```
Not usable tomorrow: Atlas (early access), RTFM (demo only).
