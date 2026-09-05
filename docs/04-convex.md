# Convex — real-time backend (reference for agents)

Docs: https://docs.convex.dev · Dashboard: https://dashboard.convex.dev · MCP: `npx -y convex@latest mcp start` · Components: https://www.convex.dev/components

## Concepts
- **query**: read-only, deterministic, cached, reactive (`useQuery` = live subscription). 1s timeout.
- **mutation**: ACID transaction, auto-retried on conflict. 1s timeout, 16 MiB writes, 1 MiB/doc, 8192 array elements.
- **action**: non-transactional; call external APIs (World Labs, Tripo, LLMs). `ctx.runQuery/runMutation`. Use `"use node";` at top of file for Node runtime.
- **scheduler**: `ctx.scheduler.runAfter(ms, internal.x.fn, args)` — self-scheduling mutations = server game loop / polling loop. `convex/crons.ts` for cron.
- **http actions**: `convex/http.ts` `httpRouter()` — webhooks (Tripo), asset proxy for CORS.
- **file storage**: `ctx.storage.generateUploadUrl()` (client) or `ctx.storage.store(blob)` (in action) → `storageId`; `ctx.storage.getUrl(id)`.
- **auth**: Convex Auth / Clerk / WorkOS; `ctx.auth.getUserIdentity()`. For a hackathon, anonymous session IDs in localStorage are fine.
- **vector search**: `.vectorIndex(...)` + `ctx.vectorSearch(...)` from an action.

## Commands
```bash
npm i convex && npx convex dev      # login, create dev deployment, write .env.local, codegen convex/_generated
npx convex deploy                   # prod
npx convex import --table x file.jsonl
```

## Components worth using
Register in `convex/convex.config.ts`: `import agent from "@convex-dev/agent/convex.config"; const app = defineApp(); app.use(agent); export default app;` then rerun `npx convex dev`.
- `@convex-dev/agent` — LLM agents with persistent threads, tools, memory. `new Agent(components.agent, { name, languageModel: anthropic("claude-..."), instructions, tools })`; `agent.generateText(ctx, { threadId }, { prompt })`.
- `@convex-dev/presence` — `usePresence(api.presence, roomId, userName)`; heartbeats + sendBeacon.
- `@convex-dev/rate-limiter` — token bucket on move mutations.
- `@convex-dev/workflow` (+ `workpool`) — durable generate→poll→store pipelines.
- `@convex-dev/sharded-counter`, `@convex-dev/aggregate` — scores/leaderboards.
- `convex-helpers` — sessions, `useStableQuery`, single-flighting.

## Multiplayer rules of thumb
1. 1–10 Hz mutations per client, never 60 Hz. Throttle with `maxWait`.
2. One doc per player (avoid write conflicts on a shared room doc); one shared room query per room.
3. Lerp remote players client-side; render local player from local state; optimistic update for own moves.
4. Server-authoritative sims: AI Town pattern — one scheduled mutation per second simulates 60 ticks in memory, writes once with a history buffer; client replays. https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md
5. LLM calls go in actions/agents scheduled from the loop, never in the tick.

## Free tier
1M function calls/mo, 20 GB-h actions, 0.5 GB DB, 1 GB files, 1 GB bandwidth. Enough for a day if throttled.
Known issue: Convex 1.39 had a bad release — if scaffolding breaks, pin a version. Chef is being sunset; don't use it.

## Optimistic update
```ts
const move = useMutation(api.players.move).withOptimisticUpdate((store, args) => {
  const ps = store.getQuery(api.players.list, { room }); if (!ps) return;
  store.setQuery(api.players.list, { room }, ps.map(p => p._id === args.id ? { ...p, ...args } : p));
});
```
