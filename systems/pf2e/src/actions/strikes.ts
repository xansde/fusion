/**
 * @fusion/system-pf2e — Strike derivation and resolution.
 *
 * Provides pure functions (no I/O) for:
 *   - Deriving Strike descriptors from a character's equipped weapons or an NPC's
 *     melee items.
 *   - Computing attack roll totals (with MAP + modifier stack).
 *   - Resolving degree-of-success on an attack result.
 *   - Computing damage totals (dice formula + striking rune extra dice + ability
 *     mod + modifier stack + crit doubling).
 *
 * The actual dice rolls happen on the server via RollService (authoritative RNG).
 * These functions produce the formulas and stat totals needed to parameterize
 * those rolls.
 *
 * Clean-room: spec 17 DEC-PF2-06; ORC/OGL game mechanics.
 * REQ-PF2-030..034, REQ-PF2-040..041.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import { calculateMapPenalty } from "@fusion/engine-2e";
import { resolveStacking } from "@fusion/engine-2e";
import { calculateDegreeOfSuccess, type DegreeOfSuccess } from "@fusion/engine-2e";
import { applyIwrMultiple, type IwrSet, type DamageInstance } from "@fusion/engine-2e";
import { calculateProficiencyBonus } from "@fusion/engine-2e";
import type { WeaponSystem } from "../schemas/item-weapon.js";
import { PF2E_STACKING_TABLE } from "../stacking.js";
import type { CharacterSystem } from "../schemas/actor-character.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A modifier used at roll-time by the strike resolver.
 * Simplified form — does not require DeferredModifier indirection because
 * strikes resolve statically (no target-context predicates at this level).
 */
export interface StrikeModifier {
  slug: string;
  label: string;
  type: string;
  value: number;
}

/**
 * A derived Strike descriptor — built from a weapon item + actor data.
 *
 * Represents one attack option (e.g., "Longsword", "Unarmed Strike").
 * The three MAP variants are NOT separate StrikeDescriptors; the caller
 * adds `calculateMapPenalty(attackNumber, isAgile)` to `attackBonus` at
 * roll time. See `resolveStrikeAttack`.
 *
 * REQ-PF2-030.
 */
export interface StrikeDescriptor {
  /** Weapon item slug or id. */
  readonly strikeId: string;
  /** Display name (weapon name). */
  readonly label: string;
  /** True for melee weapons; false for ranged. */
  readonly melee: boolean;
  /** True when the weapon has the `agile` trait (affects MAP). REQ-PF2-031 */
  readonly isAgile: boolean;
  /** True when the weapon has the `finesse` trait (affects attack ability). */
  readonly isFinesse: boolean;
  /** True when the weapon has the `propulsive` trait (damage ability mod). */
  readonly isPropulsive: boolean;
  /** True when weapon is thrown (ranged weapon using STR for damage). */
  readonly isThrown: boolean;
  /**
   * Base attack bonus (without MAP).
   * = abilityMod + proficiencyBonus + potencyRune + other modifiers.
   * REQ-PF2-032.
   */
  readonly attackBonus: number;
  /** Attack ability used. REQ-PF2-032 */
  readonly attackAbility: "str" | "dex";
  /** Damage ability modifier value. REQ-PF2-033 */
  readonly damageAbilityMod: number;
  /** Weapon dice count (including striking rune bonus dice). REQ-PF2-033 */
  readonly damageDice: number;
  /** Die size string (e.g., "d8"). REQ-PF2-033 */
  readonly damageDie: string;
  /** Primary damage type. REQ-PF2-033 */
  readonly damageType: string;
  /** Static flat bonus to damage (potency, modifiers, etc.). */
  readonly damageBonus: number;
  /** Traits array (raw). */
  readonly traits: string[];
  /** `deadly d#` trait die (if any). REQ-PF2-034 */
  readonly deadlyDie?: string;
  /** `fatal d#` trait die (if any). REQ-PF2-034 */
  readonly fatalDie?: string;
  /** All modifiers contributing to the attack bonus, for display. */
  readonly attackModifiers: StrikeModifier[];
  /** All modifiers contributing to the damage bonus, for display. */
  readonly damageModifiers: StrikeModifier[];
}

/**
 * Result of resolving a Strike attack roll.
 *
 * Contains the total, the MAP-adjusted bonus, and the degree of success
 * when a DC (target AC) is provided.
 */
