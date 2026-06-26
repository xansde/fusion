/**
 * @fusion/system-pf2e — Strike actions tests.
 *
 * Covers:
 *   1. MAP (standard and agile): 1st/2nd/3rd attack.
 *   2. Critical hit on nat20 and margin >= 10.
 *   3. Damage with weakness/resistance in target IWR.
 *   4. Frightened condition reduces attack.
 *   5. Initiative formula uses Perception on the server.
 *   6. NPC melee strike derivation.
 *   7. Condition manager (apply, toggle, immunity, decrease to 0).
 *   8. Basic save damage scaling.
 *   9. Apply damage pipeline (temp HP, IWR, hardness).
 *
 * REQ-PF2-031..034, REQ-PF2-040..041, REQ-PF2-051, REQ-PF2-053, REQ-PF2-054,
 * REQ-PF2-060, REQ-PF2-062, REQ-PF2-090..091.
 */

import { describe, it, expect } from "vitest";
import {
  deriveStrikeFromWeapon,
  deriveStrikeFromMeleeItem,
  resolveStrikeAttack,
  computeStrikeDamage,
  buildStrikeChatCard,
} from "../actions/strikes.js";
import {
  applyCondition,
  toggleCondition,
  increaseCondition,
  decreaseCondition,
  setCondition,
  isImmuneToCondition,
  resolveConditionModifierValue,
} from "../actions/conditions-manager.js";
import { applyDamagePipeline, scaleBasicSaveDamage, applyHealing } from "../actions/damage.js";
import { calculateMapPenalty } from "@fusion/engine-2e";
import type { WeaponSystem } from "../schemas/item-weapon.js";
import type { CharacterSystem } from "../schemas/actor-character.js";
import type { IwrSet } from "@fusion/engine-2e";
import type { ConditionItem, ActorIwrBlock } from "../actions/conditions-manager.js";
import type { TargetHpState } from "../actions/damage.js";
import { pf2eSystem } from "../index.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A Fighter character at level 5, STR 18 (+4), DEX 14 (+2), WIS 12 (+1). */
const FIGHTER_5: CharacterSystem = {
  systemVersion: "0.1.0",
  level: { value: 5 },
  abilities: {
    str: { value: 18, mod: 4 },
    dex: { value: 14, mod: 2 },
    con: { value: 16, mod: 3 },
    int: { value: 10, mod: 0 },
    wis: { value: 12, mod: 1 },
    cha: { value: 8, mod: -1 },
  },
  attributes: {
    hp: { value: 60, max: 60, temp: 0 },
    ac: { value: 22 },
    speed: { value: 25, otherSpeeds: [] },
    dying: { value: 0, max: 4 },
    wounded: { value: 0 },
    doomed: { value: 0 },
    iwr: { immunities: [], weaknesses: [], resistances: [] },
  },
  saves: { fortitude: { rank: 2 }, reflex: { rank: 1 }, will: { rank: 1 } },
  perception: { rank: 1, senses: [] },
  skills: {
    acrobatics: { rank: 0 },
    athletics: { rank: 2 },
    arcana: { rank: 0 },
    crafting: { rank: 0 },
    deception: { rank: 0 },
    diplomacy: { rank: 0 },
    intimidation: { rank: 0 },
    medicine: { rank: 0 },
    nature: { rank: 0 },
    occultism: { rank: 0 },
    performance: { rank: 0 },
    religion: { rank: 0 },
    society: { rank: 0 },
    stealth: { rank: 0 },
    survival: { rank: 0 },
    thievery: { rank: 0 },
  },
  proficiencies: {
    classDC: { rank: 1 },
    weapons: { unarmed: 1, simple: 1, martial: 2, advanced: 0 },
    armor: { unarmored: 1, light: 1, medium: 2, heavy: 2 },
  },
  resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
  details: { keyAbility: "str", class: "Fighter", level: 5 },
  traits: { rarity: "common", value: [], size: "med" },
};

/** Longsword — martial, 1d8 slashing, no runes. */
const LONGSWORD: WeaponSystem = {
  systemVersion: "0.1.0",
  damage: { dice: 1, die: "d8", damageType: "slashing", modifier: 0 },
  category: "martial",
  weaponGroup: "sword",
  runes: { potency: 0, striking: 0, property: [] },
  range: null,
  reload: "-",
  bulk: 1,
  price: { gp: 1 },
  quantity: 1,
  level: 0,
  usage: "held-in-one-hand",
  size: "med",
  traits: { rarity: "common", value: ["versatile-p"] },
  bonus: 0,
  bonusDamage: 0,
  rules: [],
};

