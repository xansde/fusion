/**
 * Migration framework for world databases.
 *
 * Maintains a schema_migrations table with monotonic integer versions.
 * Applies pending migrations in order, each inside its own transaction.
 * Before running ANY migration, creates an automatic backup of the .db file.
 *
 * REQ-PER-008, REQ-PER-038, spec 24-operacao-backups-telemetria.md (backup pre-migração).
 */

import type { Database as Db } from "better-sqlite3";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Migration definition
// ---------------------------------------------------------------------------

/** A single versioned migration step. */
export interface FusionMigration {
  /** Monotonic integer version. Must be unique and > 0. */
  version: number;
  /** Human-readable description stored in schema_migrations. */
  description: string;
  /**
   * Apply the migration to the database.
   * Called inside a transaction — throw to trigger rollback.
   */
  up(db: Db): void;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class MigrationError extends Error {
  constructor(
    public readonly version: number,
    cause: unknown,
  ) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Migration ${String(version)} failed: ${msg}`);
    this.name = "MigrationError";
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read the currently applied schema version from schema_migrations (max). */
function getCurrentVersion(db: Db): number {
  // schema_migrations may not exist yet (brand-new database)
  const tableExists = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
    .get();

  if (!tableExists) return 0;

  const row = db.prepare(`SELECT MAX(version) AS ver FROM schema_migrations`).get() as
    | { ver: number | null }
    | undefined;

  return row?.ver ?? 0;
}

/**
 * Create a pre-migration backup of the database file.
 * Uses file copy (synchronous) so no open DB connection is needed.
 * The backup is placed in <dbDir>/backups/pre-migration-<ts>.db.
 */
function backupBeforeMigration(dbPath: string): string {
  const dbDir = dirname(dbPath);
  const backupsDir = join(dbDir, "backups");
  mkdirSync(backupsDir, { recursive: true });

  const ts = Date.now();
  const destPath = join(backupsDir, `pre-migration-${String(ts)}.db`);

  // Copy WAL and SHM as well if they exist, so the backup is consistent
  if (existsSync(dbPath)) {
    copyFileSync(dbPath, destPath);
  }
  // Also copy WAL if present (best-effort)
  const walSrc = `${dbPath}-wal`;
  if (existsSync(walSrc)) {
    try {
      copyFileSync(walSrc, `${destPath}-wal`);
    } catch {
      // Non-fatal: WAL may be empty or locked
    }
  }

  return destPath;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All registered migrations, ordered by version ascending. */
let _migrations: FusionMigration[] = [];

/**
 * Register migrations.
 * Replaces any previously registered set.
 * Validates that versions are unique and in ascending order.
 */
export function registerMigrations(migrations: FusionMigration[]): void {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  const versions = sorted.map((m) => m.version);
  const unique = new Set(versions);
  if (unique.size !== versions.length) {
    throw new Error("Duplicate migration versions detected");
  }

  _migrations = sorted;
}

/**
 * Apply all pending migrations to the given database.
 *
 * Steps:
 *   1. Determine current schema version from schema_migrations.
 *   2. Filter migrations with version > current.
 *   3. If any pending migrations exist, create a backup BEFORE applying.
 *   4. Apply each migration in a dedicated transaction.
 *      On failure, throw MigrationError (transaction auto-rolled-back).
 *
 * @param db     Open better-sqlite3 Database instance.
 * @param dbPath Path to the .db file (used for backup naming).
 */
export function applyMigrations(db: Db, dbPath: string): void {
  const current = getCurrentVersion(db);
  const pending = _migrations.filter((m) => m.version > current);

  if (pending.length === 0) return;

  // Create a backup BEFORE any migration (spec 24 / REQ-PER-008)
  backupBeforeMigration(dbPath);

  for (const migration of pending) {
    const txn = db.transaction(() => {
      migration.up(db);

      // Record the migration in schema_migrations.
      // The table is created by migration 001; for migration 001 itself,
      // up() creates the table before we insert here.
      db.prepare(
        `INSERT INTO schema_migrations (version, applied_at, description)
         VALUES (?, ?, ?)`,
      ).run(migration.version, Date.now(), migration.description);
    });

    try {
      txn();
    } catch (err) {
      throw new MigrationError(migration.version, err);
    }
  }
}

/**
 * Get the current schema version stored in the database.
 * Returns 0 if the schema_migrations table does not yet exist.
 */
export function getSchemaVersion(db: Db): number {
  return getCurrentVersion(db);
}
