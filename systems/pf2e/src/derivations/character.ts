/**
 * @fusion/system-pf2e — Character derivation steps.
 *
 * Registers DeriveSteps for Actor subtype "character" with the system
 * registrar. Implements the four-phase pipeline from DEC-PF2-03:
 *   base  → ability mods, proficiency bases, HP base, drained HP reduction
 *   derived → AC, saves, perception, skills, classDC, strikes (after effects)
 *
 * Integration with the effects engine:
 *   - The system API executes "base" steps, then the effects engine populates
 *     Synthetics (collectEffects), then executes "derived" steps.
 *   - "Derived" steps call resolveStatisticMulti() to pick up FlatModifiers
 *     injected by conditions (frightened, fatigued, etc.).
 *
 * Clean-room: ORC/OGL mechanics only. No Foundry code copied.
 * REQ-PF2-010..022, REQ-PF2-030..034, REQ-PF2-051, REQ-PF2-200.
 * Spec: 17-sistema-pf2e.md.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

import type { DeriveStep } from "@fusion/system-api";
import { resolveModifiersForSelector, resolveStacking } from "@fusion/engine-2e";
import type { CharacterSystem } from "../schemas/actor-character.js";
import type { WeaponSystem } from "../schemas/item-weapon.js";
import { SKILL_ABILITY } from "../types.js";
import { abilityMod, proficiencyBonus, resolveStatisticMulti, mapPenalties } from "./helpers.js";
import { deriveStrikeFromWeapon, type StrikeModifier } from "../actions/strikes.js";
import type { DerivedStatistic, DerivedStrike, ModifierBreakdown } from "./types.js";

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc["system"] as Record<string, unknown>) ?? {};
}

function getCharSystem(doc: Record<string, unknown>): CharacterSystem {
  return getSystem(doc) as unknown as CharacterSystem;
}

// ---------------------------------------------------------------------------
// Helper: get or create the `derived` sub-object on the document
// ---------------------------------------------------------------------------

function getDerived(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = getSystem(doc);
  if (!sys["derived"] || typeof sys["derived"] !== "object") {
    sys["derived"] = {};
  }
  return sys["derived"] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// STEP 1 (base phase): Ability modifiers
// REQ-PF2-010
// ---------------------------------------------------------------------------

/**
 * Compute and store ability modifiers from raw scores.
 *
 * Reads:  system.abilities.{str|dex|con|int|wis|cha}.value
 * Writes: system.derived.abilityMods
 */
export const stepCharAbilityMods: DeriveStep = {
  id: "pf2e.character.base.abilityMods",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  reads: [
    "system.abilities.str.value",
    "system.abilities.dex.value",
    "system.abilities.con.value",
    "system.abilities.int.value",
    "system.abilities.wis.value",
    "system.abilities.cha.value",
  ],
  writes: ["system.derived.abilityMods"],

  run(doc) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);

    const mods = {
      str: abilityMod(sys.abilities.str.value),
      dex: abilityMod(sys.abilities.dex.value),
      con: abilityMod(sys.abilities.con.value),
      int: abilityMod(sys.abilities.int.value),
      wis: abilityMod(sys.abilities.wis.value),
      cha: abilityMod(sys.abilities.cha.value),
    };

    derived["abilityMods"] = mods;

    // Also update the cached mod on abilities (DEC-PF2-03: derived, but
    // the schema exposes `.mod` for items that reference it directly).
    sys.abilities.str.mod = mods.str;
    sys.abilities.dex.mod = mods.dex;
    sys.abilities.con.mod = mods.con;
    sys.abilities.int.mod = mods.int;
    sys.abilities.wis.mod = mods.wis;
    sys.abilities.cha.mod = mods.cha;
  },
};

// ---------------------------------------------------------------------------
// STEP 2 (base phase): HP base (ancestry + class × (level + conMod))
// REQ-PF2-021
// ---------------------------------------------------------------------------

/**
 * Compute base HP maximum and derived HP values.
 *
 * The Drained condition's HP-max reduction is NOT applied here: it depends on
 * the active condition's value, which is only available after the effects
 * engine runs. It is applied in the derived phase by `stepCharDrainedHp`.
 *
 * Reads:  system.attributes.hp, system.details.level, system.derived.abilityMods
 * Writes: system.derived.hp
 */
