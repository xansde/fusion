/**
 * clientValidation.ts — client-side UX validation for asset uploads.
 *
 * This module provides FAST, anticipatory UX feedback BEFORE the file reaches
 * the server. It is NOT a security mechanism — the server always re-validates
 * by magic bytes (REQ-AST-007 / REQ-SEC-041). Client validation is purely
 * to surface errors immediately without a round-trip.
 *
 * Rules:
 *   - Extension must be in the allowed list (PNG, JPEG, WebP, SVG).
 *   - File size must not exceed MAX_UPLOAD_BYTES.
 *
 * Pure module — no DOM, no side effects — safe for Vitest.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum upload size: 20 MB (matches server DEFAULT_MAX_BYTES). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Allowed image extensions (lowercase). Maps extension → human label. */
export const ALLOWED_EXTENSIONS: Record<string, string> = {
  png: "PNG",
  jpg: "JPEG",
  jpeg: "JPEG",
  webp: "WebP",
  svg: "SVG",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "extension" | "size"; message: string };

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

/**
 * Validate a File object before upload.
 *
 * Checks extension and size. Both checks run eagerly — callers should display
 * the error immediately when the user selects or drops a file.
 *
 * @param file  The File from input/drag-drop.
 * @returns     { ok: true } or { ok: false, reason, message }.
 */
export function validateFileForUpload(file: File): ValidationResult {
  const ext = getExtension(file.name);

  if (!ext || !(ext in ALLOWED_EXTENSIONS)) {
    const allowed = Object.values(ALLOWED_EXTENSIONS)
      .filter((v, i, arr) => arr.indexOf(v) === i) // dedupe JPEG
      .join(", ");
    return {
      ok: false,
      reason: "extension",
      message: `File type not supported. Allowed formats: ${allowed}.`,
    };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    const limitMb = MAX_UPLOAD_BYTES / (1024 * 1024);
    const fileMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      reason: "size",
      message: `File is too large (${fileMb} MB). Maximum size is ${String(limitMb)} MB.`,
    };
  }

  return { ok: true };
}

/**
 * Validate multiple files. Returns the first error found, or ok:true.
 * Useful for drag-and-drop of multiple files.
 */
export function validateFilesForUpload(
  files: File[],
): { ok: true } | { ok: false; reason: "extension" | "size"; message: string; file: File } {
  for (const file of files) {
    const result = validateFileForUpload(file);
    if (!result.ok) {
      return { ...result, file };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the lowercase extension from a filename.
 * Returns empty string if no extension found.
 */
export function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) return "";
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Format a file size in bytes into a human-readable string.
 *
 * Examples:
 *   512        → "512 B"
 *   1536       → "1.5 KB"
 *   3145728    → "3.0 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Return true if the filename looks like a supported image type.
 * Used by the FilePicker to decide whether to render an <img> preview.
 */
export function isImageExtension(filename: string): boolean {
  const ext = getExtension(filename);
  return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || ext === "svg";
}
