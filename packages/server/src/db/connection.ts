/**
 * SQLite connection wrapper for @fusion/server.
 *
 * Opens a better-sqlite3 database with all required PRAGMAs (REQ-PER-004, DEC-PER-04),
 * runs PRAGMA integrity_check on open (REQ-PER-005, REQ-PER-038),
 * and performs WAL checkpoint on close (DEC-PER-06 — question 10 answer).
 *
 * API is intentionally synchronous — better-sqlite3 is sync by design and
 * the server uses a single-writer model (REQ-PER-017).
 */

import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import { existsSync, statSync } from "node:fs";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class DatabaseCorruptionError extends Error {
  constructor(
    public readonly path: string,
    public readonly integrityResult: string,
  ) {
    super(`SQLite integrity_check failed for "${path}": ${integrityResult.slice(0, 200)}`);
    this.name = "DatabaseCorruptionError";
  }
}

export class DatabaseStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseStateError";
  }
}

// ---------------------------------------------------------------------------
// PRAGMAs
// ---------------------------------------------------------------------------

/**
 * Apply all mandatory PRAGMAs to an open SQLite connection.
 * REQ-PER-004 / DEC-PER-04.
 */
function applyPragmas(db: Db): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("wal_autocheckpoint = 1000");
  db.pragma("busy_timeout = 30000");
  db.pragma("foreign_keys = ON");
  db.pragma("cache_size = -16000");
  db.pragma("temp_store = MEMORY");
}

// ---------------------------------------------------------------------------
// Integrity check
// ---------------------------------------------------------------------------

/**
 * Run PRAGMA integrity_check.
 * Returns "ok" on success; otherwise returns the full error string.
 */
export function runIntegrityCheck(db: Db): string {
  // integrity_check returns rows like { integrity_check: "ok" }
  const rows = db.pragma("integrity_check") as Array<Record<string, unknown>>;
  if (rows.length === 0) return "no rows returned";

  // rows.length > 0 is guaranteed here (guard above); direct indexing is safe.
  const first = rows[0];
  const firstValue = first !== undefined ? first["integrity_check"] : undefined;
  if (rows.length === 1 && firstValue === "ok") {
    return "ok";
  }

  // Multiple rows or non-ok first row: collect all messages
  return rows
    .map((r) => {
      const v = r["integrity_check"];
      return typeof v === "string" ? v : String(v);
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OpenDatabaseOptions {
  /** Absolute path to the .db file. */
  path: string;
  /** If true, skip integrity_check (e.g., for newly created databases). */
  skipIntegrityCheck?: boolean;
  /** If true, open in read-only mode (for backup source inspection). */
  readonly?: boolean;
}

export interface FusionDatabase {
  /** The underlying better-sqlite3 instance. */
  readonly raw: Db;
  /** Absolute path this database was opened from. */
  readonly path: string;

  /**
   * Execute a callback inside an immediate transaction.
   * The transaction is committed on return and rolled back on throw.
   */
  transaction<T>(fn: () => T): T;

  /**
   * Close the database, flushing the WAL via TRUNCATE checkpoint.
   * After this call the FusionDatabase must not be used.
   */
  close(): void;
}

/**
 * Open a SQLite database with all Fusion PRAGMAs applied.
 *
 * On open:
 *   1. Applies all mandatory PRAGMAs (DEC-PER-04).
 *   2. Runs PRAGMA integrity_check unless skipIntegrityCheck=true (REQ-PER-005).
 *      Throws DatabaseCorruptionError if the check fails.
 *
 * On close:
 *   - Runs wal_checkpoint(TRUNCATE) to merge WAL into the main file (Question 10).
 *   - Closes the underlying SQLite connection.
 */
export function openDatabase(options: OpenDatabaseOptions): FusionDatabase {
  const { path, skipIntegrityCheck = false, readonly = false } = options;

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(path, { readonly, fileMustExist: false });
  } catch (err) {
    // better-sqlite3 throws SqliteError when the file is not a valid SQLite database
    const msg = err instanceof Error ? err.message : String(err);
    throw new DatabaseCorruptionError(path, msg);
  }

  try {
    if (!readonly) {
      applyPragmas(db);
    }
  } catch (err) {
    db.close();
    const msg = err instanceof Error ? err.message : String(err);
    throw new DatabaseCorruptionError(path, msg);
  }

  if (!skipIntegrityCheck && !readonly) {
    let result: string;
    try {
      result = runIntegrityCheck(db);
    } catch (err) {
      db.close();
      const msg = err instanceof Error ? err.message : String(err);
      throw new DatabaseCorruptionError(path, msg);
    }
    if (result !== "ok") {
      db.close();
      throw new DatabaseCorruptionError(path, result);
    }
  }

  // Prepare a transaction helper
  const transact = db.transaction(<T>(fn: () => T) => fn());

  const fusionDb: FusionDatabase = {
    raw: db,
    path,

    transaction<T>(fn: () => T): T {
      return transact(fn) as T;
    },

    close(): void {
      if (!db.open) return;
      if (!readonly) {
        // Checkpoint WAL into main db file before closing (REQ-PER-039 strategy,
        // Q10 answer: flush WAL on graceful shutdown for fast next-open).
        try {
          db.pragma("wal_checkpoint(TRUNCATE)");
        } catch {
          // Best-effort: if this fails the WAL will be replayed on next open.
        }
      }
      db.close();
    },
  };

  return fusionDb;
}

// ---------------------------------------------------------------------------
// WAL size check helper (REQ-PER-039)
// ---------------------------------------------------------------------------

/**
 * Return the size in bytes of the WAL file for a given db path.
 * Returns 0 if the WAL file does not exist.
 */
export function getWalFileSize(dbPath: string): number {
  const walPath = `${dbPath}-wal`;
  if (!existsSync(walPath)) return 0;
  try {
    return statSync(walPath).size;
  } catch {
    return 0;
  }
}
