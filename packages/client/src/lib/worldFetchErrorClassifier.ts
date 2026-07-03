/**
 * Pure classification helper for `fusionApi.fetchWorldInfo()` (GET /api/world)
 * failures, used by session.svelte.ts's sessionActions.load().
 *
 * Kept in its own plain .ts file (no Svelte runes) so it can be imported
 * directly by a vitest test: session.svelte.ts uses `$state()` at module
 * scope, which requires the Svelte preprocessor to compile — vitest.config.ts
 * here runs plain .test.ts files under a "node" environment with no svelte
 * plugin, so importing anything from a $state()-bearing module (even an
 * unrelated named export) fails at import time.
 */

import { ApiError } from "./api.js";

/**
 * Classifies a failure from `fusionApi.fetchWorldInfo()` (GET /api/world).
 *
 * - "management": the request reached the server and got a clean 404
 *   NOT_FOUND — this route only exists once a world is open (see
 *   boot.ts's conditional authContext registration), so a 404 here means
 *   "server up, no world open" (management mode), not "server down".
 * - "unreachable": anything else — fetch() itself threw (network error,
 *   DNS failure, connection refused — never an ApiError), or the server
 *   returned an unexpected non-404 error.
 *
 * Regression context (manual validation round 2): previously ANY failure
 * from fetchWorldInfo() — network error or a clean "no world open" 404 —
 * rendered the same raw "Cannot reach the server. Is it running?" error on
 * the join screen, even though a management-mode server (no --world) is
 * fully up and reachable. See ManagementScreen.svelte for the UI shown when
 * this classifies as "management".
 */
export function classifyWorldFetchError(err: unknown): "management" | "unreachable" {
  if (err instanceof ApiError && err.httpStatus === 404 && err.code === "NOT_FOUND") {
    return "management";
  }
  return "unreachable";
}
