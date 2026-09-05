# mint.gg — agentic 3D generation + Three.js skills (reference for agents)

What it is: an AI agent + REST/MCP API that generates models (GLB), worlds (Gaussian splats — PLY/SPZ/RAD + collider GLB + pano; World Labs appears to be the underlying pipeline), asset packs, PBR materials, images, audio, rigging/animation. It is NOT a game engine and has no scripting or multiplayer — you build the experience in Three.js; Convex is the multiplayer layer.

Sign in: https://mint.gg · API keys: https://platform.mint.gg · Docs: https://docs.mint.gg · LLM index: https://docs.mint.gg/llms.txt · OpenAPI: https://docs.mint.gg/api-reference/openapi.json
Credits: 5,000 welcome credits; redeem hackathon codes under Account → Redeem credits. Estimate cost with `POST /v1/pricing:estimate` before big jobs (smart topology = 394/model, optimization = 20/model).

## MCP (best way to use Mint from Claude Code / Cursor / Codex)
Server: `https://mcp.mint.gg/mcp` (OAuth; scopes mint:read, mint:projects:write, mint:generate:start, mint:generate:approve; 47 tools). Install page: https://mcp.mint.gg · Codex: `codex mcp add mint --url https://mcp.mint.gg/mcp`

## Agent skills (install tonight)
`npx skills add mintdotgg/mint-threejs-skills -a claude-code -g -y` (also `-a cursor`, `-a codex`)
Conventions the skills expect: TS + Vite + Three.js; `mint-assets.json` manifest + `scripts/sync-mint-assets.mjs` to pull CDN assets; **Draco-capable GLTFLoader** (bare loader fails on Mint-optimized GLBs); splat worlds via `@sparkjsdev/spark@^2` `SplatMesh({ fileType: SplatFileType.RAD, paged: true })` with an invisible collider GLB under the same root (reference calibration: rotation [π, π, 0], scale 2.5, y 1.5; camera at [0, 2.2, 6]).
Reference: https://github.com/mintdotgg/mint-threejs-skills (see references/mint-world-splats.md) · https://github.com/mintdotgg/mint-api-skill

## REST
Base `https://api.mint.gg/v1`, `Authorization: Bearer $MINT_API_KEY`. Long-running ops: start → poll `GET /v1/operations/{id}` (2s, ×1.6 backoff, cap 15s) → fetch resource. Preview/approve/revise workflow (default `auto`).
```bash
curl https://api.mint.gg/v1/models:generate -X POST -H "Authorization: Bearer $MINT_API_KEY" \
  -H "Content-Type: application/json" -d '{"prompt": "A small hand-painted treasure chest"}'
```
Services: `models:generate` (+ optimize, convert, smart topology, rig/animate), `worlds` (text + optional `imageUrl` or 2–8 `sourceImages`), asset packs, materials, images, audio, animation clip search, assets (manifests + download URLs, batch 25), `pricing:estimate`.

## Examples to steal from
https://play.mint.gg (50+ open-source Three.js games) · repo https://github.com/mintdotgg/mint-playground (`pnpm install && pnpm --dir experiences/<name> dev`) · R3F template https://github.com/mintdotgg/3d-web-starter · SIGGRAPH 2026 hackathon quickstart https://docs.mint.gg/events/world-model-genai-hackathon-siggraph2026.md