export const stepCharHp: DeriveStep = {
  id: "pf2e.character.base.hp",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  reads: ["system.attributes.hp", "system.details.level", "system.derived.abilityMods"],
  writes: ["system.derived.hp"],

  run(doc) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);

    // Base HP max from stored value; if character was built with class+ancestry HP
    // the importer stores the total in attributes.hp.max already.
    // If ancestry HP info is stored separately, class HP per level × (level + conMod)
    // would be computed here — but for MVP the importer provides the total directly.
    const storedMax = sys.attributes.hp.max;

    // No drained reduction at base phase — applied in stepCharDrainedHp (derived).
    derived["hp"] = {
      value: Math.min(sys.attributes.hp.value, storedMax),
      max: storedMax,
      temp: sys.attributes.hp.temp,
      drainedHpReduction: 0,
    };
  },
};

// ---------------------------------------------------------------------------
// STEP 3 (base phase): dyingMax from doomed (REQ-PF2-074)
// ---------------------------------------------------------------------------

/**
 * Compute dying.max = 4 − doomed.value.
 *
 * Reads:  system.attributes.doomed
 * Writes: system.derived.dyingMax
 */
export const stepCharDyingMax: DeriveStep = {
  id: "pf2e.character.base.dyingMax",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  reads: ["system.attributes.doomed"],
  writes: ["system.derived.dyingMax"],

  run(doc) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);
    const doomedValue = sys.attributes.doomed?.value ?? 0;
    derived["dyingMax"] = Math.max(0, 4 - doomedValue);
  },
};

// ---------------------------------------------------------------------------
// STEP 4 (derived phase): Armor Class
// REQ-PF2-020
// ---------------------------------------------------------------------------

/**
 * Derive AC = 10 + dexCap(dex) + armorProf + armorPotency + Σmodifiers.
 *
 * If the actor has an equipped armor item (stored in system), the dexCap and
 * acBonus are extracted from it. For MVP, these are assumed to be present in
 * system.attributes.ac (the importer may write a derived value) or computed
 * from equipped armor items passed through the doc.
 *
 * The selectors "ac" and (when relevant) "saving-throw" are queried in
 * the Synthetics.
 *
 * Reads:  system.derived.abilityMods, system.proficiencies.armor,
 *         system.level, system._equippedArmor (optional)
 * Writes: system.derived.ac
 */
export const stepCharAc: DeriveStep = {
  id: "pf2e.character.derived.ac",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: ["system.derived.abilityMods", "system.proficiencies.armor", "system.level"],
  writes: ["system.derived.ac"],

  run(doc, ctx) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);
    const abilityMods = derived["abilityMods"] as { dex: number } | undefined;
    const dexMod = abilityMods?.dex ?? 0;
    const level = (sys.level as { value: number }).value ?? 1;

    // Determine equipped armor properties.
    // The doc may carry a pre-processed `_equippedArmor` object set by a
    // "collectItems" step. For MVP we fall back to safe defaults (unarmored).
    const equippedArmor = doc["_equippedArmor"] as
      | {
          category: string;
          acBonus: number;
          dexCap: number | null;
          potency: number;
        }
      | undefined;

    const armorCategory = equippedArmor?.category ?? "unarmored";
    const armorAcBonus = equippedArmor?.acBonus ?? 0;
    const dexCap = equippedArmor?.dexCap ?? null;
    const potencyBonus = equippedArmor?.potency ?? 0;

    // Proficiency rank for this armor category (REQ-PF2-020)
    const armorProfs = sys.proficiencies?.armor as Record<string, number> | undefined;
    const rank = armorProfs?.[armorCategory] ?? 0;
    const profBonus = proficiencyBonus(rank, level);

    // Apply dex cap
    const cappedDex = dexCap !== null ? Math.min(dexMod, dexCap) : dexMod;

    // Base AC = 10 + cappedDex + profBonus + armorAcBonus + potency
    const base = 10 + cappedDex + profBonus + armorAcBonus + potencyBonus;

    // Apply modifiers from synthetics ("ac" selector)
    const stat = resolveStatisticMulti("ac", base, ["ac"], ctx.synthetics, ctx.rollOptions);

    derived["ac"] = stat;
  },
};

// ---------------------------------------------------------------------------
// STEP 5 (derived phase): Saving throws
// REQ-PF2-015
// ---------------------------------------------------------------------------

/**
 * Derive Fortitude, Reflex, Will saves.
 *
 * Each save = abilityMod + proficiencyBonus + Σmodifiers.
 * Selectors: specific ("fortitude") + broad ("saving-throw").
 *
 * Reads:  system.derived.abilityMods, system.saves, system.level
 * Writes: system.derived.saves
 */
