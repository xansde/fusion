/**
 * AuthService — domain logic for auth operations.
 *
 * Orchestrates UserStore, SessionStore, LockoutStore, and crypto helpers.
 * Does NOT touch HTTP — all Fastify concerns live in routes.ts.
 *
 * REQ-USR-017..023 (login / refresh / logout)
 * REQ-USR-025..030 (GM admin operations)
 * REQ-SEC-010..014 (security posture)
 */

import type { Database as Db } from "better-sqlite3";
import pino from "pino";
import { UserStore, Role, toPublic, toJoinInfo } from "./user-store.js";
import type { UserRecord, UserPublic, UserJoinInfo } from "./user-store.js";
import { SessionStore } from "./session-store.js";
import { LockoutStore } from "./lockout.js";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  generateFamilyId,
  hashRefreshToken,
  generateRandomPassword,
} from "./crypto.js";
import { createDocumentId, OwnershipLevel } from "@fusion/shared";
import { DocumentStore } from "../documents/store.js";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CREDENTIALS"
      | "USER_INACTIVE"
      | "LOCKED_OUT"
      | "TOKEN_INVALID"
      | "TOKEN_REVOKED"
      | "LAST_GM"
      | "USER_NOT_FOUND"
      | "NAME_TAKEN",
    message: string,
    public readonly retryAfter?: Date,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface LoginResult {
  accessToken: string;
  refreshToken: string; // raw opaque token (put in httpOnly cookie)
  user: UserPublic;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  user: UserPublic;
}

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------

export class AuthService {
  private readonly users: UserStore;
  private readonly sessions: SessionStore;
  private readonly lockouts: LockoutStore;
  private readonly documents: DocumentStore;

  constructor(
    private readonly db: Db,
    private readonly secret: Uint8Array,
    private readonly worldId: string,
  ) {
    this.users = new UserStore(db);
    this.sessions = new SessionStore(db);
    this.lockouts = new LockoutStore(db);
    this.documents = new DocumentStore({ db });
  }

  // --------------------------------------------------------------------------
  // World join info (public endpoint)
  // --------------------------------------------------------------------------

  /**
   * Return the minimal user list for the join screen.
   * Only active users; no password hashes. (REQ-USR-017, REQ-USR-037)
   */
  getJoinInfo(): UserJoinInfo[] {
    return this.users.listActive().map(toJoinInfo);
  }

  // --------------------------------------------------------------------------
  // Login
  // --------------------------------------------------------------------------

  /**
   * Authenticate a user.
   *
   * REQ-USR-019, REQ-SEC-011/012
   *
   * @param userId - The user id selected on the join screen
   * @param password - Plaintext password (may be undefined for passwordless users)
   * @param ip - Client IP (for lockout tracking)
   */
  async login(params: { userId: string; password?: string; ip: string }): Promise<LoginResult> {
    const { userId, password, ip } = params;

    // Check lockout BEFORE any DB query to avoid timing oracle (REQ-SEC-011)
    const lockoutUntil = this.lockouts.checkLockout({ userId, ip });
    if (lockoutUntil !== null) {
      throw new AuthError(
        "LOCKED_OUT",
        "Too many failed login attempts. Please try again later.",
        lockoutUntil,
      );
    }

    const user = this.users.findById(userId);

    // REQ-SEC-012: uniform error — do not distinguish "no user" from "bad password"
    const authFailed = (): never => {
      this.lockouts.record({ userId, ip, success: false });
      throw new AuthError("INVALID_CREDENTIALS", "Invalid credentials.");
    };

    if (!user) {
      return authFailed();
    }

    // REQ-USR-018 / CA-USR-10: inactive users cannot login
    if (!user.active) {
      // Still record as failure to prevent timing oracle on active status
      this.lockouts.record({ userId, ip, success: false });
      throw new AuthError("USER_INACTIVE", "Account is disabled.");
    }

    // Password check (REQ-USR-018)
    if (user.password_hash !== null) {
      if (!password) return authFailed();
      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) return authFailed();
    }
    // If password_hash is null, any password (or no password) is accepted

    // Clear failure counter on success
    this.lockouts.clearFailures({ userId, ip });

