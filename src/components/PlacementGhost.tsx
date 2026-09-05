// Armed placement: a translucent preview of a generated object that rides the room's real
// surfaces under the cursor, committed with a click.
//
// The pose comes from src/lib/surfacePick.ts (collider mesh -> splat) via src/lib/placementPose.ts,
// and the normalization from src/lib/fit.ts, which <Asset> applies identically — so the committed
// object appears exactly where the ghost was, with no jump.
//
// This is also the editor for an object already in the room: WorldApp re-arms a placement with
// its id, and it re-orients to whatever is under the cursor like any other placement. The keys
// are the same too: Q/E turn, [ ] resize, R reset the turn, Enter commit, Esc cancel.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { disposeModel, gltfLoader } from "./Asset";
import { fitToTarget, TARGET_SIZE } from "../lib/fit";
import { pickSurface, type PickSource } from "../lib/surfacePick";
import { poseOnSurface, type Pose, type SurfaceKind } from "../lib/placementPose";

// Defaults; the ?debug=1 panel can override each of these live.
const PICK_HZ = 30;        // a 100-200k-tri intersect every frame is not free
const CLICK_SLOP_PX = 4;   // beyond this a left-press is an OrbitControls orbit, not a placement
const GHOST_OPACITY = 0.85;
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const STEP = 15 * Math.PI / 180;   // one Q/E press
const FINE_STEP = 5 * Math.PI / 180; // …with Shift held
const SIZE_STEP = 1.1;             // one [ or ] press

export type GhostState = { source: PickSource; scale: number; kind: SurfaceKind } | null;

export function PlacementGhost({
  url, onCommit, onCancel, onPreview,
  targetSize, opacity = GHOST_OPACITY, pickHz = PICK_HZ, clickSlop = CLICK_SLOP_PX,
  yaw = 0, onError, onReady, onYawDelta, onResetRotation,
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
  yaw?: number;
  onError?: (message: string) => void;
  onReady?: () => void;
  /** Q/E: turn the object about its own up axis. WorldApp owns `yaw` so the panel stays in sync. */
  onYawDelta?: (radians: number) => void;
  /** R: back to no turn. */
  onResetRotation?: () => void;
}) {
  const { gl, controls, camera, scene } = useThree();
  const group = useRef<THREE.Group>(null);
  const pose = useRef<Pose | null>(null);
  const lastPick = useRef(0);
  const [obj, setObj] = useState<THREE.Group | null>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);

  // Latest callbacks and tunables, so the listener effect below doesn't re-subscribe on
  // every App render (and so a slider drag doesn't tear down the pointer handlers).
  const cb = useRef({ onCommit, onCancel, onPreview, onError, onReady, onYawDelta, onResetRotation });
  cb.current = { onCommit, onCancel, onPreview, onError, onReady, onYawDelta, onResetRotation };
  const cfg = useRef({ pickHz, clickSlop, allow, yaw });
  cfg.current = { pickHz, clickSlop, allow, yaw };
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
    const next = poseOnSurface(hit, state.camera, cfg.current.yaw);
    g.position.copy(next.position);
    g.quaternion.copy(next.quaternion);
    g.scale.setScalar(fit.scale * scaleRef.current);
    g.visible = true;
    pose.current = next;
    cb.current.onPreview?.({ source: hit.source, scale: scaleRef.current, kind: next.kind });
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

    const commit = (p: Pose) => {
      const euler = new THREE.Euler().setFromQuaternion(p.quaternion, "XYZ");
      cb.current.onCommit(p.position.toArray(), [euler.x, euler.y, euler.z], scaleRef.current);
    };
    const resize = (factor: number) => {
      scaleRef.current = THREE.MathUtils.clamp(scaleRef.current * factor, MIN_SCALE, MAX_SCALE);
      setScale(scaleRef.current);
    };

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
      commit(poseOnSurface(hit, camera, cfg.current.yaw));
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      resize(Math.exp(-e.deltaY * 0.0015));
    };
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); cb.current.onCancel(); };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      // Typing a size into the panel must not also nudge the object.
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const step = e.shiftKey ? FINE_STEP : STEP;
      switch (e.code) {
        case "Escape": cb.current.onCancel(); return;
        case "KeyQ": e.preventDefault(); cb.current.onYawDelta?.(-step); return;
        case "KeyE": e.preventDefault(); cb.current.onYawDelta?.(step); return;
        case "BracketLeft": e.preventDefault(); resize(1 / SIZE_STEP); return;
        case "BracketRight": e.preventDefault(); resize(SIZE_STEP); return;
        case "KeyR": e.preventDefault(); cb.current.onResetRotation?.(); return;
        case "Enter":
        case "NumpadEnter":
          e.preventDefault();
          if (pose.current) commit(pose.current);
          return;
      }
    };

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
