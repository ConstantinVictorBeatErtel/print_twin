import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { SparkSetup, SplatWorld, Collider } from "./components/SplatWorld";
import { Asset } from "./components/Asset";
import { PlacementGhost, type GhostState } from "./components/PlacementGhost";
import { DebugPanel, DEBUG_DEFAULTS, type DebugSettings } from "./components/DebugPanel";
import { Players } from "./components/Players";
import { DrawOverlay } from "./components/DrawOverlay";
import { getSessionId, randomColor } from "./lib/session";
import { ConvexProjectClient } from "./lib/ConvexProjectClient";

export default function WorldApp({ initialWorldId, onNewWorld }: { initialWorldId?: string; onNewWorld: () => void }) {
  const explicitRoom = useMemo(() => new URLSearchParams(location.search).get('room'), []);
  const convex = useConvex();
  const projectClient = useMemo(() => new ConvexProjectClient(convex), [convex]);
  const sessionId = useMemo(getSessionId, []);
  // ?debug=1 (or the older ?debugCollider=1) opens the tuning panel and draws the Marble
  // collider as a wireframe. Check it lines up with the splat before trusting a placement —
  // the two frames are not verified to match.
  const debug = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return q.has("debug") || q.has("debugCollider");
  }, []);
  const worldsResult = useQuery(api.worlds.list);
  const worlds = worldsResult ?? [];
  const [activeWorld, setActiveWorld] = useState<string | null>(initialWorldId ?? null);
  const room = explicitRoom ?? activeWorld ?? worlds.find((w) => w.status === 'ready')?._id ?? 'lobby';
  const assets = useQuery(api.assets.list) ?? [];
  const placements = useQuery(api.assets.placementsInRoom, { room }) ?? [];
  const genWorld = useAction(api.worlds.generateFromText);
  const genAsset = useAction(api.assets.generateFromText);
  const genFromDrawing = useAction(api.assets.generateFromDrawing);
  const uploadUrl = useMutation(api.worlds.generateUploadUrl);
  const place = useMutation(api.assets.place);
  const clearRoom = useMutation(api.assets.clearRoom);
  const join = useMutation(api.players.join);

  const [worldPrompt, setWorldPrompt] = useState("a cozy candle-lit library with tall shelves");
  const [assetPrompt, setAssetPrompt] = useState("low-poly wooden treasure chest");
  const [joined, setJoined] = useState(false);
  // The asset waiting to be dropped into the world, and what the ghost is currently hovering.
  const [armed, setArmed] = useState<{ assetId: Id<"assets">; glbUrl: string } | null>(null);
  const [ghost, setGhost] = useState<GhostState>(null);
  const [cfg, setCfg] = useState<DebugSettings>(DEBUG_DEFAULTS);
  const [zipStatus, setZipStatus] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [drawBusy, setDrawBusy] = useState(false);
  const zipInput = useRef<HTMLInputElement>(null);
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  // Preserve the original sketch -> PNG -> Convex storage -> Tripo flow.
  async function submitDrawing(png: Blob) {
    setDrawBusy(true);
    try {
      const url = await uploadUrl();
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
      if (!res.ok) throw new Error(`drawing upload failed (${res.status})`);
      const { storageId } = await res.json();
      await genFromDrawing({ storageId });
      setDrawMode(false);
    } catch (e: unknown) {
      alert(`drawing failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setDrawBusy(false);
    }
  }

  const selectWorld = (id: string) => {
    setActiveWorld(id);
    setJoined(false);
    setArmed(null);
    setLoadError('');
    const url = new URL(location.href);
    url.searchParams.set('world', id);
    url.searchParams.delete('job');
    history.replaceState(null, '', url);
  };

  // A world .zip is unpacked in the browser and its assets pushed into Convex storage:
  // same end state as a Marble generation, but with no API key and no waiting.
  async function uploadWorldZip(file: File) {
    setZipStatus(`reading ${file.name}…`);
    try {
      const id = await projectClient.importZip(file);
      selectWorld(id);
      setZipStatus(`loaded ${file.name}`);
    } catch (e: any) {
      setZipStatus(`failed: ${e?.message ?? e}`);
    }
  }

  const world = activeWorld ? worlds.find((w) => w._id === activeWorld) : worlds.find((w) => w.status === "ready");
  const onSplatReady = useCallback(() => { setReadyUrl(world?.splatUrl ?? null); setLoadError(''); }, [world?.splatUrl]);
  const onSplatError = useCallback((message: string) => setLoadError(message), []);
  // Debug sliders nudge the room transform so collider/splat misalignment can be found by hand.
  const metricScale = (world?.metricScale ?? 1) * (debug ? cfg.metricScaleMul : 1);
  const groundOffset = (world?.groundOffset ?? 0) + (debug ? cfg.groundOffsetAdd : 0);

  return (
    <div className="world-app">
      <aside style={{ padding: 12, color: "#eee", background: "#111", overflow: "auto", fontSize: 13 }}>
        <h2 style={{ margin: "0 0 8px" }}>Galatea</h2>
        <button onClick={onNewWorld}>New world</button>
        <div>room: <b>{room}</b> · {joined ? "joined" : <button onClick={async () => { await join({ room, sessionId, name: "me", color: randomColor() }); setJoined(true); }}>join multiplayer</button>}</div>

        <h3>World (World Labs)</h3>
        <textarea value={worldPrompt} onChange={(e) => setWorldPrompt(e.target.value)} rows={3} style={{ width: "100%" }} />
        <button onClick={() => genWorld({ prompt: worldPrompt, model: "marble-1.0-draft" })}>Generate (draft)</button>{" "}
        <button onClick={() => genWorld({ prompt: worldPrompt, model: "marble-1.1" })}>Generate (1.1)</button>
        <div style={{ margin: "6px 0" }}>
          <input
            ref={zipInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadWorldZip(f); }}
          />
          <button onClick={() => zipInput.current?.click()}>Upload world .zip</button>
          {zipStatus && <div style={{ opacity: 0.7, marginTop: 4 }}>{zipStatus}</div>}
        </div>
        <ul>{worlds.map((w) => (
          <li key={w._id}><button disabled={w.status !== "ready"} onClick={() => selectWorld(w._id)}>{w.name}</button> {w.status}{w.error ? ` — ${w.error.slice(0, 80)}` : ""}</li>
        ))}</ul>

        <h3>Objects (Tripo)</h3>
        <input value={assetPrompt} onChange={(e) => setAssetPrompt(e.target.value)} style={{ width: "100%" }} />
        <button onClick={() => genAsset({ prompt: assetPrompt, model: "P1-20260311" })}>Generate (P1)</button>{" "}
        <button onClick={() => setDrawMode((v) => !v)}>{drawMode ? 'stop drawing' : 'draw an object'}</button>
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

      {activeWorld && worldsResult !== undefined && !world ? <div role="alert" className="world-error">This world is not available on this backend. Choose another world or return to New world.</div> :
      <div className="world-canvas">
      <Canvas camera={{ position: [0, 1.6, 0], fov: 60, near: 0.05, far: 500 }}>
        <SparkSetup />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} intensity={1.2} />
        <Suspense fallback={null}>
          {world?.splatUrl && <SplatWorld url={world.splatUrl} fileName={world.splatFileName} metricScale={metricScale} groundOffset={groundOffset} minRaycastOpacity={cfg.minRaycastOpacity} onReady={onSplatReady} onError={onSplatError} />}
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
        <OrbitControls makeDefault target={[0, 1.6, -1]} enabled={!drawMode} />
      </Canvas>
      <DrawOverlay active={drawMode} busy={drawBusy} onSubmit={submitDrawing} />
      {(loadError || (world?.splatUrl && readyUrl !== world.splatUrl)) && <div className="world-render-status" role={loadError ? 'alert' : 'status'}>
        <p>{loadError || 'Opening world…'}</p>
        {loadError && <button onClick={() => location.reload()}>Reload world</button>}
      </div>}
      </div>}
    </div>
  );
}
