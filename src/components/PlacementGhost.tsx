// Armed placement: a translucent preview of a generated object that rides the room's real
// surfaces under the cursor, committed with a click.
//
// The pose comes from src/lib/surfacePick.ts (collider mesh -> splat -> ground plane) and the
// normalization from src/lib/fit.ts, which <Asset> applies identically — so the committed
// object appears exactly where the ghost was, with no jump.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { disposeModel, gltfLoader } from "./Asset";
import { fitToTarget, TARGET_SIZE } from "../lib/fit";
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
  upright = false, yaw = 0, rotation, onError, onReady,
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
  upright?: boolean;
  yaw?: number;
  rotation?: number[];
  onError?: (message: string) => void;
  onReady?: () => void;
}) {
  const { gl, controls, camera, scene } = useThree();
  const group = useRef<THREE.Group>(null);
  const pose = useRef<{ point: THREE.Vector3; quat: THREE.Quaternion } | null>(null);
  const lastPick = useRef(0);
  const [obj, setObj] = useState<THREE.Group | null>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);

  // Latest callbacks and tunables, so the listener effect below doesn't re-subscribe on
  // every App render (and so a slider drag doesn't tear down the pointer handlers).
  const cb = useRef({ onCommit, onCancel, onPreview, onError, onReady });
  cb.current = { onCommit, onCancel, onPreview, onError, onReady };
  const cfg = useRef({ pickHz, clickSlop, allow, upright, yaw, rotation });
  cfg.current = { pickHz, clickSlop, allow, upright, yaw, rotation };
  const inside = useRef(false);

  useEffect(() => {
    let alive = true;
    gltfLoader.load(url, (g) => {
      if (!alive) { disposeModel(g.scene); return; }
      g.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const original = mesh.material;
        mesh.material = Array.isArray(original) ? original.map(ghostify) : ghostify(original);
        for (const material of Array.isArray(original) ? original : [original]) material.dispose();
      });
      setObj(g.scene);
      cb.current.onReady?.();
    }, undefined, (e) => { if (alive) cb.current.onError?.(`Could not load model: ${String(e)}`); });
    return () => { alive = false; };
  }, [url]);

  const baseFit = useMemo(() => (obj ? fitToTarget(obj, 1) : null), [obj]);
  const fit = useMemo(() => baseFit ? { offset: baseFit.offset, scale: baseFit.scale * (targetSize ?? TARGET_SIZE) } : null, [baseFit, targetSize]);

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
    if (!inside.current) { g.visible = false; pose.current = null; return; }
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
    const quat = cfg.current.rotation
      ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...cfg.current.rotation as [number, number, number]))
      : orientTo(cfg.current.upright ? new THREE.Vector3(0, 1, 0) : hit.normal, hit.point, state.camera);
    quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cfg.current.yaw));
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
    // Generation can finish while the cursor is already over the canvas.
    inside.current = el.matches(":hover");
    const prevCursor = el.style.cursor;
    el.style.cursor = "crosshair";
    // The wheel resizes the object, so it must not also dolly the camera.
    const orbit = controls as { enableZoom?: boolean } | null;
    const prevZoom = orbit?.enableZoom;
    if (orbit) orbit.enableZoom = false;

    let down: { x: number; y: number; button: number } | null = null;
    const onPointerDown = (e: PointerEvent) => { inside.current = true; down = { x: e.clientX, y: e.clientY, button: e.button }; };
    const onEnter = () => { inside.current = true; };
    const onLeave = () => { inside.current = false; pose.current = null; };
    const onPointerUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || start.button !== 0 || e.button !== 0) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > cfg.current.clickSlop) return; // orbit drag
      if (!pose.current || !inside.current) return;
      // Pick at release coordinates; the throttled preview can lag behind a fast click.
      const rect = el.getBoundingClientRect();
      const pointer = new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2);
      const hit = pickSurface(new THREE.Raycaster(), camera, pointer, scene, cfg.current.allow);
      if (!hit) return;
      const quat = cfg.current.rotation
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...cfg.current.rotation as [number, number, number]))
        : orientTo(cfg.current.upright ? new THREE.Vector3(0, 1, 0) : hit.normal, hit.point, camera);
      quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cfg.current.yaw));
      const euler = new THREE.Euler().setFromQuaternion(quat, "XYZ");
      cb.current.onCommit(hit.point.toArray(), [euler.x, euler.y, euler.z], scaleRef.current);
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
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", onEnter);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      el.style.cursor = prevCursor;
      if (orbit && prevZoom !== undefined) orbit.enableZoom = prevZoom;
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      cb.current.onPreview?.(null);
    };
  }, [gl, controls, camera, scene]);

  // Dispose the ghost-only material clones when the preview goes away.
  useEffect(() => () => {
    if (obj) disposeModel(obj);
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
