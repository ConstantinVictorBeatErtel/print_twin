import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const KEYS = ['FAL_KEY', 'TRIPO_API_KEY'];
const fail = (status, message) => Object.assign(new Error(message), { status });

// Local workstation settings. Responses expose presence only, never credential values.
export function createSettings({ file, getEnv = () => process.env }) {
  let saved = {};
  let loadError = false;
  let writes = Promise.resolve();
  const ready = readFile(file, 'utf8').then(text => {
    const data = JSON.parse(text);
    for (const key of KEYS) if (typeof data[key] === 'string' && data[key].trim()) saved[key] = data[key];
  }).catch(error => { if (error.code !== 'ENOENT') loadError = true; });
  // The middleware awaits readiness before allowing generation requests through.
  const env = () => ({ ...getEnv(), ...saved });
  const status = () => Object.fromEntries(KEYS.map(key => [key, {
    configured: Boolean(env()[key]?.trim()), source: saved[key] ? 'settings' : getEnv()[key]?.trim() ? 'environment' : null,
  }]));
  const middleware = async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (path !== '/api/settings') {
      if (!path?.startsWith('/api/asset-')) return next();
      try { await ready; if (loadError) throw new Error(); return next(); }
      catch { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not read local API settings.' })); return; }
    }
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const host = req.headers.host || '';
      const address = req.socket.remoteAddress;
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) throw fail(403, 'Open settings on this computer using localhost.');
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && ![`http://${host}`, `https://${host}`].includes(req.headers.origin))) throw fail(403, 'Open settings from this viewer.');
      await ready;
      if (loadError) throw fail(503, 'Could not read local API settings.');
      if (req.method === 'GET') { send(200, status()); return; }
      if (req.method !== 'PATCH') throw fail(405, 'Method not allowed.');
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw fail(415, 'Expected JSON.');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16384) throw fail(413, 'Settings are too large.'); chunks.push(chunk); }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks)); } catch { throw fail(400, 'Invalid JSON.'); }
      if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(key => !KEYS.includes(key))) throw fail(400, 'Unsupported settings field.');
      for (const value of Object.values(input)) if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\s\x00-\x1f\x7f]/.test(value.trim()))) throw fail(400, 'Enter a valid key without spaces, or leave the field unchanged.');
      const operation = writes.then(async () => {
        const nextSaved = { ...saved };
        for (const [key, value] of Object.entries(input)) { if (value === null) delete nextSaved[key]; else nextSaved[key] = value.trim(); }
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(file + '.tmp', JSON.stringify(nextSaved), { mode: 0o600 });
        await rename(file + '.tmp', file);
        saved = nextSaved;
      });
      writes = operation.catch(() => {});
      await operation;
      send(200, status());
    } catch (error) { send(error.status || 500, { error: error.status ? error.message : 'Could not save local API settings.' }); }
  };
  return { env, middleware };
}
