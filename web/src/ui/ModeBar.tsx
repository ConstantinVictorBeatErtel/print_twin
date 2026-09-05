export type AppMode = 'explore' | 'draw' | 'adjust' | 'calibrate' | 'print';

type Props = {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  phone: boolean;
};

const MODES: { id: AppMode; label: string; enabled: boolean }[] = [
  { id: 'explore', label: 'Explore', enabled: true },
  { id: 'draw', label: 'Draw', enabled: true },
  { id: 'adjust', label: 'Adjust', enabled: false },
  { id: 'calibrate', label: 'Calibrate', enabled: false },
  { id: 'print', label: 'Print', enabled: false },
];

export function ModeBar({ mode, onModeChange, phone }: Props) {
  return (
    <div className={`mode-bar ${phone ? 'mode-bar-phone' : ''}`}>
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`mode-btn ${mode === m.id ? 'active' : ''}`}
          disabled={!m.enabled}
          title={m.enabled ? m.label : 'not wired yet'}
          onClick={() => m.enabled && onModeChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
