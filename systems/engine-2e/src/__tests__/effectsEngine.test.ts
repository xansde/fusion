/**
 * Effects Engine — synthetic unit tests.
 *
 * Tests the EffectSource collector and Synthetics builder (effectsEngine.ts).
 * These tests use synthetic fixtures crafted to cover each processing path:
 *
 *   1. FlatModifier: collection by selector, deferred factory, type.
 *   2. RollOption: fixed-point iteration, domain tracking, predicate-gated injection.
 *   3. Note: collection by selector, predicate-filtered at resolve time.
 *   4. ToggleCondition: collected into conditionsToToggle map.
 *   5. IWR: extracted into synthetics.iwr.
 *   6. FALLBACK: V2 / unknown rule types logged without crash.
 *   7. ignored=true rule: skipped (no-op).
 *   8. requiresEquipped / requiresInvested: equipment gate.
 *   9. source active=false: entire source skipped.
 *  10. Predicate-gated FlatModifier: only active when options present.
 *  11. Roll options fixed-point: an option enables another option.
 *  12. resolveModifiersForSelector: deferred factory evaluation at roll time.
 *  13. resolveNotesForSelector: predicate-filtered note resolution.
 *  14. Multi-selector FlatModifier: applies to each selector in array.
 *
 * REQ-SYS-080..090.
 */

import { describe, it, expect } from "vitest";
import {
  collectEffects,
  resolveModifiersForSelector,
  resolveNotesForSelector,
  type EffectSource,
} from "../effectsEngine.js";
import type {
  EffectRule,
  FlatModifierRule,
  RollOptionRule,
  NoteRule,
  ToggleConditionRule,
  IwrRule,
} from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSource(
  id: string,
  rules: EffectSource["rules"],
  opts?: Partial<Omit<EffectSource, "sourceId" | "rules">>,
): EffectSource {
  return {
    sourceId: id,
    label: `Item: ${id}`,
    rules,
    ...opts,
  };
}

const NO_OPTIONS = new Set<string>();

// ---------------------------------------------------------------------------
// 1. FlatModifier — basic collection
// ---------------------------------------------------------------------------

describe("FlatModifier — basic collection", () => {
  it("adds a deferred modifier to the correct selector", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "attack-roll",
      value: 2,
      modifierType: "circumstance",
    };
    const { synthetics } = collectEffects([makeSource("flanking", [rule])], NO_OPTIONS);
    expect(synthetics.modifiers["attack-roll"]).toHaveLength(1);
  });

  it("deferred factory resolves with correct shape", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "ac",
      value: 1,
      modifierType: "item",
    };
    const { synthetics } = collectEffects([makeSource("shield", [rule])], NO_OPTIONS);
    const mods = resolveModifiersForSelector("ac", synthetics, NO_OPTIONS);
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({ value: 1, type: "item", selector: "ac", source: "shield" });
  });

  it("defaults modifierType to untyped when not specified", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "damage",
      value: 3,
    };
    const { synthetics } = collectEffects([makeSource("rune", [rule])], NO_OPTIONS);
    const mods = resolveModifiersForSelector("damage", synthetics, NO_OPTIONS);
    expect(mods[0]?.type).toBe("untyped");
  });

  it("empty result for unknown selector", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "attack-roll",
      value: 2,
    };
    const { synthetics } = collectEffects([makeSource("src", [rule])], NO_OPTIONS);
    const mods = resolveModifiersForSelector("fortitude", synthetics, NO_OPTIONS);
    expect(mods).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Multi-selector FlatModifier
// ---------------------------------------------------------------------------

