// The room: walk it, sketch objects into it, place them on real surfaces, share it.
//
// This is the standalone first-person editor rewired onto Convex. What changed from
// the local version: the room geometry, the object library and the placements all come
// from Convex instead of `public/` and IndexedDB, generation is a scheduled Convex
// action instead of a local job server, and other players can be in here with you.
//
// What deliberately did not change is the placement maths — `surfacePick` raycasts the
// Marble collider, reads the real triangle normal, and `orientTo` stands the object on
// it. That is the part that makes objects land on tables instead of floating.
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Asset, disposeModel, gltfLoader } from "./components/Asset";
import { PlacementGhost, type GhostState } from "./components/PlacementGhost";
import { Collider, SparkSetup, SplatWorld } from "./components/SplatWorld";
import { Walk, type MouseLook } from "./components/LocalWalk";
import { Players } from "./components/Players";
import { DebugPanel, DEBUG_DEFAULTS, type DebugSettings } from "./components/DebugPanel";
import { DrawingBridge, DrawingLayer, type DrawingCapture, type DrawingRequest } from "./components/DrawingLayer";
import { SketchGhost } from "./components/SketchGhost";
import { SketchSolver, type SolveSketchYaw } from "./components/SketchSolver";
import { fitDrawing, type DrawingAnchor } from "./lib/drawingPlacement";
import { composeYaw } from "./lib/sketchOrientation";
import { pickSurface } from "./lib/surfacePick";
import { usePlacementHistory, type PlacementInput } from "./lib/placementHistory";
import { ConvexProjectClient } from "./lib/ConvexProjectClient";
import { getSessionId, randomColor } from "./lib/session";
import { glbToStl, downloadBlob, safeFilename, PRINT_HEIGHT_MM } from "./lib/stlExport";

// Never invent a ground plane: an object may only land on the reconstructed collider
// or on a real splat hit, so a miss places nothing rather than guessing a depth.
const SURFACES = { collider: true, splat: true, plane: false };
const ANCHOR_KEY = "galatea-sketch-anchor-v1";
// Above this the stroke cutout is dropped from localStorage rather than risking the quota.
const STROKE_BUDGET = 1_500_000;
const STAGES = [
  ["image", "Image"],
  ["cutout", "Cutout"],
  ["mesh", "3D + color"],
  ["done", "Ready"],
] as const;

type Armed = { assetId: Id<"assets">; url: string; movingId?: Id<"placements">; targetSize: number };
type PlacementDoc = {
  _id: Id<"placements">;
  assetId: Id<"assets">;
  position: number[];
  rotation: number[];
  scale: number;
  targetSize?: number;
  glbUrl: string | null;
};

class ColliderBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(`Room collider unavailable; using splat surfaces. ${error.message}`); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function WorldApp({ initialWorldId, onNewWorld }: { initialWorldId?: string; onNewWorld: () => void }) {
  const convex = useConvex();
  const projectClient = useMemo(() => new ConvexProjectClient(convex), [convex]);
  const sessionId = useMemo(getSessionId, []);
  const explicitRoom = useMemo(() => new URLSearchParams(location.search).get("room"), []);
  // ?debug=1 opens the transform sliders and draws the collider as a wireframe. Worth
  // a look before trusting a placement: splat and collider alignment is not verified.
  const debug = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return q.has("debug") || q.has("debugCollider");
  }, []);

  const worldsResult = useQuery(api.worlds.list);
  const worlds = useMemo(() => worldsResult ?? [], [worldsResult]);
  const [activeWorld, setActiveWorld] = useState<string | null>(initialWorldId ?? null);
  const world = activeWorld ? worlds.find((w) => w._id === activeWorld) : worlds.find((w) => w.status === "ready");
  const room = explicitRoom ?? activeWorld ?? world?._id ?? "lobby";

  const assets = useQuery(api.assets.list) ?? [];
  const placements = (useQuery(api.assets.placementsInRoom, { room }) ?? []) as PlacementDoc[];
  const place = useMutation(api.assets.place);
  const removePlacement = useMutation(api.assets.removePlacement);
  const updatePlacement = useMutation(api.assets.updatePlacement);
  const clearRoom = useMutation(api.assets.clearRoom);
  const startSketch = useMutation(api.assets.startSketch);
  const resumeSketch = useMutation(api.assets.resumeSketch);
  const uploadUrl = useMutation(api.worlds.generateUploadUrl);
  const join = useMutation(api.players.join);
  const genWorld = useAction(api.worlds.generateFromText);

  const history = usePlacementHistory(room, { place, remove: removePlacement, update: updatePlacement });

  const [paused, setPaused] = useState(false);
  const [mouseLocked, setMouseLocked] = useState(false);
  const mouseLookRef = useRef<MouseLook | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [drawing, setDrawing] = useState<DrawingCapture | null>(null);
  const captureRef = useRef<(() => DrawingCapture) | null>(null);
  const [roomReady, setRoomReady] = useState(false);
  const [selected, setSelected] = useState<Id<"placements"> | null>(null);
  const [armed, setArmed] = useState<Armed | null>(null);
  const [ghost, setGhost] = useState<GhostState>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [reset, setReset] = useState(0);
  const [yaw, setYaw] = useState(0);
  // Set when something asked for first-person control back; the request itself has to wait
  // for the next render (see the effect below).
  const [wantLook, setWantLook] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);
  const [zipStatus, setZipStatus] = useState("");
  const [worldPrompt, setWorldPrompt] = useState("a cozy candle-lit library with tall shelves");
  const [cfg, setCfg] = useState<DebugSettings>(DEBUG_DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const zipInput = useRef<HTMLInputElement>(null);

  // The sketch job we are watching. Kept with its anchor so a reload can still turn the
  // finished mesh into a size estimate without resubmitting anything.
  const [job, setJob] = useState<{ assetId: Id<"assets">; anchor: DrawingAnchor; startedAt: number; strokeImage?: string } | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ANCHOR_KEY) || "null");
      if (saved?.assetId && saved.anchor?.cameraWorld?.length === 16 && saved.anchor?.projection?.length === 16
        && Array.isArray(saved.anchor?.strokes)) return saved;
    } catch { /* a corrupt entry just means no recovery */ }
    return null;
  });
  const jobAsset = job ? assets.find((a) => a._id === job.assetId) : undefined;
  // Convex reactivity re-runs the completion effect on every placement change, so a finished
  // mesh is only ever auto-placed once.
  const placedJobs = useRef(new Set<string>());
  const solveRef = useRef<SolveSketchYaw | null>(null);
  // Whether the yaw sweep found a clear winner, so the card can say why an object faces you.
  const [facing, setFacing] = useState<"sketched" | "camera" | null>(null);

  const active = placements.find((p) => p._id === selected);
  const readyAssets = assets.filter((a) => a.status === "ready" && a.glbUrl);
  const metricScale = (world?.metricScale ?? 1) * (debug ? cfg.metricScaleMul : 1);
  const groundOffset = (world?.groundOffset ?? 0) + (debug ? cfg.groundOffsetAdd : 0);

  const onSplatReady = useCallback(() => { setRoomReady(true); setError(""); }, []);
  const onSplatError = useCallback((message: string) => setError(`Could not load the room: ${message}`), []);

  const cancel = useCallback(() => { setArmed(null); setGhost(null); }, []);

  const arm = useCallback((assetId: Id<"assets">, url: string, movingId?: Id<"placements">, suggestedSize?: number) => {
    const existing = placements.find((p) => p._id === movingId);
    mouseLookRef.current?.release();
    setPaused(true); setLibraryOpen(true); setSelected(null);
    setArmed({
      assetId, url, movingId,
      targetSize: existing ? (existing.targetSize ?? 0.5) * existing.scale : suggestedSize ?? 0.5,
    });
    setYaw(0); setGhost(null); setPreviewReady(false); setError("");
  }, [placements]);

  /** Clicking an object in the room drops straight into the placement UI, with its own pose. */
  const editPlacement = useCallback((p: PlacementDoc) => {
    if (p.glbUrl) arm(p.assetId, p.glbUrl, p._id);
  }, [arm]);

  // --- the sketch job -------------------------------------------------------
  useEffect(() => {
    if (!job || jobAsset?.status !== "generating") return;
    const tick = () => setElapsed((Date.now() - job.startedAt) / 1000);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [job, jobAsset?.status]);

  // A finished mesh goes straight into the room, where the drawing said it should be.
  //
  // The anchor already holds a real contact point and a surface-aligned rotation, measured
  // against the collider when the drawing was made — it only ever needed to be used. What the
  // anchor cannot know is which way round the object faces, because Klein re-poses the cutout
  // into a centred product view; SketchSolver recovers that by matching rendered silhouettes
  // against the user's ink. A symmetric object has no answer to recover, so it keeps the yaw
  // orientOnSurface already gave it rather than snapping to a coin-flip.
  useEffect(() => {
    if (!job || !jobAsset || jobAsset.status !== "ready" || !jobAsset.glbUrl) return;
    if (placedJobs.current.has(jobAsset._id)) return;
    placedJobs.current.add(jobAsset._id);
    // StrictMode runs this twice on mount, and a reload can restore an already-finished job.
    // Claiming the id up front stops a double placement; releasing it again on a run that never
    // reached `place` stops the discarded first run from swallowing the object entirely.
    let alive = true, committed = false;
    void (async () => {
      const url = jobAsset.glbUrl!;
      let input: PlacementInput | null = null;
      let sketched = false;
      try {
        const gltf = await gltfLoader.loadAsync(url);
        try {
          const fit = fitDrawing(gltf.scene, job.anchor);
          const match = solveRef.current?.(gltf.scene, job.anchor, fit.targetSize) ?? null;
          sketched = Boolean(match?.confident);
          input = {
            assetId: jobAsset._id,
            position: fit.position,
            rotation: sketched ? composeYaw(fit.rotation, match!.yaw) : fit.rotation,
            scale: 1,
            targetSize: sketched ? match!.targetSize : fit.targetSize,
          };
        } finally { disposeModel(gltf.scene); }
      } catch {
        // No pose could be derived (empty geometry, or the GLB would not load). Fall back to
        // placing it by hand rather than dropping the object the user just paid to generate.
      }
      if (!alive) return;
      committed = true;   // no await since the check above, so the cleanup cannot slip in here
      if (!input) { arm(jobAsset._id, url); return; }
      try {
        const id = await place({ room, ...input });
        history.recordPlace(id, input);   // inverse-op stack: Undo removes it, multiplayer-safe
        setSelected(id);
        setFacing(sketched ? "sketched" : "camera");
      } catch (e) {
        setError(`Could not place your object: ${e instanceof Error ? e.message : String(e)}`);
        arm(jobAsset._id, url, undefined, input.targetSize);
      }
    })();
    return () => { alive = false; if (!committed) placedJobs.current.delete(jobAsset._id); };
  }, [job, jobAsset, arm, place, room, history]);

  const dismissJob = () => { setJob(null); setFacing(null); localStorage.removeItem(ANCHOR_KEY); };

  async function submitDrawing(request: DrawingRequest) {
    setSubmitting(true); setError("");
    try {
      const store = async (dataUrl: string) => {
        const blob = await (await fetch(dataUrl)).blob();
        const url = await uploadUrl();
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
        if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}).`);
        return (await response.json()).storageId as Id<"_storage">;
      };
      const [imageStorageId, cleanStorageId] = await Promise.all([store(request.image), store(request.cleanImage)]);
      const assetId = await startSketch({ imageStorageId, cleanStorageId, description: request.description });
      const next = { assetId, anchor: request.anchor, startedAt: Date.now(), strokeImage: request.strokeImage };
      // The cutout is only a visual placeholder: if it will not fit, keep the job and lose the
      // hanging sketch on reload rather than failing the whole submission. The anchor's own
      // strokes are polylines and cost little, so auto-placement survives either way.
      try {
        localStorage.setItem(ANCHOR_KEY, JSON.stringify(next.strokeImage.length > STROKE_BUDGET ? { ...next, strokeImage: undefined } : next));
      } catch { /* quota: the anchor alone still recovers the job */ }
      setJob(next); setElapsed(0); setDrawing(null); setFacing(null); resumeWalking();
    } catch (e) {
      setError(`Could not start generation: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function downloadStl(url: string, name: string) {
    setExporting(true); setError("");
    try { downloadBlob(await glbToStl(url), `${safeFilename(name)}-${PRINT_HEIGHT_MM}mm.stl`); }
    catch (e) { setError(`STL export failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setExporting(false); }
  }

  // --- room controls --------------------------------------------------------
  const resumeWalking = useCallback(() => { setError(""); setPaused(false); setWantLook(true); }, []);

  // Pointer lock can only be requested once <Walk> has re-rendered with enabled={!drawing};
  // asking in the same tick as setDrawing(null) is silently refused. The H keydown's transient
  // activation still covers the request one effect later.
  useEffect(() => {
    if (drawing || !wantLook) return;
    setWantLook(false);
    // A slow upload can outlast the click that started it. Asking anyway would only earn a
    // "mouse capture was unavailable" toast; leave the cursor free and let a click re-lock.
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    mouseLookRef.current?.capture();
  }, [drawing, wantLook]);

  const beginDrawing = useCallback(() => {
    if (!captureRef.current) return;
    cancel(); setPaused(true); setError("");
    try { setDrawing(captureRef.current()); }
    catch (e) { setError(`Could not capture the room: ${String(e)}`); }
  }, [cancel]);

  const leaveDrawing = useCallback(() => { setDrawing(null); resumeWalking(); }, [resumeWalking]);

  const selectWorld = (id: string) => {
    setActiveWorld(id); setJoined(false); setRoomReady(false); setError("");
    cancel(); setSelected(null); history.clear();
    const url = new URL(location.href);
    url.searchParams.set("world", id);
    url.searchParams.delete("job");
    history_replace(url);
  };

  // A world .zip is unpacked in the browser and pushed into Convex storage: the same
  // end state as a Marble generation, with no API key and no waiting.
  async function uploadWorldZip(file: File) {
    setZipStatus(`reading ${file.name}…`);
    try {
      selectWorld(await projectClient.importZip(file));
      setZipStatus(`loaded ${file.name}`);
    } catch (e) {
      setZipStatus(`failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const asInput = (p: PlacementDoc): PlacementInput =>
    ({ assetId: p.assetId, position: p.position, rotation: p.rotation, scale: p.scale, targetSize: p.targetSize });

  const editActive = async (patch: Partial<PlacementInput>) => {
    if (!active) return;
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (active as any)[k]]));
    await updatePlacement({ id: active._id, ...patch });
    history.recordUpdate(active._id, before, patch);
  };

  const removeActive = async () => {
    if (!active) return;
    history.recordRemove(active._id, asInput(active));
    await removePlacement({ id: active._id });
    setSelected(null);
  };

  const stage = jobAsset?.stage ?? "image";
  const generating = jobAsset?.status === "generating";
  const jobPlaced = Boolean(jobAsset && placements.some((p) => p.assetId === jobAsset._id));
  const jobInHand = Boolean(jobAsset && armed?.assetId === jobAsset._id);
  const roomStatus = error ? error : roomReady ? "Ready" : world?.splatUrl ? "Loading room…" : "No room loaded";
  const canDraw = roomReady && !submitting && !generating;

  // H is the whole mode switch: walking or drawing, nothing in between. The panel is still one
  // Esc away, because the browser drops pointer lock on Escape by itself.
  const toggleDrawMode = useCallback(() => {
    if (drawing) { leaveDrawing(); return; }
    if (!canDraw) return;
    beginDrawing();
  }, [beginDrawing, canDraw, drawing, leaveDrawing]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== "KeyH" || e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      toggleDrawMode();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [toggleDrawMode]);

  return <div className="local-editor">
    <header className="viewer-toolbar" inert={!!drawing}>
      <div className="brand"><span className="brand-mark">✳</span><div>Galatea<small>Your room, reimagined</small></div></div>
      <nav aria-label="Room controls">
        <button disabled={!!drawing || !paused} onClick={() => { cancel(); resumeWalking(); }}>Resume look</button>
        <button className="primary" disabled={!!drawing || !canDraw}
          title={roomReady ? "Sketch an object into the room" : roomStatus} onClick={toggleDrawMode}>Draw an object <kbd>H</kbd></button>
        <button aria-expanded={libraryOpen} aria-controls="object-library" onClick={() => setLibraryOpen((v) => !v)}>Objects <span className="count">{placements.length}</span></button>
      </nav>
    </header>

    <aside id="object-library" className={`editor-panel ${libraryOpen ? "open" : ""}`} inert={!libraryOpen || !!drawing}>
      <div className="section-heading"><h2>Objects &amp; placement</h2><button aria-label="Close objects" onClick={() => setLibraryOpen(false)}>×</button></div>
      <p className="muted room-status" role="status">{roomStatus}</p>
      <div className="row">
        <button onClick={() => setReset((n) => n + 1)}>Reset view</button>
        <button onClick={onNewWorld}>New world</button>
      </div>
      <div className="row">
        <span className="save-status">room <b>{room}</b></span>
        {joined ? <span className="save-status">joined</span>
          : <button onClick={async () => { await join({ room, sessionId, name: "me", color: randomColor() }); setJoined(true); }}>Join multiplayer</button>}
      </div>
      <p className="controls-help">Click room to capture mouse · <kbd>H</kbd> to draw · <kbd>Esc</kbd> for this panel<br />W/A/S/D walk · Q/E down/up · Shift for speed</p>

      {error && <div role="alert" className="error">{error}<button aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}

      <section>
        <div className="section-heading"><h2>Object library</h2><span>{readyAssets.length}</span></div>
        <p className="hint">Objects live in this world's backend, so everyone in the room sees them.</p>
        {!readyAssets.length && <p className="hint">Nothing generated yet. Use <b>Draw an object</b>.</p>}
        {readyAssets.map((asset) => <div className="model-row" key={asset._id}>
          <span title={asset.description ?? asset.prompt}>{(asset.description ?? asset.prompt).slice(0, 40)}</span>
          <a href={asset.glbUrl!} download={`${safeFilename(asset.description ?? asset.prompt)}.glb`} title="Download the GLB with its textures">↓</a>
          <button disabled={exporting} title={`Geometry-only STL, ${PRINT_HEIGHT_MM} mm tall`} onClick={() => void downloadStl(asset.glbUrl!, asset.description ?? asset.prompt)}>STL</button>
          <button onClick={() => arm(asset._id, asset.glbUrl!)}>Place</button>
        </div>)}
      </section>

      {armed && <section className="placing-panel">
        <div className="section-heading"><h2>{armed.movingId ? "Move object" : "Place object"}</h2><button onClick={cancel}>Cancel</button></div>
        <p role="status">{!previewReady ? "Loading preview…" : ghost ? `On a ${ghost.kind} · ${ghost.source === "collider" ? "room mesh" : "splat"} · size ×${ghost.scale.toFixed(2)}` : "Move the cursor over a room surface"}</p>
        <TransformKeys />
        <label className="field">Size <NumberInput label="Preview size" value={armed.targetSize} min={0.02} max={10} step={0.05} onChange={(value) => setArmed({ ...armed, targetSize: value })} /></label>
        <label className="field">Turn <NumberInput label="Preview rotation" value={yaw} min={-360} max={360} step={15} onChange={setYaw} />°</label>
        <p className="hint">The object follows whatever is under the cursor: standing on floors and table tops, flat against walls, hanging from ceilings.</p>
      </section>}

      <section>
        <div className="section-heading"><h2>In this room</h2><span>{placements.length}</span></div>
        <div className="row">
          <button disabled={!history.canUndo || !!armed} onClick={() => void history.undo()}>Undo</button>
          <button disabled={!history.canRedo || !!armed} onClick={() => void history.redo()}>Redo</button>
          <button className="danger" disabled={!placements.length}
            onClick={() => { if (confirm(`Remove all ${placements.length} objects from this room? This cannot be undone.`)) { void clearRoom({ room }); history.clear(); setSelected(null); } }}>Clear all</button>
        </div>
        {!placements.length && <p className="hint">Choose Place above, then click a table or the floor.</p>}
        {placements.map((p, i) => <button className={`object-row ${p._id === selected ? "selected" : ""}`} key={p._id} onClick={() => { cancel(); setSelected(p._id); }}>
          <span>{(assets.find((a) => a._id === p.assetId)?.description ?? "Object").slice(0, 28)}</span><span>#{i + 1}</span>
        </button>)}
      </section>

      {active && !armed && <section className="selection-panel">
        <h2>Selected object</h2>
        <div className="row wrap">
          <button disabled={!active.glbUrl} onClick={() => arm(active.assetId, active.glbUrl!, active._id)}>Move</button>
          <button disabled={!active.glbUrl} onClick={() => arm(active.assetId, active.glbUrl!)}>Place another</button>
          <button className="danger" onClick={() => void removeActive()}>Remove</button>
        </div>
        <label className="field">Scale <NumberInput label="Object scale" value={active.scale} min={0.05} max={20} step={0.1} onChange={(scale) => void editActive({ scale })} /></label>
        {(["X", "Y", "Z"] as const).map((axis, index) => <label className="field" key={axis}>{axis} position <NumberInput label={`${axis} position`} value={active.position[index]} min={-1000} max={1000} step={0.05} onChange={(value) => { const position = [...active.position]; position[index] = value; void editActive({ position }); }} /></label>)}
        {(["Tilt", "Turn", "Roll"] as const).map((axis, index) => <label className="field" key={axis}>{axis} <NumberInput label={`Object ${axis.toLowerCase()}`} value={active.rotation[index] * 180 / Math.PI} min={-360} max={360} step={15} onChange={(value) => { const rotation = [...active.rotation]; rotation[index] = value * Math.PI / 180; void editActive({ rotation }); }} />°</label>)}
        <button onClick={() => void editActive({ rotation: [0, active.rotation[1], 0] })}>Stand upright</button>
      </section>}

      <details><summary>World &amp; surfaces</summary>
        <label className="check"><input type="checkbox" checked={wireframe} onChange={(e) => setWireframe(e.target.checked)} />Show room collider</label>
        <p className="hint">Placement follows the reconstructed collider, falling back to splat surfaces. Sizes are in room metres; this is visual placement, not a physical calibration.</p>
        <input ref={zipInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadWorldZip(f); }} />
        <button onClick={() => zipInput.current?.click()}>Upload world .zip</button>
        {zipStatus && <p className="hint">{zipStatus}</p>}
        <textarea value={worldPrompt} onChange={(e) => setWorldPrompt(e.target.value)} rows={2} aria-label="World prompt" />
        <button onClick={() => void genWorld({ prompt: worldPrompt, model: "marble-1.1" })}>Generate a world (World Labs)</button>
        {worlds.map((w) => <button className="object-row" key={w._id} disabled={w.status !== "ready"} onClick={() => selectWorld(w._id)}>
          <span>{w.name}</span><span>{w.status}</span>
        </button>)}
        {debug && <DebugPanel settings={cfg} onChange={setCfg} />}
      </details>
    </aside>

    <main className="room-canvas" aria-label="3D room"
      onPointerDown={(e) => {
        // Clicking the room is how you get back to walking. <Walk> cannot do this itself:
        // its `paused` also covers placement, where a click must place rather than re-lock.
        if (e.button === 0 && paused && !armed && !drawing && e.target instanceof HTMLCanvasElement) resumeWalking();
      }}>
      <Canvas frameloop={drawing ? "never" : "always"} dpr={1} gl={{ antialias: false }} camera={{ position: [0, 1.6, 0], fov: 65, near: 0.02, far: 500 }}>
        <SparkSetup />
        <DrawingBridge captureRef={captureRef} />
        <SketchSolver solveRef={solveRef} />
        <ambientLight intensity={1.4} />
        <directionalLight position={[3, 5, 2]} intensity={2} />
        {world?.splatUrl && <SplatWorld url={world.splatUrl} fileName={world.splatFileName ?? undefined}
          metricScale={metricScale} groundOffset={groundOffset} minRaycastOpacity={cfg.minRaycastOpacity}
          onReady={onSplatReady} onError={onSplatError} />}
        {world?.colliderUrl && <ColliderBoundary onError={setError}><Suspense fallback={null}>
          <Collider url={world.colliderUrl} metricScale={metricScale} groundOffset={groundOffset} visible={wireframe} />
        </Suspense></ColliderBoundary>}
        {!world && <gridHelper args={[20, 20]} />}
        {placements.filter((p) => p.glbUrl && p._id !== armed?.movingId).map((p) =>
          // The id rides on a wrapper group so the crosshair can find the placement it hit.
          <group key={p._id} userData={{ placementId: p._id }}>
            <Asset url={p.glbUrl!} position={p.position} rotation={p.rotation} scale={p.scale} targetSize={p.targetSize}
              onClick={armed || !paused || drawing ? undefined : () => editPlacement(p)} onError={setError} />
          </group>)}
        <CrosshairPick enabled={!armed && !drawing && mouseLocked}
          onHit={(id) => { const hit = placements.find((p) => p._id === id); if (hit) editPlacement(hit); }} />
        {job?.strokeImage && jobAsset && !jobPlaced &&
          <SketchGhost anchor={job.anchor} image={job.strokeImage} pulse={generating} />}
        {active && !armed && <mesh position={active.position as [number, number, number]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.035, 0.05, 32]} /><meshBasicMaterial color="#98f5ba" depthTest={false} transparent opacity={0.8} />
        </mesh>}
        {armed && <PlacementGhost key={`${armed.assetId}:${armed.movingId ?? "new"}`} url={armed.url} targetSize={armed.targetSize}
          yaw={yaw * Math.PI / 180} pickHz={12} allow={SURFACES}
          opacity={cfg.ghostOpacity} clickSlop={cfg.clickSlop}
          onPreview={setGhost} onReady={() => setPreviewReady(true)}
          onYawDelta={(radians) => setYaw((degrees) => wrapDegrees(degrees + radians * 180 / Math.PI))}
          onResetRotation={() => setYaw(0)}
          onError={(message) => { setError(message); cancel(); }} onCancel={cancel}
          onCommit={(position, rotation, scale) => {
            const input: PlacementInput = { assetId: armed.assetId, position, rotation, scale, targetSize: armed.targetSize };
            void (async () => {
              if (armed.movingId) {
                const before = placements.find((p) => p._id === armed.movingId);
                await updatePlacement({ id: armed.movingId, position, rotation, scale, targetSize: armed.targetSize });
                if (before) history.recordUpdate(armed.movingId, asInput(before), input);
                setSelected(armed.movingId);
              } else {
                const id = await place({ room, ...input });
                history.recordPlace(id, input);
                setSelected(id);
              }
            })();
            cancel();
          }} />}
        <Walk reset={reset} paused={paused || !!armed} enabled={!drawing} mouseLookRef={mouseLookRef}
          onLockChange={(locked) => { setMouseLocked(locked); setPaused(!locked); }} onError={setError} />
        {joined && <Players room={room} sessionId={sessionId} />}
      </Canvas>

      {!drawing && <>
        <div className="canvas-badge"><span className="live-dot" />{roomReady ? "LIVE ROOM" : roomStatus}</div>
        {mouseLocked && <div className="crosshair" />}
        {!paused && !mouseLocked && <div className="paused-hint">Click the room to explore · H to draw</div>}
        {!armed && <div className="walk-hint"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Walk</span><span><kbd>Q</kbd><kbd>E</kbd> Fly</span><span><kbd>Shift</kbd> Faster</span><span><kbd>H</kbd> Draw</span>{mouseLocked && <span>Click an object to edit</span>}</div>}
        {paused && !armed && !job && roomReady && <div className="paused-hint">Press H to draw something into this room</div>}
        {armed && <div className="armed-hud"><strong>{armed.movingId ? "Editing object" : "Placing object"}</strong><TransformKeys /></div>}
        {error && !libraryOpen && <div className="floating-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}

        {(job || submitting) && <div className="generation-card" aria-live="polite">
          {jobAsset?.cutoutUrl && <img src={jobAsset.cutoutUrl} alt="Generated object" />}
          <div className="generation-content">
            <div className="section-heading">
              <strong>{jobInHand ? "Ready to place" : jobPlaced ? "Placed where you drew it" : jobAsset?.status === "ready" ? "In your library"
                : jobAsset?.status === "failed" ? "Generation failed" : submitting ? "Sending drawing" : "Creating your object"}</strong>
              {generating && <span>{elapsed.toFixed(0)}s{typeof jobAsset?.progress === "number" ? ` · ${jobAsset.progress}%` : ""}</span>}
            </div>
            <p>{jobAsset?.error || (jobInHand ? "Move over a room surface, then click to place."
              : jobPlaced ? (facing === "sketched" ? "Turned to face the way you sketched it."
                : facing === "camera" ? "Facing you — the shape was too symmetric to tell which way round it goes."
                : "Select your object to adjust it.")
              : jobAsset?.status === "ready" ? "Choose Place when you're ready."
              : "Klein cleans up your sketch, then Tripo builds it with colour.")}</p>
            {generating && <div className="pipeline-steps">{STAGES.map(([key, label]) =>
              <span key={key} className={key === stage ? "current" : ""}>{label}</span>)}</div>}
            <div className="row wrap">
              {jobPlaced && jobAsset?.glbUrl && <button onClick={() => {
                const placed = placements.find((p) => p.assetId === jobAsset._id);
                if (placed) arm(placed.assetId, jobAsset.glbUrl!, placed._id);
              }}>Move</button>}
              {jobPlaced && <button disabled={!history.canUndo || !!armed} onClick={() => void history.undo()}>Undo</button>}
              {jobAsset?.status === "ready" && !jobInHand && !jobPlaced && jobAsset.glbUrl &&
                <button onClick={() => arm(jobAsset._id, jobAsset.glbUrl!)}>Place object</button>}
              {jobAsset?.glbUrl && <a download={`${safeFilename(jobAsset.description ?? "object")}.glb`} href={jobAsset.glbUrl}>Color GLB ↗</a>}
              {jobAsset?.glbUrl && <button disabled={exporting} onClick={() => void downloadStl(jobAsset.glbUrl!, jobAsset.description ?? "object")}>{exporting ? "Exporting…" : "STL · no color ↗"}</button>}
              {jobAsset?.status === "failed" && jobAsset.taskId && <button onClick={() => void resumeSketch({ assetId: jobAsset._id })}>Resume task</button>}
              {!generating && !submitting && <button onClick={dismissJob}>Done</button>}
            </div>
          </div>
        </div>}
      </>}
      {drawing && <DrawingLayer capture={drawing} onCancel={leaveDrawing} onGenerate={submitDrawing}
        blocked={submitting || generating} errorMessage={error} />}
    </main>
  </div>;
}

