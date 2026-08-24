/**
 * CLI commands: fusion world list | create | backup | restore
 *
 * `restore` (T024 review fix — "nenhum caminho de produto chega ao
 * restore") deliberately owns its own tiny arg parser below, the same way
 * `chat archive` does in ../commands/chat.ts, rather than extending the
 * shared parser in ../args.ts: it is dispatched directly from ../index.ts
 * before args.ts's parseArgs() ever runs (see index.ts's `world restore`
 * special case, mirroring its existing `chat` one), which keeps this
 * destructive command's own preview/confirm flow out of the generic
 * world:list/create/backup shape args.ts otherwise owns.
 */

import { join } from "node:path";
import type { WorldListArgs, WorldCreateArgs, WorldBackupArgs } from "../args.js";
import {
  WorldManager,
  readAssetManifest,
  CorruptedAssetManifestError,
} from "../../worlds/index.js";
import { readLock, isProcessAlive, lockPath } from "../../worlds/world-manager.js";
import { SystemRegistry } from "@fusion/system-api";
import { openDatabase, applyMigrations } from "../../db/index.js";
import { AuthService, loadOrCreateSecret } from "../../auth/index.js";
import { resolveDataDirForLoad } from "../../config.js";
import { ensureDataDirLayout } from "../../data-dir.js";
import { createLogger } from "../../logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective data directory (explicit --data-dir/FUSION_DATA_DIR,
 * or the per-OS default with legacy ~/.fusion read-fallback — REQ-DST-008)
 * and ensure the REQ-DST-007 tree/Config migration is in place.
 *
 * A logger is passed to ensureDataDirLayout so the legacy-fallback warning
 * AND the data-dir migration log (data-dir.ts, logged at "info") both
 * surface instead of being silently discarded — this CLI path has no
 * long-lived server logger to reuse, so a fresh minimal logger is created
 * just for this call. "info" (not "warn") is required so the one-time
 * migration message is not swallowed.
 */
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

/**
 * Simple table renderer.
 * Computes column widths from headers + rows, then prints padded rows.
 */