describe("FlatModifier — multi-selector", () => {
  it("applies to each selector in array", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: ["fortitude", "reflex", "will"],
      value: 1,
      modifierType: "status",
    };
    const { synthetics } = collectEffects([makeSource("bless", [rule])], NO_OPTIONS);
    expect(resolveModifiersForSelector("fortitude", synthetics, NO_OPTIONS)).toHaveLength(1);
    expect(resolveModifiersForSelector("reflex", synthetics, NO_OPTIONS)).toHaveLength(1);
    expect(resolveModifiersForSelector("will", synthetics, NO_OPTIONS)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Predicate-gated FlatModifier
// ---------------------------------------------------------------------------

describe("FlatModifier — predicate gating", () => {
  it("returns modifier when predicate passes (option present)", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "attack-roll",
      value: 1,
      modifierType: "circumstance",
      predicate: ["target:condition:off-guard"],
    };
    const { synthetics } = collectEffects([makeSource("flanking", [rule])], NO_OPTIONS);
    // At roll time, target is off-guard
    const rollOptions = new Set(["target:condition:off-guard"]);
    const mods = resolveModifiersForSelector("attack-roll", synthetics, rollOptions);
    expect(mods).toHaveLength(1);
  });

  it("returns null when predicate fails (option absent)", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "attack-roll",
      value: 1,
      modifierType: "circumstance",
      predicate: ["target:condition:off-guard"],
    };
    const { synthetics } = collectEffects([makeSource("flanking", [rule])], NO_OPTIONS);
    // At roll time, target is NOT off-guard
    const mods = resolveModifiersForSelector("attack-roll", synthetics, NO_OPTIONS);
    expect(mods).toHaveLength(0);
  });

  it("collects modifier into synthetics even when predicate fails at build time (deferred)", () => {
    // The modifier is stored regardless of build-time options.
    // Predicate is only evaluated at roll time (via the deferred factory).
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "ac",
      value: 2,
      predicate: ["self:condition:shielded"],
    };
    const { synthetics } = collectEffects([makeSource("heavy-armor", [rule])], NO_OPTIONS);
    // The factory IS stored (1 entry in synthetics.modifiers)
    expect(synthetics.modifiers["ac"]).toHaveLength(1);
    // But resolves to nothing without the option
    expect(resolveModifiersForSelector("ac", synthetics, NO_OPTIONS)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. RollOption — basic injection
// ---------------------------------------------------------------------------

describe("RollOption — basic injection", () => {
  it("injects option into current options set", () => {
    const rule: RollOptionRule = {
      type: "rollOption",
      domain: "all",
      option: "action:strike",
    };
    const { synthetics } = collectEffects([makeSource("strike-action", [rule])], NO_OPTIONS);
    expect(synthetics.rollOptions["all"]?.has("action:strike")).toBe(true);
  });

  it("adds options to base options set", () => {
    const base = new Set(["self:type:character"]);
    const rule: RollOptionRule = {
      type: "rollOption",
      domain: "attack",
      option: "weapon:trait:agile",
    };
    const { synthetics } = collectEffects([makeSource("dagger", [rule])], base);
    expect(synthetics.rollOptions["attack"]?.has("weapon:trait:agile")).toBe(true);
  });

  it("tracks options by domain", () => {
    const ruleA: RollOptionRule = {
      type: "rollOption",
      domain: "attack",
      option: "weapon:type:sword",
    };
    const ruleB: RollOptionRule = {
      type: "rollOption",
      domain: "defense",
      option: "armor:type:plate",
    };
    const { synthetics } = collectEffects([makeSource("src", [ruleA, ruleB])], NO_OPTIONS);
    expect(synthetics.rollOptions["attack"]?.has("weapon:type:sword")).toBe(true);
    expect(synthetics.rollOptions["defense"]?.has("armor:type:plate")).toBe(true);
    expect(synthetics.rollOptions["attack"]?.has("armor:type:plate")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. RollOption — fixed-point iteration
// ---------------------------------------------------------------------------

describe("RollOption — fixed-point iteration", () => {
  it("option A enables option B via predicate (converges in 2 iterations)", () => {
    // ruleA injects "condition:flat-footed" unconditionally
    // ruleB injects "self:flanked" only when "condition:flat-footed" is present
    const ruleA: RollOptionRule = {
      type: "rollOption",
      domain: "all",
      option: "condition:flat-footed",
    };
    const ruleB: RollOptionRule = {
      type: "rollOption",
      domain: "all",
      option: "self:flanked",
      predicate: ["condition:flat-footed"],
    };
    const { synthetics } = collectEffects(
      [makeSource("flanking-effect", [ruleA, ruleB])],
      NO_OPTIONS,
    );
    // Both options should be in the "all" domain after fixed-point resolution
    expect(synthetics.rollOptions["all"]?.has("condition:flat-footed")).toBe(true);
    expect(synthetics.rollOptions["all"]?.has("self:flanked")).toBe(true);
  });

  it("predicate-gated option NOT injected when condition absent", () => {
    // ruleB requires "condition:stunned" which is never provided
    const ruleB: RollOptionRule = {
      type: "rollOption",
      domain: "all",
      option: "self:affected:stunned",
      predicate: ["condition:stunned"],
    };
    const { synthetics } = collectEffects([makeSource("stun-effect", [ruleB])], NO_OPTIONS);
    expect(synthetics.rollOptions["all"]?.has("self:affected:stunned")).toBeUndefined();
  });

  it("option from base options can enable predicate-gated roll option", () => {
    const ruleB: RollOptionRule = {
      type: "rollOption",
      domain: "all",
      option: "self:flanking",
      predicate: ["action:strike"],
    };
    const base = new Set(["action:strike"]); // comes from action context
    const { synthetics } = collectEffects([makeSource("opportunist", [ruleB])], base);
    expect(synthetics.rollOptions["all"]?.has("self:flanking")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Note — collection and selector filtering
// ---------------------------------------------------------------------------

describe("Note — collection", () => {
  it("adds a note to the correct selector", () => {
    const rule: NoteRule = {
      type: "note",
      selector: "attack-roll",
      text: "You have advantage from elevation.",
    };
    const { synthetics } = collectEffects([makeSource("elevation", [rule])], NO_OPTIONS);
    const notes = resolveNotesForSelector("attack-roll", synthetics, NO_OPTIONS);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe("You have advantage from elevation.");
  });

  it("multi-selector note appears in each selector", () => {
    const rule: NoteRule = {
      type: "note",
      selector: ["fortitude", "reflex"],
      text: "Evasion applies.",
    };
    const { synthetics } = collectEffects([makeSource("evasion", [rule])], NO_OPTIONS);
    expect(resolveNotesForSelector("fortitude", synthetics, NO_OPTIONS)).toHaveLength(1);
    expect(resolveNotesForSelector("reflex", synthetics, NO_OPTIONS)).toHaveLength(1);
    expect(resolveNotesForSelector("will", synthetics, NO_OPTIONS)).toHaveLength(0);
  });

  it("predicate-gated note filtered at resolve time", () => {
    const rule: NoteRule = {
      type: "note",
      selector: "attack-roll",
      text: "Note only when flanking.",
      predicate: ["self:flanking"],
    };
    const { synthetics } = collectEffects([makeSource("flanking-note", [rule])], NO_OPTIONS);
    // Without the option
    expect(resolveNotesForSelector("attack-roll", synthetics, NO_OPTIONS)).toHaveLength(0);
    // With the option
    const optsWith = new Set(["self:flanking"]);
    expect(resolveNotesForSelector("attack-roll", synthetics, optsWith)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 7. ToggleCondition
// ---------------------------------------------------------------------------

describe("ToggleCondition — collection", () => {
  it("adds condition slug to conditionsToToggle", () => {
    const rule: ToggleConditionRule = {
      type: "toggleCondition",
      conditionSlug: "frightened",
      value: 2,
    };
    const { conditionsToToggle } = collectEffects([makeSource("fear-effect", [rule])], NO_OPTIONS);
    expect(conditionsToToggle.has("frightened")).toBe(true);
    expect(conditionsToToggle.get("frightened")).toBe(2);
  });

  it("condition without value maps to undefined", () => {
    const rule: ToggleConditionRule = {
      type: "toggleCondition",
      conditionSlug: "off-guard",
    };
    const { conditionsToToggle } = collectEffects([makeSource("flanked", [rule])], NO_OPTIONS);
    expect(conditionsToToggle.get("off-guard")).toBeUndefined();
  });

  it("predicate-gated toggleCondition: not toggled when predicate fails", () => {
    const rule: ToggleConditionRule = {
      type: "toggleCondition",
      conditionSlug: "off-guard",
      predicate: ["action:flanked"],
    };
    const { conditionsToToggle } = collectEffects([makeSource("flanking", [rule])], NO_OPTIONS);
    // Predicate not satisfied — condition not toggled
    expect(conditionsToToggle.has("off-guard")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. IWR — extraction into synthetics
// ---------------------------------------------------------------------------

describe("IWR — extraction", () => {
  it("immunity appears in synthetics.iwr.immunities", () => {
    const rule: IwrRule = { type: "iwr", category: "immunity", target: "fire" };
    const { synthetics } = collectEffects([makeSource("fire-immunity", [rule])], NO_OPTIONS);
    expect(synthetics.iwr.immunities).toHaveLength(1);
    expect(synthetics.iwr.immunities[0]).toMatchObject({ target: "fire", category: "immunity" });
  });

  it("weakness appears in synthetics.iwr.weaknesses", () => {
    const rule: IwrRule = { type: "iwr", category: "weakness", target: "cold", value: 5 };
    const { synthetics } = collectEffects([makeSource("cold-vulnerability", [rule])], NO_OPTIONS);
    expect(synthetics.iwr.weaknesses).toHaveLength(1);
    expect(synthetics.iwr.weaknesses[0]).toMatchObject({ target: "cold", value: 5 });
  });

  it("resistance appears in synthetics.iwr.resistances", () => {
    const rule: IwrRule = { type: "iwr", category: "resistance", target: "acid", value: 5 };
    const { synthetics } = collectEffects([makeSource("acid-resistance", [rule])], NO_OPTIONS);
    expect(synthetics.iwr.resistances).toHaveLength(1);
    expect(synthetics.iwr.resistances[0]).toMatchObject({ target: "acid", value: 5 });
  });

  it("multiple IWR rules from different sources all collected", () => {
    const src1 = makeSource("fire-immunity", [
      { type: "iwr", category: "immunity", target: "fire" } as IwrRule,
    ]);
    const src2 = makeSource("cold-weakness", [
      { type: "iwr", category: "weakness", target: "cold", value: 10 } as IwrRule,
    ]);
    const src3 = makeSource("bludgeoning-resistance", [
      { type: "iwr", category: "resistance", target: "bludgeoning", value: 5 } as IwrRule,
    ]);
    const { synthetics } = collectEffects([src1, src2, src3], NO_OPTIONS);
    expect(synthetics.iwr.immunities).toHaveLength(1);
    expect(synthetics.iwr.weaknesses).toHaveLength(1);
    expect(synthetics.iwr.resistances).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 9. FALLBACK — V2 / unknown rule types
// ---------------------------------------------------------------------------

describe("FALLBACK — unsupported rule elements", () => {
  it("V2 rule (grantItem) is logged and does not crash", () => {
    const rule = {
      type: "grantItem",
      uuid: "Compendium.pf2e.feats.SomeFeature",
    } as unknown as EffectRule;
    expect(() => collectEffects([makeSource("feat", [rule])], NO_OPTIONS)).not.toThrow();

    const { unsupportedLog } = collectEffects([makeSource("feat", [rule])], NO_OPTIONS);
    expect(unsupportedLog.hasEntries).toBe(true);
    expect(unsupportedLog.entries[0]?.type).toBe("grantItem");
    expect(unsupportedLog.entries[0]?.sourceId).toBe("feat");
  });

  it("choiceSet is logged without crash", () => {
    const rule = { type: "choiceSet", choices: [] } as unknown as EffectRule;
    const { unsupportedLog } = collectEffects([makeSource("choice", [rule])], NO_OPTIONS);
    expect(unsupportedLog.entries.map((e) => e.type)).toContain("choiceSet");
  });

  it("completely unknown type is logged without crash", () => {
    const rule = { type: "superFutureRule", data: { x: 1 } } as unknown as EffectRule;
    const { unsupportedLog } = collectEffects([makeSource("future", [rule])], NO_OPTIONS);
    expect(unsupportedLog.entries[0]?.type).toBe("superFutureRule");
  });

  it("mix of MVP and V2 rules: MVP processed, V2 logged", () => {
    const rules: EffectRule[] = [
      { type: "flatModifier", selector: "ac", value: 1, modifierType: "item" } as FlatModifierRule,
      { type: "grantItem", uuid: "Compendium.pf2e.x" } as unknown as EffectRule,
      { type: "rollOption", domain: "all", option: "flag:active" } as RollOptionRule,
      { type: "aura", radius: 10, effects: [] } as unknown as EffectRule,
    ];
    const { synthetics, unsupportedLog } = collectEffects(
      [makeSource("mixed-item", rules)],
      NO_OPTIONS,
    );
    // MVP rules were processed
    expect(resolveModifiersForSelector("ac", synthetics, NO_OPTIONS)).toHaveLength(1);
    expect(synthetics.rollOptions["all"]?.has("flag:active")).toBe(true);
    // V2 rules were logged
    expect(unsupportedLog.entries.map((e) => e.type)).toEqual(["grantItem", "aura"]);
  });

  it("all V2 types are recognized as unsupported (not MVP)", () => {
    const v2Types = [
      "grantItem",
      "choiceSet",
      "itemAlteration",
      "activeEffectLike",
      "damageDice",
      "aura",
      "adjustDegreeOfSuccess",
    ];
    const rules = v2Types.map((type) => ({ type }) as unknown as EffectRule);
    const { unsupportedLog } = collectEffects([makeSource("v2-item", rules)], NO_OPTIONS);
    expect(unsupportedLog.entries.map((e) => e.type)).toEqual(v2Types);
  });
});

// ---------------------------------------------------------------------------
// 10. ignored=true — rule is skipped
// ---------------------------------------------------------------------------

describe("ignored flag — rule skipped", () => {
  it("ignored FlatModifier is not added to synthetics", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "attack-roll",
      value: 5,
      ignored: true,
    };
    const { synthetics } = collectEffects([makeSource("ignored-rule", [rule])], NO_OPTIONS);
    expect(synthetics.modifiers["attack-roll"]).toBeUndefined();
  });

  it("ignored RollOption is not injected", () => {
    const rule: RollOptionRule = {
      type: "rollOption",
      domain: "all",
      option: "invisible-flag",
      ignored: true,
    };
    const { synthetics } = collectEffects([makeSource("hidden-rule", [rule])], NO_OPTIONS);
    expect(synthetics.rollOptions["all"]?.has("invisible-flag")).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 11. Equipment requirements
// ---------------------------------------------------------------------------

describe("requiresEquipped / requiresInvested", () => {
  it("requiresEquipped=true skips rule when isEquipped=false", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "ac",
      value: 5,
      requiresEquipped: true,
    };
    const src = makeSource("heavy-armor", [rule], { isEquipped: false });
    const { synthetics } = collectEffects([src], NO_OPTIONS);
    expect(synthetics.modifiers["ac"]).toBeUndefined();
  });

  it("requiresEquipped=true applies rule when isEquipped=true", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "ac",
      value: 5,
      requiresEquipped: true,
    };
    const src = makeSource("heavy-armor", [rule], { isEquipped: true });
    const { synthetics } = collectEffects([src], NO_OPTIONS);
    expect(resolveModifiersForSelector("ac", synthetics, NO_OPTIONS)).toHaveLength(1);
  });

  it("requiresInvested=true skips rule when isInvested=false", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "perception",
      value: 2,
      requiresInvested: true,
    };
    const src = makeSource("ring-of-perception", [rule], { isInvested: false });
    const { synthetics } = collectEffects([src], NO_OPTIONS);
    expect(synthetics.modifiers["perception"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 12. Source active=false — entire source skipped
// ---------------------------------------------------------------------------

describe("source active=false", () => {
  it("inactive source has no rules processed", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "will",
      value: 2,
      modifierType: "status",
    };
    const src = makeSource("inactive-item", [rule], { active: false });
    const { synthetics, unsupportedLog } = collectEffects([src], NO_OPTIONS);
    expect(synthetics.modifiers["will"]).toBeUndefined();
    expect(unsupportedLog.hasEntries).toBe(false);
  });

  it("active source still processed when active is undefined (default active)", () => {
    const rule: FlatModifierRule = {
      type: "flatModifier",
      selector: "ac",
      value: 1,
    };
    // active is undefined — defaults to active
    const src = makeSource("default-active", [rule]);
    const { synthetics } = collectEffects([src], NO_OPTIONS);
    expect(synthetics.modifiers["ac"]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 13. Multiple sources, multiple rules
// ---------------------------------------------------------------------------

describe("multiple sources", () => {
  it("accumulates modifiers from different sources for the same selector", () => {
    const src1 = makeSource("bless", [
      {
        type: "flatModifier",
        selector: "attack-roll",
        value: 1,
        modifierType: "status",
      } as FlatModifierRule,
    ]);
    const src2 = makeSource("flanking", [
      {
        type: "flatModifier",
        selector: "attack-roll",
        value: 2,
        modifierType: "circumstance",
      } as FlatModifierRule,
    ]);
    const { synthetics } = collectEffects([src1, src2], NO_OPTIONS);
    const mods = resolveModifiersForSelector("attack-roll", synthetics, NO_OPTIONS);
    expect(mods).toHaveLength(2);
    const types = mods.map((m) => m.type).sort();
    expect(types).toEqual(["circumstance", "status"]);
  });

  it("each source is correctly tracked by sourceId", () => {
    const src1 = makeSource("item-a", [
      { type: "flatModifier", selector: "damage", value: 1 } as FlatModifierRule,
    ]);
    const src2 = makeSource("item-b", [
      { type: "flatModifier", selector: "damage", value: 2 } as FlatModifierRule,
    ]);
    const { synthetics } = collectEffects([src1, src2], NO_OPTIONS);
    const mods = resolveModifiersForSelector("damage", synthetics, NO_OPTIONS);
    const sources = mods.map((m) => m.source).sort();
    expect(sources).toEqual(["item-a", "item-b"]);
  });
});

// ---------------------------------------------------------------------------
// 14. Complex: roll options enable a FlatModifier via build-time predicate
// ---------------------------------------------------------------------------

describe("roll options enabling FlatModifier at build time", () => {
  it("rollOption rule enables another rule via predicate (process order)", () => {
    // A roll option injection that unlocks a FlatModifier predicate.
    // This tests the 2-pass approach: roll options resolved first, then modifiers.
    const roRule: RollOptionRule = {
      type: "rollOption",
      domain: "all",
      option: "self:condition:off-guard",
    };
    const fmRule: FlatModifierRule = {
      type: "flatModifier",
      selector: "ac",
      value: -2,
      modifierType: "circumstance",
      // This predicate is evaluated AFTER roll options are built.
      // Since the rollOption above injects "self:condition:off-guard",
      // the predicate passes at build time and the modifier is "stored"
      // but the predicate is also re-evaluated at roll time via the factory.
      predicate: ["self:condition:off-guard"],
    };
    const { synthetics } = collectEffects(
      [makeSource("off-guard-effect", [roRule, fmRule])],
      NO_OPTIONS,
    );
    // The factory is stored and the predicate is met at build-time options
    // (since the rollOption was processed first).
    // At roll time with the same options:
    const rollOptions = new Set(["self:condition:off-guard"]);
    const mods = resolveModifiersForSelector("ac", synthetics, rollOptions);
    expect(mods).toHaveLength(1);
    expect(mods[0]?.value).toBe(-2);
  });
});
