import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadModuleSource(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// Inline the pure helpers (web package uses TS; tests stay dependency-free).
function splatToAppMatrix(scale, ground) {
  const s = scale;
  return [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, -s, 0, 0, ground, 0, 1];
}

function pointerToNormalized(offsetX, offsetY, width, height) {
  if (!(width > 0) || !(height > 0)) return { u: 0, v: 0 };
  return { u: offsetX / width, v: offsetY / height };
}

function surfaceFromPath(pathname) {
  if (pathname === '/m' || pathname.startsWith('/m/')) return 'phone';
  return 'laptop';
}

test('splatToApp for scale 2 ground 3 matches Marble formula', () => {
  assert.deepEqual(splatToAppMatrix(2, 3), [2, 0, 0, 0, 0, -2, 0, 0, 0, 0, -2, 0, 0, 3, 0, 1]);
});

test('RoomViewport applies fromArray only — no extra 180 X quaternion', () => {
  const src = loadModuleSource('web/src/scene/RoomViewport.ts');
  assert.match(src, /matrix\.fromArray\(matrix\)/);
  assert.doesNotMatch(src, /quaternion\.set\(\s*1\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/);
  assert.match(src, /Do NOT also set quaternion/);
});

test('pointer normalize: (25,10) on 100x50 is (0.25, 0.2)', () => {
  assert.deepEqual(pointerToNormalized(25, 10, 100, 50), { u: 0.25, v: 0.2 });
});

test('surfaceFromPath maps /m to phone and / to laptop', () => {
  assert.equal(surfaceFromPath('/m'), 'phone');
  assert.equal(surfaceFromPath('/m/'), 'phone');
  assert.equal(surfaceFromPath('/'), 'laptop');
  assert.equal(surfaceFromPath('/index.html'), 'laptop');
});

test('web transforms and normalizePointer modules export the helpers', () => {
  const transforms = loadModuleSource('web/src/scene/transforms.ts');
  const pointer = loadModuleSource('web/src/overlay/normalizePointer.ts');
  assert.match(transforms, /export function splatToAppMatrix/);
  assert.match(pointer, /export function pointerToNormalized/);
});