/** Agile shortsword — martial, 1d6 piercing, agile + finesse. */
const SHORTSWORD: WeaponSystem = {
  systemVersion: "0.1.0",
  damage: { dice: 1, die: "d6", damageType: "piercing", modifier: 0 },
  category: "martial",
  weaponGroup: "sword",
  runes: { potency: 0, striking: 0, property: [] },
  range: null,
  reload: "-",
  bulk: 0,
  price: { sp: 9 },
  quantity: 1,
  level: 0,
  usage: "held-in-one-hand",
  size: "med",
  traits: { rarity: "common", value: ["agile", "finesse"] },
  bonus: 0,
  bonusDamage: 0,
  rules: [],
};

/** +1 striking longsword — potency 1, striking 1. */
const PLUS1_STRIKING_LONGSWORD: WeaponSystem = {
  ...LONGSWORD,
  runes: { potency: 1, striking: 1, property: [] },
};

/** Longbow — simple range 100ft, 1d8 piercing, deadly-d10. */
const LONGBOW: WeaponSystem = {
  systemVersion: "0.1.0",
  damage: { dice: 1, die: "d8", damageType: "piercing", modifier: 0 },
  category: "martial",
  weaponGroup: "bow",
  runes: { potency: 0, striking: 0, property: [] },
  range: 100,
  reload: "0",
  bulk: 2,
  price: { gp: 6 },
  quantity: 1,
  level: 0,
  usage: "held-in-two-hands",
  size: "med",
  traits: { rarity: "common", value: ["deadly-d10", "volley-30"] },
  bonus: 0,
  bonusDamage: 0,
  rules: [],
};

// ---------------------------------------------------------------------------
// 1. MAP — standard and agile
// REQ-PF2-031
// ---------------------------------------------------------------------------

describe("Multiple Attack Penalty (MAP)", () => {
  it("standard weapon: 0 / -5 / -10 for attacks 1, 2, 3", () => {
    expect(calculateMapPenalty(1, false)).toBe(0);
    expect(calculateMapPenalty(2, false)).toBe(-5);
    expect(calculateMapPenalty(3, false)).toBe(-10);
  });

  it("agile weapon: 0 / -4 / -8 for attacks 1, 2, 3", () => {
    expect(calculateMapPenalty(1, true)).toBe(0);
    expect(calculateMapPenalty(2, true)).toBe(-4);
    expect(calculateMapPenalty(3, true)).toBe(-8);
  });

  it("4th+ attack clamps to 3rd penalty (standard)", () => {
    expect(calculateMapPenalty(4, false)).toBe(-10);
    expect(calculateMapPenalty(10, false)).toBe(-10);
  });

  it("4th+ attack clamps to 3rd penalty (agile)", () => {
    expect(calculateMapPenalty(4, true)).toBe(-8);
  });
});

// ---------------------------------------------------------------------------
// 2. Strike derivation for character (longsword)
// REQ-PF2-030..032
// ---------------------------------------------------------------------------

