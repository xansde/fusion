import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared/vitest.config.ts",
  "packages/system-api/vitest.config.ts",
  "systems/stub/vitest.config.ts",
  // The shipped game systems. Left out until now, so their suites existed,
  // were maintained, and never ran — not on `pnpm test`, not on CI. That is
  // how a packs-validation failure sat green for everyone.
  "systems/engine-2e/vitest.config.ts",
  "systems/pf2e/vitest.config.ts",
  "systems/sf2e/vitest.config.ts",
  "systems/etmos/vitest.config.ts",
  "packages/server/vitest.config.ts",
  "packages/client/vitest.config.ts",
  "tools/boundary-test/vitest.config.ts",
  "tools/spec-lint/vitest.config.ts",
  "tools/release/vitest.config.ts",
]);
