/**
 * Fase 5 — Higiene (T026–T029).
 *
 * This suite does NOT add a migration: every item in tasks.md's Fase 5 turned
 * out to need an application-code change outside this task's owned files
 * (`chat/roll-service.ts`, `shared/src/document.ts`, `admin/lockout-db.ts`,
 * `worlds/world-manager.ts` — see tasks.md for the full writeup and the exact
 * patches proposed for each). What survives here is the one finding that is
 * both real and testable without touching any of those files: T028's claim
 * that `login_attempts` is defined twice needs to be verified, not assumed —
 * and once verified, it deserves a regression guard so the two definitions
 * cannot silently drift apart in the future, whoever ends up unifying them.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database as Db } from "better-sqlite3";
import { openDatabase, applyMigrations } from "../db/index.js";
import { openAdminLockoutDb } from "../admin/lockout-db.js";

let tempDirs: string[] = [];

function newTempDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

/**
 * Same normalization `db/migrations.ts`'s schema guard applies before
 * comparing `sqlite_master` DDL (T004): collapse whitespace, tighten spacing
 * around `(`, `)`, `,`. Duplicated here (not exported by migrations.ts)
 * because it is a 3-line formatting helper, not a second copy of the schema
 * itself — the DDL strings being compared still come from the real sources.
 */
function normaliseSql(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

function schemaSql(db: Db, type: "table" | "index", name: string): string | undefined {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = ? AND name = ?`)
    .get(type, name) as { sql: string } | undefined;
  return row ? normaliseSql(row.sql) : undefined;
}

// The migration list comes from importing ../db/index.js, which registers the
// real production set as a side effect. A hardcoded copy here would keep
// building a database at whatever version it was written against, and quietly
// stop comparing the schema the app actually ships — neutralising the drift
// this file exists to catch, on the very day a new migration lands.
describe("Fase 5 (T028) — login_attempts: two files, one schema", () => {
  it("world.db (migration 002) and Config/admin-lockout.sqlite define login_attempts identically", () => {
    // World-scoped copy, produced the same way every real world.db is.
    const worldDir = newTempDir("fusion-hygiene-world");
    const worldDbPath = join(worldDir, "world.db");
    const worldDb = openDatabase({ path: worldDbPath, skipIntegrityCheck: true });
    let worldTableSql: string | undefined;
    let worldIndexSql: string | undefined;
    try {
      applyMigrations(worldDb.raw, worldDbPath);
      worldTableSql = schemaSql(worldDb.raw, "table", "login_attempts");
      worldIndexSql = schemaSql(worldDb.raw, "index", "idx_login_attempts_user_ip");
    } finally {
      worldDb.close();
    }

    // Admin-plane standalone copy, produced the same way the real admin
    // plane produces it — via the actual openAdminLockoutDb(), not a
    // hand-copied DDL string.
    const adminDataDir = newTempDir("fusion-hygiene-admin");
    const adminDb = openAdminLockoutDb(adminDataDir);
    let adminTableSql: string | undefined;
    let adminIndexSql: string | undefined;
    try {
      adminTableSql = schemaSql(adminDb.raw, "table", "login_attempts");
      adminIndexSql = schemaSql(adminDb.raw, "index", "idx_login_attempts_user_ip");
    } finally {
      adminDb.close();
    }

    expect(worldTableSql).toBeDefined();
    expect(adminTableSql).toBeDefined();
    expect(adminTableSql).toBe(worldTableSql);

    expect(worldIndexSql).toBeDefined();
    expect(adminIndexSql).toBeDefined();
    expect(adminIndexSql).toBe(worldIndexSql);
  });
});
