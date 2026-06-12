/**
 * uploadState.ts — pure state machine for a single file upload.
 *
 * Models the lifecycle of an upload from the moment a file is picked until
 * the server acknowledges success or returns an error.
 *
 * States:
 *   idle        → File not yet being uploaded.
 *   validating  → Client-side extension/size check in progress (synchronous,
 *                 but modelled as a state for UI consistency).
 *   uploading   → XHR in flight; progress.percent tracks completion.
 *   done        → Server returned success (UploadResult available).
 *   error       → Validation failed OR server rejected the upload.
 *
 * Pure module — no DOM, no Svelte, no side effects. Safe for Vitest.
 */

import type { UploadResult } from "./assetApi.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadStatus = "idle" | "validating" | "uploading" | "done" | "error";

export interface UploadState {
  status: UploadStatus;
  /** 0–100 while uploading; null otherwise. */
  percent: number | null;
  /** Set when status === "done". */
  result: UploadResult | null;
  /** Human-readable error message. Set when status === "error". */
  errorMessage: string | null;
  /** The original File, set when the upload starts. */
  file: File | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUploadState(): UploadState {
  return {
    status: "idle",
    percent: null,
    result: null,
    errorMessage: null,
    file: null,
  };
}

// ---------------------------------------------------------------------------
// Transitions (return new state objects — no mutation)
// ---------------------------------------------------------------------------

export function toValidating(file: File): UploadState {
  return {
    status: "validating",
    percent: null,
    result: null,
    errorMessage: null,
    file,
  };
}

export function toUploading(state: UploadState): UploadState {
  return { ...state, status: "uploading", percent: 0 };
}

export function withProgress(state: UploadState, percent: number): UploadState {
  if (state.status !== "uploading") return state;
  return { ...state, percent: Math.max(0, Math.min(100, percent)) };
}

export function toDone(state: UploadState, result: UploadResult): UploadState {
  return {
    ...state,
    status: "done",
    percent: 100,
    result,
    errorMessage: null,
  };
}

export function toError(state: UploadState, message: string): UploadState {
  return {
    ...state,
    status: "error",
    percent: null,
    result: null,
    errorMessage: message,
  };
}

export function toIdle(): UploadState {
  return createUploadState();
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

export function isInFlight(state: UploadState): boolean {
  return state.status === "validating" || state.status === "uploading";
}

export function canUpload(state: UploadState): boolean {
  return state.status === "idle" || state.status === "error";
}
