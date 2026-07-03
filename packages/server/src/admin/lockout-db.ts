/**
 * Dedicated SQLite connection for the installation-admin plane's brute-force
 * lockout tracking (REQ-SEC-011, M6 audit fix FIX-3).
 *
 * The admin plane (`/admin/*`) has no world/db dependency by design (see
 * admin/service.ts's module doc comment) — it operates purely on
 * Config/fusion.json plus in-memory port/network probing. There is
 * therefore no existing better-sqlite3 handle to reuse for
 * `auth/lockout.ts`'s LockoutStore (which the world-user login plane already
 * uses via `db/migrations/002_users_sessions.ts`'s `login_attempts` table).
 *
 * Rather than reimplementing a counter (explicitly forbidden by the fix
 * brief — REUSE LockoutStore) or wiring the admin plane into the full
 * world-migration framework (db/migrations.ts's `registerMigrations` is a
 * global singleton scoped to world databases — registering an unrelated
 * admin-only migration there would corrupt every world's migration
 * sequence), this opens a small STANDALONE SQLite file at
 * `<dataDir>/Config/admin-lockout.sqlite` containing only the
 * `login_attempts` table LockoutStore expects — same column shape as
 * migration 002's world-db table, created directly (no migration
 * versioning needed: this file has exactly one schema, ever, isolated from
 * both the multi-version world-db migration path and every other world's
 * data).
 *
 * Opened once per boot (registerAdminRoutes) and kept open for the
 * process's lifetime — mirroring how every other long-lived DB handle in
 * this codebase behaves (world DBs, opened once by WorldManager).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../db/connection.js";
import type { FusionDatabase } from "../db/connection.js";

/**
 * Open (creating if necessary) the admin-plane lockout database at
 * `<dataDir>/Config/admin-lockout.sqlite`, ensuring the `login_attempts`
 * table LockoutStore (auth/lockout.ts) expects exists.
 *
 * `dataDir/Config` is normally already created by `ensureDataDirLayout`
 * (cli/commands/serve.ts phase 2.1) before a real `fusion serve` reaches
 * route registration — but several tests call `boot()` directly against a
 * bare temp dir without going through that layout step (e.g.
 * `__tests__/boot.test.ts`), so `Config/` is created here too,
 * idempotently, rather than assuming it always pre-exists.
 */
export function openAdminLockoutDb(dataDir: string): FusionDatabase {
  mkdirSync(join(dataDir, "Config"), { recursive: true });
  const path = join(dataDir, "Config", "admin-lockout.sqlite");
  // skipIntegrityCheck: this file has a single, fixed, tiny schema created
  // idempotently below — the full PRAGMA integrity_check world DBs run
  // (REQ-PER-005) is proportionate for multi-megabyte world state, not a
  // few-KB lockout counter file recreated trivially if ever corrupted.
  const db = openDatabase({ path, skipIntegrityCheck: true });

  db.raw.exec(`
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

  return db;
}

/**
 * Fixed `userId` passed to LockoutStore for the admin plane: unlike the
 * world-user login plane (one lockout bucket per selectable user), the
 * admin plane has exactly one credential (the Admin Key) — lockout is keyed
 * purely by IP, so a constant subject id keeps LockoutStore's (userId, ip)
 * shape without inventing a second identity system.
 */
export const ADMIN_LOCKOUT_SUBJECT = "fusion-admin";
