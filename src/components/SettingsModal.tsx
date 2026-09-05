import { useEffect, useRef, useState } from "react";

type KeyName = "FAL_KEY" | "TRIPO_API_KEY";
type KeyStatus = Record<KeyName, { configured: boolean; source: "settings" | "environment" | null }>;
const fields: { key: KeyName; label: string; purpose: string; href: string }[] = [
  { key: "FAL_KEY", label: "fal API key", purpose: "Object images and background removal", href: "https://fal.ai/dashboard/keys" },
  { key: "TRIPO_API_KEY", label: "Tripo API key", purpose: "3D models and color textures", href: "https://platform.tripo3d.ai" },
];

export function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [values, setValues] = useState<Partial<Record<KeyName, string | null>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    const abort = new AbortController();
    fetch("/api/settings", { signal: abort.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load settings.");
      setStatus(data);
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => { abort.abort(); dialog.current?.close(); };
  }, []);
  async function save() {
    setBusy(true); setError(""); setMessage("");
    try {
      const updates = Object.fromEntries(Object.entries(values).filter(([, value]) => value === null || value?.trim()).map(([key, value]) => [key, value?.trim() ?? null]));
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save settings.");
      setValues({}); setStatus(data); setMessage("Saved. New generations use these keys immediately."); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save settings."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="settings-modal" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="section-heading"><div><h2 id="settings-title">Settings</h2><p className="hint">Connect your generation tools</p></div><button type="button" aria-label="Close settings" onClick={onClose} disabled={busy}>×</button></div>
      <p className="settings-intro">Keys are stored on this computer's server, outside Git. Saved values are never sent back to the browser. Leave a field blank to keep its current key.</p>
      {fields.map(({ key, label, purpose, href }) => <div className="settings-key" key={key}>
        <div className="section-heading"><label htmlFor={`setting-${key}`}>{label}</label><a href={href} target="_blank" rel="noreferrer">Get key ↗</a></div>
        <p className="hint">{purpose}</p>
        <input id={`setting-${key}`} name={key} type="password" autoComplete="new-password" spellCheck={false} autoCapitalize="none" maxLength={4096} disabled={!status || busy} value={values[key] ?? ""} onChange={e => { setValues({ ...values, [key]: e.target.value }); setMessage(""); }} placeholder={status?.[key].configured ? "Configured · enter a replacement" : `Paste ${key}`} />
        <div className="settings-key-status"><span>{values[key] === null ? "Saved key will be removed; environment fallback still applies." : status?.[key].configured ? `Configured in ${status[key].source === "settings" ? "local settings" : "environment"}` : key === "TRIPO_API_KEY" ? "Required unless already signed in with the Tripo CLI" : "Required for generation"}</span>
          {status?.[key].source === "settings" && <button type="button" disabled={busy} onClick={() => setValues({ ...values, [key]: values[key] === null ? "" : null })}>{values[key] === null ? "Keep key" : "Remove saved key"}</button>}
        </div>
      </div>)}
      {error && <p className="error-text" role="alert">{error}</p>}
      {message && <p className="settings-success" role="status">{message}</p>}
      <div className="settings-actions"><button type="button" onClick={onClose} disabled={busy}>Close</button><button className="primary" type="submit" disabled={!status || busy}>{busy ? "Saving…" : "Save keys"}</button></div>
    </form>
  </dialog>;
}
