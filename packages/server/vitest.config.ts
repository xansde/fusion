import { configDefaults, defineConfig, type UserConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ISOLATED_TEST_FILES } from "./vitest.isolation";

// __dirname equivalent for ESM — resolve paths relative to this config file,
// not relative to the cwd where vitest is invoked.
const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Shared by `server` (this file) and `server-isolated`
 * (vitest.isolated.config.ts): the two differ only in which files they run
 * and whether a worker's module cache survives from one file to the next.
 */
export function serverTestConfig(opts: {
  name: string;
  isolate: boolean;
  include: string[];
  exclude: string[];
}): UserConfig {
  return {
    resolve: {
      alias: {
        "@fusion/shared": resolve(__dirname, "../shared/src/index.ts"),
        "@fusion/system-api": resolve(__dirname, "../system-api/src/index.ts"),
      },
    },
    test: {
      name: opts.name,
      environment: "node",
      // forks pool (child processes) instead of threads: better-sqlite3 is a
      // native addon and intermittently crashes (ACCESS_VIOLATION on Windows)
      // when loaded in worker_threads. Vite's transform pipeline (and
      // resolve.alias) applies to forks workers the same way.
      pool: "forks",
      // Cap concurrent test-file processes: several suites spawn their own
      // child processes (CLI tests) or bind sockets; unbounded forks saturate
      // the machine and produce timeout flakiness.
      //
      // isolate: false (the `server` project) — a worker keeps its module
      // cache across test files, so the server's import graph is loaded once
      // per worker instead of once per file. Files that leave module-level
      // state behind run in `server-isolated`; see vitest.isolation.ts.
      poolOptions: { forks: { maxForks: 4, isolate: opts.isolate } },
      include: opts.include,
      exclude: [...configDefaults.exclude, ...opts.exclude],
      testTimeout: 30_000,
      hookTimeout: 15_000,
      // Minimum Argon2id cost for the users every test bootstraps (see
      // argon2Options in src/auth/crypto.ts; the production cost is pinned by
      // src/auth/__tests__/argon2-cost.test.ts). Inherited by the CLI child
      // processes the tests spawn.
      env: { FUSION_TEST_FAST_ARGON2: "1" },
    },
  };
}

export default defineConfig(
  serverTestConfig({
    name: "server",
    isolate: false,
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: [...ISOLATED_TEST_FILES],
  }),
);
