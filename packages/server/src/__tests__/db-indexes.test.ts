/**
 * Migrations 007 and 008 — indexes that match real queries (T009) and a single
 * source of truth for the active scene (T010).
 *
 * The index assertions run the SQL the server actually runs, copied from
 * `chat/chat-handler.ts` and `auth/user-store.ts`, through EXPLAIN QUERY PLAN.
 * Asserting that the index *exists* would prove nothing: an index SQLite
 * declines to use is the same as no index at all, which is precisely how
 * `idx_chat_timestamp` ended up not covering the pagination it was created for.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, applyMigrations, checkSchema, getSchemaVersion } from "../db/index.js";
import type { FusionDatabase } from "../db/index.js";

let tempDirs: string[] = [];

function newTempDir(): string {
  // Never inside the worktree: a stray `git add -A` would commit world data.
  const dir = join(
    tmpdir(),
    `fusion-indexes-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/** A migrated world at the head of the migration list. */
function openMigratedWorld(): FusionDatabase {
  const path = join(newTempDir(), "world.db");
  const db = openDatabase({ path, skipIntegrityCheck: true });
  applyMigrations(db.raw, path);
  return db;
}

function queryPlan(db: FusionDatabase, sql: string, ...params: unknown[]): string {
  const rows = db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as {
    detail: string;
  }[];
  return rows.map((r) => r.detail).join(" | ");
}

function indexNames(db: FusionDatabase): string[] {
  const rows = db.raw
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL`)
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

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

describe("migration 007 — indexes serve the queries the server runs (T009)", () => {
  it("chat keyset pagination is answered by an index, in order", () => {
    const db = openMigratedWorld();
    try {
      // Copied from chat/chat-handler.ts (the `before` cursor branch).
      const plan = queryPlan(
        db,
        `SELECT id, data, timestamp FROM chat_messages
          WHERE timestamp < ? OR (timestamp = ? AND id < ?)
          ORDER BY timestamp DESC, id DESC
          LIMIT ?`,
        1000,
        1000,
        "msg-1",
        50,
      );

      expect(plan).toContain("idx_chat_ts_id");
      // No separate sorting pass: the index already carries the order.
      expect(plan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
    } finally {
      db.close();
    }
  });

  it("the first page of chat history is read in index order too", () => {
    const db = openMigratedWorld();
    try {
      const plan = queryPlan(
        db,
        `SELECT id, data, timestamp FROM chat_messages
          ORDER BY timestamp DESC, id DESC
          LIMIT ?`,
        50,
      );

      expect(plan).toContain("idx_chat_ts_id");
      expect(plan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
    } finally {
      db.close();
    }
  });

  it("findByName stops scanning the whole users table", () => {
    const db = openMigratedWorld();
    try {
      // Copied from auth/user-store.ts. The index has to carry NOCASE too,
      // or SQLite will not use it for this comparison.
      const plan = queryPlan(db, `SELECT * FROM users WHERE name = ? COLLATE NOCASE`, "Gamemaster");

      expect(plan).toContain("idx_users_name_nocase");
      expect(plan).not.toMatch(/SCAN users(?! USING)/);
    } finally {
      db.close();
    }
  });

  it("declares the chat index in the direction the pagination reads", () => {
    const db = openMigratedWorld();
    try {
      // EXPLAIN alone would not catch a missing DESC: SQLite happily walks an
      // ascending index backwards, so the plan looks the same either way. The
      // declared direction is what keeps that from being luck.
      const ddl = db.raw
        .prepare(`SELECT sql FROM sqlite_master WHERE name='idx_chat_ts_id'`)
        .get() as { sql: string };
      expect(ddl.sql).toMatch(/timestamp\s+DESC\s*,\s*id\s+DESC/i);
    } finally {
      db.close();
    }
  });

  it("drops the indexes nothing queries", () => {
    const db = openMigratedWorld();
    try {
      const names = indexNames(db);

      // navigation is never filtered or ordered by, anywhere.
      expect(names).not.toContain("idx_scenes_nav");
      // Fully covered by idx_chat_ts_id — two index writes per message for one
      // index's worth of use.
      expect(names).not.toContain("idx_chat_timestamp");
    } finally {
      db.close();
    }
  });
});

describe("migration 008 — the active scene lives in one place (T010)", () => {
  it("removes the scenes.active column and its index", () => {
    const db = openMigratedWorld();
    try {
      // At least 8: this case is about what migration 008 removed, not about
      // where the migration head happens to be. Pinning the exact head here
      // made every later migration fail a test that has nothing to do with it.
      expect(getSchemaVersion(db.raw)).toBeGreaterThanOrEqual(8);

      const columns = (db.raw.pragma("table_info(scenes)") as { name: string }[]).map(
        (c) => c.name,
      );
      expect(columns).not.toContain("active");
      // The rest of the extracted columns are untouched.
      expect(columns).toContain("navigation");
      expect(columns).toContain("name");

      expect(indexNames(db)).not.toContain("idx_scenes_active");
      expect(checkSchema(db.raw).ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it("carries an existing world's scenes across, document contents intact", () => {
    // A scene written before the migration keeps its JSON — including the
    // `active` field, which stays as the document-level mirror.
    const path = join(newTempDir(), "world.db");
    const before = openDatabase({ path, skipIntegrityCheck: true });
    applyMigrations(before.raw, path);
    before.raw
      .prepare(
        `INSERT INTO scenes (id, data, name, navigation, sort, created_at, updated_at)
         VALUES ('sc1', ?, 'Vale de Godford', 1, 0, 1, 1)`,
      )
      .run(JSON.stringify({ _id: "sc1", name: "Vale de Godford", active: true }));
    before.close();

    const after = openDatabase({ path, skipIntegrityCheck: true });
    try {
      applyMigrations(after.raw, path);

      const row = after.raw.prepare(`SELECT data, name FROM scenes WHERE id='sc1'`).get() as {
        data: string;
        name: string;
      };
      expect(row.name).toBe("Vale de Godford");
      expect(JSON.parse(row.data)).toEqual({
        _id: "sc1",
        name: "Vale de Godford",
        active: true,
      });
    } finally {
      after.close();
    }
  });
});
