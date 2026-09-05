// Loads a Tripo / Mint GLB. Tripo GLBs are meshopt-compressed; Mint GLBs are Draco-compressed.
import { useEffect, useMemo, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as THREE from "three";
import { fitToTarget } from "../lib/fit";

const draco = new DRACOLoader();
draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
export const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);

/**
 * `position` is where the object's bottom-centre sits, and `scale` is a multiplier on top of
 * the normalization in fitToTarget — the placement ghost applies the same transform, so a
 * committed object lands exactly where its preview was.
 */
export function Asset({ url, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, targetSize, onClick }:
  { url: string; position?: number[]; rotation?: number[]; scale?: number; targetSize?: number; onClick?: () => void }) {
  const [obj, setObj] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    gltfLoader.load(url, (g) => { if (alive) setObj(g.scene); }, undefined, (e) => console.error("GLB load failed", url, e));
    return () => { alive = false; };
  }, [url]);
  const pos = useMemo(() => position as [number, number, number], [position]);
  const rot = useMemo(() => rotation as [number, number, number], [rotation]);
  const fit = useMemo(() => (obj ? fitToTarget(obj, targetSize) : null), [obj, targetSize]);
  if (!obj || !fit) return null;
  return (
    <group position={pos} rotation={rot} scale={fit.scale * scale}>
      <primitive object={obj} position={fit.offset} onClick={onClick} />
    </group>
  );
}
