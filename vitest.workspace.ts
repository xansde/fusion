import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared/vitest.config.ts",
  "packages/system-api/vitest.config.ts",
  "systems/stub/vitest.config.ts",
  "packages/server/vitest.config.ts",
  "packages/client/vitest.config.ts",
  "tools/boundary-test/vitest.config.ts",
  "tools/release/vitest.config.ts",
]);
