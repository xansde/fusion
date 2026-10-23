import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "spec-lint",
    // threads, not forks: the root config (vitest.config.ts) makes forks
    // workers reusable across files for the server; this project's mocks and
    // module state need a fresh worker per file, which threads still give.
    pool: "threads",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
