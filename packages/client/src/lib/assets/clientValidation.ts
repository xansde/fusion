/**
 * clientValidation.ts — client-side UX validation for asset uploads.
 *
 * This module provides FAST, anticipatory UX feedback BEFORE the file reaches
 * the server. It is NOT a security mechanism — the server always re-validates
 * by magic bytes (REQ-AST-007 / REQ-SEC-041). Client validation is purely
 * to surface errors immediately without a round-trip.
 *
 * Rules:
 *   - Extension must be in the allowed list (PNG, JPEG, WebP, SVG, MP3, OGG).
 *   - File size must not exceed the cap of its media kind.
 *   - When a picker narrows itself to specific `kinds` (e.g. an audio-only
 *     picker), a file whose extension maps to a kind outside that set is
 *     rejected too — see the optional `kinds` param on
 *     {@link validateFileForUpload}. This closes the gap from wi-mapa-som-01
 *     review §3: `kinds` used to narrow only the system file dialog's
 *     `accept`, so drag-and-drop and the grid stayed global — an image
 *     picker would happily upload (and auto-select) a dropped .mp3.
 *
 * The numbers below are a COPY of `packages/server/src/assets/upload-limits.ts`,
 * which is the authority: it decides 413/415 for real, from the detected bytes,
 * while this file only guesses from the filename. There is no shared package
 * for assets, and promoting two constants to `@fusion/shared` would drag the
 * shared→server build order into a small change — revisit if the format list
 * grows again (video, fonts).
 *
 * Pure module — no DOM, no side effects — safe for Vitest.
 */

// ---------------------------------------------------------------------------
// Kinds and limits (mirror of the server — see module docblock)
// ---------------------------------------------------------------------------

/** The media kinds the upload endpoint sizes separately. */
export type AssetKind = "image" | "audio";

/** Maximum upload size per kind. Mirrors MAX_BYTES_BY_KIND on the server. */
export const MAX_BYTES_BY_KIND: Record<AssetKind, number> = {
  image: 20 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
};

/**
 * Maximum upload size for images.
 *
 * Kept under its historical name because it predates the per-kind caps and is
 * re-exported from the module index; "the upload limit" now depends on the
 * kind, so prefer {@link MAX_BYTES_BY_KIND} in new code.
 */
export const MAX_UPLOAD_BYTES = MAX_BYTES_BY_KIND.image;

/**
 * Allowed extensions (lowercase) → the kind that caps them and the label shown
 * to the user. Insertion order is the order the UI lists formats in.
 *
 * WAV is absent on purpose: the server cannot tell it apart from WebP without
 * reworking its RIFF detection, so accepting it here would only produce a
 * client-side yes followed by a server-side 415.
 */
export const ALLOWED_EXTENSIONS: Record<string, { kind: AssetKind; label: string }> = {
  png: { kind: "image", label: "PNG" },
  jpg: { kind: "image", label: "JPEG" },
  jpeg: { kind: "image", label: "JPEG" },
  webp: { kind: "image", label: "WebP" },
  svg: { kind: "image", label: "SVG" },
  mp3: { kind: "audio", label: "MP3" },
  ogg: { kind: "audio", label: "OGG" },
};

