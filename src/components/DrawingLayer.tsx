import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "three";
import { anchorDrawing, contactPoint, drawingBounds, type DrawingAnchor, type Point, type Stroke } from "../lib/drawingPlacement";

export type DrawingCapture = { image: HTMLCanvasElement; anchor: (strokes: Stroke[]) => DrawingAnchor };
export type DrawingRequest = { image: string; cleanImage: string; description: string; anchor: DrawingAnchor };
export function DrawingBridge({ captureRef }: { captureRef: React.MutableRefObject<(() => DrawingCapture) | null> }) {
  const { gl, camera, scene } = useThree();
  useEffect(() => {
    captureRef.current = () => {
      gl.render(scene, camera);
      const image = document.createElement("canvas");
      // One capped snapshot avoids Retina-sized uploads and retains the viewport's aspect.
      const ratio = Math.min(1, 1280 / Math.max(gl.domElement.width, gl.domElement.height));
      image.width = Math.round(gl.domElement.width * ratio); image.height = Math.round(gl.domElement.height * ratio);
      image.getContext("2d")!.drawImage(gl.domElement, 0, 0, image.width, image.height);
      const frozen = (camera as PerspectiveCamera).clone();
      return { image, anchor: (strokes) => anchorDrawing(strokes, frozen, scene) };
    };
    return () => { captureRef.current = null; };
  }, [gl, camera, scene, captureRef]);
  return null;
}

const INK = "#ff5488";
export function DrawingLayer({ capture, onCancel, onGenerate, blocked, errorMessage }: { capture: DrawingCapture; onCancel: () => void; onGenerate: (request: DrawingRequest) => Promise<void>; blocked: boolean; errorMessage: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<{ stroke: Stroke; pointerId: number } | null>(null);
  const [revision, setRevision] = useState(0);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [anchor, setAnchor] = useState<DrawingAnchor | null>(null);
  const bounds = drawingBounds(strokes.current);
  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(capture.image, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = ctx.fillStyle = INK;
    ctx.lineCap = ctx.lineJoin = "round";
    for (const s of strokes.current) {
      ctx.lineWidth = s.width * canvas.width;
      ctx.beginPath();
      const first = s.points[0];
      ctx.moveTo(first.x * canvas.width, first.y * canvas.height);
      for (const p of s.points) ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
      if (s.points.length === 1) { ctx.arc(first.x * canvas.width, first.y * canvas.height, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.stroke();
    }
  }
  function refreshAnchor() {
    setAnchor(null); setError("");
    if (drawingBounds(strokes.current)) {
      try { setAnchor(capture.anchor(strokes.current)); }
      catch (e) { setError((e as Error).message); }
    }
    setRevision((n) => n + 1);
  }
  useEffect(render, [capture, revision]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onCancel]);
  function point(e: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) };
  }
  function end(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (current.current?.pointerId !== e.pointerId) return;
    current.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    refreshAnchor();
  }
  return <div className="drawing-layer" role="region" aria-label="Draw an object in the room">
    <canvas ref={canvasRef} width={capture.image.width} height={capture.image.height} aria-label="Drawing canvas"
      onPointerDown={(e) => {
        if (e.button !== 0 || current.current) return;
        e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
        const stroke = { points: [point(e)], width: 3 / e.currentTarget.getBoundingClientRect().width };
        current.current = { stroke, pointerId: e.pointerId }; strokes.current.push(stroke); render();
      }}
      onPointerMove={(e) => { if (current.current?.pointerId === e.pointerId) { current.current.stroke.points.push(point(e)); render(); } }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} />
    <div className="drawing-heading"><span className="live-dot" />DRAW IN YOUR ROOM<span>Outline an object. Let its base touch a surface.</span></div>
    {bounds && <div className="drawing-bounds" style={{ left: `${bounds.left * 100}%`, top: `${bounds.top * 100}%`, width: `${(bounds.right - bounds.left) * 100}%`, height: `${(bounds.bottom - bounds.top) * 100}%` }}>
      <span className={anchor ? "anchor valid" : "anchor"} title="Object contact point"
        style={{ left: `${(contactPoint(strokes.current, bounds).x - bounds.left) / (bounds.right - bounds.left) * 100}%` }} /></div>}
    <form className="drawing-composer" onSubmit={(e) => {
      e.preventDefault();
      if (blocked || !bounds || !anchor || !description.trim() || current.current) return;
      void onGenerate({ image: canvasRef.current!.toDataURL("image/png"), cleanImage: capture.image.toDataURL("image/png"), description: description.trim(), anchor });
    }}>
      <div className="drawing-tools"><span>{anchor ? "Anchored to a real surface · it'll be placed where you drew it" : "Draw the object's outline"}</span>
        <button type="button" disabled={!strokes.current.length} onClick={() => { strokes.current.pop(); refreshAnchor(); }}>Undo stroke</button>
        <button type="button" disabled={!strokes.current.length} onClick={() => { strokes.current = []; refreshAnchor(); }}>Clear</button>
        <button type="button" onClick={onCancel}>Cancel <kbd>Esc</kbd></button>
      </div>
      <div className="composer-row"><input aria-label="Describe your object" placeholder="What are you imagining? A faceted ceramic pot…" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} required />
        <button className="primary" disabled={blocked || !anchor || !description.trim()} type="submit">{blocked ? "Sending drawing…" : "Create in room"} <span>↗</span></button></div>
      <p role="status" className={error || errorMessage ? "error-text" : "hint"}>{errorMessage || error || "Image → color GLB → placed where you drew it · Keep exploring while it builds."}</p>
    </form>
  </div>;
}
