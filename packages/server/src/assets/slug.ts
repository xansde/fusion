/**
 * Asset filename slug utilities.
 *
 * REQ-AST-002: file names must be sanitised on upload: lowercase, spaces → _,
 * non-ASCII / special chars removed, max 200 chars before extension.
 *
 * REQ-SEC-040: the server assigns a new safe name (slug + 8-char hash suffix)
 * to every uploaded file; the client-supplied name is NEVER used directly as
 * the storage path — it is only used as a source for the slug prefix.
 */

import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

/**
 * Convert a raw filename (as supplied by the uploader) into a safe slug.
 *
 * Rules (REQ-AST-002):
 *   1. Strip extension from input name (handled by caller — this fn takes
 *      the base name without extension).
 *   2. Lowercase.
 *   3. Replace whitespace with underscores.
 *   4. Remove characters that are not ASCII letters, digits, hyphens,
 *      underscores, or dots.
 *   5. Collapse consecutive hyphens/underscores/dots.
 *   6. Trim leading/trailing hyphens and underscores.
 *   7. Truncate to `maxLength` characters (default 200, per spec).
 *   8. Fall back to "file" when the result would be empty.
 */
export function slugifyBasename(rawBasename: string, maxLength = 200): string {
  let s = rawBasename
    .toLowerCase()
    .replace(/\s+/g, "_")
    // Keep only safe ASCII chars
    .replace(/[^a-z0-9\-_.]/g, "")
    // Collapse repeated separators
    .replace(/[-_.]{2,}/g, "-")
    // Strip leading/trailing separators
    .replace(/^[-_.]+|[-_.]+$/g, "");

  if (s.length === 0) s = "file";
  if (s.length > maxLength) s = s.slice(0, maxLength);
  return s;
}

// ---------------------------------------------------------------------------
// Safe filename construction
// ---------------------------------------------------------------------------

/**
 * Build a safe storage filename for a new upload.
 *
 * Format: `<slug>-<8-hex-chars><ext>`
 *
 * The 8-char hex suffix is computed from the SHA-256 of the file content
 * (first 8 chars of the hex digest), giving content-addressed uniqueness
 * while keeping the name human-readable.
 *
 * Example: `goblin-warrior-a3f8bc12.webp`
 *
 * @param originalName Client-supplied filename (used only for the slug prefix).
 * @param ext          Canonical extension with leading dot (e.g. `.png`).
 * @param contentHash  SHA-256 hex digest of the file content (64 chars).
 */
export function buildSafeFilename(originalName: string, ext: string, contentHash: string): string {
  // Extract base name without extension from the original name
  const lastDot = originalName.lastIndexOf(".");
  const basePart = lastDot > 0 ? originalName.slice(0, lastDot) : originalName;

  const slug = slugifyBasename(basePart);
  const hashSuffix = contentHash.slice(0, 8);

  return `${slug}-${hashSuffix}${ext}`;
}

// ---------------------------------------------------------------------------
// Content hash
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 of a Buffer and return the full 64-char hex digest.
 *
 * REQ-AST-009: Used for deduplication checks against `asset_meta.digest`.
 */
export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Generate a random 16-byte hex string for use as a unique upload token
 * when no content is available yet (e.g. streaming uploads).
 */
export function randomHex16(): string {
  return randomBytes(16).toString("hex");
}
