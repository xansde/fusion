import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "spec-lint",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
