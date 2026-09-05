import type { ProjectClient } from '../ProjectClient';
import { notImplemented, ProjectClientError } from '../errors';
import type {
  AssetQuality,
  ProjectView,
  SceneObject,
  WorldAssets,
  WorldCoordinates,
  WorldView,
} from '../../types';

const DEFAULT_JOB = 'hackathon-room-video-01';
const jobFromUrl = () => new URLSearchParams(location.search).get('job') ?? DEFAULT_JOB;

const PLACEHOLDER_OBJECT: SceneObject = {
  id: 'placeholder-box',
  objectAssetId: 'placeholder-box',
  position: [0, 0.1, -1.5],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
  confirmedDimensions: null,
  revision: 1,
};

type ManifestJson = {
  worldId?: string;
  displayName?: string;
  preferredSplat?: string;
  assets?: Record<string, { path: string }>;
  coordinates?: Partial<WorldCoordinates> & {
    splatToApp?: number[] | null;
    colliderToApp?: number[] | null;
  };
};

export class LocalProjectClient implements ProjectClient {
  private cached: ProjectView | null = null;

  async getDemoProject(): Promise<ProjectView> {
    if (this.cached) return this.cached;
    const job = jobFromUrl();
    const assetBase = `/world-assets/${job}`;

    const response = await fetch(`${assetBase}/manifest.json`);
    if (!response.ok) {
      throw new ProjectClientError({
        code: 'world_missing',
        message:
          'Local world not found. Generate it with `npm run world -- resume --job hackathon-room-video-01`.',
        retryable: false,
      });
    }

    const manifest = (await response.json()) as ManifestJson;
    const coords = manifest.coordinates ?? {};
    const world: WorldView = {
        worldId: manifest.worldId ?? job,
      displayName: manifest.displayName ?? 'Hackathon Room',
      preferredSplat: manifest.preferredSplat ?? 'splat-500k',
      coordinates: {
        splatToApp: Array.isArray(coords.splatToApp) ? coords.splatToApp : null,
        colliderToApp: Array.isArray(coords.colliderToApp) ? coords.colliderToApp : null,
        worldTransformVersion: coords.worldTransformVersion ?? 1,
        calibration: coords.calibration ?? 'unmeasured',
        colliderAlignment: coords.colliderAlignment ?? 'unverified',
        metricMetadataAvailable: coords.metricMetadataAvailable ?? false,
      },
    };

    this.cached = {
      id: job,
      backendMode: 'local',
      activeWorldId: world.worldId,
      sceneRevision: 1,
      world,
      objects: [PLACEHOLDER_OBJECT],
      activeJob: null,
    };
    return this.cached;
  }

  subscribeProject(projectId: string, cb: (project: ProjectView) => void): () => void {
    void this.getDemoProject()
      .then((project) => {
        if (project.id === projectId || projectId === jobFromUrl()) cb(project);
      })
      .catch(() => {
        /* caller already handles getDemoProject errors */
      });
    return () => {};
  }

  async getWorldAssets(_worldId: string, quality: AssetQuality): Promise<WorldAssets> {
    const splatKey = quality === 'phone' ? 'splat-100k' : 'splat-500k';
    const assetBase = `/world-assets/${jobFromUrl()}`;
    return {
      splatUrl: `${assetBase}/assets/${splatKey}.spz`,
      colliderUrl: `${assetBase}/assets/collider.glb`,
      thumbnailUrl: `${assetBase}/assets/thumbnail.webp`,
    };
  }

  createProject(): Promise<never> {
    return notImplemented('createProject');
  }
  startWorld(): Promise<never> {
    return notImplemented('startWorld');
  }
  saveCalibration(): Promise<never> {
    return notImplemented('saveCalibration');
  }
  saveSketch(): Promise<never> {
    return notImplemented('saveSketch');
  }
  startImage(): Promise<never> {
    return notImplemented('startImage');
  }
  approveImageAndStartMesh(): Promise<never> {
    return notImplemented('approveImageAndStartMesh');
  }
  updateSceneObject(): Promise<never> {
    return notImplemented('updateSceneObject');
  }
  preparePrint(): Promise<never> {
    return notImplemented('preparePrint');
  }
  requestQuote(): Promise<never> {
    return notImplemented('requestQuote');
  }
}
