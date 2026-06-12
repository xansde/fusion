/**
 * Brute-force lockout for login attempts.
 *
 * REQ-USR-023 / REQ-SEC-011:
 *   - Max 5 failed attempts per (ip, userId) in 15 minutes.
 *   - After exceeding the limit: HTTP 429 with Retry-After.
 *
 * REQ-SEC-012: uniform error messages regardless of whether user exists.
 *
 * The login_attempts table is queried synchronously (better-sqlite3).
 */

import type { Database as Db } from "better-sqlite3";
import { createDocumentId } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// LockoutStore
// ---------------------------------------------------------------------------

export class LockoutStore {
  constructor(private readonly db: Db) {}

  /**
   * Record a login attempt (success or failure).
   */
  record(params: { userId: string; ip: string; success: boolean }): void {
    const id = createDocumentId();
    this.db
      .prepare(
        `INSERT INTO login_attempts (id, user_id, ip, attempted_at, success)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, params.userId, params.ip, Date.now(), params.success ? 1 : 0);
  }

  /**
   * Check whether this (ip, userId) combination is currently locked out.
   *
   * @returns null if not locked out, or the retry-after Date if locked.
   */
  checkLockout(params: { userId: string; ip: string }): Date | null {
    const since = Date.now() - WINDOW_MS;

    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt, MIN(attempted_at) AS oldest
         FROM login_attempts
         WHERE user_id = ? AND ip = ? AND attempted_at >= ? AND success = 0`,
      )
      .get(params.userId, params.ip, since) as { cnt: number; oldest: number | null };

    if (row.cnt < MAX_FAILURES) return null;

    // Retry allowed when the oldest attempt in the window falls out of range
    const oldest = row.oldest ?? since;
    return new Date(oldest + WINDOW_MS);
  }

  /**
   * Clear the lockout record for a user+ip after a successful login.
   * Not strictly required (the window expires naturally) but avoids stale data.
   */
  clearFailures(params: { userId: string; ip: string }): void {
    this.db
      .prepare(`DELETE FROM login_attempts WHERE user_id = ? AND ip = ? AND success = 0`)
      .run(params.userId, params.ip);
  }
}
