// Loads a Tripo / Mint GLB. Tripo GLBs are meshopt-compressed; Mint GLBs are Draco-compressed.
import { useEffect, useMemo, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as THREE from "three";
import { fitToTarget, TARGET_SIZE } from "../lib/fit";

const draco = new DRACOLoader();
draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
export const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);

export function disposeModel(obj: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  obj.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
  });
  const images = new Set<ImageBitmap>();
  textures.forEach((texture) => {
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) images.add(texture.image);
    texture.dispose();
  });
  images.forEach((image) => image.close());
}

/**
 * `position` is where the object's bottom-centre sits, and `scale` is a multiplier on top of
 * the normalization in fitToTarget — the placement ghost applies the same transform, so a
 * committed object lands exactly where its preview was.
 */
export function Asset({ url, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, targetSize, onClick, onError }:
  { url: string; position?: number[]; rotation?: number[]; scale?: number; targetSize?: number; onClick?: () => void; onError?: (message: string) => void }) {
  const [obj, setObj] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    let loaded: THREE.Group | undefined;
    gltfLoader.load(url, (g) => {
      if (!alive) { disposeModel(g.scene); return; }
      loaded = g.scene;
      setObj(g.scene);
    }, undefined, (e) => { if (alive) onError?.(`Could not load placed model: ${String(e)}`); });
    return () => { alive = false; if (loaded) disposeModel(loaded); };
  }, [url]);
  const pos = useMemo(() => position as [number, number, number], [position]);
  const rot = useMemo(() => rotation as [number, number, number], [rotation]);
  // Measure before mounting, once: mounted objects inherit placement transforms.
  const baseFit = useMemo(() => (obj ? fitToTarget(obj, 1) : null), [obj]);
  const fit = useMemo(() => baseFit ? { offset: baseFit.offset, scale: baseFit.scale * (targetSize ?? TARGET_SIZE) } : null, [baseFit, targetSize]);
  if (!obj || !fit) return null;
  return (
    <group position={pos} rotation={rot} scale={fit.scale * scale}>
      <primitive object={obj} position={fit.offset} onClick={onClick ? (event: { stopPropagation: () => void; delta: number }) => { event.stopPropagation(); if (event.delta <= 4) onClick(); } : undefined} />
    </group>
  );
}
