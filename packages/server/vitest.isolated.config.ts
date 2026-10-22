import { defineConfig } from "vitest/config";
import { serverTestConfig } from "./vitest.config";
import { ISOLATED_TEST_FILES } from "./vitest.isolation";

// The server test files that must not share a worker's module cache (see
// vitest.isolation.ts): same settings as `server`, a fresh module graph per file.
export default defineConfig(
  serverTestConfig({
    name: "server-isolated",
    isolate: true,
    include: [...ISOLATED_TEST_FILES],
    exclude: [],
  }),
);
