/**
 * Migration framework for world databases.
 *
 * Maintains a schema_migrations table with monotonic integer versions.
 * Applies pending migrations in order, each inside its own transaction.
 *
 * Two safety rails guard every open (docs/design/banco-de-dados/tasks.md):
 *
 *  - **Consistent pre-migration backup (T001).** Before touching a database
 *    that has pending migrations, `VACUUM INTO` writes a self-contained copy
 *    from the *open* connection. A plain `copyFileSync` of a WAL database in
 *    use is not a backup: the committed pages may still live in the -wal file,
 *    and copying the two files separately is not atomic.
 *
 *  - **Schema guard (T004, D6).** Version numbers alone are a weak identity:
 *    `applyMigrations` only applies `version > MAX(version)`, so a database
 *    that picked up a *different* migration 004 elsewhere would have ours
 *    skipped in silence — and the divergence would only surface as a
 *    confusing runtime error much later. Before applying anything we compare
 *    the database's actual schema against the schema our own migrations
 *    produce, and refuse to open on a mismatch.
 *
 * REQ-PER-008, REQ-PER-038, spec 24-operacao-backups-telemetria.md (backup pre-migração).
 */

import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
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

/**
 * Thrown when the database schema does not match what the registered
 * migrations produce (D6: fail closed, never carry on quietly).
 */
export class SchemaMismatchError extends Error {
  constructor(
    public readonly report: SchemaReport,
    dbPath: string,
  ) {
    super(formatSchemaReport(report, dbPath));
    this.name = "SchemaMismatchError";
  }
}

// ---------------------------------------------------------------------------
// Schema guard types
// ---------------------------------------------------------------------------

/** A schema object as SQLite itself records it in sqlite_master. */
interface SchemaObject {
  type: string;
  name: string;
  /** Normalised CREATE statement (whitespace collapsed). */
  sql: string;
}

export interface SchemaProblem {
  kind:
    | "missing-version"
    | "unknown-version"
    | "object-missing"
    | "object-extra"
    | "object-changed";
  /** Object name or migration version the problem is about. */
  subject: string;
  detail: string;
}

export interface SchemaReport {
  ok: boolean;
  /** MAX(version) recorded in schema_migrations (0 for a brand-new database). */
  currentVersion: number;
  /** Highest version among the registered migrations. */
  latestKnownVersion: number;
  /** Versions recorded in the database, ascending. */
  appliedVersions: number[];
  problems: SchemaProblem[];
}

/**
 * Objects that existed in real world databases before any migration created
 * them, mapped to the version that finally adopted each one.
 *
 * The value is what keeps this from being a permanent blind spot. An object is
 * tolerated as "extra" only *below* its adopting version; from that version on
 * the migrations produce it, so it is compared like everything else — and its
 * absence becomes a real problem rather than a silent pass.
 *
 * Why a version and not simply a deletion: `checkSchema` judges a database at
 * the version it declares, before anything is applied. A world sitting at
 * version 4 is compared against migrations 001–004, which do not create
 * `roll_audit_log`. Dropping the entry outright would therefore refuse to open
 * every existing world *before* reaching the migration that adopts the table.
 *
 * - `roll_audit_log` (+ its index) was created on demand by
 *   `chat/roll-service.ts`, so a world's schema depended on whether anyone had
 *   ever rolled a die. Migration 005 (T007) adopts it.
 */
