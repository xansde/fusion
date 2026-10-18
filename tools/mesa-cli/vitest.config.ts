import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@fusion/shared": resolve(here, "../../packages/shared/src/index.ts"),
      "@fusion/system-api": resolve(here, "../../packages/system-api/src/index.ts"),
    },
  },
  test: {
    name: "mesa-cli",
    environment: "node",
    // better-sqlite3 (booted by the test server) crashes in worker_threads.
    pool: "forks",
    poolOptions: { forks: { maxForks: 2 } },
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 20_000,
  },
});
