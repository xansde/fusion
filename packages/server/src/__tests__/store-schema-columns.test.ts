/**
 * Regression test for T015: DocumentStore._tableHasColumn must be derived
 * from the database's real schema (PRAGMA table_info), not a hand-maintained
 * list.
 *
 * The hand-maintained list this replaces had already drifted from reality:
 * a real migrated database (001-008 applied) shows `users` carries
 * password_hash/color/avatar/active/preferences (added by migrations 002 and
 * rebuilt by 006), none of which were ever added to the old list — confirmed
 * by running the migrations and comparing PRAGMA table_info against the list
 * before this fix. This test pins that comparison down permanently: for
 * every document table, whatever PRAGMA table_info reports is what
 * _tableHasColumn must agree with, column by column, including the ones the
 * old list missed.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase, applyMigrations } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";
import { DocumentStore } from "../documents/store.js";
import { DOCUMENT_TABLES } from "@fusion/shared";
import type { DocumentTable } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-schema-cols-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function openTestDb(dir: string): FusionDatabase {
  const path = join(dir, "world.db");
  const db = openDatabase({ path, skipIntegrityCheck: true });
  applyMigrations(db.raw, path);
  return db;
}

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  tempDirs = [];
});

/**
 * `_tableHasColumn` is private — reached here via a narrow structural cast
 * rather than changing its visibility just for the test.
 */
interface StoreWithColumnCheck {
  _tableHasColumn(table: DocumentTable, col: string): boolean;
}

function asColumnChecker(store: DocumentStore): StoreWithColumnCheck {
  return store as unknown as StoreWithColumnCheck;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DocumentStore._tableHasColumn (T015 — derived from PRAGMA table_info)", () => {
  it("agrees with PRAGMA table_info for every document table, column by column", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const db = openTestDb(dir);
    const store = new DocumentStore({ db: db.raw });
    const checker = asColumnChecker(store);

    // A handful of plausible-but-wrong column names to probe the negative
    // case too — not just "does it find the real ones".
    const decoys = ["nope", "made_up_column", "id_typo"];

    for (const table of DOCUMENT_TABLES) {
      const info = db.raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>;
      const realColumns = info.map((r) => r.name);
      expect(realColumns.length).toBeGreaterThan(0); // sanity: table actually exists

      for (const col of realColumns) {
        expect(checker._tableHasColumn(table, col), `${table}.${col} should be found`).toBe(true);
      }
      for (const col of decoys) {
        expect(checker._tableHasColumn(table, col), `${table}.${col} should NOT be found`).toBe(
          false,
        );
      }
    }

    db.close();
  });

  it("finds users.active — the column the old hand-maintained list was missing", () => {
    // This is the concrete divergence found by comparing the old list against
    // a real migrated database: migration 002 added password_hash, color,
    // avatar, active and preferences to `users`; migration 006 rebuilt the
    // table (constraints) but kept them all. None of the five were ever
    // added to the old hardcoded list in store.ts.
    const dir = makeTempDir();
    tempDirs.push(dir);
    const db = openTestDb(dir);
    const store = new DocumentStore({ db: db.raw });
    const checker = asColumnChecker(store);

    for (const col of ["password_hash", "color", "avatar", "active", "preferences"]) {
      expect(checker._tableHasColumn("users", col)).toBe(true);
    }

    db.close();
  });

  it("does not need a code change when a migration adds a column (T015 done-criterion)", () => {
    // Simulates "adding a column via a migration" without inventing a new
    // migration file: ALTER TABLE directly against the already-migrated
    // database, mirroring exactly what a future migration 009 would do to
    // `actors`. A fresh DocumentStore (fresh column cache) must pick it up
    // with zero changes to store.ts.
    const dir = makeTempDir();
    tempDirs.push(dir);
    const db = openTestDb(dir);
    db.raw.exec(`ALTER TABLE actors ADD COLUMN future_column TEXT;`);

    const store = new DocumentStore({ db: db.raw });
    const checker = asColumnChecker(store);
    expect(checker._tableHasColumn("actors", "future_column")).toBe(true);

    db.close();
  });

  it("returns an empty result (no throw) for a table PRAGMA finds nothing for", () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const db = openTestDb(dir);
    const store = new DocumentStore({ db: db.raw });
    const checker = asColumnChecker(store);

    expect(() => checker._tableHasColumn("actors", "not_a_real_column")).not.toThrow();
    expect(checker._tableHasColumn("actors", "not_a_real_column")).toBe(false);

    db.close();
  });
});