export interface StrikeAttackResult {
  /** 1-based attack number (1=first, 2=second, 3=third). */
  readonly attackNumber: number;
  /** The MAP penalty applied (0, -4/-5, -8/-10). */
  readonly mapPenalty: number;
  /** The full attack bonus (base + MAP). */
  readonly totalBonus: number;
  /** Raw d20 result (1-20). Required for natural 20/1 adjustments. */
  readonly dieNatural: number;
  /** die roll + totalBonus. */
  readonly total: number;
  /** Degree of success against targetAC (if provided). */
  readonly degree?: DegreeOfSuccess;
  /** The target AC used (if provided). */
  readonly targetAc?: number;
}

/**
 * Result of computing strike damage.
 */
export interface StrikeDamageResult {
  /** The dice roll string that was evaluated (e.g., "2d8"). */
  readonly diceFormula: string;
  /** The raw dice total (rolled by server). */
  readonly diceTotal: number;
  /** Flat bonus/penalty from ability mod + modifiers. */
  readonly flatBonus: number;
  /** Total before crit or IWR. */
  readonly baseTotal: number;
  /** Whether this is a critical hit (degree = CriticalSuccess). */
  readonly isCritical: boolean;
  /** Total after critical doubling. */
  readonly doubledTotal: number;
  /** Additional damage from deadly die (already doubled when crit). */
  readonly deadlyBonus: number;
  /** Damage type. */
  readonly damageType: string;
  /** Final damage after IWR (if target IWR was provided). */
  readonly finalDamage: number;
  /** IWR breakdown steps. */
  readonly breakdown: Array<{ type: string; finalDamage: number; note?: string }>;
}

// ---------------------------------------------------------------------------
// Derive Strikes from a character actor
// REQ-PF2-030..034
// ---------------------------------------------------------------------------

/**
 * Derive the attack ability for a weapon.
 *
 * REQ-PF2-032:
 *   - Melee: STR (or DEX if finesse and dexMod > strMod).
 *   - Ranged: DEX.
 */
export function resolveAttackAbility(
  weapon: WeaponSystem,
  strMod: number,
  dexMod: number,
): "str" | "dex" {
  const traits = weapon.traits?.value ?? [];
  const isRanged = weapon.range !== null && weapon.range !== undefined;
  if (isRanged) return "dex";
  const isFinesse = traits.includes("finesse");
  if (isFinesse && dexMod > strMod) return "dex";
  return "str";
}

/**
 * Derive the damage ability mod for a weapon.
 *
 * REQ-PF2-033:
 *   - Melee: STR mod.
 *   - Ranged (standard): 0.
 *   - Propulsive: max(0, floor(strMod / 2)) if strMod > 0 else strMod.
 *   - Thrown: STR mod.
 */
export function resolveDamageAbilityMod(weapon: WeaponSystem, strMod: number): number {
  const traits = weapon.traits?.value ?? [];
  const isRanged = weapon.range !== null && weapon.range !== undefined;
  if (!isRanged) return strMod; // melee: full STR
  const isThrown = traits.includes("thrown");
  if (isThrown) return strMod;
  const isPropulsive = traits.includes("propulsive");
  if (isPropulsive) return strMod > 0 ? Math.floor(strMod / 2) : strMod;
  return 0; // standard ranged: no ability mod to damage
}

/**
 * Compute striking rune extra dice count.
 *
 * striking = +1 die, greater striking = +2 die, major striking = +3 die.
 * REQ-PF2-033.
 */
export function strikingDiceBonus(strikingRune: number): number {
  return Math.min(Math.max(strikingRune, 0), 3); // striking: 0=none, 1=+1, 2=+2, 3=+3
}

/**
 * Extract a trait die string from the traits array.
 *
 * Returns the die size string (e.g., "d6") if trait is present, else undefined.
 * Looks for traits like "deadly-d6", "fatal-d8".
 */
function extractTraitDie(traits: string[], prefix: string): string | undefined {
  const trait = traits.find((t) => t.startsWith(prefix + "-d"));
  return trait ? trait.slice(prefix.length + 1) : undefined;
}

/**
 * Derive a StrikeDescriptor from a weapon item + character data.
 *
 * Extra modifiers from effects/conditions must be passed as `extraAttackMods`
 * and `extraDamageMods` (already resolved from the Synthetics at call time).
 *
 * REQ-PF2-030..034.
 */
