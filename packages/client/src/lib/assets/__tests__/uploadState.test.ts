/**
 * uploadState.test.ts — unit tests for the pure upload state machine.
 *
 * No DOM, no Svelte, no network. Safe for Vitest.
 */

import { describe, it, expect } from "vitest";
import {
  createUploadState,
  toValidating,
  toUploading,
  withProgress,
  toDone,
  toError,
  toIdle,
  isInFlight,
  canUpload,
  type UploadState,
} from "../uploadState.js";
import type { UploadResult } from "../assetApi.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name = "goblin.png"): File {
  return new File([new Uint8Array(100)], name, { type: "image/png" });
}

function makeResult(overrides: Partial<UploadResult> = {}): UploadResult {
  return {
    ok: true,
    deduplicated: false,
    path: "goblin-a3b4c5d6.png",
    digest: "a3b4c5d6" + "0".repeat(56),
    mime_type: "image/png",
    file_size: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createUploadState
// ---------------------------------------------------------------------------

describe("createUploadState", () => {
  it("creates an idle state", () => {
    const state = createUploadState();
    expect(state.status).toBe("idle");
    expect(state.percent).toBeNull();
    expect(state.result).toBeNull();
    expect(state.errorMessage).toBeNull();
    expect(state.file).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toValidating
// ---------------------------------------------------------------------------

describe("toValidating", () => {
  it("sets status=validating and attaches file", () => {
    const file = makeFile();
    const state = toValidating(file);
    expect(state.status).toBe("validating");
    expect(state.file).toBe(file);
    expect(state.percent).toBeNull();
    expect(state.result).toBeNull();
    expect(state.errorMessage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toUploading
// ---------------------------------------------------------------------------

describe("toUploading", () => {
  it("transitions to uploading with percent=0", () => {
    const file = makeFile();
    const validating = toValidating(file);
    const uploading = toUploading(validating);
    expect(uploading.status).toBe("uploading");
    expect(uploading.percent).toBe(0);
    expect(uploading.file).toBe(file);
  });

  it("preserves the file reference", () => {
    const file = makeFile("map.webp");
    const state = toUploading(toValidating(file));
    expect(state.file).toBe(file);
  });
});

// ---------------------------------------------------------------------------
// withProgress
// ---------------------------------------------------------------------------

describe("withProgress", () => {
  function makeUploading(): UploadState {
    return toUploading(toValidating(makeFile()));
  }

  it("updates percent when status=uploading", () => {
    const state = withProgress(makeUploading(), 42);
    expect(state.percent).toBe(42);
  });

  it("clamps percent to 0–100", () => {
    expect(withProgress(makeUploading(), -5).percent).toBe(0);
    expect(withProgress(makeUploading(), 105).percent).toBe(100);
  });

  it("is a no-op when status is not uploading", () => {
    const idle = createUploadState();
    const same = withProgress(idle, 50);
    expect(same).toBe(idle); // identity — no new object
  });
});

// ---------------------------------------------------------------------------
// toDone
// ---------------------------------------------------------------------------

describe("toDone", () => {
  it("sets status=done, percent=100, result, clears error", () => {
    const file = makeFile();
    const uploading = toUploading(toValidating(file));
    const withErr = toError(uploading, "Previous error");
    // Done from an error state (edge case)
    const result = makeResult();
    const done = toDone(withErr, result);

    expect(done.status).toBe("done");
    expect(done.percent).toBe(100);
    expect(done.result).toBe(result);
    expect(done.errorMessage).toBeNull();
    expect(done.file).toBe(file);
  });

  it("preserves the file reference", () => {
    const file = makeFile("dungeon.jpg");
    const state = toDone(toUploading(toValidating(file)), makeResult());
    expect(state.file).toBe(file);
  });
});

// ---------------------------------------------------------------------------
// toError
// ---------------------------------------------------------------------------

describe("toError", () => {
  it("sets status=error and errorMessage, clears percent and result", () => {
    const file = makeFile();
    const uploading = toUploading(toValidating(file));
    const errState = toError(uploading, "File too large");

    expect(errState.status).toBe("error");
    expect(errState.errorMessage).toBe("File too large");
    expect(errState.percent).toBeNull();
    expect(errState.result).toBeNull();
    expect(errState.file).toBe(file);
  });
});

// ---------------------------------------------------------------------------
// toIdle
// ---------------------------------------------------------------------------

describe("toIdle", () => {
  it("returns a fresh idle state (same as createUploadState)", () => {
    const idle = toIdle();
    expect(idle.status).toBe("idle");
    expect(idle.file).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isInFlight
// ---------------------------------------------------------------------------

describe("isInFlight", () => {
  it("returns true for validating", () => {
    expect(isInFlight(toValidating(makeFile()))).toBe(true);
  });

  it("returns true for uploading", () => {
    expect(isInFlight(toUploading(toValidating(makeFile())))).toBe(true);
  });

  it("returns false for idle", () => {
    expect(isInFlight(createUploadState())).toBe(false);
  });

  it("returns false for done", () => {
    const done = toDone(toUploading(toValidating(makeFile())), makeResult());
    expect(isInFlight(done)).toBe(false);
  });

  it("returns false for error", () => {
    const err = toError(toUploading(toValidating(makeFile())), "oops");
    expect(isInFlight(err)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canUpload
// ---------------------------------------------------------------------------

describe("canUpload", () => {
  it("returns true for idle", () => {
    expect(canUpload(createUploadState())).toBe(true);
  });

  it("returns true for error (allows retry)", () => {
    const err = toError(toUploading(toValidating(makeFile())), "oops");
    expect(canUpload(err)).toBe(true);
  });

  it("returns false for validating", () => {
    expect(canUpload(toValidating(makeFile()))).toBe(false);
  });

  it("returns false for uploading", () => {
    expect(canUpload(toUploading(toValidating(makeFile())))).toBe(false);
  });

  it("returns false for done", () => {
    const done = toDone(toUploading(toValidating(makeFile())), makeResult());
    expect(canUpload(done)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Immutability: transitions return new objects
// ---------------------------------------------------------------------------

describe("state immutability", () => {
  it("toUploading returns a new object", () => {
    const v = toValidating(makeFile());
    const u = toUploading(v);
    expect(u).not.toBe(v);
  });

  it("withProgress returns a new object", () => {
    const u = toUploading(toValidating(makeFile()));
    const p = withProgress(u, 50);
    expect(p).not.toBe(u);
  });

  it("toDone returns a new object", () => {
    const u = toUploading(toValidating(makeFile()));
    const d = toDone(u, makeResult());
    expect(d).not.toBe(u);
  });

  it("toError returns a new object", () => {
    const u = toUploading(toValidating(makeFile()));
    const e = toError(u, "err");
    expect(e).not.toBe(u);
  });
});

// ---------------------------------------------------------------------------
// assetUrl (imported from assetApi to ensure basic URL construction)
// ---------------------------------------------------------------------------

import { assetUrl } from "../assetApi.js";

describe("assetUrl", () => {
  it("returns /assets/<name> for a plain filename", () => {
    expect(assetUrl("goblin-a3b4c5d6.webp")).toBe("/assets/goblin-a3b4c5d6.webp");
  });

  it("percent-encodes special characters in the filename", () => {
    // Name with a space should be encoded
    const url = assetUrl("my file.png");
    expect(url).toBe("/assets/my%20file.png");
  });

  it("keeps slash separator intact for subdirectory paths", () => {
    // If a subpath is used (future extension), slashes should remain
    const url = assetUrl("tokens/goblin.png");
    expect(url).toBe("/assets/tokens/goblin.png");
  });
});
