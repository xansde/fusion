/**
 * usersSectionState.test.ts — the list↔create↔edit machine inside "Usuários"
 * (spec 37 §5.6, G105, REQ-CFG-051/052/053).
 */

import { describe, expect, it } from "vitest";
import { UsersSectionState } from "../usersSectionState.svelte.js";

describe("UsersSectionState — REQ-CFG-051/052: list↔create↔edit, never a window", () => {
  it("starts on the list", () => {
    const state = new UsersSectionState();
    expect(state.view).toEqual({ kind: "list" });
  });

  it("openCreate switches to the create form", () => {
    const state = new UsersSectionState();
    state.openCreate();
    expect(state.view).toEqual({ kind: "create" });
  });

  it("openEdit switches to the edit form for that user", () => {
    const state = new UsersSectionState();
    state.openEdit("u1");
    expect(state.view).toEqual({ kind: "edit", userId: "u1" });
  });

  it("backToList always lands back on the list", () => {
    const state = new UsersSectionState();
    state.openEdit("u1");
    state.backToList();
    expect(state.view).toEqual({ kind: "list" });
  });
});

describe("UsersSectionState.resetReveal — REQ-CFG-053: the one-time password", () => {
  it("is null until a reset is shown", () => {
    const state = new UsersSectionState();
    expect(state.resetReveal).toBeNull();
  });

  it("showResetReveal makes the reveal available", () => {
    const state = new UsersSectionState();
    state.showResetReveal({ userId: "u1", userName: "Alice", password: "abc123" });
    expect(state.resetReveal).toEqual({ userId: "u1", userName: "Alice", password: "abc123" });
  });

  it("clearResetReveal dismisses it explicitly", () => {
    const state = new UsersSectionState();
    state.showResetReveal({ userId: "u1", userName: "Alice", password: "abc123" });
    state.clearResetReveal();
    expect(state.resetReveal).toBeNull();
  });

  it("REQ-CFG-053: navigating to create clears a pending reveal — not recoverable after leaving the screen", () => {
    const state = new UsersSectionState();
    state.showResetReveal({ userId: "u1", userName: "Alice", password: "abc123" });
    state.openCreate();
    expect(state.resetReveal).toBeNull();
  });

  it("REQ-CFG-053: navigating to edit another user clears a pending reveal", () => {
    const state = new UsersSectionState();
    state.showResetReveal({ userId: "u1", userName: "Alice", password: "abc123" });
    state.openEdit("u2");
    expect(state.resetReveal).toBeNull();
  });

  it("REQ-CFG-053: returning to the list clears a pending reveal", () => {
    const state = new UsersSectionState();
    state.showResetReveal({ userId: "u1", userName: "Alice", password: "abc123" });
    state.backToList();
    expect(state.resetReveal).toBeNull();
  });
});
