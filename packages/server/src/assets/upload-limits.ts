/**
 * Per-kind upload limits for the asset endpoint.
 *
 * REQ-AST-008: size limits are defined per media kind, not globally. Spec 20
 * (`specs/20-assets-e-midia.md`) sets images at 50 MB, audio at 100 MB and
 * video at 500 MB; the server keeps images at the 20 MB it has always enforced
 * (raising that is a behaviour change nobody asked for) and adopts the spec
 * number for audio.
 *
 * Why a module of its own: the cap can only be charged AFTER `detectType`,
 * because the kind is only known once the bytes are read. The `fileSize` limit
 * handed to `@fastify/multipart` is blind to the type, so it becomes the GLOBAL
 * ceiling (the largest of the kinds) and this module owns the second, typed
 * check that produces the useful error message.
 *
 * THIS FILE IS THE AUTHORITY on the numbers. `packages/client/src/lib/assets/
 * clientValidation.ts` carries a copy for UX anticipation only — it never
 * decides anything. There is no shared package for assets; promoting two
 * constants to `@fusion/shared` would drag the shared→server build order into
 * this change. Revisit if the format list grows again (video, fonts).
 */

import { ALLOWED_TYPES } from "./magic-bytes.js";

/** The media kinds the upload endpoint knows how to size-limit. */
export type AssetKind = "image" | "audio";

/** Maximum bytes accepted per kind. */
export const MAX_BYTES_BY_KIND: Record<AssetKind, number> = {
  image: 20 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
};

/**
 * The largest per-kind cap — used as the `fileSize` limit of the multipart
 * parser, which cannot know the kind while the stream is still arriving.
 *
 * Consequence accepted knowingly: an oversized image is now materialised in
 * memory (`toBuffer`) before being rejected, because the stream is only cut at
 * the global ceiling. On a single-table local server where uploading requires
 * `role >= TRUSTED`, that is cheaper than routing per type.
 */
export const MAX_UPLOAD_BYTES_GLOBAL: number = Math.max(...Object.values(MAX_BYTES_BY_KIND));

/**
 * Map a DETECTED mime type (never a client-supplied one) to its kind.
 *
 * Returns `null` for anything outside {@link ALLOWED_TYPES}, so an unknown mime
 * can never fall through to a default cap.
 */
export function kindOfMime(mime: string): AssetKind | null {
  if (!(mime in ALLOWED_TYPES)) return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

/**
 * The cap actually enforced for `kind`, given the request-scoped global ceiling
 * and optional per-kind overrides.
 *
 * The three limits are combined with `min` so that lowering the global ceiling
 * (as the existing test context does, with 1 MB) keeps working, and so an
 * override can never widen a limit past what the multipart parser will accept.
 */
export function effectiveCapForKind(
  kind: AssetKind,
  globalMaxBytes: number,
  overrides?: Partial<Record<AssetKind, number>>,
): number {
  const perKind = overrides?.[kind] ?? MAX_BYTES_BY_KIND[kind];
  return Math.min(globalMaxBytes, perKind);
}