export const stepCharSaves: DeriveStep = {
  id: "pf2e.character.derived.saves",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: ["system.derived.abilityMods", "system.saves", "system.level"],
  writes: ["system.derived.saves"],

  run(doc, ctx) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);
    const abilityMods = derived["abilityMods"] as Record<string, number> | undefined;
    const level = (sys.level as { value: number }).value ?? 1;

    const saveAbilities = {
      fortitude: "con",
      reflex: "dex",
      will: "wis",
    } as const;

    const saves: Record<string, DerivedStatistic> = {};

    for (const [saveName, ability] of Object.entries(saveAbilities) as [
      "fortitude" | "reflex" | "will",
      "con" | "dex" | "wis",
    ][]) {
      const rank = sys.saves[saveName]?.rank ?? 0;
      const mod = abilityMods?.[ability] ?? 0;
      const base = mod + proficiencyBonus(rank, level);

      // Merge specific selector (e.g. "fortitude") and broad "saving-throw"
      saves[saveName] = resolveStatisticMulti(
        saveName,
        base,
        [saveName, "saving-throw"],
        ctx.synthetics,
        ctx.rollOptions,
      );
    }

    derived["saves"] = saves;
  },
};

// ---------------------------------------------------------------------------
// STEP 6 (derived phase): Perception
// REQ-PF2-014
// ---------------------------------------------------------------------------

/**
 * Derive Perception = WIS mod + proficiencyBonus(perception rank) + Σmodifiers.
 *
 * Reads:  system.derived.abilityMods, system.perception.rank, system.level
 * Writes: system.derived.perception
 */
export const stepCharPerception: DeriveStep = {
  id: "pf2e.character.derived.perception",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: ["system.derived.abilityMods", "system.perception.rank", "system.level"],
  writes: ["system.derived.perception"],

  run(doc, ctx) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);
    const abilityMods = derived["abilityMods"] as Record<string, number> | undefined;
    const wisMod = abilityMods?.["wis"] ?? 0;
    const level = (sys.level as { value: number }).value ?? 1;
    const rank = sys.perception?.rank ?? 0;
    const base = wisMod + proficiencyBonus(rank, level);

    const stat = resolveStatisticMulti(
      "perception",
      base,
      ["perception"],
      ctx.synthetics,
      ctx.rollOptions,
    );

    derived["perception"] = stat;
  },
};

// ---------------------------------------------------------------------------
// STEP 7 (derived phase): Skills
// REQ-PF2-012, REQ-PF2-013
// ---------------------------------------------------------------------------

/**
 * Derive all 16 canonical skills and any Lore skills.
 *
 * Each skill = abilityMod(skill.ability) + proficiency(rank) + Σmodifiers.
 * Selectors: "skill:<slug>" + broad "skill-check".
 *
 * Reads:  system.derived.abilityMods, system.skills, system.level
 * Writes: system.derived.skills
 */
export const stepCharSkills: DeriveStep = {
  id: "pf2e.character.derived.skills",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: ["system.derived.abilityMods", "system.skills", "system.level"],
  writes: ["system.derived.skills"],

  run(doc, ctx) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);
    const abilityMods = derived["abilityMods"] as Record<string, number> | undefined;
    const level = (sys.level as { value: number }).value ?? 1;

    const skillsResult: Record<string, DerivedStatistic> = {};

    for (const [slug, skillData] of Object.entries(sys.skills ?? {})) {
      const rank = (skillData as { rank: number }).rank ?? 0;
      const isLore = (skillData as { lore?: boolean }).lore === true;

      // Determine key ability: Lore uses INT; canonical skills use SKILL_ABILITY map.
      const ability: string = isLore
        ? "int"
        : (SKILL_ABILITY[slug as keyof typeof SKILL_ABILITY] ?? "int");

      const mod = abilityMods?.[ability] ?? 0;
      const base = mod + proficiencyBonus(rank, level);

      // Selectors: specific "skill:acrobatics" + broad "skill-check"
      skillsResult[slug] = resolveStatisticMulti(
        slug,
        base,
        [`skill:${slug}`, "skill-check"],
        ctx.synthetics,
        ctx.rollOptions,
      );
    }

    derived["skills"] = skillsResult;
  },
};

// ---------------------------------------------------------------------------
// STEP 8 (derived phase): Class DC
// REQ-PF2-016
// ---------------------------------------------------------------------------

