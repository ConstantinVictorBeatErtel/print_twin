// GLB container operations keep the original color asset byte-for-byte intact.
const JSON_CHUNK = 0x4e4f534a;
export function readGlb(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Expected a complete GLB 2.0 file.');
  const chunks = [];
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('Truncated GLB chunk header.');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    if (length % 4 || offset + 8 + length > bytes.length) throw new Error('Invalid GLB chunk length.');
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  if (chunks[0]?.type !== JSON_CHUNK || chunks.slice(1).some(c => c.type === JSON_CHUNK)) throw new Error('Invalid GLB JSON chunk.');
  const json = JSON.parse(chunks[0].data.toString('utf8'));
  if (json.asset?.version !== '2.0' || !json.meshes?.some(m => m.primitives?.length)) throw new Error('GLB contains no mesh geometry.');
  return { json, chunks };
}

function writeGlb(json, chunks) {
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20); text.copy(padded);
  const all = [{ type: JSON_CHUNK, data: padded }, ...chunks.slice(1)];
  const result = Buffer.alloc(12 + all.reduce((n, c) => n + 8 + c.data.length, 0));
  result.write('glTF'); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  let offset = 12;
  for (const c of all) { result.writeUInt32LE(c.data.length, offset); result.writeUInt32LE(c.type, offset + 4); c.data.copy(result, offset + 8); offset += 8 + c.data.length; }
  return result;
}

export function inspectGlb(bytes, { requireColor = false } = {}) {
  const { json } = readGlb(bytes);
  for (const item of [...(json.buffers || []), ...(json.images || [])]) {
    if (item.uri && !item.uri.startsWith('data:')) throw new Error('Expected a self-contained GLB with embedded textures and buffers.');
  }
  let texturedPrimitives = 0, vertexColoredPrimitives = 0;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    const textureInfo = json.materials?.[primitive.material]?.pbrMetallicRoughness?.baseColorTexture;
    const texture = json.textures?.[textureInfo?.index];
    const source = texture?.source ?? texture?.extensions?.EXT_texture_webp?.source;
    const image = json.images?.[source];
    const texCoord = textureInfo?.extensions?.KHR_texture_transform?.texCoord ?? textureInfo?.texCoord ?? 0;
    if (image && (image.bufferView !== undefined || image.uri?.startsWith('data:')) && primitive.attributes?.[`TEXCOORD_${texCoord}`] !== undefined) texturedPrimitives++;
    if (primitive.attributes?.COLOR_0 !== undefined && json.accessors?.[primitive.attributes.COLOR_0]) vertexColoredPrimitives++;
  }
  const appearance = { texturedPrimitives, vertexColoredPrimitives, materials: json.materials?.length || 0,
    embeddedImages: json.images?.length || 0, hasSurfaceColor: texturedPrimitives + vertexColoredPrimitives > 0 };
  if (requireColor && !appearance.hasSurfaceColor) throw new Error('Tripo returned a GLB without surface color. The gray base mesh was not accepted as a color result. Resume the saved task to retry its download.');
  return appearance;
}

// STL deliberately discards appearance. Remove it only in a temporary copy so the
// offline mesh loader never decodes images or fetches texture resources in Node.
export function geometryOnlyGlb(bytes) {
  const { json, chunks } = readGlb(bytes);
  if (json.buffers?.some(b => b.uri && !b.uri.startsWith('data:'))) throw new Error('Expected self-contained GLB geometry.');
  delete json.materials; delete json.images; delete json.textures; delete json.samplers;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    delete primitive.material;
    if (primitive.extensions) delete primitive.extensions.KHR_materials_variants;
  }
  const appearanceExtension = name => /^(KHR|EXT)_(materials|texture)_/.test(name);
  for (const field of ['extensionsUsed', 'extensionsRequired']) if (json[field]) json[field] = json[field].filter(name => !appearanceExtension(name));
  if (json.extensions) for (const name of Object.keys(json.extensions)) if (appearanceExtension(name)) delete json.extensions[name];
  return writeGlb(json, chunks);
}

export function modelArtifact(task, { color = true } = {}) {
  const output = task.output || {};
  // A base_model may be gray even when the same task also returns the finished model.
  const order = color ? ['pbr_model', 'model', 'model_url', 'base_model'] : ['base_model', 'model', 'model_url', 'pbr_model'];
  for (const field of order) {
    const artifact = output[field];
    const url = typeof artifact === 'string' ? artifact : artifact?.url;
    if (url) {
      if (new URL(url).protocol !== 'https:') throw new Error('Tripo returned a non-HTTPS model URL.');
      return { url, field };
    }
  }
  const url = task.result?.base_model?.url;
  if (url && new URL(url).protocol === 'https:') return { url, field: 'result.base_model' };
  throw new Error('Tripo returned no HTTPS model URL. Resume the saved task.');
}
