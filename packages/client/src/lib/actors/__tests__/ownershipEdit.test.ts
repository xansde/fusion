/**
 * ownershipEdit.test.ts — Unit tests for the OwnershipDialog's pure logic.
 *
 * REQ-USR-015: GM alters ownership of any Document via a dedicated interface.
 */

import { describe, it, expect } from "vitest";
import { OwnershipLevel } from "@fusion/shared";
import type { Ownership } from "@fusion/shared";
import {
  deriveOwnershipFormState,
  buildOwnershipDiff,
  ownershipLevelI18nKey,
  DEFAULT_LEVEL_OPTIONS,
  PER_USER_LEVEL_OPTIONS,
  type OwnershipFormState,
} from "../ownershipEdit.js";

// ---------------------------------------------------------------------------
// deriveOwnershipFormState
// ---------------------------------------------------------------------------

describe("deriveOwnershipFormState()", () => {
  it("reads the 'default' entry as the default level", () => {
    const ownership: Ownership = { default: OwnershipLevel.OBSERVER };
    const state = deriveOwnershipFormState(ownership, []);
    expect(state.default).toBe(OwnershipLevel.OBSERVER);
  });

  it("falls back to NONE when 'default' is somehow absent", () => {
    // Cast because the real Ownership schema requires "default", but the
    // fallback path defends against a malformed/partial doc anyway.
    const ownership = {} as Ownership;
    const state = deriveOwnershipFormState(ownership, []);
    expect(state.default).toBe(OwnershipLevel.NONE);
  });

  it("maps a user with an explicit entry to that level", () => {
    const ownership: Ownership = { default: 0, "user-1": OwnershipLevel.OWNER };
    const state = deriveOwnershipFormState(ownership, ["user-1"]);
    expect(state.perUser["user-1"]).toBe(OwnershipLevel.OWNER);
  });

  it("maps a user with no explicit entry to INHERIT", () => {
    const ownership: Ownership = { default: 0 };
    const state = deriveOwnershipFormState(ownership, ["user-1"]);
    expect(state.perUser["user-1"]).toBe(OwnershipLevel.INHERIT);
  });

  it("maps a user with an explicit INHERIT entry to INHERIT", () => {
    const ownership: Ownership = { default: 0, "user-1": OwnershipLevel.INHERIT };
    const state = deriveOwnershipFormState(ownership, ["user-1"]);
    expect(state.perUser["user-1"]).toBe(OwnershipLevel.INHERIT);
  });

  it("produces one perUser entry per given userId, in no particular order requirement", () => {
    const ownership: Ownership = { default: 0, "user-1": 3 };
    const state = deriveOwnershipFormState(ownership, ["user-1", "user-2", "user-3"]);
    expect(Object.keys(state.perUser).sort()).toEqual(["user-1", "user-2", "user-3"]);
  });
});

// ---------------------------------------------------------------------------
// buildOwnershipDiff
// ---------------------------------------------------------------------------

describe("buildOwnershipDiff()", () => {
  it("includes an explicit 'default' key", () => {
    const form: OwnershipFormState = { default: OwnershipLevel.LIMITED, perUser: {} };
    const diff = buildOwnershipDiff(form);
    expect(diff["default"]).toBe(OwnershipLevel.LIMITED);
  });

  it("includes an explicit entry for every user in perUser, even INHERIT", () => {
    const form: OwnershipFormState = {
      default: OwnershipLevel.NONE,
      perUser: {
        "user-1": OwnershipLevel.OWNER,
        "user-2": OwnershipLevel.INHERIT,
      },
    };
    const diff = buildOwnershipDiff(form);
    expect(diff["user-1"]).toBe(OwnershipLevel.OWNER);
    // MERGE ENGINE DECISION: INHERIT must be written explicitly — omitting
    // "user-2" would let deepMerge (packages/server/src/documents/merge.ts)
    // preserve whatever the previous ownership map held for that key,
    // silently failing to "revoke" a previously-granted level.
    expect(diff["user-2"]).toBe(OwnershipLevel.INHERIT);
    expect("user-2" in diff).toBe(true);
  });

  it("round-trips through deriveOwnershipFormState for a previously-set map", () => {
    const original: Ownership = {
      default: OwnershipLevel.NONE,
      "user-1": OwnershipLevel.OWNER,
      "user-2": OwnershipLevel.OBSERVER,
    };
    const state = deriveOwnershipFormState(original, ["user-1", "user-2"]);
    const diff = buildOwnershipDiff(state);
    expect(diff).toEqual(original);
  });

  it("revoking a user (switching to INHERIT) is written explicitly, not omitted", () => {
    const original: Ownership = { default: 0, "user-1": OwnershipLevel.OWNER };
    const state = deriveOwnershipFormState(original, ["user-1"]);
    // Simulate the GM flipping user-1's select to "Herdar do padrão".
    state.perUser["user-1"] = OwnershipLevel.INHERIT;
    const diff = buildOwnershipDiff(state);
    expect(diff["user-1"]).toBe(OwnershipLevel.INHERIT);
  });
});

// ---------------------------------------------------------------------------
// Level option lists
// ---------------------------------------------------------------------------

describe("level option lists", () => {
  it("DEFAULT_LEVEL_OPTIONS never includes INHERIT", () => {
    expect(DEFAULT_LEVEL_OPTIONS).not.toContain(OwnershipLevel.INHERIT);
  });

  it("PER_USER_LEVEL_OPTIONS includes INHERIT", () => {
    expect(PER_USER_LEVEL_OPTIONS).toContain(OwnershipLevel.INHERIT);
  });

  it("PER_USER_LEVEL_OPTIONS has one entry per OwnershipLevel value", () => {
    expect(PER_USER_LEVEL_OPTIONS).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// ownershipLevelI18nKey
// ---------------------------------------------------------------------------

describe("ownershipLevelI18nKey()", () => {
  it.each([
    [OwnershipLevel.INHERIT, "Inherit"],
    [OwnershipLevel.NONE, "None"],
    [OwnershipLevel.LIMITED, "Limited"],
    [OwnershipLevel.OBSERVER, "Observer"],
    [OwnershipLevel.OWNER, "Owner"],
  ])("maps %s to %s", (level, expected) => {
    expect(ownershipLevelI18nKey(level)).toBe(expected);
  });
});
