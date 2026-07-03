/**
 * Cryptographic helpers for auth.
 *
 * - Argon2id password hashing (DEC-USR-02, REQ-SEC-010)
 * - JWT signing / verification with HMAC-SHA256 (DEC-USR-03, REQ-USR-NF-004)
 * - Refresh token generation and hashing (DEC-USR-03)
 * - Secret derivation / persistence (stored in dataDir/auth_secret)
 */

import type { hash as HashFn, verify as VerifyFn, Options as Argon2Options } from "@node-rs/argon2";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

// ---------------------------------------------------------------------------
// Native addon load (M6/B3 — SEA compatibility, see runtime/native-loader.ts
// and db/connection.ts's identical pattern + full explanation of WHY).
//
// IMPORTANT: unlike a real TypeScript `const enum` (which the compiler
// erases into inlined literals with zero runtime dependency), this
// package's `Algorithm` is declared `export declare const enum Algorithm`
// in its `.d.ts` but ships as a genuine RUNTIME object in its compiled
// `.js` (verified empirically: `require(...).Algorithm` returns
// `{ Argon2d: 0, Argon2i: 1, Argon2id: 2 }`, not undefined) — because the
// declaring package was not compiled by tsc in THIS project, TypeScript
// cannot erase it and instead treats a value-position `import { Algorithm }`
// as an ordinary runtime import, which esbuild then bundles as a second,
// BARE top-level `require("@node-rs/argon2")` call sitting right next to
// the createRequire-based one below — and that bare call is exactly what
// SEA's main-script loader rejects with ERR_UNKNOWN_BUILTIN_MODULE (see
// db/connection.ts's doc comment for the full mechanism). So this file
// never imports `Algorithm` at all (a `const enum`'s TYPE also cannot be
// used in a `typeof` runtime-type position — TS2475 — ruling out an
// `import type` alias too); `ARGON2_OPTIONS.algorithm` is set from the
// createRequire'd module's own `Algorithm.Argon2id` value below, typed as a
// plain `number` here (Argon2Options["algorithm"] resolves to
// `Algorithm | undefined` from the source `.d.ts`'s OPTIONAL field
// declaration, which is a strictly worse type to reuse for a value that is
// in fact always present — a bare `number` matches what the const enum
// actually compiles down to at runtime and is what the
// `satisfies Argon2Options` check below verifies structurally).
// ---------------------------------------------------------------------------
const nativeRequire = createRequire(import.meta.url);
const argon2Native = nativeRequire("@node-rs/argon2") as {
  hash: typeof HashFn;
  verify: typeof VerifyFn;
  Algorithm: { Argon2d: number; Argon2i: number; Argon2id: number };
};
const argon2hash = argon2Native.hash;
const argon2verify = argon2Native.verify;

// ---------------------------------------------------------------------------
// Argon2id parameters (REQ-SEC-010 / DEC-USR-02)
// ---------------------------------------------------------------------------

const ARGON2_OPTIONS = {
  algorithm: argon2Native.Algorithm.Argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3, // iterations
  parallelism: 4,
} satisfies Argon2Options;

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
