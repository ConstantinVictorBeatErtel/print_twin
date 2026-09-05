// Anonymous per-browser session (good enough for a hackathon; swap for Convex Auth/Clerk later).
export function getSessionId(): string {
  const k = "spatial-hack-session";
  let id = localStorage.getItem(k);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(k, id); }
  return id;
}
export const randomColor = () => `hsl(${Math.floor(Math.random() * 360)} 80% 60%)`;
export const roomFromUrl = () => new URLSearchParams(location.search).get("room") ?? "lobby";
