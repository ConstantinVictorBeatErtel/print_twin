import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectClient } from './api/ProjectClient';
import { useProject } from './hooks/useProject';
import { RoomViewport } from './scene/RoomViewport';
import { SketchLayer } from './overlay/SketchLayer';
import { Hud } from './ui/Hud';
import type { AppMode } from './ui/ModeBar';
import { currentSurface } from './surface';
import './styles.css';

type Props = {
  client: ProjectClient;
};

export function App({ client }: Props) {
  const job = new URLSearchParams(location.search).get('job');
  return job ? <WorldExperience client={client} /> : <CaptureEntry />;
}

type CaptureStatus = 'uploading' | 'generating' | 'downloading' | 'complete' | 'failed';

function CaptureEntry() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  const choose = (next: File | undefined) => {
    setError('');
    if (!next) return;
    const image = ['image/jpeg', 'image/png', 'image/webp'].includes(next.type);
    const video = ['video/mp4', 'video/quicktime', 'video/webm'].includes(next.type);
    const max = video ? 100 : 20;
    if (!image && !video) return setError('Choose a JPG, PNG, WebP, MP4, MOV, or WebM file.');
    if (next.size > max * 1024 * 1024) return setError(`${video ? 'Videos' : 'Images'} must be ${max} MB or smaller.`);
    if (video) {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        URL.revokeObjectURL(probe.src);
        if (probe.duration > 30) setError('Videos must be 30 seconds or shorter.');
        else setFile(next);
      };
      probe.onerror = () => setError('This video could not be read.');
      probe.src = URL.createObjectURL(next);
      return;
    }
    setFile(next);
  };

  const create = async () => {
    if (!file || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/capture', { method: 'POST', body });
      const result = await response.json() as { job?: string; error?: string };
      if (!response.ok || !result.job) throw new Error(result.error ?? 'Upload failed.');
      location.assign(`/?job=${encodeURIComponent(result.job)}`);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'Upload failed.');
    }
  };

  return <main className="capture-entry">
    <div className="capture-card">
      <div className="capture-mark">◎</div>
      <p className="capture-kicker">PRINT THE WORLD</p>
      <h1>Step inside your space.</h1>
      <p className="capture-copy">Upload a photo or a short video. We’ll turn it into a world you can explore.</p>
      <input ref={inputRef} className="capture-input" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(e) => choose(e.target.files?.[0])} />
      <input ref={photoRef} className="capture-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => choose(e.target.files?.[0])} />
      <input ref={videoRef} className="capture-input" type="file" accept="video/mp4,video/quicktime,video/webm" capture="environment" onChange={(e) => choose(e.target.files?.[0])} />
      {file ? <div className="capture-preview">
        {file.type.startsWith('video/') ? <video src={URL.createObjectURL(file)} controls /> : <img src={URL.createObjectURL(file)} alt="Selected capture" />}
        <div><strong>{file.name}</strong><button type="button" onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ''; }}>Replace</button></div>
      </div> : <button type="button" className="capture-drop" onClick={() => inputRef.current?.click()}>
        <span className="capture-drop-icon">＋</span><strong>Choose a capture</strong><small>Photo or video · up to 100 MB</small>
      </button>}
      {!file && <div className="capture-actions"><button type="button" onClick={() => photoRef.current?.click()}>Take photo</button><button type="button" onClick={() => videoRef.current?.click()}>Record video</button></div>}
      {error && <p className="capture-error">{error}</p>}
      <button type="button" className="capture-create" disabled={!file || submitting} onClick={() => void create()}>{submitting ? 'Uploading…' : 'Create my world'}</button>
      <p className="capture-footnote">For best results, slowly pan around the room with steady lighting.</p>
    </div>
  </main>;
}

