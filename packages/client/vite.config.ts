import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

/**
 * Vite configuration for @fusion/client.
 *
 * - Build output goes to dist/
 * - Dev server proxies /api and /socket.io to the Fusion server on port 33000
 * - Workspace alias resolves @fusion/shared from source (no build step needed in dev)
 */
export default defineConfig({
  plugins: [svelte()],

  resolve: {
    alias: {
      "@fusion/shared": resolve("../shared/src/index.ts"),
    },
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },

  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:33000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:33000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
