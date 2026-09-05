import type { AssetQuality, ProjectView, WorldAssets } from '../types';

/**
 * Backend seam for the viewer. UI and scene code import this interface only.
 * Local and (later) Convex clients implement the same methods.
 */
export interface ProjectClient {
  getDemoProject(): Promise<ProjectView>;
  subscribeProject(projectId: string, cb: (project: ProjectView) => void): () => void;
  getWorldAssets(worldId: string, quality: AssetQuality): Promise<WorldAssets>;

  createProject(): Promise<never>;
  startWorld(...args: unknown[]): Promise<never>;
  saveCalibration(...args: unknown[]): Promise<never>;
  saveSketch(...args: unknown[]): Promise<never>;
  startImage(...args: unknown[]): Promise<never>;
  approveImageAndStartMesh(...args: unknown[]): Promise<never>;
  updateSceneObject(...args: unknown[]): Promise<never>;
  preparePrint(...args: unknown[]): Promise<never>;
  requestQuote(...args: unknown[]): Promise<never>;
}
