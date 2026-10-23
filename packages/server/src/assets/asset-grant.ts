/**
 * Asset grants — the credential `GET /assets/*` accepts (T025).
 *
 * A grant is an HMAC-SHA256 the SERVER computed over a tuple it chose. There
 * are exactly two scopes:
 *
 *   doc    — bound to ONE canonical asset name and ONE user. Issued by
 *            `POST /api/assets/grant` after the server has read the document
 *            from the database itself, confirmed the user may see it by the
 *            same computation that builds the join snapshot, and extracted the
 *            name from a known asset-bearing FIELD of the redacted body.
 *   browse — bound to a user and nothing else. Issued by
 *            `POST /api/assets/token`. It is what the GM's file picker uses to
 *            paint a grid of thumbnails with one round-trip, and it only ever
 *            authorises a role that is already allowed to LIST the world's
 *            files (see `BROWSE_MIN_ROLE` in routes.ts).
 *
 * ---------------------------------------------------------------------------
 * WHY LENGTH-PREFIX, AND NOT A SEPARATOR
 * ---------------------------------------------------------------------------
 *
 * The obvious encoding — join the parts with a separator and HMAC that — is
 * broken whenever the attacker can put the separator INSIDE a part. Measured,
 * not argued (probe run for this task):
 *
 *   HMAC(secret, ["a\0b"].join("\0"))  === HMAC(secret, ["a","b"].join("\0"))
 *
 * …the same hex digest, because both preimages are the byte string `a`,0x00,`b`.
 * And 0x00 is reachable from the wire: `find-my-way` decodes `%00` into a real
 * NUL before the handler sees the wildcard (verified by execution). Any other
 * separator — `:`, `|`, `/` — is reachable more easily still, since asset names
 * legitimately contain punctuation.
 *
 * The fix is an encoding no concatenation can be ambiguous under. `lp(s)` emits
 * the BYTE length of `s`, a `:`, then `s`. Reading left to right, the length
 * says exactly how far the part extends, so no content can be mistaken for
 * structure:
 *
 *   lp("a\0b") = "3:a\0b"       vs   lp("a") + lp("b") = "1:a" + "1:b"
 *
 * Byte length (not `String.length`): the digest is taken over UTF-8 bytes, so a
 * name with accented or CJK characters would otherwise have a prefix that
 * disagrees with the bytes that follow it, which is the same ambiguity again.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE HMAC PER NAME, AND NEVER A LIST
 * ---------------------------------------------------------------------------
 *
 * An earlier proposal signed the whole SET of names a document referenced and
 * shipped that set in the URL, with the serve route checking membership. Two
 * costs: the URL for a scene with 200 tokens ran to ~9.5 KB (the token travels
 * on every image request), and the membership check was an `includes()` over a
 * list the requester supplied — the exact shape that killed round 2 of this
 * design. Signing each name on its own keeps the URL O(1) and replaces the
 * membership test with a recomputation of the HMAC for the name actually asked
 * for. There is no list to check against, so there is no list to poison.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { ASSET_TOKEN_TTL_MS } from "./asset-token.js";

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/**
 * Scope tags. Deliberately one byte each and deliberately part of the signed
 * preimage: without a scope tag, a browse grant and a doc grant over the same
 * `(userId, exp)` would be two names for one signature, and the narrower one
 * would inherit the broader one's power.
 */
export type AssetGrantScope = "doc" | "browse";

/**
 * The tag bytes themselves.
 *
 * EXPORTED so a test can pin the tags against each other directly. It has to be
 * pinned that way because no BEHAVIOURAL test can distinguish it today: the
 * length-prefix is self-delimiting, so a 3-part doc preimage can never be read
 * as a 2-part browse preimage even with both tags blanked (verified — blanking
 * them keeps the whole asset suite green, and a search over adversarial
 * `userId`/`exp`/`name` triples found zero cross-scope collisions).
 *
 * That makes the tag defence in depth rather than the load-bearing separation —
 * and defence in depth that no test holds is defence that a future refactor
 * deletes as dead indirection, right before someone else "simplifies" `lp()`
 * into a join. Two green commits, one hole. Hence the direct assertion.
 */
