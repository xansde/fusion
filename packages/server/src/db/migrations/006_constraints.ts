/**
 * Migration 006 — Constraints on users and sessions (T008).
 *
 * SQLite has no `ALTER TABLE … ADD CONSTRAINT`, so both tables are rebuilt:
 * new table, copy, drop, rename.
 *
 * What this closes:
 *  - `users.name` had no uniqueness at all. It was enforced by reading before
 *    writing (`auth/user-store.ts` findByName, then INSERT), which is a
 *    time-of-check/time-of-use race: two concurrent creations both pass the
 *    check and both insert.
 *  - `users.role` and `users.active` accepted any integer. The role enum is
 *    1..4 (PLAYER, TRUSTED, ASSISTANT, GAMEMASTER) and `active` is a boolean
 *    kept as 0/1 — nothing in the schema said so.
 *  - `sessions.user_id` referenced `users(id)` with the implicit NO ACTION, so
 *    the day "delete a user" exists it would fail on a constraint instead of
 *    taking that user's sessions with it.
 *
 * ORDER MATTERS, and not for the reason the plan assumed. The plan called for
 * `PRAGMA foreign_keys = OFF` during the rebuild — but `applyMigrations` runs
 * every migration inside a transaction, and SQLite silently ignores that
 * pragma while a transaction is open. It stays ON here no matter what we ask,
 * which makes `DROP TABLE users` fail with FOREIGN KEY constraint failed on
 * any world that has sessions (the live world has 29).
 *
 * The way out needs no pragma at all: drop the CHILD before the PARENT. Once
 * the old `sessions` is gone, nothing references the old `users`, and dropping
 * it is a plain delete of rows nobody points at. The foreign key stays enforced
 * throughout, and survives the rename — verified, not assumed.
 *
 * The pre-flight checks exist because the alternative is a boot that dies on
 * "CHECK constraint failed" with no indication of which row is at fault. Every
 * world on disk was audited before this migration was written (8 of them: roles
 * only 1 and 4, no case-colliding names, no orphan sessions), so these checks
 * are expected to pass — they are here for the world we have not seen.
 *
 * REQ-USR-005 (roles), REQ-USR-NF-003 (session lifecycle).
 */

import type { Database as Db } from "better-sqlite3";

import type { FusionMigration } from "../migrations.js";

/**
 * Lowest and highest values of the Role enum in `auth/user-store.ts`, as of
 * this migration. Used by the pre-flight check only — the DDL below spells the
 * range out literally, because an applied migration is frozen history: if the
 * enum ever grows, that is a new migration, not an edit to this one.
 */
const ROLE_MIN = 1;
const ROLE_MAX = 4;

interface OffendingUser {
  id: string;
  name: string;
  role: number;
  active: number;
}

interface NameCollision {
  name: string;
  count: number;
}

/**
 * Refuse to rebuild the table while data would violate the new rules, and say
 * exactly which rows are the problem.
 */
function assertDataFitsConstraints(db: Db): void {
  const badRole = db
    .prepare(
      `SELECT id, name, role, active FROM users
        WHERE role IS NULL OR role < ? OR role > ?`,
    )
    .all(ROLE_MIN, ROLE_MAX) as OffendingUser[];

  const badActive = db
    .prepare(`SELECT id, name, role, active FROM users WHERE active NOT IN (0, 1)`)
    .all() as OffendingUser[];

  const collisions = db
    .prepare(
      `SELECT name, COUNT(*) AS count FROM users
        GROUP BY name COLLATE NOCASE HAVING COUNT(*) > 1`,
    )
    .all() as NameCollision[];

  const orphanSessions = db
    .prepare(
      `SELECT COUNT(*) AS count FROM sessions s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE u.id IS NULL`,
    )
    .get() as { count: number };

  const problems: string[] = [];

  for (const u of badRole) {
    problems.push(
      `user ${u.id} ("${u.name}") has role ${String(u.role)}, outside ${String(ROLE_MIN)}..${String(ROLE_MAX)}`,
    );
  }
  for (const u of badActive) {
    problems.push(`user ${u.id} ("${u.name}") has active ${String(u.active)}, expected 0 or 1`);
  }
  for (const c of collisions) {
    problems.push(
      `${String(c.count)} users share the name "${c.name}" ignoring case — names become unique here`,
    );
  }
  if (orphanSessions.count > 0) {
    problems.push(`${String(orphanSessions.count)} sessions point at a user that no longer exists`);
  }

  if (problems.length === 0) return;

  throw new Error(
    [
      `This world's data does not satisfy the constraints migration 006 adds:`,
      ...problems.map((p) => `  - ${p}`),
      ``,
      `Nothing was changed. A pre-migration backup of this world is in the`,
      `"backups" folder next to world.db. Fix the rows above (or restore that`,
      `backup) and open the world again.`,
    ].join("\n"),
  );
}

