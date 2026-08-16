import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// __dirname equivalent for ESM — resolve the alias relative to this config
// file, not relative to the cwd where vitest is invoked. Without this the
// alias breaks when the root workspace runner (`pnpm test`) executes this
// project from the repo root instead of packages/client.
const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // The Svelte plugin is required so `.svelte.ts` rune modules (e.g. the reactive
  // window-manager / dialogs stores) compile their `$state` runes under Vitest.
  // Runtime primitives from `svelte/reactivity` (SvelteMap) work without it, but
  // `$state` is a compiler macro and needs this transform.
  plugins: [svelte()],
  resolve: {
    alias: {
      "@fusion/shared": resolve(__dirname, "../shared/src/index.ts"),
      $lib: resolve(__dirname, "src/lib"),
      "@fusion/system-etmos": resolve(__dirname, "../../systems/etmos/src/index.ts"),
    },
  },
  test: {
    name: "client",
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    // FIX-7: socket.test.ts and worldSync.test.ts exercise real socket.io
    // round-trips that occasionally brush the default 5s ceiling on a loaded
    // machine, causing pre-existing flakiness. Raise the per-test ceiling to
    // 15s — these are I/O-bound integration tests, not hot loops.
    testTimeout: 15_000,
  },
});
