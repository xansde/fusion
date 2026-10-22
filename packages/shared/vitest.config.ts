import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "shared",
    // threads, not forks: the root config (vitest.config.ts) makes forks
    // workers reusable across files for the server; this project's mocks and
    // module state need a fresh worker per file, which threads still give.
    pool: "threads",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**"],
    },
  },
});