describe("deriveStrikeFromWeapon — longsword", () => {
  const strike = deriveStrikeFromWeapon("weapon-longsword", "Longsword", LONGSWORD, FIGHTER_5);

  it("label matches weapon name", () => {
    expect(strike.label).toBe("Longsword");
  });

  it("is melee (range = null)", () => {
    expect(strike.melee).toBe(true);
  });

  it("is not agile", () => {
    expect(strike.isAgile).toBe(false);
  });

  it("attack ability is STR for melee without finesse", () => {
    expect(strike.attackAbility).toBe("str");
  });

  it("damage die is d8 with 1 die (no striking rune)", () => {
    expect(strike.damageDie).toBe("d8");
    expect(strike.damageDice).toBe(1);
  });

  it("damage type is slashing", () => {
    expect(strike.damageType).toBe("slashing");
  });

  it("attack bonus = STR 4 + prof (martial 2 trained=rank2 → 2*2+5=9 → 9) + no potency", () => {
    // Rank 2 (expert) at level 5: 2*2 + 5 = 9
    // STR mod: 4
    // Expected: 4 + 9 = 13
    expect(strike.attackBonus).toBe(13);
  });

  it("damage ability mod is STR +4", () => {
    expect(strike.damageAbilityMod).toBe(4);
  });

  it("damage bonus equals STR mod only (no extra modifiers)", () => {
    expect(strike.damageBonus).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 3. Strike derivation — agile shortsword (finesse, agile)
// REQ-PF2-031, REQ-PF2-032
// ---------------------------------------------------------------------------

describe("deriveStrikeFromWeapon — shortsword (agile + finesse)", () => {
  const strike = deriveStrikeFromWeapon("weapon-shortsword", "Shortsword", SHORTSWORD, FIGHTER_5);

  it("isAgile = true", () => {
    expect(strike.isAgile).toBe(true);
  });

  it("isFinesse = true", () => {
    expect(strike.isFinesse).toBe(true);
  });

  it("attack ability is STR (STR +4 > DEX +2 even with finesse)", () => {
    // STR mod 4 > DEX mod 2 → STR wins even though finesse is present
    expect(strike.attackAbility).toBe("str");
  });

  it("finesse chooses DEX when DEX > STR", () => {
    // Build a dex-heavy character
    const dexFighter: CharacterSystem = {
      ...FIGHTER_5,
      abilities: { ...FIGHTER_5.abilities, str: { value: 10, mod: 0 }, dex: { value: 18, mod: 4 } },
    };
    const dexStrike = deriveStrikeFromWeapon("w", "Shortsword", SHORTSWORD, dexFighter);
    expect(dexStrike.attackAbility).toBe("dex");
  });

  it("MAP penalties are agile (0 / -4 / -8) via resolveStrikeAttack", () => {
    const r1 = resolveStrikeAttack(strike, 1, 10);
    const r2 = resolveStrikeAttack(strike, 2, 10);
    const r3 = resolveStrikeAttack(strike, 3, 10);
    expect(r1.mapPenalty).toBe(0);
    expect(r2.mapPenalty).toBe(-4);
    expect(r3.mapPenalty).toBe(-8);
  });
});

// ---------------------------------------------------------------------------
// 4. +1 striking longsword
// REQ-PF2-130 (potency rune), REQ-PF2-033 (extra dice)
// ---------------------------------------------------------------------------

describe("deriveStrikeFromWeapon — +1 striking longsword", () => {
  const strike = deriveStrikeFromWeapon(
    "weapon-ls-p1s1",
    "Longsword +1 (striking)",
    PLUS1_STRIKING_LONGSWORD,
    FIGHTER_5,
  );

  it("attack bonus includes +1 potency item bonus", () => {
    // Longsword base: STR 4 + prof expert (9) + potency 1 = 14
    expect(strike.attackBonus).toBe(14);
  });

  it("damage dice = 2 (1 base + 1 from striking rune)", () => {
    expect(strike.damageDice).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Ranged weapon (longbow)
// REQ-PF2-032: DEX to attack; REQ-PF2-033: no STR to damage
// ---------------------------------------------------------------------------

describe("deriveStrikeFromWeapon — longbow (ranged)", () => {
  const strike = deriveStrikeFromWeapon("w-bow", "Longbow", LONGBOW, FIGHTER_5);

  it("is NOT melee", () => {
    expect(strike.melee).toBe(false);
  });

  it("attack ability is DEX for ranged", () => {
    expect(strike.attackAbility).toBe("dex");
  });

  it("damage ability mod is 0 (standard ranged)", () => {
    expect(strike.damageAbilityMod).toBe(0);
  });

  it("deadly-d10 trait is extracted", () => {
    expect(strike.deadlyDie).toBe("d10");
  });
});

// ---------------------------------------------------------------------------
// 6. resolveStrikeAttack — degree of success
// REQ-PF2-040
// ---------------------------------------------------------------------------

describe("resolveStrikeAttack — degrees of success", () => {
  const longswordStrike = deriveStrikeFromWeapon("w-ls", "Longsword", LONGSWORD, FIGHTER_5);
  // attackBonus = 13

  it("nat20 upgrades degree (Success → CriticalSuccess)", () => {
    // total = 20 + 13 = 33 vs AC 25 → margin 8 = Success → nat20 upgrades → CriticalSuccess
    const r = resolveStrikeAttack(longswordStrike, 1, 20, 25);
    expect(r.dieNatural).toBe(20);
    expect(r.degree).toBe("CriticalSuccess");
  });

  it("margin >= 10 is CriticalSuccess", () => {
    // total = 15 + 13 = 28 vs AC 16 → margin 12 → CriticalSuccess
    const r = resolveStrikeAttack(longswordStrike, 1, 15, 16);
    expect(r.degree).toBe("CriticalSuccess");
  });

  it("margin >= 0 < 10 is Success", () => {
    // total = 5 + 13 = 18 vs AC 18 → margin 0 → Success
    const r = resolveStrikeAttack(longswordStrike, 1, 5, 18);
    expect(r.degree).toBe("Success");
  });

  it("margin < 0 > -10 is Failure", () => {
    // total = 1 + 13 = 14 vs AC 18 → margin -4 → Failure
    const r = resolveStrikeAttack(longswordStrike, 1, 1, 18);
    // BUT natural 1 downgrades: Failure → CriticalFailure
    expect(r.degree).toBe("CriticalFailure");
  });

  it("nat1 downgrades degree (Success → Failure)", () => {
    // total = 1 + 13 = 14 vs AC 14 → margin 0 → Success → nat1 → Failure
    const r = resolveStrikeAttack(longswordStrike, 1, 1, 14);
    expect(r.degree).toBe("Failure");
  });

  it("no degree computed when targetAc is not provided", () => {
    const r = resolveStrikeAttack(longswordStrike, 1, 15);
    expect(r.degree).toBeUndefined();
  });

  it("MAP penalty is applied to totalBonus (2nd attack standard)", () => {
    const r = resolveStrikeAttack(longswordStrike, 2, 10, 20);
    expect(r.mapPenalty).toBe(-5);
    expect(r.totalBonus).toBe(13 + -5);
    expect(r.total).toBe(10 + (13 - 5));
  });

  it("3rd attack applies full MAP penalty", () => {
    const r = resolveStrikeAttack(longswordStrike, 3, 10, 20);
    expect(r.mapPenalty).toBe(-10);
    expect(r.totalBonus).toBe(13 - 10);
  });
});

// ---------------------------------------------------------------------------
// 7. computeStrikeDamage — crit doubling + IWR
// REQ-PF2-034, REQ-PF2-060, REQ-PF2-062
// ---------------------------------------------------------------------------

describe("computeStrikeDamage", () => {
  const longswordStrike = deriveStrikeFromWeapon("w-ls", "Longsword", LONGSWORD, FIGHTER_5);

  it("normal hit: dice + flatBonus", () => {
    // diceTotal=5, damageBonus=4, isCritical=false
    const r = computeStrikeDamage(longswordStrike, 5, false);
    expect(r.baseTotal).toBe(9); // 5 + 4
    expect(r.doubledTotal).toBe(9); // not crit
    expect(r.finalDamage).toBe(9);
  });

  it("critical hit: doubles total damage (REQ-PF2-034)", () => {
    const r = computeStrikeDamage(longswordStrike, 5, true);
    // baseBeforeCrit = 5 + 4 = 9; doubled = 18; no deadly
    expect(r.doubledTotal).toBe(18);
    expect(r.finalDamage).toBe(18);
    expect(r.isCritical).toBe(true);
  });

  it("weakness adds damage after IWR (fire weakness 5 on slashing: N/A → no change)", () => {
    const targetIwr: IwrSet = {
      immunities: [],
      weaknesses: [{ target: "fire", value: 5 }],
      resistances: [],
    };
    const r = computeStrikeDamage(longswordStrike, 5, false, targetIwr);
    // Longsword = slashing, no fire weakness applies
    expect(r.finalDamage).toBe(9);
  });

  it("weakness applies to matching damage type", () => {
    const targetIwr: IwrSet = {
      immunities: [],
      weaknesses: [{ target: "slashing", value: 5 }],
      resistances: [],
    };
    const r = computeStrikeDamage(longswordStrike, 5, false, targetIwr);
    // 9 + 5 = 14
    expect(r.finalDamage).toBe(14);
  });

  it("resistance reduces damage (min 0)", () => {
    const targetIwr: IwrSet = {
      immunities: [],
      weaknesses: [],
      resistances: [{ target: "slashing", value: 15 }],
    };
    const r = computeStrikeDamage(longswordStrike, 5, false, targetIwr);
    // 9 - 15 = clamped to 0
    expect(r.finalDamage).toBe(0);
  });

  it("immunity negates all damage of that type", () => {
    const targetIwr: IwrSet = {
      immunities: [{ target: "slashing" }],
      weaknesses: [],
      resistances: [],
    };
    const r = computeStrikeDamage(longswordStrike, 8, false, targetIwr);
    expect(r.finalDamage).toBe(0);
  });

  it("REQ-PF2-062: weakness applied after crit doubling", () => {
    const targetIwr: IwrSet = {
      immunities: [],
      weaknesses: [{ target: "slashing", value: 5 }],
      resistances: [],
    };
    const r = computeStrikeDamage(longswordStrike, 5, true, targetIwr);
    // crit: (5+4)*2 = 18; then weakness 5: 18+5 = 23
    expect(r.doubledTotal).toBe(18);
    expect(r.finalDamage).toBe(23);
  });
});

// ---------------------------------------------------------------------------
// 8. Frightened condition reduces attack bonus
// REQ-PF2-051
// ---------------------------------------------------------------------------

describe("Frightened condition reduces attack bonus", () => {
  it("frightened 2 adds -2 status penalty to attack", () => {
    const frightenedMod = {
      slug: "frightened-penalty",
      label: "Frightened",
      type: "status",
      value: -2, // frightened X = -X status
    };
    const strike = deriveStrikeFromWeapon(
      "w-ls",
      "Longsword",
      LONGSWORD,
      FIGHTER_5,
      [frightenedMod], // extra attack mods
    );
    // Base: 13 + (-2) = 11 (status penalty reduces, doesn't stack with another status)
    expect(strike.attackBonus).toBe(11);
  });

  it("two status penalties do NOT stack (lowest-only wins per PF2e stacking)", () => {
    const frightenedMod = {
      slug: "frightened-penalty",
      label: "Frightened",
      type: "status",
      value: -2,
    };
    const sickMod = { slug: "sickened-penalty", label: "Sickened", type: "status", value: -1 };
    const strike = deriveStrikeFromWeapon(
      "w-ls",
      "Longsword",
      LONGSWORD,
      FIGHTER_5,
      [frightenedMod, sickMod], // two status penalties
    );
    // PF2E_STACKING_TABLE: status penalties → lowest-only (most negative = -2 wins)
    expect(strike.attackBonus).toBe(11); // 13 + (-2) = 11
  });
});

// ---------------------------------------------------------------------------
// 9. NPC melee strike
// REQ-PF2-030 (NPC strikes from melee items)
// ---------------------------------------------------------------------------

describe("deriveStrikeFromMeleeItem — Skeleton Guard claw", () => {
  const skelClaw = deriveStrikeFromMeleeItem(
    "melee-claw",
    "Claw",
    5, // attack bonus from statblock
    1, // 1d4
    "d4",
    "slashing",
    0, // no flat damage bonus
    ["agile", "finesse"],
  );

  it("attack bonus from statblock", () => {
    expect(skelClaw.attackBonus).toBe(5);
  });

  it("is melee", () => {
    expect(skelClaw.melee).toBe(true);
  });

  it("isAgile = true (trait)", () => {
    expect(skelClaw.isAgile).toBe(true);
  });

  it("damage dice are 1d4", () => {
    expect(skelClaw.damageDice).toBe(1);
    expect(skelClaw.damageDie).toBe("d4");
  });

  it("MAP uses agile table for NPC agile weapon", () => {
    const r2 = resolveStrikeAttack(skelClaw, 2, 10, 15);
    expect(r2.mapPenalty).toBe(-4);
  });
});

// ---------------------------------------------------------------------------
// 10. Condition manager
// REQ-PF2-050..054
// ---------------------------------------------------------------------------

describe("Condition Manager — applyCondition", () => {
  const emptyConditions: ConditionItem[] = [];
  const noIwr: ActorIwrBlock = { immunities: [], weaknesses: [], resistances: [] };

  it("adds a new non-valued condition", () => {
    const r = applyCondition(emptyConditions, "off-guard", null, noIwr);
    expect(r.conditions).toHaveLength(1);
    expect(r.conditions[0]!.system.slug).toBe("off-guard");
    expect(r.log[0]?.action).toBe("added");
  });

  it("does not add a duplicate non-valued condition", () => {
    const existing: ConditionItem[] = [
      { _id: "c1", name: "Off-Guard", type: "Item", system: { slug: "off-guard" } },
    ];
    const r = applyCondition(existing, "off-guard", null, noIwr);
    expect(r.conditions).toHaveLength(1);
    expect(r.log[0]?.action).toBe("blocked");
  });

  it("adds valued condition with value", () => {
    const r = applyCondition(emptyConditions, "frightened", 2, noIwr);
    expect(r.conditions[0]!.system.value).toBe(2);
    expect(r.log[0]?.action).toBe("added");
  });

  it("REQ-PF2-054: valued condition keeps the higher value", () => {
    const existing: ConditionItem[] = [
      { _id: "c1", name: "Frightened", type: "Item", system: { slug: "frightened", value: 3 } },
    ];
    const r = applyCondition(existing, "frightened", 2, noIwr);
    // 3 > 2 → blocked (current higher)
    expect(r.conditions[0]!.system.value).toBe(3);
    expect(r.log[0]?.action).toBe("blocked");
  });

  it("REQ-PF2-054: higher value replaces lower", () => {
    const existing: ConditionItem[] = [
      { _id: "c1", name: "Frightened", type: "Item", system: { slug: "frightened", value: 1 } },
    ];
    const r = applyCondition(existing, "frightened", 3, noIwr);
    expect(r.conditions[0]!.system.value).toBe(3);
    expect(r.log[0]?.action).toBe("updated");
  });

  it("REQ-PF2-053: condition blocked by immunity", () => {
    const iwrWithImmunity: ActorIwrBlock = {
      immunities: [{ type: "frightened" }],
      weaknesses: [],
      resistances: [],
    };
    const r = applyCondition(emptyConditions, "frightened", 2, iwrWithImmunity);
    expect(r.conditions).toHaveLength(0);
    expect(r.log[0]?.action).toBe("blocked");
    expect(r.log[0]?.reason).toBe("immunity");
  });
});

describe("Condition Manager — toggleCondition", () => {
  it("applies condition when absent", () => {
    const r = toggleCondition([], "off-guard", null, null);
    expect(r.conditions).toHaveLength(1);
  });

  it("removes condition when present", () => {
    const existing: ConditionItem[] = [
      { _id: "c1", name: "Off-Guard", type: "Item", system: { slug: "off-guard" } },
    ];
    const r = toggleCondition(existing, "off-guard");
    expect(r.conditions).toHaveLength(0);
    expect(r.log[0]?.action).toBe("removed");
  });
});

describe("Condition Manager — increaseCondition / decreaseCondition", () => {
  it("increaseCondition on new condition starts at 1", () => {
    const r = increaseCondition([], "frightened");
    expect(r.conditions[0]!.system.value).toBe(1);
  });

  it("increaseCondition on existing adds 1", () => {
    const existing: ConditionItem[] = [
      { _id: "c1", name: "Frightened", type: "Item", system: { slug: "frightened", value: 2 } },
    ];
    const r = increaseCondition(existing, "frightened");
    expect(r.conditions[0]!.system.value).toBe(3);
  });

  it("decreaseCondition removes condition at value 1", () => {
    const existing: ConditionItem[] = [
      { _id: "c1", name: "Frightened", type: "Item", system: { slug: "frightened", value: 1 } },
    ];
    const r = decreaseCondition(existing, "frightened");
    expect(r.conditions).toHaveLength(0);
    expect(r.log[0]?.action).toBe("removed");
  });

  it("decreaseCondition decrements value when > 1", () => {
    const existing: ConditionItem[] = [
      { _id: "c1", name: "Frightened", type: "Item", system: { slug: "frightened", value: 3 } },
    ];
    const r = decreaseCondition(existing, "frightened");
    expect(r.conditions[0]!.system.value).toBe(2);
    expect(r.log[0]?.action).toBe("updated");
  });
});

describe("Condition Manager — setCondition", () => {
  it("sets condition value to exact number", () => {
    const r = setCondition([], "clumsy", 2, null);
    expect(r.conditions[0]!.system.value).toBe(2);
  });

  it("removes condition when value <= 0", () => {
    const existing: ConditionItem[] = [
      { _id: "c1", name: "Clumsy", type: "Item", system: { slug: "clumsy", value: 2 } },
    ];
    const r = setCondition(existing, "clumsy", 0, null);
    expect(r.conditions).toHaveLength(0);
  });
});

describe("Condition Manager — isImmuneToCondition", () => {
  it("returns true when specific immunity exists", () => {
    const iwr: ActorIwrBlock = {
      immunities: [{ type: "frightened" }],
      weaknesses: [],
      resistances: [],
    };
    expect(isImmuneToCondition("frightened", iwr)).toBe(true);
  });

  it("returns false when no immunity", () => {
    const iwr: ActorIwrBlock = { immunities: [], weaknesses: [], resistances: [] };
    expect(isImmuneToCondition("frightened", iwr)).toBe(false);
  });
});

describe("resolveConditionModifierValue", () => {
  it("multiplies placeholder -1 by condition value", () => {
    expect(resolveConditionModifierValue(2, -1)).toBe(-2);
    expect(resolveConditionModifierValue(3, -1)).toBe(-3);
  });

  it("returns static value when not -1", () => {
    expect(resolveConditionModifierValue(3, -2)).toBe(-2);
  });
});

// ---------------------------------------------------------------------------
// 11. Basic saving throw damage scaling
// REQ-PF2-041
// ---------------------------------------------------------------------------

describe("scaleBasicSaveDamage", () => {
  it("CriticalSuccess → 0 damage", () => {
    expect(scaleBasicSaveDamage(20, "CriticalSuccess")).toBe(0);
  });

  it("Success → half damage (floor)", () => {
    expect(scaleBasicSaveDamage(20, "Success")).toBe(10);
    expect(scaleBasicSaveDamage(7, "Success")).toBe(3); // floor(7/2) = 3
  });

  it("Failure → full damage", () => {
    expect(scaleBasicSaveDamage(20, "Failure")).toBe(20);
  });

  it("CriticalFailure → double damage", () => {
    expect(scaleBasicSaveDamage(20, "CriticalFailure")).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 12. Apply damage pipeline
// REQ-PF2-022, REQ-PF2-023, REQ-PF2-060
// ---------------------------------------------------------------------------

describe("applyDamagePipeline", () => {
  const fullHp: TargetHpState = { value: 30, max: 30, temp: 0 };
  const withTempHp: TargetHpState = { value: 30, max: 30, temp: 10 };
  const _noIwr: IwrSet = { immunities: [], weaknesses: [], resistances: [] };

  it("reduces HP by damage amount", () => {
    const r = applyDamagePipeline([{ amount: 10, type: "slashing" }], fullHp, null);
    expect(r.newHp).toBe(20);
    expect(r.hpDamage).toBe(10);
  });

  it("temp HP absorbs damage first (REQ-PF2-022)", () => {
    const r = applyDamagePipeline([{ amount: 15, type: "fire" }], withTempHp, null);
    expect(r.newTempHp).toBe(0); // all temp HP consumed
    expect(r.newHp).toBe(25); // 30 - (15 - 10) = 25
    expect(r.hpDamage).toBe(5);
  });

  it("temp HP fully absorbs small damage", () => {
    const r = applyDamagePipeline([{ amount: 5, type: "fire" }], withTempHp, null);
    expect(r.newTempHp).toBe(5); // 10 - 5 = 5 temp remaining
    expect(r.newHp).toBe(30); // HP unchanged
    expect(r.hpDamage).toBe(0);
  });

  it("droppedToZero is true when HP reaches 0", () => {
    const r = applyDamagePipeline([{ amount: 30, type: "slashing" }], fullHp, null);
    expect(r.droppedToZero).toBe(true);
    expect(r.newHp).toBe(0);
  });

  it("IWR immunity: damage reduced to 0", () => {
    const iwrFire: IwrSet = {
      immunities: [{ target: "fire" }],
      weaknesses: [],
      resistances: [],
    };
    const r = applyDamagePipeline([{ amount: 20, type: "fire" }], fullHp, iwrFire);
    expect(r.newHp).toBe(30); // no damage
    expect(r.finalDamagePre).toBe(0);
  });

  it("hardness reduces damage before HP (REQ-PF2-023)", () => {
    const r = applyDamagePipeline([{ amount: 10, type: "slashing" }], fullHp, null, 5);
    // 10 - 5 hardness = 5 damage to HP
    expect(r.newHp).toBe(25);
    expect(r.hpDamage).toBe(5);
  });

  it("weakness increases damage", () => {
    const iwrWeakness: IwrSet = {
      immunities: [],
      weaknesses: [{ target: "fire", value: 5 }],
      resistances: [],
    };
    const r = applyDamagePipeline([{ amount: 10, type: "fire" }], fullHp, iwrWeakness);
    // 10 + 5 weakness = 15 damage
    expect(r.newHp).toBe(15);
    expect(r.finalDamagePre).toBe(15);
  });
});

describe("applyHealing", () => {
  it("increases HP up to max", () => {
    const target: TargetHpState = { value: 10, max: 30, temp: 0 };
    const r = applyHealing(target, 15);
    expect(r.newHp).toBe(25);
    expect(r.actualHealing).toBe(15);
  });

  it("caps healing at max HP", () => {
    const target: TargetHpState = { value: 28, max: 30, temp: 0 };
    const r = applyHealing(target, 10);
    expect(r.newHp).toBe(30);
    expect(r.actualHealing).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 13. Strike chat card payload
// REQ-PF2-100
// ---------------------------------------------------------------------------

describe("buildStrikeChatCard", () => {
  const strike = deriveStrikeFromWeapon("w-ls", "Longsword", LONGSWORD, FIGHTER_5);

  const card = buildStrikeChatCard("actor-123", "Fighter", strike);

  it("cardType is pf2e.strike", () => {
    expect(card.cardType).toBe("pf2e.strike");
  });

  it("attackBonus matches first attack", () => {
    expect(card.attackBonus).toBe(strike.attackBonus);
  });

  it("attackBonus2 is MAP 2 bonus (standard -5)", () => {
    expect(card.attackBonus2).toBe(strike.attackBonus - 5);
  });

  it("attackBonus3 is MAP 3 bonus (standard -10)", () => {
    expect(card.attackBonus3).toBe(strike.attackBonus - 10);
  });
});

// ---------------------------------------------------------------------------
// 14. Initiative formula (REQ-PF2-090..091)
// ---------------------------------------------------------------------------

describe("pf2e initiative formula via system module", () => {
  const fn = pf2eSystem.combat.initiativeFormulas.get("pf2e")!;

  it("uses 1d20 + perception total for default initiative", () => {
    const actor = { system: { derived: { perception: { total: 7 } } } };
    const result = fn({} as never, actor as Record<string, unknown>);
    if (result && !(result instanceof Promise)) {
      expect(result.formula).toBe("1d20 + 7");
      expect(result.tiebreaker).toBe(7);
      expect(result.statistic).toBe("Perception");
    }
  });

  it("uses 1d20 + stealth for Avoid Notice (REQ-PF2-091)", () => {
    const actor = { system: { derived: { skills: { stealth: { total: 10 } } } } };
    const result = fn({} as never, actor as Record<string, unknown>, { skill: "stealth" });
    if (result && !(result instanceof Promise)) {
      expect(result.formula).toBe("1d20 + 10");
      expect(result.statistic).toBe("Stealth");
    }
  });

  it("falls back to 1d20 when actor is null", () => {
    const result = fn({} as never, null);
    if (result && !(result instanceof Promise)) {
      expect(result.formula).toBe("1d20");
    }
  });
});

// ---------------------------------------------------------------------------
// 15. System module registers chat cards
// REQ-SYS-046
// ---------------------------------------------------------------------------

describe("pf2e chat card registrations", () => {
  it("registers pf2e.strike card type", () => {
    expect(pf2eSystem.registries.chatCards.has("pf2e.strike")).toBe(true);
  });

  it("registers pf2e.damage card type", () => {
    expect(pf2eSystem.registries.chatCards.has("pf2e.damage")).toBe(true);
  });

  it("registers pf2e.check card type", () => {
    expect(pf2eSystem.registries.chatCards.has("pf2e.check")).toBe(true);
  });
});