    // Issue tokens
    return this._issueTokens(user);
  }

  // --------------------------------------------------------------------------
  // Refresh
  // --------------------------------------------------------------------------

  /**
   * Rotate a refresh token.
   * REQ-USR-020, DEC-USR-03 (reuse detection)
   */
  async refresh(rawRefreshToken: string): Promise<RefreshResult> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const session = this.sessions.findByTokenHash(tokenHash);

    if (!session) {
      throw new AuthError("TOKEN_INVALID", "Invalid refresh token.");
    }

    // Reuse detection: if the token was already revoked, revoke the whole family
    if (!this.sessions.isValid(session)) {
      if (session.revoked_at !== null) {
        // Potential token theft — revoke entire family (CA-USR-07)
        this.sessions.revokeFamily(session.family_id);
        // REQ-SEC-090: structured security event for refresh-token reuse.
        // userId and worldId are the only non-redacted fields per REQ-SEC-092;
        // the raw token/hash is intentionally omitted.
        // Replace with a proper security-event bus when one is available (M1+).
        const secLog = pino({ name: "security", level: "warn" });
        secLog.warn(
          {
            event: "auth.refresh_reuse",
            userId: session.user_id,
            worldId: this.worldId,
            familyId: session.family_id,
          },
          "Refresh token reuse detected — entire family revoked (possible token theft)",
        );
      }
      throw new AuthError("TOKEN_REVOKED", "Refresh token is invalid or expired.");
    }

    // Revoke the used token
    this.sessions.revokeById(session.id);

    // Load user
    const user = this.users.findById(session.user_id);
    if (!user || !user.active) {
      throw new AuthError("TOKEN_INVALID", "User not found or inactive.");
    }

    // Issue new tokens in the same family
    return this._issueTokens(user, session.family_id);
  }

  // --------------------------------------------------------------------------
  // Logout
  // --------------------------------------------------------------------------

  /**
   * Revoke the current refresh token session.
   * REQ-USR-022
   */
  logout(rawRefreshToken: string): void {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const session = this.sessions.findByTokenHash(tokenHash);
    if (session) {
      this.sessions.revokeById(session.id);
    }
  }

  // --------------------------------------------------------------------------
  // Token verification (for middleware)
  // --------------------------------------------------------------------------

  /**
   * Verify an access token and return the user if valid.
   * Returns null on any error (expired, bad signature, etc.).
   */
  async verifyAccessToken(token: string): Promise<UserRecord | null> {
    const payload = await verifyAccessToken(token, this.secret);
    if (!payload) return null;

    const user = this.users.findById(payload.sub);
    if (!user || !user.active) return null;
    return user;
  }

  // --------------------------------------------------------------------------
  // GM admin operations
  // --------------------------------------------------------------------------

  /** List all users (active and inactive). REQ-USR-025 */
  listUsers(): UserPublic[] {
    return this.users.listAll().map(toPublic);
  }

  /** Get a single user (public shape). */
  getUser(id: string): UserPublic | null {
    const u = this.users.findById(id);
    return u ? toPublic(u) : null;
  }

  /**
   * Create a new user. REQ-USR-025
   *
   * REQ-USR-025/025a: creating a user of a non-privileged role (PLAYER or
   * TRUSTED, DEC-USR-01) also creates a blank `character` Actor in the same
   * gesture, with `ownership.default = none` and the new user as `OWNER`.
   * Privileged roles (ASSISTANT, GAMEMASTER) get no Actor.
   *
   * REQ-USR-025c: the user row and the Actor are a single atomic gesture —
   * both writes run inside one SQLite transaction, so an Actor-creation
   * failure (e.g. validation) rolls back the user insert too and no user of
   * a non-privileged role is ever left without its Actor.
   *
   * Returns the created user and, if a password was generated, that password.
   */
  async createUser(params: {
    name: string;
    role: Role;
    color?: string;
    password?: string;
  }): Promise<{ user: UserPublic; generatedPassword?: string }> {
    // Unique name check
    const existing = this.users.findByName(params.name);
    if (existing) {
      throw new AuthError("NAME_TAKEN", `A user named "${params.name}" already exists.`);
    }

    let passwordHash: string | null = null;
    if (params.password !== undefined) {
      passwordHash = await hashPassword(params.password);
    }

    const createOpts: Parameters<UserStore["create"]>[0] = {
      name: params.name,
      role: params.role,
      passwordHash,
    };
    if (params.color !== undefined) createOpts.color = params.color;

    const record = this.db.transaction(() => {
      const created = this.users.create(createOpts);

      // DEC-USR-01: only PLAYER and TRUSTED are non-privileged; ASSISTANT and
      // GAMEMASTER get no character (REQ-USR-025, last paragraph).
      if (created.role === Role.PLAYER || created.role === Role.TRUSTED) {
        this.documents.create(
          "actors",
          {
            // REQ-USR-025b: name derived from the user's own name; subtype
            // "character"; no game-system fields filled in ("em branco").
            name: created.name,
            type: "character",
            // REQ-USR-025a: default=none, the new user is the sole OWNER —
            // an explicit exception to the GM-creator-becomes-OWNER default
            // (REQ-DOC-029), because the intended owner is the new user, not
            // the GM performing the creation.
            ownership: {
              default: OwnershipLevel.NONE,
              [created.id]: OwnershipLevel.OWNER,
            },
            // Server-side link from the character back to the user it was
            // created for, so later administration (e.g. REQ-NPC-055) can
            // resolve "whose character is this" without guessing from
            // ownership alone.
            flags: { fusion: { playerId: created.id } },
          },
          { userId: null },
        );
      }

      return created;
    })();

    return { user: toPublic(record) };
  }

  /**
   * Update user fields (name, role, color, avatar, active). REQ-USR-026
   *
   * Prevents demoting the last active GM. REQ-USR-026, CA-USR-08.
   */
  updateUser(
    id: string,
    patch: Partial<{
      name: string;
      role: Role;
      color: string;
      avatar: string | null;
      active: boolean;
    }>,
  ): UserPublic {
    const user = this.users.findById(id);
    if (!user) throw new AuthError("USER_NOT_FOUND", "User not found.");

    // Guard: cannot demote the last active GM (CA-USR-08)
    if (
      user.role === Role.GAMEMASTER &&
      (patch.role !== undefined || patch.active === false) &&
      this.users.countByRole(Role.GAMEMASTER) <= 1
    ) {
      if (patch.role !== undefined && patch.role !== Role.GAMEMASTER) {
        throw new AuthError("LAST_GM", "Cannot change the role of the last active Gamemaster.");
      }
      if (patch.active === false) {
        throw new AuthError("LAST_GM", "Cannot deactivate the last active Gamemaster.");
      }
    }

    const updated = this.users.update(id, patch);

    // Deactivating a user revokes all their sessions (REQ-USR-028)
    if (patch.active === false) {
      this.sessions.revokeAllForUser(id);
    }

    return toPublic(updated);
  }

  /**
   * Reset a user's password and revoke all their sessions. REQ-USR-027.
   *
   * Returns the new plaintext password (displayed once).
   * If `newPassword` is not provided, a random one is generated.
   * If `removePassword` is true, the password is set to null (passwordless).
   */
  async resetPassword(
    id: string,
    options?: { newPassword?: string; removePassword?: boolean },
  ): Promise<{ password: string | null }> {
    const user = this.users.findById(id);
    if (!user) throw new AuthError("USER_NOT_FOUND", "User not found.");

    let newHash: string | null;
    let returnPassword: string | null;

    if (options?.removePassword) {
      newHash = null;
      returnPassword = null;
    } else {
      const plaintext = options?.newPassword ?? generateRandomPassword();
      newHash = await hashPassword(plaintext);
      returnPassword = plaintext;
    }

    this.users.updatePasswordHash(id, newHash);
    // Revoke all active sessions (REQ-USR-027)
    this.sessions.revokeAllForUser(id);

    return { password: returnPassword };
  }

  /**
   * Revoke all sessions for a user (kick). REQ-USR-029.
   */
  kickUser(id: string): void {
    const user = this.users.findById(id);
    if (!user) throw new AuthError("USER_NOT_FOUND", "User not found.");
    this.sessions.revokeAllForUser(id);
  }

  // --------------------------------------------------------------------------
  // Bootstrap: create the GM user on world creation
  // --------------------------------------------------------------------------

  /**
   * Create the initial Gamemaster user when a world is first set up.
   *
   * Called from `fusion world create`. Returns the GM record and the
   * generated password (printed once to stdout).
   *
   * If `password` is provided explicitly (--gm-password flag), it is used
   * as-is. Otherwise a random password is generated and returned.
   */
  async bootstrapGm(params?: {
    password?: string;
  }): Promise<{ user: UserPublic; password: string }> {
    const existing = this.users.findByName("Gamemaster");
    if (existing) {
      // Idempotent — world already initialised
      return {
        user: toPublic(existing),
        password: "(already set)",
      };
    }

    const password = params?.password ?? generateRandomPassword();
    const passwordHash = await hashPassword(password);

    const record = this.users.create({
      name: "Gamemaster",
      role: Role.GAMEMASTER,
      passwordHash,
      color: "#e03030",
    });

    return { user: toPublic(record), password };
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async _issueTokens(
    user: UserRecord,
    familyId?: string,
  ): Promise<LoginResult | RefreshResult> {
    const rawToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(rawToken);
    const sessionId = createDocumentId();

    this.sessions.create({
      id: sessionId,
      userId: user.id,
      tokenHash,
      familyId: familyId ?? generateFamilyId(),
    });

    const accessToken = await signAccessToken(
      { sub: user.id, worldId: this.worldId, role: user.role },
      this.secret,
    );

    return {
      accessToken,
      refreshToken: rawToken,
      user: toPublic(user),
    };
  }
}
