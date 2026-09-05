import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";

const UP = new Vector3(0, 1, 0);
// Metres per second. The room now carries Marble's metric scale, so these are real
// walking speeds rather than the arbitrary units the standalone viewer used.
const WALK_SPEED = 1.6;
const SPRINT_MULTIPLIER = 3;
// Standing eye height. The capture origin is on the floor, not at head level.
const SPAWN: [number, number, number] = [0, 1.6, 0];

export type MouseLook = { capture: () => void; release: () => void };

export function Walk({ reset, paused = false, enabled = true, mouseLookRef, onLockChange, onError }: {
  reset: number; paused?: boolean; enabled?: boolean;
  mouseLookRef: MutableRefObject<MouseLook | null>; onLockChange: (locked: boolean) => void; onError: (message: string) => void;
}) {
  const { camera, gl } = useThree();
  const [keys] = useState(() => new Set<string>());
  const [direction] = useState(() => new Vector3());
  const settings = useRef({ paused, enabled, onLockChange, onError });
  settings.current = { paused, enabled, onLockChange, onError };
  useEffect(() => {
    if (paused || !enabled) { mouseLookRef.current?.release(); keys.clear(); }
  }, [paused, enabled, mouseLookRef, keys]);
  useEffect(() => {
    camera.position.set(...SPAWN);
    camera.rotation.set(0, 0, 0, "YXZ");
  }, [camera, reset]);
  useEffect(() => {
    const abort = new AbortController();
    const options = { signal: abort.signal };
    const canvas = gl.domElement;
    let wantLock = false;
    let requesting = false;
    const release = () => {
      wantLock = false;
      keys.clear();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
    const failed = (error?: unknown) => {
      if (abort.signal.aborted || !wantLock) return;
      wantLock = false;
      if (error instanceof Error) console.warn("Pointer lock failed:", error.name, error.message);
      settings.current.onLockChange(false);
      settings.current.onError("Mouse capture was unavailable. Click Resume look to try again, or open this viewer in a browser that supports pointer lock.");
    };
    const capture = () => {
      if (!settings.current.enabled || requesting || document.pointerLockElement === canvas) return;
      wantLock = true;
      requesting = true;
      // Called directly from a click or H key, preserving the browser's user gesture.
      try {
        Promise.resolve(canvas.requestPointerLock()).catch(failed).finally(() => { requesting = false; });
      } catch (error) { requesting = false; failed(error); }
    };
    mouseLookRef.current = { capture, release };
    canvas.addEventListener("pointerdown", (e) => {
      if (settings.current.enabled && !settings.current.paused && e.button === 0) capture();
    }, options);
    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === canvas;
      if (locked && !wantLock) { document.exitPointerLock(); return; }
      if (!locked) { wantLock = false; keys.clear(); }
      settings.current.onLockChange(locked);
    }, options);
    document.addEventListener("pointerlockerror", failed, options);
    document.addEventListener("mousemove", (e) => {
      if (!settings.current.enabled || settings.current.paused || document.pointerLockElement !== canvas) return;
      // Relative motion remains unbounded even after the cursor reaches a screen edge.
      camera.rotation.y -= e.movementX * 0.002;
      camera.rotation.x = Math.max(-1.55, Math.min(1.55, camera.rotation.x - e.movementY * 0.002));
    }, options);
    const movement = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);
    window.addEventListener("keydown", (e) => {
      // `paused` covers placement and the drawing overlay: Q/E turn the armed object there,
      // and must not also fly the camera.
      if (!settings.current.enabled || settings.current.paused || (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) || e.metaKey || e.ctrlKey || e.altKey || !movement.has(e.code)) return;
      e.preventDefault();
      if (document.pointerLockElement !== canvas) capture();
      keys.add(e.code);
    }, options);
    window.addEventListener("keyup", (e) => { keys.delete(e.code); }, options);
    window.addEventListener("blur", release, options);
    document.addEventListener("visibilitychange", release, options);
    return () => { abort.abort(); release(); mouseLookRef.current = null; };
  }, [camera, gl, keys, mouseLookRef]);
  useFrame((_, delta) => {
    if (!enabled || paused) return;
    const held = (a: string, b?: string) => Number(keys.has(a) || Boolean(b && keys.has(b)));
    direction.set(held("KeyD", "ArrowRight") - held("KeyA", "ArrowLeft"), held("KeyE") - held("KeyQ"), held("KeyS", "ArrowDown") - held("KeyW", "ArrowUp"));
    direction.normalize().applyAxisAngle(UP, camera.rotation.y);
    camera.position.addScaledVector(direction, Math.min(delta, 0.05) * WALK_SPEED * (held("ShiftLeft", "ShiftRight") ? SPRINT_MULTIPLIER : 1));
  });
  return null;
}
