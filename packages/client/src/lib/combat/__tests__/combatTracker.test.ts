/**
 * combatTracker.test.ts — unit tests for the pure combat tracker logic.
 *
 * Tests cover: buildTrackerRows, formatInitiative, controlsState,
 * canPlayerRollInitiative, resolveCombatantTokenId.
 */

import { describe, it, expect } from "vitest";
import {
  buildTrackerRows,
  formatInitiative,
  controlsState,
  canPlayerRollInitiative,
  resolveCombatantTokenId,
  resolveTrackedResource,
  addableTokens,
  resolveActiveCombat,
  extractConflictingCombatId,
} from "../combatTracker.js";
import type { CombatDocument, CombatantDocument, TokenDocument } from "@fusion/shared";
import { defaultTokenDocument } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// formatInitiative
// ---------------------------------------------------------------------------

describe("formatInitiative", () => {
  it("returns '–' for null", () => {
    expect(formatInitiative(null)).toBe("–");
  });

  it("returns integer string for integer value", () => {
    expect(formatInitiative(18)).toBe("18");
    expect(formatInitiative(0)).toBe("0");
    expect(formatInitiative(-3)).toBe("-3");
  });

  it("returns one decimal for float", () => {
    expect(formatInitiative(18.5)).toBe("18.5");
    expect(formatInitiative(7.25)).toBe("7.3");
  });
});

// ---------------------------------------------------------------------------
// buildTrackerRows
// ---------------------------------------------------------------------------