/** Human name of a kind, for error messages ("Maximum size for audio files…"). */
const KIND_LABEL: Record<AssetKind, string> = {
  image: "image",
  audio: "audio",
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
 * the error immediately when the user selects or drops a file. The size cap
 * depends on the kind the extension maps to, matching the server.
 *
 * @param file   The File from input/drag-drop.
 * @param kinds  Optional: the kinds the CALLING PICKER offers. When given, a
 *               file whose extension maps to a kind outside this set is
 *               rejected here — before the extension is even checked against
 *               the size cap — so an audio-only picker refuses a dropped
 *               .png with a message naming the picker's scope, the same way
 *               it would refuse an unrecognized extension. Omit to fall back
 *               to the full allowlist (both kinds), matching pre-kinds
 *               behavior.
 * @returns      { ok: true } or { ok: false, reason, message }.
 */
export function validateFileForUpload(
  file: File,
  kinds?: readonly AssetKind[],
): ValidationResult {
  const ext = getExtension(file.name);
  const entry = ext ? ALLOWED_EXTENSIONS[ext] : undefined;

  if (!entry) {
    return {
      ok: false,
      reason: "extension",
      message: `File type not supported. Allowed formats: ${allFormatsLabel()}.`,
    };
  }

  if (kinds && !kinds.includes(entry.kind)) {
    const scope = kinds.map((k) => KIND_LABEL[k]).join("/");
    return {
      ok: false,
      reason: "extension",
      message: `${file.name}: not allowed in this picker (${scope} only).`,
    };
  }

  const limit = MAX_BYTES_BY_KIND[entry.kind];
  if (file.size > limit) {
    const limitMb = limit / (1024 * 1024);
    const fileMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      reason: "size",
      message: `File is too large (${fileMb} MB). Maximum size for ${KIND_LABEL[entry.kind]} files is ${String(limitMb)} MB.`,
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
// Picker helpers — everything the FilePicker shows is derived from the map
// above, never hand-written, so the UI can never advertise a format the
// validation rejects.
// ---------------------------------------------------------------------------

function extensionsFor(kinds: readonly AssetKind[]): string[] {
  return kinds.flatMap((kind) =>
    Object.entries(ALLOWED_EXTENSIONS)
      .filter(([, entry]) => entry.kind === kind)
      .map(([ext]) => ext),
  );
}

/** Value for an `<input type="file" accept>` attribute, e.g. ".mp3,.ogg". */
export function acceptAttrFor(kinds: readonly AssetKind[]): string {
  return extensionsFor(kinds)
    .map((ext) => `.${ext}`)
    .join(",");
}

/** Human list of formats for a hint line, e.g. "PNG, JPEG, WebP, SVG". */
export function formatsLabelFor(kinds: readonly AssetKind[]): string {
  const labels = extensionsFor(kinds).map((ext) => ALLOWED_EXTENSIONS[ext]?.label ?? ext);
  return labels.filter((label, i) => labels.indexOf(label) === i).join(", ");
}

/** Largest cap among the accepted kinds — what the hint line should advertise. */
export function maxBytesFor(kinds: readonly AssetKind[]): number {
  return Math.max(...kinds.map((kind) => MAX_BYTES_BY_KIND[kind]));
}

/** Every allowed format, for the "type not supported" message. */
function allFormatsLabel(): string {
  return formatsLabelFor(["image", "audio"]);
}

// ---------------------------------------------------------------------------
// Grid filtering — the same "kinds" contract the browse dialog and drop zone
// use, applied to the asset list so the grid can't show a card the picker
// wouldn't otherwise accept (wi-mapa-som-01 review §3).
// ---------------------------------------------------------------------------

/**
 * Classify a MIME type into the kind it belongs to, purely from its prefix.
 * Returns undefined for anything that isn't image/* or audio/* — an unknown
 * kind never matches a `kinds` filter, so it is excluded from a scoped grid
 * rather than guessed into one.
 */
export function assetKindFromMime(mimeType: string): AssetKind | undefined {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return undefined;
}

/**
 * Filter a list of assets down to the ones whose kind (derived from
 * `mime_type`) is in `kinds`. Used by the FilePicker to render the grid —
 * an image picker never shows an .mp3 card, an audio picker never shows a
 * .png card.
 *
 * Generic over any object with a `mime_type` field so this module doesn't
 * need to import `AssetEntry` from assetApi.ts.
 */
export function filterAssetsByKinds<T extends { mime_type: string }>(
  assets: readonly T[],
  kinds: readonly AssetKind[],
): T[] {
  return assets.filter((asset) => {
    const kind = assetKindFromMime(asset.mime_type);
    return kind !== undefined && kinds.includes(kind);
  });
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
  return ALLOWED_EXTENSIONS[ext]?.kind === "image";
}
