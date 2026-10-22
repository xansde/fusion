import { defineConfig } from "vitest/config";

// Root config for `vitest --workspace vitest.workspace.ts`. The projects live
// in vitest.workspace.ts; this file only holds what vitest reads from the ROOT
// config and ignores in a project's: the forks pool's process-level isolation.
//
// isolate: false here means a forks worker process is reused from one test
// file to the next instead of a new child process per file. Each project still
// decides whether its module cache is reset between files (its own
// poolOptions.forks.isolate, default true): `server` keeps it (see
// packages/server/vitest.isolation.ts), every other forks project resets it.
export default defineConfig({
  test: {
    poolOptions: { forks: { isolate: false } },
  },
});