/**
 * Derive Class DC = 10 + keyAbilityMod + proficiencyBonus(classDC.rank).
 *
 * Reads:  system.derived.abilityMods, system.proficiencies.classDC, system.level,
 *         system.details.keyAbility
 * Writes: system.derived.classDC
 */
export const stepCharClassDC: DeriveStep = {
  id: "pf2e.character.derived.classDC",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: [
    "system.derived.abilityMods",
    "system.proficiencies.classDC",
    "system.level",
    "system.details.keyAbility",
  ],
  writes: ["system.derived.classDC"],

  run(doc, ctx) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);
    const abilityMods = derived["abilityMods"] as Record<string, number> | undefined;
    const level = (sys.level as { value: number }).value ?? 1;

    const keyAbility = sys.details?.keyAbility ?? "str";
    const keyMod = abilityMods?.[keyAbility] ?? 0;
    const rank = sys.proficiencies?.classDC?.rank ?? 0;
    const profBonus = proficiencyBonus(rank, level);
    const base = keyMod + profBonus;

    // Resolve modifiers from "class-dc" selector
    const resolvedMods = resolveModifiersForSelector("class-dc", ctx.synthetics, ctx.rollOptions);
    const modSum = resolveStacking(resolvedMods);
    const modifiers: ModifierBreakdown[] = resolvedMods.map((m) => ({
      slug: m.slug,
      label: m.label,
      type: m.type,
      value: m.value,
    }));
    const total = base + modSum;

    derived["classDC"] = {
      total,
      dc: 10 + total,
      modifiers,
    };
  },
};

// ---------------------------------------------------------------------------
// STEP 9 (derived phase): Drained HP reduction
// REQ-PF2-051 (drained X → max HP reduced by level × X)
// ---------------------------------------------------------------------------

/**
 * Apply drained condition HP reduction after effects have been processed.
 *
 * The effects engine processes conditions (ToggleCondition), but the HP
 * reduction for `drained` is a special case handled here: we read the
 * drained roll option (format "condition:drained" + "drained:<N>") from
 * synthetics.rollOptions and reduce the already-computed hp.max.
 *
 * Reads:  system.derived.hp, system.level, ctx.rollOptions
 * Writes: system.derived.hp (updates drainedHpReduction and max)
 */
export const stepCharDrainedHp: DeriveStep = {
  id: "pf2e.character.derived.drainedHp",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: ["system.derived.hp", "system.level"],
  writes: ["system.derived.hp"],

  run(doc, ctx) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);
    const level = (sys.level as { value: number }).value ?? 1;

    // Read the drained value from roll options (e.g. "drained:2")
    let drainedValue = 0;
    for (const opt of ctx.rollOptions) {
      if (opt.startsWith("drained:")) {
        const parsed = Number(opt.slice("drained:".length));
        if (!Number.isNaN(parsed)) {
          drainedValue = parsed;
          break;
        }
      }
      // Also handle bare "condition:drained" as value=1 when no numeric suffix
      if (opt === "condition:drained" && drainedValue === 0) {
        drainedValue = 1;
      }
    }

    if (drainedValue === 0) return; // nothing to reduce

    const drainedHpReduction = drainedValue * level;
    const existingHp = derived["hp"] as {
      value: number;
      max: number;
      temp: number;
      drainedHpReduction: number;
    };

    const newMax = Math.max(0, existingHp.max - drainedHpReduction);
    derived["hp"] = {
      value: Math.min(existingHp.value, newMax),
      max: newMax,
      temp: existingHp.temp,
      drainedHpReduction,
    };
  },
};

// ---------------------------------------------------------------------------
// STEP 10 (derived phase): Strikes
// REQ-PF2-030..034, REQ-PF2-130
// ---------------------------------------------------------------------------

/**
 * Equipped-weapon shape consumed by the strikes step.
 *
 * Populated by a "collectItems" step (or manually set in tests).
 */
interface EquippedWeaponInput {
  name: string;
  id: string;
  damage: { dice: number; die: string; damageType: string; modifier?: number };
  category: string;
  traits: string[];
  range: number | null;
  runes: { potency: number; striking: number };
}

/**
 * Adapt an `_equippedWeapons` entry to the `WeaponSystem` shape expected by
 * `deriveStrikeFromWeapon`. Only the fields the strike derivation reads are
 * populated; the rest fall back to safe defaults.
 */