export const migration006: FusionMigration = {
  version: 6,
  description: "Constraints: users CHECK/UNIQUE name, sessions FK ON DELETE CASCADE (T008)",

  up(db) {
    assertDataFitsConstraints(db);

    // Column order is kept exactly as the ALTER TABLE ADD COLUMNs in migration
    // 002 left it, and every DEFAULT is reproduced verbatim: `DocumentStore`
    // creates users through the generic doc:create path with only
    // (id, data, name, role, created_at, updated_at) and leans on the rest.
    db.exec(`
      CREATE TABLE users_new (
        id            TEXT    PRIMARY KEY NOT NULL,
        data          TEXT    NOT NULL,
        name          TEXT    NOT NULL,
        role          INTEGER NOT NULL DEFAULT 1,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        password_hash TEXT,
        color         TEXT    NOT NULL DEFAULT '#888888',
        avatar        TEXT,
        active        INTEGER NOT NULL DEFAULT 1,
        preferences   TEXT    NOT NULL DEFAULT '{}',
        CHECK (role BETWEEN 1 AND 4),
        CHECK (active IN (0, 1))
      );

      INSERT INTO users_new
        (id, data, name, role, created_at, updated_at,
         password_hash, color, avatar, active, preferences)
      SELECT
         id, data, name, role, created_at, updated_at,
         password_hash, color, avatar, active, preferences
        FROM users;

      CREATE TABLE sessions_new (
        id                 TEXT    PRIMARY KEY NOT NULL,
        user_id            TEXT    NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
        refresh_token_hash TEXT    NOT NULL,
        family_id          TEXT    NOT NULL,
        created_at         INTEGER NOT NULL,
        expires_at         INTEGER NOT NULL,
        revoked_at         INTEGER
      );

      INSERT INTO sessions_new
        (id, user_id, refresh_token_hash, family_id, created_at, expires_at, revoked_at)
      SELECT
         id, user_id, refresh_token_hash, family_id, created_at, expires_at, revoked_at
        FROM sessions;

      DROP TABLE sessions;
      DROP TABLE users;

      ALTER TABLE users_new RENAME TO users;
      ALTER TABLE sessions_new RENAME TO sessions;
    `);

    // The old indexes went down with their tables. Recreate them, plus the one
    // that makes the name rule real: a unique index with the same collation the
    // lookup uses, so it both enforces uniqueness and serves findByName —
    // SQLite only reaches for an index on a `COLLATE NOCASE` comparison when
    // the index carries that collation too.
    db.exec(`
      CREATE INDEX idx_sessions_user_revoked ON sessions(user_id, revoked_at);
      CREATE UNIQUE INDEX idx_sessions_token_hash ON sessions(refresh_token_hash);
      CREATE UNIQUE INDEX idx_users_name_nocase ON users(name COLLATE NOCASE);
    `);

    // Cheap last word: the rebuilt references actually resolve.
    const violations = db.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new Error(
        `foreign_key_check found ${String(violations.length)} violation(s) after rebuilding users/sessions`,
      );
    }
  },
};
