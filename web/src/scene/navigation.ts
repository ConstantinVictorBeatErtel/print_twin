import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import type { Surface } from '../surface';

const WALK = 1.4;
const SPRINT = 2.8;
const FLY = 1.0;
const LOOK_SENS = 0.005;
const PITCH_LIMIT = (88 * Math.PI) / 180;

export type MoveInput = { x: number; z: number };

export type NavigationMode = 'explore' | 'draw';

/**
 * Laptop: PointerLockControls + WASD.
 * Phone: external look deltas + joystick move. Never uses pointer lock on phone.
 */
export class NavigationController {
  readonly camera: THREE.PerspectiveCamera;
  readonly surface: Surface;
  private controls: PointerLockControls | null = null;
  private keys = new Set<string>();
  private mode: NavigationMode = 'explore';
  private move: MoveInput = { x: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private looking = false;
  private lookPointerId: number | null = null;
  private lastLookX = 0;
  private lastLookY = 0;
  private lockedHint = true;
  private onHintChange: ((show: boolean) => void) | null = null;
  private readonly canvas: HTMLElement;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly keyUp: (e: KeyboardEvent) => void;
  private readonly pointerDown: (e: PointerEvent) => void;
  private readonly pointerMove: (e: PointerEvent) => void;
  private readonly pointerUp: (e: PointerEvent) => void;

  constructor(camera: THREE.PerspectiveCamera, canvas: HTMLElement, surface: Surface) {
    this.camera = camera;
    this.canvas = canvas;
    this.surface = surface;

    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    this.yaw = euler.y;
    this.pitch = euler.x;

    this.keyDown = (e) => {
      this.keys.add(e.code);
    };
    this.keyUp = (e) => {
      this.keys.delete(e.code);
    };

    this.pointerDown = (e) => this.handlePointerDown(e);
    this.pointerMove = (e) => this.handlePointerMove(e);
    this.pointerUp = (e) => this.handlePointerUp(e);

    if (surface === 'laptop') {
      this.controls = new PointerLockControls(camera, canvas);
      this.controls.addEventListener('lock', () => {
        this.lockedHint = false;
        this.onHintChange?.(false);
      });
      this.controls.addEventListener('unlock', () => {
        this.lockedHint = true;
        this.onHintChange?.(true);
      });
      canvas.addEventListener('click', () => {
        if (this.mode === 'explore' && this.controls && !this.controls.isLocked) {
          this.controls.lock();
        }
      });
      window.addEventListener('keydown', this.keyDown);
      window.addEventListener('keyup', this.keyUp);
    } else {
      canvas.addEventListener('pointerdown', this.pointerDown);
      window.addEventListener('pointermove', this.pointerMove);
      window.addEventListener('pointerup', this.pointerUp);
      window.addEventListener('pointercancel', this.pointerUp);
    }
  }

  setHintListener(cb: (show: boolean) => void) {
    this.onHintChange = cb;
    cb(this.lockedHint && this.surface === 'laptop');
  }

  setMode(mode: NavigationMode) {
    this.mode = mode;
    if (mode === 'draw') {
      this.keys.clear();
      this.move = { x: 0, z: 0 };
      this.looking = false;
      this.lookPointerId = null;
      this.controls?.unlock();
    }
  }

  setJoystick(move: MoveInput) {
    this.move = move;
  }

  showClickHint(): boolean {
    return this.surface === 'laptop' && this.mode === 'explore' && this.lockedHint;
  }

  update(dt: number) {
    if (this.mode !== 'explore') return;

    let mx = this.move.x;
    let mz = this.move.z;

    if (this.surface === 'laptop') {
      const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const speed = sprint ? SPRINT : WALK;
      if (this.keys.has('KeyW')) mz -= 1;
      if (this.keys.has('KeyS')) mz += 1;
      if (this.keys.has('KeyA')) mx -= 1;
      if (this.keys.has('KeyD')) mx += 1;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 1e-6) forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).negate();
      this.camera.position.addScaledVector(forward, -mz * speed * dt);
      this.camera.position.addScaledVector(right, mx * speed * dt);
      let dy = 0;
      if (this.keys.has('KeyQ')) dy -= FLY;
      if (this.keys.has('KeyE')) dy += FLY;
      this.camera.position.y += dy * dt;
    } else {
      const speed = WALK;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      if (len > 0.05) {
        const forward = new THREE.Vector3(
          -Math.sin(this.yaw),
          0,
          -Math.cos(this.yaw),
        );
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        this.camera.position.addScaledVector(forward, -mz * speed * dt);
        this.camera.position.addScaledVector(right, mx * speed * dt);
      }
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    this.canvas.removeEventListener('pointerdown', this.pointerDown);
    window.removeEventListener('pointermove', this.pointerMove);
    window.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('pointercancel', this.pointerUp);
    this.controls?.dispose();
  }

  private handlePointerDown(e: PointerEvent) {
    if (this.mode !== 'explore' || this.surface !== 'phone') return;
    if (e.pointerType === 'touch' && e.isPrimary === false) return;
    const rect = this.canvas.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    // Right 70% is look; left is reserved for joystick (HUD).
    if (relX < 0.3) return;
    this.looking = true;
    this.lookPointerId = e.pointerId;
    this.lastLookX = e.clientX;
    this.lastLookY = e.clientY;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private handlePointerMove(e: PointerEvent) {
    if (!this.looking || e.pointerId !== this.lookPointerId) return;
    const dx = e.clientX - this.lastLookX;
    const dy = e.clientY - this.lastLookY;
    this.lastLookX = e.clientX;
    this.lastLookY = e.clientY;
    this.yaw -= dx * LOOK_SENS;
    this.pitch -= dy * LOOK_SENS;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  private handlePointerUp(e: PointerEvent) {
    if (e.pointerId !== this.lookPointerId) return;
    this.looking = false;
    this.lookPointerId = null;
  }
}
