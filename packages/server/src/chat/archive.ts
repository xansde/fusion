/**
 * Manual chat archiving (T019, D5) — export a closed timestamp range of
 * `chat_messages`, verify the export, and only then delete that exact range.
 *
 * D5 draws a hard line: chat is the table's memory and NEVER disappears on
 * its own. This module is the one sanctioned way chat rows leave the
 * database at all, and every step exists to make deletion the very last
 * thing that can happen, never the first:
 *
 *   1. Fetch the rows in range (a fixed id list — later inserts in the same
 *      range during export are never touched by the delete below).
 *   2. Refuse to proceed unless the caller's `confirmDeleteCount` equals the
 *      row count computed THIS run — not a stale count from an earlier
 *      preview. A `--confirm-delete-count N` flag says what is about to
 *      happen and cannot be typed by accident the way a bare `--yes` can.
 *   3. Export every row to a JSON Lines file, refusing to silently overwrite
 *      an existing file (`wx` open flag) or write into a directory that does
 *      not exist (no auto-mkdir here — see cli/commands/chat.ts for where
 *      that policy choice is made instead).
 *   4. fsync the export, close it, re-read it from disk, and compare it
 *      field-by-field against the rows that are about to be deleted. Only a
 *      verified export unlocks the delete.
 *   5. Delete exactly the id list from step 1, in one transaction.
 *
 * If ANY step from 2 onward throws, nothing below it runs — the database is
 * untouched. Export format is deliberately plain: one JSON object per line
 * carrying the raw `chat_messages` row (id, the message's `data` JSON text
 * verbatim, timestamp, author, created_at, updated_at). A raw DB row is
 * honest and losslessly reconstructable a year from now; a "prettified"
 * export shape is one more transform that can silently drop a field.
 */

import { closeSync, fsyncSync, openSync, readFileSync, writeSync, unlinkSync } from "node:fs";
import type { Database as Db } from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A `chat_messages` row exactly as stored — see migration 001_initial_schema.ts. */
export interface ChatMessageRow {
  id: string;
  /** The persisted ChatMessage document, as raw JSON text — never re-parsed for export. */
  data: string;
  timestamp: number;
  authorId: string;
  createdAt: number;
  updatedAt: number;
}

/** A closed (inclusive on both ends) timestamp range, in epoch ms. */
export interface ArchiveRange {
  fromMs: number;
  toMs: number;
}

export interface ArchivePreview {
  range: ArchiveRange;
  /** Number of messages currently in `range`. */
  count: number;
  /** Earliest matched timestamp, or null when `count` is 0. */
  actualFromMs: number | null;
  /** Latest matched timestamp, or null when `count` is 0. */
  actualToMs: number | null;
}

interface ArchiveMetaLine {
  kind: "meta";
  exportedAt: number;
  range: ArchiveRange;
  count: number;
}

interface ArchiveMessageLine {
  kind: "message";
  row: ChatMessageRow;
}

type ArchiveLine = ArchiveMetaLine | ArchiveMessageLine;

export interface ArchiveRunOptions {
  db: Db;
  range: ArchiveRange;
  /** Where the JSON Lines export is written when `confirmDeleteCount` is given. */
  outPath: string;
  /**
   * Must equal the message count for `range` at the moment this function
   * runs. Omit for a dry run: preview only, nothing exported or deleted.
   */
  confirmDeleteCount?: number;
}

export interface ArchiveRunResult {
  preview: ArchivePreview;
  /** False for a dry run (no `confirmDeleteCount`); true once export+delete actually ran. */
  executed: boolean;
  deletedCount: number;
  exportPath: string | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ArchiveRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveRangeError";
  }
}

export class ArchiveExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveExportError";
  }
}

export class ArchiveConfirmationMismatchError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      `--confirm-delete-count ${String(expected)} does not match the ${String(actual)} ` +
        `message(s) currently in range. Re-run without confirmation to see the current ` +
        `count, then confirm again with that number.`,
    );
    this.name = "ArchiveConfirmationMismatchError";
  }
}

