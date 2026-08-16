/**
 * Worlds module public API.
 */
export {
  WorldManager,
  WorldNotFoundError,
  WorldLockedError,
  WorldAlreadyOpenError,
  InvalidSlugError,
  WorldSystemNotFoundError,
} from "./world-manager.js";

export type { WorldManagerOptions, RestoreResult, BackupRetention } from "./world-manager.js";

// D4/T024 restore fix: readAssetManifest (used by `fusion world restore`'s
// preview to report the asset count before executing) and the error types
// a caller of restoreBackup may want to distinguish.
export {
  readAssetManifest,
  CorruptedAssetManifestError,
  MissingAssetBlobError,
} from "./asset-backup.js";

export type { AssetBackupManifest, AssetManifestEntry } from "./asset-backup.js";
