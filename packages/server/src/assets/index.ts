/**
 * Assets module public API.
 *
 * Re-exports the asset route registration function and related utilities.
 *
 * REQ-AST-006..008, REQ-AST-011, REQ-AST-019, REQ-AST-024 (upload + serving)
 * REQ-SEC-040..042, REQ-SEC-044 (security controls)
 */

export { registerAssetRoutes } from "./routes.js";
export type { RegisterAssetRoutesOptions } from "./routes.js";
export { detectType, ALLOWED_TYPES } from "./magic-bytes.js";
export type { DetectedType } from "./magic-bytes.js";
export { sanitizeSvg, svgHasXssVectors } from "./svg-sanitize.js";
export { guardPath, guardFilename, PathTraversalError } from "./path-guard.js";
export { buildSafeFilename, sha256Hex, slugifyBasename, randomHex16 } from "./slug.js";
