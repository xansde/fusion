/**
 * CLI commands: fusion assets reconcile <world> | fusion assets gc <world>
 *
 * T022/T023 — the CLI surface for `assets/reconcile.ts`. Follows the same
 * pattern as `fusion chat archive` (../commands/chat.ts) and
 * `fusion world restore` (../commands/worlds.ts): its own tiny arg parser
 * rather than extending ../args.ts's shared parser, since both subcommands
 * are dispatched directly from ../index.ts before parseArgs() ever runs.
 *
 * `reconcile` is read-mostly (it backfills missing `assets` registry rows —
 * see reconcile.ts's module doc — but deletes nothing) and always previews;
 * `gc` is the destructive half and follows `chat archive`'s
 * `--confirm-delete-count <N>` shape: N must equal the orphan count from a
 * prior dry run, proving the caller saw the list — not a `--yes` flag.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, applyMigrations } from "../../db/index.js";
import { readLock, isProcessAlive, lockPath } from "../../worlds/world-manager.js";
import { resolveDataDirForLoad } from "../../config.js";
import { ensureDataDirLayout } from "../../data-dir.js";
import { createLogger } from "../../logger.js";
import { reconcileAssets, runAssetGc } from "../../assets/reconcile.js";
import type { AssetReconcileReport } from "../../assets/reconcile.js";

// ---------------------------------------------------------------------------
// Helpers (mirrors chat.ts / worlds.ts — see their docstrings)
// ---------------------------------------------------------------------------

function resolveDataDir(dataDirArg: string | undefined): string {
  const { dataDir, usedLegacyFallback } = resolveDataDirForLoad(
    dataDirArg !== undefined ? { cliOverrides: { dataDir: dataDirArg } } : {},
  );
  ensureDataDirLayout(dataDir, {
    usedLegacyDataDir: usedLegacyFallback,
    logger: createLogger("info"),
  });
  return dataDir;
}

function consumeOption(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Option ${flag} requires a value`);
  }
  argv.splice(idx, 2);
  return value;
}

function consumeFlag(argv: string[], flag: string): boolean {
  const idx = argv.indexOf(flag);
  if (idx === -1) return false;
  argv.splice(idx, 1);
  return true;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatAge(nowMs: number, createdAt: number): string {
  const ms = Math.max(0, nowMs - createdAt);
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

/**
 * Shared setup for both subcommands: resolve the data dir, refuse a missing
 * world (never silently create one for a command whose whole point is
 * inspecting/mutating an existing world's assets), and refuse a live lock —
 * same predicate `chat archive` / `world restore` use, for the same reason:
 * this reads AND writes world.db (reconcile backfills registry rows; gc
 * deletes rows), and a running server could be writing to it at the same time.
 */
