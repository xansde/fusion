/**
 * @fusion/system-sf2e — Strike actions tests.
 *
 * Mirrors `systems/pf2e/src/__tests__/actions-strikes.test.ts`'s structure
 * (REQ-SF2-004: MAP/degree-of-success/IWR math is IDENTICAL — every one of
 * these tests calls the SAME engine-2e functions PF2e's tests call:
 * `calculateMapPenalty`, `applyIwrMultiple` via `computeStrikeDamage`).
 * The SF2e-specific coverage is the Tech-weapon delta:
 *
 *   1. MAP (standard and agile) — engine-2e, inherited.
 *   2. Strike derivation for an Analog weapon (Combat Knife, agile/finesse,
 *      potency rune) — same math path as PF2e.
 *   3. Strike derivation for a Tech weapon (Arc Rifle) — item bonus from
 *      `weapon.bonus` instead of potency rune, damage dice straight from
 *      `weapon.damage.dice` (REQ-SF2-018).
 *   4. Ammo/charge gating: `resolveAmmoState` + `consumeCharge`
 *      (REQ-SF2-020).
 *   5. SF traits parsed onto the descriptor: `tracking-X` folds into attack
 *      bonus, `automatic`/`area-X` surfaced as flags/size (REQ-SF2-019).
 *   6. Damage with weakness/resistance/immunity in target IWR (engine-2e).
 *   7. Condition manager: apply/toggle/immunity/decrease-to-0, using the
 *      SF2e-exclusive `glitching` (valued) and `suppressed` conditions
 *      (REQ-SF2-006, REQ-SF2-022 delta set).
 *   8. Basic save damage scaling (engine-2e, inherited).
 *   9. Apply damage pipeline (temp HP, IWR, hardness) — engine-2e, inherited.
 *  10. NPC melee strike derivation — engine-2e, inherited.
 *
 * REQ-SF2-004, REQ-SF2-006, REQ-SF2-018..022.
 */

import { describe, it, expect } from "vitest";
import {
  deriveStrikeFromWeapon,
  deriveStrikeFromMeleeItem,
  resolveStrikeAttack,
  computeStrikeDamage,
  resolveAmmoState,
  consumeCharge,
  buildStrikeChatCard,
} from "../actions/strikes.js";
import {
  applyCondition,
  toggleCondition,
  increaseCondition,
  decreaseCondition,
  isImmuneToCondition,
} from "../actions/conditions-manager.js";
import { applyDamagePipeline, scaleBasicSaveDamage, applyHealing } from "../actions/damage.js";
import { calculateMapPenalty } from "@fusion/engine-2e";
import type { WeaponSystem } from "../schemas/item-weapon.js";
import type { CharacterSystem } from "../schemas/actor-character.js";
import type { IwrSet } from "@fusion/engine-2e";
import type { ConditionItem, ActorIwrBlock } from "../actions/conditions-manager.js";
import type { TargetHpState } from "../actions/damage.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** An Operative at level 5, STR 12 (+1), DEX 18 (+4), WIS 10 (+0). */
const OPERATIVE_5: CharacterSystem = {
  systemVersion: "0.1.0",
  level: { value: 5 },
  abilities: {
    str: { value: 12, mod: 1 },
    dex: { value: 18, mod: 4 },
    con: { value: 14, mod: 2 },
    int: { value: 12, mod: 1 },
    wis: { value: 10, mod: 0 },
    cha: { value: 10, mod: 0 },
  },
  attributes: {
    hp: { value: 68, max: 68, temp: 0 },
    ac: { value: 23 },
    speed: { value: 30, otherSpeeds: [] },
    dying: { value: 0, max: 4 },
    wounded: { value: 0 },
    doomed: { value: 0 },
    iwr: { immunities: [], weaknesses: [], resistances: [] },
  },
  saves: { fortitude: { rank: 1 }, reflex: { rank: 2 }, will: { rank: 1 } },
  perception: { rank: 2, senses: [] },
  skills: {
    acrobatics: { rank: 1 },
    arcana: { rank: 0 },
    athletics: { rank: 0 },
    computers: { rank: 2 },
    crafting: { rank: 0 },
    deception: { rank: 0 },
    diplomacy: { rank: 0 },
    intimidation: { rank: 0 },
    medicine: { rank: 0 },
    nature: { rank: 0 },
    occultism: { rank: 0 },
    performance: { rank: 0 },
    piloting: { rank: 1 },
    religion: { rank: 0 },
    society: { rank: 0 },
    stealth: { rank: 2 },
    survival: { rank: 0 },
    thievery: { rank: 0 },
  },
  proficiencies: {
    classDC: { rank: 2 },
    weapons: { unarmed: 1, simple: 2, martial: 0, advanced: 0 },
    armor: { unarmored: 1, light: 1, medium: 0, heavy: 0 },
  },
  resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
  currency: { credits: 250 },
  augmentations: { installed: [], apexCount: 0, regularCount: 0 },
  details: { keyAbility: "dex", class: "Operative", level: 5 },
  traits: { rarity: "common", value: [], size: "med" },
};

