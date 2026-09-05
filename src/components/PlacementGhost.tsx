// Armed placement: a translucent preview of a generated object that rides the room's real
// surfaces under the cursor, committed with a click.
//
// The pose comes from src/lib/surfacePick.ts (collider mesh -> splat -> ground plane) and the
// normalization from src/lib/fit.ts, which <Asset> applies identically — so the committed
// object appears exactly where the ghost was, with no jump.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { gltfLoader } from "./Asset";
import { fitToTarget } from "../lib/fit";
import { orientTo, pickSurface, type PickSource } from "../lib/surfacePick";

// Defaults; the ?debug=1 panel can override each of these live.
const PICK_HZ = 30;        // a 100-200k-tri intersect every frame is not free
const CLICK_SLOP_PX = 4;   // beyond this a left-press is an OrbitControls orbit, not a placement
const GHOST_OPACITY = 0.85;
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;

export type GhostState = { source: PickSource; scale: number } | null;

export function PlacementGhost({
  url, onCommit, onCancel, onPreview,
  targetSize, opacity = GHOST_OPACITY, pickHz = PICK_HZ, clickSlop = CLICK_SLOP_PX,
  allow = { collider: true, splat: true, plane: true },
}: {
  url: string;
  onCommit: (position: number[], rotation: number[], scale: number) => void;
  onCancel: () => void;
  onPreview?: (state: GhostState) => void;
  targetSize?: number;
  opacity?: number;
  pickHz?: number;
  clickSlop?: number;
  allow?: Record<PickSource, boolean>;
}) {
  const { gl, controls } = useThree();
  const group = useRef<THREE.Group>(null);
  const pose = useRef<{ point: THREE.Vector3; quat: THREE.Quaternion } | null>(null);
  const lastPick = useRef(0);
  const [obj, setObj] = useState<THREE.Group | null>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);

  // Latest callbacks and tunables, so the listener effect below doesn't re-subscribe on
  // every App render (and so a slider drag doesn't tear down the pointer handlers).
  const cb = useRef({ onCommit, onCancel, onPreview });
  cb.current = { onCommit, onCancel, onPreview };
  const cfg = useRef({ pickHz, clickSlop, allow });
  cfg.current = { pickHz, clickSlop, allow };

  useEffect(() => {
    let alive = true;
    gltfLoader.load(url, (g) => {
      if (!alive) return;
      g.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(ghostify) : ghostify(mesh.material);
      });
      setObj(g.scene);
    }, undefined, (e) => console.error("ghost GLB load failed", url, e));
    return () => { alive = false; };
  }, [url]);

  const fit = useMemo(() => (obj ? fitToTarget(obj, targetSize) : null), [obj, targetSize]);

  // Opacity is live-tunable, so push it onto the already-cloned ghost materials.
  useEffect(() => {
    obj?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.opacity = opacity;
    });
  }, [obj, opacity]);

  useFrame((state) => {
    const g = group.current;
    if (!g || !fit) return;
    const t = state.clock.getElapsedTime();
    if (t - lastPick.current < 1 / cfg.current.pickHz) return;
    lastPick.current = t;

    const hit = pickSurface(state.raycaster, state.camera, state.pointer, state.scene, cfg.current.allow);
    if (!hit) {
      g.visible = false;
      pose.current = null;
      cb.current.onPreview?.(null);
      return;
    }
    const quat = orientTo(hit.normal, hit.point, state.camera);
    g.position.copy(hit.point);
    g.quaternion.copy(quat);
    g.scale.setScalar(fit.scale * scaleRef.current);
    g.visible = true;
    pose.current = { point: hit.point, quat };
    cb.current.onPreview?.({ source: hit.source, scale: scaleRef.current });
  });

  // Pointer / wheel / keyboard while armed.
  useEffect(() => {
    const el = gl.domElement;
    const prevCursor = el.style.cursor;
    el.style.cursor = "crosshair";
    // The wheel resizes the object, so it must not also dolly the camera.
    const orbit = controls as { enableZoom?: boolean } | null;
    const prevZoom = orbit?.enableZoom;
    if (orbit) orbit.enableZoom = false;

    let down: { x: number; y: number; button: number } | null = null;
    const onPointerDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, button: e.button }; };
    const onPointerUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || start.button !== 0 || e.button !== 0) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > cfg.current.clickSlop) return; // orbit drag
      const p = pose.current;
      if (!p) return;
      const euler = new THREE.Euler().setFromQuaternion(p.quat, "XYZ");
      cb.current.onCommit(p.point.toArray(), [euler.x, euler.y, euler.z], scaleRef.current);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = THREE.MathUtils.clamp(scaleRef.current * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
      scaleRef.current = next;
      setScale(next);
    };
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); cb.current.onCancel(); };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") cb.current.onCancel(); };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      el.style.cursor = prevCursor;
      if (orbit && prevZoom !== undefined) orbit.enableZoom = prevZoom;
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      cb.current.onPreview?.(null);
    };
  }, [gl, controls]);

  // Dispose the ghost-only material clones when the preview goes away.
  useEffect(() => () => {
    obj?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    });
  }, [obj]);

  if (!obj || !fit) return null;
  return (
    <group ref={group} visible={false} scale={fit.scale * scale}>
      <primitive object={obj} position={fit.offset} />
    </group>
  );
}

// Mostly solid, so you can actually judge the object's shape and texture before committing —
// just translucent enough to read as a preview. depthWrite stays on: at this opacity the model
// needs correct self-occlusion, otherwise its back faces show through the front.
function ghostify(material: THREE.Material) {
  const m = material.clone();
  m.transparent = true;
  m.opacity = GHOST_OPACITY;
  m.depthWrite = true;
  return m;
}
