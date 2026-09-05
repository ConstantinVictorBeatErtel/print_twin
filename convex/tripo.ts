// Tripo v2 openapi client, ported from scripts/image-to-stl.mjs.
//
// Copied rather than imported: image-to-stl.mjs also pulls in three.js for its STL
// exporter, and we do not want three in the Convex bundle. Keep the two in sync if
// the generation payload changes — these flags are the ones verified to return a
// textured GLB (see COLOR_PIPELINE.md).
//
// Note this is a *different* API surface to the openapi.tripo3d.ai/v3 endpoint the
// older text/image actions in assets.ts use. This one is the live-verified path.

export const MODEL = "P1-20260311";

export type TripoCredentials = { key: string; base: string };
export type TripoApi = (path: string, init?: { method?: string; body?: unknown; timeoutMs?: number }) => Promise<any>;

/** No Tripo CLI config in Convex — the key comes from the deployment environment. */
export function credentials(env: Record<string, string | undefined> = process.env): TripoCredentials {
  const key = env.TRIPO_API_KEY?.trim();
  if (!key) throw new Error("No Tripo API key. Run `npx convex env set TRIPO_API_KEY <key>`.");
  const region = env.TRIPO_REGION || "ov";
  if (!["ov", "cn"].includes(region)) throw new Error("TRIPO_REGION must be ov or cn.");
  return { key, base: `https://api.tripo3d.${region === "cn" ? "com" : "ai"}/v2/openapi` };
}

export function makeApi({ key, base }: TripoCredentials): TripoApi {
  return async (path, { method = "GET", body, timeoutMs = 60000 } = {}) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    let payload = body as BodyInit | undefined;
    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    // A failed POST can still have created a paid task. Never retry it implicitly.
    let response: Response;
    try {
      response = await fetch(base + path, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new Error(`${method} ${path}: network failure/timeout. ${method === "POST" ? "Submission outcome may be unknown; check Tripo task history before submitting again." : "Resume the same task ID."}`);
    }
    let result: any;
    try { result = await response.json(); }
    catch { throw new Error(`${method} ${path}: non-JSON response (HTTP ${response.status}); check task history before repeating a submission.`); }
    if (!response.ok || result.code !== 0) {
      throw new Error(`Tripo HTTP ${response.status}, code ${result.code}: ${result.message || "API error"}`);
    }
    if (!result.data) throw new Error(`Tripo ${path} returned no data; check task history before repeating a submission.`);
    return result.data;
  };
}

/** Color settings verified live: standard textures aligned to the source image, no PBR maps. */
export function generationPayload(fileToken: string, type: string, { color = true } = {}) {
  return {
    type: "image_to_model", model_version: MODEL,
    file: { type, file_token: fileToken }, texture: color, pbr: false, export_uv: false,
    ...(color ? { texture_quality: "standard", texture_alignment: "original_image" } : {}),
  };
}

export async function waitForTask(
  api: TripoApi,
  taskId: string,
  { timeoutMs, pollMs, onProgress = () => {} }: { timeoutMs: number; pollMs: number; onProgress?: (task: any) => void },
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await api("/task/" + encodeURIComponent(taskId), { timeoutMs: Math.max(1, Math.min(30000, deadline - Date.now())) });
    onProgress(task);
    if (task.status === "success") return task;
    if (["failed", "cancelled", "canceled", "banned", "expired", "unknown"].includes(task.status)) {
      throw new Error(`Task ${taskId}: ${task.status}${task.error_msg ? " — " + task.error_msg : ""}`);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(pollMs, deadline - Date.now()))));
  }
  throw new Error(`Timed out waiting for Tripo. The remote task continues; resume it from the object card.`);
}
