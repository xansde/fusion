import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// __dirname equivalent for ESM — resolve paths relative to this config file.
const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@fusion/system-api": resolve(__dirname, "../../packages/system-api/src/index.ts"),
    },
  },
  test: {
    name: "system-stub",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