describe("buildTrackerRows", () => {
  it("returns empty array when no combatants", () => {
    const combat = makeCombat();
    expect(buildTrackerRows(combat)).toHaveLength(0);
  });

  it("returns one row per combatant", () => {
    const c1 = makeCombatant({ _id: "c1", name: "Fighter", initiative: 18 });
    const c2 = makeCombatant({ _id: "c2", name: "Rogue", initiative: 14 });
    const combat = makeCombat({ combatants: [c1, c2] });
    const rows = buildTrackerRows(combat);
    expect(rows).toHaveLength(2);
  });

  it("sorts combatants by initiative descending", () => {
    const c1 = makeCombatant({ _id: "c1", name: "Fighter", initiative: 14 });
    const c2 = makeCombatant({ _id: "c2", name: "Rogue", initiative: 18 });
    const combat = makeCombat({ combatants: [c1, c2] });
    const rows = buildTrackerRows(combat);
    expect(rows[0]!.name).toBe("Rogue");
    expect(rows[1]!.name).toBe("Fighter");
  });

  it("puts null-initiative combatants at the end", () => {
    const c1 = makeCombatant({ _id: "c1", name: "Fighter", initiative: 14 });
    const c2 = makeCombatant({ _id: "c2", name: "Wizard", initiative: null });
    const combat = makeCombat({ combatants: [c2, c1] });
    const rows = buildTrackerRows(combat);
    expect(rows[0]!.name).toBe("Fighter");
    expect(rows[1]!.name).toBe("Wizard");
  });

  it("marks isActive on the active combatant (by activeCombatantId) when started", () => {
    const c1 = makeCombatant({ _id: "c1", name: "Fighter", initiative: 18 });
    const c2 = makeCombatant({ _id: "c2", name: "Rogue", initiative: 14 });
    const combat = makeCombat({
      combatants: [c1, c2],
      started: true,
      turnIndex: 0,
      activeCombatantId: "c1",
    });
    const rows = buildTrackerRows(combat);
    expect(rows[0]!.isActive).toBe(true);
    expect(rows[1]!.isActive).toBe(false);
  });

  it("highlight follows activeCombatantId, NOT turnIndex (redaction-safe)", () => {
    // Player view: hidden combatant already stripped by the server. The GM's
    // turnIndex (1, pointing at the PC in the full list) would index into the
    // player's 2-element redacted list and highlight the WRONG row. The fix
    // resolves the active row by activeCombatantId instead.
    const pc = makeCombatant({ _id: "pc", name: "PC", initiative: 15 });
    const npc = makeCombatant({ _id: "npc", name: "Visible NPC", initiative: 10 });
    // GM full order was [HiddenNPC(20), PC(15), VisibleNPC(10)], turnIndex=1 (PC).
    // Player receives only [PC, VisibleNPC] with activeCombatantId="pc".
    const combat = makeCombat({
      combatants: [pc, npc],
      started: true,
      turnIndex: 1,
      activeCombatantId: "pc",
    });
    const rows = buildTrackerRows(combat);
    const activeRow = rows.find((r) => r.isActive);
    expect(activeRow?.id).toBe("pc");
    // The row at positional turnIndex=1 (Visible NPC) must NOT be highlighted.
    expect(rows[1]!.isActive).toBe(false);
  });

  it("no row is active when activeCombatantId is null (hidden active masked for player)", () => {
    const pc = makeCombatant({ _id: "pc", name: "PC", initiative: 15 });
    const npc = makeCombatant({ _id: "npc", name: "Visible NPC", initiative: 10 });
    // The active combatant is a hidden NPC the player cannot see; the server
    // masked activeCombatantId to null. No visible row should be highlighted.
    const combat = makeCombat({
      combatants: [pc, npc],
      started: true,
      turnIndex: 0,
      activeCombatantId: null,
    });
    const rows = buildTrackerRows(combat);
    expect(rows.some((r) => r.isActive)).toBe(false);
  });

  it("isActive is false for all when not started", () => {
    const c1 = makeCombatant({ _id: "c1", initiative: 18 });
    const combat = makeCombat({ combatants: [c1], started: false });
    const rows = buildTrackerRows(combat);
    expect(rows[0]!.isActive).toBe(false);
  });

  it("maps isDefeated correctly", () => {
    const c1 = makeCombatant({ _id: "c1", defeated: true });
    const combat = makeCombat({ combatants: [c1] });
    const rows = buildTrackerRows(combat);
    expect(rows[0]!.isDefeated).toBe(true);
  });

  it("maps isHidden correctly", () => {
    const c1 = makeCombatant({ _id: "c1", hidden: true });
    const combat = makeCombat({ combatants: [c1] });
    const rows = buildTrackerRows(combat);
    expect(rows[0]!.isHidden).toBe(true);
  });

  it("formats initiative as '–' for null", () => {
    const c1 = makeCombatant({ _id: "c1", initiative: null });
    const combat = makeCombat({ combatants: [c1] });
    const rows = buildTrackerRows(combat);
    expect(rows[0]!.initiativeLabel).toBe("–");
  });

  it("formats initiative as string for number", () => {
    const c1 = makeCombatant({ _id: "c1", initiative: 15 });
    const combat = makeCombat({ combatants: [c1] });
    const rows = buildTrackerRows(combat);
    expect(rows[0]!.initiativeLabel).toBe("15");
  });

  it("assigns sequential turnIndex values", () => {
    const c1 = makeCombatant({ _id: "c1", initiative: 18 });
    const c2 = makeCombatant({ _id: "c2", initiative: 14 });
    const c3 = makeCombatant({ _id: "c3", initiative: 10 });
    const combat = makeCombat({ combatants: [c3, c1, c2] });
    const rows = buildTrackerRows(combat);
    expect(rows.map((r) => r.turnIndex)).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// controlsState
// ---------------------------------------------------------------------------

describe("controlsState", () => {
  it("canStart is true when not started and has combatants", () => {
    const c1 = makeCombatant();
    const combat = makeCombat({ combatants: [c1], started: false });
    const state = controlsState(combat);
    expect(state.canStart).toBe(true);
  });

  it("canStart is false when already started", () => {
    const c1 = makeCombatant();
    const combat = makeCombat({ combatants: [c1], started: true });
    const state = controlsState(combat);
    expect(state.canStart).toBe(false);
  });

  it("canStart is false with no combatants", () => {
    const combat = makeCombat({ started: false });
    const state = controlsState(combat);
    expect(state.canStart).toBe(false);
  });

  it("canNext and canPrevious are true when started", () => {
    const c1 = makeCombatant();
    const combat = makeCombat({ combatants: [c1], started: true });
    const state = controlsState(combat);
    expect(state.canNext).toBe(true);
    expect(state.canPrevious).toBe(true);
  });

  it("canNext and canPrevious are false when not started", () => {
    const c1 = makeCombatant();
    const combat = makeCombat({ combatants: [c1], started: false });
    const state = controlsState(combat);
    expect(state.canNext).toBe(false);
    expect(state.canPrevious).toBe(false);
  });

  it("canEnd is false when already ended", () => {
    const combat = makeCombat({ ended: true });
    const state = controlsState(combat);
    expect(state.canEnd).toBe(false);
  });

  it("canRollAll is true with combatants and not ended", () => {
    const c1 = makeCombatant();
    const combat = makeCombat({ combatants: [c1] });
    const state = controlsState(combat);
    expect(state.canRollAll).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canPlayerRollInitiative
// ---------------------------------------------------------------------------

describe("canPlayerRollInitiative", () => {
  it("GM can always roll", () => {
    const c = makeCombatant({ actorId: "a1", initiative: 5 });
    const combat = makeCombat({ combatants: [c] });
    const result = canPlayerRollInitiative(c, combat, "u1", new Set(), true);
    expect(result).toBe(true);
  });

  it("player can roll own combatant when initiative is null", () => {
    const c = makeCombatant({ actorId: "a1", initiative: null });
    const combat = makeCombat({ combatants: [c] });
    const result = canPlayerRollInitiative(c, combat, "u1", new Set(["a1"]), false);
    expect(result).toBe(true);
  });

  it("player cannot roll when initiative already set", () => {
    const c = makeCombatant({ actorId: "a1", initiative: 14 });
    const combat = makeCombat({ combatants: [c] });
    const result = canPlayerRollInitiative(c, combat, "u1", new Set(["a1"]), false);
    expect(result).toBe(false);
  });

  it("player cannot roll other player's combatant", () => {
    const c = makeCombatant({ actorId: "a2", initiative: null });
    const combat = makeCombat({ combatants: [c] });
    const result = canPlayerRollInitiative(c, combat, "u1", new Set(["a1"]), false);
    expect(result).toBe(false);
  });

  it("nobody can roll when combat is ended", () => {
    const c = makeCombatant({ actorId: "a1", initiative: null });
    const combat = makeCombat({ combatants: [c], ended: true });
    const result = canPlayerRollInitiative(c, combat, "u1", new Set(["a1"]), false);
    expect(result).toBe(false);
  });

  it("returns false when combatant has no actorId", () => {
    const c = makeCombatant({ actorId: null, initiative: null });
    const combat = makeCombat({ combatants: [c] });
    const result = canPlayerRollInitiative(c, combat, "u1", new Set(["a1"]), false);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveCombatantTokenId
// ---------------------------------------------------------------------------

describe("resolveCombatantTokenId", () => {
  it("returns null when combat is not started", () => {
    const c = makeCombatant({ tokenId: "t1", initiative: 18 });
    const combat = makeCombat({ combatants: [c], started: false });
    expect(resolveCombatantTokenId(combat)).toBeNull();
  });

  it("returns null when combat is ended", () => {
    const c = makeCombatant({ tokenId: "t1", initiative: 18 });
    const combat = makeCombat({ combatants: [c], started: true, ended: true });
    expect(resolveCombatantTokenId(combat)).toBeNull();
  });

  it("returns tokenId of the active combatant (by activeCombatantId)", () => {
    const c1 = makeCombatant({ _id: "c1", tokenId: "t1", initiative: 18 });
    const c2 = makeCombatant({ _id: "c2", tokenId: "t2", initiative: 14 });
    const combat = makeCombat({
      combatants: [c2, c1],
      started: true,
      turnIndex: 0,
      activeCombatantId: "c1",
    });
    expect(resolveCombatantTokenId(combat)).toBe("t1");
  });

  it("resolves by activeCombatantId, NOT positional turnIndex (redaction-safe)", () => {
    // Player view after hidden NPC stripped: turnIndex=1 (GM-absolute) would
    // resolve t2; the active combatant is actually the PC (t1). The fix resolves
    // by activeCombatantId, placing the turn marker on the correct token.
    const pc = makeCombatant({ _id: "pc", tokenId: "t1", initiative: 15 });
    const npc = makeCombatant({ _id: "npc", tokenId: "t2", initiative: 10 });
    const combat = makeCombat({
      combatants: [pc, npc],
      started: true,
      turnIndex: 1,
      activeCombatantId: "pc",
    });
    expect(resolveCombatantTokenId(combat)).toBe("t1");
  });

  it("returns null when activeCombatantId is null (hidden active masked for player)", () => {
    const pc = makeCombatant({ _id: "pc", tokenId: "t1", initiative: 15 });
    const combat = makeCombat({
      combatants: [pc],
      started: true,
      turnIndex: 0,
      activeCombatantId: null,
    });
    expect(resolveCombatantTokenId(combat)).toBeNull();
  });

  it("returns null when active combatant has no tokenId", () => {
    const c = makeCombatant({ _id: "c1", tokenId: null, initiative: 18 });
    const combat = makeCombat({
      combatants: [c],
      started: true,
      turnIndex: 0,
      activeCombatantId: "c1",
    });
    expect(resolveCombatantTokenId(combat)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveTrackedResource (REQ-CBT-047)
// ---------------------------------------------------------------------------

describe("resolveTrackedResource", () => {
  it("returns null when combat has no trackedResource configured", () => {
    const c = makeCombatant({
      flags: { combat: { trackedResource: { value: 10, max: 20, label: "HP" } } },
    });
    const combat = makeCombat({ trackedResource: null, combatants: [c] });
    expect(resolveTrackedResource(combat, c)).toBeNull();
  });

  it("returns null when the combatant has no cached resource snapshot", () => {
    const c = makeCombatant({ flags: {} });
    const combat = makeCombat({ trackedResource: "attributes.hp", combatants: [c] });
    expect(resolveTrackedResource(combat, c)).toBeNull();
  });

  it("returns the cached snapshot when present and valid", () => {
    const c = makeCombatant({
      flags: { combat: { trackedResource: { value: 12, max: 24, label: "HP" } } },
    });
    const combat = makeCombat({ trackedResource: "attributes.hp", combatants: [c] });
    expect(resolveTrackedResource(combat, c)).toEqual({ value: 12, max: 24, label: "HP" });
  });

  it("falls back to the combat trackedResource key when label is missing", () => {
    const c = makeCombatant({
      flags: { combat: { trackedResource: { value: 5, max: 5 } } },
    });
    const combat = makeCombat({ trackedResource: "attributes.hp", combatants: [c] });
    expect(resolveTrackedResource(combat, c)).toEqual({
      value: 5,
      max: 5,
      label: "attributes.hp",
    });
  });

  it("returns null for malformed cached value (non-numeric)", () => {
    const c = makeCombatant({
      flags: { combat: { trackedResource: { value: "ten", max: 20, label: "HP" } } },
    });
    const combat = makeCombat({ trackedResource: "attributes.hp", combatants: [c] });
    expect(resolveTrackedResource(combat, c)).toBeNull();
  });

  it("populates trackedResource on tracker rows", () => {
    const c = makeCombatant({
      _id: "c1",
      initiative: 10,
      flags: { combat: { trackedResource: { value: 8, max: 16, label: "HP" } } },
    });
    const combat = makeCombat({ trackedResource: "attributes.hp", combatants: [c] });
    const rows = buildTrackerRows(combat);
    expect(rows[0]!.trackedResource).toEqual({ value: 8, max: 16, label: "HP" });
  });

  it("leaves trackedResource null on rows when not configured", () => {
    const c = makeCombatant({ _id: "c1", initiative: 10 });
    const combat = makeCombat({ combatants: [c] });
    const rows = buildTrackerRows(combat);
    expect(rows[0]!.trackedResource).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addableTokens (BUG D FIX)
// ---------------------------------------------------------------------------

function makeToken(overrides: Partial<TokenDocument> = {}): TokenDocument {
  return { ...defaultTokenDocument("tokenAAAAAAAAAAA", "actorAAAAAAAAAAA"), ...overrides };
}

describe("addableTokens", () => {
  it("returns all scene tokens when there is no combat yet", () => {
    const tokens = [
      makeToken({ _id: "tok1AAAAAAAAAAAA", name: "Goblin" }),
      makeToken({ _id: "tok2AAAAAAAAAAAA", name: "Orc" }),
    ];
    const result = addableTokens(tokens, null);
    expect(result.map((t) => t.id)).toEqual(["tok1AAAAAAAAAAAA", "tok2AAAAAAAAAAAA"]);
  });

  it("excludes tokens already present as combatants", () => {
    const tokens = [
      makeToken({ _id: "tok1AAAAAAAAAAAA", name: "Goblin" }),
      makeToken({ _id: "tok2AAAAAAAAAAAA", name: "Orc" }),
    ];
    const combat = makeCombat({
      combatants: [makeCombatant({ _id: "c1", tokenId: "tok1AAAAAAAAAAAA" })],
    });
    const result = addableTokens(tokens, combat);
    expect(result.map((t) => t.id)).toEqual(["tok2AAAAAAAAAAAA"]);
  });

  it("returns an empty array when every token is already a combatant", () => {
    const tokens = [makeToken({ _id: "tok1AAAAAAAAAAAA", name: "Goblin" })];
    const combat = makeCombat({
      combatants: [makeCombatant({ _id: "c1", tokenId: "tok1AAAAAAAAAAAA" })],
    });
    expect(addableTokens(tokens, combat)).toEqual([]);
  });

  it("falls back to a generic name when the token has an empty name", () => {
    const tokens = [makeToken({ _id: "tok1AAAAAAAAAAAA", name: "" })];
    const result = addableTokens(tokens, null);
    expect(result[0]!.name).toBe("Token");
  });

  it("carries actorId through for the add-combatant call; img is null (REQ-TOK-010/012)", () => {
    // The token no longer carries a `texture` of its own — art now lives on
    // the effective actor (TokenSprite resolves it via the mirror), which
    // this pure filter has no access to.
    const tokens = [
      makeToken({
        _id: "tok1AAAAAAAAAAAA",
        name: "Goblin",
        actorId: "actorAAAAAAAAAAA",
      }),
    ];
    const result = addableTokens(tokens, null);
    expect(result[0]).toEqual({
      id: "tok1AAAAAAAAAAAA",
      name: "Goblin",
      img: null,
      actorId: "actorAAAAAAAAAAA",
    });
  });

  it("ignores combatants with a null tokenId (does not exclude everything)", () => {
    const tokens = [makeToken({ _id: "tok1AAAAAAAAAAAA", name: "Goblin" })];
    const combat = makeCombat({
      combatants: [makeCombatant({ _id: "c1", tokenId: null })],
    });
    expect(addableTokens(tokens, combat).map((t) => t.id)).toEqual(["tok1AAAAAAAAAAAA"]);
  });
});

describe("resolveActiveCombat (GRUPO 4 — combat panel deadlock regression)", () => {
  it("picks the Combat belonging to the active scene, ignoring a non-ended orphan from another scene", () => {
    // Reproduces the real-world "argiburgo" DB shape: multiple Combat rows,
    // including a stale non-ended orphan that belongs to a different scene
    // than the one currently active.
    const orphanFromOtherScene = makeCombat({
      _id: "orphan1AAAAAAAAA",
      sceneId: "scene-other",
      started: true,
      ended: false,
    });
    const activeSceneCombat = makeCombat({
      _id: "combatActiveScene",
      sceneId: "scene-active",
      started: false,
      ended: false,
    });

    const result = resolveActiveCombat([orphanFromOtherScene, activeSceneCombat], "scene-active");

    expect(result?._id).toBe("combatActiveScene");
  });

  it("returns null when no Combat exists for the active scene, even if other scenes have non-ended combats", () => {
    const orphanFromOtherScene = makeCombat({
      _id: "orphan1AAAAAAAAA",
      sceneId: "scene-other",
      started: true,
      ended: false,
    });

    expect(resolveActiveCombat([orphanFromOtherScene], "scene-active")).toBeNull();
  });

  it("prefers the started, non-ended combat for the active scene over a not-yet-started one", () => {
    const notStarted = makeCombat({
      _id: "combatNotStarted",
      sceneId: "scene-active",
      started: false,
      ended: false,
    });
    const started = makeCombat({
      _id: "combatStartedAAAA",
      sceneId: "scene-active",
      started: true,
      ended: false,
    });

    expect(resolveActiveCombat([notStarted, started], "scene-active")?._id).toBe(
      "combatStartedAAAA",
    );
  });

  it("ignores ended combats for the active scene", () => {
    const ended = makeCombat({
      _id: "combatEndedAAAAAA",
      sceneId: "scene-active",
      started: true,
      ended: true,
    });

    expect(resolveActiveCombat([ended], "scene-active")).toBeNull();
  });

  it("returns null when activeSceneId is null (no scene active)", () => {
    const combat = makeCombat({ sceneId: "scene-active", started: true, ended: false });
    expect(resolveActiveCombat([combat], null)).toBeNull();
  });
});

describe("extractConflictingCombatId (GRUPO 4 — DEC-CBT-06 self-heal)", () => {
  it("extracts the combatId from a DEC-CBT-06 rejection message", () => {
    const message =
      "A combat encounter already exists for scene U66mcIDJWWxuesHb (combatId=lDCeVTIzaDeQYk0W). End it before creating another (DEC-CBT-06).";
    expect(extractConflictingCombatId(message)).toBe("lDCeVTIzaDeQYk0W");
  });

  it("returns null for a message without a combatId (different VALIDATION_FAILED cause)", () => {
    expect(extractConflictingCombatId("Some other validation error")).toBeNull();
  });

  it("returns null for an empty string without throwing", () => {
    expect(extractConflictingCombatId("")).toBeNull();
  });
});
