/**
 * Pre-migration backup (T001) and the restore rehearsal (T005).
 *
 * A backup that has never been restored is not a backup — the second half of
 * this file exercises the full round trip: back up, lose the data, restore,
 * open the world, read a document back.
 *
 * The first half is about *consistency*: the pre-migration backup used to be a
 * `copyFileSync` of a live WAL database plus a best-effort copy of the -wal
 * sidecar. Committed rows can sit in that sidecar, and two file copies are not
 * one atomic act, so the backup could be missing exactly the writes made just
 * before the migration that made it necessary.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync, existsSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openDatabase,
  applyMigrations,
  registerMigrations,
  runIntegrityCheck,
} from "../db/index.js";
import type { FusionMigration } from "../db/index.js";
import { migration001 } from "../db/migrations/001_initial_schema.js";
import { migration002 } from "../db/migrations/002_users_sessions.js";
import { migration003 } from "../db/migrations/003_fog_exploration.js";
import { migration004 } from "../db/migrations/004_region_maps.js";
import { migration005 } from "../db/migrations/005_roll_audit_log.js";
import { WorldManager } from "../worlds/index.js";

const ALL: FusionMigration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
];
const UP_TO_3: FusionMigration[] = [migration001, migration002, migration003];

let tempDirs: string[] = [];

function newTempDir(prefix: string): string {
  // Never inside the worktree: a stray `git add -A` would commit world data.
  const dir = join(
    tmpdir(),
    `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function insertActor(db: Database.Database, id: string, name: string): void {
  db.prepare(
    `INSERT INTO actors (id, data, name, type, sort, created_at, updated_at)
     VALUES (?, ?, ?, 'character', 0, 1, 1)`,
  ).run(id, JSON.stringify({ name }), name);
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

describe("pre-migration backup (T001)", () => {
  it("captures writes still pending in the WAL", () => {
    const dir = newTempDir("fusion-backup");
    const path = join(dir, "world.db");

    // A world at version 3 with rows written through the open connection.
    registerMigrations(UP_TO_3);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    applyMigrations(db.raw, path);

    const ACTORS = 200;
    for (let i = 0; i < ACTORS; i += 1) {
      insertActor(db.raw, `act-${String(i)}`, `Actor ${String(i)}`);
    }

    // The scenario only means something if the data really is in the WAL and
    // not yet in the main file — otherwise a plain file copy would do.
    const walPath = `${path}-wal`;
    expect(existsSync(walPath), "test needs a non-empty WAL to be meaningful").toBe(true);
    expect(statSync(walPath).size).toBeGreaterThan(0);

    // Creating the world already produced one backup (v0 → v3); the one this
    // test is about is the next, taken with the rows above still in the WAL.
    const backupsDir = join(dir, "backups");
    const preExisting = new Set(readdirSync(backupsDir));

    // Migration 004 is now pending — this is what triggers the backup.
    registerMigrations(ALL);
    applyMigrations(db.raw, path);
    db.close();

    const fresh = readdirSync(backupsDir).filter(
      (f) => f.startsWith("pre-migration-") && !preExisting.has(f),
    );
    expect(fresh).toHaveLength(1);

    const backupPath = join(backupsDir, fresh[0] ?? "");

    // VACUUM INTO writes one self-contained file: no -wal sidecar to carry.
    expect(existsSync(`${backupPath}-wal`)).toBe(false);

    const restored = new Database(backupPath, { fileMustExist: true });
    try {
      expect(runIntegrityCheck(restored)).toBe("ok");

      const count = (restored.prepare(`SELECT COUNT(*) AS n FROM actors`).get() as { n: number }).n;
      expect(count).toBe(ACTORS);

      const sample = restored.prepare(`SELECT name FROM actors WHERE id = 'act-42'`).get() as
        | { name: string }
        | undefined;
      expect(sample?.name).toBe("Actor 42");

      // It is a *pre*-migration snapshot: taken before 004 ran.
      const version = (
        restored.prepare(`SELECT MAX(version) AS v FROM schema_migrations`).get() as { v: number }
      ).v;
      expect(version).toBe(3);
      const regionMaps = restored
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='region_maps'`)
        .get();
      expect(regionMaps).toBeUndefined();
    } finally {
      restored.close();
    }
  });

  it("does not overwrite an existing backup taken in the same millisecond", () => {
    const dir = newTempDir("fusion-backup");
    const path = join(dir, "world.db");

    registerMigrations(UP_TO_3);
    const first = openDatabase({ path, skipIntegrityCheck: true });
    applyMigrations(first.raw, path);
    insertActor(first.raw, "act-1", "Fofurinha");
    first.close();

    // Two migrations in a row, each with its own backup.
    registerMigrations([...UP_TO_3, migration004]);
    const second = openDatabase({ path, skipIntegrityCheck: true });
    applyMigrations(second.raw, path);

    const extra: FusionMigration = {
      version: 99,
      description: "test-only migration beyond the bundled set",
      up(db) {
        db.exec(`CREATE TABLE IF NOT EXISTS t99 (id TEXT PRIMARY KEY NOT NULL)`);
      },
    };
    registerMigrations([...ALL, extra]);
    applyMigrations(second.raw, path);
    second.close();

    // One per migration run: world creation (v0 → v3), then 004, then the rest —
    // each with a distinct filename, none overwriting another.
    const backups = readdirSync(join(dir, "backups")).filter((f) => f.startsWith("pre-migration-"));
    expect(backups).toHaveLength(3);
    expect(new Set(backups).size).toBe(3);
  });
});

describe("restore rehearsal (T005)", () => {
  it("backs up a world, loses it, restores it and reads the document back", async () => {
    const dataDir = newTempDir("fusion-restore");
    const manager = new WorldManager({ dataDir });

    const slug = "ensaio";
    manager.create({ slug, title: "Ensaio de restauração", system: "stub" });

    // --- write a document -------------------------------------------------
    manager.open(slug);
    const db = manager.getDatabase(slug);
    expect(db).toBeDefined();
    if (!db) throw new Error("world database handle missing");
    insertActor(db.raw, "act-hero", "Fofurinha");
    manager.close(slug);

    // --- back up ----------------------------------------------------------
    const entry = await manager.backup(slug, "manual");
    expect(existsSync(entry.path)).toBe(true);
    expect(entry.sizeBytes).toBeGreaterThan(0);

    // --- lose the data ----------------------------------------------------
    manager.open(slug);
    const live = manager.getDatabase(slug);
    if (!live) throw new Error("world database handle missing");
    live.raw.exec(`DELETE FROM actors`);
    manager.close(slug);

    manager.open(slug);
    const emptied = manager.getDatabase(slug);
    if (!emptied) throw new Error("world database handle missing");
    expect((emptied.raw.prepare(`SELECT COUNT(*) AS n FROM actors`).get() as { n: number }).n).toBe(
      0,
    );
    manager.close(slug);

    // --- restore ----------------------------------------------------------
    const worldDbPath = join(dataDir, "worlds", slug, "world.db");
    rmSync(`${worldDbPath}-wal`, { force: true });
    rmSync(`${worldDbPath}-shm`, { force: true });
    copyFileSync(entry.path, worldDbPath);

    // --- open the restored world and read the document back ---------------
    const manifest = manager.open(slug);
    expect(manifest.title).toBe("Ensaio de restauração");

    const restored = manager.getDatabase(slug);
    if (!restored) throw new Error("world database handle missing");

    expect(runIntegrityCheck(restored.raw)).toBe("ok");
    const row = restored.raw
      .prepare(`SELECT name, data FROM actors WHERE id = 'act-hero'`)
      .get() as { name: string; data: string } | undefined;
    expect(row?.name).toBe("Fofurinha");
    expect(JSON.parse(row?.data ?? "{}")).toEqual({ name: "Fofurinha" });

    manager.close(slug);
  });
});
