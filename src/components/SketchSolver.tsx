// The GL half of "which way was this drawn facing?" — see src/lib/sketchOrientation.ts for the
// matching itself, which is pure and lives outside this file.
//
// Mounted inside <Canvas> for the same reason DrawingBridge is: it needs the app's live
// WebGLRenderer. Spinning up a second context to do this would burn one of the browser's
// handful of them and lose the shared GPU state.
//
// Every yaw is rendered into one tiled render target and read back in a single
// readRenderTargetPixels. Thirty-six separate readbacks would each stall the pipeline and
// visibly hitch the walk loop; one does not.
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { cameraForAnchor, type DrawingAnchor } from "../lib/drawingPlacement";
import { matchSketchYaw, type Mask, type YawMatch } from "../lib/sketchOrientation";
import { fitToTarget } from "../lib/fit";

export type SolveSketchYaw = (model: THREE.Object3D, anchor: DrawingAnchor, baseSize: number) => YawMatch | null;

export function SketchSolver({ solveRef }: { solveRef: React.MutableRefObject<SolveSketchYaw | null> }) {
  const { gl } = useThree();

  useEffect(() => {
    solveRef.current = (model, anchor, baseSize) => {
      // A failed orientation guess must never cost the user their object: the caller places
      // with the anchor's own camera-facing rotation when this returns null.
      try {
        return solve(gl, model, anchor, baseSize);
      } catch {
        return null;
      }
    };
    return () => { solveRef.current = null; };
  }, [gl, solveRef]);

  return null;
}

function solve(gl: THREE.WebGLRenderer, model: THREE.Object3D, anchor: DrawingAnchor, baseSize: number) {
  const camera = cameraForAnchor(anchor);
  // Flat white on black: we want a silhouette, so lighting, colour and texture are noise.
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const clone = model.clone(true);
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.material = material; // geometry is shared with the original; materials are not touched
  });

  // Posed exactly as Asset and PlacementGhost pose it, so the silhouette we score is the
  // silhouette the user will actually get.
  const fit = fitToTarget(model, 1);
  clone.position.copy(fit.offset);
  const group = new THREE.Group();
  group.add(clone);
  group.position.fromArray(anchor.position);
  group.scale.setScalar(fit.scale * baseSize);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(group);

  const anchorQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...anchor.rotation as [number, number, number]),
  );
  const spin = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);

  try {
    return matchSketchYaw(anchor, (yaws, width, height) => {
      const columns = Math.max(1, Math.min(yaws.length, Math.floor(gl.capabilities.maxTextureSize / width)));
      const rows = Math.ceil(yaws.length / columns);
      if (rows * height > gl.capabilities.maxTextureSize) return [];
      const atlasWidth = columns * width, atlasHeight = rows * height;
      const target = new THREE.WebGLRenderTarget(atlasWidth, atlasHeight);

      // Every piece of renderer state this borrows has to go back exactly as it was. The
      // viewport especially: WebGLRenderer.render() does not reset it and R3F only sets it on
      // resize, so leaving it on the last tile makes the whole app render into a small corner
      // and the rest of the canvas stay black until the window is resized.
      const previousClear = gl.getClearColor(new THREE.Color());
      const previousAlpha = gl.getClearAlpha();
      const previousViewport = gl.getViewport(new THREE.Vector4());
      const previousScissor = gl.getScissor(new THREE.Vector4());
      const previousScissorTest = gl.getScissorTest();
      gl.setClearColor(0x000000, 1);
      gl.setRenderTarget(target);
      // The scissor confines each tile's autoClear to its own cell, so one target holds them all.
      gl.setScissorTest(true);
      try {
        yaws.forEach((yaw, i) => {
          const column = i % columns, row = Math.floor(i / columns);
          // readRenderTargetPixels reads bottom-up, so lay the grid out bottom-up too.
          const x = column * width, y = (rows - 1 - row) * height;
          gl.setViewport(x, y, width, height);
          gl.setScissor(x, y, width, height);
          group.quaternion.copy(anchorQuat).multiply(spin.setFromAxisAngle(axis, yaw));
          group.updateMatrixWorld(true);
          gl.render(scene, camera);
        });
        const pixels = new Uint8Array(atlasWidth * atlasHeight * 4);
        gl.readRenderTargetPixels(target, 0, 0, atlasWidth, atlasHeight, pixels);
        return yaws.map((_, i) => tile(pixels, atlasWidth, i, columns, rows, width, height));
      } finally {
        gl.setRenderTarget(null);
        gl.setViewport(previousViewport);
        gl.setScissor(previousScissor);
        gl.setScissorTest(previousScissorTest);
        gl.setClearColor(previousClear, previousAlpha);
        target.dispose();
      }
    }, { baseSize });
  } finally {
    material.dispose();
  }
}

/** One cell of the atlas, flipped back to the ink's top-left origin. */
function tile(
  pixels: Uint8Array, atlasWidth: number,
  index: number, columns: number, rows: number, width: number, height: number,
): Mask {
  const column = index % columns, row = Math.floor(index / columns);
  const originX = column * width, originY = (rows - 1 - row) * height;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const source = (originY + height - 1 - y) * atlasWidth + originX;
    for (let x = 0; x < width; x++) {
      if (pixels[(source + x) * 4] > 127) data[y * width + x] = 1;
    }
  }
  return { data, width, height };
}
