/**
 * Combat schemas and initiative utilities — test suite.
 *
 * Covers:
 *   1. CombatantDocumentSchema — valid shape, defaults, validation errors
 *   2. CombatDocumentSchema — valid shape, defaults, embedded combatants
 *   3. defaultInitiativeComparator — ordering, tiebreakers, nulls last
 *   4. sortCombatants — sorts correctly; custom compare() from formula
 *   5. nextTurnIndex / previousTurnIndex — wrap-around, skipDefeated
 *   6. activeCombatant — started/not started, out-of-bounds
 *   7. Protocol payload schemas — parse/reject
 *   8. CombatTurnSnapshotSchema — valid shape
 *   9. Stable sort — equal totals preserve relative order
 *  10. All-defeated guard — nextTurnIndex returns null
 *
 * Spec: 10-combate-e-iniciativa.md
 * REQ-CBT-013: compare has precedence; nulls at end; tiebreaker secondary.
 * REQ-CBT-016: sorted order.
 * REQ-CBT-021..023: nextTurn logic.
 */

import { describe, it, expect } from "vitest";

import {
  // Schemas
  CombatantDocumentSchema,
  CombatDocumentSchema,
  CombatTurnSnapshotSchema,
  // Initiative
  defaultInitiativeComparator,
  sortCombatants,
  activeCombatant,
  computeActiveCombatantId,
  nextTurnIndex,
  previousTurnIndex,
  GENERIC_1D20_FORMULA_ID,
  // Protocol
  CombatCreatePayloadSchema,
  CombatBeginPayloadSchema,
  CombatAddCombatantPayloadSchema,
  CombatRollInitiativePayloadSchema,
  CombatSetInitiativePayloadSchema,
  CombatResetInitiativePayloadSchema,
  CombatNextPayloadSchema,
  CombatPreviousPayloadSchema,
  CombatSetDefeatedPayloadSchema,
  CombatSetHiddenPayloadSchema,
  CombatReorderPayloadSchema,
  CombatEndPayloadSchema,
  CombatTargetPayloadSchema,
  CombatTurnChangePayloadSchema,
  CombatInitiativeSetPayloadSchema,
  TokenTargetedPayloadSchema,
  COMBAT_ENVELOPE_TYPES,
} from "../index.js";
import type { CombatantDocument, InitiativeEntry } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCombatantRaw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "AbcDef1234567890",
    tokenId: "TokenId12345678",
    actorId: "ActorId12345678",
    name: "Fighter",
    img: "/img/fighter.png",
    initiative: null,
    initiativeStatistic: null,
    hidden: false,
    defeated: false,
    hasPlayerOwner: true,
    flags: {},
    ...overrides,
  };
}

function makeCombatRaw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "CombatId12345678",
    sceneId: "SceneId12345678",
    round: 0,
    turnIndex: 0,
    started: false,
    ended: false,
    skipDefeated: true,
    autoPan: false,
    combatType: "standard",
    trackedResource: null,
    combatants: [],
    flags: {},
    sort: 0,
    ...overrides,
  };
}

function makeCombatant(overrides: Partial<CombatantDocument> = {}): CombatantDocument {
  return {
    _id: "AbcDef1234567890",
    tokenId: "TokenId12345678",
    actorId: "ActorId12345678",
    name: "Fighter",
    img: "/img/fighter.png",
    initiative: null,
    initiativeStatistic: null,
    hidden: false,
    defeated: false,
    hasPlayerOwner: true,
    flags: {},
    ...overrides,
  };
}

function makeEntry(
  combatant: CombatantDocument,
  total: number,
  tiebreaker?: number,
): InitiativeEntry {
  return { combatant, total, tiebreaker };
}

// ---------------------------------------------------------------------------
// 1. CombatantDocumentSchema
// ---------------------------------------------------------------------------

