import { StatusChip } from './StatusChip';
import { ModeBar, type AppMode } from './ModeBar';
import { VirtualJoystick } from './VirtualJoystick';
import type { ProjectView } from '../types';
import type { Surface } from '../surface';

type Props = {
  surface: Surface;
  project: ProjectView | null;
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  showHint: boolean;
  showCollider: boolean;
  onToggleCollider: (show: boolean) => void;
  onUndo: () => void;
  onClear: () => void;
  onJoystick: (move: { x: number; z: number }) => void;
  status: 'loading' | 'ready' | 'error';
  statusMessage?: string;
  thumbnailUrl: string | null;
};

export function Hud({
  surface,
  project,
  mode,
  onModeChange,
  showHint,
  showCollider,
  onToggleCollider,
  onUndo,
  onClear,
  onJoystick,
  status,
  statusMessage,
  thumbnailUrl,
}: Props) {
  const phone = surface === 'phone';

  return (
    <div className={`hud ${phone ? 'hud-phone' : 'hud-laptop'}`}>
      {status === 'loading' && (
        <div className="hud-loading">
          {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="hud-thumb" /> : null}
          <p>Loading room…</p>
        </div>
      )}
      {status === 'error' && (
        <div className="hud-error">
          <p>{statusMessage ?? 'Something went wrong'}</p>
        </div>
      )}

      <header className="hud-top">
        <div className="hud-brand">
          <strong>doodleforge</strong>
          {project ? <span className="hud-world">{project.world.displayName}</span> : null}
        </div>
        {project ? (
          <div className="hud-chips">
            <StatusChip label="calibration" value={project.world.coordinates.calibration} />
            <StatusChip
              label="collider"
              value={project.world.coordinates.colliderAlignment}
            />
          </div>
        ) : null}
      </header>

      {project && status === 'ready' ? (
        <div className="hud-objects">
          {project.objects.map((o) => (
            <span key={o.id} className="object-tag">
              {o.id}
            </span>
          ))}
        </div>
      ) : null}

      {!phone && showHint && mode === 'explore' && status === 'ready' ? (
        <div className="hud-hint">Click to look · WASD move · Q/E up/down</div>
      ) : null}

      {!phone && status === 'ready' ? (
        <label className="hud-debug">
          <input
            type="checkbox"
            checked={showCollider}
            onChange={(e) => onToggleCollider(e.target.checked)}
          />
          Show unverified collider
        </label>
      ) : null}

      {mode === 'draw' && status === 'ready' ? (
        <div className="hud-draw-tools">
          <button type="button" onClick={onUndo}>
            Undo
          </button>
          <button type="button" onClick={onClear}>
            Clear
          </button>
          <button type="button" disabled title="Image generation is not wired yet">
            Generate
          </button>
        </div>
      ) : null}

      <VirtualJoystick
        visible={phone && mode === 'explore' && status === 'ready'}
        onMove={onJoystick}
      />

      <footer className="hud-bottom">
        <ModeBar mode={mode} onModeChange={onModeChange} phone={phone} />
      </footer>
    </div>
  );
}