// ---------------------------------------------------------------------------
// Range parsing — YYYY-MM-DD or full ISO-8601, always interpreted as UTC
// ---------------------------------------------------------------------------

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse one range boundary. A bare `YYYY-MM-DD` is expanded to the start
 * (00:00:00.000) or end (23:59:59.999) of that UTC calendar day so a
 * date-only `--from`/`--to` covers the whole day rather than only its first
 * instant. A full ISO-8601 timestamp is used as-is (via `Date.parse`).
 */
export function parseArchiveBoundary(input: string, edge: "start" | "end"): number {
  const iso = DATE_ONLY_RE.test(input)
    ? `${input}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`
    : input;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new ArchiveRangeError(
      `invalid date/time "${input}" — use YYYY-MM-DD or a full ISO-8601 timestamp.`,
    );
  }
  return ms;
}

/** Build a validated closed range from CLI-style `--from`/`--to` strings. */
export function buildArchiveRange(fromInput: string, toInput: string): ArchiveRange {
  const fromMs = parseArchiveBoundary(fromInput, "start");
  const toMs = parseArchiveBoundary(toInput, "end");
  if (fromMs > toMs) {
    throw new ArchiveRangeError(
      `--from (${fromInput}) is after --to (${toInput}) — the range must be non-empty.`,
    );
  }
  return { fromMs, toMs };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function fetchRowsInRange(db: Db, range: ArchiveRange): ChatMessageRow[] {
  return db
    .prepare(
      `SELECT id, data, timestamp,
              author_id  AS authorId,
              created_at AS createdAt,
              updated_at AS updatedAt
         FROM chat_messages
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC, id ASC`,
    )
    .all(range.fromMs, range.toMs) as ChatMessageRow[];
}

function buildPreview(range: ArchiveRange, rows: readonly ChatMessageRow[]): ArchivePreview {
  return {
    range,
    count: rows.length,
    actualFromMs: rows.length > 0 ? (rows[0] as ChatMessageRow).timestamp : null,
    actualToMs: rows.length > 0 ? (rows[rows.length - 1] as ChatMessageRow).timestamp : null,
  };
}

/** Count + actual period covered by `range`, without exporting or deleting anything. */
export function previewArchiveRange(db: Db, range: ArchiveRange): ArchivePreview {
  return buildPreview(range, fetchRowsInRange(db, range));
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Write `rows` to `outPath` as JSON Lines (one meta header line, then one
 * message line per row), fsync it, then re-read the file and require it to
 * match byte-for-byte what was written — a `write()` call returning success
 * does not prove the bytes survived; the re-read does.
 *
 * Opens with the `wx` flag: refuses to overwrite an existing file (a stale
 * archive at the same path is a bug, never something to silently clobber)
 * and does NOT create missing parent directories (a mistyped `--out`
 * directory must fail loudly, not quietly grow a new directory tree).
 */
export function exportChatRows(
  rows: readonly ChatMessageRow[],
  range: ArchiveRange,
  outPath: string,
): void {
  const meta: ArchiveMetaLine = { kind: "meta", exportedAt: Date.now(), range, count: rows.length };
  const lines = [
    JSON.stringify(meta),
    ...rows.map((row) => JSON.stringify({ kind: "message", row } satisfies ArchiveMessageLine)),
  ];
  const content = lines.join("\n") + "\n";

  let fd: number;
  try {
    fd = openSync(outPath, "wx");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new ArchiveExportError(
        `export file already exists, refusing to overwrite it: ${outPath}`,
      );
    }
    throw new ArchiveExportError(
      `could not create export file at ${outPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Everything past the open is also an export failure, and has to be reported
  // as one: the caller's whole contract is "an ArchiveExportError means the
  // database was not touched". A raw ENOSPC escaping from here would drop the
  // operator into a generic crash and leave them wondering whether their chat
  // survived. And whatever we managed to create gets removed — `wx` proves the
  // file is ours, so a zero-byte leftover would only block the retry and, worse,
  // pass for a real archive in a directory listing a year from now.
  const failExport = (message: string): never => {
    try {
      unlinkSync(outPath);
    } catch {
      /* the partial file is not removable; the message below is what matters */
    }
    throw new ArchiveExportError(message);
  };

  try {
    try {
      writeSync(fd, content, null, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    failExport(
      `could not write the export at ${outPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let reread: string;
  try {
    reread = readFileSync(outPath, "utf8");
  } catch (err) {
    return failExport(
      `could not read the export back from ${outPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (reread !== content) {
    failExport(
      `export verification failed for ${outPath}: content read back does not match what was written`,
    );
  }
}

/** Read back an export written by {@link exportChatRows}. */
export function readArchiveFile(path: string): { meta: ArchiveMetaLine; rows: ChatMessageRow[] } {
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new ArchiveExportError(`archive file is empty: ${path}`);
  }

  const first = JSON.parse(lines[0] as string) as ArchiveLine;
  if (first.kind !== "meta") {
    throw new ArchiveExportError(`archive file is missing its meta header: ${path}`);
  }

  const rows: ChatMessageRow[] = [];
  for (const line of lines.slice(1)) {
    const parsed = JSON.parse(line) as ArchiveLine;
    if (parsed.kind !== "message") {
      throw new ArchiveExportError(
        `archive file has a malformed line (expected "message"): ${path}`,
      );
    }
    rows.push(parsed.row);
  }

  return { meta: first, rows };
}

function assertRowsMatch(
  expected: readonly ChatMessageRow[],
  actual: readonly ChatMessageRow[],
  path: string,
): void {
  if (expected.length !== actual.length) {
    throw new ArchiveExportError(
      `export verification failed for ${path}: expected ${String(expected.length)} row(s), read back ${String(actual.length)}`,
    );
  }
  for (let i = 0; i < expected.length; i += 1) {
    const e = expected[i] as ChatMessageRow;
    const a = actual[i] as ChatMessageRow;
    const same =
      e.id === a.id &&
      e.data === a.data &&
      e.timestamp === a.timestamp &&
      e.authorId === a.authorId &&
      e.createdAt === a.createdAt &&
      e.updatedAt === a.updatedAt;
    if (!same) {
      throw new ArchiveExportError(
        `export verification failed for ${path}: row ${String(i)} (id=${e.id}) does not match what was read back`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Delete exactly the given ids from `chat_messages`, in one transaction. */
export function deleteChatRowsByIds(db: Db, rows: readonly ChatMessageRow[]): number {
  if (rows.length === 0) return 0;
  // Delete a row only if it still looks exactly like the copy that went into
  // the export. The archive is built from a snapshot taken before the file was
  // written; a row edited in between would be archived in its old form and
  // deleted in its new one, and the edit would be gone with no copy anywhere.
  // Matching on `updated_at` and `data` makes that impossible: a changed row
  // simply is not deleted, and the count the caller reports is the real one.
  const del = db.prepare(`DELETE FROM chat_messages WHERE id = ? AND updated_at = ? AND data = ?`);
  const run = db.transaction((): number => {
    let removed = 0;
    for (const row of rows) {
      removed += del.run(row.id, row.updatedAt, row.data).changes;
    }
    return removed;
  });
  return run.immediate();
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full archive flow described in the module docstring.
 *
 * Without `confirmDeleteCount`: pure preview, nothing touched.
 * With it: throws {@link ArchiveConfirmationMismatchError} unless it equals
 * the row count computed by THIS call (never a cached count from an earlier
 * preview), then exports, verifies, and only then deletes.
 */
export function runChatArchive(opts: ArchiveRunOptions): ArchiveRunResult {
  const rows = fetchRowsInRange(opts.db, opts.range);
  const preview = buildPreview(opts.range, rows);

  if (opts.confirmDeleteCount === undefined) {
    return { preview, executed: false, deletedCount: 0, exportPath: null };
  }

  if (opts.confirmDeleteCount !== preview.count) {
    throw new ArchiveConfirmationMismatchError(opts.confirmDeleteCount, preview.count);
  }

  if (rows.length === 0) {
    // An empty range confirmed with --confirm-delete-count 0 is a legitimate
    // no-op, not an error — there is nothing to export or delete.
    return { preview, executed: true, deletedCount: 0, exportPath: null };
  }

  exportChatRows(rows, opts.range, opts.outPath);
  const { rows: reread } = readArchiveFile(opts.outPath);
  assertRowsMatch(rows, reread, opts.outPath);

  const deletedCount = deleteChatRowsByIds(opts.db, rows);

  return { preview, executed: true, deletedCount, exportPath: opts.outPath };
}
