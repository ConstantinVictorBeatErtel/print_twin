import { useEffect, useRef, useState } from "react";
import type { DrawingRequest } from "../components/DrawingLayer";
import type { DrawingAnchor } from "./drawingPlacement";

const STORAGE = "print-twin-drawing-job-v1";
export type AssetJob = { id: string; status: string; stage: string; label: string; description: string; createdAt: string; totalMs?: number; progress?: number; error?: string; canResume?: boolean; glbUrl?: string; stlUrl?: string; imageUrl?: string; colorInfo?: { hasSurfaceColor: boolean } };
type Pending = { id: string; anchor: DrawingAnchor };
export function useDrawingJob({ enabled, onReady }: { enabled: boolean; onReady: (job: AssetJob, anchor: DrawingAnchor) => Promise<void> }) {
  const [job, setJob] = useState<AssetJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(false);
  const [configurationVersion, setConfigurationVersion] = useState(0);
  const [connection, setConnection] = useState("Checking generation service…");
  const [pending, setPending] = useState<Pending | null>(null);
  const [watchVersion, setWatchVersion] = useState(0);
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;
  const delivered = useRef(new Set<string>());
  const starting = useRef(false);
  const deliveries = useRef(new Map<string, Promise<void>>());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    let alive = true;
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE) || "null");
      if (stored?.id && stored?.anchor?.cameraWorld?.length === 16 && stored?.anchor?.projection?.length === 16) setPending(stored);
    } catch { setError("Saved drawing recovery could not be read."); }
    fetch("/api/asset-status").then(async (r) => { if (!r.ok) throw new Error(); return r.json(); }).then((data) => {
      if (!alive) return;
      setConfigured(data.configured);
      setConnection(data.configured ? "Color pipeline ready" : "Open Settings to add your fal and Tripo API keys.");
    }).catch(() => { if (alive) setConnection("Generation API unavailable. Run npm run dev:local."); });
    return () => { alive = false; };
  }, [configurationVersion]);
  useEffect(() => {
    if (!busy || !job?.createdAt) return;
    const tick = () => setElapsed(Math.max(0, (Date.now() - Date.parse(job.createdAt)) / 1000));
    tick(); const timer = window.setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [busy, job?.createdAt]);
  useEffect(() => {
    if (!pending || !enabled) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/asset-jobs/${pending!.id}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
        if (!response.ok) throw new Error(response.status === 404 ? "This job is not on the server. Start a new drawing when ready." : "Could not retrieve generation status.");
        const data: AssetJob = await response.json();
        if (abort.signal.aborted) return;
        setJob(data); setBusy(data.status === "running"); setElapsed((data.totalMs || Date.now() - Date.parse(data.createdAt)) / 1000);
        // Hand off to placement preview when GLB is available, without waiting for STL export.
        if (data.glbUrl && !delivered.current.has(data.id)) {
          if (!deliveries.current.has(data.id)) deliveries.current.set(data.id, onReadyRef.current(data, pending!.anchor));
          try { await deliveries.current.get(data.id); } finally { deliveries.current.delete(data.id); }
          if (abort.signal.aborted) return;
          delivered.current.add(data.id);
        }
        if (data.status !== "running") {
          setError(data.error || "");
          if (delivered.current.has(data.id) && data.status === "done") { localStorage.removeItem(STORAGE); setPending(null); }
          return;
        }
        timer = setTimeout(poll, 500);
      } catch (e) {
        if (abort.signal.aborted) return;
        setBusy(false); setError(`${(e as Error).message} Reconnect to recover this job; the server keeps working.`);
      }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [pending, enabled, watchVersion]);
  async function start(request: DrawingRequest) {
    if (starting.current || pending || busy) return false;
    starting.current = true; setBusy(true); setError(""); setJob(null); setElapsed(0);
    const saved = { id: crypto.randomUUID(), anchor: request.anchor };
    let persisted = false;
    try {
      // Persist the world-space anchor before any paid work; only ID-based recovery follows.
      localStorage.setItem(STORAGE, JSON.stringify(saved));
      persisted = true;
      const response = await fetch("/api/asset-jobs", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ id: saved.id, image: request.image, cleanImage: request.cleanImage, description: request.description, heightMm: 100 }),
      });
      const data = await response.json();
      if (!response.ok) {
        // 5xx can follow a persisted submission: preserve ID to avoid a duplicate charge.
        if (response.status >= 500 && response.status !== 503) setPending(saved);
        else { localStorage.removeItem(STORAGE); persisted = false; }
        throw new Error(data.error || "Could not start generation.");
      }
      setJob(data); setPending(saved); return true;
    } catch (e) {
      if (persisted) setPending(saved);
      setBusy(false); setError((e as Error).message || "Connection interrupted. Reconnect before generating again."); return false;
    } finally { starting.current = false; }
  }
  async function resume() {
    if (!pending || busy || starting.current) return;
    starting.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/asset-jobs/${pending.id}/resume`, { method: "POST", signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setJob(data); setWatchVersion((n) => n + 1);
    } catch (e) { setBusy(false); setError((e as Error).message); }
    finally { starting.current = false; }
  }
  return { job, busy, error, configured, connection, elapsed, pending, start, resume,
    refreshConfiguration: () => setConfigurationVersion((n) => n + 1),
    reconnect: () => { setError(""); setWatchVersion((n) => n + 1); },
    // Explicit dismissal only abandons recovery; it never cancels remote work.
    dismiss: () => { localStorage.removeItem(STORAGE); setPending(null); setJob(null); setError(""); },
  };
}
