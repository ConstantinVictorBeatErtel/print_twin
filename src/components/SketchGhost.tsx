// The drawing, still hanging in the room while the mesh is being built.
//
// Tripo takes 30-120s. Until this existed the sketch vanished the moment you submitted it and
// the only trace was a 2D card in the corner, so you could walk away and lose the spot entirely.
// The anchor already stores the capture camera's matrices, so the drawn rectangle can be
// unprojected back to the depth its base was anchored at (drawingQuad) — the strokes then sit
// in the world where you drew them, with real parallax as you walk around them.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { drawingQuad, type DrawingAnchor } from "../lib/drawingPlacement";

export function SketchGhost({ anchor, image, pulse = true }: { anchor: DrawingAnchor; image: string; pulse?: boolean }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);

  useEffect(() => {
    let alive = true;
    new THREE.TextureLoader().load(image, (t) => {
      if (!alive) { t.dispose(); return; }
      t.colorSpace = THREE.SRGBColorSpace;
      setTexture(t);
    });
    return () => { alive = false; };
  }, [image]);
  useEffect(() => () => { texture?.dispose(); }, [texture]);

  const geometry = useMemo(() => {
    const [bl, br, tr, tl] = drawingQuad(anchor);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(
      [...bl.toArray(), ...br.toArray(), ...tr.toArray(), ...tl.toArray()], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }, [anchor]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // A slow breath, so it reads as "still working" rather than as a placed object.
  useFrame((state) => {
    if (material.current) {
      material.current.opacity = pulse ? 0.6 + 0.25 * Math.sin(state.clock.getElapsedTime() * 2.2) : 0.35;
    }
  });

  if (!texture) return null;
  return <mesh geometry={geometry}>
    <meshBasicMaterial ref={material} map={texture} transparent depthWrite={false}
      side={THREE.DoubleSide} toneMapped={false} />
  </mesh>;
}
