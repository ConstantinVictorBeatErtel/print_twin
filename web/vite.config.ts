import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const rootDir = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = resolve(rootDir, '../data/worlds');
const CAPTURE_ROOT = resolve(rootDir, '../data/captures/incoming');

const MIME: Record<string, string> = {
  '.spz': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function worldAssetsPlugin(): Plugin {

  function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = req.url?.split('?')[0] ?? '';
    const match = url.match(/^\/world-assets\/([a-zA-Z0-9_-]+)\/(.*)$/);
    if (!match) {
      next();
      return;
    }
    const job = match[1];
    const relative = decodeURIComponent(match[2]);
    if (!relative || relative.includes('..') || relative.startsWith('/') || relative.includes('\\')) {
      res.statusCode = 400;
      res.end('Bad path');
      return;
    }
    const worldRoot = resolve(DATA_ROOT, job);
    const candidate = normalize(join(worldRoot, relative));
    const rootWithSep = worldRoot.endsWith(sep) ? worldRoot : worldRoot + sep;
    if (candidate !== worldRoot && !candidate.startsWith(rootWithSep)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const type = MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(candidate).pipe(res);
  }

  return {
    name: 'world-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => handle(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => handle(req, res, next));
    },
  };
}

const runningJobs = new Set<string>();

function readRequest(req: IncomingMessage, limit = 105 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Upload is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function captureApiPlugin(): Plugin {
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(value));
  };
  const start = (job: string, input: string) => {
    if (runningJobs.has(job)) return;
    runningJobs.add(job);
    const child = spawn(process.execPath, [
      resolve(rootDir, '../scripts/world.mjs'), 'generate', '--input', input,
      '--job', job, '--model', 'marble-1.1-plus', '--wait', '0', '--poll', '5',
    ], { cwd: resolve(rootDir, '..'), stdio: 'ignore' });
    child.on('close', () => runningJobs.delete(job));
  };
  const resume = (job: string) => {
    if (runningJobs.has(job)) return;
    runningJobs.add(job);
    const child = spawn(process.execPath, [
      resolve(rootDir, '../scripts/world.mjs'), 'resume', '--job', job, '--wait', '0', '--poll', '5',
    ], { cwd: resolve(rootDir, '..'), stdio: 'ignore' });
    child.on('close', () => runningJobs.delete(job));
  };

  return {
    name: 'capture-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (req.method === 'POST' && url === '/api/capture') {
          try {
            const body = await readRequest(req);
            const contentType = String(req.headers['content-type'] ?? '');
            const boundary = contentType.match(/boundary=([^;]+)/)?.[1];
            if (!boundary) return json(res, 400, { error: 'Use multipart form data.' });
            const marker = Buffer.from(`--${boundary}`);
            const startAt = body.indexOf(Buffer.from('filename="'));
            const fileStart = body.indexOf(Buffer.from('\r\n\r\n'), startAt);
            const fileEnd = body.indexOf(marker, fileStart + 4);
            const filenameMatch = body.subarray(startAt, fileStart).toString().match(/filename="([^"]+)"/);
            if (startAt < 0 || fileStart < 0 || fileEnd < 0 || !filenameMatch) return json(res, 400, { error: 'No file was uploaded.' });
            const filename = filenameMatch[1].replace(/[^a-zA-Z0-9._-]/g, '_');
            const extension = extname(filename).toLowerCase();
            const kind = ['.jpg', '.jpeg', '.png', '.webp'].includes(extension) ? 'image' : ['.mp4', '.mov', '.webm'].includes(extension) ? 'video' : null;
            if (!kind) return json(res, 400, { error: 'Use a JPG, PNG, WebP, MP4, MOV, or WebM file.' });
            if (kind === 'image' && body.length > 20 * 1024 * 1024) return json(res, 400, { error: 'Images must be 20 MB or smaller.' });
            if (kind === 'video' && body.length > 100 * 1024 * 1024) return json(res, 400, { error: 'Videos must be 100 MB or smaller.' });
            const job = `capture-${randomUUID()}`;
            await mkdir(CAPTURE_ROOT, { recursive: true });
            const input = join(CAPTURE_ROOT, `${job}${extension}`);
            await writeFile(input, body.subarray(fileStart + 4, fileEnd - 2));
            await mkdir(resolve(DATA_ROOT, job), { recursive: true });
            start(job, input);
            return json(res, 202, { job, kind, status: 'uploading' });
          } catch (error) {
            return json(res, 400, { error: error instanceof Error ? error.message : 'Upload failed.' });
          }
        }
        const statusMatch = req.method === 'GET' && url.match(/^\/api\/capture\/([a-zA-Z0-9_-]+)$/);
        if (statusMatch) {
          const job = statusMatch[1];
          if (!existsSync(resolve(DATA_ROOT, job))) return json(res, 404, { error: 'Capture job not found.' });
          try {
            const raw = await readFile(join(DATA_ROOT, job, 'job.json'), 'utf8');
            const state = JSON.parse(raw);
            if (state.status !== 'complete' && state.status !== 'failed') resume(job);
            return json(res, 200, { job, status: state.status, worldId: state.worldId, error: state.error });
          } catch {
            return json(res, 200, { job, status: runningJobs.has(job) ? 'uploading' : 'generating' });
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), captureApiPlugin(), worldAssetsPlugin()],
  server: {
    host: true,
    port: 5173,
    fs: {
      allow: [resolve(rootDir, '..')],
    },
  },
  preview: {
    host: true,
    port: 5173,
  },
});
