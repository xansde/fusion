/**
 * @fusion/system-pf2e — Item schema tests.
 *
 * Tests for the most important item schemas: weapon (longsword example),
 * spell (fireball example), feat, condition, effect, and spellcasting entry.
 * REQ-PF2-003, REQ-PF2-204.
 */

import { describe, it, expect } from "vitest";
import { WeaponSystemSchema } from "../schemas/item-weapon.js";
import { ArmorSystemSchema } from "../schemas/item-armor.js";
import { SpellSystemSchema } from "../schemas/item-spell.js";
import { FeatSystemSchema } from "../schemas/item-feat.js";
import { ConditionSystemSchema } from "../schemas/item-condition.js";
import { EffectSystemSchema } from "../schemas/item-effect.js";
import { SpellcastingEntrySystemSchema } from "../schemas/item-spellcasting-entry.js";
import {
  MeleeSystemSchema,
  ShieldSystemSchema,
  AncestrySystemSchema,
  LoreSystemSchema,
} from "../schemas/item-equipment.js";

// ---------------------------------------------------------------------------
// weapon — Longsword from analysis/02-schema-actor-item.md
// ---------------------------------------------------------------------------

describe("WeaponSystemSchema", () => {
  const longsword = {
    damage: { damageType: "slashing", dice: 1, die: "d8" },
    category: "martial",
    weaponGroup: "sword",
    runes: { potency: 0, property: [], striking: 0 },
    range: null,
    reload: "-",
    bulk: 1,
    price: { gp: 1 },
    quantity: 1,
    level: 0,
    usage: "held-in-one-hand",
    size: "med",
    traits: { rarity: "common", value: ["versatile-p"] },
    baseItem: "longsword",
    rules: [],
    publication: { license: "ORC", remaster: true, title: "Pathfinder Player Core" },
  };

  it("accepts valid longsword", () => {
    expect(WeaponSystemSchema.safeParse(longsword).success).toBe(true);
  });

  it("defaults bonus and bonusDamage to 0", () => {
    const result = WeaponSystemSchema.safeParse(longsword);
    if (result.success) {
      expect(result.data.bonus).toBe(0);
      expect(result.data.bonusDamage).toBe(0);
    }
  });

  it("passes through extra fields (REQ-PF2-204)", () => {
    const withExtra = { ...longsword, unknownLegacyField: true };
    expect(WeaponSystemSchema.safeParse(withExtra).success).toBe(true);
  });

  it("accepts weapon with unsupported rule type (REQ-PF2-204)", () => {
    const withUnknownRule = {
      ...longsword,
      rules: [{ type: "grantItem", uuid: "Compendium.pf2e.abc" }],
    };
    expect(WeaponSystemSchema.safeParse(withUnknownRule).success).toBe(true);
  });

  it("rejects missing damage block", () => {
    const { damage: _d, ...noD } = longsword;
    expect(WeaponSystemSchema.safeParse(noD).success).toBe(false);
  });

  it("rejects invalid die format", () => {
    const bad = { ...longsword, damage: { ...longsword.damage, die: "8-sided" } };
    expect(WeaponSystemSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid weapon category", () => {
    const bad = { ...longsword, category: "exotic" };
    expect(WeaponSystemSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts ranged weapon", () => {
    const bow = { ...longsword, range: 120, reload: "0", category: "martial", weaponGroup: "bow" };
    expect(WeaponSystemSchema.safeParse(bow).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// spell — Fireball from analysis/02-schema-actor-item.md
// ---------------------------------------------------------------------------

describe("SpellSystemSchema", () => {
  const fireball = {
    level: 3,
    traits: {
      rarity: "common",
      traditions: ["arcane", "primal"],
      value: ["concentrate", "fire", "manipulate"],
    },
    castTime: "2",
    range: "500 feet",
    area: { type: "burst", value: 20 },
    defense: { save: { basic: true, statistic: "reflex" } },
    damage: {
      "0": { formula: "6d6", type: "fire", kinds: ["damage"], applyMod: false },
    },
    heightening: {
      type: "interval",
      interval: 1,
      damage: { "0": "2d6" },
    },
    counteraction: false,
    publication: { license: "ORC", remaster: true, title: "Pathfinder Player Core" },
  };

  it("accepts valid Fireball", () => {
    expect(SpellSystemSchema.safeParse(fireball).success).toBe(true);
  });

  it("accepts cantrip (level 0)", () => {
    const cantrip = {
      ...fireball,
      level: 0,
      traits: { ...fireball.traits, value: ["cantrip", "fire"] },
    };
    expect(SpellSystemSchema.safeParse(cantrip).success).toBe(true);
  });

  it("passes through extra fields", () => {
    expect(SpellSystemSchema.safeParse({ ...fireball, overlays: {} }).success).toBe(true);
  });

  it("rejects invalid tradition", () => {
    const bad = { ...fireball, traits: { ...fireball.traits, traditions: ["shadow"] } };
    expect(SpellSystemSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects level > 10", () => {
    expect(SpellSystemSchema.safeParse({ ...fireball, level: 11 }).success).toBe(false);
  });

  it("rejects spell with non-existent save statistic", () => {
    const bad = {
      ...fireball,
      defense: { save: { basic: true, statistic: "athletics" } },
    };
    expect(SpellSystemSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// armor
// ---------------------------------------------------------------------------

describe("ArmorSystemSchema", () => {
  const chainShirt = {
    category: "light",
    acBonus: 3,
    dexCap: 3,
    checkPenalty: 0,
    speedPenalty: 0,
    bulk: 1,
    level: 0,
    traits: { rarity: "common", value: ["flexible"] },
    runes: { potency: 0, resilient: 0, property: [] },
  };

  it("accepts chain shirt", () => {
    expect(ArmorSystemSchema.safeParse(chainShirt).success).toBe(true);
  });

  it("rejects negative AC bonus", () => {
    expect(ArmorSystemSchema.safeParse({ ...chainShirt, acBonus: -1 }).success).toBe(false);
  });

  it("rejects invalid armor category", () => {
    expect(ArmorSystemSchema.safeParse({ ...chainShirt, category: "cloth" }).success).toBe(false);
  });

  it("accepts heavy armor with strength requirement", () => {
    const fullPlate = {
      ...chainShirt,
      category: "heavy",
      acBonus: 6,
      dexCap: 0,
      checkPenalty: -3,
      speedPenalty: -10,
      strength: 18,
    };
    expect(ArmorSystemSchema.safeParse(fullPlate).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// melee (NPC attack)
// ---------------------------------------------------------------------------

describe("MeleeSystemSchema", () => {
  const scimitar = {
    bonus: { value: 6 },
    damage: { formula: "1d6+3", damageType: "slashing" },
    traits: { rarity: "common", value: ["sweep"] },
  };

  it("accepts valid melee attack", () => {
    expect(MeleeSystemSchema.safeParse(scimitar).success).toBe(true);
  });

  it("rejects missing bonus", () => {
    const { bonus: _b, ...noB } = scimitar;
    expect(MeleeSystemSchema.safeParse(noB).success).toBe(false);
  });

  it("rejects invalid damage type", () => {
    const bad = { ...scimitar, damage: { ...scimitar.damage, damageType: "electric" } };
    expect(MeleeSystemSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shield
// ---------------------------------------------------------------------------

describe("ShieldSystemSchema", () => {
  const woodenShield = {
    acBonus: 2,
    hardness: 3,
    hp: { value: 12, max: 12 },
    brokenThreshold: 6,
  };

  it("accepts valid shield", () => {
    expect(ShieldSystemSchema.safeParse(woodenShield).success).toBe(true);
  });

  it("rejects negative acBonus", () => {
    expect(ShieldSystemSchema.safeParse({ ...woodenShield, acBonus: -1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// feat
// ---------------------------------------------------------------------------

describe("FeatSystemSchema", () => {
  const powerAttack = {
    level: 1,
    category: "class",
    actionType: "action",
    actions: 2,
    traits: { rarity: "common", value: ["fighter", "flourish"] },
    rules: [
      {
        type: "flatModifier",
        selector: "melee-damage",
        value: 2,
        modifierType: "untyped",
        slug: "power-attack-bonus",
      },
    ],
  };

  it("accepts Power Attack feat", () => {
    expect(FeatSystemSchema.safeParse(powerAttack).success).toBe(true);
  });

  it("accepts feat with unsupported rule type (REQ-PF2-204)", () => {
    const withGrantItem = {
      ...powerAttack,
      rules: [{ type: "grantItem", uuid: "Compendium.pf2e.feats.SomeItem" }],
    };
    expect(FeatSystemSchema.safeParse(withGrantItem).success).toBe(true);
  });

  it("rejects feat level < 1", () => {
    expect(FeatSystemSchema.safeParse({ ...powerAttack, level: 0 }).success).toBe(false);
  });

  it("rejects invalid actionType", () => {
    expect(FeatSystemSchema.safeParse({ ...powerAttack, actionType: "swift" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// condition (embedded item)
// ---------------------------------------------------------------------------

describe("ConditionSystemSchema", () => {
  it("accepts frightened 2", () => {
    const result = ConditionSystemSchema.safeParse({ slug: "frightened", value: 2 });
    expect(result.success).toBe(true);
  });

  it("accepts non-valued condition (off-guard)", () => {
    expect(ConditionSystemSchema.safeParse({ slug: "off-guard" }).success).toBe(true);
  });

  it("rejects missing slug", () => {
    expect(ConditionSystemSchema.safeParse({ value: 1 }).success).toBe(false);
  });

  it("rejects value < 1", () => {
    expect(ConditionSystemSchema.safeParse({ slug: "frightened", value: 0 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// effect
// ---------------------------------------------------------------------------

describe("EffectSystemSchema", () => {
  const haste = {
    slug: "haste",
    duration: { value: 1, unit: "minute", sustained: false },
    rules: [{ type: "rollOption", domain: "all", option: "condition:quickened" }],
    grantedConditions: [{ slug: "quickened" }],
  };

  it("accepts haste effect", () => {
    expect(EffectSystemSchema.safeParse(haste).success).toBe(true);
  });

  it("accepts effect with iwr block", () => {
    const withIwr = {
      ...haste,
      iwr: { immunities: [{ type: "fire" }], weaknesses: [], resistances: [] },
    };
    expect(EffectSystemSchema.safeParse(withIwr).success).toBe(true);
  });

  it("accepts effect with extra damage", () => {
    const withDamage = {
      ...haste,
      extraDamage: [{ dice: 1, die: 6, damageType: "fire" }],
    };
    expect(EffectSystemSchema.safeParse(withDamage).success).toBe(true);
  });

  it("rejects invalid duration unit", () => {
    const bad = { ...haste, duration: { value: 1, unit: "week", sustained: false } };
    expect(EffectSystemSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// spellcastingEntry
// ---------------------------------------------------------------------------

describe("SpellcastingEntrySystemSchema", () => {
  const wizardEntry = {
    prepared: { value: "prepared" },
    tradition: { value: "arcane" },
    ability: { value: "int" },
    proficiency: { value: 2 },
    slots: {
      "0": { value: 0, max: 0 },
      "1": { value: 3, max: 3 },
      "2": { value: 2, max: 2 },
      "3": { value: 1, max: 1 },
    },
    isFocusPool: false,
  };

  it("accepts wizard prepared spellcasting entry", () => {
    expect(SpellcastingEntrySystemSchema.safeParse(wizardEntry).success).toBe(true);
  });

  it("accepts focus pool entry", () => {
    const focus = { ...wizardEntry, isFocusPool: true, prepared: { value: "innate" } };
    expect(SpellcastingEntrySystemSchema.safeParse(focus).success).toBe(true);
  });

  it("rejects invalid tradition", () => {
    const bad = { ...wizardEntry, tradition: { value: "shadow" } };
    expect(SpellcastingEntrySystemSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid ability slug", () => {
    const bad = { ...wizardEntry, ability: { value: "luck" } };
    expect(SpellcastingEntrySystemSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid proficiency rank (5)", () => {
    const bad = { ...wizardEntry, proficiency: { value: 5 } };
    expect(SpellcastingEntrySystemSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ancestry
// ---------------------------------------------------------------------------

describe("AncestrySystemSchema", () => {
  const human = {
    hp: 8,
    speed: 25,
    size: "med",
    boosts: ["str", "free", "free"],
    flaws: [],
    languages: { value: ["common"] },
    vision: "normal",
  };

  it("accepts human ancestry", () => {
    expect(AncestrySystemSchema.safeParse(human).success).toBe(true);
  });

  it("rejects negative HP", () => {
    expect(AncestrySystemSchema.safeParse({ ...human, hp: -1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lore
// ---------------------------------------------------------------------------

describe("LoreSystemSchema", () => {
  it("accepts lore skill at rank 2", () => {
    expect(LoreSystemSchema.safeParse({ proficient: { value: 2 } }).success).toBe(true);
  });

  it("rejects rank out of range", () => {
    expect(LoreSystemSchema.safeParse({ proficient: { value: 5 } }).success).toBe(false);
  });
});
