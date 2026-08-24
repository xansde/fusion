import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared/vitest.config.ts",
  "packages/system-api/vitest.config.ts",
  "systems/stub/vitest.config.ts",
  // The shipped game systems. Left out until now, so their suites existed,
  // were maintained, and never ran — not on `pnpm test`, not on CI. That is
  // how a packs-validation failure sat green for everyone.
  // F4 (DEC-SEP-09): engine-2e/pf2e/sf2e now live in the fusion-systems-2e
  // submodule, checked out for real at external/fusion-systems-2e/ — same
  // vitest.config.ts files, new path. sheets/pf2e (@fusion/sheets-pf2e)
  // isn't listed here yet: it has no vitest.config.ts of its own (its
  // `$lib/*` alias is owned by packages/client's own Vite config — see
  // README.md/AGENTS.md in the satellite, "Ficha (sheets/pf2e)"); wiring
  // its tests into this workspace is follow-up work, not F4 scope.
  "external/fusion-systems-2e/systems/engine-2e/vitest.config.ts",
  "external/fusion-systems-2e/systems/pf2e/vitest.config.ts",
  "external/fusion-systems-2e/systems/sf2e/vitest.config.ts",
  "packages/server/vitest.config.ts",
  "packages/client/vitest.config.ts",
  "tools/boundary-test/vitest.config.ts",
  "tools/spec-lint/vitest.config.ts",
  "tools/release/vitest.config.ts",
]);
