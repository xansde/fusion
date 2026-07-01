/**
 * @fusion/system-sf2e — Strike derivation and resolution.
 *
 * Mirrors `systems/pf2e/src/actions/strikes.ts` (REQ-SF2-004: attack roll
 * math, MAP, degrees of success, and damage totals are IDENTICAL between
 * PF2e and SF2e — both delegate to the shared `@fusion/engine-2e` core).
 * This module's actual contribution is the Tech-weapon delta:
 *
 *   - Item bonus source (REQ-SF2-018, D-SF2-02): Analog weapons use the
 *     `runes.potency` item bonus (same as PF2e). Tech weapons (trait
 *     `"tech"`) do NOT use runes — the real compendium data
 *     (vendor/pf2e/packs/sf2e/equipment/weapons/*.json) stores the item's
 *     attack bonus directly on `system.bonus.value` (flattened to
 *     `weapon.bonus` post-import, same field the importer already produces
 *     for PF2e). There is no tier→bonus lookup table to apply (QA-SF2-01 is
 *     unresolved — the exact tier-upgrade deltas were not tabulated in the
 *     research); `weapon.bonus` is read as-is from the item, which is
 *     correct for the MVP compendium subset (all base Tech weapons ship at
 *     `grade: "commercial"` with `bonus.value: 0`, verified against every
 *     file in the vendor pack). Weapon-upgrade items that raise the grade
 *     are a distinct item type (`equipment/weapon-upgrades/*`) — applying
 *     their bonus automatically is a [V2] hook (depends on QA-SF2-01).
 *   - Damage dice source (REQ-SF2-018): Tech weapons don't have a Striking
 *     rune; `weapon.damage.dice` is used directly (no `strikingDiceBonus`
 *     lookup) — same rationale as above.
 *   - Ammo/charge gating (REQ-SF2-020): `resolveAmmoState` determines
 *     whether the weapon can currently fire (`ammoOk`) from
 *     `charges.current` vs `expend`, and `consumeCharge` decrements charges
 *     on a fired shot. Analog weapons (no `ammo` block) are always `ammoOk`.
 *   - SF traits (REQ-SF2-019): `automatic`/`area`/`tracking` traits are
 *     surfaced on the descriptor (`sfAutomatic`, `sfAreaSize`,
 *     `sfTrackingBonus` — parsed from the traits array, e.g. `"tracking-2"`,
 *     `"area-15"`) for the caller to branch on. `Tracking X` grants a flat
 *     item bonus to the attack roll (REQ-SF2-019 table) and IS folded into
 *     `attackBonus` here. `Automatic`/`Area` change the ROLL SHAPE (no
 *     separate roll per target, template placement, Reflex save) rather than
 *     the attack-bonus math — implementing the alternate roll flow is a
 *     [V2] hook (needs template/AoE + basic-save integration beyond this
 *     module's scope); the trait/areaSize/mode are exposed on the
 *     descriptor so a future action handler can drive it.
 *
 * The actual dice rolls happen on the server via RollService (authoritative
 * RNG). These functions produce the formulas and stat totals needed to
 * parameterize those rolls.
 *
 * Clean-room: spec 18 REQ-SF2-018..020; ORC/OGL game mechanics.
 * REQ-SF2-004, REQ-SF2-018..020.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import { calculateMapPenalty } from "@fusion/engine-2e";
import { resolveStacking } from "@fusion/engine-2e";
import { calculateDegreeOfSuccess, type DegreeOfSuccess } from "@fusion/engine-2e";
import { applyIwrMultiple, type IwrSet, type DamageInstance } from "@fusion/engine-2e";
import { calculateProficiencyBonus } from "@fusion/engine-2e";
import type { WeaponSystem } from "../schemas/item-weapon.js";
import { SF2E_STACKING_TABLE } from "../stacking.js";
import type { CharacterSystem } from "../schemas/actor-character.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A modifier used at roll-time by the strike resolver.
 * Simplified form — strikes resolve statically (no target-context
 * predicates at this level).
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
 * Represents one attack option (e.g., "Arc Rifle", "Unarmed Strike"). The
 * three MAP variants are NOT separate StrikeDescriptors; the caller adds
 * `calculateMapPenalty(attackNumber, isAgile)` to `attackBonus` at roll
 * time. See `resolveStrikeAttack`.
 *
 * REQ-SF2-004 (inherited PF2e shape), REQ-SF2-018..020 (Tech delta fields).
 */
