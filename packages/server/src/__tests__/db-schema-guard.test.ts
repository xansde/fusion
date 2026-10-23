/**
 * Schema guard (T004 / D6) and migration 004 (T003).
 *
 * The failure this guards against is silent: `applyMigrations` only applies
 * `version > MAX(version)`, so a database that received a *different*
 * migration 004 somewhere else has ours skipped without a word, and the
 * mismatch only shows up later as a puzzling runtime error.
 *
 * Covers the four cases from tasks.md T004: a brand-new database, a database
 * one version behind, a database at the same version but from a divergent
 * build, and a database with a hole in its migration history.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "better-sqlite3";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  openDatabase,
  applyMigrations,
  checkSchema,
  getSchemaVersion,
  registerMigrations,
  SchemaMismatchError,
} from "../db/index.js";
import type { FusionMigration } from "../db/index.js";
import { migration001 } from "../db/migrations/001_initial_schema.js";
import { migration002 } from "../db/migrations/002_users_sessions.js";
import { migration003 } from "../db/migrations/003_fog_exploration.js";
import { migration004 } from "../db/migrations/004_region_maps.js";
import { migration005 } from "../db/migrations/005_roll_audit_log.js";

const UP_TO_4: FusionMigration[] = [migration001, migration002, migration003, migration004];
const ALL: FusionMigration[] = [...UP_TO_4, migration005];

let tempDirs: string[] = [];

function newTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-schema-guard-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/** Build a database at a given point in migration history and close it. */
function seedDatabase(path: string, migrations: FusionMigration[]): void {
  registerMigrations(migrations);
  const db = openDatabase({ path, skipIntegrityCheck: true });
  try {
    applyMigrations(db.raw, path);
  } finally {
    db.close();
  }
}

/**
 * The `roll_audit_log` as it exists in worlds that were played before migration
 * 005 adopted it.
 *
 * The DDL is read from a fixture captured out of a real world database, not
 * retyped here. That distinction is the whole test: `ensureAuditTable` is gone
 * from `chat/roll-service.ts`, so a hand-copied "legacy" DDL in this file would
 * be the same person writing the same statement twice — and would agree with a
 * mistranscribed migration just as happily as with a correct one.
 */
const LEGACY_AUDIT_DDL = readFileSync(
  fileURLToPath(new URL("./fixtures/legacy-roll-audit-log.sql", import.meta.url)),
  "utf8",
);

function seedLegacyAuditTable(db: Database): void {
  db.exec(LEGACY_AUDIT_DDL);
}

beforeEach(() => {
  tempDirs = [];
  registerMigrations(ALL);
});

afterEach(() => {
  registerMigrations(ALL);
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort
    }
  }
});

