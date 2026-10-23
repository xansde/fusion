/**
 * worldSectionState.test.ts — per-row write-failure state for "Mundo"
 * (spec 37 §5.4, G102, REQ-CFG-073).
 */

import { describe, expect, it } from "vitest";
import { WorldSectionState } from "../worldSectionState.svelte.js";

describe("WorldSectionState — REQ-CFG-073: the reason a refused write carries", () => {
  it("starts with no error for any key", () => {
    const state = new WorldSectionState();
    expect(state.errorFor("pf2e:freeArchetype")).toBeNull();
  });

  it("setError records the message for that key only", () => {
    const state = new WorldSectionState();
    state.setError("pf2e:freeArchetype", "papel insuficiente");

    expect(state.errorFor("pf2e:freeArchetype")).toBe("papel insuficiente");
    expect(state.errorFor("pf2e:multiclass")).toBeNull();
  });

  it("clearError removes a recorded error", () => {
    const state = new WorldSectionState();
    state.setError("pf2e:freeArchetype", "papel insuficiente");
    state.clearError("pf2e:freeArchetype");

    expect(state.errorFor("pf2e:freeArchetype")).toBeNull();
  });

  it("clearError on a key with no error is a no-op", () => {
    const state = new WorldSectionState();
    state.clearError("pf2e:freeArchetype");

    expect(state.errorFor("pf2e:freeArchetype")).toBeNull();
  });

  it("a later setError for the same key replaces the previous message", () => {
    const state = new WorldSectionState();
    state.setError("pf2e:freeArchetype", "primeiro erro");
    state.setError("pf2e:freeArchetype", "segundo erro");

    expect(state.errorFor("pf2e:freeArchetype")).toBe("segundo erro");
  });
});
