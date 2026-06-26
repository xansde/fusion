/**
 * Tests for the effects module:
 *   - MVP rule type guard (isMvpRuleType)
 *   - UnsupportedRuleElementLog: logs unknown types without throwing
 *   - aggregateModifiers: stacking table (PF2e-style)
 *   - EFFECT_RULE_KEYS: all MVP keys present
 *
 * REQ-SYS-082 (FALLBACK) / REQ-SYS-085.
 */
import { describe, it, expect } from "vitest";
import {
  isMvpRuleType,
  UnsupportedRuleElementLog,
  aggregateModifiers,
  EFFECT_RULE_KEYS,
  MVP_EFFECT_RULE_KEYS,
  type FlatModifierRule,
  type StackingTable,
} from "../effects.js";

// ---------------------------------------------------------------------------
// isMvpRuleType
// ---------------------------------------------------------------------------

describe("isMvpRuleType", () => {
  it("returns true for all MVP keys", () => {
    for (const key of MVP_EFFECT_RULE_KEYS) {
      expect(isMvpRuleType(key), `key: ${key}`).toBe(true);
    }
  });

  it("returns false for V2 keys", () => {
    const v2 = [
      EFFECT_RULE_KEYS.GrantItem,
      EFFECT_RULE_KEYS.ChoiceSet,
      EFFECT_RULE_KEYS.ItemAlteration,
      EFFECT_RULE_KEYS.ActiveEffectLike,
      EFFECT_RULE_KEYS.DamageDice,
      EFFECT_RULE_KEYS.Aura,
      EFFECT_RULE_KEYS.AdjustDegreeOfSuccess,
    ];
    for (const key of v2) {
      expect(isMvpRuleType(key), `key: ${key}`).toBe(false);
    }
  });

  it("returns false for completely unknown types", () => {
    expect(isMvpRuleType("unknownRule")).toBe(false);
    expect(isMvpRuleType("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UnsupportedRuleElementLog — the critical FALLBACK
// REQ-SYS-082 FALLBACK: unknown types must log and NOT throw
// ---------------------------------------------------------------------------

describe("UnsupportedRuleElementLog", () => {
  it("starts empty", () => {
    const log = new UnsupportedRuleElementLog();
    expect(log.entries).toHaveLength(0);
    expect(log.hasEntries).toBe(false);
  });

  it("records an unsupported rule element", () => {
    const log = new UnsupportedRuleElementLog();
    log.add({ type: "grantItem", sourceId: "item-abc", raw: { type: "grantItem", uuid: "x" } });
    expect(log.hasEntries).toBe(true);
    expect(log.entries[0].type).toBe("grantItem");
    expect(log.entries[0].sourceId).toBe("item-abc");
  });

  it("logs multiple unknown types without throwing", () => {
    const log = new UnsupportedRuleElementLog();
    const unknownTypes = ["grantItem", "choiceSet", "aura", "futureRule", "superUnknown"];
    for (const type of unknownTypes) {
      // This must NOT throw — it's the critical fallback behavior
      expect(() => log.add({ type, sourceId: "test-item", raw: { type } })).not.toThrow();
    }
    expect(log.entries).toHaveLength(unknownTypes.length);
  });

  it("fallback simulation: process rules, skip unsupported without crash", () => {
    // Simulate what the effects engine does:
    // process MVP rules normally, log and skip V2/unknown types.
    const log = new UnsupportedRuleElementLog();
    const processedMvpRules: string[] = [];

    const rules = [
      {
        type: "flatModifier",
        selector: "attack-roll",
        value: 2,
        modifierType: "circumstance",
      } as FlatModifierRule,
      { type: "grantItem", uuid: "Compendium.pf2e.feats.SomeFeature" } as Record<string, unknown>,
      { type: "rollOption", domain: "all", option: "action:strike" } as Record<string, unknown>,
      { type: "choiceSet", choices: [] } as Record<string, unknown>,
      { type: "unknownFutureRule", data: {} } as Record<string, unknown>,
    ];

    for (const rule of rules) {
      if (!isMvpRuleType(rule.type as string)) {
        log.add({ type: rule.type as string, sourceId: "test-item", raw: rule });
        // skip — do not throw
        continue;
      }
      processedMvpRules.push(rule.type as string);
    }

    // MVP rules were processed
    expect(processedMvpRules).toEqual(["flatModifier", "rollOption"]);
    // V2/unknown were logged, not thrown
    expect(log.entries.map((e) => e.type)).toEqual(["grantItem", "choiceSet", "unknownFutureRule"]);
  });
});

// ---------------------------------------------------------------------------
// aggregateModifiers
// REQ-SYS-085: stacking is system-declared, engine is neutral
// ---------------------------------------------------------------------------

describe("aggregateModifiers", () => {
  // PF2e-style stacking table (circumstance/item/status: highest bonus, lowest penalty; untyped: additive)
  const pf2eTable: StackingTable = [
    { type: "circumstance", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
    { type: "status", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
    { type: "item", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
    { type: "untyped", bonusBehaviour: "additive", penaltyBehaviour: "additive" },
  ];

  it("sums untyped bonuses additively", () => {
    const mods = [
      { value: 2, type: "untyped" },
      { value: 3, type: "untyped" },
    ];
    expect(aggregateModifiers(mods, pf2eTable)).toBe(5);
  });

  it("circumstance: only the highest bonus applies", () => {
    const mods = [
      { value: 2, type: "circumstance" },
      { value: 4, type: "circumstance" },
      { value: 1, type: "circumstance" },
    ];
    expect(aggregateModifiers(mods, pf2eTable)).toBe(4);
  });

  it("status: only the highest bonus applies", () => {
    const mods = [
      { value: 1, type: "status" },
      { value: 3, type: "status" },
    ];
    expect(aggregateModifiers(mods, pf2eTable)).toBe(3);
  });

  it("item: only the highest bonus applies", () => {
    const mods = [
      { value: 5, type: "item" },
      { value: 2, type: "item" },
    ];
    expect(aggregateModifiers(mods, pf2eTable)).toBe(5);
  });

  it("circumstance: only the most-negative (lowest) penalty applies", () => {
    const mods = [
      { value: -2, type: "circumstance" },
      { value: -4, type: "circumstance" },
      { value: -1, type: "circumstance" },
    ];
    expect(aggregateModifiers(mods, pf2eTable)).toBe(-4);
  });

  it("mixed types: each type aggregates independently then totalled", () => {
    // circumstance bonus: max(2, 5) = 5
    // status bonus: max(1, 3) = 3
    // untyped penalty: -1 + -2 = -3
    const mods = [
      { value: 2, type: "circumstance" },
      { value: 5, type: "circumstance" },
      { value: 1, type: "status" },
      { value: 3, type: "status" },
      { value: -1, type: "untyped" },
      { value: -2, type: "untyped" },
    ];
    expect(aggregateModifiers(mods, pf2eTable)).toBe(5 + 3 - 3);
  });

  it("empty modifier list returns 0", () => {
    expect(aggregateModifiers([], pf2eTable)).toBe(0);
  });

  it("fully additive table (e.g., Etmos) sums everything", () => {
    const allAdditive: StackingTable = [
      { type: "circumstance", bonusBehaviour: "additive", penaltyBehaviour: "additive" },
    ];
    const mods = [
      { value: 2, type: "circumstance" },
      { value: 3, type: "circumstance" },
    ];
    expect(aggregateModifiers(mods, allAdditive)).toBe(5);
  });

  it("unknown type (not in table) behaves additively", () => {
    const mods = [
      { value: 2, type: "someNewType" },
      { value: 3, type: "someNewType" },
    ];
    // Empty table → unknown type → additive fallback
    expect(aggregateModifiers(mods, [])).toBe(5);
  });

  it("CA-06 from spec: engine does not hardcode PF2e rule", () => {
    // Configure a table that makes everything stack (Etmos-style)
    const ethosTable: StackingTable = [
      { type: "circumstance", bonusBehaviour: "additive", penaltyBehaviour: "additive" },
    ];
    const mods = [
      { value: 2, type: "circumstance" },
      { value: 3, type: "circumstance" },
    ];
    // Etmos table: 2 + 3 = 5 (no "highest only" rule)
    expect(aggregateModifiers(mods, ethosTable)).toBe(5);

    // PF2e table: max(2, 3) = 3 (highest only)
    expect(aggregateModifiers(mods, pf2eTable)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// EFFECT_RULE_KEYS enum coverage
// ---------------------------------------------------------------------------

describe("EFFECT_RULE_KEYS", () => {
  it("contains all expected MVP keys", () => {
    expect(EFFECT_RULE_KEYS.FlatModifier).toBe("flatModifier");
    expect(EFFECT_RULE_KEYS.RollOption).toBe("rollOption");
    expect(EFFECT_RULE_KEYS.Note).toBe("note");
    expect(EFFECT_RULE_KEYS.ToggleCondition).toBe("toggleCondition");
    expect(EFFECT_RULE_KEYS.Iwr).toBe("iwr");
  });

  it("contains all V2 reserved keys", () => {
    expect(EFFECT_RULE_KEYS.GrantItem).toBe("grantItem");
    expect(EFFECT_RULE_KEYS.ChoiceSet).toBe("choiceSet");
    expect(EFFECT_RULE_KEYS.ItemAlteration).toBe("itemAlteration");
    expect(EFFECT_RULE_KEYS.ActiveEffectLike).toBe("activeEffectLike");
    expect(EFFECT_RULE_KEYS.DamageDice).toBe("damageDice");
    expect(EFFECT_RULE_KEYS.Aura).toBe("aura");
    expect(EFFECT_RULE_KEYS.AdjustDegreeOfSuccess).toBe("adjustDegreeOfSuccess");
  });
});
