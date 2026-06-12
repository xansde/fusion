import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@fusion/shared": resolve("../shared/src/index.ts"),
    },
  },
  test: {
    name: "client",
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    // FIX-7: socket.test.ts and worldSync.test.ts exercise real socket.io
    // round-trips that occasionally brush the default 5s ceiling on a loaded
    // machine, causing pre-existing flakiness. Raise the per-test ceiling to
    // 15s — these are I/O-bound integration tests, not hot loops.
    testTimeout: 15_000,
  },
});
