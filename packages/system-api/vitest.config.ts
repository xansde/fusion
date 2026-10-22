import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@fusion/shared": resolve("../shared/src/index.ts"),
    },
  },
  test: {
    name: "system-api",
    // threads, not forks: the root config (vitest.config.ts) makes forks
    // workers reusable across files for the server; this project's mocks and
    // module state need a fresh worker per file, which threads still give.
    pool: "threads",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
