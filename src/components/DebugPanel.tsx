// Live tuning for the placement pipeline, shown in the sidebar under ?debug=1.
//
// Everything here is a knob that would otherwise be a constant recompile away: the room's
// coordinate fudge factors (for checking collider/splat alignment), how the object is sized,
// and how the raycast under the cursor behaves.
import { TARGET_SIZE } from "../lib/fit";
import type { PickSource } from "../lib/surfacePick";

export type DebugSettings = {
  showCollider: boolean;      // draw the Marble collider as a wireframe
  metricScaleMul: number;     // multiplies the world's metric_scale_factor
  groundOffsetAdd: number;    // added to the world's ground_plane_offset (pre-scale units)
  targetSize: number;         // metres, longest dimension of a placed object
  ghostOpacity: number;
  pickHz: number;             // how often the ghost re-raycasts
  clickSlop: number;          // px of drag still counted as a click, not an orbit
  minRaycastOpacity: number;  // Spark: how solid a splat must be to be hit (rebuilds the splat)
  allow: Record<PickSource, boolean>;
};

export const DEBUG_DEFAULTS: DebugSettings = {
  showCollider: true,
  metricScaleMul: 1,
  groundOffsetAdd: 0,
  targetSize: TARGET_SIZE,
  ghostOpacity: 0.85,
  pickHz: 30,
  clickSlop: 4,
  minRaycastOpacity: 0.2,
  allow: { collider: true, splat: true, plane: true },
};

export function DebugPanel({ settings, onChange }: {
  settings: DebugSettings;
  onChange: (next: DebugSettings) => void;
}) {
  const set = <K extends keyof DebugSettings>(key: K, value: DebugSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <div style={{ marginTop: 12, padding: 8, background: "#181818", border: "1px solid #333", borderRadius: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <b>Debug</b>
        <button style={{ fontSize: 11 }} onClick={() => onChange(DEBUG_DEFAULTS)}>reset</button>
      </div>

      <Check label="show collider wireframe" checked={settings.showCollider} onChange={(v) => set("showCollider", v)} />

      <Section>room transform</Section>
      <Slider label="metric scale ×" value={settings.metricScaleMul} min={0.2} max={3} step={0.01} digits={2}
        onChange={(v) => set("metricScaleMul", v)} />
      <Slider label="ground offset +" value={settings.groundOffsetAdd} min={-2} max={2} step={0.01} digits={2}
        onChange={(v) => set("groundOffsetAdd", v)} />

      <Section>object</Section>
      <Slider label="size (m)" value={settings.targetSize} min={0.05} max={3} step={0.05} digits={2}
        onChange={(v) => set("targetSize", v)} />
      <Slider label="ghost opacity" value={settings.ghostOpacity} min={0.1} max={1} step={0.05} digits={2}
        onChange={(v) => set("ghostOpacity", v)} />

      <Section>raycast</Section>
      <Slider label="pick rate (Hz)" value={settings.pickHz} min={5} max={60} step={1} digits={0}
        onChange={(v) => set("pickHz", v)} />
      <Slider label="click slop (px)" value={settings.clickSlop} min={0} max={20} step={1} digits={0}
        onChange={(v) => set("clickSlop", v)} />
      <Slider label="min splat opacity" value={settings.minRaycastOpacity} min={0} max={1} step={0.05} digits={2}
        onChange={(v) => set("minRaycastOpacity", v)} />
      <div style={{ opacity: 0.55, fontSize: 11, margin: "2px 0 4px" }}>changing this reloads the splat</div>
      <div style={{ display: "flex", gap: 8 }}>
        {(["collider", "splat", "plane"] as PickSource[]).map((s) => (
          <Check key={s} label={s} checked={settings.allow[s]}
            onChange={(v) => set("allow", { ...settings.allow, [s]: v })} />
        ))}
      </div>
    </div>
  );
}

const Section = ({ children }: { children: string }) =>
  <div style={{ marginTop: 8, opacity: 0.6, textTransform: "uppercase", fontSize: 10, letterSpacing: 1 }}>{children}</div>;

function Slider({ label, value, min, max, step, digits, onChange }: {
  label: string; value: number; min: number; max: number; step: number; digits: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "block", marginTop: 4 }}>
      <span style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span>{label}</span><span style={{ opacity: 0.7 }}>{value.toFixed(digits)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} style={{ width: "100%" }}
        onChange={(e) => onChange(e.target.valueAsNumber)} />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: 11 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}
    </label>
  );
}
