import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { SparkSetup, SplatWorld, Collider } from "./components/SplatWorld";
import { Asset } from "./components/Asset";
import { PlacementGhost, type GhostState } from "./components/PlacementGhost";
import { DebugPanel, DEBUG_DEFAULTS, type DebugSettings } from "./components/DebugPanel";
import { Players } from "./components/Players";
import { getSessionId, randomColor, roomFromUrl } from "./lib/session";

export default function App() {
  const room = useMemo(roomFromUrl, []);
  const sessionId = useMemo(getSessionId, []);
  // ?debug=1 (or the older ?debugCollider=1) opens the tuning panel and draws the Marble
  // collider as a wireframe. Check it lines up with the splat before trusting a placement —
  // the two frames are not verified to match.
  const debug = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return q.has("debug") || q.has("debugCollider");
  }, []);
  const worlds = useQuery(api.worlds.list) ?? [];
  const assets = useQuery(api.assets.list) ?? [];
  const placements = useQuery(api.assets.placementsInRoom, { room }) ?? [];
  const genWorld = useAction(api.worlds.generateFromText);
  const genAsset = useAction(api.assets.generateFromText);
  const place = useMutation(api.assets.place);
  const clearRoom = useMutation(api.assets.clearRoom);
  const join = useMutation(api.players.join);

  const [worldPrompt, setWorldPrompt] = useState("a cozy candle-lit library with tall shelves");
  const [assetPrompt, setAssetPrompt] = useState("low-poly wooden treasure chest");
  const [activeWorld, setActiveWorld] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  // The asset waiting to be dropped into the world, and what the ghost is currently hovering.
  const [armed, setArmed] = useState<{ assetId: Id<"assets">; glbUrl: string } | null>(null);
  const [ghost, setGhost] = useState<GhostState>(null);
  const [cfg, setCfg] = useState<DebugSettings>(DEBUG_DEFAULTS);

  const world = worlds.find((w) => w._id === activeWorld) ?? worlds.find((w) => w.status === "ready");
  // Debug sliders nudge the room transform so collider/splat misalignment can be found by hand.
  const metricScale = (world?.metricScale ?? 1) * (debug ? cfg.metricScaleMul : 1);
  const groundOffset = (world?.groundOffset ?? 0) + (debug ? cfg.groundOffsetAdd : 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: "100%" }}>
      <aside style={{ padding: 12, color: "#eee", background: "#111", overflow: "auto", fontSize: 13 }}>
        <h2 style={{ margin: "0 0 8px" }}>Spatial Hack</h2>
        <div>room: <b>{room}</b> · {joined ? "joined" : <button onClick={async () => { await join({ room, sessionId, name: "me", color: randomColor() }); setJoined(true); }}>join multiplayer</button>}</div>

        <h3>World (World Labs)</h3>
        <textarea value={worldPrompt} onChange={(e) => setWorldPrompt(e.target.value)} rows={3} style={{ width: "100%" }} />
        <button onClick={() => genWorld({ prompt: worldPrompt, model: "marble-1.0-draft" })}>Generate (draft)</button>{" "}
        <button onClick={() => genWorld({ prompt: worldPrompt, model: "marble-1.1" })}>Generate (1.1)</button>
        <ul>{worlds.map((w) => (
          <li key={w._id}><button disabled={w.status !== "ready"} onClick={() => setActiveWorld(w._id)}>{w.name}</button> {w.status}{w.error ? ` — ${w.error.slice(0, 80)}` : ""}</li>
        ))}</ul>

        <h3>Objects (Tripo)</h3>
        <input value={assetPrompt} onChange={(e) => setAssetPrompt(e.target.value)} style={{ width: "100%" }} />
        <button onClick={() => genAsset({ prompt: assetPrompt, model: "P1-20260311" })}>Generate (P1)</button>
        <ul>{assets.map((a) => (
          <li key={a._id}>{a.prompt.slice(0, 30)} · {a.status}{" "}
            {a.status === "ready" && a.glbUrl && (
              armed?.assetId === a._id
                ? <button onClick={() => setArmed(null)}>cancel</button>
                : <button onClick={() => setArmed({ assetId: a._id, glbUrl: a.glbUrl! })}>place</button>
            )}
          </li>
        ))}</ul>

        <div style={{ margin: "4px 0" }}>
          {placements.length} placed{" "}
          <button
            disabled={placements.length === 0}
            onClick={() => { if (confirm(`Remove all ${placements.length} objects from "${room}"? This cannot be undone.`)) clearRoom({ room }); }}
          >clear all</button>
        </div>

        {armed && (
          <div style={{ marginTop: 8, padding: 8, background: "#1d2a1d", border: "1px solid #2f5", borderRadius: 4 }}>
            <b>Placing.</b> Click a surface to drop it · scroll to resize · Esc or right-click to cancel.
            <div style={{ opacity: 0.7, marginTop: 4 }}>
              {ghost ? `on ${ghost.source} · ×${ghost.scale.toFixed(2)}` : "no surface under the cursor"}
            </div>
          </div>
        )}
        {debug && <DebugPanel settings={cfg} onChange={setCfg} />}
        <p style={{ opacity: 0.6 }}>Set API keys with <code>npx convex env set WLT_API_KEY …</code> / <code>TRIPO_API_KEY</code>. See docs/.</p>
      </aside>

      <Canvas camera={{ position: [0, 1.6, 4], fov: 60, near: 0.05, far: 500 }}>
        <SparkSetup />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} intensity={1.2} />
        <Suspense fallback={null}>
          {world?.splatUrl && <SplatWorld url={world.splatUrl} metricScale={metricScale} groundOffset={groundOffset} minRaycastOpacity={cfg.minRaycastOpacity} />}
          {world?.colliderUrl && <Collider url={world.colliderUrl} metricScale={metricScale} groundOffset={groundOffset} visible={debug && cfg.showCollider} />}
          {!world && <gridHelper args={[20, 20]} />}
          {placements.map((p) => p.glbUrl && <Asset key={p._id} url={p.glbUrl} position={p.position} rotation={p.rotation} scale={p.scale} targetSize={cfg.targetSize} />)}
          {armed && (
            <PlacementGhost
              url={armed.glbUrl}
              targetSize={cfg.targetSize}
              opacity={cfg.ghostOpacity}
              pickHz={cfg.pickHz}
              clickSlop={cfg.clickSlop}
              allow={cfg.allow}
              onPreview={setGhost}
              onCancel={() => setArmed(null)}
              onCommit={(position, rotation, scale) => {
                place({ room, assetId: armed.assetId, position, rotation, scale });
                setArmed(null);
              }}
            />
          )}
          {joined && <Players room={room} sessionId={sessionId} />}
          {!world && <Environment preset="city" />}
        </Suspense>
        <OrbitControls makeDefault target={[0, 1, 0]} />
      </Canvas>
    </div>
  );
}