function openWorldForAssetsCommand(
  commandLabel: string,
  world: string,
  dataDirArg: string | undefined,
): { dataDir: string; db: ReturnType<typeof openDatabase>; assetsDir: string } | null {
  const dataDir = resolveDataDir(dataDirArg);
  const dbPath = join(dataDir, "worlds", world, "world.db");

  if (!existsSync(dbPath)) {
    process.stderr.write(
      `${commandLabel}: world "${world}" not found at ${dbPath} — refusing to create ` +
        `one implicitly.\n`,
    );
    process.exit(1);
    return null;
  }

  const existingLock = readLock(lockPath(dataDir, world));
  if (existingLock !== null && isProcessAlive(existingLock.pid)) {
    process.stderr.write(
      `${commandLabel}: world "${world}" is in use by process ${String(existingLock.pid)}. ` +
        `Stop the server first — reconciling or collecting assets while a live connection is ` +
        `writing to world.db can register or delete against a state that is about to change.\n`,
    );
    process.exit(1);
    return null;
  }

  let db;
  try {
    db = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(db.raw, dbPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${commandLabel}: cannot open world "${world}": ${msg}\n`);
    process.exit(1);
    return null;
  }

  const assetsDir = join(dataDir, "worlds", world, "assets");
  return { dataDir, db, assetsDir };
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printAssetsHelp(): void {
  process.stdout.write(
    `fusion assets — asset registry maintenance commands\n\n` +
      `USAGE:\n` +
      `  fusion assets reconcile --world <slug> [options]\n` +
      `  fusion assets gc --world <slug> [options]\n\n` +
      `Run 'fusion assets reconcile --help' or 'fusion assets gc --help' for details.\n`,
  );
}

export function printAssetsReconcileHelp(): void {
  process.stdout.write(
    `fusion assets reconcile — Report referenced/orphaned/broken assets for a world.\n\n` +
      `USAGE:\n` +
      `  fusion assets reconcile --world <slug> [options]\n\n` +
      `REQUIRED:\n` +
      `  --world <slug>          World slug. Must already exist.\n\n` +
      `OPTIONS:\n` +
      `  --data-dir <dir>        Override the data directory.\n` +
      `  --help, -h              Show this help\n\n` +
      `Scans assets/ on disk and every document table's raw JSON for /assets/<name>\n` +
      `references (no field-name list — see assets/reconcile.ts), classifying each on-disk\n` +
      `file as referenced, orphaned (unreferenced, older than the grace period), or too\n` +
      `recent to call orphaned; and every reference as pointing at an existing file or a\n` +
      `broken one. A reference that only matches case-insensitively (e.g. "Taverna.jpg" on\n` +
      `disk, "/assets/taverna.jpg" in the document) is reported as referenced, with a\n` +
      `separate case-mismatch warning — never as orphaned.\n\n` +
      `This command never deletes anything, but it is not read-only: opening the world\n` +
      `applies any pending schema migrations to world.db, resolving the data directory can\n` +
      `migrate its on-disk layout, and it backfills any missing 'assets' registry row for a\n` +
      `file already on disk (T022) — that backfill is the only write specific to assets.\n\n` +
      `Does not scan world backups: a backup taken after T024 keeps its own copy of every\n` +
      `asset it captured (see worlds/asset-backup.ts), so 'fusion assets gc' cannot break it.\n` +
      `A backup predating T024 has no such copy — check its documents before running gc if\n` +
      `one might be the only remaining reference to a file.\n\n` +
      `Use 'fusion assets gc' to remove what this report calls orphaned.\n`,
  );
}

export function printAssetsGcHelp(): void {
  process.stdout.write(
    `fusion assets gc — Delete orphaned assets for a world.\n\n` +
      `USAGE:\n` +
      `  fusion assets gc --world <slug> [options]\n\n` +
      `REQUIRED:\n` +
      `  --world <slug>                 World slug. Must already exist.\n\n` +
      `OPTIONS:\n` +
      `  --confirm-delete-count <N>     Actually delete. N must equal the orphan count from\n` +
      `                                 a prior dry run of this exact command — this proves\n` +
      `                                 you saw the list, it is not a --yes flag. Omit to\n` +
      `                                 preview only (the default; nothing is deleted).\n` +
      `  --data-dir <dir>                Override the data directory.\n` +
      `  --help, -h                      Show this help\n\n` +
      `Runs the same reconciliation as 'fusion assets reconcile' and deletes ONLY the files\n` +
      `it classifies as orphaned (unreferenced, older than the grace period) — never a\n` +
      `recently-unreferenced file, never a broken reference's target, never automatically\n` +
      `(T023). Deleting a file also removes its 'assets' registry row. Does not touch world\n` +
      `backups — see 'fusion assets reconcile --help' for what that does and does not protect.\n`,
  );
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

function printReconcileReport(report: AssetReconcileReport, world: string): void {
  process.stdout.write(`fusion assets reconcile — world "${world}"\n`);
  process.stdout.write(`  assets dir:  ${report.assetsDir}\n\n`);

  if (report.backfilled.length > 0) {
    process.stdout.write(
      `Registered ${String(report.backfilled.length)} pre-existing file(s) that had no ` +
        `registry row:\n`,
    );
    for (const name of report.backfilled) process.stdout.write(`  + ${name}\n`);
    process.stdout.write(`\n`);
  }

  process.stdout.write(`Referenced (${String(report.referenced.length)}):\n`);
  for (const r of report.referenced) {
    const from = r.references.map((ref) => `${ref.table}:${ref.documentId}`).join(", ");
    process.stdout.write(`  ${r.name}  (${from})\n`);
  }

  process.stdout.write(
    `\nOrphaned — no reference, safe to GC (${String(report.orphaned.length)}):\n`,
  );
  for (const o of report.orphaned) {
    process.stdout.write(
      `  ${o.name}  (${formatBytes(o.bytes)}, ${formatAge(report.scannedAt, o.createdAt)})\n`,
    );
  }

  process.stdout.write(
    `\nUnreferenced but recent — NOT a GC candidate (${String(report.recentUnreferenced.length)}):\n`,
  );
  for (const o of report.recentUnreferenced) {
    process.stdout.write(
      `  ${o.name}  (${formatBytes(o.bytes)}, ${formatAge(report.scannedAt, o.createdAt)})\n`,
    );
  }

  process.stdout.write(
    `\nBroken references — target missing on disk (${String(report.broken.length)}):\n`,
  );
  for (const b of report.broken) {
    const from = b.references.map((ref) => `${ref.table}:${ref.documentId}`).join(", ");
    process.stdout.write(`  ${b.storageName}  (referenced by ${from})\n`);
  }

  process.stdout.write(
    `\nCase mismatches — served anyway on a case-insensitive filesystem, worth renaming ` +
      `(${String(report.caseMismatches.length)}):\n`,
  );
  for (const c of report.caseMismatches) {
    const from = c.references.map((ref) => `${ref.table}:${ref.documentId}`).join(", ");
    process.stdout.write(`  ${c.diskName}  (referenced as "${c.referencedAs}" by ${from})\n`);
  }

  if (report.orphaned.length > 0) {
    process.stdout.write(
      `\nRun 'fusion assets gc --world ${world} --confirm-delete-count ` +
        `${String(report.orphaned.length)}' to delete the ${String(report.orphaned.length)} orphaned file(s) above.\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// fusion assets reconcile
// ---------------------------------------------------------------------------

function runAssetsReconcileCommand(argv: string[]): void {
  const args = [...argv];

  if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
    printAssetsReconcileHelp();
    return;
  }

  let world: string | undefined;
  let dataDirArg: string | undefined;
  try {
    world = consumeOption(args, "--world");
    dataDirArg = consumeOption(args, "--data-dir");
  } catch (err) {
    process.stderr.write(
      `fusion assets reconcile: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
    return;
  }

  if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
    printAssetsReconcileHelp();
    return;
  }

  if (args.length > 0) {
    process.stderr.write(`fusion assets reconcile: unrecognized argument(s): ${args.join(" ")}\n`);
    process.exit(1);
    return;
  }

  if (world === undefined) {
    process.stderr.write(`fusion assets reconcile: requires --world <slug>\n`);
    process.exit(1);
    return;
  }

  const opened = openWorldForAssetsCommand("fusion assets reconcile", world, dataDirArg);
  if (!opened) return;
  const { db, assetsDir } = opened;

  let report: AssetReconcileReport;
  try {
    report = reconcileAssets({ db: db.raw, assetsDir });
  } finally {
    db.close();
  }

  printReconcileReport(report, world);
}

// ---------------------------------------------------------------------------
// fusion assets gc
// ---------------------------------------------------------------------------

function runAssetsGcCommand(argv: string[]): void {
  const args = [...argv];

  if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
    printAssetsGcHelp();
    return;
  }

  let world: string | undefined;
  let confirmDeleteCountStr: string | undefined;
  let dataDirArg: string | undefined;
  try {
    world = consumeOption(args, "--world");
    confirmDeleteCountStr = consumeOption(args, "--confirm-delete-count");
    dataDirArg = consumeOption(args, "--data-dir");
  } catch (err) {
    process.stderr.write(`fusion assets gc: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
    return;
  }

  if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
    printAssetsGcHelp();
    return;
  }

  if (args.length > 0) {
    process.stderr.write(`fusion assets gc: unrecognized argument(s): ${args.join(" ")}\n`);
    process.exit(1);
    return;
  }

  if (world === undefined) {
    process.stderr.write(`fusion assets gc: requires --world <slug>\n`);
    process.exit(1);
    return;
  }

  let confirmDeleteCount: number | undefined;
  if (confirmDeleteCountStr !== undefined) {
    const n = Number(confirmDeleteCountStr);
    if (!Number.isInteger(n) || n < 0) {
      process.stderr.write(
        `fusion assets gc: --confirm-delete-count must be a non-negative integer, got ` +
          `"${confirmDeleteCountStr}"\n`,
      );
      process.exit(1);
      return;
    }
    confirmDeleteCount = n;
  }

  const opened = openWorldForAssetsCommand("fusion assets gc", world, dataDirArg);
  if (!opened) return;
  const { db, assetsDir } = opened;

  try {
    // Always re-derive the report fresh, right before acting — never trust
    // a count the caller remembers from an earlier process invocation.
    const report = reconcileAssets({ db: db.raw, assetsDir });

    if (confirmDeleteCount === undefined) {
      const result = runAssetGc({ db: db.raw, assetsDir, report, confirm: false });
      process.stdout.write(`fusion assets gc — world "${world}"\n`);
      process.stdout.write(`  orphaned candidates: ${String(result.candidates.length)}\n`);
      for (const name of result.candidates) process.stdout.write(`    ${name}\n`);
      if (result.candidates.length === 0) {
        process.stdout.write(`\nNothing to delete.\n`);
      } else {
        process.stdout.write(
          `\nDRY RUN — nothing was deleted. Re-run with --confirm-delete-count ` +
            `${String(result.candidates.length)} to delete these files.\n`,
        );
      }
      return;
    }

    const currentCount = report.orphaned.length;
    if (confirmDeleteCount !== currentCount) {
      process.stderr.write(
        `fusion assets gc: --confirm-delete-count ${String(confirmDeleteCount)} does not match ` +
          `the current orphan count (${String(currentCount)}) — refusing. Re-run without ` +
          `--confirm-delete-count to see the current list, then repeat its exact count to ` +
          `prove you saw it.\n`,
      );
      process.exit(1);
      return;
    }

    const result = runAssetGc({ db: db.raw, assetsDir, report, confirm: true });
    process.stdout.write(`fusion assets gc — world "${world}"\n`);
    process.stdout.write(`  deleted: ${String(result.deleted.length)}\n`);
    for (const name of result.deleted) process.stdout.write(`    - ${name}\n`);
    if (result.failed.length > 0) {
      process.stdout.write(`  failed:  ${String(result.failed.length)}\n`);
      for (const f of result.failed) process.stdout.write(`    ! ${f.name}: ${f.error}\n`);
    }
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// fusion assets …
// ---------------------------------------------------------------------------

export function runAssetsCommand(argv: string[]): void {
  const args = [...argv];
  const subcommand = args.shift();

  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    printAssetsHelp();
    return;
  }

  if (subcommand === "reconcile") {
    runAssetsReconcileCommand(args);
    return;
  }

  if (subcommand === "gc") {
    runAssetsGcCommand(args);
    return;
  }

  process.stderr.write(
    `fusion assets: unknown subcommand "${subcommand}". Try: fusion assets reconcile | gc\n`,
  );
  process.exit(1);
}
