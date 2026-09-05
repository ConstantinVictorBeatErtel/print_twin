import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { SparkSetup, SplatWorld, Collider } from "./components/SplatWorld";
import { Asset } from "./components/Asset";
import { Players } from "./components/Players";
import { getSessionId, randomColor, roomFromUrl } from "./lib/session";

export default function App() {
  const room = useMemo(roomFromUrl, []);
  const sessionId = useMemo(getSessionId, []);
  const worlds = useQuery(api.worlds.list) ?? [];
  const assets = useQuery(api.assets.list) ?? [];
  const placements = useQuery(api.assets.placementsInRoom, { room }) ?? [];
  const genWorld = useAction(api.worlds.generateFromText);
  const genAsset = useAction(api.assets.generateFromText);
  const place = useMutation(api.assets.place);
  const join = useMutation(api.players.join);

  const [worldPrompt, setWorldPrompt] = useState("a cozy candle-lit library with tall shelves");
  const [assetPrompt, setAssetPrompt] = useState("low-poly wooden treasure chest");
  const [activeWorld, setActiveWorld] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  const world = worlds.find((w) => w._id === activeWorld) ?? worlds.find((w) => w.status === "ready");

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
            {a.status === "ready" && <button onClick={() => place({ room, assetId: a._id, position: [Math.random() * 4 - 2, 0, Math.random() * 4 - 2] })}>place</button>}
          </li>
        ))}</ul>
        <p style={{ opacity: 0.6 }}>Set API keys with <code>npx convex env set WLT_API_KEY …</code> / <code>TRIPO_API_KEY</code>. See docs/.</p>
      </aside>

      <Canvas camera={{ position: [0, 1.6, 4], fov: 60, near: 0.05, far: 500 }}>
        <SparkSetup />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} intensity={1.2} />
        <Suspense fallback={null}>
          {world?.splatUrl && <SplatWorld url={world.splatUrl} metricScale={world.metricScale ?? 1} groundOffset={world.groundOffset ?? 0} />}
          {world?.colliderUrl && <Collider url={world.colliderUrl} metricScale={world.metricScale ?? 1} groundOffset={world.groundOffset ?? 0} />}
          {!world && <gridHelper args={[20, 20]} />}
          {placements.map((p) => p.glbUrl && <Asset key={p._id} url={p.glbUrl} position={p.position} rotation={p.rotation} scale={p.scale} />)}
          {joined && <Players room={room} sessionId={sessionId} />}
          {!world && <Environment preset="city" />}
        </Suspense>
        <OrbitControls makeDefault target={[0, 1, 0]} />
      </Canvas>
    </div>
  );
}
