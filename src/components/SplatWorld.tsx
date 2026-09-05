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
    const spark = new SparkRenderer({ renderer: gl, lodSplatCount: 500_000, lodRenderScale: 1.5, maxStdDev: Math.sqrt(5), sortRadial: true });
    scene.add(spark);
    return () => { scene.remove(spark); spark.dispose(); };
  }, [gl, scene]);
  return null;
}

export function SplatWorld({ url, metricScale = 1, groundOffset = 0, minRaycastOpacity = 0.2 }: { url: string; metricScale?: number; groundOffset?: number; minRaycastOpacity?: number }) {
  // Construct inside the effect, not useMemo: React StrictMode mounts, unmounts
  // and remounts in dev. A useMemo'd mesh would be disposed by the first
  // cleanup and then reused dead on remount -> silent black screen.
  const [mesh, setMesh] = useState<SplatMesh | null>(null);
  useEffect(() => {
    // raycastable: lets Spark answer "what splat is under the cursor?" when a world ships
    // without a collider GLB. Approximate, but it keeps placement working.
    const m = new SplatMesh({ url, lod: true, raycastable: true, minRaycastOpacity });
    m.userData.splat = true;
    setMesh(m);
    return () => { setMesh(null); m.dispose?.(); };
  }, [url, minRaycastOpacity]);
  if (!mesh) return null;
  // Marble SPZ is OpenCV (+y down, +z forward) -> flip Y and Z for Three.js; scale to metres.
  return (
    <primitive object={mesh} scale={[metricScale, -metricScale, -metricScale]} position={[0, -groundOffset * metricScale, 0]} />
  );
}

export function Collider({ url, metricScale = 1, groundOffset = 0, visible = false }: { url: string; metricScale?: number; groundOffset?: number; visible?: boolean }) {
  const { scene } = useGLTF(url);
  useEffect(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      o.userData.collider = true;
      // The room transform below is scale=[s,-s,-s]: a negative determinant, so triangle
      // winding is mirrored. A FrontSide material would silently return zero raycast hits.
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        mat.side = THREE.DoubleSide;
        (mat as THREE.MeshStandardMaterial).wireframe = true; // only ever seen via ?debugCollider=1
      }
    });
  }, [scene]);
  return (
    <primitive object={scene} visible={visible} scale={[metricScale, -metricScale, -metricScale]} position={[0, -groundOffset * metricScale, 0]} />
  );
}
