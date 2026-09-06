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
  const [screen, setScreen] = useState<'capture' | 'loading' | 'world'>(() =>
    new URLSearchParams(location.search).has('job') ? 'world' : 'capture',
  );

  useEffect(() => {
    if (screen !== 'loading') return;
    const timer = window.setTimeout(() => setScreen('world'), 3000);
    return () => window.clearTimeout(timer);
  }, [screen]);

  const create = () => {
    const url = new URL(location.href);
    url.searchParams.set('job', 'hackathon-stage-complete-02');
    url.searchParams.delete('world');
    history.replaceState(null, '', url);
    setScreen('loading');
  };

  if (screen === 'capture') return <CaptureEntry onCreate={create} />;
  return <>
    <div className="world-experience" inert={screen === 'loading'}>
      <WorldExperience client={client} />
    </div>
    {screen === 'loading' && <main className="capture-entry capture-loading" role="status" aria-live="polite">
      <div className="capture-card">
        <div className="capture-spinner" aria-hidden="true" />
        <p className="capture-kicker">doodleforge</p>
        <h1>Step into your world.</h1>
        <p className="capture-copy">Opening the demo world…</p>
      </div>
    </main>}
  </>;
}

function CaptureEntry({ onCreate }: { onCreate: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const isZip = file?.name.toLowerCase().endsWith('.zip') ?? false;

  useEffect(() => {
    if (!file || isZip) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isZip]);

  const choose = (next: File | undefined) => {
    if (!next) return;
    const version = ++selection.current;
    setError('');
    setFile(null);
    const zip = next.name.toLowerCase().endsWith('.zip');
    if (zip) { setFile(next); return; }
    const image = ['image/jpeg', 'image/png', 'image/webp'].includes(next.type);
    const video = ['video/mp4', 'video/quicktime', 'video/webm'].includes(next.type);
    const max = video ? 100 : 20;
    if (!image && !video) return setError('Choose a JPG, PNG, WebP, MP4, MOV, WebM, or ZIP file.');
    if (next.size > max * 1024 * 1024) return setError(`${video ? 'Videos' : 'Images'} must be ${max} MB or smaller.`);
    if (video) {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        URL.revokeObjectURL(probe.src);
        if (version !== selection.current) return;
        if (!Number.isFinite(probe.duration) || probe.duration > 30) setError('Videos must be 30 seconds or shorter.');
        else setFile(next);
      };
      probe.onerror = () => {
        URL.revokeObjectURL(probe.src);
        if (version === selection.current) setError('This video could not be read.');
      };
      probe.src = URL.createObjectURL(next);
      return;
    }
    setFile(next);
  };

  return <main className="capture-entry">
    <div className="capture-card">
      <div className="capture-mark">◎</div>
      <p className="capture-kicker">doodleforge</p>
      <h1>Step inside your space.</h1>
      <p className="capture-copy">Start with a photo, a short video, or a world ZIP.</p>
      <input ref={inputRef} className="capture-input" type="file" aria-label="Choose a capture" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.zip,application/zip,application/x-zip-compressed" onChange={(e) => choose(e.target.files?.[0])} />
      <input ref={photoRef} className="capture-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => choose(e.target.files?.[0])} />
      <input ref={videoRef} className="capture-input" type="file" accept="video/mp4,video/quicktime,video/webm" capture="environment" onChange={(e) => choose(e.target.files?.[0])} />
      <input ref={zipRef} className="capture-input" type="file" aria-label="Upload ZIP" accept=".zip,application/zip,application/x-zip-compressed" onChange={(e) => choose(e.target.files?.[0])} />
      {file ? <div className="capture-preview">
        {isZip ? <div className="capture-zip"><span aria-hidden="true">▤</span><span>World ZIP selected</span></div> : previewUrl && (file.type.startsWith('video/') ? <video src={previewUrl} controls /> : <img src={previewUrl} alt="Selected capture" />)}
        <div><strong>{file.name}</strong><button type="button" onClick={() => {
          ++selection.current;
          setFile(null);
          setError('');
          for (const ref of [inputRef, photoRef, videoRef, zipRef]) if (ref.current) ref.current.value = '';
        }}>Replace</button></div>
      </div> : <button type="button" className="capture-drop" onClick={() => inputRef.current?.click()}>
        <span className="capture-drop-icon">＋</span><strong>Choose a capture</strong><small>Photo, video, or ZIP</small>
      </button>}
      {!file && <div className="capture-actions"><button type="button" onClick={() => photoRef.current?.click()}>Take photo</button><button type="button" onClick={() => videoRef.current?.click()}>Record video</button><button type="button" onClick={() => zipRef.current?.click()}>Upload ZIP</button></div>}
      {error && <p className="capture-error" role="alert">{error}</p>}
      <button type="button" className="capture-create" disabled={!file} onClick={onCreate}>Create my world</button>
      <p className="capture-footnote">Demo preview · Every capture opens our existing world.</p>
    </div>
  </main>;
}

function WorldExperience({ client }: Props) {
  const surface = currentSurface();
  const quality = surface === 'phone' ? 'phone' : 'laptop';
  const projectState = useProject(client, quality);

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

    void room.start(projectState.project, projectState.assets).catch((error: unknown) => {
      if (!mounted) return;
      setViewportStatus('error');
      setViewportMessage(error instanceof Error ? error.message : 'Unable to open this world.');
    });

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
