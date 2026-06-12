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
    include: ["src/**/__tests__/**/*.test.ts"],
    // Each test spawns dependency-cruiser as a cold subprocess that parses the
    // whole TS tree; under concurrent-suite load this exceeds the 5s default.
    testTimeout: 30_000,
  },
});
