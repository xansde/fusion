/**
 * permissionsSectionState.test.ts — per-row write-failure state for
 * "Permissões" (spec 37 §5.5, G104, REQ-CFG-042/073).
 */

import { describe, expect, it } from "vitest";
import { PermissionsSectionState } from "../permissionsSectionState.svelte.js";

describe("PermissionsSectionState — REQ-CFG-042/073: the reason a refused write carries", () => {
  it("starts with no error for any key", () => {
    const state = new PermissionsSectionState();
    expect(state.errorFor("ACTOR_CREATE")).toBeNull();
  });

  it("setError records the message for that key only", () => {
    const state = new PermissionsSectionState();
    state.setError("ACTOR_CREATE", "papel insuficiente");

    expect(state.errorFor("ACTOR_CREATE")).toBe("papel insuficiente");
    expect(state.errorFor("ITEM_CREATE")).toBeNull();
  });

  it("clearError removes a recorded error", () => {
    const state = new PermissionsSectionState();
    state.setError("ACTOR_CREATE", "papel insuficiente");
    state.clearError("ACTOR_CREATE");

    expect(state.errorFor("ACTOR_CREATE")).toBeNull();
  });

  it("clearError on a key with no error is a no-op", () => {
    const state = new PermissionsSectionState();
    state.clearError("ACTOR_CREATE");

    expect(state.errorFor("ACTOR_CREATE")).toBeNull();
  });
});
