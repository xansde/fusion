/**
 * Tests for T018 file maintenance (docs/design/banco-de-dados/tasks.md).
 *
 * Only `PRAGMA optimize` survived the investigation (see maintenance.ts's
 * module docstring for why periodic ANALYZE and incremental vacuum did not).
 * Every assertion here checks an OBSERVABLE effect on the database file —
 * `sqlite_stat1` contents — never "was the function called".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, applyMigrations, registerMigrations } from "../db/index.js";
import { migration001 } from "../db/migrations/001_initial_schema.js";
import { runOptimize } from "../db/maintenance.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-db-maint-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function statTableExists(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'`)
    .get();
  return row !== undefined;
}

function statRowCount(db: Database.Database): number {
  if (!statTableExists(db)) return 0;
  const row = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_stat1`).get() as { n: number };
  return row.n;
}

/** Seed `actors` (indexed on name/type/folder_id) with enough rows that
 * SQLite's optimize heuristic has real distribution data to analyze. */
function seedActors(db: Database.Database, count: number): void {
  const insert = db.prepare(
    `INSERT INTO actors (id, data, name, type, folder_id, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`,
  );
  const now = Date.now();
  const insertMany = db.transaction((n: number) => {
    for (let i = 0; i < n; i++) {
      insert.run(`actor-${String(i)}`, "{}", `Actor ${String(i)}`, "npc", now, now);
    }
  });
  insertMany(count);
}

let tempDirs: string[] = [];

beforeEach(() => {
  tempDirs = [];
  registerMigrations([migration001]);
});

afterEach(() => {
  registerMigrations([migration001]);
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

function newTempDirTracked(): string {
  const dir = newTempDir();
  tempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// runOptimize — unit-level, observable effect on sqlite_stat1
// ---------------------------------------------------------------------------

describe("runOptimize", () => {
  it("populates sqlite_stat1 for an indexed, non-trivial table", () => {
    const dir = newTempDirTracked();
    const path = join(dir, "world.db");
    const fdb = openDatabase({ path, skipIntegrityCheck: true });
    applyMigrations(fdb.raw, path);
    seedActors(fdb.raw, 200);

    // Before: this build never ran ANALYZE/optimize on this file yet.
    expect(statRowCount(fdb.raw)).toBe(0);

    runOptimize(fdb.raw);

    // After: at least the actors indexes should have been analyzed.
    const rows = fdb.raw
      .prepare(`SELECT tbl, idx FROM sqlite_stat1 WHERE tbl = 'actors'`)
      .all() as { tbl: string; idx: string | null }[];
    expect(rows.length).toBeGreaterThan(0);

    fdb.close();
  });

  it("does not throw and writes nothing on a database with no tables yet", () => {
    const dir = newTempDirTracked();
    const path = join(dir, "empty.db");
    const db = new Database(path);
    db.pragma("journal_mode = WAL");

    expect(() => {
      runOptimize(db);
    }).not.toThrow();
    expect(statTableExists(db)).toBe(false);

    db.close();
  });

  it("does not throw on a readonly connection, and writes nothing", () => {
    const dir = newTempDirTracked();
    const path = join(dir, "world.db");

    // Build up a real database with data worth analyzing, via a plain
    // connection (not openDatabase/FusionDatabase.close(), which would run
    // its own runOptimize() and defeat the point of this test — isolating
    // what runOptimize() itself does against an already-readonly handle).
    const setup = new Database(path);
    applyMigrations(setup, path);
    seedActors(setup, 200);
    setup.close();

    const ro = new Database(path, { readonly: true });
    expect(ro.readonly).toBe(true);
    expect(statTableExists(ro)).toBe(false); // nothing analyzed this file yet

    expect(() => {
      runOptimize(ro);
    }).not.toThrow();

    // A readonly connection cannot have written sqlite_stat1.
    expect(statTableExists(ro)).toBe(false);

    ro.close();
  });

  it("is idempotent — calling it again with unchanged data does not error", () => {
    const dir = newTempDirTracked();
    const path = join(dir, "world.db");
    const fdb = openDatabase({ path, skipIntegrityCheck: true });
    applyMigrations(fdb.raw, path);
    seedActors(fdb.raw, 50);

    runOptimize(fdb.raw);
    const firstCount = statRowCount(fdb.raw);
    expect(firstCount).toBeGreaterThan(0);

    expect(() => {
      runOptimize(fdb.raw);
    }).not.toThrow();
    // Re-running without data drift should not blow away or duplicate stats.
    expect(statRowCount(fdb.raw)).toBe(firstCount);

    fdb.close();
  });
});

// ---------------------------------------------------------------------------
// FusionDatabase.close() — proves the wiring in connection.ts, not just the
// standalone function. This is the test that fails against the code as it
// was BEFORE T018: close() only ran wal_checkpoint, so sqlite_stat1 never
// existed after a reopen no matter how much data had been written.
// ---------------------------------------------------------------------------

describe("FusionDatabase.close() runs maintenance", () => {
  it("leaves sqlite_stat1 populated for the next boot to see", () => {
    const dir = newTempDirTracked();
    const path = join(dir, "world.db");

    const fdb = openDatabase({ path, skipIntegrityCheck: true });
    applyMigrations(fdb.raw, path);
    seedActors(fdb.raw, 200);
    fdb.close(); // <-- the behaviour under test: no explicit runOptimize() call here

    // Reopen with a plain connection (not through openDatabase, so this
    // assertion is about what close() left on disk, not about open()).
    const check = new Database(path);
    expect(statTableExists(check)).toBe(true);
    expect(statRowCount(check)).toBeGreaterThan(0);
    check.close();
  });

  it("does not throw closing a readonly-opened database", () => {
    const dir = newTempDirTracked();
    const path = join(dir, "world.db");

    const fdb = openDatabase({ path, skipIntegrityCheck: true });
    applyMigrations(fdb.raw, path);
    seedActors(fdb.raw, 10);
    fdb.close();

    const roFdb = openDatabase({ path, readonly: true });
    expect(() => {
      roFdb.close();
    }).not.toThrow();
  });

  it("does not throw closing a fresh database with nothing to optimize", () => {
    const dir = newTempDirTracked();
    const path = join(dir, "world.db");
    const fdb = openDatabase({ path, skipIntegrityCheck: true });

    expect(() => {
      fdb.close();
    }).not.toThrow();
  });
});
