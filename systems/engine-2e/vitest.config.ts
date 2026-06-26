import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@fusion/system-api": resolve(__dirname, "../../packages/system-api/src/index.ts"),
      "@fusion/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    name: "engine-2e",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
