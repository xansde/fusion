/**
 * Which server test files must run in a fresh module graph.
 *
 * The `server` project runs with `isolate: false`: a forks worker keeps its
 * module cache from one test file to the next, so `boot`, fastify, socket.io
 * and the system packages are imported once per worker instead of once per
 * file (the collect phase was most of the suite's wall-clock time). That is
 * only safe for files that leave no module-level state behind. The files
 * below do not, and run in the `server-isolated` project instead
 * (vitest.isolated.config.ts, `isolate: true`, the old behaviour):
 *
 * - they replace a module-level registry (registerMigrations,
 *   registerRollResolver, registerActorMechanics, registerPackDir,
 *   registerTargetingCleanup, ...) — the next file in the worker would
 *   inherit their stand-in;
 * - they mock modules (vi.mock / vi.doMock + resetModules) — a mock does not
 *   apply to a module the worker already imported;
 * - they block the worker's event loop with spawnSync/execFileSync, which
 *   starves vitest's RPC ("Timeout calling onTaskUpdate") in a reused worker.
 *   The CLI tests spawn asynchronously instead (src/__tests__/helpers/run-cli.ts)
 *   and need no isolation.
 *
 * src/__tests__/isolation-list.test.ts fails when a test file uses one of
 * those patterns and is not listed here — add it to the list, don't drop the
 * guard.
 */
export const ISOLATED_TEST_FILES: readonly string[] = [
  // module-level registries
  "src/combat/__tests__/apply-condition-handler.test.ts",
  "src/combat/__tests__/apply-damage-handler.test.ts",
  "src/combat/__tests__/combat-unit.test.ts",
  "src/combat/__tests__/map-counter.test.ts",
  "src/combat/__tests__/mark-handler.test.ts",
  "src/combat/__tests__/target-selection.test.ts",
  "src/net/__tests__/item-consume.test.ts",
  "src/runtime/__tests__/native-loader.test.ts",
  "src/__tests__/assets-registry.test.ts",
  "src/__tests__/chat-archive.test.ts",
  "src/__tests__/chat-extra-damage.test.ts",
  "src/__tests__/chat-roll-resolution.test.ts",
  "src/__tests__/db-backup-restore.test.ts",
  "src/__tests__/db-constraints.test.ts",
  "src/__tests__/db-maintenance.test.ts",
  "src/__tests__/db-schema-guard.test.ts",
  "src/__tests__/db.test.ts",
  "src/__tests__/effect-apply-socket.test.ts",
  "src/__tests__/migration-010-ancient-elf.test.ts",
  "src/__tests__/mount-effect-socket.test.ts",
  "src/__tests__/roll-resolution-companion.test.ts",
  // module mocks
  "src/__tests__/house-rules-build-validation.test.ts",
  "src/tunnel/__tests__/downloader.test.ts",
  // execFileSync (blocks the worker's event loop)
  "src/update/__tests__/swap-helper.test.ts",
];

/** Source patterns that make a test file unsafe to share a worker's module cache. */
export const ISOLATION_PATTERNS: readonly RegExp[] = [
  /\bregister(Migrations|PackDir|SystemFormulas|RollResolver|ActorMechanics|InitiativeFormula|Formula|MapCounterReset|ContactKnowledgeSource|ConsumeItem|ConsumeHook|TargetingCleanup)\(/,
  /\bvi\.(mock|doMock|stubGlobal|resetModules)\(/,
  /\b_reset[A-Za-z]*ForTests?\(/,
  /\b(spawnSync|execSync|execFileSync)\(/,
];