/** Combat Knife — Analog, simple, 1d4 piercing, agile + finesse, +1 potency rune. */
const COMBAT_KNIFE: WeaponSystem = {
  systemVersion: "0.1.0",
  damage: { dice: 1, die: "d4", damageType: "piercing", modifier: 0 },
  category: "simple",
  weaponGroup: "knife",
  runes: { potency: 1, striking: 0, property: [] },
  range: null,
  reload: "-",
  bulk: 0,
  price: { sp: 20 },
  quantity: 1,
  level: 0,
  usage: "held-in-one-hand",
  size: "med",
  traits: { rarity: "common", value: ["agile", "finesse"] },
  bonus: 0,
  bonusDamage: 0,
  rules: [],
};

/** Arc Rifle — Tech weapon, simple, 1d6 electricity, battery capacity 1, expend 2. */
const ARC_RIFLE: WeaponSystem = {
  systemVersion: "0.1.0",
  damage: { dice: 1, die: "d6", damageType: "electricity", modifier: 0 },
  category: "simple",
  weaponGroup: "shock",
  runes: { potency: 0, striking: 0, property: [] },
  grade: "commercial",
  ammo: { baseType: "battery", builtIn: false, capacity: 1 },
  charges: { current: 1, max: 1 },
  expend: 2,
  range: 50,
  reload: "1",
  bulk: 2,
  price: { sp: 50 },
  quantity: 1,
  level: 0,
  usage: "held-in-two-hands",
  size: "med",
  traits: { rarity: "common", value: ["arc", "tech"] },
  bonus: 0,
  bonusDamage: 0,
  rules: [],
};

/** Tracking rifle — Tech weapon with the `tracking-2` trait (REQ-SF2-019). */
const TRACKING_RIFLE: WeaponSystem = {
  ...ARC_RIFLE,
  charges: { current: 4, max: 4 },
  traits: { rarity: "common", value: ["tech", "tracking-2"] },
};

// ---------------------------------------------------------------------------
// 1. MAP — standard and agile (engine-2e, inherited)
// ---------------------------------------------------------------------------

describe("Multiple Attack Penalty (MAP) — REQ-SF2-004", () => {
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
});

// ---------------------------------------------------------------------------
// 2. Strike derivation — Analog weapon (Combat Knife)
// ---------------------------------------------------------------------------

