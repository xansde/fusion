/**
 * Migration 006 — constraints on users and sessions (T008).
 *
 * A table rebuild is the most destructive thing this plan does, and the shape
 * of the failure is specific: with foreign keys on (they always are — see the
 * migration's header), dropping `users` while any row of `sessions` points at
 * it fails outright. A test that starts from an empty temp directory never
 * sees it, because dropping a table with zero rows never violates anything.
 * So the first test here populates both tables before migrating.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openDatabase,
  applyMigrations,
  checkSchema,
  getSchemaVersion,
  registerMigrations,
  MigrationError,
} from "../db/index.js";
import type { FusionMigration, FusionDatabase } from "../db/index.js";
import { migration001 } from "../db/migrations/001_initial_schema.js";
import { migration002 } from "../db/migrations/002_users_sessions.js";
import { migration003 } from "../db/migrations/003_fog_exploration.js";
import { migration004 } from "../db/migrations/004_region_maps.js";
import { migration005 } from "../db/migrations/005_roll_audit_log.js";
import { migration006 } from "../db/migrations/006_constraints.js";

const UP_TO_5: FusionMigration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
];
const ALL: FusionMigration[] = [...UP_TO_5, migration006];

let tempDirs: string[] = [];

function newTempDir(): string {
  // Never inside the worktree: a stray `git add -A` would commit world data.
  const dir = join(
    tmpdir(),
    `fusion-constraints-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

interface UserSeed {
  id: string;
  name: string;
  role: number;
  active?: number;
}

/** A world at version 5 with users and sessions in it, ready to be migrated. */
function seedPopulatedWorld(path: string, users: UserSeed[], sessionsPerUser: number): void {
  registerMigrations(UP_TO_5);
  const db = openDatabase({ path, skipIntegrityCheck: true });
  try {
    applyMigrations(db.raw, path);

    const insertUser = db.raw.prepare(
      `INSERT INTO users
         (id, data, name, role, created_at, updated_at,
          password_hash, color, avatar, active, preferences)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertSession = db.raw.prepare(
      `INSERT INTO sessions
         (id, user_id, refresh_token_hash, family_id, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const u of users) {
      insertUser.run(
        u.id,
        JSON.stringify({ _id: u.id, name: u.name, role: u.role }),
        u.name,
        u.role,
        1000,
        2000,
        `hash-${u.id}`,
        "#abcdef",
        null,
        u.active ?? 1,
        "{}",
      );
      for (let i = 0; i < sessionsPerUser; i += 1) {
        insertSession.run(
          `sess-${u.id}-${String(i)}`,
          u.id,
          `token-${u.id}-${String(i)}`,
          `fam-${u.id}`,
          1000,
          9999,
          null,
        );
      }
    }
  } finally {
    db.close();
  }
}

/** Migrate a seeded world to the head of the migration list. */
function migrateToHead(path: string): FusionDatabase {
  registerMigrations(ALL);
  const db = openDatabase({ path, skipIntegrityCheck: true });
  applyMigrations(db.raw, path);
  return db;
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

describe("migration 006 — rebuilding populated tables (T008)", () => {
  it("rebuilds users and sessions with rows in them, losing nothing", () => {
    const path = join(newTempDir(), "world.db");
    seedPopulatedWorld(
      path,
      [
        { id: "u-gm", name: "Gamemaster", role: 4 },
        { id: "u-pc", name: "Tobias", role: 1 },
      ],
      3,
    );

    const db = migrateToHead(path);
    try {
      expect(getSchemaVersion(db.raw)).toBe(6);

      const users = db.raw
        .prepare(
          `SELECT id, name, role, color, active, preferences, password_hash FROM users
                   ORDER BY id`,
        )
        .all() as Record<string, unknown>[];
      expect(users).toEqual([
        {
          id: "u-gm",
          name: "Gamemaster",
          role: 4,
          color: "#abcdef",
          active: 1,
          preferences: "{}",
          password_hash: "hash-u-gm",
        },
        {
          id: "u-pc",
          name: "Tobias",
          role: 1,
          color: "#abcdef",
          active: 1,
          preferences: "{}",
          password_hash: "hash-u-pc",
        },
      ]);

      const sessions = db.raw.prepare(`SELECT COUNT(*) AS c FROM sessions`).get() as { c: number };
      expect(sessions.c).toBe(6);

      const sample = db.raw
        .prepare(
          `SELECT user_id, refresh_token_hash, family_id, expires_at FROM sessions
                   WHERE id = 'sess-u-pc-1'`,
        )
        .get() as Record<string, unknown>;
      expect(sample).toEqual({
        user_id: "u-pc",
        refresh_token_hash: "token-u-pc-1",
        family_id: "fam-u-pc",
        expires_at: 9999,
      });

      // The world is sound in the guard's eyes, not just in ours.
      expect(checkSchema(db.raw).ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it("keeps the session indexes the rebuild dropped along with the old table", () => {
    const path = join(newTempDir(), "world.db");
    seedPopulatedWorld(path, [{ id: "u1", name: "Solo", role: 4 }], 1);

    const db = migrateToHead(path);
    try {
      const indexes = db.raw
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL
                   ORDER BY name`,
        )
        .all() as { name: string }[];
      const names = indexes.map((i) => i.name);

      expect(names).toContain("idx_sessions_user_revoked");
      expect(names).toContain("idx_sessions_token_hash");
      expect(names).toContain("idx_users_name_nocase");

      // The token index carries the only guarantee that two sessions cannot
      // share a refresh token — losing its uniqueness would be silent.
      const tokenIdx = db.raw
        .prepare(`SELECT sql FROM sqlite_master WHERE name='idx_sessions_token_hash'`)
        .get() as { sql: string };
      expect(tokenIdx.sql).toContain("UNIQUE");
    } finally {
      db.close();
    }
  });

  it("still accepts the minimal insert the generic document path uses", () => {
    const path = join(newTempDir(), "world.db");
    seedPopulatedWorld(path, [{ id: "u1", name: "Solo", role: 4 }], 0);

    const db = migrateToHead(path);
    try {
      // doc:create for a User fills only these six columns and relies on the
      // defaults for the rest. Rebuilding the table must not change that.
      expect(() => {
        db.raw
          .prepare(
            `INSERT INTO users (id, data, name, role, created_at, updated_at)
             VALUES ('u2', '{}', 'Generic', 1, 1, 1)`,
          )
          .run();
      }).not.toThrow();

      const row = db.raw
        .prepare(`SELECT color, active, preferences FROM users WHERE id='u2'`)
        .get();
      expect(row).toEqual({ color: "#888888", active: 1, preferences: "{}" });
    } finally {
      db.close();
    }
  });
});

describe("migration 006 — the rules are enforced by the database", () => {
  function openMigrated(): { db: FusionDatabase; path: string } {
    const path = join(newTempDir(), "world.db");
    seedPopulatedWorld(path, [{ id: "u-gm", name: "Gamemaster", role: 4 }], 2);
    return { db: migrateToHead(path), path };
  }

  it("rejects a role outside the enum", () => {
    const { db } = openMigrated();
    try {
      expect(() => {
        db.raw
          .prepare(
            `INSERT INTO users (id, data, name, role, created_at, updated_at)
             VALUES ('bad', '{}', 'Impostor', 9, 1, 1)`,
          )
          .run();
      }).toThrow(/CHECK constraint failed/i);
    } finally {
      db.close();
    }
  });

  it("rejects an active flag that is not a boolean", () => {
    const { db } = openMigrated();
    try {
      expect(() => {
        db.raw
          .prepare(
            `INSERT INTO users (id, data, name, role, active, created_at, updated_at)
             VALUES ('bad', '{}', 'Impostor', 1, 2, 1, 1)`,
          )
          .run();
      }).toThrow(/CHECK constraint failed/i);
    } finally {
      db.close();
    }
  });

  it("rejects a name that only differs in case — the race findByName could not win", () => {
    const { db } = openMigrated();
    try {
      expect(() => {
        db.raw
          .prepare(
            `INSERT INTO users (id, data, name, role, created_at, updated_at)
             VALUES ('dupe', '{}', 'gameMASTER', 1, 1, 1)`,
          )
          .run();
      }).toThrow(/UNIQUE constraint failed/i);
    } finally {
      db.close();
    }
  });

  it("takes a user's sessions with them on delete", () => {
    const { db } = openMigrated();
    try {
      const before = db.raw.prepare(`SELECT COUNT(*) AS c FROM sessions`).get() as { c: number };
      expect(before.c).toBe(2);

      db.raw.prepare(`DELETE FROM users WHERE id = 'u-gm'`).run();

      const after = db.raw.prepare(`SELECT COUNT(*) AS c FROM sessions`).get() as { c: number };
      expect(after.c).toBe(0);
    } finally {
      db.close();
    }
  });

  it("still refuses a session pointing at nobody", () => {
    const { db } = openMigrated();
    try {
      expect(() => {
        db.raw
          .prepare(
            `INSERT INTO sessions
               (id, user_id, refresh_token_hash, family_id, created_at, expires_at)
             VALUES ('ghost', 'nobody', 'tok', 'fam', 1, 2)`,
          )
          .run();
      }).toThrow(/FOREIGN KEY constraint failed/i);
    } finally {
      db.close();
    }
  });
});

describe("migration 006 — pre-flight refuses bad data with an actionable message", () => {
  it("names the user whose role is out of range, and changes nothing", () => {
    const path = join(newTempDir(), "world.db");
    seedPopulatedWorld(path, [{ id: "u-gm", name: "Gamemaster", role: 4 }], 1);

    // A value no code path produces today — the world we have not seen.
    registerMigrations(UP_TO_5);
    const seeded = openDatabase({ path, skipIntegrityCheck: true });
    seeded.raw.prepare(`UPDATE users SET role = 9 WHERE id = 'u-gm'`).run();
    seeded.close();

    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      let thrown: unknown;
      try {
        applyMigrations(db.raw, path);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(MigrationError);
      const message = (thrown as Error).message;
      expect(message).toContain("u-gm");
      expect(message).toContain("role 9");
      expect(message).toContain("backups");
      expect(message).not.toContain("    at "); // a message, not a stack trace

      // Rolled back: still at 5, and the old table is untouched.
      expect(getSchemaVersion(db.raw)).toBe(5);
      const users = db.raw.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number };
      expect(users.c).toBe(1);
      const sessions = db.raw.prepare(`SELECT COUNT(*) AS c FROM sessions`).get() as { c: number };
      expect(sessions.c).toBe(1);
    } finally {
      db.close();
    }
  });

  it("reports names that collide only by case before trying to enforce uniqueness", () => {
    const path = join(newTempDir(), "world.db");
    seedPopulatedWorld(
      path,
      [
        { id: "u1", name: "Narrador", role: 4 },
        { id: "u2", name: "narrador", role: 1 },
      ],
      0,
    );

    registerMigrations(ALL);
    const db = openDatabase({ path, skipIntegrityCheck: true });
    try {
      let thrown: unknown;
      try {
        applyMigrations(db.raw, path);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(MigrationError);
      expect((thrown as Error).message).toMatch(/share the name "[Nn]arrador"/);
      expect(getSchemaVersion(db.raw)).toBe(5);
    } finally {
      db.close();
    }
  });
});
