/**
 * Short-lived asset serving tokens.
 *
 * PIXI Assets.load() and <img> tags make native browser GETs without the
 * Authorization header (the access token lives in JS memory, not cookies).
 * To avoid requiring a fetch-proxy workaround on the client side, we issue
 * short-lived signed query parameters so the browser can include auth in the
 * URL itself.
 *
 * Design (option a from code-review fix):
 *   - Server-side HMAC-SHA256 over "userId:exp" using the world secret.
 *   - Token expires after ASSET_TOKEN_TTL_MS (default 5 min).
 *   - URL format: /assets/<name>?at=<token>&ae=<exp>&au=<userId>
 *
 * REQ-AST-019: serving /assets/* authenticated (role >= PLAYER)
 * REQ-SEC-042: path traversal guard unchanged
 *
 * DEBT (M1 → post-MVP): replace with a proper signed-URL scheme or
 *   a /api/assets/token endpoint if multiple worlds need isolated secrets.
 */

import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Asset query-token lifetime: 5 minutes. */
export const ASSET_TOKEN_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/**
 * Issue a short-lived HMAC asset token for `userId`.
 *
 * @param userId  The authenticated user's ID.
 * @param secret  World HMAC secret (same key as JWT signing).
 * @param nowMs   Current timestamp (injectable for testing).
 * @returns       `{ token, exp }` where `exp` is a Unix-ms expiry timestamp.
 */
export function issueAssetToken(
  userId: string,
  secret: Uint8Array,
  nowMs: number = Date.now(),
): { token: string; exp: number } {
  const exp = nowMs + ASSET_TOKEN_TTL_MS;
  const token = signAssetToken(userId, exp, secret);
  return { token, exp };
}

/**
 * Verify a query-token from the `at` / `ae` / `au` query parameters.
 *
 * @returns The userId on success, or `null` on failure.
 */
export function verifyAssetToken(
  token: string,
  userId: string,
  exp: number,
  secret: Uint8Array,
  nowMs: number = Date.now(),
): string | null {
  if (nowMs > exp) return null; // expired

  const expected = signAssetToken(userId, exp, secret);

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(token, expected)) return null;

  return userId;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function signAssetToken(userId: string, exp: number, secret: Uint8Array): string {
  return createHmac("sha256", secret)
    .update(`${userId}:${String(exp)}`)
    .digest("hex");
}

/** Constant-time string comparison (same length required for true safety). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
