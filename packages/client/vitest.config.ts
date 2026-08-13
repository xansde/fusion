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
      "@fusion/system-etmos": resolve(__dirname, "../../systems/etmos/src/index.ts"),
    },
  },
  test: {
    name: "client",
    environment: "node",
    // vite-plugins/ holds Node-only build glue (the avatar acervo publisher);
    // its pure helpers — the path-traversal guard above all — are worth testing
    // and must NOT live under src/, which is browser code.
    include: ["src/**/__tests__/**/*.test.ts", "vite-plugins/__tests__/**/*.test.ts"],
    // FIX-7: socket.test.ts and worldSync.test.ts exercise real socket.io
    // round-trips that occasionally brush the default 5s ceiling on a loaded
    // machine, causing pre-existing flakiness. These are I/O-bound integration
    // tests, not hot loops.
    //
    // Raised 15s -> 30s (2026-08-12): the ceiling also has to absorb module
    // TRANSFORM cost, because these suites `await import(...)` the module under
    // test from inside the first `it(...)` — so whichever test imports first
    // pays for compiling the whole graph within its own timeout. Measured on a
    // loaded machine: transform 15.6s against a 15s ceiling, so the first test
    // failed while the other 11 passed; the same file went 12/12 green at 60s.
    // A gate that goes red under load is a gate the team learns to ignore.
    testTimeout: 30_000,
  },
});
