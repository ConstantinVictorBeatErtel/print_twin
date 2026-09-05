// Renders a World Labs (Marble) Gaussian-splat world with Spark inside react-three-fiber,
// plus its (invisible) collider mesh for raycasting / walking.
import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

export function SparkSetup() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const spark = new SparkRenderer({ renderer: gl });
    scene.add(spark);
    return () => { scene.remove(spark); };
  }, [gl, scene]);
  return null;
}

export function SplatWorld({ url, metricScale = 1, groundOffset = 0 }: { url: string; metricScale?: number; groundOffset?: number }) {
  // Construct inside the effect, not useMemo: React StrictMode mounts, unmounts
  // and remounts in dev. A useMemo'd mesh would be disposed by the first
  // cleanup and then reused dead on remount -> silent black screen.
  const [mesh, setMesh] = useState<SplatMesh | null>(null);
  useEffect(() => {
    const m = new SplatMesh({ url });
    setMesh(m);
    return () => { setMesh(null); m.dispose?.(); };
  }, [url]);
  if (!mesh) return null;
  // Marble SPZ is OpenCV (+y down, +z forward) -> flip Y and Z for Three.js; scale to metres.
  return (
    <primitive object={mesh} scale={[metricScale, -metricScale, -metricScale]} position={[0, -groundOffset * metricScale, 0]} />
  );
}

export function Collider({ url, metricScale = 1, groundOffset = 0, visible = false }: { url: string; metricScale?: number; groundOffset?: number; visible?: boolean }) {
  const { scene } = useGLTF(url);
  useEffect(() => {
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.collider = true; } });
  }, [scene]);
  return (
    <primitive object={scene} visible={visible} scale={[metricScale, -metricScale, -metricScale]} position={[0, -groundOffset * metricScale, 0]} />
  );
}