function equippedWeaponToWeaponSystem(weapon: EquippedWeaponInput): WeaponSystem {
  return {
    systemVersion: "0.1.0",
    damage: {
      dice: weapon.damage.dice,
      die: weapon.damage.die,
      damageType: weapon.damage.damageType,
      modifier: weapon.damage.modifier ?? 0,
    },
    category: weapon.category,
    weaponGroup: "",
    runes: {
      potency: weapon.runes?.potency ?? 0,
      striking: weapon.runes?.striking ?? 0,
      property: [],
    },
    range: weapon.range,
    reload: "-",
    bulk: 0,
    price: {},
    quantity: 1,
    level: 0,
    usage: "held-in-one-hand",
    size: "med",
    traits: { rarity: "common", value: weapon.traits ?? [] },
    bonus: 0,
    bonusDamage: 0,
    rules: [],
  } as unknown as WeaponSystem;
}

/**
 * Render the (non-critical) damage formula for a derived strike.
 *
 * `Nd# +M type` (or `Nd# type` when the flat bonus is 0).
 */
function renderDamageFormula(
  dice: number,
  die: string,
  flatBonus: number,
  damageType: string,
): string {
  const sign = flatBonus >= 0 ? "+" : "";
  return flatBonus !== 0
    ? `${String(dice)}${die} ${sign}${String(flatBonus)} ${damageType}`
    : `${String(dice)}${die} ${damageType}`;
}

/**
 * Render the critical damage formula. Deadly/fatal traits are honoured by
 * `deriveStrikeFromWeapon`'s descriptor (deadlyDie / fatalDie).
 *
 * Crit = double the base pool; deadly adds one (undoubled) extra die; fatal
 * adds one extra die of the fatal size on top of the doubled pool.
 */
function renderCritDamageFormula(
  dice: number,
  die: string,
  flatBonus: number,
  damageType: string,
  deadlyDie: string | undefined,
  fatalDie: string | undefined,
): string {
  const sign = flatBonus >= 0 ? "+" : "";
  const base = `(${String(dice)}${die} ${sign}${String(flatBonus)}) × 2`;
  if (fatalDie !== undefined) {
    return `${base} + 1${fatalDie} ${damageType}`;
  }
  if (deadlyDie !== undefined) {
    return `${base} + 1${deadlyDie} ${damageType}`;
  }
  return `${base} ${damageType}`;
}

/**
 * Derive strikes from the `_equippedWeapons` array on the document.
 *
 * Delegates the attack/damage math (ability mod, proficiency, potency, striking
 * dice, deadly/fatal traits, stacking) to `deriveStrikeFromWeapon` in
 * `actions/strikes.ts` — the single strike-derivation function that uses the
 * engine-2e helpers. This step only adapts the equipped-weapon input, resolves
 * synthetics modifiers, and shapes the engine output into `DerivedStrike`
 * (MAP variants + formula strings) for the sheet.
 *
 * Reads:  system.derived.abilityMods, system.proficiencies.weapons,
 *         system.level, doc._equippedWeapons
 * Writes: system.derived.strikes
 */
