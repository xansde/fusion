/**
 * Cryptographic helpers for auth.
 *
 * - Argon2id password hashing (DEC-USR-02, REQ-SEC-010)
 * - JWT signing / verification with HMAC-SHA256 (DEC-USR-03, REQ-USR-NF-004)
 * - Refresh token generation and hashing (DEC-USR-03)
 * - Secret derivation / persistence (stored in dataDir/auth_secret)
 */

import { hash as argon2hash, verify as argon2verify, Algorithm } from "@node-rs/argon2";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Argon2id parameters (REQ-SEC-010 / DEC-USR-02)
// ---------------------------------------------------------------------------

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3, // iterations
  parallelism: 4,
} as const;

// ---------------------------------------------------------------------------
// JWT configuration
// ---------------------------------------------------------------------------

const JWT_ALG = "HS256" as const;
/** Access token validity: 15 minutes (DEC-USR-03) */
const ACCESS_TOKEN_TTL_S = 15 * 60;

// ---------------------------------------------------------------------------
// JWT payload shape (fields embedded in the access token)
// ---------------------------------------------------------------------------

export interface AccessTokenPayload {
  sub: string; // userId
  worldId: string;
  role: number; // Role enum value
}

// ---------------------------------------------------------------------------
// Password hashing — Argon2id (REQ-USR-NF-001: async, non-blocking)
// ---------------------------------------------------------------------------

/**
 * Hash a password with Argon2id.
 * Returns the PHC-format hash string.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored Argon2id hash.
 * Uses constant-time comparison internally (REQ-SEC-012).
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2verify(hash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// HMAC secret management
// ---------------------------------------------------------------------------

/**
 * Load or generate the HMAC secret for JWT signing.
 * The secret is persisted as a hex file in <dataDir>/auth_secret.
 * On first run, a 32-byte random secret is generated and saved.
 *
 * REQ-SEC-NF-005: secret lives only on disk in restricted config, never HTTP.
 */
export function loadOrCreateSecret(dataDir: string): Uint8Array {
  const secretPath = join(dataDir, "auth_secret");
  if (existsSync(secretPath)) {
    const hex = readFileSync(secretPath, "utf8").trim();
    return Buffer.from(hex, "hex");
  }

  // Generate 32 bytes (256 bits) of cryptographically secure randomness
  const secret = randomBytes(32);
  mkdirSync(dirname(secretPath), { recursive: true });
  writeFileSync(secretPath, secret.toString("hex"), { mode: 0o600 });
  return secret;
}

// ---------------------------------------------------------------------------
// Access token (JWT)
// ---------------------------------------------------------------------------

/**
 * Sign an access token JWT.
 * Payload includes userId (sub), worldId, and role.
 */
export async function signAccessToken(
  payload: AccessTokenPayload,
  secret: Uint8Array,
): Promise<string> {
  return new SignJWT({ worldId: payload.worldId, role: payload.role })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${String(ACCESS_TOKEN_TTL_S)}s`)
    .sign(secret);
}

/**
 * Verify and decode an access token JWT.
 * Returns the decoded payload or null on any error.
 */
export async function verifyAccessToken(
  token: string,
  secret: Uint8Array,
): Promise<(JWTPayload & AccessTokenPayload) | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [JWT_ALG] });
    if (
      typeof payload.sub === "string" &&
      typeof payload["worldId"] === "string" &&
      typeof payload["role"] === "number"
    ) {
      return payload as JWTPayload & AccessTokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Refresh token
// ---------------------------------------------------------------------------

/** Generate a cryptographically random refresh token (UUID-format opaque string). */
export function generateRefreshToken(): string {
  // 32 random bytes → hex string (64 chars) — opaque, not a real UUID
  return randomBytes(32).toString("hex");
}

/** Generate a new family ID for token rotation (UUID-like). */
export function generateFamilyId(): string {
  return randomBytes(16).toString("hex");
}

/** Hash a refresh token for storage (SHA-256). */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Random password generator (for GM bootstrap / password reset)
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random password.
 * Uses base64url encoding for readability (URL-safe, no ambiguous chars).
 * 18 bytes → 24 base64 chars, ~126 bits of entropy.
 */
export function generateRandomPassword(): string {
  return randomBytes(18).toString("base64url");
}
