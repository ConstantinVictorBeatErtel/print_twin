import { fileURLToPath } from "node:url";
import { loadEnv, type Plugin } from "vite";
import { createAssetPipeline } from "./server/asset-pipeline.js";
import { createSettings } from "./server/settings.js";

/** Same API for dev:web, dev:local and preview; credentials stay on the server. */
export function assetPipelinePlugin(): Plugin {
  let env: Record<string, string> = {};
  const root = fileURLToPath(new URL("./", import.meta.url));
  const settings = createSettings({ file: fileURLToPath(new URL("./.local/api-keys.json", import.meta.url)), getEnv: () => ({ ...env, ...process.env }) });
  const pipeline = createAssetPipeline({
    outputRoot: fileURLToPath(new URL("./asset-output", import.meta.url)),
    getEnv: settings.env,
  });
  return {
    name: "drawing-assets",
    configResolved(config) {
      env = { ...loadEnv(config.mode, root, ["FAL_", "TRIPO_"]), ...loadEnv(config.mode, config.root, ["FAL_", "TRIPO_"]) };
    },
    configureServer(server) { server.middlewares.use(settings.middleware); server.middlewares.use(pipeline); },
    configurePreviewServer(server) { server.middlewares.use(settings.middleware); server.middlewares.use(pipeline); },
  };
}
