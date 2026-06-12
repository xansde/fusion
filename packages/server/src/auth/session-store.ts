/**
 * SessionStore — refresh token persistence and rotation.
 *
 * Each session has:
 *  - A unique ID
 *  - A hashed refresh token (SHA-256 of the opaque token)
 *  - A family_id shared across rotations (for reuse detection, DEC-USR-03)
 *  - created_at / expires_at / revoked_at timestamps
 *
 * REQ-USR-019 step 5, REQ-USR-020, REQ-USR-NF-003
 * DEC-USR-03: rotação + reuse detection
 */

import type { Database as Db } from "better-sqlite3";
import { generateFamilyId } from "./crypto.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionRecord {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  family_id: string;
  created_at: number; // Unix ms
  expires_at: number; // Unix ms
  revoked_at: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Refresh token TTL: 30 days (DEC-USR-03) */
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

export class SessionStore {
  constructor(private readonly db: Db) {}

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  /**
   * Create a new session record for the given user.
   *
   * @param userId - User id
   * @param tokenHash - SHA-256 hash of the opaque refresh token
   * @param familyId - Family id (omit to start a new family)
   */
  create(params: {
    id: string;
    userId: string;
    tokenHash: string;
    familyId?: string;
  }): SessionRecord {
    const now = Date.now();
    const expiresAt = now + REFRESH_TOKEN_TTL_MS;
    const familyId = params.familyId ?? generateFamilyId();

    this.db
      .prepare(
        `INSERT INTO sessions
           (id, user_id, refresh_token_hash, family_id, created_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(params.id, params.userId, params.tokenHash, familyId, now, expiresAt);

    const record = this.findById(params.id);
    if (!record) throw new Error(`Session "${params.id}" not found after insert`);
    return record;
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  findById(id: string): SessionRecord | null {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
      | SessionRecord
      | undefined;
    return row ?? null;
  }

  findByTokenHash(hash: string): SessionRecord | null {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE refresh_token_hash = ?`).get(hash) as
      | SessionRecord
      | undefined;
    return row ?? null;
  }

  // --------------------------------------------------------------------------
  // Revocation
  // --------------------------------------------------------------------------

  /** Revoke a single session by ID. */
  revokeById(id: string): void {
    this.db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(Date.now(), id);
  }

  /** Revoke all sessions for a given user (kick / password reset). */
  revokeAllForUser(userId: string): void {
    this.db
      .prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
      .run(Date.now(), userId);
  }

  /**
   * Revoke all sessions in a family (reuse detection).
   * Called when a revoked token is presented again (DEC-USR-03).
   */
  revokeFamily(familyId: string): void {
    this.db
      .prepare(`UPDATE sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL`)
      .run(Date.now(), familyId);
  }

  // --------------------------------------------------------------------------
  // Validity check
  // --------------------------------------------------------------------------

  /**
   * Return true if the session is valid (not revoked, not expired).
   */
  isValid(session: SessionRecord): boolean {
    const now = Date.now();
    return session.revoked_at === null && session.expires_at > now;
  }
}