describe("deriveStrikeFromWeapon — Combat Knife (Analog, REQ-SF2-021)", () => {
  const strike = deriveStrikeFromWeapon("w-knife", "Combat Knife", COMBAT_KNIFE, OPERATIVE_5);

  it("label matches weapon name", () => {
    expect(strike.label).toBe("Combat Knife");
  });

  it("is melee, agile, finesse, not tech", () => {
    expect(strike.melee).toBe(true);
    expect(strike.isAgile).toBe(true);
    expect(strike.isFinesse).toBe(true);
    expect(strike.isTech).toBe(false);
  });

  it("attack ability is DEX (finesse, dexMod 4 > strMod 1)", () => {
    expect(strike.attackAbility).toBe("dex");
  });

  it("attack bonus = DEX(4) + proficiency(simple Expert 2 → 9) + potency(1) = 14", () => {
    expect(strike.attackBonus).toBe(14);
  });

  it("uses the potency rune as item bonus (not weapon.bonus)", () => {
    const attackModSlugs = strike.attackModifiers.map((m) => m.slug);
    expect(attackModSlugs).toContain("potency-rune");
    expect(attackModSlugs).not.toContain("tech-grade-bonus");
  });

  it("is always ammoOk (no ammo block)", () => {
    expect(strike.ammoOk).toBe(true);
    expect(strike.expend).toBe(0);
    expect(strike.charges).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Strike derivation — Tech weapon (Arc Rifle, REQ-SF2-018)
// ---------------------------------------------------------------------------

describe("deriveStrikeFromWeapon — Arc Rifle (Tech, REQ-SF2-018..020)", () => {
  const strike = deriveStrikeFromWeapon("w-arc-rifle", "Arc Rifle", ARC_RIFLE, OPERATIVE_5);

  it("is ranged, tech, not agile", () => {
    expect(strike.melee).toBe(false);
    expect(strike.isTech).toBe(true);
    expect(strike.isAgile).toBe(false);
  });

  it("attack ability is DEX (ranged)", () => {
    expect(strike.attackAbility).toBe("dex");
  });

  it("attack bonus = DEX(4) + proficiency(simple Expert 2 → 9) + item bonus(0) = 13", () => {
    expect(strike.attackBonus).toBe(13);
  });

  it("uses weapon.bonus as item bonus (not the potency rune)", () => {
    const attackModSlugs = strike.attackModifiers.map((m) => m.slug);
    expect(attackModSlugs).not.toContain("potency-rune");
    // bonus is 0 on this fixture, so no positive item-bonus entry is added —
    // verified indirectly via the attack bonus total above.
  });

  it("damage dice come straight from weapon.damage.dice (no striking-rune lookup)", () => {
    expect(strike.damageDice).toBe(1); // 1d6, no extra dice from runes
    expect(strike.damageDie).toBe("d6");
    expect(strike.damageType).toBe("electricity");
  });

  it("ranged weapon has damageAbilityMod 0 (no propulsive/thrown)", () => {
    expect(strike.damageAbilityMod).toBe(0);
  });

  it("has 1/1 charge, expends 2 per shot → ammoOk false (REQ-SF2-020)", () => {
    expect(strike.ammoOk).toBe(false);
    expect(strike.expend).toBe(2);
    expect(strike.charges).toEqual({ current: 1, max: 1 });
  });
});

describe("Arc Rifle with a higher-grade item bonus (weapon.bonus > 0)", () => {
  it("folds weapon.bonus into the attack total as an item bonus", () => {
    const upgradedRifle: WeaponSystem = { ...ARC_RIFLE, bonus: 2 };
    const strike = deriveStrikeFromWeapon(
      "w-arc-rifle-2",
      "Arc Rifle +2",
      upgradedRifle,
      OPERATIVE_5,
    );
    // 4 (DEX) + 9 (proficiency) + 2 (item bonus) = 15
    expect(strike.attackBonus).toBe(15);
    const itemMod = strike.attackModifiers.find((m) => m.slug === "tech-grade-bonus");
    expect(itemMod).toBeDefined();
    expect(itemMod?.value).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Ammo / charge gating helpers (REQ-SF2-020)
// ---------------------------------------------------------------------------

describe("resolveAmmoState / consumeCharge — REQ-SF2-020", () => {
  it("Analog weapon (no charges block) is always ammoOk with expend 0", () => {
    const state = resolveAmmoState(COMBAT_KNIFE);
    expect(state.ammoOk).toBe(true);
    expect(state.expend).toBe(0);
    expect(state.charges).toBeUndefined();
  });

  it("Tech weapon with insufficient charges is not ammoOk", () => {
    const state = resolveAmmoState(ARC_RIFLE);
    expect(state.ammoOk).toBe(false); // 1 charge, expend 2
  });

  it("Tech weapon with sufficient charges is ammoOk", () => {
    const fullRifle: WeaponSystem = { ...ARC_RIFLE, charges: { current: 2, max: 2 } };
    const state = resolveAmmoState(fullRifle);
    expect(state.ammoOk).toBe(true);
  });

  it("consumeCharge decrements current by expend, clamped at 0", () => {
    const after = consumeCharge({ current: 2, max: 2 }, 2);
    expect(after).toEqual({ current: 0, max: 2 });
  });

  it("consumeCharge clamps at 0 (cannot go negative)", () => {
    const after = consumeCharge({ current: 1, max: 2 }, 2);
    expect(after).toEqual({ current: 0, max: 2 });
  });

  it("consumeCharge is a no-op (undefined) when the weapon has no charges", () => {
    expect(consumeCharge(undefined, 1)).toBeUndefined();
  });

  it("firing sequence: full battery → 2 shots exhausts it (expend 2, capacity 4)", () => {
    let charges = { current: 4, max: 4 };
    charges = consumeCharge(charges, 2)!;
    expect(charges.current).toBe(2);
    let state = resolveAmmoState({ charges, expend: 2 });
    expect(state.ammoOk).toBe(true);

    charges = consumeCharge(charges, 2)!;
    expect(charges.current).toBe(0);
    state = resolveAmmoState({ charges, expend: 2 });
    expect(state.ammoOk).toBe(false); // out of charges
  });
});

// ---------------------------------------------------------------------------
// 5. SF traits: tracking / automatic / area (REQ-SF2-019)
// ---------------------------------------------------------------------------

describe("SF2e-exclusive traits — REQ-SF2-019", () => {
  it("tracking-2 folds a +2 item bonus into the attack total", () => {
    const strike = deriveStrikeFromWeapon(
      "w-tracking",
      "Tracking Rifle",
      TRACKING_RIFLE,
      OPERATIVE_5,
    );
    // 4 (DEX) + 9 (proficiency) + 0 (item bonus) + 2 (tracking) = 15
    expect(strike.attackBonus).toBe(15);
    expect(strike.sfTrackingBonus).toBe(2);
    const trackingMod = strike.attackModifiers.find((m) => m.slug === "sf-tracking");
    expect(trackingMod?.value).toBe(2);
  });

  it("automatic trait is surfaced as a flag (roll-shape hook, [V2])", () => {
    const autoWeapon: WeaponSystem = {
      ...ARC_RIFLE,
      traits: { rarity: "common", value: ["tech", "automatic"] },
    };
    const strike = deriveStrikeFromWeapon("w-auto", "Machine Gun", autoWeapon, OPERATIVE_5);
    expect(strike.sfAutomatic).toBe(true);
  });

  it("area-15 trait is parsed into sfAreaSize (roll-shape hook, [V2])", () => {
    const areaWeapon: WeaponSystem = {
      ...ARC_RIFLE,
      traits: { rarity: "common", value: ["tech", "area-15"] },
    };
    const strike = deriveStrikeFromWeapon("w-area", "Flamethrower", areaWeapon, OPERATIVE_5);
    expect(strike.sfAreaSize).toBe(15);
  });

  it("weapon without SF traits has undefined sfAreaSize/sfTrackingBonus", () => {
    const strike = deriveStrikeFromWeapon("w-arc", "Arc Rifle", ARC_RIFLE, OPERATIVE_5);
    expect(strike.sfAreaSize).toBeUndefined();
    expect(strike.sfTrackingBonus).toBeUndefined();
    expect(strike.sfAutomatic).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. resolveStrikeAttack — degree of success (engine-2e, inherited)
// ---------------------------------------------------------------------------

describe("resolveStrikeAttack", () => {
  const strike = deriveStrikeFromWeapon("w-arc", "Arc Rifle", ARC_RIFLE, OPERATIVE_5);

  it("computes total = die + attackBonus + MAP", () => {
    const result = resolveStrikeAttack(strike, 1, 15);
    expect(result.total).toBe(15 + strike.attackBonus);
    expect(result.mapPenalty).toBe(0);
  });

  it("applies MAP on the 2nd attack", () => {
    const result = resolveStrikeAttack(strike, 2, 15);
    expect(result.mapPenalty).toBe(-5);
    expect(result.totalBonus).toBe(strike.attackBonus - 5);
  });

  it("computes degree of success against target AC", () => {
    const result = resolveStrikeAttack(strike, 1, 15, 20);
    expect(result.degree).toBeDefined();
    expect(result.targetAc).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 7. computeStrikeDamage — critical hit + IWR (engine-2e, inherited)
// ---------------------------------------------------------------------------

describe("computeStrikeDamage", () => {
  const rifleStrike = deriveStrikeFromWeapon("w-arc", "Arc Rifle", ARC_RIFLE, OPERATIVE_5);

  it("normal hit: dice only (no ability mod for standard ranged)", () => {
    const r = computeStrikeDamage(rifleStrike, 4, false);
    expect(r.baseTotal).toBe(4); // damageAbilityMod 0, no flat modifiers
    expect(r.doubledTotal).toBe(4);
    expect(r.finalDamage).toBe(4);
  });

  it("critical hit doubles total damage", () => {
    const r = computeStrikeDamage(rifleStrike, 4, true);
    expect(r.doubledTotal).toBe(8);
    expect(r.finalDamage).toBe(8);
    expect(r.isCritical).toBe(true);
  });

  it("weakness applies to matching damage type", () => {
    const targetIwr: IwrSet = {
      immunities: [],
      weaknesses: [{ target: "electricity", value: 5 }],
      resistances: [],
    };
    const r = computeStrikeDamage(rifleStrike, 4, false, targetIwr);
    expect(r.finalDamage).toBe(9); // 4 + 5
  });

  it("resistance reduces damage (min 0)", () => {
    const targetIwr: IwrSet = {
      immunities: [],
      weaknesses: [],
      resistances: [{ target: "electricity", value: 10 }],
    };
    const r = computeStrikeDamage(rifleStrike, 4, false, targetIwr);
    expect(r.finalDamage).toBe(0);
  });

  it("immunity negates all damage of that type", () => {
    const targetIwr: IwrSet = {
      immunities: [{ target: "electricity" }],
      weaknesses: [],
      resistances: [],
    };
    const r = computeStrikeDamage(rifleStrike, 8, false, targetIwr);
    expect(r.finalDamage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Condition manager — SF2e-exclusive conditions (REQ-SF2-006, REQ-SF2-022)
// ---------------------------------------------------------------------------

describe("Condition manager — glitching (valued, delta condition)", () => {
  it("applies glitching with a numeric badge value", () => {
    const result = applyCondition([], "glitching", 2, null);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0]?.system.value).toBe(2);
    expect(result.log[0]?.action).toBe("added");
  });

  it("increaseCondition bumps the badge by 1", () => {
    const withGlitch: ConditionItem[] = [
      { _id: "c1", name: "Glitching", type: "Item", system: { slug: "glitching", value: 1 } },
    ];
    const result = increaseCondition(withGlitch, "glitching");
    expect(result.conditions[0]?.system.value).toBe(2);
  });

  it("decreaseCondition to 0 removes the condition", () => {
    const withGlitch: ConditionItem[] = [
      { _id: "c1", name: "Glitching", type: "Item", system: { slug: "glitching", value: 1 } },
    ];
    const result = decreaseCondition(withGlitch, "glitching");
    expect(result.conditions).toHaveLength(0);
    expect(result.log[0]?.action).toBe("removed");
  });

  it("valued condition keeps the higher value when reapplied lower", () => {
    const withGlitch: ConditionItem[] = [
      { _id: "c1", name: "Glitching", type: "Item", system: { slug: "glitching", value: 3 } },
    ];
    const result = applyCondition(withGlitch, "glitching", 1, null);
    expect(result.conditions[0]?.system.value).toBe(3);
    expect(result.log[0]?.action).toBe("blocked");
  });
});

describe("Condition manager — suppressed (non-valued, delta condition)", () => {
  it("toggleCondition applies suppressed if not present", () => {
    const result = toggleCondition([], "suppressed");
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0]?.system.slug).toBe("suppressed");
  });

  it("toggleCondition removes suppressed if already present", () => {
    const withSuppressed: ConditionItem[] = [
      { _id: "c1", name: "Suppressed", type: "Item", system: { slug: "suppressed" } },
    ];
    const result = toggleCondition(withSuppressed, "suppressed");
    expect(result.conditions).toHaveLength(0);
  });

  it("immunity blocks applying suppressed", () => {
    const iwr: ActorIwrBlock = {
      immunities: [{ type: "suppressed" }],
      weaknesses: [],
      resistances: [],
    };
    expect(isImmuneToCondition("suppressed", iwr)).toBe(true);
    const result = applyCondition([], "suppressed", null, iwr);
    expect(result.conditions).toHaveLength(0);
    expect(result.log[0]?.action).toBe("blocked");
    expect(result.log[0]?.reason).toBe("immunity");
  });
});

// ---------------------------------------------------------------------------
// 9. Basic save damage scaling (engine-2e, inherited)
// ---------------------------------------------------------------------------

describe("scaleBasicSaveDamage", () => {
  it("CriticalSuccess → 0 damage", () => {
    expect(scaleBasicSaveDamage(20, "CriticalSuccess")).toBe(0);
  });
  it("Success → half damage (rounded down)", () => {
    expect(scaleBasicSaveDamage(21, "Success")).toBe(10);
  });
  it("Failure → full damage", () => {
    expect(scaleBasicSaveDamage(20, "Failure")).toBe(20);
  });
  it("CriticalFailure → double damage", () => {
    expect(scaleBasicSaveDamage(20, "CriticalFailure")).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 10. Apply damage pipeline (temp HP, IWR, hardness) — engine-2e, inherited.
// ---------------------------------------------------------------------------

describe("applyDamagePipeline", () => {
  it("consumes temp HP before HP", () => {
    const target: TargetHpState = { value: 20, max: 20, temp: 5 };
    const result = applyDamagePipeline([{ amount: 8, type: "electricity" }], target, null);
    expect(result.newTempHp).toBe(0);
    expect(result.hpDamage).toBe(3);
    expect(result.newHp).toBe(17);
  });

  it("applies hardness reduction before HP", () => {
    const target: TargetHpState = { value: 20, max: 20, temp: 0 };
    const result = applyDamagePipeline([{ amount: 10, type: "physical" }], target, null, 4);
    expect(result.hpDamage).toBe(6);
  });

  it("drops to zero when damage exceeds HP", () => {
    const target: TargetHpState = { value: 5, max: 20, temp: 0 };
    const result = applyDamagePipeline([{ amount: 10, type: "physical" }], target, null);
    expect(result.newHp).toBe(0);
    expect(result.droppedToZero).toBe(true);
  });
});

describe("applyHealing", () => {
  it("caps at max HP", () => {
    const target: TargetHpState = { value: 15, max: 20, temp: 0 };
    const result = applyHealing(target, 10);
    expect(result.newHp).toBe(20);
    expect(result.actualHealing).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// NPC melee strike derivation (engine-2e, inherited)
// ---------------------------------------------------------------------------

describe("deriveStrikeFromMeleeItem — NPC", () => {
  const strike = deriveStrikeFromMeleeItem("melee-claw", "Claw", 12, 2, "d6", "slashing", 5, [
    "agile",
  ]);

  it("uses the flat melee bonus directly", () => {
    expect(strike.attackBonus).toBe(12);
    expect(strike.isAgile).toBe(true);
  });

  it("is always ammoOk (NPCs are not ammo-gated)", () => {
    expect(strike.ammoOk).toBe(true);
  });

  it("chat card payload includes MAP variants and ammoOk", () => {
    const card = buildStrikeChatCard("actor-1", "Goblin", strike);
    expect(card.attackBonus).toBe(12);
    expect(card.attackBonus2).toBe(12 - 4); // agile MAP
    expect(card.attackBonus3).toBe(12 - 8);
    expect(card.ammoOk).toBe(true);
  });
});
