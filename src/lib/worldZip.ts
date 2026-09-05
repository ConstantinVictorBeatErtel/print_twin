// Read a packaged Marble world .zip (the `hackathon-room-full.zip` written by
// scripts/package_room.py, or any zip holding a splat + optional collider) in the
// browser, so its assets can go straight into Convex storage with no World Labs call.
import { unzip, type UnzipFileInfo, type Unzipped } from "fflate";

const SPLAT_EXTS = [".spz", ".ply", ".splat", ".ksplat"];
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

export type ZipEntry = { name: string; blob: Blob };
export type ZipWorld = {
  name: string;
  worldId?: string;
  model?: string;
  prompt?: string;
  metricScale?: number;
  groundOffset?: number;
  splat: ZipEntry;
  collider?: ZipEntry;
  pano?: ZipEntry;
};

export async function readWorldZip(file: File): Promise<ZipWorld> {
  const data = new Uint8Array(await file.arrayBuffer());

  // Pass 1: list entries. Returning false from the filter skips decompression,
  // so a 200 MB full-res archive costs nothing until we know what we want.
  const names: string[] = [];
  await extract(data, (f) => {
    if (!f.name.endsWith("/")) names.push(f.name);
    return false;
  });

  // package_room.py writes manifest.json at the archive root, but a zip made by
  // right-clicking the folder nests everything one level down.
  const manifestName = names
    .filter((n) => base(n) === "manifest.json")
    .sort((a, b) => a.split("/").length - b.split("/").length)[0];
  const prefix = manifestName ? manifestName.slice(0, -"manifest.json".length) : "";
  const manifest = manifestName ? await readJson(data, manifestName) : null;

  // A manifest asset key ("splat-500k", "collider", …) → its path inside this zip.
  const fromManifest = (key: string | undefined): string | undefined => {
    const path = key ? manifest?.assets?.[key]?.path : undefined;
    return typeof path === "string" && names.includes(prefix + path) ? prefix + path : undefined;
  };

  const splats = names.filter((n) => hasExt(n, SPLAT_EXTS));
  // Prefer the manifest's own pick (500k when Marble returned it): full_res is
  // 5–20x larger and the demo laptop still has to render it.
  const splatName =
    fromManifest(manifest?.preferredSplat) ??
    fromManifest("splat-500k") ??
    splats.find((n) => base(n).includes("500k")) ??
    splats.find((n) => !base(n).includes("full_res")) ??
    splats[0];
  if (!splatName) throw new Error(`no splat in ${file.name} (looked for ${SPLAT_EXTS.join(", ")})`);

  const colliderName = fromManifest("collider") ?? names.find((n) => base(n).endsWith(".glb"));
  const panoName =
    fromManifest("panorama") ??
    names.find((n) => base(n).startsWith("panorama") && hasExt(n, IMAGE_EXTS));

  const wanted = new Set([splatName, colliderName, panoName].filter(Boolean) as string[]);
  const files = await extract(data, (f) => wanted.has(f.name));
  const entry = (name?: string): ZipEntry | undefined =>
    name && files[name]
      ? { name: base(name), blob: new Blob([files[name]], { type: contentType(name) }) }
      : undefined;

  const semantics = manifest?.coordinates?.semantics ?? {};
  return {
    name: str(manifest?.displayName) ?? file.name.replace(/\.zip$/i, ""),
    worldId: str(manifest?.worldId),
    model: str(manifest?.model),
    prompt: str(manifest?.caption),
    metricScale: num(semantics.metric_scale_factor),
    groundOffset: num(semantics.ground_plane_offset),
    splat: entry(splatName)!,
    collider: entry(colliderName),
    pano: entry(panoName),
  };
}

function extract(data: Uint8Array, filter: (f: UnzipFileInfo) => boolean) {
  return new Promise<Unzipped>((resolve, reject) =>
    unzip(data, { filter }, (err, files) => (err ? reject(err) : resolve(files))),
  );
}

async function readJson(data: Uint8Array, name: string) {
  const files = await extract(data, (f) => f.name === name);
  // A world without a readable manifest still loads — we fall back to filename guesses.
  try {
    return JSON.parse(new TextDecoder().decode(files[name]));
  } catch {
    return null;
  }
}

const base = (n: string) => n.slice(n.lastIndexOf("/") + 1).toLowerCase();
const hasExt = (n: string, exts: string[]) => exts.some((e) => base(n).endsWith(e));
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function contentType(name: string) {
  const n = base(name);
  if (n.endsWith(".glb")) return "model/gltf-binary";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
