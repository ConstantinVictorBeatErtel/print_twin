import { Component, Suspense, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Box3 } from "three";
import { Asset, disposeModel, gltfLoader } from "./Asset";
import { PlacementGhost, type GhostState } from "./PlacementGhost";
import { Collider, SparkSetup, SplatWorld } from "./SplatWorld";
import { Walk, type MouseLook } from "./LocalWalk";
import { emptyHistory, loadScene, saveScene, sceneHistory, WORLD_ID, type Placement, type StoredModel } from "../lib/localScene";
import { validateGlb } from "../lib/localModel";
import { DrawingBridge, DrawingLayer, type DrawingCapture, type DrawingRequest } from "./DrawingLayer";
import { fitDrawing, type DrawingAnchor } from "../lib/drawingPlacement";
import { useDrawingJob, type AssetJob } from "../lib/useDrawingJob";
import { SettingsModal } from "./SettingsModal";

type Model = { id: string; name: string; url: string; blob?: Blob };
type Armed = { modelId: string; movingId?: string; targetSize: number };
const PLANT: Model = { id: "plantpot", name: "Generated plant pot", url: "/models/plantpot.glb" };
const SURFACES = { collider: true, splat: true, plane: false };

class ColliderBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(`Room collider unavailable; using splat surfaces. ${error.message}`); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function LocalEditor() {
  const [paused, setPaused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mouseLocked, setMouseLocked] = useState(false);
  const mouseLookRef = useRef<MouseLook | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [drawing, setDrawing] = useState<DrawingCapture | null>(null);
  const captureRef = useRef<(() => DrawingCapture) | null>(null);
  const [status, setStatus] = useState("Loading full-resolution room…");
  const [models, setModels] = useState<Model[]>([PLANT]);
  const [history, dispatch] = useReducer(sceneHistory, emptyHistory);
  const [selected, setSelected] = useState<string | null>(null);
  const [armed, setArmed] = useState<Armed | null>(null);
  const [ghost, setGhost] = useState<GhostState>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [reset, setReset] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [upright, setUpright] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [saving, setSaving] = useState("Restoring saved scene…");
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const urls = useRef<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveSequence = useRef(0);
  const placements = history.present;
  const current = useRef({ models, placements });
  current.current = { models, placements };
  const generation = useDrawingJob({ enabled: restored, onReady: async (job: AssetJob, anchor: DrawingAnchor) => {
    const id = `generated:${job.id}`;
    if (current.current.models.some((m) => m.id === id)) {
      await saveScene({ version: 1, worldId: WORLD_ID, placements: current.current.placements,
        models: current.current.models.filter((m) => m.blob).map((m) => ({ id: m.id, name: m.name, blob: m.blob! })) });
      if (!current.current.placements.some((p) => p.modelId === id)) arm(id);
      return;
    }
    const response = await fetch(job.glbUrl!, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error("Could not download the generated model.");
    const blob = await response.blob();
    validateGlb(await blob.arrayBuffer());
    const url = URL.createObjectURL(blob);
    try {
      const gltf = await gltfLoader.loadAsync(url);
      let fit;
      try { fit = fitDrawing(gltf.scene, anchor); } finally { disposeModel(gltf.scene); }
      const model: Model = { id, name: job.description.slice(0, 64), url, blob };
      const nextModels = [...current.current.models, model];
      const nextPlacements = current.current.placements;
      // Publish synchronously; subsequent edits save after this IndexedDB transaction.
      current.current = { models: nextModels, placements: nextPlacements };
      urls.current.push(url); setModels(nextModels);
      // The sketch suggests a size; only an explicit placement click creates a room object.
      arm(id, undefined, fit.targetSize);
      await saveScene({ version: 1, worldId: WORLD_ID, placements: nextPlacements,
        models: nextModels.filter((m) => m.blob).map((m) => ({ id: m.id, name: m.name, blob: m.blob! })) });
    } catch (e) { if (!current.current.models.some((m) => m.id === id)) URL.revokeObjectURL(url); throw e; }
  }});
  const generatedModelId = generation.job ? `generated:${generation.job.id}` : null;
  const generatedReady = models.some((m) => m.id === generatedModelId);
  const generatedPlaced = placements.some((p) => p.modelId === generatedModelId);
  const generatedInHand = Boolean(armed && armed.modelId === generatedModelId);
  const active = placements.find((p) => p.id === selected);
  const armedModel = models.find((m) => m.id === armed?.modelId);

  useEffect(() => {
    let alive = true;
    loadScene().then((saved) => {
      if (!alive) return;
      if (saved) {
        const imported = saved.models.map((m) => {
          const url = URL.createObjectURL(m.blob);
          urls.current.push(url);
          return { ...m, url };
        });
        setModels([PLANT, ...imported]);
        dispatch({ type: "restore", placements: saved.placements });
      }
      setRestored(true);
    }).catch((e) => {
      if (alive) { setError(String(e)); setSaving("Local saving unavailable"); }
    });
    return () => { alive = false; urls.current.forEach(URL.revokeObjectURL); };
  }, []);

  useEffect(() => {
    if (!restored) return;
    const sequence = ++saveSequence.current;
    setSaving("Saving…");
    const stored: StoredModel[] = models.filter((m) => m.blob).map((m) => ({ id: m.id, name: m.name, blob: m.blob! }));
    saveScene({ version: 1, worldId: WORLD_ID, models: stored, placements }).then(() => {
      if (sequence === saveSequence.current) setSaving("Saved on this browser");
    }).catch((e) => {
      if (sequence === saveSequence.current) { setSaving("Not saved"); setError(`Local save failed: ${String(e)}`); }
    });
  }, [models, placements, restored]);

  const toggleLook = () => {
    setArmed(null); setGhost(null);
    if (paused) {
      setError(""); setPaused(false);
      mouseLookRef.current?.capture();
    } else {
      mouseLookRef.current?.release(); setPaused(true);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== "KeyH" || e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || drawing || settingsOpen) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      toggleLook();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [drawing, paused, settingsOpen]);
  const beginDrawing = () => {
    if (!captureRef.current) return;
    setArmed(null); setGhost(null); setPaused(true); setError("");
    try { setDrawing(captureRef.current()); } catch (e) { setError(`Could not capture the room: ${String(e)}`); }
  };
  const generate = async (request: DrawingRequest) => {
    if (await generation.start(request)) setDrawing(null);
  };
  const setPlacements = (next: Placement[]) => dispatch({ type: "set", placements: next });
  const update = (patch: Partial<Placement>) => {
    if (active) setPlacements(placements.map((p) => p.id === active.id ? { ...p, ...patch } : p));
  };
  const arm = (modelId: string, movingId?: string, suggestedSize?: number) => {
    const existing = placements.find((p) => p.id === movingId);
    mouseLookRef.current?.release();
    setPaused(true); setLibraryOpen(true);
    setSelected(null);
    setArmed({ modelId, movingId, targetSize: existing ? existing.targetSize * existing.scale : suggestedSize ?? 0.15 });
    setYaw(0); setGhost(null); setPreviewReady(false); setError("");
  };
  const cancel = () => { setArmed(null); setGhost(null); };

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setImporting(true); setError("");
    try {
      const added: Model[] = [];
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".glb")) throw new Error("Choose a .glb file with embedded textures.");
        if (file.size > 150 * 1024 * 1024) throw new Error("Choose a GLB smaller than 150 MB.");
        validateGlb(await file.arrayBuffer());
        const url = URL.createObjectURL(file);
        try {
          const gltf = await gltfLoader.loadAsync(url);
          const box = new Box3().setFromObject(gltf.scene);
          disposeModel(gltf.scene);
          if (box.isEmpty()) throw new Error("The model has no visible geometry.");
        } catch (e) { URL.revokeObjectURL(url); throw e; }
        urls.current.push(url);
        const model = { id: crypto.randomUUID(), name: file.name.replace(/\.glb$/i, ""), url, blob: file };
        added.push(model);
        // Keep each successful import even if a subsequent file fails.
        setModels((current) => [...current, model]);
      }
      if (added.length) arm(added[0].id);
    } catch (e) { setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setImporting(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  return <div className="local-editor">
    <header className="viewer-toolbar" inert={!!drawing}>
      <div className="brand"><span className="brand-mark">✳</span><div>Print Twin<small>Your room, reimagined</small></div></div>
      <nav aria-label="Room controls">
        <button className={paused ? "is-active" : ""} aria-pressed={paused} disabled={!!drawing} onClick={toggleLook}>{paused ? "Resume look" : "Pause look"} <kbd>H</kbd></button>
        <button className="primary" disabled={!!drawing || generation.busy || !!generation.pending || !generation.configured || !restored || !status.startsWith("Ready")} title={generation.connection} onClick={beginDrawing}>Draw an object <span>＋</span></button>
        <button aria-expanded={libraryOpen} aria-controls="object-library" onClick={() => setLibraryOpen((v) => !v)}>Objects <span className="count">{placements.length}</span></button>
        <button className="settings-trigger" aria-label="Settings" title="API settings" onClick={() => { mouseLookRef.current?.release(); setPaused(true); setSettingsOpen(true); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/></svg></button>
      </nav>
    </header>
    <aside id="object-library" className={`editor-panel ${libraryOpen ? "open" : ""}`} inert={!libraryOpen || !!drawing}>
      <div className="section-heading"><h2>Objects & placement</h2><button aria-label="Close objects" onClick={() => setLibraryOpen(false)}>×</button></div>
      <p className="muted room-status" role="status">{status}</p>
      <div className="row"><button onClick={() => setReset((n) => n + 1)}>Reset view</button><span className="save-status" role="status">{saving}</span></div>
      <p className="controls-help">Click room to capture mouse · H to release<br />Q/E down/up · Shift for speed</p>

      {error && <div role="alert" className="error">{error}<button aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}

      <section>
        <div className="section-heading"><h2>Model library</h2><span>{models.length}</span></div>
        <input ref={fileInput} type="file" accept=".glb" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
        <button className="primary wide" disabled={importing || !restored} onClick={() => fileInput.current?.click()}>{importing ? "Importing model…" : "+ Import GLB"}</button>
        <p className="hint">Models and placements stay in this browser. Import a GLB with embedded textures.</p>
        {models.map((model) => <div className="model-row" key={model.id}>
          <span title={model.name}>{model.name}</span>
          <a href={model.url} download={`${model.name.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 60) || "asset"}.glb`} aria-label={`Download ${model.name} as GLB`} title="Download GLB with its stored materials">↓</a>
          <button disabled={!restored} onClick={() => arm(model.id)}>Place</button>
          {model.blob && <button aria-label={`Remove ${model.name} from library`} title="Remove unused model (placed models and undo history keep it in use)"
            disabled={armed?.modelId === model.id || [...history.past, placements, ...history.future].some((snapshot) => snapshot.some((p) => p.modelId === model.id))}
            onClick={() => { setModels(models.filter((m) => m.id !== model.id)); URL.revokeObjectURL(model.url); }}>×</button>}
        </div>)}
      </section>

      {armed && armedModel && <section className="placing-panel">
        <div className="section-heading"><h2>{armed.movingId ? "Move object" : "Place object"}</h2><button onClick={cancel}>Cancel</button></div>
        <strong>{armedModel.name}</strong>
        <p role="status">{!previewReady ? "Loading preview…" : ghost ? `On ${ghost.source === "collider" ? "room surface" : "splat surface"} · size ×${ghost.scale.toFixed(2)}` : "Move the cursor over a room surface"}</p>
        <p className="hint">Click to place · Scroll to resize<br />Esc / right-click to cancel</p>
        <label className="field">Size <NumberInput label="Preview size" value={armed.targetSize} min={0.02} max={10} step={0.05} onChange={(value) => setArmed({ ...armed, targetSize: value })} /></label>
        <label className="field">Turn <NumberInput label="Preview rotation" value={yaw} min={-360} max={360} step={15} onChange={setYaw} />°</label>
        {!armed.movingId && <label className="check"><input type="checkbox" checked={upright} onChange={(e) => setUpright(e.target.checked)} />Keep upright</label>}
      </section>}

      <section>
        <div className="section-heading"><h2>In this room</h2><span>{placements.length}</span></div>
        <div className="row">
          <button disabled={!history.past.length || !!armed} onClick={() => dispatch({ type: "undo" })}>Undo</button>
          <button disabled={!history.future.length || !!armed} onClick={() => dispatch({ type: "redo" })}>Redo</button>
        </div>
        {!placements.length && <p className="hint">Choose Place above, then click a table or the floor.</p>}
        {placements.map((p, i) => <button className={`object-row ${p.id === selected ? "selected" : ""}`} key={p.id} onClick={() => { cancel(); setSelected(p.id); }}>
          <span>{models.find((m) => m.id === p.modelId)?.name ?? "Missing model"}</span><span>#{i + 1}</span>
        </button>)}
      </section>

      {active && !armed && <section className="selection-panel">
        <h2>Selected object</h2>
        <div className="row wrap">
          <button onClick={() => arm(active.modelId, active.id)}>Move</button>
          <button onClick={() => arm(active.modelId)}>Place another</button>
          <button className="danger" onClick={() => { setPlacements(placements.filter((p) => p.id !== active.id)); setSelected(null); }}>Remove</button>
        </div>
        <label className="field">Scale <NumberInput label="Object scale" value={active.scale} min={0.05} max={20} step={0.1} onChange={(scale) => update({ scale })} /></label>
        {(["X", "Y", "Z"] as const).map((axis, index) => <label className="field" key={axis}>{axis} position <NumberInput label={`${axis} position`} value={active.position[index]} min={-1000} max={1000} step={0.05} onChange={(value) => { const position = [...active.position]; position[index] = value; update({ position }); }} /></label>)}
        {(["Tilt", "Turn", "Roll"] as const).map((axis, index) => <label className="field" key={axis}>{axis} <NumberInput label={`Object ${axis.toLowerCase()}`} value={active.rotation[index] * 180 / Math.PI} min={-360} max={360} step={15} onChange={(value) => { const rotation = [...active.rotation]; rotation[index] = value * Math.PI / 180; update({ rotation }); }} />°</label>)}
        <button onClick={() => update({ rotation: [0, active.rotation[1], 0] })}>Stand upright</button>
      </section>}
      <details><summary>Surface inspection</summary><label className="check"><input type="checkbox" checked={wireframe} onChange={(e) => setWireframe(e.target.checked)} />Show room collider</label><p className="hint">Placement follows reconstructed surfaces. Size and position use the room’s native units.</p></details>
    </aside>

    <main className="room-canvas" aria-label="3D room">
      <Canvas frameloop={drawing ? "never" : "always"} dpr={1} gl={{ antialias: false }} camera={{ position: [0, 0, 0], fov: 65, near: 0.02, far: 500 }}>
        <SparkSetup />
        <DrawingBridge captureRef={captureRef} />
        <SplatWorld url="/room/assets/splat-full_res.spz" />
        <ambientLight intensity={1.4} />
        <directionalLight position={[3, 5, 2]} intensity={2} />
        <ColliderBoundary onError={setError}><Suspense fallback={null}><Collider url="/room/assets/collider.glb" visible={wireframe} /></Suspense></ColliderBoundary>
        {placements.filter((p) => p.id !== armed?.movingId).map((p) => {
          const model = models.find((m) => m.id === p.modelId);
          return model && <Asset key={p.id} url={model.url} {...p} onClick={armed || !paused || drawing ? undefined : () => { setSelected(p.id); setLibraryOpen(true); }} onError={setError} />;
        })}
        {active && !armed && <mesh position={active.position as [number, number, number]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.035, 0.05, 32]} /><meshBasicMaterial color="#98f5ba" depthTest={false} transparent opacity={0.8} />
        </mesh>}
        {armed && armedModel && !settingsOpen && <PlacementGhost key={`${armed.modelId}:${armed.movingId ?? "new"}`} url={armedModel.url} targetSize={armed.targetSize}
          rotation={placements.find((p) => p.id === armed.movingId)?.rotation}
          upright={upright} yaw={yaw * Math.PI / 180} pickHz={12} allow={SURFACES} onPreview={setGhost} onReady={() => setPreviewReady(true)}
          onError={(message) => { setError(message); cancel(); }} onCancel={cancel}
          onCommit={(position, rotation, scale) => {
            const placed: Placement = { id: armed.movingId ?? crypto.randomUUID(), modelId: armed.modelId, position, rotation, scale, targetSize: armed.targetSize };
            setPlacements(armed.movingId ? placements.map((p) => p.id === armed.movingId ? placed : p) : [...placements, placed]);
            setSelected(placed.id); cancel();
          }} />}
        <Walk reset={reset} onStatus={setStatus} paused={paused || !!armed} enabled={!drawing && !settingsOpen} mouseLookRef={mouseLookRef}
          onLockChange={(locked) => { setMouseLocked(locked); setPaused(!locked); }} onError={setError} />
      </Canvas>
      {!drawing && <>
        <div className="canvas-badge"><span className="live-dot" />{status.startsWith("Ready") ? "LIVE ROOM" : status}</div>
        {mouseLocked && <div className="crosshair" />}
        {!paused && !mouseLocked && <div className="paused-hint">Click the room to explore · H releases the mouse</div>}
        <div className="walk-hint"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Walk</span><span><kbd>Q</kbd><kbd>E</kbd> Fly</span><span><kbd>Shift</kbd> Faster</span><span><kbd>H</kbd> {paused ? "Resume looking" : "Pause & draw"}</span></div>
        {paused && !armed && !generation.busy && !generation.pending && <div className="paused-hint">View paused · {generation.configured ? "Draw something into this room" : generation.connection}</div>}
        {armed && <div className="paused-hint">Click a room surface to place · Scroll to resize · Esc to cancel</div>}
        {error && !libraryOpen && <div className="floating-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
        {(generation.job || generation.busy || generation.error || generation.pending) && <div className="generation-card" aria-live="polite">
          {generation.job?.imageUrl && <img src={generation.job.imageUrl} alt="Generated object" />}
          <div className="generation-content"><div className="section-heading"><strong>{generatedInHand ? "Ready to place" : generatedPlaced ? "Added to your room" : generatedReady ? "Saved to your library" : generation.busy ? "Creating your object" : "Drawing to 3D"}</strong><span>{generation.elapsed.toFixed(0)}s</span></div>
            <p>{generation.error || (generatedInHand ? "Move over a room surface, then click to place." : generatedPlaced ? "Select your object to adjust it." : generatedReady ? "Choose Place when you're ready." : generation.busy ? generation.job?.label || "Sending drawing…" : generation.job?.label || "Recover your saved generation")}</p>
            {generation.busy && <div className="pipeline-steps">{["image", "background", "mesh", "export"].map((stage, i) => <span key={stage} className={stage === generation.job?.stage ? "current" : ""}>{["Image", "Cutout", "3D + color", "Print copy"][i]}</span>)}</div>}
            <div className="row wrap">
              {generatedReady && !generatedInHand && !generatedPlaced && <button onClick={() => arm(generatedModelId!)}>Place object</button>}
              {generation.job?.glbUrl && <a download href={generation.job.glbUrl}>{generation.job.colorInfo?.hasSurfaceColor ? "Color GLB" : "GLB"} ↗</a>}
              {generation.job?.stlUrl && <a download href={generation.job.stlUrl}>STL · no color ↗</a>}
              {!generation.busy && generation.pending && <button onClick={generation.reconnect}>Reconnect</button>}
              {!generation.busy && generation.job?.canResume && <button onClick={() => void generation.resume()}>Resume task</button>}
              {!generation.busy && <button onClick={generation.dismiss}>{generation.pending ? "Dismiss recovery" : "Done"}</button>}
            </div>
          </div>
        </div>}
      </>}
      {drawing && <DrawingLayer capture={drawing} onCancel={() => setDrawing(null)} onGenerate={generate} blocked={generation.busy || !!generation.pending} errorMessage={generation.error} />}
    </main>
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onSaved={generation.refreshConfiguration} />}
  </div>;
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
