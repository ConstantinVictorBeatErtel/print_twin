// Loads a Tripo / Mint GLB. Tripo GLBs are meshopt-compressed; Mint GLBs are Draco-compressed.
import { useEffect, useMemo, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as THREE from "three";

const draco = new DRACOLoader();
draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
export const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);

export function Asset({ url, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, onClick }:
  { url: string; position?: number[]; rotation?: number[]; scale?: number; onClick?: () => void }) {
  const [obj, setObj] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    gltfLoader.load(url, (g) => { if (alive) setObj(g.scene); }, undefined, (e) => console.error("GLB load failed", url, e));
    return () => { alive = false; };
  }, [url]);
  const pos = useMemo(() => position as [number, number, number], [position]);
  const rot = useMemo(() => rotation as [number, number, number], [rotation]);
  if (!obj) return null;
  return <primitive object={obj} position={pos} rotation={rot} scale={scale} onClick={onClick} />;
}
