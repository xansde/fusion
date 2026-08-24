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
  // vitest.config.ts files, new path. sheets/pf2e (@fusion/sheets-pf2e) now
  // has its own vitest.config.ts too (satellite PR #43, 24/08/2026), which
  // resolves the `$lib/*` alias to THIS core's packages/client/src/lib —
  // the submodule mount puts the config at exactly this relative depth, so
  // it works from inside the real submodule the same way it does from the
  // satellite's own CI mount (scripts/setup-core.sh).
  "external/fusion-systems-2e/systems/engine-2e/vitest.config.ts",
  "external/fusion-systems-2e/systems/pf2e/vitest.config.ts",
  "external/fusion-systems-2e/systems/sf2e/vitest.config.ts",
  "external/fusion-systems-2e/sheets/pf2e/vitest.config.ts",
  "packages/server/vitest.config.ts",
  "packages/client/vitest.config.ts",
  "tools/boundary-test/vitest.config.ts",
  "tools/spec-lint/vitest.config.ts",
  "tools/release/vitest.config.ts",
]);
