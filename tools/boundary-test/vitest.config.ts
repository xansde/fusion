import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@fusion/shared": resolve("../../packages/shared/src/index.ts"),
    },
  },
  test: {
    name: "boundary-test",
    // threads, not forks: the root config (vitest.config.ts) makes forks
    // workers reusable across files for the server; this project's mocks and
    // module state need a fresh worker per file, which threads still give.
    pool: "threads",
    include: ["src/**/__tests__/**/*.test.ts"],
    // Each test spawns dependency-cruiser as a cold subprocess that parses the
    // whole TS tree; under concurrent-suite load this exceeds the 5s default.
    testTimeout: 30_000,
  },
});