/** Keeps the Turn field inside the range its number input accepts as Q/E accumulate. */
function wrapDegrees(degrees: number) {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

/** The keys that move an armed object. Shown in the panel and over the canvas. */
function TransformKeys() {
  return <ul className="key-legend">
    <li><kbd>Q</kbd><kbd>E</kbd> Turn <small>Shift: fine</small></li>
    <li><kbd>[</kbd><kbd>]</kbd> Resize <small>or scroll</small></li>
    <li><kbd>R</kbd> Reset turn</li>
    <li><kbd>Enter</kbd> / click Place</li>
    <li><kbd>Esc</kbd> Cancel</li>
  </ul>;
}

/**
 * Left-click while walking edits whatever the crosshair is on, so an object already in the
 * room is one click from the same UI that placed it — no need to release the mouse first.
 */
function CrosshairPick({ enabled, onHit }: { enabled: boolean; onHit: (id: string) => void }) {
  const { gl, camera, scene } = useThree();
  const cb = useRef({ enabled, onHit });
  cb.current = { enabled, onHit };
  useEffect(() => {
    const el = gl.domElement;
    const centre = new THREE.Vector2(0, 0);
    const click = () => {
      if (!cb.current.enabled || document.pointerLockElement !== el) return;
      const targets: THREE.Object3D[] = [];
      scene.traverse((o) => { if (o.userData.placementId) targets.push(o); });
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(centre, camera);
      const hit = raycaster.intersectObjects(targets, true)[0];
      if (!hit) return;
      // Room geometry in front of the object wins: you cannot edit through a wall.
      const room = pickSurface(new THREE.Raycaster(), camera, centre, scene, SURFACES);
      if (room && room.point.distanceTo(camera.position) < hit.distance) return;
      for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
        if (node.userData.placementId) { cb.current.onHit(node.userData.placementId as string); return; }
      }
    };
    el.addEventListener("click", click);
    return () => el.removeEventListener("click", click);
  }, [gl, camera, scene]);
  return null;
}

/** `history` is taken by the placement stack, so URL rewrites go through this. */
function history_replace(url: URL) {
  window.history.replaceState(null, "", url);
}

function NumberInput({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  useEffect(() => setDraft(String(Number(value.toFixed(3)))), [value]);
  const commit = () => {
    const next = Number(draft);
    if (draft.trim() && Number.isFinite(next)) {
      const clamped = Math.min(max, Math.max(min, next));
      if (clamped !== value) onChange(clamped);
      setDraft(String(Number(clamped.toFixed(3))));
    } else setDraft(String(Number(value.toFixed(3))));
  };
  return <input aria-label={label} type="number" value={draft} min={min} max={max} step={step} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }} />;
}
