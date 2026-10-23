/**
 * CLI commands: fusion chat archive <world> --from <date> --to <date> …
 *
 * T019 (D5) — the ONLY sanctioned way to remove chat rows: export a closed
 * range, verify the export, and only then delete. See
 * ../../chat/archive.ts for the full write-up of why each step exists; this
 * file is deliberately thin — argument parsing, world/data-dir resolution,
 * and console I/O only. It has its own tiny arg parser (mirroring the
 * `consumeOption`/`consumeFlag` helpers in ../args.ts) rather than extending
 * the shared parser there, since `chat` is dispatched by ../index.ts before
 * args.ts's parseArgs() ever runs.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { openDatabase, applyMigrations } from "../../db/index.js";
import { readLock, isProcessAlive, lockPath } from "../../worlds/world-manager.js";
import { resolveDataDirForLoad } from "../../config.js";
import { ensureDataDirLayout } from "../../data-dir.js";
import { createLogger } from "../../logger.js";
import {
  buildArchiveRange,
  runChatArchive,
  ArchiveConfirmationMismatchError,
  ArchiveExportError,
} from "../../chat/archive.js";
import type { ArchiveRange, ArchiveRunOptions, ArchiveRunResult } from "../../chat/archive.js";

// ---------------------------------------------------------------------------
// Helpers (mirrors worlds.ts / users.ts — see their docstrings)
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

function defaultExportPath(dataDir: string, world: string, range: ArchiveRange): string {
  const stampPart = (ms: number): string => new Date(ms).toISOString().replace(/[:.]/g, "-");
  const stamp = stampPart(Date.now());
  return join(
    dataDir,
    "worlds",
    world,
    "chat-archives",
    `chat-${world}-${stampPart(range.fromMs)}_${stampPart(range.toMs)}-${stamp}.jsonl`,
  );
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printChatHelp(): void {
  process.stdout.write(
    `fusion chat — chat maintenance commands\n\n` +
      `USAGE:\n  fusion chat archive --world <slug> --from <date> --to <date> [options]\n\n` +
      `Run 'fusion chat archive --help' for details.\n`,
  );
}

export function printChatArchiveHelp(): void {
  process.stdout.write(
    `fusion chat archive — Export a closed range of chat messages, then delete it.\n\n` +
      `USAGE:\n` +
      `  fusion chat archive --world <slug> --from <date> --to <date> [options]\n\n` +
      `REQUIRED:\n` +
      `  --world <slug>               World slug. Must already exist.\n` +
      `  --from <date>                 Range start, inclusive (YYYY-MM-DD or full ISO-8601).\n` +
      `  --to <date>                   Range end, inclusive (YYYY-MM-DD or full ISO-8601).\n\n` +
      `OPTIONS:\n` +
      `  --out <path>                  Export file (.jsonl). Defaults under\n` +
      `                                 <data-dir>/worlds/<slug>/chat-archives/.\n` +
      `  --confirm-delete-count <N>    Actually export and delete. N must equal the\n` +
      `                                 message count from a prior dry run of this exact\n` +
      `                                 command — this proves you saw the count, it is not\n` +
      `                                 a --yes flag. Omit to preview only (the default;\n` +
      `                                 nothing is exported or removed).\n` +
      `  --data-dir <dir>               Override the data directory.\n\n` +
      `Chat is never deleted automatically (D5). Every run previews first; messages are\n` +
      `only exported and removed once --confirm-delete-count matches the current count\n` +
      `exactly, and only after the export has been written, re-read from disk, and\n` +
      `verified field-by-field against what is about to be deleted.\n`,
  );
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printResult(result: ArchiveRunResult, world: string, requestedOutPath: string): void {
  const { preview } = result;
  process.stdout.write(`fusion chat archive — world "${world}"\n`);
  process.stdout.write(
    `  requested range:  ${new Date(preview.range.fromMs).toISOString()} .. ${new Date(preview.range.toMs).toISOString()}\n`,
  );
  process.stdout.write(`  messages matched: ${String(preview.count)}\n`);
  if (preview.count > 0) {
    process.stdout.write(
      `  actual period:    ${new Date(preview.actualFromMs as number).toISOString()} .. ${new Date(preview.actualToMs as number).toISOString()}\n`,
    );
  }

  if (!result.executed) {
    process.stdout.write(`  export target:    ${requestedOutPath}\n`);
    process.stdout.write(
      `\nDry run — nothing was exported or deleted. Re-run with ` +
        `--confirm-delete-count ${String(preview.count)} to export and delete these messages.\n`,
    );
    return;
  }

  if (result.deletedCount === 0) {
    process.stdout.write(`\nNo messages in range — nothing exported or deleted.\n`);
    return;
  }

  process.stdout.write(`  exported to:      ${result.exportPath ?? "?"}\n`);
  process.stdout.write(`\n${String(result.deletedCount)} message(s) exported and removed.\n`);
}

// ---------------------------------------------------------------------------
// fusion chat archive
// ---------------------------------------------------------------------------

function runChatArchiveCommand(argv: string[]): void {
  const args = [...argv];

  if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
    printChatArchiveHelp();
    return;
  }

  let world: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  let out: string | undefined;
  let confirmDeleteCountStr: string | undefined;
  let dataDirArg: string | undefined;

  try {
    world = consumeOption(args, "--world");
    from = consumeOption(args, "--from");
    to = consumeOption(args, "--to");
    out = consumeOption(args, "--out");
    confirmDeleteCountStr = consumeOption(args, "--confirm-delete-count");
    dataDirArg = consumeOption(args, "--data-dir");
  } catch (err) {
    process.stderr.write(
      `fusion chat archive: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
    return;
  }

  if (consumeFlag(args, "--help") || consumeFlag(args, "-h")) {
    printChatArchiveHelp();
    return;
  }

  if (args.length > 0) {
    process.stderr.write(`fusion chat archive: unrecognized argument(s): ${args.join(" ")}\n`);
    process.exit(1);
    return;
  }

  if (world === undefined || from === undefined || to === undefined) {
    process.stderr.write(
      `fusion chat archive: requires --world <slug> --from <date> --to <date>\n`,
    );
    process.exit(1);
    return;
  }

  let range: ArchiveRange;
  try {
    range = buildArchiveRange(from, to);
  } catch (err) {
    process.stderr.write(
      `fusion chat archive: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
    return;
  }

  let confirmDeleteCount: number | undefined;
  if (confirmDeleteCountStr !== undefined) {
    const n = Number(confirmDeleteCountStr);
    if (!Number.isInteger(n) || n < 0) {
      process.stderr.write(
        `fusion chat archive: --confirm-delete-count must be a non-negative integer, got "${confirmDeleteCountStr}"\n`,
      );
      process.exit(1);
      return;
    }
    confirmDeleteCount = n;
  }

  const dataDir = resolveDataDir(dataDirArg);
  const dbPath = join(dataDir, "worlds", world, "world.db");

  // Destructive command: never silently create a world the caller merely
  // mistyped. better-sqlite3's default `fileMustExist: false` would happily
  // create a fresh empty world.db here otherwise.
  if (!existsSync(dbPath)) {
    process.stderr.write(
      `fusion chat archive: world "${world}" not found at ${dbPath} — refusing to create ` +
        `one implicitly for a destructive command.\n`,
    );
    process.exit(1);
    return;
  }

  // A running server is writing to this world right now: rows can be edited
  // between the snapshot that feeds the export and the delete that follows it,
  // and the archived copy would then be the stale one. `world delete` already
  // refuses on a live lock — same predicate here, not a second one.
  const existingLock = readLock(lockPath(dataDir, world));
  if (existingLock !== null && isProcessAlive(existingLock.pid)) {
    process.stderr.write(
      `fusion chat archive: world "${world}" is in use by process ${String(existingLock.pid)}. ` +
        `Stop the server before archiving chat — archiving a world that is being written to can ` +
        `export one version of a message and delete another.\n`,
    );
    process.exit(1);
    return;
  }

  const outPath = out ?? defaultExportPath(dataDir, world, range);

  // Only auto-create the directory for OUR OWN default path. A user-supplied
  // --out is taken literally: a mistyped/nonexistent directory must fail
  // loudly (archive.ts refuses to write into it), never quietly grow a new
  // directory tree from a typo.
  if (out === undefined) {
    mkdirSync(dirname(outPath), { recursive: true });
  }

  let fusionDb;
  try {
    fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fusion chat archive: cannot open world "${world}": ${msg}\n`);
    process.exit(1);
    return;
  }

  let result: ArchiveRunResult;
  try {
    const opts: ArchiveRunOptions = { db: fusionDb.raw, range, outPath };
    if (confirmDeleteCount !== undefined) opts.confirmDeleteCount = confirmDeleteCount;
    result = runChatArchive(opts);
  } catch (err) {
    fusionDb.close();
    if (err instanceof ArchiveConfirmationMismatchError) {
      process.stderr.write(`fusion chat archive: ${err.message}\n`);
    } else if (err instanceof ArchiveExportError) {
      process.stderr.write(
        `fusion chat archive: export failed — nothing was deleted. ${err.message}\n`,
      );
    } else {
      process.stderr.write(
        `fusion chat archive: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    process.exit(1);
    return;
  }

  fusionDb.close();
  printResult(result, world, outPath);
}

// ---------------------------------------------------------------------------
// fusion chat …
// ---------------------------------------------------------------------------

export function runChatCommand(argv: string[]): void {
  const args = [...argv];
  const subcommand = args.shift();

  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    printChatHelp();
    return;
  }

  if (subcommand === "archive") {
    runChatArchiveCommand(args);
    return;
  }

  process.stderr.write(
    `fusion chat: unknown subcommand "${subcommand}". Try: fusion chat archive\n`,
  );
  process.exit(1);
}
