// The drawing, still hanging in the room while the mesh is being built.
//
// Tripo takes 30-120s. Until this existed the sketch vanished the moment you submitted it and
// the only trace was a 2D card in the corner, so you could walk away and lose the spot entirely.
// The anchor already stores the capture camera's matrices, so the drawn rectangle can be
// unprojected back to the depth its base was anchored at (drawingQuad) — the strokes then sit
// in the world where you drew them, with real parallax as you walk around them.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { drawingQuad, type DrawingAnchor } from "../lib/drawingPlacement";

export function SketchGhost({ anchor, image }: { anchor: DrawingAnchor; image: string }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

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

  // Drawn at full strength: the ink is the only marker of where the object is going, and it
  // has to stay readable against a bright splat from across the room. `transparent` still
  // matters — the PNG is ink on transparency, so the alpha channel is doing the cutting out,
  // not the opacity. `depthWrite` stays off so the quad never occludes what is behind it.
  if (!texture) return null;
  // Tagged so DrawingBridge can hide every hanging ghost while it captures a *new* sketch's
  // reference frame — otherwise an earlier, still-generating sketch's ink (same colour, same
  // "interpret these marks" prompt) bleeds into the next one's images.
  return <mesh geometry={geometry} userData={{ sketchGhost: true }}>
    <meshBasicMaterial map={texture} transparent opacity={1} depthWrite={false}
      side={THREE.DoubleSide} toneMapped={false} />
  </mesh>;
}