export interface StrikeDescriptor {
  /** Weapon item slug or id. */
  readonly strikeId: string;
  /** Display name (weapon name). */
  readonly label: string;
  /** True for melee weapons; false for ranged. */
  readonly melee: boolean;
  /** True when the weapon has the `agile` trait (affects MAP). */
  readonly isAgile: boolean;
  /** True when the weapon has the `finesse` trait (affects attack ability). */
  readonly isFinesse: boolean;
  /** True when the weapon has the `propulsive` trait (damage ability mod). */
  readonly isPropulsive: boolean;
  /** True when weapon is thrown (ranged weapon using STR for damage). */
  readonly isThrown: boolean;
  /** True when the weapon has the `tech` trait (uses grade/ammo/charges). REQ-SF2-018. */
  readonly isTech: boolean;
  /**
   * Base attack bonus (without MAP).
   * = abilityMod + proficiencyBonus + itemBonus (potency rune OR weapon.bonus
   *   for Tech weapons) + trackingBonus + other modifiers.
   */
  readonly attackBonus: number;
  /** Attack ability used. */
  readonly attackAbility: "str" | "dex";
  /** Damage ability modifier value. */
  readonly damageAbilityMod: number;
  /** Weapon dice count (includes striking rune bonus dice for Analog weapons). */
  readonly damageDice: number;
  /** Die size string (e.g., "d6"). */
  readonly damageDie: string;
  /** Primary damage type. */
  readonly damageType: string;
  /** Static flat bonus to damage (item bonus, modifiers, etc.). */
  readonly damageBonus: number;
  /** Traits array (raw). */
  readonly traits: string[];
  /** `deadly d#` trait die (if any). */
  readonly deadlyDie?: string;
  /** `fatal d#` trait die (if any). */
  readonly fatalDie?: string;
  /** All modifiers contributing to the attack bonus, for display. */
  readonly attackModifiers: StrikeModifier[];
  /** All modifiers contributing to the damage bonus, for display. */
  readonly damageModifiers: StrikeModifier[];
  /** True when the weapon has the `automatic` trait. REQ-SF2-019. [V2] roll-shape hook. */
  readonly sfAutomatic: boolean;
  /** Area size in feet, parsed from an `area-<N>` trait, if present. REQ-SF2-019. [V2]. */
  readonly sfAreaSize?: number;
  /** Item bonus already folded into `attackBonus`, parsed from a `tracking-<N>` trait. REQ-SF2-019. */
  readonly sfTrackingBonus?: number;
  /**
   * Whether the weapon currently has enough charges to fire (>= `expend`).
   * Always `true` for weapons with no `ammo` block (Analog). REQ-SF2-020.
   */
  readonly ammoOk: boolean;
  /** Current/max charges, when the weapon tracks ammo. REQ-SF2-020. */
  readonly charges?: { current: number; max: number };
  /** Charges consumed per shot (0 when not ammo-tracked). REQ-SF2-020. */
  readonly expend: number;
}

/**
 * Result of resolving a Strike attack roll.
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
// Ammo / charge helpers (REQ-SF2-020)
// ---------------------------------------------------------------------------

/**
 * Determine whether a weapon has enough charges left to fire, and the
 * number of charges consumed per shot.
 *
 * Weapons with no `charges` block (Analog, or Tech weapons that don't track
 * charges yet) are always `ammoOk: true` with `expend: 0` — no gating.
 *
 * REQ-SF2-020.
 */
export function resolveAmmoState(weapon: Pick<WeaponSystem, "charges" | "expend">): {
  ammoOk: boolean;
  expend: number;
  charges?: { current: number; max: number };
} {
  const charges = weapon.charges;
  if (!charges) {
    return { ammoOk: true, expend: 0 };
  }
  const expend = weapon.expend ?? 1;
  return {
    ammoOk: charges.current >= expend,
    expend,
    charges: { current: charges.current, max: charges.max },
  };
}

