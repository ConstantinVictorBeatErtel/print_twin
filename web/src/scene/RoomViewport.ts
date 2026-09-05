import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { ProjectView, SceneObject, WorldAssets } from '../types';
import type { Surface } from '../surface';
import { isValidSplatToApp } from './transforms';
import { NavigationController, type NavigationMode } from './navigation';

export type RoomViewportCallbacks = {
  onStatus?: (status: 'loading' | 'ready' | 'error', message?: string) => void;
  onHintChange?: (show: boolean) => void;
};

export class RoomViewport {
  private readonly container: HTMLElement;
  private readonly surface: Surface;
  private readonly callbacks: RoomViewportCallbacks;
  private renderer: THREE.WebGLRenderer | null = null;
  private spark: SparkRenderer | null = null;
  private splat: SplatMesh | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private navigation: NavigationController | null = null;
  private colliderRoot: THREE.Object3D | null = null;
  private disposed = false;
  private lastTime = 0;
  private objectsGroup: THREE.Group | null = null;

  constructor(container: HTMLElement, surface: Surface, callbacks: RoomViewportCallbacks = {}) {
    this.container = container;
    this.surface = surface;
    this.callbacks = callbacks;
  }

  async start(project: ProjectView, assets: WorldAssets): Promise<void> {
    this.callbacks.onStatus?.('loading');

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    const maxRatio = this.surface === 'phone' ? 1.5 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio));
    renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d10);
    this.scene = scene;

    const aspect = Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1);
    const camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 200);
    camera.position.set(0, 1.6, 0);
    camera.lookAt(0, 1.6, -1);
    this.camera = camera;

    const spark = new SparkRenderer({ renderer });
    scene.add(spark);
    this.spark = spark;

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(2, 4, 1);
    scene.add(dir);

    const matrix = project.world.coordinates.splatToApp;
    if (!isValidSplatToApp(matrix)) {
      this.callbacks.onStatus?.(
        'error',
        'World has no splatToApp; cannot render at metric scale',
      );
      return;
    }

    const splat = new SplatMesh({ url: assets.splatUrl });
    await splat.initialized;
    if (this.disposed) {
      splat.dispose();
      return;
    }
    // Apply Marble metric+axis conversion exactly once. Do NOT also set quaternion (1,0,0,0).
    splat.matrixAutoUpdate = false;
    splat.matrix.fromArray(matrix);
    scene.add(splat);
    this.splat = splat;

    this.objectsGroup = new THREE.Group();
    scene.add(this.objectsGroup);
    for (const obj of project.objects) {
      this.addPlaceholderObject(obj);
    }

    // Later Tripo hook:
    // async addGltfObject(url: string, transform: { position, quaternion, scale }) { ... GLTFLoader ... }

    const navigation = new NavigationController(camera, renderer.domElement, this.surface);
    if (this.callbacks.onHintChange) {
      navigation.setHintListener(this.callbacks.onHintChange);
    }
    this.navigation = navigation;

    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    this.resizeObserver = new ResizeObserver(onResize);
    this.resizeObserver.observe(this.container);

    this.lastTime = performance.now();
    renderer.setAnimationLoop((time) => {
      if (this.disposed || !this.renderer || !this.scene || !this.camera) return;
      const dt = Math.min(0.05, (time - this.lastTime) / 1000);
      this.lastTime = time;
      this.navigation?.update(dt);
      this.renderer.render(this.scene, this.camera);
    });

    this.callbacks.onStatus?.('ready');
  }

  private resizeObserver: ResizeObserver | null = null;

  setMode(mode: NavigationMode) {
    this.navigation?.setMode(mode);
  }

  setJoystick(move: { x: number; z: number }) {
    this.navigation?.setJoystick(move);
  }

  async setShowCollider(show: boolean, colliderUrl: string) {
    if (!this.scene) return;
    if (!show) {
      if (this.colliderRoot) {
        this.scene.remove(this.colliderRoot);
        this.colliderRoot = null;
      }
      return;
    }
    if (this.colliderRoot) return;
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(colliderUrl);
    if (this.disposed || !this.scene) return;
    // Identity only — colliderToApp is null / unverified. Do not copy splatToApp.
    const root = gltf.scene;
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = new THREE.MeshBasicMaterial({
          color: 0x66ff99,
          wireframe: true,
          transparent: true,
          opacity: 0.35,
        });
      }
    });
    this.colliderRoot = root;
    this.scene.add(root);
  }

  private addPlaceholderObject(obj: SceneObject) {
    if (!this.objectsGroup) return;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xd4784a }),
    );
    mesh.position.fromArray(obj.position);
    mesh.quaternion.fromArray(obj.quaternion);
    mesh.scale.fromArray(obj.scale);
    mesh.name = obj.id;
    this.objectsGroup.add(mesh);
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    const maxRatio = this.surface === 'phone' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.navigation?.dispose();
    this.navigation = null;
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
    }
    this.splat?.dispose();
    this.splat = null;
    this.spark?.dispose();
    this.spark = null;
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.objectsGroup = null;
    this.colliderRoot = null;
  }
}