function printTable(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => {
      const cell = row[i] ?? "";
      return Math.max(max, cell.length);
    }, 0);
    return Math.max(h.length, maxRow);
  });

  const separator = colWidths.map((w) => "-".repeat(w)).join("  ");

  const formatRow = (cells: string[]): string =>
    cells
      .map((cell, i) => cell.padEnd(colWidths[i] ?? 0))
      .join("  ")
      .trimEnd();

  process.stdout.write(formatRow(headers) + "\n");
  process.stdout.write(separator + "\n");
  for (const row of rows) {
    process.stdout.write(formatRow(row) + "\n");
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function runWorldList(args: WorldListArgs): void {
  const dataDir = resolveDataDir(args.dataDir);
  const manager = new WorldManager({ dataDir });

  let worlds;
  try {
    worlds = manager.list();
  } catch (err) {
    process.stderr.write(`fusion world list: error reading worlds: ${String(err)}\n`);
    process.exit(1);
  }

  if (worlds.length === 0) {
    process.stdout.write("No worlds found.\n");
    process.stdout.write(`Data directory: ${dataDir}\n`);
    return;
  }

  const headers = ["SLUG", "TITLE", "SYSTEM", "SCHEMA"];
  const rows = worlds.map((w) => [w.id, w.title, w.system, String(w.schemaVersion)]);
  printTable(headers, rows);
  process.stdout.write(`\n${String(worlds.length)} world(s) — data directory: ${dataDir}\n`);
}

export async function runWorldCreate(args: WorldCreateArgs): Promise<void> {
  const dataDir = resolveDataDir(args.dataDir);

  // Build a registry with the stub and pf2e systems registered so validation works.
  const registry = new SystemRegistry();
  try {
    const { stubSystem } = await import("@fusion/system-stub");
    registry.register(stubSystem);
  } catch {
    // stub not available
  }
  try {
    const { pf2eSystem } = await import("@fusion/system-pf2e");
    registry.register(pf2eSystem);
  } catch {
    // pf2e not available
  }
  try {
    const { sf2eSystem } = await import("@fusion/system-sf2e");
    registry.register(sf2eSystem);
  } catch {
    // sf2e not available
  }

  const manager = new WorldManager({ dataDir, validSystemIds: registry });

  let manifest;
  try {
    manifest = manager.create({
      slug: args.slug,
      system: args.system,
      title: args.title ?? args.slug,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fusion world create: ${msg}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `World created successfully.\n` +
      `  slug:    ${manifest.id}\n` +
      `  title:   ${manifest.title}\n` +
      `  system:  ${manifest.system}\n` +
      `  dataDir: ${dataDir}\n`,
  );

  // Bootstrap GM user (REQ-USR spec: world create creates the GAMEMASTER user)
  const dbPath = join(dataDir, "worlds", manifest.id, "world.db");
  let fusionDb;
  try {
    fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);

    const secret = loadOrCreateSecret(dataDir);
    const authService = new AuthService(fusionDb.raw, secret, manifest.id);

    const { user, password } = await authService.bootstrapGm(
      args.gmPassword !== undefined ? { password: args.gmPassword } : undefined,
    );

    if (args.gmPassword !== undefined) {
      process.stdout.write(
        `\n  GM user "${user.name}" created (password set via --gm-password).\n` +
          // Machine-parseable line for tooling (M6/B3 smoke-release.mjs parses
          // this to log in and open a socket.io session without needing a
          // separate DB read) — deliberately only emitted in the
          // --gm-password branch, since that is the only case where the
          // caller already knows the plaintext password and can actually use
          // this id to authenticate.
          `  gmUserId: ${user.id}\n`,
      );
    } else {
      process.stdout.write(
        `\n  GM user "${user.name}" created.\n` +
          `  *** GM PASSWORD (shown once): ${password} ***\n` +
          `  Store this password securely — it will not be shown again.\n`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fusion world create: warning — could not create GM user: ${msg}\n`);
  } finally {
    try {
      fusionDb?.close();
    } catch {
      // best-effort
    }
  }
}

export async function runWorldBackup(args: WorldBackupArgs): Promise<void> {
  const dataDir = resolveDataDir(args.dataDir);
  const manager = new WorldManager({ dataDir });

  let entry;
  try {
    entry = await manager.backup(args.slug, "manual");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fusion world backup: ${msg}\n`);
    process.exit(1);
  }

  const sizeMb = (entry.sizeBytes / 1024 / 1024).toFixed(2);
  process.stdout.write(
    `Backup created successfully.\n` +
      `  file:    ${entry.filename}\n` +
      `  size:    ${sizeMb} MB\n` +
      `  path:    ${entry.path}\n`,
  );
}

// ---------------------------------------------------------------------------
// fusion world restore — own sub-parser (see this file's header comment)
// ---------------------------------------------------------------------------

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

export function printWorldRestoreHelp(): void {
  process.stdout.write(
    `fusion world restore — Restore a world's database (and captured assets) from a backup\n\n` +
      `USAGE:\n  fusion world restore <slug> --backup <filename> [options]\n\n` +
      `ARGUMENTS:\n` +
      `  <slug>                          World slug to restore.\n\n` +
      `OPTIONS:\n` +
      `  --backup <filename>             Backup file to restore from — one of the .db files\n` +
      `                                  under <data-dir>/worlds/<slug>/backups/.\n` +
      `  --confirm-restore <filename>    Actually perform the restore. Must repeat the exact\n` +
      `                                  filename passed to --backup — this proves you saw\n` +
      `                                  the preview, it is not a --yes flag. Omit to preview\n` +
      `                                  only (the default; nothing is changed).\n` +
      `  --data-dir <dir>                Override the data directory.\n` +
      `  --help, -h                      Show this help\n\n` +
      `DESTRUCTIVE: this replaces the world's current world.db with the chosen backup and\n` +
      `merges its captured assets (if any) back into assets/ (existing files not in the\n` +
      `backup are left alone — see restoreAssets in asset-backup.ts). Refuses if the world\n` +
      `is currently open or locked by another process — stop the server first, restoring a\n` +
      `world.db out from under a live connection corrupts state instead of restoring it. A\n` +
      `safety-net "pre-restore" backup of the CURRENT state is always taken first, so an\n` +
      `accidental restore is itself recoverable via another 'fusion world restore'.\n\n` +
      `EXAMPLES:\n` +
      `  fusion world restore my_world --backup manual-1717000000000.db\n` +
      `  fusion world restore my_world --backup manual-1717000000000.db \\\n` +
      `      --confirm-restore manual-1717000000000.db\n`,
  );
}

export async function runWorldRestoreCommand(argv: string[]): Promise<void> {
  const args = [...argv];

  if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
    printWorldRestoreHelp();
    return;
  }

  const slug = args.shift();
  if (slug === undefined || slug.startsWith("--")) {
    process.stderr.write(
      "fusion world restore: requires a slug argument: fusion world restore <slug> --backup <filename>\n",
    );
    process.exit(1);
    return;
  }

  let backupFilename: string | undefined;
  let confirmFilename: string | undefined;
  let dataDirArg: string | undefined;
  try {
    backupFilename = consumeOption(args, "--backup");
    confirmFilename = consumeOption(args, "--confirm-restore");
    dataDirArg = consumeOption(args, "--data-dir");
  } catch (err) {
    process.stderr.write(
      `fusion world restore: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
    return;
  }

  if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
    printWorldRestoreHelp();
    return;
  }

  if (args.length > 0) {
    process.stderr.write(`fusion world restore: unrecognized argument(s): ${args.join(" ")}\n`);
    process.exit(1);
    return;
  }

  if (backupFilename === undefined) {
    process.stderr.write("fusion world restore: requires --backup <filename>\n");
    process.exit(1);
    return;
  }

  const dataDir = resolveDataDir(dataDirArg);

  // Refuse up front on a live lock — same predicate WorldManager.restoreBackup
  // enforces, surfaced here BEFORE the preview so a locked world never gets a
  // "here's what would happen" printout implying the restore is actionable.
  const existingLock = readLock(lockPath(dataDir, slug));
  if (existingLock !== null && isProcessAlive(existingLock.pid)) {
    process.stderr.write(
      `fusion world restore: world "${slug}" is in use by process ${String(existingLock.pid)}. ` +
        `Stop the server before restoring — restoring a world.db out from under a live ` +
        `connection corrupts state instead of restoring it.\n`,
    );
    process.exit(1);
    return;
  }

  const manager = new WorldManager({ dataDir });

  let backups;
  try {
    backups = manager.listBackups(slug);
  } catch (err) {
    process.stderr.write(
      `fusion world restore: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
    return;
  }

  const entry = backups.find((b) => b.filename === backupFilename);
  if (!entry) {
    process.stderr.write(
      `fusion world restore: backup "${backupFilename}" not found for world "${slug}" — ` +
        `check the .db files under <data-dir>/worlds/${slug}/backups/.\n`,
    );
    process.exit(1);
    return;
  }

  const sizeMb = (entry.sizeBytes / 1024 / 1024).toFixed(2);

  if (confirmFilename === undefined) {
    // Preview: read the manifest the same way restoreBackup will — this also
    // surfaces a corrupted manifest (T024 review fix) during the dry run,
    // not just at execution time.
    let manifest;
    try {
      manifest = readAssetManifest(entry.path);
    } catch (err) {
      const msg = err instanceof CorruptedAssetManifestError ? err.message : String(err);
      process.stderr.write(`fusion world restore: ${msg}\n`);
      process.exit(1);
      return;
    }

    const assetsLine =
      manifest !== null
        ? `${String(manifest.files.length)} file(s) will be merged into assets/`
        : "none captured — only world.db will be restored";

    process.stdout.write(
      `fusion world restore — world "${slug}"\n` +
        `  backup:  ${entry.filename} (${entry.type}, ${sizeMb} MB)\n` +
        `  assets:  ${assetsLine}\n` +
        `\nDRY RUN — nothing was changed. This will overwrite the current world.db ` +
        `(a pre-restore safety backup of the current state is always taken first). ` +
        `Re-run with --confirm-restore ${entry.filename} to execute.\n`,
    );
    return;
  }

  if (confirmFilename !== entry.filename) {
    process.stderr.write(
      `fusion world restore: --confirm-restore "${confirmFilename}" does not match ` +
        `--backup "${entry.filename}" — refusing. Repeat the exact backup filename to ` +
        `prove you saw the preview.\n`,
    );
    process.exit(1);
    return;
  }

  let result;
  try {
    result = await manager.restoreBackup(slug, entry.filename);
  } catch (err) {
    process.stderr.write(
      `fusion world restore: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
    return;
  }

  const safetyLine =
    result.preRestoreBackup !== null
      ? `  safety backup: ${result.preRestoreBackup.filename} (restore this to undo)\n`
      : "";

  process.stdout.write(
    `World "${slug}" restored from "${result.restoredFrom.filename}".\n` +
      `  assets restored: ${result.assetsRestored ? "yes" : "no (backup had no asset manifest)"}\n` +
      safetyLine,
  );
}