/**
 * Consume charges from a weapon's `charges` block after a shot is fired.
 *
 * Pure function: returns the new charges block, clamped at 0. Callers
 * (server-side action handler) persist the result back onto the weapon item.
 * No-op (returns `charges` unchanged) if the weapon has no charges block.
 *
 * REQ-SF2-020: "sem carga = não dispara" is enforced by `resolveAmmoState`
 * BEFORE this is called — this function assumes the caller already checked
 * `ammoOk`.
 */
export function consumeCharge(
  charges: { current: number; max: number } | undefined,
  expend: number,
): { current: number; max: number } | undefined {
  if (!charges) return undefined;
  return { current: Math.max(0, charges.current - expend), max: charges.max };
}

// ---------------------------------------------------------------------------
// SF2e trait parsing (REQ-SF2-019)
// ---------------------------------------------------------------------------

/**
 * Parse a numeric suffix off a trait slug, e.g. `"tracking-2"` → 2,
 * `"area-15"` → 15. Returns `undefined` if the trait isn't present.
 */
function parseNumericTrait(traits: string[], prefix: string): number | undefined {
  const trait = traits.find((t) => t.startsWith(prefix + "-"));
  if (!trait) return undefined;
  const parsed = Number(trait.slice(prefix.length + 1));
  return Number.isNaN(parsed) ? undefined : parsed;
}

// ---------------------------------------------------------------------------
// Derive Strikes from a character actor
// ---------------------------------------------------------------------------

/**
 * Derive the attack ability for a weapon — identical rule to PF2e.
 *
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
 * Derive the damage ability mod for a weapon — identical rule to PF2e.
 *
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
 * Compute striking rune extra dice count (Analog weapons only — REQ-SF2-021).
 *
 * striking = +1 die, greater striking = +2 die, major striking = +3 die.
 */
export function strikingDiceBonus(strikingRune: number): number {
  return Math.min(Math.max(strikingRune, 0), 3);
}

