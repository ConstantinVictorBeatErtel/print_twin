# Tripo — 3D asset generation API v3 (reference for agents)

Base URL: `https://openapi.tripo3d.ai/v3` · Auth: `Authorization: Bearer $TRIPO_API_KEY` (`tsk_…`, server-side only)
Keys: https://platform.tripo3d.ai → API Keys · Docs: https://developers.tripo3d.ai/en/docs/quick-start · JS SDK: `npm i tripo3d-sdk-js` · Python: `pip install tripo3d` · MCP: `uvx tripo-mcp`
(Legacy v2 still live at `https://api.tripo3d.ai/v2/openapi` with `POST /task {type:"text_to_model"}` / `GET /task/{id}`.)

## Models
- `P1-20260311` — game-ready low-poly, clean topology, 48–20k faces. ~10s untextured / ~60s textured. **Default for games.**
- `v3.1-20260211` (H3.1) — highest fidelity, PBR, up to 2M faces. ~40s / ~120s. Use for hero props / VFX.

## Endpoints
- `POST /generation/text-to-model` `{ prompt, model, texture, pbr, face_limit?, smart_low_poly?, quad?, auto_size?, negative_prompt?, seed? }`
- `POST /generation/image-to-model` `{ input: <file_token | public url>, model, texture, ... }`  ← verify field name on first live call
- `POST /generation/multiview-to-model` — 4 views front/left/back/right (front required)
- `POST /files` (multipart `file`, ≤20 MB image) → `data.file_token`
- `GET /tasks/{task_id}` → `data.{ status, progress, output: { model_url, rendered_image_url }, credits_consumed }`
  status: `queued → running → success | failed | cancelled | banned | expired`. Poll every 2s, cap ~5 min.
- `POST /models/convert` `{ original_model_task_id, format: "GLTF"|"FBX"|"OBJ"|"USDZ"|"STL"|"3MF", quad?, face_limit? }`
- `POST /animations/rig` (biped/quadruped/…; `tripo` or `mixamo` bone naming), `POST /animations/retarget` (10 credits/anim)
- `POST /mesh/segment` (parts), texture-only, smart low-poly, completion
- `GET /account/balance` → `{ balance, frozen }`
- Webhooks: console → Settings → Webhooks; events `task.completed`, `task.failed`; header `t=<unix>,v1=<hex>`, HMAC-SHA256(secret, `${t}.${rawBody}`)

## Gotchas
- **`model_url` expires in 5 minutes** — download immediately (starter stores in Convex file storage).
- Output GLB is meshopt-compressed → `loader.setMeshoptDecoder(MeshoptDecoder)`.
- Rate limit ≈ 3 parallel tasks per model series; error code 2000 + `Retry-After`.
- Credits: 1 = $0.01, 300 free on signup (2 weeks). P1 text→3D ≈ 30–60, H3.1 ≈ 10–30, rig ≈ 25, convert 5–10.
- `auto_size: true` gives real-world scale (useful when placing into Marble worlds with metric_scale_factor).

## Node (no SDK)
```js
const B = "https://openapi.tripo3d.ai/v3";
const H = { Authorization: `Bearer ${process.env.TRIPO_API_KEY}`, "Content-Type": "application/json" };
const { data: { task_id } } = await (await fetch(`${B}/generation/text-to-model`, { method: "POST", headers: H,
  body: JSON.stringify({ prompt: "low-poly stone watchtower", model: "P1-20260311", texture: true, pbr: true }) })).json();
let t; do { await new Promise(r => setTimeout(r, 2000));
  t = (await (await fetch(`${B}/tasks/${task_id}`, { headers: H })).json()).data; } while (!["success","failed","cancelled","banned","expired"].includes(t.status));
const glb = await (await fetch(t.output.model_url)).arrayBuffer();   // do this NOW, URL dies in 5 min
```

## JS SDK
```js
import { TripoClient, ModelVersion } from "tripo3d-sdk-js";
const c = new TripoClient(); // TRIPO_API_KEY env
const id = await c.textToModel({ prompt: "a cute fox", model: ModelVersion.P1, texture: true });
const task = await c.waitForTask(id, { pollingIntervalMs: 2000 });
const buf = await c.downloadModel(task);
```
