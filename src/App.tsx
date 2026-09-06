import { useEffect, useMemo, useRef, useState } from 'react';
import { useConvex } from 'convex/react';
import { CaptureEntry } from './components/CaptureEntry';
import { ConvexProjectClient, DEMO_JOB } from './lib/ConvexProjectClient';
import WorldApp from './WorldApp';

export default function App() {
  const convex = useConvex();
  const client = useMemo(() => new ConvexProjectClient(convex), [convex]);
  const [worldId, setWorldId] = useState(() => new URLSearchParams(location.search).get('world'));
  const [legacyJob, setLegacyJob] = useState(() => new URLSearchParams(location.search).get('job'));
  const [viewer, setViewer] = useState(() => new URLSearchParams(location.search).has('viewer'));
  const [loading, setLoading] = useState(Boolean(legacyJob));
  const [error, setError] = useState('');
  const activeRequest = useRef(0);
  const busy = useRef(false);

  const openDemo = async (job = DEMO_JOB) => {
    if (busy.current) return;
    busy.current = true;
    const request = ++activeRequest.current;
    setLoading(true);
    setError('');
    try {
      // Start importing immediately; subsequent entries reuse the durable Convex world.
      const [id] = await Promise.all([
        client.importLocalWorld(job),
        new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
      ]);
      if (request !== activeRequest.current) return;
      const url = new URL(location.href);
      url.searchParams.set('world', id);
      url.searchParams.delete('job');
      url.searchParams.delete('viewer');
      history.replaceState(null, '', url);
      setLegacyJob(null);
      setWorldId(id);
      setViewer(true);
    } catch (e) {
      if (request === activeRequest.current) setError(e instanceof Error ? e.message : 'Unable to open the saved world.');
    } finally {
      if (request === activeRequest.current) { busy.current = false; setLoading(false); }
    }
  };

  // Preserve old local ?job= links by importing them into the same Convex app.
  useEffect(() => {
    if (legacyJob && !worldId) void openDemo(legacyJob);
  }, [legacyJob, worldId, client]);

  const newWorld = () => {
    ++activeRequest.current;
    busy.current = false;
    setWorldId(null);
    setLegacyJob(null);
    setViewer(false);
    setLoading(false);
    setError('');
    const url = new URL(location.href);
    for (const key of ['world', 'job', 'room', 'viewer']) url.searchParams.delete(key);
    history.replaceState(null, '', url);
  };

  if (loading || error) return <main className="capture-entry capture-loading" role={error ? 'alert' : 'status'}>
    <div className="capture-card">
      {!error && <div className="capture-spinner" aria-hidden="true" />}
      <p className="capture-kicker">doodleforge</p>
      <h1>{error ? 'Unable to open the world.' : 'Step into your world.'}</h1>
      <p className="capture-copy">{error || 'Opening the demo world…'}</p>
      {error && <>
        <button className="capture-create" onClick={() => void openDemo(legacyJob ?? DEMO_JOB)}>Retry</button>
        <button className="entry-secondary" onClick={() => { setError(''); setLegacyJob(null); setViewer(true); }}>Explore demo room</button>
        <button className="entry-secondary" onClick={newWorld}>Back</button>
      </>}
    </div>
  </main>;

  if (worldId || viewer) return <WorldApp key={worldId ?? 'viewer'} initialWorldId={worldId ?? undefined} onNewWorld={newWorld} />;
  return <>
    <CaptureEntry onCreate={() => void openDemo()} />
    <button className="open-existing-app" onClick={() => setViewer(true)}>Explore demo room</button>
  </>;
}
