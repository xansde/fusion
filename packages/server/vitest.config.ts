import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// __dirname equivalent for ESM — resolve paths relative to this config file,
// not relative to the cwd where vitest is invoked.
const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@fusion/shared": resolve(__dirname, "../shared/src/index.ts"),
      "@fusion/system-api": resolve(__dirname, "../system-api/src/index.ts"),
    },
  },
  test: {
    name: "server",
    environment: "node",
    // threads pool preserves resolve.alias for @fusion/shared.
    // forks would spawn isolated Node processes that lose Vite's module resolution.
    pool: "threads",
    include: ["src/**/__tests__/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