describe("migration 004 — region_maps (T003)", () => {
  // These assertions are about what version 4 looks like, so they pin the
  // registered set to 004 rather than tracking the head of the migration list.
  beforeEach(() => {
    registerMigrations(UP_TO_4);
  });

  it("a brand-new database is born at version 4 with the region_maps table", () => {
    const path = join(newTempDir(), "world.db");
    const db = openDatabase({ path, skipIntegrityCheck: true });

    try {
      applyMigrations(db.raw, path);

      expect(getSchemaVersion(db.raw)).toBe(4);

      const table = db.raw
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='region_maps'`)
        .get();
      expect(table).toBeDefined();

      for (const idx of ["idx_region_maps_name", "idx_region_maps_folder"]) {
        const row = db.raw
          .prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`)
          .get(idx);
        expect(row, `Index "${idx}" should exist`).toBeDefined();
      }
    } finally {
      db.close();
    }
  });

  it("a version-3 database is upgraded to 4, keeping its rows", () => {
    const path = join(newTempDir(), "world.db");
    seedDatabase(path, [migration001, migration002, migration003]);

    // Put a row in place so the upgrade has something to preserve.
    registerMigrations([migration001, migration002, migration003]);
    const before = openDatabase({ path, skipIntegrityCheck: true });
    before.raw
      .prepare(
        `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
         VALUES ('act1', '{}', 'Fofurinha', 'character', 0, 1, 1)`,
      )
      .run();
    expect(getSchemaVersion(before.raw)).toBe(3);
    before.close();

    registerMigrations(UP_TO_4);
    const after = openDatabase({ path, skipIntegrityCheck: true });
    try {
      applyMigrations(after.raw, path);

      expect(getSchemaVersion(after.raw)).toBe(4);
      const row = after.raw.prepare(`SELECT name FROM actors WHERE id = 'act1'`).get() as
        | { name: string }
        | undefined;
      expect(row?.name).toBe("Fofurinha");
    } finally {
      after.close();
    }
  });

  it("a version-4 database has nothing pending", () => {
    const path = join(newTempDir(), "world.db");
    seedDatabase(path, UP_TO_4);

    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      const report = checkSchema(db.raw);
      expect(report.ok).toBe(true);
      expect(report.currentVersion).toBe(4);
      expect(report.latestKnownVersion).toBe(4);

      // Idempotent: opening again changes nothing.
      applyMigrations(db.raw, path);
      expect(getSchemaVersion(db.raw)).toBe(4);
    } finally {
      db.close();
    }
  });
});

