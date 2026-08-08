/**
 * assets/index.ts — public API of the client assets module.
 */

export { listAssets, uploadAsset, deleteAsset, assetUrl } from "./assetApi.js";
export type {
  AssetEntry,
  UploadResult,
  UploadProgress,
  UploadProgressCallback,
} from "./assetApi.js";

export {
  validateFileForUpload,
  validateFilesForUpload,
  getExtension,
  formatBytes,
  isImageExtension,
  MAX_UPLOAD_BYTES,
  MAX_BYTES_BY_KIND,
  ALLOWED_EXTENSIONS,
  acceptAttrFor,
  formatsLabelFor,
  maxBytesFor,
} from "./clientValidation.js";
export type { ValidationResult, AssetKind } from "./clientValidation.js";

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