export function deriveStrikeFromWeapon(
  weaponId: string,
  weaponName: string,
  weapon: WeaponSystem,
  charSystem: CharacterSystem,
  extraAttackMods: StrikeModifier[] = [],
  extraDamageMods: StrikeModifier[] = [],
): StrikeDescriptor {
  const level = charSystem.level?.value ?? charSystem.details?.level ?? 1;
  const abilities = charSystem.abilities;
  const strMod = abilities.str.mod ?? Math.floor((abilities.str.value - 10) / 2);
  const dexMod = abilities.dex.mod ?? Math.floor((abilities.dex.value - 10) / 2);

  const traits = weapon.traits?.value ?? [];
  const isAgile = traits.includes("agile");
  const isFinesse = traits.includes("finesse");
  const isPropulsive = traits.includes("propulsive");
  const isThrown = traits.includes("thrown");
  const isRanged = weapon.range !== null && weapon.range !== undefined;

  // Attack ability
  const attackAbility = resolveAttackAbility(weapon, strMod, dexMod);
  const attackAbilityMod = attackAbility === "str" ? strMod : dexMod;

  // Weapon category proficiency rank
  const weaponCategory = weapon.category;
  const proficiencies = charSystem.proficiencies?.weapons ?? {};
  const profRank: number = (proficiencies as Record<string, number>)[weaponCategory] ?? 0;
  const profBonus = calculateProficiencyBonus(profRank, level);

  // Potency rune item bonus
  const potencyBonus = weapon.runes?.potency ?? 0;

  // Build attack modifiers list
  const attackModifiers: StrikeModifier[] = [
    {
      slug: "ability",
      label: `${attackAbility.toUpperCase()} mod`,
      type: "ability",
      value: attackAbilityMod,
    },
    {
      slug: "proficiency",
      label: `Proficiency (${weaponCategory})`,
      type: "proficiency",
      value: profBonus,
    },
    ...(potencyBonus > 0
      ? [{ slug: "potency-rune", label: "Weapon Potency", type: "item", value: potencyBonus }]
      : []),
    ...extraAttackMods,
  ];

  const attackBonus = resolveStacking(
    attackModifiers.map((m) => ({ slug: m.slug, type: m.type, value: m.value })),
    PF2E_STACKING_TABLE,
  );

  // Damage ability mod
  const damageAbilityMod = resolveDamageAbilityMod(weapon, strMod);

  // Damage dice (weapon dice + striking rune bonus)
  const baseDice = weapon.damage.dice;
  const extraDice = strikingDiceBonus(weapon.runes?.striking ?? 0);
  const totalDamageDice = baseDice + extraDice;

  // Build damage modifiers
  const damageModifiers: StrikeModifier[] = [
    ...(damageAbilityMod !== 0
      ? [
          {
            slug: "damage-ability",
            label: `${isRanged ? "" : "STR "}mod`,
            type: "ability",
            value: damageAbilityMod,
          },
        ]
      : []),
    ...extraDamageMods,
  ];

  const damageBonus = resolveStacking(
    damageModifiers.map((m) => ({ slug: m.slug, type: m.type, value: m.value })),
    PF2E_STACKING_TABLE,
  );

  // Deadly/Fatal traits
  const deadlyDie = extractTraitDie(traits, "deadly");
  const fatalDie = extractTraitDie(traits, "fatal");

  const baseDescriptor = {
    strikeId: weaponId,
    label: weaponName,
    melee: !isRanged,
    isAgile,
    isFinesse,
    isPropulsive,
    isThrown,
    attackBonus,
    attackAbility,
    damageAbilityMod,
    damageDice: totalDamageDice,
    damageDie: weapon.damage.die,
    damageType: weapon.damage.damageType,
    damageBonus,
    traits,
    attackModifiers,
    damageModifiers,
  };
  return deadlyDie !== undefined && fatalDie !== undefined
    ? { ...baseDescriptor, deadlyDie, fatalDie }
    : deadlyDie !== undefined
      ? { ...baseDescriptor, deadlyDie }
      : fatalDie !== undefined
        ? { ...baseDescriptor, fatalDie }
        : baseDescriptor;
}

// ---------------------------------------------------------------------------
// Resolve a strike attack roll
// REQ-PF2-031..032, REQ-PF2-040
// ---------------------------------------------------------------------------