describe("schema guard (T004)", () => {
  it("accepts a brand-new database", () => {
    const path = join(newTempDir(), "world.db");
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      const report = checkSchema(db.raw);
      expect(report.ok).toBe(true);
      expect(report.currentVersion).toBe(0);
      expect(() => {
        applyMigrations(db.raw, path);
      }).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("accepts a database one version behind and migrates it", () => {
    const path = join(newTempDir(), "world.db");
    seedDatabase(path, UP_TO_4);

    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      expect(checkSchema(db.raw).ok).toBe(true);
      applyMigrations(db.raw, path);
      expect(getSchemaVersion(db.raw)).toBe(5);
    } finally {
      db.close();
    }
  });

  it("refuses a version-4 database whose 004 came from a divergent build", () => {
    const path = join(newTempDir(), "world.db");

    // Another line's migration 004: same version number, different table.
    const alienMigration004: FusionMigration = {
      version: 4,
      description: "Some other line's fourth migration",
      up(db) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS territory_charts (
            id   TEXT PRIMARY KEY NOT NULL,
            data TEXT NOT NULL
          );
        `);
      },
    };
    seedDatabase(path, [migration001, migration002, migration003, alienMigration004]);

    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      const report = checkSchema(db.raw);
      expect(report.ok).toBe(false);

      // Our table is absent; theirs is present and unaccounted for.
      const missing = report.problems.filter((p) => p.kind === "object-missing");
      expect(missing.map((p) => p.subject)).toContain("table region_maps");
      const extra = report.problems.filter((p) => p.kind === "object-extra");
      expect(extra.map((p) => p.subject)).toContain("table territory_charts");

      // And the guard stops the boot rather than migrating over it.
      let thrown: unknown;
      try {
        applyMigrations(db.raw, path);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(SchemaMismatchError);

      // The message has to be actionable: what was expected, what was found,
      // where the backups are and how to override.
      const message = (thrown as Error).message;
      expect(message).toContain("region_maps");
      expect(message).toContain("territory_charts");
      expect(message).toContain("backups");
      expect(message).toContain("--force-schema");
      expect(message).not.toContain("    at "); // a message, not a stack trace
    } finally {
      db.close();
    }
  });

  it("refuses a database with a migration missing in the middle", () => {
    const path = join(newTempDir(), "world.db");
    seedDatabase(path, ALL);

    // Erase the record of migration 003 and the objects it created — a world
    // that somehow never got that step, yet still reports version 4.
    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      db.raw.exec(`DELETE FROM schema_migrations WHERE version = 3`);
      db.raw.exec(`DROP TRIGGER IF EXISTS trg_fog_cascade_scene_delete`);
      db.raw.exec(`DROP TABLE IF EXISTS fog_exploration`);

      const report = checkSchema(db.raw);
      expect(report.ok).toBe(false);
      expect(report.problems.some((p) => p.kind === "missing-version")).toBe(true);

      expect(() => {
        applyMigrations(db.raw, path);
      }).toThrow(SchemaMismatchError);
    } finally {
      db.close();
    }
  });

  it("refuses a database recorded at a version this build does not know", () => {
    const path = join(newTempDir(), "world.db");
    seedDatabase(path, ALL);

    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      db.raw
        .prepare(`INSERT INTO schema_migrations (version, applied_at, description) VALUES (?,?,?)`)
        .run(99, Date.now(), "from the future");

      const report = checkSchema(db.raw);
      expect(report.ok).toBe(false);
      expect(report.problems.some((p) => p.kind === "unknown-version")).toBe(true);

      expect(() => {
        applyMigrations(db.raw, path);
      }).toThrow(SchemaMismatchError);
    } finally {
      db.close();
    }
  });

  it("tolerates roll_audit_log while the world is still below version 5", () => {
    const path = join(newTempDir(), "world.db");
    seedDatabase(path, UP_TO_4);

    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      seedLegacyAuditTable(db.raw);

      // Version 4 predates the migration that adopts the table, so its
      // presence is history, not divergence.
      const report = checkSchema(db.raw);
      expect(report.currentVersion).toBe(4);
      expect(report.ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it("stops tolerating roll_audit_log once the world is at version 5", () => {
    const path = join(newTempDir(), "world.db");
    seedDatabase(path, ALL);

    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      // From version 5 on the table belongs to a migration, so losing it is a
      // real problem — the exemption must not go on covering for it.
      db.raw.exec(`DROP TABLE roll_audit_log`);

      const report = checkSchema(db.raw);
      expect(report.ok).toBe(false);
      const missing = report.problems.filter((p) => p.kind === "object-missing");
      expect(missing.map((p) => p.subject)).toContain("table roll_audit_log");
    } finally {
      db.close();
    }
  });

  it("--force-schema opens a divergent database anyway", () => {
    const path = join(newTempDir(), "world.db");
    seedDatabase(path, ALL);

    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      db.raw.exec(`CREATE TABLE rogue (id TEXT PRIMARY KEY NOT NULL)`);

      expect(checkSchema(db.raw).ok).toBe(false);
      expect(() => {
        applyMigrations(db.raw, path);
      }).toThrow(SchemaMismatchError);
      expect(() => {
        applyMigrations(db.raw, path, { force: true });
      }).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("still refuses an extra object that no exemption covers", () => {
    const path = join(newTempDir(), "world.db");
    seedDatabase(path, ALL);

    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      // The exemption is a named list with an adopting version, not a general
      // tolerance for drift.
      db.raw.exec(`CREATE TABLE roll_audit_log_v2 (id TEXT PRIMARY KEY NOT NULL)`);

      const report = checkSchema(db.raw);
      expect(report.ok).toBe(false);
      const extra = report.problems.filter((p) => p.kind === "object-extra");
      expect(extra.map((p) => p.subject)).toContain("table roll_audit_log_v2");
    } finally {
      db.close();
    }
  });

  it("does not care about re-indentation of a migration's DDL", () => {
    const path = join(newTempDir(), "world.db");

    const reindented: FusionMigration = {
      version: 4,
      description: migration004.description,
      up(db) {
        // Same DDL as migration004, formatted differently.
        db.exec(
          `CREATE TABLE IF NOT EXISTS region_maps (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, name TEXT NOT NULL, folder_id TEXT, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
           CREATE INDEX IF NOT EXISTS idx_region_maps_name ON region_maps(name);
           CREATE INDEX IF NOT EXISTS idx_region_maps_folder ON region_maps(folder_id);`,
        );
      },
    };

    seedDatabase(path, [migration001, migration002, migration003, reindented]);

    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      const report = checkSchema(db.raw);
      expect(report.problems).toEqual([]);
      expect(report.ok).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe("migration 005 — roll_audit_log (T007)", () => {
  it("a brand-new database has the audit table before a single die is rolled", () => {
    const path = join(newTempDir(), "world.db");
    const db = openDatabase({ path, skipIntegrityCheck: true });

    try {
      applyMigrations(db.raw, path);

      expect(getSchemaVersion(db.raw)).toBe(5);

      const table = db.raw
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='roll_audit_log'`)
        .get();
      expect(table, "roll_audit_log should exist without any RollService").toBeDefined();

      const index = db.raw
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`)
        .get("idx_roll_audit_world_user");
      expect(index).toBeDefined();
    } finally {
      db.close();
    }
  });

  it("a world that already rolled dice keeps its rows through the upgrade", () => {
    const path = join(newTempDir(), "world.db");
    seedDatabase(path, UP_TO_4);

    // A world that has been played: the table was created on the side, and it
    // holds history nobody wants to lose.
    registerMigrations(UP_TO_4);
    const before = openDatabase({ path, skipIntegrityCheck: true });
    seedLegacyAuditTable(before.raw);
    before.raw
      .prepare(
        `INSERT INTO roll_audit_log
           (roll_id, world_id, user_id, actor_id, formula, expanded_formula, total, seed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("r1", "w1", "u1", null, "1d20+5", "[13]+5", 18, 42, 1);
    expect(getSchemaVersion(before.raw)).toBe(4);
    before.close();

    registerMigrations(ALL);
    const after = openDatabase({ path, skipIntegrityCheck: true });
    try {
      applyMigrations(after.raw, path);

      expect(getSchemaVersion(after.raw)).toBe(5);
      const row = after.raw
        .prepare(`SELECT formula, seed FROM roll_audit_log WHERE roll_id='r1'`)
        .get() as { formula: string; seed: number } | undefined;
      expect(row?.formula).toBe("1d20+5");
      expect(row?.seed).toBe(42);

      // And the world is no longer leaning on an exemption to be considered sound.
      expect(checkSchema(after.raw).ok).toBe(true);
    } finally {
      after.close();
    }
  });

  it("lands on the same table a real played world already has", () => {
    // The upgrade is a no-op for played worlds only if the shapes agree, so the
    // comparison has to be against something this migration's author did not
    // write: the fixture is the DDL as SQLite recorded it inside an actual
    // world file (see fixtures/legacy-roll-audit-log.sql).
    const fresh = join(newTempDir(), "world.db");
    const legacy = join(newTempDir(), "world.db");

    registerMigrations(ALL);
    const a = openDatabase({ path: fresh, skipIntegrityCheck: true });
    applyMigrations(a.raw, fresh);
    const fromMigration = readAuditSchema(a.raw);
    a.close();

    seedDatabase(legacy, UP_TO_4);
    registerMigrations(UP_TO_4);
    const b = openDatabase({ path: legacy, skipIntegrityCheck: true });
    seedLegacyAuditTable(b.raw);
    const fromRollService = readAuditSchema(b.raw);
    b.close();

    expect(fromMigration).toEqual(fromRollService);
  });
});

/** The audit objects as SQLite recorded them, whitespace flattened. */
function readAuditSchema(db: Database): { name: string; sql: string }[] {
  const rows = db
    .prepare(
      `SELECT name, sql FROM sqlite_master
        WHERE name IN ('roll_audit_log', 'idx_roll_audit_world_user')
        ORDER BY name`,
    )
    .all() as { name: string; sql: string }[];
  return rows.map((r) => ({ name: r.name, sql: r.sql.replace(/\s+/g, " ").trim() }));
}