export const stepCharStrikes: DeriveStep = {
  id: "pf2e.character.derived.strikes",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: ["system.derived.abilityMods", "system.proficiencies.weapons", "system.level"],
  writes: ["system.derived.strikes"],

  run(doc, ctx) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);

    // Mirror the freshly-derived ability mods onto the system the strike
    // derivation reads (deriveStrikeFromWeapon uses charSystem.abilities.*.mod).
    const abilityMods = derived["abilityMods"] as Record<string, number> | undefined;
    if (abilityMods) {
      for (const ability of ["str", "dex", "con", "int", "wis", "cha"] as const) {
        const slot = sys.abilities[ability] as { mod?: number } | undefined;
        if (slot) slot.mod = abilityMods[ability] ?? slot.mod ?? 0;
      }
    }

    const equippedWeapons = doc["_equippedWeapons"] as EquippedWeaponInput[] | undefined;

    if (!equippedWeapons || equippedWeapons.length === 0) {
      derived["strikes"] = [];
      return;
    }

    const strikes: DerivedStrike[] = equippedWeapons.map((weapon) => {
      const isRanged = weapon.range !== null;

      // Resolve condition/effect attack modifiers from synthetics for this strike.
      const attackSelector = isRanged ? "ranged-attack-roll" : "melee-attack-roll";
      const attackMods = resolveModifiersForSelector(
        attackSelector,
        ctx.synthetics,
        ctx.rollOptions,
      );
      const genericAttackMods = resolveModifiersForSelector(
        "attack-roll",
        ctx.synthetics,
        ctx.rollOptions,
      );
      const extraAttackMods: StrikeModifier[] = deduplicateModifiers([
        ...attackMods,
        ...genericAttackMods,
      ]).map((m) => ({ slug: m.slug, label: m.label, type: m.type, value: m.value }));

      // Resolve damage modifiers from synthetics for this strike.
      const damageMods = resolveModifiersForSelector("damage", ctx.synthetics, ctx.rollOptions);
      const damageMorphSelector = isRanged ? "ranged-damage" : "melee-damage";
      const specificDamageMods = resolveModifiersForSelector(
        damageMorphSelector,
        ctx.synthetics,
        ctx.rollOptions,
      );
      const extraDamageMods: StrikeModifier[] = deduplicateModifiers([
        ...damageMods,
        ...specificDamageMods,
      ]).map((m) => ({ slug: m.slug, label: m.label, type: m.type, value: m.value }));

      // Static weapon damage modifier (e.g. a +N flat bonus baked into the
      // weapon's damage block) is an intrinsic untyped bonus on this strike.
      const staticDamageMod = weapon.damage.modifier ?? 0;
      if (staticDamageMod !== 0) {
        extraDamageMods.push({
          slug: "weapon-damage-modifier",
          label: "Weapon Damage",
          type: "untyped",
          value: staticDamageMod,
        });
      }

      // Delegate the full strike math to the canonical engine-backed function.
      const descriptor = deriveStrikeFromWeapon(
        weapon.id,
        weapon.name,
        equippedWeaponToWeaponSystem(weapon),
        sys,
        extraAttackMods,
        extraDamageMods,
      );

      // Shape into DerivedStrike: MAP variants + formula strings for the sheet.
      const [m0, m1, m2] = mapPenalties(descriptor.isAgile);
      const makeVariant = (mapPenalty: number) => ({
        mapPenalty,
        total: descriptor.attackBonus + mapPenalty,
        formula: `1d20 + ${String(descriptor.attackBonus + mapPenalty)}`,
      });
      const variants: [
        ReturnType<typeof makeVariant>,
        ReturnType<typeof makeVariant>,
        ReturnType<typeof makeVariant>,
      ] = [makeVariant(m0), makeVariant(m1), makeVariant(m2)];

      const damageFormula = renderDamageFormula(
        descriptor.damageDice,
        descriptor.damageDie,
        descriptor.damageBonus,
        descriptor.damageType,
      );
      const critDamageFormula = renderCritDamageFormula(
        descriptor.damageDice,
        descriptor.damageDie,
        descriptor.damageBonus,
        descriptor.damageType,
        descriptor.deadlyDie,
        descriptor.fatalDie,
      );

      return {
        label: descriptor.label,
        sourceId: descriptor.strikeId,
        isRanged: !descriptor.melee,
        isAgile: descriptor.isAgile,
        attackBonus: descriptor.attackBonus,
        variants,
        damageAbilityMod: descriptor.damageAbilityMod,
        damageFormula,
        critDamageFormula,
        damageType: descriptor.damageType,
        traits: descriptor.traits,
      };
    });

    derived["strikes"] = strikes;
  },
};

// ---------------------------------------------------------------------------
// Utility: deduplicate modifiers by slug
// ---------------------------------------------------------------------------

function deduplicateModifiers(
  mods: Array<{
    slug: string;
    label: string;
    type: string;
    value: number;
    selector: string;
    source: string;
  }>,
): Array<{
  slug: string;
  label: string;
  type: string;
  value: number;
  selector: string;
  source: string;
}> {
  const seen = new Set<string>();
  return mods.filter((m) => {
    if (seen.has(m.slug)) return false;
    seen.add(m.slug);
    return true;
  });
}

// ---------------------------------------------------------------------------
// All character derivation steps (in declaration order — topo-sort handles
// actual execution order at runtime).
// ---------------------------------------------------------------------------

export const CHARACTER_DERIVE_STEPS: DeriveStep[] = [
  stepCharAbilityMods,
  stepCharHp,
  stepCharDyingMax,
  stepCharAc,
  stepCharSaves,
  stepCharPerception,
  stepCharSkills,
  stepCharClassDC,
  stepCharDrainedHp,
  stepCharStrikes,
];
