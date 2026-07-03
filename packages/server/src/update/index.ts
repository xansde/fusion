/**
 * Update module public API (M6/B5 — REQ-DST-019..025).
 */

export { checkForUpdate } from "./update-checker.js";
export type { UpdateCheckResult, CheckForUpdateOptions } from "./update-checker.js";

export { fetchUpdateManifest, currentPlatformKey, ManifestFetchError } from "./manifest-client.js";
export type {
  UpdateManifest,
  UpdateManifestPlatformEntry,
  UpdateChannel,
  FetchManifestOptions,
} from "./manifest-client.js";

export { compareVersions, isNewerVersion, parseVersion } from "./semver.js";
export type { ParsedVersion } from "./semver.js";

export {
  downloadAndVerify,
  cleanupTmpFile,
  UpdateHashMismatchError,
  UpdateDownloadError,
} from "./downloader.js";

export { isRunningAsSea } from "./sea-detect.js";

export {
  buildSwapHelperScript,
  scheduleSwap,
  SWAP_HELPER_FLAG,
  MAIN_EXIT_TIMEOUT_MS,
  POST_SWAP_WATCH_MS,
} from "./swap-helper.js";
export type { SwapPlan, ScheduleSwapOptions } from "./swap-helper.js";

export { applyUpdate } from "./updater.js";
export type {
  ApplyUpdateOptions,
  ApplyUpdateResult,
  ApplyUpdateSuccess,
  ApplyUpdateFailure,
  ApplyUpdateFailureCode,
} from "./updater.js";

export { registerUpdateRoutes } from "./routes.js";
export type { RegisterUpdateRoutesOptions } from "./routes.js";
