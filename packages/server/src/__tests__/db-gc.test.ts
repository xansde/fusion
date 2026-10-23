/**
 * Boot-time GC (T017, D5): expired sessions and stale roll-audit-log rows
 * leave on their own; `chat_messages` never does.
 *
 * The suite proves both halves of "what leaves" and "what stays": every
 * boundary case below is seeded around the exact 30-day / 12-month cutoff,
 * and every assertion checks the SURVIVING rows by id, not just a deleted
 * count — a test that only checks "N rows removed" would pass identically
 * if the wrong N rows were the ones removed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, applyMigrations } from "../db/index.js";
import { runGc, formatGcReport } from "../db/gc.js";
import type { GcReport } from "../db/gc.js";
import { WorldManager } from "../worlds/index.js";

// ---------------------------------------------------------------------------
// Fixed clock — every boundary below is computed relative to this, never to
// the real wall clock, so the suite is deterministic regardless of when it
// runs.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** 2026-01-15T12:00:00.000Z — arbitrary, chosen only to avoid month-end edges. */
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0, 0);

/**
 * The 12-calendar-months-ago boundary, computed WITHOUT calling the
 * production `monthsAgoMs` helper (that would make the test circular — it
 * would only prove the implementation agrees with itself). For a 12-month
 * window this is exactly one year earlier on the same month/day/time, which
 * `Date.UTC` gives unambiguously.
 */
const AUDIT_BOUNDARY = Date.UTC(2025, 0, 15, 12, 0, 0, 0);

// ---------------------------------------------------------------------------
// Temp dirs
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

