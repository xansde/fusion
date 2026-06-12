/**
 * Migration 002 — Users and sessions tables.
 *
 * Adds the columns needed for auth (password_hash, color, avatar, active,
 * preferences) to the existing `users` table, and creates the `sessions` table
 * for refresh-token storage.
 *
 * REQ-USR-001, REQ-USR-019, REQ-USR-NF-003 (index on sessions)
 * DEC-USR-02 (Argon2id)
 * DEC-USR-03 (refresh token family/reuse detection)
 */

import type { FusionMigration } from "../migrations.js";

export const migration002: FusionMigration = {
  version: 2,
  description: "Auth: add user auth columns + sessions table",

  up(db) {
    // ------------------------------------------------------------------
    // Extend the `users` table
    //
    // SQLite only supports ADD COLUMN — we add the new columns with
    // DEFAULT so existing rows become valid immediately.
    // ------------------------------------------------------------------

    // password_hash: null means "no password required" (DEC-USR-06)
    db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT;`);

    // color: suggested unique hex colour per world (REQ-USR-002)
    db.exec(`ALTER TABLE users ADD COLUMN color TEXT NOT NULL DEFAULT '#888888';`);

    // avatar: relative path or HTTPS URL (REQ-USR-004)
    db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT;`);

    // active: false → user cannot login, hidden from join screen (DEC-USR-01)
    db.exec(`ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;`);

    // preferences: extensible JSON blob (REQ-USR-003)
    db.exec(`ALTER TABLE users ADD COLUMN preferences TEXT NOT NULL DEFAULT '{}';`);

    // ------------------------------------------------------------------
    // sessions table
    //
    // Stores hashed refresh tokens for revocation / rotation.
    // REQ-USR-019 step 5, REQ-USR-020, DEC-USR-03
    // ------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id                  TEXT    PRIMARY KEY NOT NULL,
        user_id             TEXT    NOT NULL REFERENCES users(id),
        refresh_token_hash  TEXT    NOT NULL,
        family_id           TEXT    NOT NULL,
        created_at          INTEGER NOT NULL,
        expires_at          INTEGER NOT NULL,
        revoked_at          INTEGER
      );

      -- REQ-USR-NF-003: index for refresh-token validation
      CREATE INDEX IF NOT EXISTS idx_sessions_user_revoked
        ON sessions(user_id, revoked_at);

      -- Efficient lookup by token hash during refresh
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash
        ON sessions(refresh_token_hash);
    `);

    // ------------------------------------------------------------------
    // login_attempts table — brute-force lockout
    //
    // REQ-USR-023 / REQ-SEC-011: max 5 failures per (ip + user_id) in 15 min
    // ------------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id          TEXT    PRIMARY KEY NOT NULL,
        user_id     TEXT    NOT NULL,
        ip          TEXT    NOT NULL,
        attempted_at INTEGER NOT NULL,
        success     INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_login_attempts_user_ip
        ON login_attempts(user_id, ip, attempted_at);
    `);
  },
};
