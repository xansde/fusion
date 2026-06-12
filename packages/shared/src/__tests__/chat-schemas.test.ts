/**
 * Tests for chat schemas (types.ts) and formula validator.
 *
 * Covers REQ-ROL-028..030, REQ-CHT-007, REQ-ROL-052.
 */

import { describe, it, expect } from "vitest";
import {
  RollResultDataSchema,
  ChatMessageSchema,
  CardDataSchema,
  RollModeSchema,
  DiceResultSchema,
  RollTermResultSchema,
} from "../chat/types.js";
import {
  validateFormula,
  validateFormulaWithLimits,
  replaceFormulaData,
  extractFlavor,
  estimateDiceCount,
  MAX_DICE_PER_ROLL,
} from "../chat/formula-validator.js";
import { defaultStats, defaultOwnership } from "../document.js";

// ---------------------------------------------------------------------------
// RollMode schema
// ---------------------------------------------------------------------------

describe("RollModeSchema", () => {
  const valid: Array<string> = ["public", "gmroll", "blindroll", "selfroll"];
  for (const mode of valid) {
    it(`accepts "${mode}"`, () => {
      expect(RollModeSchema.parse(mode)).toBe(mode);
    });
  }

  it("rejects unknown mode", () => {
    expect(() => RollModeSchema.parse("secret")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DiceResult schema
// ---------------------------------------------------------------------------

describe("DiceResultSchema", () => {
  it("accepts minimal valid dice result", () => {
    const r = DiceResultSchema.parse({ result: 4, active: true });
    expect(r.result).toBe(4);
    expect(r.active).toBe(true);
  });

  it("accepts full result with all optional fields", () => {
    const r = DiceResultSchema.parse({
      result: 1,
      active: false,
      discarded: true,
      rerolled: false,
      exploded: false,
      success: false,
      failure: true,
    });
    expect(r.failure).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RollTermResult schema
// ---------------------------------------------------------------------------

describe("RollTermResultSchema", () => {
  it("accepts a dice term", () => {
    const term = RollTermResultSchema.parse({
      type: "dice",
      expression: "4d6k3",
      total: 14,
      number: 4,
      faces: 6,
      modifiers: ["kh3"],
      results: [
        { result: 6, active: true },
        { result: 4, active: true },
        { result: 4, active: true },
        { result: 2, active: false, discarded: true },
      ],
    });
    expect(term.results).toHaveLength(4);
    expect(term.results![3].discarded).toBe(true);
  });

  it("accepts a numeric term", () => {
    const term = RollTermResultSchema.parse({
      type: "numeric",
      expression: "5",
      total: 5,
    });
    expect(term.type).toBe("numeric");
  });

  it("accepts an operator term", () => {
    const term = RollTermResultSchema.parse({
      type: "operator",
      expression: "+",
      total: 0,
    });
    expect(term.expression).toBe("+");
  });

  it("rejects unknown term type", () => {
    expect(() =>
      RollTermResultSchema.parse({ type: "unknown", expression: "?", total: 0 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RollResultData schema — REQ-ROL-028..030
// ---------------------------------------------------------------------------

describe("RollResultDataSchema", () => {
  const validRoll = {
    rollId: "abc123",
    formula: "4d6k3 + @str.mod",
    expandedFormula: "4d6k3 + 3",
    total: 14,
    terms: [
      {
        type: "dice",
        expression: "4d6k3",
        total: 11,
        number: 4,
        faces: 6,
        modifiers: ["kh3"],
        results: [
          { result: 6, active: true },
          { result: 3, active: true },
          { result: 2, active: true },
          { result: 1, active: false, discarded: true },
        ],
      },
      { type: "operator", expression: "+", total: 0 },
      { type: "numeric", expression: "3", total: 3 },
    ],
    rollMode: "public" as const,
    timestamp: Date.now(),
    warnings: [],
  };

  it("accepts a valid roll result", () => {
    const parsed = RollResultDataSchema.parse(validRoll);
    expect(parsed.rollId).toBe("abc123");
    expect(parsed.total).toBe(14);
    expect(parsed.warnings).toHaveLength(0);
  });

  it("accepts optional flavor", () => {
    const r = RollResultDataSchema.parse({ ...validRoll, flavor: "Strength check" });
    expect(r.flavor).toBe("Strength check");
  });

  it("accepts optional rerollOf", () => {
    const r = RollResultDataSchema.parse({ ...validRoll, rerollOf: "original-roll-id" });
    expect(r.rerollOf).toBe("original-roll-id");
  });

  it("accepts optional degreeOfSuccess (generic string)", () => {
    const r = RollResultDataSchema.parse({ ...validRoll, degreeOfSuccess: "criticalSuccess" });
    expect(r.degreeOfSuccess).toBe("criticalSuccess");
  });

  it("does NOT include seed (anti-cheat)", () => {
    // seed must not be in the schema output — schema doesn't define it
    const parsed = RollResultDataSchema.parse({ ...validRoll, seed: 12345 });
    expect((parsed as Record<string, unknown>)["seed"]).toBeUndefined();
  });

  it("rejects missing required fields", () => {
    const { rollId: _id, ...rest } = validRoll;
    expect(() => RollResultDataSchema.parse(rest)).toThrow();
  });

  it("accepts warnings array with entries", () => {
    const r = RollResultDataSchema.parse({
      ...validRoll,
      warnings: ["Unresolved @str.mod — substituted with 0"],
    });
    expect(r.warnings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// CardData schema — REQ-CHT-024
// ---------------------------------------------------------------------------

describe("CardDataSchema", () => {
  const validCard = {
    title: "Attack with Longsword",
    systemId: "pf2e",
  };

  it("accepts minimal valid card", () => {
    const c = CardDataSchema.parse(validCard);
    expect(c.title).toBe("Attack with Longsword");
    expect(c.systemId).toBe("pf2e");
  });

  it("accepts full card with buttons and fields", () => {
    const c = CardDataSchema.parse({
      ...validCard,
      subtitle: "Strike",
      icon: "sword",
      fields: [{ label: "To Hit", value: "+12", highlight: true }],
      description: "A powerful attack",
      buttons: [
        {
          id: "apply-damage",
          label: "Apply Damage",
          actionType: "pf2e.applyDamage",
          actionPayload: { damage: 15, type: "slashing" },
          variant: "primary",
        },
      ],
      systemContext: { actorId: "abc123" },
    });
    expect(c.buttons).toHaveLength(1);
    expect(c.fields![0].highlight).toBe(true);
  });

  it("rejects description over 500 chars", () => {
    expect(() => CardDataSchema.parse({ ...validCard, description: "a".repeat(501) })).toThrow();
  });

  it("rejects missing systemId", () => {
    expect(() => CardDataSchema.parse({ title: "Test" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ChatMessage schema — D-CHT-01
// ---------------------------------------------------------------------------

describe("ChatMessageSchema", () => {
  function makeMessage(overrides: Record<string, unknown> = {}) {
    return {
      _id: "A".repeat(16),
      _stats: defaultStats(),
      flags: {},
      ownership: defaultOwnership(),
      sort: 0,
      type: "text",
      worldId: "world-1",
      content: "Hello world",
      speaker: { userId: "user-1", alias: "Adventurer" },
      timestamp: Date.now(),
      whisper: [],
      blind: false,
      ...overrides,
    };
  }

  it("accepts a minimal valid text message", () => {
    const msg = ChatMessageSchema.parse(makeMessage());
    expect(msg.type).toBe("text");
    expect(msg.content).toBe("Hello world");
    expect(msg.blind).toBe(false);
    expect(msg.whisper).toEqual([]);
  });

  it("accepts all five message types", () => {
    const types = ["text", "roll", "emote", "whisper", "system"] as const;
    for (const t of types) {
      const msg = ChatMessageSchema.parse(makeMessage({ type: t }));
      expect(msg.type).toBe(t);
    }
  });

  it("defaults whisper to empty array", () => {
    const msg = ChatMessageSchema.parse(makeMessage({ whisper: undefined }));
    expect(msg.whisper).toEqual([]);
  });

  it("defaults blind to false", () => {
    const msg = ChatMessageSchema.parse(makeMessage({ blind: undefined }));
    expect(msg.blind).toBe(false);
  });

  it("rejects content over 4096 chars", () => {
    expect(() => ChatMessageSchema.parse(makeMessage({ content: "x".repeat(4097) }))).toThrow();
  });

  it("accepts whisper array with user ids", () => {
    const msg = ChatMessageSchema.parse(makeMessage({ whisper: ["user-a", "user-b"] }));
    expect(msg.whisper).toHaveLength(2);
  });

  it("accepts a roll message with rolls array", () => {
    const msg = ChatMessageSchema.parse(
      makeMessage({
        type: "roll",
        rolls: [
          {
            rollId: "r1",
            formula: "1d6",
            expandedFormula: "1d6",
            total: 4,
            terms: [
              {
                type: "dice",
                expression: "1d6",
                total: 4,
                results: [{ result: 4, active: true }],
                number: 1,
                faces: 6,
                modifiers: [],
              },
            ],
            rollMode: "public",
            timestamp: Date.now(),
            warnings: [],
          },
        ],
      }),
    );
    expect(msg.rolls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Formula validator — REQ-ROL-021..023, REQ-ROL-052
// ---------------------------------------------------------------------------

describe("validateFormula", () => {
  it("accepts valid basic dice notation", () => {
    expect(validateFormula("1d20").valid).toBe(true);
    expect(validateFormula("4d6k3").valid).toBe(true);
    expect(validateFormula("2d6+5").valid).toBe(true);
    expect(validateFormula("1d8 + 1d4").valid).toBe(true);
  });

  it("accepts complex modifiers", () => {
    expect(validateFormula("4d6dl1").valid).toBe(true);
    // Exploding dice use "!" (not "x") in rpg-dice-roller v5
    expect(validateFormula("3d6!").valid).toBe(true);
    expect(validateFormula("10d20cs>10").valid).toBe(true);
  });

  it("accepts fate dice", () => {
    expect(validateFormula("4dF").valid).toBe(true);
  });

  it("accepts parenthetical expressions", () => {
    expect(validateFormula("(2d6+4) * 2").valid).toBe(true);
  });

  it("rejects empty formula", () => {
    const r = validateFormula("");
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("rejects invalid syntax", () => {
    const r = validateFormula("d+d");
    expect(r.valid).toBe(false);
  });

  it("accepts formula with flavor (strips it before parse)", () => {
    expect(validateFormula("1d20+5 # Attack").valid).toBe(true);
  });
});

describe("validateFormulaWithLimits", () => {
  it("rejects formula with dice count > MAX_DICE_PER_ROLL via estimate pre-check", () => {
    // estimateDiceCount fires before parsing — rejects with our message
    const r = validateFormulaWithLimits(`${MAX_DICE_PER_ROLL + 1}d6`);
    expect(r.valid).toBe(false);
    // Either our message or the library's own limit message
    expect(r.error).toBeTruthy();
  });

  it("rejects formula where library enforces its own dice-per-term limit (999)", () => {
    // @dice-roller/rpg-dice-roller caps a single dice term at 999
    const r = validateFormulaWithLimits("1000d6");
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("accepts formula within limit", () => {
    const r = validateFormulaWithLimits("100d6");
    expect(r.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// replaceFormulaData — REQ-ROL-014..015
// ---------------------------------------------------------------------------

describe("replaceFormulaData", () => {
  const data = {
    abilities: { str: { mod: 3 } },
    proficiencyBonus: 4,
  };

  it("substitutes @attr references", () => {
    const { expanded } = replaceFormulaData("1d20 + @abilities.str.mod", data);
    expect(expanded).toBe("1d20 + 3");
  });

  it("substitutes multiple references", () => {
    const { expanded } = replaceFormulaData("1d20 + @abilities.str.mod + @proficiencyBonus", data);
    expect(expanded).toBe("1d20 + 3 + 4");
  });

  it("substitutes 0 for unresolved references and adds warning", () => {
    const { expanded, warnings } = replaceFormulaData("1d20 + @missing.attr", data);
    expect(expanded).toBe("1d20 + 0");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("@missing.attr");
  });

  it("returns empty warnings for formula without @attr", () => {
    const { expanded, warnings } = replaceFormulaData("2d6+3", data);
    expect(expanded).toBe("2d6+3");
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractFlavor — REQ-ROL-013
// ---------------------------------------------------------------------------

describe("extractFlavor", () => {
  it("extracts flavor from formula", () => {
    const { formula, flavor } = extractFlavor("1d20 + 5 # Strength check");
    expect(formula).toBe("1d20 + 5");
    expect(flavor).toBe("Strength check");
  });

  it("returns undefined flavor when no # present", () => {
    const { formula, flavor } = extractFlavor("2d6");
    expect(formula).toBe("2d6");
    expect(flavor).toBeUndefined();
  });

  it("trims both sides", () => {
    const { formula, flavor } = extractFlavor("  1d20  #  Attack  ");
    expect(formula).toBe("1d20");
    expect(flavor).toBe("Attack");
  });
});

// ---------------------------------------------------------------------------
// estimateDiceCount
// ---------------------------------------------------------------------------

describe("estimateDiceCount", () => {
  it("counts basic notation", () => {
    expect(estimateDiceCount("4d6")).toBe(4);
    expect(estimateDiceCount("1d20 + 2d6")).toBe(3);
  });

  it("ignores non-dice text", () => {
    expect(estimateDiceCount("5 + 3")).toBe(0);
  });

  it("handles large counts", () => {
    expect(estimateDiceCount("100000d6")).toBe(100000);
  });
});