/**
 * Extract a trait die string from the traits array.
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
 * Tech-weapon delta (REQ-SF2-018): item bonus comes from `weapon.bonus`
 * (real compendium field) instead of `runes.potency`; damage dice come
 * straight from `weapon.damage.dice` instead of `strikingDiceBonus`. Analog
 * weapons (no `tech` trait) use the PF2e-identical runes path.
 *
 * REQ-SF2-004, REQ-SF2-018..020.
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
  const isTech = traits.includes("tech");
  const isRanged = weapon.range !== null && weapon.range !== undefined;

  // SF2e traits (REQ-SF2-019)
  const sfAutomatic = traits.includes("automatic");
  const sfAreaSize = parseNumericTrait(traits, "area");
  const sfTrackingBonus = parseNumericTrait(traits, "tracking");

  // Attack ability
  const attackAbility = resolveAttackAbility(weapon, strMod, dexMod);
  const attackAbilityMod = attackAbility === "str" ? strMod : dexMod;

  // Weapon category proficiency rank
  const weaponCategory = weapon.category;
  const proficiencies = charSystem.proficiencies?.weapons ?? {};
  const profRank: number = (proficiencies as Record<string, number>)[weaponCategory] ?? 0;
  const profBonus = calculateProficiencyBonus(profRank, level);

  // Item bonus: Tech weapons use `weapon.bonus` (REQ-SF2-018); Analog weapons
  // use the potency rune, same as PF2e.
  const itemBonus = isTech ? (weapon.bonus ?? 0) : (weapon.runes?.potency ?? 0);
  const itemBonusLabel = isTech ? "Weapon Grade" : "Weapon Potency";
  const itemBonusSlug = isTech ? "tech-grade-bonus" : "potency-rune";

  // Ammo/charge gating (REQ-SF2-020)
  const ammoState = resolveAmmoState(weapon);

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
    ...(itemBonus > 0
      ? [{ slug: itemBonusSlug, label: itemBonusLabel, type: "item", value: itemBonus }]
      : []),
    ...(sfTrackingBonus !== undefined && sfTrackingBonus > 0
      ? [{ slug: "sf-tracking", label: "Tracking", type: "item", value: sfTrackingBonus }]
      : []),
    ...extraAttackMods,
  ];

  const attackBonus = resolveStacking(
    attackModifiers.map((m) => ({ slug: m.slug, type: m.type, value: m.value })),
    SF2E_STACKING_TABLE,
  );

  // Damage ability mod
  const damageAbilityMod = resolveDamageAbilityMod(weapon, strMod);

  // Damage dice: Tech weapons read `weapon.damage.dice` directly (no Striking
  // rune equivalent in the MVP data — REQ-SF2-018); Analog weapons add the
  // striking rune bonus dice, same as PF2e.
  const baseDice = weapon.damage.dice;
  const extraDice = isTech ? 0 : strikingDiceBonus(weapon.runes?.striking ?? 0);
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
    SF2E_STACKING_TABLE,
  );

  // Deadly/Fatal traits (inherited)
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
    isTech,
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
    sfAutomatic,
    ammoOk: ammoState.ammoOk,
    expend: ammoState.expend,
    ...(ammoState.charges !== undefined ? { charges: ammoState.charges } : {}),
    ...(sfAreaSize !== undefined ? { sfAreaSize } : {}),
    ...(sfTrackingBonus !== undefined ? { sfTrackingBonus } : {}),
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
// Resolve a strike attack roll — identical math to PF2e (engine-2e).
// ---------------------------------------------------------------------------

/**
 * Resolve a strike attack from a pre-rolled d20 result.
 *
 * This is called on the SERVER after RollService executes the d20 roll.
 * The server has the authoritative dieNatural value.
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
// Compute strike damage — identical math/pipeline to PF2e (engine-2e IWR).
// ---------------------------------------------------------------------------

/**
 * Compute the total strike damage from a pre-rolled dice result.
 *
 * Called on the SERVER after RollService evaluates the damage formula.
 * Handles critical hit doubling, deadly die, fatal die, and the IWR
 * pipeline (`applyIwrMultiple` from engine-2e).
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
      baseBeforeCrit = diceTotal + damageBonus;
      deadlyBonus = fatalDieRoll;
    } else if (deadlyDie && deadlyDiceTotal !== undefined) {
      deadlyBonus = deadlyDiceTotal;
    }
  }

  const doubledTotal = isCritical ? baseBeforeCrit * 2 : baseBeforeCrit;
  const totalWithDeadly = doubledTotal + deadlyBonus;

  const diceFormula = `${String(damageDice)}${damageDie}`;

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
// ---------------------------------------------------------------------------

/**
 * Build a minimal StrikeDescriptor from an NPC melee item.
 *
 * NPC melee items store a flat `bonus` value (not derived from TEML+level).
 * There is no ability mod breakdown at MVP — the NPC statblock gives a single
 * attack bonus already baked in. NPCs are not ammo-gated (`ammoOk: true`).
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
  const isTech = traits.includes("tech");
  const deadlyDie = extractTraitDie(traits, "deadly");
  const fatalDie = extractTraitDie(traits, "fatal");
  const sfAutomatic = traits.includes("automatic");
  const sfAreaSize = parseNumericTrait(traits, "area");
  const sfTrackingBonus = parseNumericTrait(traits, "tracking");

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
    isTech,
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
    sfAutomatic,
    ammoOk: true,
    expend: 0,
    ...(sfAreaSize !== undefined ? { sfAreaSize } : {}),
    ...(sfTrackingBonus !== undefined ? { sfTrackingBonus } : {}),
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
// ---------------------------------------------------------------------------

/**
 * Payload for an SF2e strike chat card.
 *
 * This is the data-only descriptor posted to the chat system via ActionDefinition.
 * The client renders it without arbitrary HTML.
 */
export interface StrikeChatCardPayload {
  cardType: "sf2e.strike";
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
  ammoOk: boolean;
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
    cardType: "sf2e.strike" as const,
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
    ammoOk: strike.ammoOk,
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
