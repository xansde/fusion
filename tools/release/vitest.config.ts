import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "release-tools",
    include: ["__tests__/**/*.test.ts"],
    // Each test spawns a Node child process — cold-start dominates the
    // timing, same rationale as boundary-test's testTimeout bump.
    testTimeout: 30_000,
  },
});
