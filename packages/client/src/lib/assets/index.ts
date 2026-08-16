/**
 * assets/index.ts — public API of the client assets module.
 */

export {
  listAssets,
  uploadAsset,
  deleteAsset,
  assetUrl,
  assetNameFromPath,
  fetchAssetToken,
  resolveAssetUrl,
  resolveBrowseAssetUrl,
  needsAssetQueryToken,
} from "./assetApi.js";
export type {
  AssetEntry,
  AssetQueryToken,
  UploadResult,
  UploadProgress,
  UploadProgressCallback,
} from "./assetApi.js";

export {
  assetGrantsFor,
  assetGrantsCovering,
  invalidateAssetGrants,
  clearAssetGrantCache,
  peekAssetGrants,
  GRANTABLE_ASSET_TABLES,
} from "./assetGrants.svelte.js";
export type { AssetDocRef, AssetDocTable, AssetGrantBundle } from "./assetGrants.svelte.js";

export {
  validateFileForUpload,
  validateFilesForUpload,
  getExtension,
  formatBytes,
  isImageExtension,
  MAX_UPLOAD_BYTES,
  ALLOWED_EXTENSIONS,
} from "./clientValidation.js";
export type { ValidationResult } from "./clientValidation.js";

export {
  createUploadState,
  toValidating,
  toUploading,
  withProgress,
  toDone,
  toError,
  toIdle,
  isInFlight,
  canUpload,
} from "./uploadState.js";
export type { UploadState, UploadStatus } from "./uploadState.js";

export { assetStore } from "./assetStore.svelte.js";
