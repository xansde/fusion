/**
 * Tests for classifyWorldFetchError (manual validation round 2 finding):
 * the join screen used to show the same raw "Cannot reach the server" error
 * whether the server was genuinely down OR simply running in management
 * mode (no world open — GET /api/world isn't even registered in that case,
 * see boot.ts). This asserts the classification that now distinguishes the
 * two cases so session.svelte.ts's sessionActions.load() can route to
 * ManagementScreen.svelte instead of a raw error.
 */

import { describe, it, expect } from "vitest";
import { classifyWorldFetchError } from "../worldFetchErrorClassifier.js";
import { ApiError } from "../api.js";

describe("classifyWorldFetchError", () => {
  it("classifies a 404 NOT_FOUND ApiError as 'management' (no world open)", () => {
    const err = new ApiError("NOT_FOUND", 404, "Not found");
    expect(classifyWorldFetchError(err)).toBe("management");
  });

  it("classifies a network failure (plain Error, not ApiError) as 'unreachable'", () => {
    // fetch() itself throws a TypeError on network failure — never an ApiError.
    const err = new TypeError("Failed to fetch");
    expect(classifyWorldFetchError(err)).toBe("unreachable");
  });

  it("classifies a non-404 ApiError (e.g. 500 INTERNAL_ERROR) as 'unreachable'", () => {
    const err = new ApiError("INTERNAL_ERROR", 500, "Server error");
    expect(classifyWorldFetchError(err)).toBe("unreachable");
  });

  it("classifies a 404 ApiError with a different code as 'unreachable' (must match NOT_FOUND exactly)", () => {
    const err = new ApiError("SOME_OTHER_CODE", 404, "Not found, but different code");
    expect(classifyWorldFetchError(err)).toBe("unreachable");
  });

  it("classifies undefined/null/unknown thrown values as 'unreachable'", () => {
    expect(classifyWorldFetchError(undefined)).toBe("unreachable");
    expect(classifyWorldFetchError(null)).toBe("unreachable");
    expect(classifyWorldFetchError("some string")).toBe("unreachable");
  });
});
