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
      // Etmos's pure compositor functions (montarFrase/validarFrase/custoEstresse)
      // are imported here for CLIENT-SIDE FEEDBACK ONLY — the server always
      // re-validates authoritatively. This does not violate REQ-ARQ-005 (which
      // forbids client dependence on system RULE ENGINES like PF2e's derive
      // pipeline): the Etmos compositor module is pure, dependency-free
      // TypeScript with no I/O, no PIXI/Svelte coupling, and no server state.
      "@fusion/system-etmos": resolve("../../systems/etmos/src/index.ts"),
      $lib: resolve("./src/lib"),
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
