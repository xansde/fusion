/**
 * Magic-byte validation for uploaded files.
 *
 * REQ-AST-007 / REQ-SEC-041: The real file type is determined by inspecting
 * the leading bytes of the file buffer, never by trusting the client-supplied
 * Content-Type or file extension.
 *
 * We accept images (PNG, JPEG, WebP, SVG) and ambient audio (MP3, OGG).
 * SVG is detected as UTF-8/XML text starting with an optional BOM followed
 * by a `<svg` or `<?xml` prefix — no binary magic bytes.
 *
 * WAV is deliberately NOT accepted: it shares the `RIFF` prefix with WebP and
 * only bytes 8-11 tell them apart (`WAVE` vs `WEBP`). Supporting it would mean
 * reworking `isWebp`, which already reads those bytes correctly — risk with no
 * caller asking for it.
 *
 * Supported MIME types → canonical extension mappings are defined in
 * ALLOWED_TYPES below and are the single source of truth for what the upload
 * endpoint accepts.
 */

// ---------------------------------------------------------------------------
// Allowed-type map: detected mime → canonical file extension
// ---------------------------------------------------------------------------

export const ALLOWED_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
};

// ---------------------------------------------------------------------------
// Magic-byte signatures
// ---------------------------------------------------------------------------

/** PNG: 89 50 4E 47 0D 0A 1A 0A */
function isPng(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

/** JPEG: FF D8 FF */
function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/**
 * WebP: RIFF....WEBP
 * Bytes 0-3: 52 49 46 46 ("RIFF")
 * Bytes 8-11: 57 45 42 50 ("WEBP")
 */
function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  );
}

/**
 * OGG: 4F 67 67 53 ("OggS") — the container's page header.
 * No conflict with any other allowlisted format.
 */
function isOgg(buf: Buffer): boolean {
  return (
    buf.length >= 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53
  );
}

/**
 * MP3, in the two framings found in the wild:
 *   - with an ID3v2 tag: 49 44 33 ("ID3")
 *   - without a tag: a raw frame sync, FF followed by a byte whose three high
 *     bits are set (`b1 & 0xE0 === 0xE0`, i.e. FF Ex / FF Fx)
 *
 * The frame sync does NOT collide with JPEG's FF D8 FF: 0xD8 & 0xE0 is 0xC0.
 * `detectType` still evaluates `isJpeg` first — defensive ordering at zero cost.
 */
function isMp3(buf: Buffer): boolean {
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;

  const second = buf[1];
  return buf.length >= 2 && buf[0] === 0xff && second !== undefined && (second & 0xe0) === 0xe0;
}

/**
 * SVG: UTF-8 text beginning with optional BOM (EF BB BF) then either:
 *   - `<svg` (case-insensitive, possible leading whitespace)
 *   - `<?xml` followed somewhere in the preview by `<svg` (XML declaration
 *     before the root element) — we require the `<svg` to be present so that
 *     generic XML documents (<?xml?><foo/>) are not classified as SVG.
 *
 * We check the first 512 bytes to allow for a typical XML declaration.
 */
function isSvg(buf: Buffer): boolean {
  if (buf.length < 4) return false;

  // Strip UTF-8 BOM if present
  let start = 0;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    start = 3;
  }

  const preview = buf.subarray(start, Math.min(start + 512, buf.length)).toString("utf8");
  const trimmed = preview.trimStart();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("<svg")) return true;

  // XML declaration must be followed by an <svg root element within the preview
  if (lower.startsWith("<?xml")) {
    return lower.includes("<svg");
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DetectedType {
  mime: string;
  ext: string;
}

/**
 * Detect the real MIME type of a file by examining its leading bytes.
 *
 * Returns the detected {@link DetectedType} when the file is one of the
 * allowlisted types, or `null` when the bytes do not match any supported
 * format.
 *
 * REQ-AST-007: Supported — PNG, JPEG, WebP, SVG, MP3, OGG.
 *
 * Order matters: the binary signatures that anchor on fixed bytes come first,
 * `isJpeg` before `isMp3` (see {@link isMp3}), and `isSvg` last because it is
 * the only heuristic one (it sniffs text).
 */
export function detectType(buf: Buffer): DetectedType | null {
  if (isPng(buf)) return { mime: "image/png", ext: ".png" };
  if (isJpeg(buf)) return { mime: "image/jpeg", ext: ".jpg" };
  if (isWebp(buf)) return { mime: "image/webp", ext: ".webp" };
  if (isOgg(buf)) return { mime: "audio/ogg", ext: ".ogg" };
  if (isMp3(buf)) return { mime: "audio/mpeg", ext: ".mp3" };
  if (isSvg(buf)) return { mime: "image/svg+xml", ext: ".svg" };
  return null;
}
