/**
 * Integration tests for WorldManager.
 *
 * All tests use real directories in OS temp — no mocks.
 *
 * Covers:
 *  - Create world: valid slug, duplicate slug error, invalid slug error
 *  - Open world: lock written, lastOpenedAt updated
 *  - Close world: lock removed, DB checkpoint
 *  - Lock prevents second open
 *  - Stale lock (dead PID) is recovered
 *  - Copy of world.db reopens
 *  - Migrations applied on open
 *  - Delete: moves to trash, lock check, pre-delete backup created
 *  - Backup: creates file, auto-prune, list backups
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  WorldManager,
  WorldLockedError,
  WorldNotFoundError,
  InvalidSlugError,
} from "../worlds/index.js";
import type { WorldLock } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-wm-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

beforeEach(() => {
  tempDirs = [];
});

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort
    }
  }
});

function newTempDir(): string {
  const dir = makeTempDir();
  tempDirs.push(dir);
  return dir;
}

function makeManager(dataDir: string, opts?: { maxAutoBackups?: number }): WorldManager {
  return new WorldManager({ dataDir, maxAutoBackups: opts?.maxAutoBackups });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe("WorldManager.create", () => {
  it("creates a world with valid slug", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);

    const manifest = wm.create({ title: "Test World", system: "pf2e", slug: "test_world" });

    expect(manifest.id).toBe("test_world");
    expect(manifest.title).toBe("Test World");
    expect(manifest.system).toBe("pf2e");
    expect(existsSync(join(dataDir, "worlds", "test_world", "world.json"))).toBe(true);
    expect(existsSync(join(dataDir, "worlds", "test_world", "world.db"))).toBe(true);
    expect(existsSync(join(dataDir, "worlds", "test_world", "assets"))).toBe(true);
    expect(existsSync(join(dataDir, "worlds", "test_world", "backups"))).toBe(true);
  });

  it("auto-generates slug from title when not provided", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);

    const manifest = wm.create({ title: "The Lost Mine", system: "pf2e" });
    expect(manifest.id).toBe("the_lost_mine");
  });

  it("throws InvalidSlugError for invalid slug format", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);

    expect(() => wm.create({ title: "Bad Slug", system: "pf2e", slug: "Bad-Slug!" })).toThrow(
      InvalidSlugError,
    );
  });

  it("throws when slug already exists", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);

    wm.create({ title: "World One", system: "pf2e", slug: "my_world" });

    expect(() => wm.create({ title: "World Two", system: "pf2e", slug: "my_world" })).toThrow(
      /already exists/i,
    );
  });

  it("validates system when validSystemIds is provided", () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({
      dataDir,
      validSystemIds: new Set(["pf2e", "sf2e"]),
    });

    expect(() =>
      wm.create({ title: "Bad System World", system: "invalid_system", slug: "bad_sys" }),
    ).toThrow(/not registered/i);

    // Valid system should work
    const manifest = wm.create({ title: "Good System World", system: "pf2e", slug: "good_sys" });
    expect(manifest.system).toBe("pf2e");
  });

  it("initialises world.db with correct tables", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);

    wm.create({ title: "DB Check World", system: "pf2e", slug: "db_check" });

    // Open directly and verify tables
    const db = new Database(join(dataDir, "worlds", "db_check", "world.db"), {
      readonly: true,
      fileMustExist: true,
    });

    const tables = ["actors", "items", "scenes", "journal_entries", "schema_migrations"] as const;
    for (const table of tables) {
      const row = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table);
      expect(row, `Table "${table}" should exist`).toBeDefined();
    }
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Open / Close
// ---------------------------------------------------------------------------

describe("WorldManager.open / close", () => {
  it("writes world.lock on open and removes it on close", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Lock World", system: "pf2e", slug: "lock_world" });

    wm.open("lock_world");

    const lockFilePath = join(dataDir, "worlds", "lock_world", "world.lock");
    expect(existsSync(lockFilePath)).toBe(true);

    const lockData = JSON.parse(readFileSync(lockFilePath, "utf8")) as WorldLock;
    expect(lockData.pid).toBe(process.pid);
    expect(lockData.started_at).toBeDefined();

    wm.close("lock_world");
    expect(existsSync(lockFilePath)).toBe(false);
  });

  it("updates lastOpenedAt in world.json on open", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Update World", system: "pf2e", slug: "update_world" });

    const before = new Date().toISOString();
    wm.open("update_world");

    const mfPath = join(dataDir, "worlds", "update_world", "world.json");
    const manifest = JSON.parse(readFileSync(mfPath, "utf8")) as { lastOpenedAt: string };
    expect(manifest.lastOpenedAt >= before).toBe(true);

    wm.close("update_world");
  });

  it("throws WorldNotFoundError when opening non-existent world", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);

    expect(() => wm.open("nonexistent")).toThrow(WorldNotFoundError);
  });

  it("throws WorldAlreadyOpenError when world is already open in this process", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Double Open", system: "pf2e", slug: "double_open" });
    wm.open("double_open");

    try {
      expect(() => wm.open("double_open")).toThrow();
    } finally {
      wm.close("double_open");
    }
  });

  it("second manager refuses to open a world locked by the first", () => {
    const dataDir = newTempDir();

    const wm1 = makeManager(dataDir);
    wm1.create({ title: "Concurrent World", system: "pf2e", slug: "concurrent" });
    wm1.open("concurrent");

    const wm2 = makeManager(dataDir);

    try {
      expect(() => wm2.open("concurrent")).toThrow(WorldLockedError);
    } finally {
      wm1.close("concurrent");
    }
  });

  it("recovers a stale lock (dead PID)", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Stale Lock World", system: "pf2e", slug: "stale_lock" });

    // Write a fake lock with an impossible PID
    const lockFilePath = join(dataDir, "worlds", "stale_lock", "world.lock");
    const staleLock: WorldLock = { pid: 999999999, started_at: new Date().toISOString() };
    writeFileSync(lockFilePath, JSON.stringify(staleLock), "utf8");

    // Should open without error (stale lock recovered)
    expect(() => wm.open("stale_lock")).not.toThrow();
    wm.close("stale_lock");
  });

  it("reopens a copy of world.db in a new world slot", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Copy World", system: "pf2e", slug: "copy_world" });
    wm.open("copy_world");
    wm.close("copy_world");

    const srcDbPath = join(dataDir, "worlds", "copy_world", "world.db");
    const dstSlug = "copy_world_clone";

    // Create a new world slot and overwrite its DB
    wm.create({ title: "Copy Clone", system: "pf2e", slug: dstSlug });
    copyFileSync(srcDbPath, join(dataDir, "worlds", dstSlug, "world.db"));

    const manifest = wm.open(dstSlug);
    expect(manifest.id).toBe(dstSlug);
    wm.close(dstSlug);
  });

  it("applies pending migrations on open", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Migration World", system: "pf2e", slug: "migr_world" });

    // Open and verify schema_migrations has entries
    wm.open("migr_world");
    const db = wm.getDatabase("migr_world");
    expect(db).not.toBeNull();

    const row = db!.raw.prepare("SELECT COUNT(*) as n FROM schema_migrations").get() as {
      n: number;
    };
    expect(row.n).toBeGreaterThanOrEqual(1);

    wm.close("migr_world");
  });

  it("database has WAL mode enabled after open", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "WAL World", system: "pf2e", slug: "wal_world" });
    wm.open("wal_world");

    const db = wm.getDatabase("wal_world");
    expect(db).not.toBeNull();

    const walMode = (db!.raw.pragma("journal_mode") as { journal_mode: string }[])[0]?.journal_mode;
    expect(walMode).toBe("wal");

    wm.close("wal_world");
  });
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe("WorldManager.list", () => {
  it("returns empty array when no worlds exist", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);

    expect(wm.list()).toEqual([]);
  });

  it("lists all created worlds", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);

    wm.create({ title: "World A", system: "pf2e", slug: "world_a" });
    wm.create({ title: "World B", system: "sf2e", slug: "world_b" });

    const manifests = wm.list();
    const slugs = manifests.map((m) => m.id).sort();
    expect(slugs).toEqual(["world_a", "world_b"]);
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe("WorldManager.delete", () => {
  it("moves world directory to trash", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Delete World", system: "pf2e", slug: "del_world" });

    wm.delete("del_world");

    expect(existsSync(join(dataDir, "worlds", "del_world"))).toBe(false);

    // Should be in trash
    const trashDir = join(dataDir, "trash");
    const trashEntries = readdirSync(trashDir);
    const found = trashEntries.some((e) => e.startsWith("del_world-"));
    expect(found).toBe(true);
  });

  it("creates pre-delete backup before moving to trash", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Backup Delete World", system: "pf2e", slug: "backup_del" });

    wm.delete("backup_del");

    // The pre-delete backup should be inside the trashed world directory
    const trashDir = join(dataDir, "trash");
    const trashEntries = readdirSync(trashDir);
    const trashEntry = trashEntries.find((e) => e.startsWith("backup_del-"));
    expect(trashEntry).toBeDefined();

    const backupsDirPath = join(trashDir, trashEntry as string, "backups");
    expect(existsSync(backupsDirPath)).toBe(true);
    const backupFiles = readdirSync(backupsDirPath);
    const preDeleteBackup = backupFiles.find((f) => f.startsWith("pre-delete-"));
    expect(preDeleteBackup).toBeDefined();
  });

  it("throws WorldNotFoundError when deleting a non-existent world", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);

    expect(() => wm.delete("ghost_world")).toThrow(WorldNotFoundError);
  });

  it("throws when world is currently open", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Open Delete World", system: "pf2e", slug: "open_del" });
    wm.open("open_del");

    try {
      expect(() => wm.delete("open_del")).toThrow(/open/i);
    } finally {
      wm.close("open_del");
    }
  });
});

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

describe("WorldManager.backup", () => {
  it("creates auto backup file while world is open (online backup)", async () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Backup World", system: "pf2e", slug: "bk_world" });
    wm.open("bk_world");

    const entry = await wm.backup("bk_world", "auto");

    expect(existsSync(entry.path)).toBe(true);
    expect(entry.type).toBe("auto");
    expect(entry.sizeBytes).toBeGreaterThan(0);
    expect(entry.filename).toMatch(/^auto-\d+\.db$/);

    wm.close("bk_world");
  });

  it("creates manual backup file", async () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Manual Backup", system: "pf2e", slug: "man_bk" });
    wm.open("man_bk");

    const entry = await wm.backup("man_bk", "manual");

    expect(entry.type).toBe("manual");
    expect(entry.filename).toMatch(/^manual-\d+\.db$/);

    wm.close("man_bk");
  });

  it("backup file is a valid SQLite database with expected tables", async () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Valid Backup", system: "pf2e", slug: "valid_bk" });
    wm.open("valid_bk");

    const entry = await wm.backup("valid_bk", "auto");
    wm.close("valid_bk");

    const db = new Database(entry.path, { readonly: true, fileMustExist: true });
    const row = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='actors'`)
      .get();
    expect(row).toBeDefined();
    db.close();
  });

  it("prunes old auto backups when limit is exceeded", async () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir, { maxAutoBackups: 3 });
    wm.create({ title: "Prune World", system: "pf2e", slug: "prune_bk" });
    wm.open("prune_bk");

    // Create 5 auto backups (limit is 3)
    for (let i = 0; i < 5; i++) {
      await wm.backup("prune_bk", "auto");
    }

    const backups = wm.listBackups("prune_bk").filter((b) => b.type === "auto");
    expect(backups.length).toBeLessThanOrEqual(3);

    wm.close("prune_bk");
  });

  it("listBackups returns all backup entries", async () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "List Backups", system: "pf2e", slug: "list_bk" });
    wm.open("list_bk");

    await wm.backup("list_bk", "auto");
    await wm.backup("list_bk", "manual");

    const backups = wm.listBackups("list_bk");
    const types = backups.map((b) => b.type).sort();
    expect(types).toContain("auto");
    expect(types).toContain("manual");

    wm.close("list_bk");
  });
});

// ---------------------------------------------------------------------------
// Pre-update backup (M6/B5 — REQ-DST-022, canonical filename shape)
// ---------------------------------------------------------------------------

describe("WorldManager.backupPreUpdate", () => {
  it("creates a backup with the canonical pre-event-update-<version>-<ISO>.db filename", async () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Update Backup World", system: "pf2e", slug: "upd_bk" });
    wm.open("upd_bk");

    const entry = await wm.backupPreUpdate("upd_bk", "1.2.3");

    expect(existsSync(entry.path)).toBe(true);
    expect(entry.type).toBe("pre-update");
    expect(entry.sizeBytes).toBeGreaterThan(0);
    // pre-event-update-1.2.3-2026-07-03T10-56-14.799Z.db (colons stripped from the ISO suffix)
    expect(entry.filename).toMatch(
      /^pre-event-update-1\.2\.3-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.db$/,
    );

    wm.close("upd_bk");
  });

  it("works via the online backup API while the world is open (non-blocking for readers)", async () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Open Update Backup", system: "pf2e", slug: "upd_bk_open" });
    wm.open("upd_bk_open");

    const entry = await wm.backupPreUpdate("upd_bk_open", "2.0.0");
    const db = new Database(entry.path, { readonly: true, fileMustExist: true });
    const row = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='actors'`)
      .get();
    expect(row).toBeDefined();
    db.close();

    wm.close("upd_bk_open");
  });

  it("falls back to a file copy when the world is closed", async () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Closed Update Backup", system: "pf2e", slug: "upd_bk_closed" });
    // Deliberately NOT opened — backupPreUpdate must still work via file copy.

    const entry = await wm.backupPreUpdate("upd_bk_closed", "3.1.4");
    expect(existsSync(entry.path)).toBe(true);
    expect(entry.type).toBe("pre-update");
  });

  it("listBackups reports pre-update entries with a correctly parsed timestamp", async () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "List Update Backups", system: "pf2e", slug: "upd_bk_list" });
    wm.open("upd_bk_list");

    const before = Date.now();
    const entry = await wm.backupPreUpdate("upd_bk_list", "1.0.0");
    const after = Date.now();

    const backups = wm.listBackups("upd_bk_list");
    const found = backups.find((b) => b.filename === entry.filename);
    expect(found).toBeDefined();
    expect(found?.type).toBe("pre-update");
    // Timestamp reconstructed from the ISO-in-filename should round-trip to
    // within the [before, after] window the backup was actually taken in.
    expect(found?.timestamp).toBeGreaterThanOrEqual(before - 1000);
    expect(found?.timestamp).toBeLessThanOrEqual(after + 1000);

    wm.close("upd_bk_list");
  });

  it("throws WorldNotFoundError for an unknown slug", async () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    await expect(wm.backupPreUpdate("does_not_exist", "1.0.0")).rejects.toThrow(WorldNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Corruption recovery (CA-PER-05 / REQ-PER-005)
// ---------------------------------------------------------------------------

describe("WorldManager corruption recovery", () => {
  it("renames corrupted world.db and restores from the latest backup", async () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "Corrupt World", system: "pf2e", slug: "corrupt_world" });

    // Create a backup before corrupting.
    wm.open("corrupt_world");
    await wm.backup("corrupt_world", "manual");
    wm.close("corrupt_world");

    // Overwrite world.db with garbage bytes to simulate corruption.
    const dbFilePath = join(dataDir, "worlds", "corrupt_world", "world.db");
    writeFileSync(dbFilePath, "THIS IS NOT A SQLITE DATABASE\x00GARBAGE", "binary");

    // open() should detect corruption, rename the file and restore from backup.
    expect(() => wm.open("corrupt_world")).not.toThrow();

    // Verify the world is now open and the DB is usable.
    const db = wm.getDatabase("corrupt_world");
    expect(db).not.toBeNull();

    // Verify the corrupted file was renamed.
    const backupDir = join(dataDir, "worlds", "corrupt_world", "backups");
    const entries = readdirSync(join(dataDir, "worlds", "corrupt_world"));
    const corruptedFile = entries.find((e) => e.includes(".corrupted."));
    expect(corruptedFile).toBeDefined();

    // Verify the backups directory still has the manual backup.
    const backupFiles = readdirSync(backupDir);
    expect(backupFiles.some((f) => f.startsWith("manual-"))).toBe(true);

    wm.close("corrupt_world");
  });

  it("throws (no recovery) when world.db is corrupted and there are no backups", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);
    wm.create({ title: "No Backup World", system: "pf2e", slug: "no_backup_world" });

    // create() runs applyMigrations which creates a pre-migration backup.
    // Remove all backups so the recovery has nothing to restore from.
    const backupDir = join(dataDir, "worlds", "no_backup_world", "backups");
    for (const f of readdirSync(backupDir)) {
      rmSync(join(backupDir, f), { force: true });
    }

    // Overwrite world.db with garbage bytes.
    const dbFilePath = join(dataDir, "worlds", "no_backup_world", "world.db");
    writeFileSync(dbFilePath, "GARBAGE DATA NO BACKUP\x00", "binary");

    // open() should fail since there is no backup to restore from.
    expect(() => wm.open("no_backup_world")).toThrow();

    // Verify the corrupted file was renamed (best-effort even when recovery fails).
    const entries = readdirSync(join(dataDir, "worlds", "no_backup_world"));
    const corruptedFile = entries.find((e) => e.includes(".corrupted."));
    expect(corruptedFile).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Backup retention per type (T002)
//
// Only `auto` used to be pruned: pre-migration, pre-delete, pre-restore and
// pre-update backups were full copies of the database kept forever.
// ---------------------------------------------------------------------------

describe("WorldManager backup retention by type", () => {
  /** Drop a placeholder backup file with a canonical name and timestamp. */
  function seedBackup(dataDir: string, slug: string, filename: string): void {
    writeFileSync(join(dataDir, "worlds", slug, "backups", filename), "not-a-real-db", "utf8");
  }

  it("prunes every type down to its own limit, keeping the newest", () => {
    const dataDir = newTempDir();
    const retention = {
      auto: 3,
      "pre-migration": 2,
      "pre-delete": 2,
      "pre-restore": 1,
      "pre-update": 2,
    } as const;
    const wm = new WorldManager({ dataDir, backupRetention: retention });
    wm.create({ title: "Retention World", system: "pf2e", slug: "ret_bk" });

    const base = 1_700_000_000_000;
    const kinds = ["auto", "manual", "pre-migration", "pre-delete", "pre-restore"] as const;

    // N+3 of each, with increasing timestamps so "newest" is well defined.
    for (const kind of kinds) {
      const limit = kind === "manual" ? 0 : retention[kind];
      for (let i = 0; i < limit + 3; i++) {
        seedBackup(dataDir, "ret_bk", `${kind}-${String(base + i)}.db`);
      }
    }
    // pre-update has its own filename shape (REQ-DST-022).
    for (let i = 0; i < retention["pre-update"] + 3; i++) {
      const iso = new Date(base + i).toISOString().replace(/:/g, "-");
      seedBackup(dataDir, "ret_bk", `pre-event-update-1.2.3-${iso}.db`);
    }

    wm.pruneBackups("ret_bk");

    const countOf = (type: string): number =>
      wm.listBackups("ret_bk").filter((b) => b.type === type).length;

    expect(countOf("auto")).toBe(retention.auto);
    expect(countOf("pre-migration")).toBe(retention["pre-migration"]);
    expect(countOf("pre-delete")).toBe(retention["pre-delete"]);
    expect(countOf("pre-restore")).toBe(retention["pre-restore"]);
    expect(countOf("pre-update")).toBe(retention["pre-update"]);

    // Manual backups were asked for by a human — they are never pruned.
    expect(countOf("manual")).toBe(3);

    // The survivors are the most recent ones.
    const autos = wm
      .listBackups("ret_bk")
      .filter((b) => b.type === "auto")
      .map((b) => b.timestamp);
    expect(autos).toEqual([base + 3, base + 4, base + 5]);
  });

  it("prunes pre-migration backups on open", () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir, backupRetention: { "pre-migration": 2 } });
    wm.create({ title: "Migration Backups", system: "pf2e", slug: "mig_bk" });

    const base = 1_700_000_000_000;
    for (let i = 0; i < 5; i++) {
      seedBackup(dataDir, "mig_bk", `pre-migration-${String(base + i)}.db`);
    }

    wm.open("mig_bk");
    wm.close("mig_bk");

    const remaining = wm.listBackups("mig_bk").filter((b) => b.type === "pre-migration");
    expect(remaining).toHaveLength(2);
  });

  it("keeps every backup when the limit is 0 (unlimited)", () => {
    const dataDir = newTempDir();
    const wm = new WorldManager({ dataDir, backupRetention: { auto: 0 } });
    wm.create({ title: "Unlimited", system: "pf2e", slug: "unl_bk" });

    const base = 1_700_000_000_000;
    for (let i = 0; i < 6; i++) {
      seedBackup(dataDir, "unl_bk", `auto-${String(base + i)}.db`);
    }

    expect(wm.pruneBackups("unl_bk")).toEqual([]);
    expect(wm.listBackups("unl_bk").filter((b) => b.type === "auto")).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// closeAll
// ---------------------------------------------------------------------------

describe("WorldManager.closeAll", () => {
  it("closes all open worlds and releases locks", () => {
    const dataDir = newTempDir();
    const wm = makeManager(dataDir);

    wm.create({ title: "World 1", system: "pf2e", slug: "all1" });
    wm.create({ title: "World 2", system: "pf2e", slug: "all2" });

    wm.open("all1");
    wm.open("all2");

    const lockPath1 = join(dataDir, "worlds", "all1", "world.lock");
    const lockPath2 = join(dataDir, "worlds", "all2", "world.lock");

    expect(existsSync(lockPath1)).toBe(true);
    expect(existsSync(lockPath2)).toBe(true);

    wm.closeAll();

    expect(existsSync(lockPath1)).toBe(false);
    expect(existsSync(lockPath2)).toBe(false);
  });
});