export const SCOPE_TAG: Readonly<Record<AssetGrantScope, string>> = {
  doc: "d",
  browse: "b",
};

/** Grant lifetime, shared with the pre-existing query-token (5 minutes). */
export const ASSET_GRANT_TTL_MS = ASSET_TOKEN_TTL_MS;

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * Length-prefix one part: `<utf8 byte length>:<part>`.
 *
 * Exported for the unit test that pins the property this whole module rests on
 * (`lp("a\0b") !== lp("a") + lp("b")`), not because any other module should be
 * building preimages of its own.
 */
export function lp(s: string): string {
  return `${String(Buffer.byteLength(s, "utf8"))}:${s}`;
}

function signParts(secret: Uint8Array, parts: readonly string[]): string {
  return createHmac("sha256", secret).update(parts.map(lp).join("")).digest("hex");
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Sign a grant for ONE canonical asset name.
 *
 * `name` MUST already have been through `canonicalizeAssetName` — the serve
 * route canonicalises what it was asked for and recomputes this exact digest,
 * so a name signed in any other spelling can never be opened.
 */
export function signDocGrant(
  userId: string,
  exp: number,
  name: string,
  secret: Uint8Array,
): string {
  return signParts(secret, [SCOPE_TAG.doc, userId, String(exp), name]);
}

/** Sign a browse-scope grant: a user and an expiry, no name. */
export function signBrowseGrant(userId: string, exp: number, secret: Uint8Array): string {
  return signParts(secret, [SCOPE_TAG.browse, userId, String(exp)]);
}

/**
 * Issue a browse grant valid for {@link ASSET_GRANT_TTL_MS}.
 * Mirrors the shape `issueAssetToken` had, so the route and the client keep the
 * `{ token, exp }` contract they already speak.
 */
export function issueBrowseGrant(
  userId: string,
  secret: Uint8Array,
  nowMs: number = Date.now(),
): { token: string; exp: number } {
  const exp = nowMs + ASSET_GRANT_TTL_MS;
  return { token: signBrowseGrant(userId, exp, secret), exp };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerifyGrantOptions {
  /** Which scope the caller is testing for. */
  scope: AssetGrantScope;
  /** The `at` query parameter, exactly as received. */
  token: string;
  /** The `au` query parameter — the user the grant claims to be for. */
  userId: string;
  /** The `ae` query parameter, already parsed to a number. */
  exp: number;
  /**
   * Canonical asset name. REQUIRED for scope `doc`; a `doc` verification with
   * no name fails closed rather than degrading into a name-less signature.
   */
  name?: string;
  secret: Uint8Array;
  /** Injectable clock for tests. */
  nowMs?: number;
}

/**
 * True when `token` is the signature this server would have produced for the
 * given scope, user, expiry and (for `doc`) name — and the expiry has not
 * passed.
 *
 * The comparison is constant-time. What still varies with the input is the
 * LENGTH check, which is unavoidable with `crypto.timingSafeEqual` and harmless
 * here: every grant this module issues is 64 hex characters, a constant, so the
 * length of a valid token is public knowledge and reveals nothing about the
 * secret.
 */
export function verifyGrant(options: VerifyGrantOptions): boolean {
  const { scope, token, userId, exp, name, secret } = options;
  const nowMs = options.nowMs ?? Date.now();

  if (!Number.isFinite(exp)) return false;
  if (nowMs > exp) return false;

  let expected: string;
  if (scope === "doc") {
    // Fail closed: a doc-scope check with no name has nothing to bind to.
    if (name === undefined) return false;
    expected = signDocGrant(userId, exp, name, secret);
  } else {
    expected = signBrowseGrant(userId, exp, secret);
  }

  return constantTimeEquals(token, expected);
}

/**
 * Constant-time equality over two ASCII strings.
 *
 * `crypto.timingSafeEqual` throws on length mismatch, so the length is compared
 * first and short-circuits — see {@link verifyGrant}'s note on why that leak is
 * acceptable here. Everything after the length check runs in time independent
 * of how many bytes matched.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