/**
 * Resolve a strike attack from a pre-rolled d20 result.
 *
 * This is called on the SERVER after RollService executes the d20 roll.
 * The server has the authoritative dieNatural value.
 *
 * REQ-PF2-031: three MAP variants.
 * REQ-PF2-040: degree of success with nat20/nat1 adjustment.
 *
 * @param strike       - The derived strike descriptor.
 * @param attackNumber - 1-based (1=first, 2=second, etc.).
 * @param dieNatural   - Raw d20 face (1–20).
 * @param targetAc     - Target's AC (optional); if provided, degree is computed.
 */
export function resolveStrikeAttack(
  strike: StrikeDescriptor,
  attackNumber: number,
  dieNatural: number,
  targetAc?: number,
): StrikeAttackResult {
  const mapPenalty = calculateMapPenalty(attackNumber, strike.isAgile);
  const totalBonus = strike.attackBonus + mapPenalty;
  const total = dieNatural + totalBonus;

  if (targetAc !== undefined) {
    const degree = calculateDegreeOfSuccess(total, targetAc, dieNatural);
    return {
      attackNumber,
      mapPenalty,
      totalBonus,
      dieNatural,
      total,
      degree,
      targetAc,
    };
  }

  return {
    attackNumber,
    mapPenalty,
    totalBonus,
    dieNatural,
    total,
  };
}

// ---------------------------------------------------------------------------
// Compute strike damage
// REQ-PF2-033..034, REQ-PF2-040..041
// ---------------------------------------------------------------------------

/**
 * Compute the total strike damage from a pre-rolled dice result.
 *
 * Called on the SERVER after RollService evaluates the damage formula.
 * Handles critical hit doubling (REQ-PF2-034), deadly die, fatal die,
 * and IWR pipeline (REQ-PF2-060).
 *
 * @param strike      - Strike descriptor.
 * @param diceTotal   - The sum of the weapon damage dice as rolled.
 * @param isCritical  - Whether the attack was a CriticalSuccess.
 * @param targetIwr   - Target's IWR (optional; if omitted, no IWR applied).
 * @param deadlyDiceTotal - Sum of the deadly die roll (only for crits with deadly trait).
 * @param fatalDieRoll    - Sum of the fatal replacement die roll (only for crits with fatal trait).
 */