function newTempDir(prefix: string): string {
  // OS temp dir, like every other test in this suite: never inside the
  // worktree, never under ~/.fusion, and never a machine-specific literal —
  // an absolute Windows path stops being absolute on the Linux CI runner and
  // `join` would quietly grow a `C:` directory inside the checkout.
  const dir = join(
    tmpdir(),
    `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  tempDirs = [];
});

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Best-effort — a lingering handle on Windows must never fail the suite.
    }
  }
});

// ---------------------------------------------------------------------------
// Seed helpers — minimal valid rows per table (FK-safe, CHECK-safe).
// ---------------------------------------------------------------------------

function openMigratedDb(dir: string): { db: Database.Database; close: () => void } {
  const path = join(dir, "world.db");
  const fusionDb = openDatabase({ path, skipIntegrityCheck: true });
  applyMigrations(fusionDb.raw, path);
  return { db: fusionDb.raw, close: () => fusionDb.close() };
}

function insertUser(db: Database.Database, id: string, name: string): void {
  db.prepare(
    `INSERT INTO users (id, data, name, role, created_at, updated_at)
     VALUES (?, '{}', ?, 4, ?, ?)`,
  ).run(id, name, NOW, NOW);
}

function insertSession(db: Database.Database, id: string, userId: string, expiresAt: number): void {
  db.prepare(
    `INSERT INTO sessions (id, user_id, refresh_token_hash, family_id, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(id, userId, `hash-${id}`, `family-${id}`, expiresAt - 30 * MS_PER_DAY, expiresAt);
}

function insertRollAudit(db: Database.Database, id: string, createdAt: number): void {
  db.prepare(
    `INSERT INTO roll_audit_log
       (roll_id, world_id, user_id, actor_id, formula, expanded_formula, total, seed, created_at)
     VALUES (?, 'world-1', 'user-1', NULL, '1d20', '1d20', 10, 12345, ?)`,
  ).run(id, createdAt);
}

function insertChatMessage(db: Database.Database, id: string, createdAt: number): void {
  db.prepare(
    `INSERT INTO chat_messages (id, data, timestamp, author_id, created_at, updated_at)
     VALUES (?, ?, ?, 'user-1', ?, ?)`,
  ).run(id, JSON.stringify({ content: `msg ${id}` }), createdAt, createdAt, createdAt);
}

function sessionIds(db: Database.Database): string[] {
  return (db.prepare(`SELECT id FROM sessions ORDER BY id`).all() as { id: string }[]).map(
    (r) => r.id,
  );
}

function rollAuditIds(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT roll_id FROM roll_audit_log ORDER BY roll_id`).all() as {
      roll_id: string;
    }[]
  ).map((r) => r.roll_id);
}

// ---------------------------------------------------------------------------
// runGc — sessions (boundary: expires_at, strictly > 30 days = deleted)
// ---------------------------------------------------------------------------

describe("runGc — sessions", () => {
  it("deletes only sessions expired for MORE than the retention window, keeping the rest", () => {
    const dir = newTempDir("gc-sessions");
    const { db, close } = openMigratedDb(dir);
    insertUser(db, "u1", "Alice");

    const cutoff = NOW - 30 * MS_PER_DAY;

    // Named so failures point straight at which case broke.
    insertSession(db, "s-well-old", "u1", NOW - 400 * MS_PER_DAY); // age 400d → delete
    insertSession(db, "s-one-ms-past-boundary", "u1", cutoff - 1); // age 30d+1ms → delete
    insertSession(db, "s-exactly-at-boundary", "u1", cutoff); // age exactly 30d → keep
    insertSession(db, "s-one-day-before-boundary", "u1", cutoff + MS_PER_DAY); // age 29d → keep
    insertSession(db, "s-still-valid", "u1", NOW + MS_PER_DAY); // not expired at all → keep

    const before = sessionIds(db);
    expect(before).toHaveLength(5);

    const report = runGc(db, { sessionRetentionDays: 30, auditRetentionMonths: 12, now: NOW });

    expect(report.sessions.skipped).toBe(false);
    expect(report.sessions.deleted).toBe(2);

    const survivors = sessionIds(db);
    expect(survivors).toEqual(
      ["s-exactly-at-boundary", "s-one-day-before-boundary", "s-still-valid"].sort(),
    );

    close();
  });
});

// ---------------------------------------------------------------------------
// runGc — roll_audit_log (boundary: created_at, strictly > 12 months = deleted)
// ---------------------------------------------------------------------------

describe("runGc — roll_audit_log", () => {
  it("deletes only rolls older than the retention window, keeping the rest", () => {
    const dir = newTempDir("gc-audit");
    const { db, close } = openMigratedDb(dir);

    insertRollAudit(db, "r-well-old", NOW - 800 * MS_PER_DAY); // ~2.2y → delete
    insertRollAudit(db, "r-one-ms-past-boundary", AUDIT_BOUNDARY - 1); // 12mo + 1ms → delete
    insertRollAudit(db, "r-exactly-at-boundary", AUDIT_BOUNDARY); // exactly 12mo → keep
    insertRollAudit(db, "r-recent", NOW - 1 * MS_PER_DAY); // 1 day → keep

    const before = rollAuditIds(db);
    expect(before).toHaveLength(4);

    const report = runGc(db, { sessionRetentionDays: 30, auditRetentionMonths: 12, now: NOW });

    expect(report.rollAuditLog.skipped).toBe(false);
    expect(report.rollAuditLog.deleted).toBe(2);

    const survivors = rollAuditIds(db);
    expect(survivors).toEqual(["r-exactly-at-boundary", "r-recent"].sort());

    close();
  });
});

// ---------------------------------------------------------------------------
// runGc — chat_messages is NEVER touched (D5)
// ---------------------------------------------------------------------------

describe("runGc — chat_messages", () => {
  it("leaves ancient chat rows byte-for-byte untouched", () => {
    const dir = newTempDir("gc-chat");
    const { db, close } = openMigratedDb(dir);
    insertUser(db, "u1", "Alice");

    // An 8-year-old message — far older than either retention window.
    const ancientTimestamp = NOW - 3000 * MS_PER_DAY;
    insertChatMessage(db, "m-ancient", ancientTimestamp);
    // Also seed old sessions/audit rows in the SAME db so a bug that GCs
    // "everything old" instead of "the two named tables" would be caught.
    insertSession(db, "s-old", "u1", NOW - 400 * MS_PER_DAY);
    insertRollAudit(db, "r-old", NOW - 800 * MS_PER_DAY);

    const before = db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get("m-ancient");
    expect(before).toBeDefined();

    const report = runGc(db, { sessionRetentionDays: 30, auditRetentionMonths: 12, now: NOW });

    // Sanity: the other two tables DID lose their old rows in this same run.
    expect(report.sessions.deleted).toBe(1);
    expect(report.rollAuditLog.deleted).toBe(1);

    const after = db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get("m-ancient");
    expect(after).toEqual(before);

    const count = db.prepare(`SELECT COUNT(*) AS n FROM chat_messages`).get() as { n: number };
    expect(count.n).toBe(1);

    close();
  });
});

// ---------------------------------------------------------------------------
// runGc — disabled targets (0 / null must mean "skip", never "collect everything")
// ---------------------------------------------------------------------------

describe("runGc — disabled targets", () => {
  it("sessionRetentionDays: 0 skips sessions entirely, even though old rows exist", () => {
    const dir = newTempDir("gc-disabled-sessions");
    const { db, close } = openMigratedDb(dir);
    insertUser(db, "u1", "Alice");
    insertSession(db, "s-ancient", "u1", NOW - 5000 * MS_PER_DAY);

    const report = runGc(db, { sessionRetentionDays: 0, auditRetentionMonths: 12, now: NOW });

    expect(report.sessions).toEqual({ table: "sessions", deleted: 0, skipped: true });
    expect(sessionIds(db)).toEqual(["s-ancient"]);

    close();
  });

  it("auditRetentionMonths: null skips the audit log entirely, even though old rows exist", () => {
    const dir = newTempDir("gc-disabled-audit");
    const { db, close } = openMigratedDb(dir);
    insertRollAudit(db, "r-ancient", NOW - 5000 * MS_PER_DAY);

    const report = runGc(db, { sessionRetentionDays: 30, auditRetentionMonths: null, now: NOW });

    expect(report.rollAuditLog).toEqual({ table: "roll_audit_log", deleted: 0, skipped: true });
    expect(rollAuditIds(db)).toEqual(["r-ancient"]);

    close();
  });

  it("both disabled (0 and null) removes nothing from either table", () => {
    const dir = newTempDir("gc-disabled-both");
    const { db, close } = openMigratedDb(dir);
    insertUser(db, "u1", "Alice");
    insertSession(db, "s-ancient", "u1", NOW - 5000 * MS_PER_DAY);
    insertRollAudit(db, "r-ancient", NOW - 5000 * MS_PER_DAY);

    const report = runGc(db, { sessionRetentionDays: 0, auditRetentionMonths: null, now: NOW });

    expect(report.sessions.deleted).toBe(0);
    expect(report.rollAuditLog.deleted).toBe(0);
    expect(sessionIds(db)).toEqual(["s-ancient"]);
    expect(rollAuditIds(db)).toEqual(["r-ancient"]);

    close();
  });

  it("omitting both options entirely also skips both (undefined is disabled, not 'collect everything')", () => {
    const dir = newTempDir("gc-disabled-omitted");
    const { db, close } = openMigratedDb(dir);
    insertUser(db, "u1", "Alice");
    insertSession(db, "s-ancient", "u1", NOW - 5000 * MS_PER_DAY);
    insertRollAudit(db, "r-ancient", NOW - 5000 * MS_PER_DAY);

    const report = runGc(db, { now: NOW });

    expect(report.sessions).toEqual({ table: "sessions", deleted: 0, skipped: true });
    expect(report.rollAuditLog).toEqual({ table: "roll_audit_log", deleted: 0, skipped: true });

    close();
  });
});

// ---------------------------------------------------------------------------
// formatGcReport
// ---------------------------------------------------------------------------

describe("formatGcReport", () => {
  it("returns null when nothing was removed (no boot-log noise on the common case)", () => {
    const report: GcReport = {
      sessions: { table: "sessions", deleted: 0, skipped: false },
      rollAuditLog: { table: "roll_audit_log", deleted: 0, skipped: false },
    };
    expect(formatGcReport(report)).toBeNull();
  });

  it("returns null when both targets were merely skipped (disabled), not run with zero hits", () => {
    const report: GcReport = {
      sessions: { table: "sessions", deleted: 0, skipped: true },
      rollAuditLog: { table: "roll_audit_log", deleted: 0, skipped: true },
    };
    expect(formatGcReport(report)).toBeNull();
  });

  it("names both counts when both targets removed rows", () => {
    const report: GcReport = {
      sessions: { table: "sessions", deleted: 3, skipped: false },
      rollAuditLog: { table: "roll_audit_log", deleted: 7, skipped: false },
    };
    const line = formatGcReport(report);
    expect(line).toContain("3 expired session(s)");
    expect(line).toContain("7 stale roll-audit-log row(s)");
  });

  it("names only the target that actually removed rows", () => {
    const report: GcReport = {
      sessions: { table: "sessions", deleted: 2, skipped: false },
      rollAuditLog: { table: "roll_audit_log", deleted: 0, skipped: false },
    };
    const line = formatGcReport(report);
    expect(line).toContain("2 expired session(s)");
    expect(line).not.toContain("roll-audit-log");
  });
});

// ---------------------------------------------------------------------------
// WorldManager.open() actually runs GC at boot (T017 — "GC no boot", not just
// a standalone function nobody calls).
// ---------------------------------------------------------------------------

describe("WorldManager.open() — GC wiring", () => {
  it("removes expired sessions and stale audit rows on open, and leaves chat alone", () => {
    const dataDir = newTempDir("gc-worldmanager");
    const manager = new WorldManager({ dataDir });
    const manifest = manager.create({ slug: "gc_world", system: "stub", title: "GC World" });

    // Seed directly on the closed world.db — real wall-clock timestamps
    // (WorldManager has no injectable clock), far outside any retention
    // window so the test is not sensitive to exactly when it runs.
    const dbPath = join(dataDir, "worlds", manifest.id, "world.db");
    const seedDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    insertUser(seedDb.raw, "u1", "Alice");
    insertSession(seedDb.raw, "s-ancient", "u1", Date.now() - 400 * MS_PER_DAY);
    insertSession(seedDb.raw, "s-fresh", "u1", Date.now() + MS_PER_DAY);
    insertRollAudit(seedDb.raw, "r-ancient", Date.now() - 800 * MS_PER_DAY);
    insertChatMessage(seedDb.raw, "m-ancient", Date.now() - 3000 * MS_PER_DAY);
    seedDb.close();

    manager.open("gc_world");
    const openDb = manager.getDatabase("gc_world");
    expect(openDb).not.toBeNull();
    const raw = openDb!.raw;

    expect(sessionIds(raw)).toEqual(["s-fresh"]);
    expect(rollAuditIds(raw)).toEqual([]);
    const chatRow = raw.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get("m-ancient");
    expect(chatRow).toBeDefined();

    manager.close("gc_world");
  });

  it("gcOptions with retention 0/null on the manager disables GC for every world it opens", () => {
    const dataDir = newTempDir("gc-worldmanager-disabled");
    const manager = new WorldManager({
      dataDir,
      gcOptions: { sessionRetentionDays: 0, auditRetentionMonths: 0 },
    });
    const manifest = manager.create({ slug: "gc_world_off", system: "stub", title: "GC Off" });

    const dbPath = join(dataDir, "worlds", manifest.id, "world.db");
    const seedDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    insertUser(seedDb.raw, "u1", "Alice");
    insertSession(seedDb.raw, "s-ancient", "u1", Date.now() - 5000 * MS_PER_DAY);
    insertRollAudit(seedDb.raw, "r-ancient", Date.now() - 5000 * MS_PER_DAY);
    seedDb.close();

    manager.open("gc_world_off");
    const raw = manager.getDatabase("gc_world_off")!.raw;

    expect(sessionIds(raw)).toEqual(["s-ancient"]);
    expect(rollAuditIds(raw)).toEqual(["r-ancient"]);

    manager.close("gc_world_off");
  });
});
