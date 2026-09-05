// The local picker accepts self-contained GLBs so every saved model survives reloads.
export function validateGlb(buffer: ArrayBuffer) {
  if (buffer.byteLength < 20) throw new Error("This file is too short to be a GLB model.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error("Choose a valid GLB 2.0 model.");
  }
  const length = view.getUint32(12, true);
  if (length > buffer.byteLength - 20) throw new Error("The GLB file is incomplete.");
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  const dependencies = [...(json.buffers ?? []), ...(json.images ?? [])];
  if (dependencies.some((entry) => entry.uri && !entry.uri.startsWith("data:"))) {
    throw new Error("Export a self-contained GLB with embedded textures and buffers.");
  }
  if (!json.meshes?.length) throw new Error("This GLB contains no mesh geometry.");
}
