import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { assetPipelinePlugin } from "./vite.asset-pipeline";
export default defineConfig({
  plugins: [react(), assetPipelinePlugin()],
  server: {
    port: 5173,
    fs: { deny: ["**/.env", "**/.env.*", "**/*.{crt,pem}", "**/.git/**", "**/.local/**", "**/asset-output/**"] },
  },
});
