import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// __dirname equivalent for ESM — resolve paths relative to this config file,
// not relative to the cwd where vitest is invoked.
const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@fusion/shared": resolve(__dirname, "../shared/src/index.ts"),
      "@fusion/system-api": resolve(__dirname, "../system-api/src/index.ts"),
    },
  },
  test: {
    name: "server",
    environment: "node",
    // forks pool (child processes) instead of threads: better-sqlite3 is a
    // native addon and intermittently crashes (ACCESS_VIOLATION on Windows)
    // when loaded in worker_threads. Vite's transform pipeline (and
    // resolve.alias) applies to forks workers the same way.
    pool: "forks",
    // Cap concurrent test-file processes: several suites spawn their own
    // child processes (CLI tests) or bind sockets; unbounded forks saturate
    // the machine and produce timeout flakiness.
    poolOptions: { forks: { maxForks: 4 } },
    include: ["src/**/__tests__/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
