/**
 * assetStore.svelte.ts — reactive store for the asset browser.
 *
 * Uses Svelte 5 runes ($state, $derived).
 * Logic delegates to assetApi.ts and clientValidation.ts — this module only
 * glues the reactive layer.
 *
 * Public API:
 *   assetStore.assets          — reactive array of AssetEntry
 *   assetStore.loading         — true while fetching the list
 *   assetStore.fetchError      — string | null
 *   assetStore.searchQuery     — reactive search string (bound by FilePicker)
 *   assetStore.filtered        — assets filtered by searchQuery (text only —
 *                                 kind filtering is the caller's job, see
 *                                 filterAssetsByKinds in clientValidation.ts)
 *   assetStore.uploads         — Map<File, UploadState> for in-flight uploads
 *   assetStore.loadAssets(token)   — fetch list from server
 *   assetStore.startUpload(token, file, onDone, kinds) — upload + refresh
 *                                 list; kinds, when given, rejects a file
 *                                 whose extension maps outside it before any
 *                                 network call (wi-mapa-som-01 review §3)
 *   assetStore.removeAsset(token, name) — GM-only delete + list update
 *   assetStore.setSearch(q)    — update search query
 */

import { listAssets, uploadAsset, deleteAsset, type AssetEntry } from "./assetApi.js";
import { validateFileForUpload, type AssetKind } from "./clientValidation.js";
import {
  createUploadState,
  toValidating,
  toUploading,
  withProgress,
  toDone,
  toError,
  type UploadState,
} from "./uploadState.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _assets = $state<AssetEntry[]>([]);
let _loading = $state(false);
let _fetchError = $state<string | null>(null);
let _searchQuery = $state("");

/**
 * Map from File identity to its upload state.
 * Using a Map<File, UploadState> and tracking reactivity via a version counter.
 */
const _uploadsMap = new Map<File, UploadState>();
let _uploadsVersion = $state(0);

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

function _getFiltered(): AssetEntry[] {
  const q = _searchQuery.trim().toLowerCase();
  if (!q) return _assets;
  return _assets.filter((a) => a.name.toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function loadAssets(token: string): Promise<void> {
  _loading = true;
  _fetchError = null;
  try {
    const result = await listAssets(token);
    _assets = result;
  } catch (err) {
    _fetchError = err instanceof Error ? err.message : "Failed to load assets.";
  } finally {
    _loading = false;
  }
}

/**
 * Upload a file and refresh the asset list on success.
 *
 * @param token    Bearer token.
 * @param file     File from input or drag-drop.
 * @param onDone   Called with the path of the uploaded asset on success.
 *                 The path is the safe filename (e.g. "goblin-a3b4c5d6.webp").
 * @param kinds    Optional: the kinds the calling picker offers. When given,
 *                 a file outside those kinds is rejected here — same error
 *                 slot as any other validation failure — before it ever
 *                 reaches uploadAsset(). This is what makes drag-and-drop and
 *                 the file input honor `kinds`, not just the browse dialog's
 *                 `accept` (wi-mapa-som-01 review §3).
 */
async function startUpload(
  token: string,
  file: File,
  onDone?: (path: string) => void,
  kinds?: readonly AssetKind[],
): Promise<void> {
  // Client-side validation (UX anticipation — not security)
  const validation = validateFileForUpload(file, kinds);

  if (!validation.ok) {
    _uploadsMap.set(file, toError(toValidating(file), validation.message));
    _uploadsVersion++;
    return;
  }

  // Transition to uploading
  _uploadsMap.set(file, toUploading(toValidating(file)));
  _uploadsVersion++;

  try {
    const result = await uploadAsset(token, file, (progress) => {
      const current = _uploadsMap.get(file) ?? createUploadState();
      _uploadsMap.set(file, withProgress(current, progress.percent ?? 0));
      _uploadsVersion++;
    });

    const current = _uploadsMap.get(file) ?? createUploadState();
    _uploadsMap.set(file, toDone(current, result));
    _uploadsVersion++;

    // Refresh the asset list
    await loadAssets(token);

    onDone?.(result.path);

    // Clean up the upload entry after a short delay so the UI shows "done"
    setTimeout(() => {
      _uploadsMap.delete(file);
      _uploadsVersion++;
    }, 2000);
  } catch (err) {
    const current = _uploadsMap.get(file) ?? createUploadState();
    const message = err instanceof Error ? err.message : "Upload failed.";
    _uploadsMap.set(file, toError(current, message));
    _uploadsVersion++;
  }
}

function setSearch(query: string): void {
  _searchQuery = query;
}

/**
 * Delete an asset (GM-only, enforced server-side) and drop it from the
 * reactive list on success.
 *
 * On failure `_assets` is left untouched and the error propagates to the
 * caller — the FilePicker surfaces it in its own error line rather than this
 * store owning a UI-shaped error slot for a single-shot action.
 *
 * @param token  Bearer token.
 * @param name   Asset filename, as listed in `assets`/`filtered`.
 */
async function removeAsset(token: string, name: string): Promise<void> {
  await deleteAsset(token, name);
  _assets = _assets.filter((a) => a.name !== name);
}

function clearUploadError(file: File): void {
  _uploadsMap.delete(file);
  _uploadsVersion++;
}

// ---------------------------------------------------------------------------
// Public store object
// ---------------------------------------------------------------------------

export const assetStore = {
  get assets(): AssetEntry[] {
    return _assets;
  },

  get loading(): boolean {
    return _loading;
  },

  get fetchError(): string | null {
    return _fetchError;
  },

  get searchQuery(): string {
    return _searchQuery;
  },

  get filtered(): AssetEntry[] {
    return _getFiltered();
  },

  /**
   * Snapshot of the uploads map. Subscribed components should read
   * `assetStore.uploadsVersion` to trigger re-renders.
   */
  get uploads(): Map<File, UploadState> {
    return _uploadsMap;
  },

  /**
   * Increments whenever the uploads map changes.
   * Components can track this value to re-render upload progress.
   */
  get uploadsVersion(): number {
    return _uploadsVersion;
  },

  loadAssets,
  startUpload,
  removeAsset,
  setSearch,
  clearUploadError,
};
