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
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