export function computeStrikeDamage(
  strike: StrikeDescriptor,
  diceTotal: number,
  isCritical: boolean,
  targetIwr?: IwrSet,
  deadlyDiceTotal?: number,
  fatalDieRoll?: number,
): StrikeDamageResult {
  const { damageDice, damageDie, damageType, damageBonus, deadlyDie, fatalDie } = strike;

  let baseBeforeCrit = diceTotal + damageBonus;
  let deadlyBonus = 0;

  if (isCritical) {
    if (fatalDie && fatalDieRoll !== undefined) {
      // Fatal: replace weapon die with fatal die for the doubled roll, add one die
      // REQ-PF2-034: fatal d# → replace die + add one die on crit
      // We receive fatalDieRoll as the one extra die from fatal
      baseBeforeCrit = diceTotal + damageBonus; // weapon rolls stay, bonus from fatal counted separately
      deadlyBonus = fatalDieRoll;
    } else if (deadlyDie && deadlyDiceTotal !== undefined) {
      // Deadly: on crit, add deadly die (not doubled)
      deadlyBonus = deadlyDiceTotal;
    }
  }

  const doubledTotal = isCritical ? baseBeforeCrit * 2 : baseBeforeCrit;
  const totalWithDeadly = doubledTotal + deadlyBonus;

  const diceFormula = `${String(damageDice)}${damageDie}`;

  // IWR pipeline (REQ-PF2-060)
  let finalDamage = totalWithDeadly;
  let breakdown: Array<{ type: string; finalDamage: number; note?: string }> = [
    { type: damageType, finalDamage: totalWithDeadly },
  ];

  if (targetIwr) {
    const damageInstances: DamageInstance[] = [{ amount: totalWithDeadly, type: damageType }];
    const iwrResult = applyIwrMultiple(damageInstances, targetIwr);
    finalDamage = iwrResult.total;
    breakdown = iwrResult.breakdown.map((r) => {
      if (r.note !== undefined) {
        return { type: r.type, finalDamage: r.finalDamage, note: r.note };
      }
      return { type: r.type, finalDamage: r.finalDamage };
    });
  }

  return {
    diceFormula,
    diceTotal,
    flatBonus: damageBonus,
    baseTotal: baseBeforeCrit,
    isCritical,
    doubledTotal,
    deadlyBonus,
    damageType,
    finalDamage,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// NPC strike helpers (melee items use flat bonus, not derived from TEML)
// REQ-PF2-030
// ---------------------------------------------------------------------------

/**
 * Build a minimal StrikeDescriptor from an NPC melee item.
 *
 * NPC melee items store a flat `bonus` value (not derived from TEML+level).
 * There is no ability mod breakdown at MVP — the NPC statblock gives a single
 * attack bonus already baked in.
 */
export function deriveStrikeFromMeleeItem(
  meleeId: string,
  meleeName: string,
  meleeBonus: number,
  damageDice: number,
  damageDie: string,
  damageType: string,
  damageBonus: number,
  traits: string[],
): StrikeDescriptor {
  const isAgile = traits.includes("agile");
  const deadlyDie = extractTraitDie(traits, "deadly");
  const fatalDie = extractTraitDie(traits, "fatal");

  const attackModifiers: StrikeModifier[] = [
    { slug: "melee-bonus", label: "Attack Bonus", type: "untyped", value: meleeBonus },
  ];

  const baseDescriptor = {
    strikeId: meleeId,
    label: meleeName,
    melee: true as const,
    isAgile,
    isFinesse: false as const,
    isPropulsive: false as const,
    isThrown: false as const,
    attackBonus: meleeBonus,
    attackAbility: "str" as const,
    damageAbilityMod: 0,
    damageDice,
    damageDie,
    damageType,
    damageBonus,
    traits,
    attackModifiers,
    damageModifiers:
      damageBonus !== 0
        ? [{ slug: "damage-bonus", label: "Damage Bonus", type: "untyped", value: damageBonus }]
        : [],
  };
  return deadlyDie !== undefined && fatalDie !== undefined
    ? { ...baseDescriptor, deadlyDie, fatalDie }
    : deadlyDie !== undefined
      ? { ...baseDescriptor, deadlyDie }
      : fatalDie !== undefined
        ? { ...baseDescriptor, fatalDie }
        : baseDescriptor;
}

// ---------------------------------------------------------------------------
// Chat card payload for strikes
// REQ-PF2-100 (declarative chat cards)
// ---------------------------------------------------------------------------

/**
 * Payload for a PF2e strike chat card.
 *
 * This is the data-only descriptor posted to the chat system via ActionDefinition.
 * The client renders it without arbitrary HTML (REQ from spec 09).
 */
export interface StrikeChatCardPayload {
  cardType: "pf2e.strike";
  actorId: string;
  actorName: string;
  strikeId: string;
  strikeName: string;
  /** MAP 0 attack bonus (base). */
  attackBonus: number;
  /** MAP 1 bonus (attackBonus + mapPenalty1). */
  attackBonus2: number;
  /** MAP 2 bonus (attackBonus + mapPenalty2). */
  attackBonus3: number;
  isAgile: boolean;
  damageDice: number;
  damageDie: string;
  damageType: string;
  damageBonus: number;
  deadlyDie?: string;
  fatalDie?: string;
  isCritical?: boolean;
  attackResult?: StrikeAttackResult;
  damageResult?: StrikeDamageResult;
}

/**
 * Build the chat card payload for a strike, before rolling.
 */
export function buildStrikeChatCard(
  actorId: string,
  actorName: string,
  strike: StrikeDescriptor,
): StrikeChatCardPayload {
  const map1 = calculateMapPenalty(2, strike.isAgile);
  const map2 = calculateMapPenalty(3, strike.isAgile);

  const base = {
    cardType: "pf2e.strike" as const,
    actorId,
    actorName,
    strikeId: strike.strikeId,
    strikeName: strike.label,
    attackBonus: strike.attackBonus,
    attackBonus2: strike.attackBonus + map1,
    attackBonus3: strike.attackBonus + map2,
    isAgile: strike.isAgile,
    damageDice: strike.damageDice,
    damageDie: strike.damageDie,
    damageType: strike.damageType,
    damageBonus: strike.damageBonus,
  };
  if (strike.deadlyDie !== undefined && strike.fatalDie !== undefined) {
    return { ...base, deadlyDie: strike.deadlyDie, fatalDie: strike.fatalDie };
  }
  if (strike.deadlyDie !== undefined) {
    return { ...base, deadlyDie: strike.deadlyDie };
  }
  if (strike.fatalDie !== undefined) {
    return { ...base, fatalDie: strike.fatalDie };
  }
  return base;
}
