export type Placement = {
  id: string;
  modelId: string;
  position: number[];
  rotation: number[];
  scale: number;
  targetSize: number;
};

export type History = { past: Placement[][]; present: Placement[]; future: Placement[][] };
export type SceneAction = { type: "set"; placements: Placement[] } | { type: "restore"; placements: Placement[] } | { type: "undo" } | { type: "redo" };
export const emptyHistory: History = { past: [], present: [], future: [] };

export function sceneHistory(state: History, action: SceneAction): History {
  if (action.type === "restore") return { past: [], present: action.placements, future: [] };
  if (action.type === "undo") {
    if (!state.past.length) return state;
    return { past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future] };
  }
  if (action.type === "redo") {
    if (!state.future.length) return state;
    return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
  }
  return { past: [...state.past.slice(-49), state.present], present: action.placements, future: [] };
}

export type StoredModel = { id: string; name: string; blob: Blob };
export type SavedScene = { version: 1; worldId: string; models: StoredModel[]; placements: Placement[] };
export const WORLD_ID = "262dd7ba-d156-46a1-8445-f62bc60e1265";

function finiteTriple(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

export function validPlacement(value: unknown): value is Placement {
  if (!value || typeof value !== "object") return false;
  const p = value as Placement;
  return typeof p.id === "string" && typeof p.modelId === "string" && finiteTriple(p.position) && finiteTriple(p.rotation)
    && Number.isFinite(p.scale) && p.scale >= 0.05 && p.scale <= 20
    && Number.isFinite(p.targetSize) && p.targetSize > 0 && p.targetSize <= 10;
}

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("print-twin-local-scenes", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("scenes");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Print Twin tabs to enable local saving."));
  });
  return database;
}

export async function loadScene(): Promise<SavedScene | undefined> {
  const db = await openDatabase();
  const value = await new Promise<SavedScene | undefined>((resolve, reject) => {
    const request = db.transaction("scenes").objectStore("scenes").get(WORLD_ID);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (value && (value.version !== 1 || value.worldId !== WORLD_ID || !Array.isArray(value.models)
    || !Array.isArray(value.placements) || !value.placements.every(validPlacement)
    || !value.models.every((m) => typeof m.id === "string" && typeof m.name === "string" && m.blob instanceof Blob))) {
    throw new Error("Saved scene could not be read. Existing saved data has been preserved.");
  }
  return value;
}

export async function saveScene(scene: SavedScene) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("scenes", "readwrite");
    tx.objectStore("scenes").put(scene, WORLD_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Scene save was interrupted."));
  });
}
