import { useEffect, useState } from 'react';
import type { ProjectClient } from '../api/ProjectClient';
import { ProjectClientError } from '../api/errors';
import type { AssetQuality, ProjectView, WorldAssets } from '../types';

type State =
  | { status: 'loading' }
  | { status: 'ready'; project: ProjectView; assets: WorldAssets }
  | { status: 'error'; message: string };

export function useProject(client: ProjectClient, quality: AssetQuality, enabled = true): State {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const project = await client.getDemoProject();
        const assets = await client.getWorldAssets(project.activeWorldId, quality);
        if (!cancelled) setState({ status: 'ready', project, assets });
      } catch (err) {
        const message =
          err instanceof ProjectClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to load project';
        if (!cancelled) setState({ status: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, quality, enabled]);

  return state;
}
