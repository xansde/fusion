/**
 * Path traversal protection for asset filesystem operations.
 *
 * REQ-AST-003 / REQ-SEC-042: Every path used in asset serving and upload
 * storage MUST be normalised and confirmed to reside inside the permitted
 * root directory.  Paths that escape (via `..`, `%2e%2e`, backslash, null
 * bytes, or symlinks) are rejected with a clear error.
 *
 * This module is the single source of truth for path safety so every route
 * handler (upload, serve, delete, list) can call the same guard without
 * reimplementing the logic.
 */

import { resolve as resolvePath, join as joinPath, normalize, sep } from "node:path";
import { lstatSync } from "node:fs";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

// ---------------------------------------------------------------------------
// Pre-normalisation: decode URL encoding and reject obviously malicious input
// ---------------------------------------------------------------------------

/**
 * Patterns that are rejected before normalisation:
 *   - null bytes
 *   - URL-encoded dot sequences (%2e%2e, %2E%2E, mixed case)
 *   - URL-encoded slash sequences (%2f, %5c)
 *   - Literal double-dot sequences after splitting on / and \
 */
function containsTraversalPattern(raw: string): boolean {
  const lower = raw.toLowerCase();
  // Null bytes
  if (lower.includes("\0")) return true;
  // URL-encoded traversal components
  if (lower.includes("%2e") || lower.includes("%2f") || lower.includes("%5c")) return true;
  // Literal .. segments after splitting on any path separator
  const parts = raw.split(/[/\\]/);
  if (parts.some((p) => p === "..")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve `relativeOrAbsolute` against `root` and assert that the result
 * stays within `root`.
 *
 * Performs four checks (spec 21 REQ-SEC-042):
 *   1. Pre-scan for `..`, `%2e`, `%2f`, `%5c`, null bytes BEFORE decoding.
 *   2. Normalise and resolve the path to an absolute canonical form.
 *   3. Assert the resolved path starts with `root` (prefix check).
 *   4. Reject symlinks that resolve outside `root` (lstat check, best-effort).
 *
 * @param root    Absolute path to the directory that must contain the result.
 * @param segment Path segment supplied by the caller (e.g. from URL params).
 * @returns The resolved absolute path, guaranteed to be inside `root`.
 * @throws {@link PathTraversalError} when any check fails.
 */
export function guardPath(root: string, segment: string): string {
  // 1. Pre-scan for encoded / literal traversal patterns
  if (containsTraversalPattern(segment)) {
    throw new PathTraversalError(
      `Path traversal attempt detected in segment: ${JSON.stringify(segment)}`,
    );
  }

  // 2. Reject backslashes (Windows path separator abuse)
  if (segment.includes("\\")) {
    throw new PathTraversalError(
      `Backslash in path segment is not allowed: ${JSON.stringify(segment)}`,
    );
  }

  // 3. Resolve to canonical absolute path
  const normalRoot = resolvePath(root);
  const resolved = resolvePath(joinPath(normalRoot, normalize(segment)));

  // 4. Prefix check: resolved MUST start with root + OS separator (or equal root)
  // Use sep (platform-specific: '\' on Windows, '/' on POSIX) so the check
  // works correctly on all platforms.
  const rootWithSep = normalRoot.endsWith(sep) ? normalRoot : normalRoot + sep;
  if (resolved !== normalRoot && !resolved.startsWith(rootWithSep)) {
    throw new PathTraversalError(
      `Resolved path ${JSON.stringify(resolved)} escapes root ${JSON.stringify(normalRoot)}`,
    );
  }

  // 5. Symlink check (best-effort — file may not exist yet on uploads)
  try {
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      throw new PathTraversalError(
        `Symlink at ${JSON.stringify(resolved)} is not allowed in asset paths`,
      );
    }
  } catch (err) {
    if (err instanceof PathTraversalError) throw err;
    // ENOENT or other fs errors — file doesn't exist yet, that's fine for uploads
  }

  return resolved;
}

/**
 * Convenience: assert that a filename component (not a full path, just the
 * file's base name) does not contain path separators or traversal characters.
 *
 * Used to validate the `name` field in DELETE requests before joining it
 * into a directory path.
 *
 * @throws {@link PathTraversalError} when the name is unsafe.
 */
export function guardFilename(name: string): void {
  if (
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.includes("..") ||
    name.toLowerCase().includes("%2e") ||
    name.toLowerCase().includes("%2f") ||
    name.toLowerCase().includes("%5c")
  ) {
    throw new PathTraversalError(`Filename contains unsafe characters: ${JSON.stringify(name)}`);
  }
}