const LEGACY_TOLERATED_OBJECTS: ReadonlyMap<string, number> = new Map([
  ["roll_audit_log", 5],
  ["idx_roll_audit_world_user", 5],
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read the currently applied schema version from schema_migrations (max). */
function getCurrentVersion(db: Db): number {
  // schema_migrations may not exist yet (brand-new database)
  if (!hasSchemaMigrationsTable(db)) return 0;

  const row = db.prepare(`SELECT MAX(version) AS ver FROM schema_migrations`).get() as
    | { ver: number | null }
    | undefined;

  return row?.ver ?? 0;
}

function hasSchemaMigrationsTable(db: Db): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
    .get();
  return row !== undefined;
}

/** All versions recorded in schema_migrations, ascending. */
function getAppliedVersions(db: Db): number[] {
  if (!hasSchemaMigrationsTable(db)) return [];
  const rows = db.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all() as {
    version: number;
  }[];
  return rows.map((r) => r.version);
}

/**
 * Reduce a CREATE statement to its shape, so that re-indenting a migration's
 * DDL does not read as a schema change. SQLite stores the statement verbatim
 * (minus the `IF NOT EXISTS`), so anything left after this is a real
 * difference: a column, a type, a constraint, a table.
 *
 * Both sides of every comparison go through this, so at worst an exotic
 * string literal containing brackets makes two *different* definitions look
 * alike — never the reverse.
 */
function normaliseSql(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

/**
 * Read every schema object SQLite manages for us.
 *
 * Skips `sqlite_*` objects: implicit indexes backing PRIMARY KEY/UNIQUE
 * constraints, plus the statistics tables ANALYZE writes. They are derived
 * from the DDL we do compare, so they carry no independent information.
 */
function readSchemaObjects(db: Db): Map<string, SchemaObject> {
  const rows = db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
        WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`,
    )
    .all() as { type: string; name: string; sql: string }[];

  const out = new Map<string, SchemaObject>();
  for (const row of rows) {
    out.set(row.name, { type: row.type, name: row.name, sql: normaliseSql(row.sql) });
  }
  return out;
}

/**
 * Build the schema our migrations produce, by running them against a throwaway
 * in-memory database. Deriving the expectation from the migrations themselves
 * means there is no second copy of the schema to keep in sync — the thing we
 * compare against is, by construction, what a fresh world gets.
 */
function buildExpectedSchema(upToVersion: number): Map<string, SchemaObject> {
  const cached = _expectedSchemaCache.get(upToVersion);
  if (cached) return cached;

  const mem = new Database(":memory:");
  try {
    for (const migration of _migrations) {
      if (migration.version > upToVersion) break;
      migration.up(mem);
    }
    const objects = readSchemaObjects(mem);
    _expectedSchemaCache.set(upToVersion, objects);
    return objects;
  } finally {
    mem.close();
  }
}

/** Render a schema report as an operator-facing message. */
function formatSchemaReport(report: SchemaReport, dbPath: string): string {
  const backupsPath = join(dirname(dbPath), "backups");
  const lines: string[] = [
    `Database schema does not match this build's migrations — refusing to open.`,
    ``,
    `  database:        ${dbPath}`,
    `  schema version:  ${String(report.currentVersion)} (this build knows up to ${String(report.latestKnownVersion)})`,
    ``,
    `What does not line up:`,
  ];

  for (const p of report.problems) {
    lines.push(`  - [${p.kind}] ${p.subject}: ${p.detail}`);
  }

  lines.push(
    ``,
    `This usually means the world was opened by a different build whose`,
    `migrations diverge from this one. Applying migrations on top of it could`,
    `corrupt data, so nothing was written.`,
    ``,
    `What to do:`,
    `  1. Backups of this world are in: ${backupsPath}`,
    `  2. Open the world with the build it came from, or restore a backup taken`,
    `     before the divergence.`,
    `  3. To open it anyway — accepting that migrations may be skipped or applied`,
    `     against an unexpected schema — re-run with --force-schema.`,
  );

  return lines.join("\n");
}

/**
 * Create a pre-migration backup of the database.
 *
 * Uses `VACUUM INTO`, which writes a complete, self-consistent database from
 * the open connection: it sees the current transaction state (WAL included)
 * and produces a single compacted file — no -wal/-shm sidecars to keep in
 * sync, and no window where the copy is half a database.
 *
 * The backup is placed in <dbDir>/backups/pre-migration-<ts>.db.
 *
 * @returns the path written.
 */
function backupBeforeMigration(db: Db, dbPath: string): string {
  const dbDir = dirname(dbPath);
  const backupsDir = join(dbDir, "backups");
  mkdirSync(backupsDir, { recursive: true });

  // VACUUM INTO refuses to overwrite, so make sure the name is free. Two
  // backups inside the same millisecond is far-fetched but cheap to rule out.
  const ts = Date.now();
  let destPath = join(backupsDir, `pre-migration-${String(ts)}.db`);
  let suffix = 1;
  while (existsSync(destPath)) {
    destPath = join(backupsDir, `pre-migration-${String(ts)}-${String(suffix)}.db`);
    suffix += 1;
  }

  db.prepare(`VACUUM INTO ?`).run(destPath);

  return destPath;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All registered migrations, ordered by version ascending. */
let _migrations: FusionMigration[] = [];

/** Expected-schema memo, keyed by version. Cleared by registerMigrations. */
let _expectedSchemaCache = new Map<number, Map<string, SchemaObject>>();

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
  _expectedSchemaCache = new Map();
}

/**
 * Compare a database's schema against what the registered migrations produce.
 *
 * The comparison is made at the version the database claims: migrations that
 * have not run yet are not a divergence, they are pending work.
 */
export function checkSchema(db: Db): SchemaReport {
  const appliedVersions = getAppliedVersions(db);
  const currentVersion = appliedVersions.length > 0 ? Math.max(...appliedVersions) : 0;
  const latestKnownVersion =
    _migrations.length > 0 ? (_migrations[_migrations.length - 1]?.version ?? 0) : 0;

  const problems: SchemaProblem[] = [];

  // A version we do not know about means the file has been through a build
  // whose migrations we cannot reason about. Stop here: any expectation we
  // computed would be fiction.
  const known = new Set(_migrations.map((m) => m.version));
  const unknown = appliedVersions.filter((v) => !known.has(v));
  for (const version of unknown) {
    problems.push({
      kind: "unknown-version",
      subject: `migration ${String(version)}`,
      detail: `recorded in this database but not part of this build`,
    });
  }

  // A gap below the current version means a migration was never applied, and
  // the version counter alone would happily hide that forever.
  for (const migration of _migrations) {
    if (migration.version > currentVersion) break;
    if (!appliedVersions.includes(migration.version)) {
      problems.push({
        kind: "missing-version",
        subject: `migration ${String(migration.version)}`,
        detail: `never applied, yet the database is already at version ${String(currentVersion)} ("${migration.description}")`,
      });
    }
  }

  // A brand-new database (no schema_migrations at all) has nothing to compare.
  // Neither does one whose history we could not make sense of above.
  if (currentVersion > 0 && unknown.length === 0) {
    const expected = buildExpectedSchema(currentVersion);
    const actual = readSchemaObjects(db);

    for (const [name, exp] of expected) {
      const act = actual.get(name);
      if (!act) {
        problems.push({
          kind: "object-missing",
          subject: `${exp.type} ${name}`,
          detail: `expected at schema version ${String(currentVersion)} but not present`,
        });
        continue;
      }
      if (act.sql !== exp.sql) {
        problems.push({
          kind: "object-changed",
          subject: `${exp.type} ${name}`,
          detail: `definition differs\n      expected: ${exp.sql}\n      found:    ${act.sql}`,
        });
      }
    }

    for (const [name, act] of actual) {
      if (expected.has(name)) continue;
      const adoptedAt = LEGACY_TOLERATED_OBJECTS.get(name);
      // Strictly `<`: at the adopting version the object is already part of
      // `expected`, so this branch cannot be reached for it — and if it ever
      // is, the object is genuinely missing from what the migration produced,
      // which is a problem to report rather than to excuse.
      if (adoptedAt !== undefined && currentVersion < adoptedAt) continue;
      problems.push({
        kind: "object-extra",
        subject: `${act.type} ${name}`,
        detail: `present in the database but created by no migration in this build`,
      });
    }
  }

  return {
    ok: problems.length === 0,
    currentVersion,
    latestKnownVersion,
    appliedVersions,
    problems,
  };
}

export interface ApplyMigrationsOptions {
  /**
   * Open the database even when its schema diverges from this build's
   * migrations (D6's escape hatch — `fusion serve --force-schema`).
   * The mismatch is still reported, on stderr.
   */
  force?: boolean;
}

/**
 * Apply all pending migrations to the given database.
 *
 * Steps:
 *   1. Verify the recorded schema matches this build (throws unless force).
 *   2. Determine current schema version from schema_migrations.
 *   3. Filter migrations with version > current.
 *   4. If any pending migrations exist, create a backup BEFORE applying.
 *   5. Apply each migration in a dedicated transaction.
 *      On failure, throw MigrationError (transaction auto-rolled-back).
 *
 * @param db     Open better-sqlite3 Database instance.
 * @param dbPath Path to the .db file (used for backup naming).
 */
export function applyMigrations(
  db: Db,
  dbPath: string,
  options: ApplyMigrationsOptions = {},
): void {
  // Step 1 — schema guard (D6). Runs even when nothing is pending: a database
  // that diverged without needing a migration is exactly the case that used to
  // slip through.
  const report = checkSchema(db);
  if (!report.ok) {
    if (options.force !== true) {
      throw new SchemaMismatchError(report, dbPath);
    }
    process.stderr.write(
      `[fusion:migrations] --force-schema: opening "${dbPath}" despite a schema mismatch.\n` +
        `${formatSchemaReport(report, dbPath)}\n`,
    );
  }

  const current = report.currentVersion;
  const pending = _migrations.filter((m) => m.version > current);

  if (pending.length === 0) return;

  // Create a backup BEFORE any migration (spec 24 / REQ-PER-008)
  backupBeforeMigration(db, dbPath);

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
