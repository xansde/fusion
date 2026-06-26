/**
 * combatVisibility.test.ts — unit tests for the role-based visibility machine.
 *
 * Covers: viewerRole, isCombatantVisibleTo, visibleCombatants,
 * redactCombatForViewer, canUseGmControls, canTarget.
 *
 * REQ-CBT-031..033: hidden combatants are never shown to a player (defense in
 * depth on top of server redaction).
 */

import { describe, it, expect } from "vitest";
import {
  viewerRole,
  isCombatantVisibleTo,
  visibleCombatants,
  redactCombatForViewer,
  canUseGmControls,
  canTarget,
} from "../combatVisibility.js";
import type { CombatDocument, CombatantDocument } from "@fusion/shared";

function makeCombatant(overrides: Partial<CombatantDocument> = {}): CombatantDocument {
  return {
    _id: "c1",
    tokenId: "t1",
    actorId: "a1",
    name: "Fighter",
    img: null,
    initiative: null,
    initiativeStatistic: null,
    hidden: false,
    defeated: false,
    hasPlayerOwner: true,
    flags: {},
    ...overrides,
  };
}

function makeCombat(overrides: Partial<CombatDocument> = {}): CombatDocument {
  return {
    _id: "combat1",
    sceneId: "scene1",
    round: 1,
    turnIndex: 0,
    started: false,
    ended: false,
    skipDefeated: true,
    autoPan: false,
    combatType: "standard",
    trackedResource: null,
    combatants: [],
    activeCombatantId: null,
    flags: {},
    sort: 0,
    ...overrides,
  };
}

describe("viewerRole", () => {
  it("maps privileged → gm", () => {
    expect(viewerRole(true)).toBe("gm");
  });
  it("maps non-privileged → player", () => {
    expect(viewerRole(false)).toBe("player");
  });
});

describe("isCombatantVisibleTo", () => {
  it("gm sees a hidden combatant", () => {
    expect(isCombatantVisibleTo(makeCombatant({ hidden: true }), "gm")).toBe(true);
  });
  it("gm sees a visible combatant", () => {
    expect(isCombatantVisibleTo(makeCombatant({ hidden: false }), "gm")).toBe(true);
  });
  it("player does NOT see a hidden combatant", () => {
    expect(isCombatantVisibleTo(makeCombatant({ hidden: true }), "player")).toBe(false);
  });
  it("player sees a non-hidden combatant", () => {
    expect(isCombatantVisibleTo(makeCombatant({ hidden: false }), "player")).toBe(true);
  });
});

describe("visibleCombatants", () => {
  it("gm gets the exact same array reference (zero alloc)", () => {
    const list = [makeCombatant({ _id: "c1", hidden: true }), makeCombatant({ _id: "c2" })];
    expect(visibleCombatants(list, "gm")).toBe(list);
  });

  it("player with no hidden gets the same reference (zero alloc)", () => {
    const list = [makeCombatant({ _id: "c1" }), makeCombatant({ _id: "c2" })];
    expect(visibleCombatants(list, "player")).toBe(list);
  });

  it("player with hidden combatants gets a filtered copy", () => {
    const list = [
      makeCombatant({ _id: "c1", hidden: false }),
      makeCombatant({ _id: "c2", hidden: true }),
      makeCombatant({ _id: "c3", hidden: false }),
    ];
    const result = visibleCombatants(list, "player");
    expect(result).not.toBe(list);
    expect(result.map((c) => c._id)).toEqual(["c1", "c3"]);
  });

  it("player sees nothing when all are hidden", () => {
    const list = [
      makeCombatant({ _id: "c1", hidden: true }),
      makeCombatant({ _id: "c2", hidden: true }),
    ];
    expect(visibleCombatants(list, "player")).toHaveLength(0);
  });
});

describe("redactCombatForViewer", () => {
  it("gm gets the original document reference", () => {
    const combat = makeCombat({ combatants: [makeCombatant({ hidden: true })] });
    expect(redactCombatForViewer(combat, "gm")).toBe(combat);
  });

  it("player with no hidden gets the original reference", () => {
    const combat = makeCombat({ combatants: [makeCombatant()] });
    expect(redactCombatForViewer(combat, "player")).toBe(combat);
  });

  it("player with hidden gets a copy with hidden combatants removed", () => {
    const combat = makeCombat({
      combatants: [
        makeCombatant({ _id: "c1", hidden: false }),
        makeCombatant({ _id: "c2", hidden: true }),
      ],
    });
    const result = redactCombatForViewer(combat, "player");
    expect(result).not.toBe(combat);
    expect(result.combatants.map((c) => c._id)).toEqual(["c1"]);
    // turnIndex is preserved (NOT remapped) per the function contract — it is a
    // pure list-rendering redaction. The client never indexes a player's
    // (redacted) combatants array by turnIndex; it resolves the active combatant
    // by combat.activeCombatantId instead (see combatTracker buildTrackerRows).
    expect(result.turnIndex).toBe(combat.turnIndex);
  });

  it("does not mutate the original combat for a player", () => {
    const combat = makeCombat({
      combatants: [makeCombatant({ _id: "c1" }), makeCombatant({ _id: "c2", hidden: true })],
    });
    redactCombatForViewer(combat, "player");
    expect(combat.combatants).toHaveLength(2);
  });
});

describe("canUseGmControls", () => {
  it("true for gm", () => {
    expect(canUseGmControls("gm")).toBe(true);
  });
  it("false for player", () => {
    expect(canUseGmControls("player")).toBe(false);
  });
});

describe("canTarget", () => {
  it("both roles may target in MVP", () => {
    expect(canTarget("gm")).toBe(true);
    expect(canTarget("player")).toBe(true);
  });
});