function WorldExperience({ client }: Props) {
  const surface = currentSurface();
  const quality = surface === 'phone' ? 'phone' : 'laptop';
  const job = new URLSearchParams(location.search).get('job')!;
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('generating');
  const [captureError, setCaptureError] = useState('');
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const result = await fetch(`/api/capture/${encodeURIComponent(job)}`).then((r) => r.json()) as { status: CaptureStatus; worldId?: string; error?: string };
        if (stopped) return;
        setCaptureStatus(result.status);
        if (result.error) setCaptureError(result.error);
        if (result.status === 'complete' && result.worldId) history.replaceState(null, '', `/?job=${encodeURIComponent(job)}&world=${encodeURIComponent(result.worldId)}`);
        if (result.status !== 'complete' && result.status !== 'failed') window.setTimeout(() => void poll(), 3000);
      } catch {
        if (!stopped) window.setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => { stopped = true; };
  }, [job]);
  const projectState = useProject(client, quality, captureStatus === 'complete');

  const viewportRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<RoomViewport | null>(null);
  const sketchRef = useRef<SketchLayer | null>(null);

  const [mode, setMode] = useState<AppMode>('explore');
  const [showHint, setShowHint] = useState(surface === 'laptop');
  const [showCollider, setShowCollider] = useState(false);
  const [viewportStatus, setViewportStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [viewportMessage, setViewportMessage] = useState<string | undefined>();

  useEffect(() => {
    if (projectState.status !== 'ready') return;
    const el = viewportRef.current;
    if (!el) return;

    let mounted = true;
    const room = new RoomViewport(el, surface, {
      onStatus: (status, message) => {
        if (!mounted) return;
        setViewportStatus(status);
        setViewportMessage(message);
      },
      onHintChange: (show) => {
        if (mounted) setShowHint(show);
      },
    });
    roomRef.current = room;

    const penWidth = surface === 'phone' ? 5 : 3;
    const sketch = new SketchLayer(el, penWidth);
    sketchRef.current = sketch;
    sketch.setEnabled(false);

    void room.start(projectState.project, projectState.assets);

    return () => {
      mounted = false;
      sketch.dispose();
      sketchRef.current = null;
      room.dispose();
      roomRef.current = null;
    };
  }, [projectState, surface]);

  const onModeChange = useCallback((next: AppMode) => {
    if (next !== 'explore' && next !== 'draw') return;
    setMode(next);
    roomRef.current?.setMode(next);
    sketchRef.current?.setEnabled(next === 'draw');
  }, []);

  const onToggleCollider = useCallback(
    (show: boolean) => {
      setShowCollider(show);
      if (projectState.status === 'ready') {
        void roomRef.current?.setShowCollider(show, projectState.assets.colliderUrl);
      }
    },
    [projectState],
  );

  const status =
    projectState.status === 'error'
      ? 'error'
      : projectState.status === 'loading'
        ? 'loading'
        : viewportStatus;

  const statusMessage =
    projectState.status === 'error' ? projectState.message : viewportMessage;

  const thumbnailUrl =
    projectState.status === 'ready' ? projectState.assets.thumbnailUrl : null;

  const project = projectState.status === 'ready' ? projectState.project : null;

  if (captureStatus !== 'complete') {
    return <main className="capture-entry capture-loading">
      <div className="capture-card">
        <div className="capture-spinner" />
        <p className="capture-kicker">PRINT THE WORLD</p>
        <h1>{captureStatus === 'failed' ? 'We couldn’t make that world.' : 'Your world is taking shape.'}</h1>
        <p className="capture-copy">{captureStatus === 'failed' ? captureError || 'Try another capture.' : captureStatus === 'uploading' ? 'Uploading your capture…' : captureStatus === 'downloading' ? 'Opening your world…' : 'World Labs is building the room. This can take a few minutes.'}</p>
        {captureStatus === 'failed' && <button type="button" className="capture-create" onClick={() => location.assign('/')}>Try another capture</button>}
      </div>
    </main>;
  }

  return (
    <div
      id="viewport"
      ref={viewportRef}
      className={surface === 'phone' ? 'surface-phone' : 'surface-laptop'}
    >
      <Hud
        surface={surface}
        project={project}
        mode={mode}
        onModeChange={onModeChange}
        showHint={showHint}
        showCollider={showCollider}
        onToggleCollider={onToggleCollider}
        onUndo={() => sketchRef.current?.undo()}
        onClear={() => sketchRef.current?.clear()}
        onJoystick={(move) => roomRef.current?.setJoystick(move)}
        status={status}
        statusMessage={statusMessage}
        thumbnailUrl={thumbnailUrl}
      />
    </div>
  );
}