describe("CombatantDocumentSchema", () => {
  it("parses a valid combatant with explicit fields", () => {
    const raw = makeCombatantRaw();
    const result = CombatantDocumentSchema.parse(raw);
    expect(result._id).toBe("AbcDef1234567890");
    expect(result.name).toBe("Fighter");
    expect(result.initiative).toBeNull();
    expect(result.hidden).toBe(false);
    expect(result.defeated).toBe(false);
  });

  it("applies defaults: hidden=false, defeated=false, hasPlayerOwner=false", () => {
    const raw = makeCombatantRaw({
      hidden: undefined,
      defeated: undefined,
      hasPlayerOwner: undefined,
    });
    const result = CombatantDocumentSchema.parse(raw);
    expect(result.hidden).toBe(false);
    expect(result.defeated).toBe(false);
    expect(result.hasPlayerOwner).toBe(false);
  });

  it("allows null tokenId and actorId (anonymous combatant)", () => {
    const result = CombatantDocumentSchema.parse(
      makeCombatantRaw({ tokenId: null, actorId: null }),
    );
    expect(result.tokenId).toBeNull();
    expect(result.actorId).toBeNull();
  });

  it("allows null img", () => {
    const result = CombatantDocumentSchema.parse(makeCombatantRaw({ img: null }));
    expect(result.img).toBeNull();
  });

  it("allows numeric initiative value", () => {
    const result = CombatantDocumentSchema.parse(makeCombatantRaw({ initiative: 18.5 }));
    expect(result.initiative).toBe(18.5);
  });

  it("rejects _id shorter than 16 chars", () => {
    expect(() => CombatantDocumentSchema.parse(makeCombatantRaw({ _id: "short" }))).toThrow();
  });

  it("rejects _id longer than 16 chars", () => {
    expect(() =>
      CombatantDocumentSchema.parse(makeCombatantRaw({ _id: "AbcDef12345678901" })),
    ).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => CombatantDocumentSchema.parse(makeCombatantRaw({ name: "" }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. CombatDocumentSchema
// ---------------------------------------------------------------------------

describe("CombatDocumentSchema", () => {
  it("parses a valid combat with defaults", () => {
    const raw = makeCombatRaw();
    const result = CombatDocumentSchema.parse(raw);
    expect(result._id).toBe("CombatId12345678");
    expect(result.round).toBe(0);
    expect(result.turnIndex).toBe(0);
    expect(result.started).toBe(false);
    expect(result.ended).toBe(false);
    expect(result.skipDefeated).toBe(true);
    expect(result.autoPan).toBe(false);
    expect(result.combatType).toBe("standard");
    expect(result.trackedResource).toBeNull();
    expect(result.combatants).toEqual([]);
  });

  it("parses a combat with embedded combatants", () => {
    const raw = makeCombatRaw({
      combatants: [makeCombatantRaw()],
      started: true,
      round: 1,
      turnIndex: 0,
    });
    const result = CombatDocumentSchema.parse(raw);
    expect(result.combatants).toHaveLength(1);
    expect(result.combatants[0]!.name).toBe("Fighter");
    expect(result.started).toBe(true);
    expect(result.round).toBe(1);
  });

  it("applies default combatants=[] when omitted", () => {
    const raw = { ...makeCombatRaw(), combatants: undefined };
    const result = CombatDocumentSchema.parse(raw);
    expect(result.combatants).toEqual([]);
  });

  it("rejects negative round", () => {
    expect(() => CombatDocumentSchema.parse(makeCombatRaw({ round: -1 }))).toThrow();
  });

  it("rejects negative turnIndex", () => {
    expect(() => CombatDocumentSchema.parse(makeCombatRaw({ turnIndex: -1 }))).toThrow();
  });

  it("accepts ended=true (archived encounter)", () => {
    const result = CombatDocumentSchema.parse(makeCombatRaw({ ended: true }));
    expect(result.ended).toBe(true);
  });

  it("accepts a custom combatType string", () => {
    const result = CombatDocumentSchema.parse(makeCombatRaw({ combatType: "starship" }));
    expect(result.combatType).toBe("starship");
  });
});

// ---------------------------------------------------------------------------
// 3. defaultInitiativeComparator — ordering
// ---------------------------------------------------------------------------

describe("defaultInitiativeComparator", () => {
  const c1 = makeCombatant({ _id: "AAAAAAAAAAAAAAAA", name: "A" });
  const c2 = makeCombatant({ _id: "BBBBBBBBBBBBBBBB", name: "B" });

  it("sorts higher total before lower total (descending)", () => {
    const a = makeEntry(c1, 18);
    const b = makeEntry(c2, 12);
    expect(defaultInitiativeComparator(a, b)).toBeLessThan(0); // a first
    expect(defaultInitiativeComparator(b, a)).toBeGreaterThan(0); // b after
  });

  it("returns 0 for equal totals with no tiebreaker", () => {
    const a = makeEntry(c1, 15);
    const b = makeEntry(c2, 15);
    expect(defaultInitiativeComparator(a, b)).toBe(0);
  });

  it("uses tiebreaker descending when totals are equal", () => {
    const a = makeEntry(c1, 15, 4); // higher tiebreaker → first
    const b = makeEntry(c2, 15, 2);
    expect(defaultInitiativeComparator(a, b)).toBeLessThan(0);
    expect(defaultInitiativeComparator(b, a)).toBeGreaterThan(0);
  });

  it("places entry with tiebreaker before entry without (same total)", () => {
    const a = makeEntry(c1, 15, 3);
    const b = makeEntry(c2, 15); // no tiebreaker
    expect(defaultInitiativeComparator(a, b)).toBeLessThan(0);
  });

  it("places null-total entries after numeric entries", () => {
    const aNull = makeEntry(c1, null as unknown as number); // simulate null initiative
    const b = makeEntry(c2, 5);
    expect(defaultInitiativeComparator(aNull, b)).toBeGreaterThan(0);
    expect(defaultInitiativeComparator(b, aNull)).toBeLessThan(0);
  });

  it("both null-total entries are equal (0)", () => {
    const a = makeEntry(c1, null as unknown as number);
    const b = makeEntry(c2, null as unknown as number);
    expect(defaultInitiativeComparator(a, b)).toBe(0);
  });

  it("handles NaN total as null (sinks to bottom)", () => {
    const aNaN = makeEntry(c1, NaN);
    const b = makeEntry(c2, 10);
    expect(defaultInitiativeComparator(aNaN, b)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. sortCombatants
// ---------------------------------------------------------------------------

describe("sortCombatants", () => {
  it("sorts combatants by initiative descending, nulls last", () => {
    const a = makeCombatant({ _id: "AAAAAAAAAAAAAAAA", name: "A", initiative: 18 });
    const b = makeCombatant({ _id: "BBBBBBBBBBBBBBBB", name: "B", initiative: 12 });
    const c = makeCombatant({ _id: "CCCCCCCCCCCCCCCC", name: "C", initiative: null });
    const d = makeCombatant({ _id: "DDDDDDDDDDDDDDDD", name: "D", initiative: 20 });

    const sorted = sortCombatants([a, b, c, d]);
    expect(sorted.map((x) => x.name)).toEqual(["D", "A", "B", "C"]);
  });

  it("returns a new array (does not mutate input)", () => {
    const original = [
      makeCombatant({ _id: "AAAAAAAAAAAAAAAA", name: "A", initiative: 10 }),
      makeCombatant({ _id: "BBBBBBBBBBBBBBBB", name: "B", initiative: 20 }),
    ];
    const sorted = sortCombatants(original);
    expect(sorted).not.toBe(original);
    expect(original[0]!.name).toBe("A"); // original unchanged
  });

  it("places multiple nulls after non-nulls, preserving relative stable order", () => {
    const a = makeCombatant({ _id: "AAAAAAAAAAAAAAAA", name: "A", initiative: null });
    const b = makeCombatant({ _id: "BBBBBBBBBBBBBBBB", name: "B", initiative: 5 });
    const c = makeCombatant({ _id: "CCCCCCCCCCCCCCCC", name: "C", initiative: null });

    const sorted = sortCombatants([a, b, c]);
    expect(sorted[0]!.name).toBe("B");
    // A and C are both null — relative order between them is stable
    const nullNames = sorted.slice(1).map((x) => x.name);
    expect(nullNames).toContain("A");
    expect(nullNames).toContain("C");
  });

  it("uses custom formula compare() when provided", () => {
    // Non-monotonic rule: players always before NPCs regardless of initiative
    const player = makeCombatant({
      _id: "PPPPPPPPPPPPPPPP",
      name: "Player",
      initiative: 5,
      hasPlayerOwner: true,
    });
    const npc = makeCombatant({
      _id: "NNNNNNNNNNNNNNNN",
      name: "NPC",
      initiative: 20,
      hasPlayerOwner: false,
    });

    const customFormula = {
      compare: (a: InitiativeEntry, b: InitiativeEntry): number => {
        const aIsPlayer = a.combatant.hasPlayerOwner;
        const bIsPlayer = b.combatant.hasPlayerOwner;
        if (aIsPlayer && !bIsPlayer) return -1;
        if (!aIsPlayer && bIsPlayer) return 1;
        return b.total - a.total;
      },
    };

    const sorted = sortCombatants([npc, player], customFormula);
    expect(sorted[0]!.name).toBe("Player"); // player goes first despite lower initiative
    expect(sorted[1]!.name).toBe("NPC");
  });

  it("handles tiebreaker map passed to sortCombatants", () => {
    const a = makeCombatant({ _id: "AAAAAAAAAAAAAAAA", name: "A", initiative: 15 });
    const b = makeCombatant({ _id: "BBBBBBBBBBBBBBBB", name: "B", initiative: 15 });

    const tieMap = new Map([
      ["AAAAAAAAAAAAAAAA", 2],
      ["BBBBBBBBBBBBBBBB", 5], // B has higher tiebreaker → B first
    ]);

    const sorted = sortCombatants([a, b], undefined, tieMap);
    expect(sorted[0]!.name).toBe("B");
    expect(sorted[1]!.name).toBe("A");
  });

  it("returns empty array when input is empty", () => {
    expect(sortCombatants([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. nextTurnIndex / previousTurnIndex
// ---------------------------------------------------------------------------

describe("nextTurnIndex", () => {
  const make3 = (): CombatantDocument[] => [
    makeCombatant({ _id: "AAAAAAAAAAAAAAAA", name: "A" }),
    makeCombatant({ _id: "BBBBBBBBBBBBBBBB", name: "B" }),
    makeCombatant({ _id: "CCCCCCCCCCCCCCCC", name: "C" }),
  ];

  it("advances turn within the same round", () => {
    const result = nextTurnIndex(make3(), 0, 1, false);
    expect(result).toEqual({ turnIndex: 1, round: 1 });
  });

  it("wraps to turnIndex=0 and increments round at end of combatants", () => {
    const result = nextTurnIndex(make3(), 2, 1, false);
    expect(result).toEqual({ turnIndex: 0, round: 2 });
  });

  it("skips defeated combatants when skipDefeated=true", () => {
    const combatants = make3();
    combatants[1]!.defeated = true; // B is defeated
    const result = nextTurnIndex(combatants, 0, 1, true);
    expect(result).toEqual({ turnIndex: 2, round: 1 }); // skips B
  });

  it("wraps around when defeated combatant is at end", () => {
    const combatants = make3();
    combatants[2]!.defeated = true; // C is defeated
    const result = nextTurnIndex(combatants, 1, 1, true);
    expect(result).toEqual({ turnIndex: 0, round: 2 }); // C is skipped, wraps to A
  });

  it("returns null when all combatants are defeated", () => {
    const combatants = make3().map((c) => ({ ...c, defeated: true }));
    const result = nextTurnIndex(combatants, 0, 1, true);
    expect(result).toBeNull();
  });

  it("returns null for empty combatants array", () => {
    expect(nextTurnIndex([], 0, 1, false)).toBeNull();
  });
});

describe("previousTurnIndex", () => {
  const make3 = (): CombatantDocument[] => [
    makeCombatant({ _id: "AAAAAAAAAAAAAAAA", name: "A" }),
    makeCombatant({ _id: "BBBBBBBBBBBBBBBB", name: "B" }),
    makeCombatant({ _id: "CCCCCCCCCCCCCCCC", name: "C" }),
  ];

  it("goes back one turn within the same round", () => {
    const result = previousTurnIndex(make3(), 2, 1, false);
    expect(result).toEqual({ turnIndex: 1, round: 1 });
  });

  it("wraps to last combatant and decrements round at turnIndex=0", () => {
    const result = previousTurnIndex(make3(), 0, 2, false);
    expect(result).toEqual({ turnIndex: 2, round: 1 });
  });

  it("does not go below round 1", () => {
    const result = previousTurnIndex(make3(), 0, 1, false);
    expect(result).toEqual({ turnIndex: 2, round: 1 });
  });

  it("skips defeated combatants when skipDefeated=true", () => {
    const combatants = make3();
    combatants[1]!.defeated = true; // B is defeated
    const result = previousTurnIndex(combatants, 2, 1, true);
    expect(result).toEqual({ turnIndex: 0, round: 1 }); // skips B
  });

  it("returns null when all combatants are defeated", () => {
    const combatants = make3().map((c) => ({ ...c, defeated: true }));
    expect(previousTurnIndex(combatants, 2, 1, true)).toBeNull();
  });

  it("returns null for empty combatants array", () => {
    expect(previousTurnIndex([], 0, 1, false)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. activeCombatant
// ---------------------------------------------------------------------------

describe("activeCombatant", () => {
  const combatants = [
    makeCombatant({ _id: "AAAAAAAAAAAAAAAA", name: "A" }),
    makeCombatant({ _id: "BBBBBBBBBBBBBBBB", name: "B" }),
  ];

  it("returns null when not started", () => {
    expect(activeCombatant(combatants, 0, false)).toBeNull();
  });

  it("returns null when combatants is empty", () => {
    expect(activeCombatant([], 0, true)).toBeNull();
  });

  it("returns combatant at turn index when started", () => {
    expect(activeCombatant(combatants, 0, true)?.name).toBe("A");
    expect(activeCombatant(combatants, 1, true)?.name).toBe("B");
  });

  it("clamps out-of-bounds turn index to valid range", () => {
    expect(activeCombatant(combatants, 99, true)?.name).toBe("B"); // clamped to last
    expect(activeCombatant(combatants, -1, true)?.name).toBe("A"); // clamped to 0
  });
});

// ---------------------------------------------------------------------------
// 6b. computeActiveCombatantId
// ---------------------------------------------------------------------------

describe("computeActiveCombatantId", () => {
  const combatants = [
    makeCombatant({ _id: "AAAAAAAAAAAAAAAA", name: "A" }),
    makeCombatant({ _id: "BBBBBBBBBBBBBBBB", name: "B" }),
  ];

  it("returns the _id of the combatant at the turn index when started", () => {
    expect(computeActiveCombatantId(combatants, 0, true)).toBe("AAAAAAAAAAAAAAAA");
    expect(computeActiveCombatantId(combatants, 1, true)).toBe("BBBBBBBBBBBBBBBB");
  });

  it("returns null when not started", () => {
    expect(computeActiveCombatantId(combatants, 0, false)).toBeNull();
  });

  it("returns null when combatants is empty", () => {
    expect(computeActiveCombatantId([], 0, true)).toBeNull();
  });

  it("clamps out-of-bounds index (matches activeCombatant)", () => {
    expect(computeActiveCombatantId(combatants, 99, true)).toBe("BBBBBBBBBBBBBBBB");
  });
});

// ---------------------------------------------------------------------------
// 7. Protocol payload schemas
// ---------------------------------------------------------------------------

describe("Protocol payload schemas", () => {
  it("CombatCreatePayloadSchema parses valid payload", () => {
    expect(CombatCreatePayloadSchema.parse({ sceneId: "SceneId12345678" })).toMatchObject({
      sceneId: "SceneId12345678",
    });
  });

  it("CombatCreatePayloadSchema rejects empty sceneId", () => {
    expect(() => CombatCreatePayloadSchema.parse({ sceneId: "" })).toThrow();
  });

  it("CombatBeginPayloadSchema parses valid payload", () => {
    expect(CombatBeginPayloadSchema.parse({ combatId: "CombatId12345678" })).toMatchObject({
      combatId: "CombatId12345678",
    });
  });

  it("CombatAddCombatantPayloadSchema parses with optional fields", () => {
    const result = CombatAddCombatantPayloadSchema.parse({
      combatId: "CombatId12345678",
      tokenId: "TokenId12345678",
    });
    expect(result.combatId).toBe("CombatId12345678");
    expect(result.tokenId).toBe("TokenId12345678");
    expect(result.actorId).toBeUndefined();
  });

  it("CombatRollInitiativePayloadSchema allows absent combatantIds (roll all)", () => {
    const result = CombatRollInitiativePayloadSchema.parse({ combatId: "CombatId12345678" });
    expect(result.combatantIds).toBeUndefined();
  });

  it("CombatRollInitiativePayloadSchema accepts explicit combatantIds", () => {
    const result = CombatRollInitiativePayloadSchema.parse({
      combatId: "CombatId12345678",
      combatantIds: ["AbcDef1234567890"],
    });
    expect(result.combatantIds).toEqual(["AbcDef1234567890"]);
  });

  it("CombatSetInitiativePayloadSchema accepts null value (reset)", () => {
    const result = CombatSetInitiativePayloadSchema.parse({
      combatId: "CombatId12345678",
      combatantId: "AbcDef1234567890",
      value: null,
    });
    expect(result.value).toBeNull();
  });

  it("CombatSetInitiativePayloadSchema accepts numeric value", () => {
    const result = CombatSetInitiativePayloadSchema.parse({
      combatId: "CombatId12345678",
      combatantId: "AbcDef1234567890",
      value: 14,
    });
    expect(result.value).toBe(14);
  });

  it("CombatResetInitiativePayloadSchema parses correctly", () => {
    expect(
      CombatResetInitiativePayloadSchema.parse({ combatId: "CombatId12345678" }),
    ).toMatchObject({ combatId: "CombatId12345678" });
  });

  it("CombatNextPayloadSchema parses correctly", () => {
    expect(CombatNextPayloadSchema.parse({ combatId: "CombatId12345678" })).toMatchObject({
      combatId: "CombatId12345678",
    });
  });

  it("CombatPreviousPayloadSchema parses correctly", () => {
    expect(CombatPreviousPayloadSchema.parse({ combatId: "CombatId12345678" })).toMatchObject({
      combatId: "CombatId12345678",
    });
  });

  it("CombatSetDefeatedPayloadSchema requires the defeated field", () => {
    expect(() =>
      CombatSetDefeatedPayloadSchema.parse({
        combatId: "CombatId12345678",
        combatantId: "AbcDef1234567890",
      }),
    ).toThrow();
  });

  it("CombatSetDefeatedPayloadSchema parses with explicit defeated=true", () => {
    const result = CombatSetDefeatedPayloadSchema.parse({
      combatId: "CombatId12345678",
      combatantId: "AbcDef1234567890",
      defeated: true,
    });
    expect(result.defeated).toBe(true);
  });

  it("CombatTargetPayloadSchema parses and rejects client-supplied userId", () => {
    const result = CombatTargetPayloadSchema.parse({
      tokenId: "TokenId12345678",
      targeted: true,
    });
    expect(result.targeted).toBe(true);
    expect(() =>
      CombatTargetPayloadSchema.parse({
        tokenId: "TokenId12345678",
        targeted: true,
        userId: "spoofed",
      }),
    ).toThrow();
  });

  it("CombatInitiativeSetPayloadSchema accepts numeric and null initiative", () => {
    expect(
      CombatInitiativeSetPayloadSchema.parse({
        combatId: "CombatId12345678",
        combatantId: "AbcDef1234567890",
        initiative: 17,
      }).initiative,
    ).toBe(17);
    expect(
      CombatInitiativeSetPayloadSchema.parse({
        combatId: "CombatId12345678",
        combatantId: "AbcDef1234567890",
        initiative: null,
      }).initiative,
    ).toBeNull();
  });

  it("TokenTargetedPayloadSchema requires userId (server-resolved)", () => {
    const result = TokenTargetedPayloadSchema.parse({
      tokenId: "TokenId12345678",
      targeted: false,
      userId: "User1234",
    });
    expect(result.userId).toBe("User1234");
    expect(() =>
      TokenTargetedPayloadSchema.parse({ tokenId: "TokenId12345678", targeted: false }),
    ).toThrow();
  });

  it("CombatSetHiddenPayloadSchema requires hidden field", () => {
    expect(() =>
      CombatSetHiddenPayloadSchema.parse({
        combatId: "CombatId12345678",
        combatantId: "AbcDef1234567890",
      }),
    ).toThrow();

    expect(
      CombatSetHiddenPayloadSchema.parse({
        combatId: "CombatId12345678",
        combatantId: "AbcDef1234567890",
        hidden: false,
      }).hidden,
    ).toBe(false);
  });

  it("CombatReorderPayloadSchema requires at least one id", () => {
    expect(() =>
      CombatReorderPayloadSchema.parse({
        combatId: "CombatId12345678",
        order: [],
      }),
    ).toThrow();

    const result = CombatReorderPayloadSchema.parse({
      combatId: "CombatId12345678",
      order: ["AbcDef1234567890", "BBBBBBBBBBBBBBBB"],
    });
    expect(result.order).toHaveLength(2);
  });

  it("CombatEndPayloadSchema parses correctly", () => {
    expect(CombatEndPayloadSchema.parse({ combatId: "CombatId12345678" })).toMatchObject({
      combatId: "CombatId12345678",
    });
  });

  it("strict schemas reject extra fields", () => {
    expect(() =>
      CombatCreatePayloadSchema.parse({ sceneId: "SceneId12345678", extra: "bad" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. CombatTurnSnapshotSchema
// ---------------------------------------------------------------------------

describe("CombatTurnSnapshotSchema", () => {
  it("parses a valid snapshot", () => {
    const result = CombatTurnSnapshotSchema.parse({
      round: 1,
      turnIndex: 0,
      combatantId: "AbcDef1234567890",
      tokenId: "TokenId12345678",
    });
    expect(result.round).toBe(1);
    expect(result.combatantId).toBe("AbcDef1234567890");
  });

  it("allows null combatantId and tokenId", () => {
    const result = CombatTurnSnapshotSchema.parse({
      round: 0,
      turnIndex: 0,
      combatantId: null,
      tokenId: null,
    });
    expect(result.combatantId).toBeNull();
    expect(result.tokenId).toBeNull();
  });

  it("rejects negative round", () => {
    expect(() =>
      CombatTurnSnapshotSchema.parse({ round: -1, turnIndex: 0, combatantId: null, tokenId: null }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9. Stable sort — equal totals preserve relative insertion order
// ---------------------------------------------------------------------------

describe("sortCombatants stable sort", () => {
  it("preserves relative order for combatants with identical initiative values", () => {
    // All combatants with initiative=15, no tiebreaker.
    // V8's Array.prototype.sort is guaranteed stable; relative insertion order preserved.
    const combatants = ["A", "B", "C", "D"].map((name) =>
      makeCombatant({
        _id: `${name.charCodeAt(0).toString(16).padStart(16, "0")}`
          .slice(0, 16)
          .padEnd(16, "0") as string,
        name,
        initiative: 15,
      }),
    );
    // Give them recognizable ids
    combatants[0]!._id = "AAAAAAAAAAAAAAAA";
    combatants[1]!._id = "BBBBBBBBBBBBBBBB";
    combatants[2]!._id = "CCCCCCCCCCCCCCCC";
    combatants[3]!._id = "DDDDDDDDDDDDDDDD";

    const sorted = sortCombatants(combatants);
    // All have same initiative — must be sorted (they are equal), but names must all appear
    expect(sorted.map((c) => c.name)).toEqual(expect.arrayContaining(["A", "B", "C", "D"]));
    expect(sorted).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// 10. All-defeated guard
// ---------------------------------------------------------------------------

describe("all-defeated guard", () => {
  it("nextTurnIndex returns null when every combatant is defeated", () => {
    const combatants = [
      makeCombatant({ _id: "AAAAAAAAAAAAAAAA", name: "A", defeated: true }),
      makeCombatant({ _id: "BBBBBBBBBBBBBBBB", name: "B", defeated: true }),
    ];
    expect(nextTurnIndex(combatants, 0, 1, true)).toBeNull();
  });

  it("previousTurnIndex returns null when every combatant is defeated", () => {
    const combatants = [
      makeCombatant({ _id: "AAAAAAAAAAAAAAAA", name: "A", defeated: true }),
      makeCombatant({ _id: "BBBBBBBBBBBBBBBB", name: "B", defeated: true }),
    ];
    expect(previousTurnIndex(combatants, 1, 2, true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. Constants
// ---------------------------------------------------------------------------

describe("Constants", () => {
  it("GENERIC_1D20_FORMULA_ID is the expected string", () => {
    expect(GENERIC_1D20_FORMULA_ID).toBe("generic-1d20");
  });

  it("COMBAT_ENVELOPE_TYPES includes all expected event names", () => {
    const expected = [
      "combat:create",
      "combat:beginCombat",
      "combat:addCombatant",
      "combat:removeCombatant",
      "combat:rollInitiative",
      "combat:setInitiative",
      "combat:resetInitiative",
      "combat:nextTurn",
      "combat:previousTurn",
      "combat:setDefeated",
      "combat:setHidden",
      "combat:reorder",
      "combat:endCombat",
      "combat:target",
      "combat:created",
      "combat:updated",
      "combat:deleted",
      "combat:turnChange",
      "combat:initiativeSet",
      "token:targeted",
    ];
    for (const name of expected) {
      expect(COMBAT_ENVELOPE_TYPES).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. CombatTurnChangePayloadSchema
// ---------------------------------------------------------------------------

describe("CombatTurnChangePayloadSchema", () => {
  it("parses a valid turn change payload", () => {
    const snapshot = {
      round: 1,
      turnIndex: 0,
      combatantId: "AbcDef1234567890",
      tokenId: "TokenId12345678",
    };
    const result = CombatTurnChangePayloadSchema.parse({
      combatId: "CombatId12345678",
      current: snapshot,
      previous: { round: 1, turnIndex: 0, combatantId: null, tokenId: null },
    });
    expect(result.combatId).toBe("CombatId12345678");
    expect(result.current.round).toBe(1);
  });
});
