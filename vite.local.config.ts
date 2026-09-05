import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

export default mergeConfig(base, defineConfig({
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  build: {
    outDir: "dist-local",
    rollupOptions: { input: fileURLToPath(new URL("./local.html", import.meta.url)) },
  },
}));
