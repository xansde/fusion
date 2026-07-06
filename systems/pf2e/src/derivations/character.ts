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

import type { DeriveStep } from "@fusion/system-api";
import { resolveModifiersForSelector, resolveStacking } from "@fusion/engine-2e";
import type { CharacterSystem } from "../schemas/actor-character.js";
import type { WeaponSystem } from "../schemas/item-weapon.js";
import { SKILL_ABILITY, SKILL_SLUGS } from "../types.js";
import { abilityMod, proficiencyBonus, resolveStatisticMulti, mapPenalties } from "./helpers.js";
import { deriveStrikeFromWeapon, type StrikeModifier } from "../actions/strikes.js";
import type {
  DerivedStatistic,
  DerivedStrike,
  ModifierBreakdown,
  ArchetypeClassDC,
} from "./types.js";
import { ARCHETYPE_KEY_ABILITY, ARCHETYPE_LABEL, titleCaseSlug } from "./archetypes.js";
import { stepCharCollectEquipment } from "./equipment.js";
import { stepCharSpellcasting } from "./spellcasting.js";
import { stepCharSpeed } from "./speed.js";
import { stepCharToughness } from "./hp.js";
import { stepCharElementalBlasts } from "./elementalBlast.js";
import {
  stepCharBuildAbilities,
  stepCharApplyClass,
  stepCharBuildSkills,
  stepCharBuildHp,
  stepCharFocusClamp,
} from "./build.js";

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc["system"] as Record<string, unknown>) ?? {};
}

function getCharSystem(doc: Record<string, unknown>): CharacterSystem {
  return getSystem(doc) as unknown as CharacterSystem;
}

/**
 * Read `system.level.value`, defaulting to 1 when `system.level` itself is
 * absent (audit issue 1 — a minimal-but-schema-valid character doc may omit
 * it entirely; the naive `(sys.level as {value:number}).value ?? 1` cast
 * throws a TypeError on `undefined.value` before the `??` ever runs).
 */
function getLevel(sys: CharacterSystem): number {
  const level = sys.level as { value?: number } | undefined;
  return level?.value ?? 1;
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
  writes: ["system.derived.abilityMods", "system.derived.abilityScores"],

  run(doc) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);

    // ROBUSTNESS (audit issue 1): a minimal-but-schema-valid character doc
    // (store's `system` schema is a passthrough z.record) may be missing
    // `system.abilities` entirely. Default every ability to score 10 (mod 0)
    // rather than throwing — the resulting derived stats are simply the
    // unmodified baseline, which is a safe, sane placeholder until the actor
    // is properly authored.
    const abilities = (sys.abilities ?? {}) as Partial<CharacterSystem["abilities"]>;
    const scoreOf = (ability: { value?: number } | undefined): number => ability?.value ?? 10;

    const mods = {
      str: abilityMod(scoreOf(abilities.str)),
      dex: abilityMod(scoreOf(abilities.dex)),
      con: abilityMod(scoreOf(abilities.con)),
      int: abilityMod(scoreOf(abilities.int)),
      wis: abilityMod(scoreOf(abilities.wis)),
      cha: abilityMod(scoreOf(abilities.cha)),
    };

    derived["abilityMods"] = mods;

    // Final ability SCORES too (r11 live-verification fix): the build steps
    // overwrite sys.abilities.*.value in the base phase, but that mutation
    // lives only in the server's in-memory derive pass — clients keep seeing
    // the raw persisted scores unless the final values ride along inside
    // system.derived. This step runs AFTER stepCharBuildAbilities (reads/
    // writes edge on system.abilities.*.value), so these are the
    // post-build-ledger scores the sheet must display.
    derived["abilityScores"] = {
      str: scoreOf(abilities.str),
      dex: scoreOf(abilities.dex),
      con: scoreOf(abilities.con),
      int: scoreOf(abilities.int),
      wis: scoreOf(abilities.wis),
      cha: scoreOf(abilities.cha),
    };

    // Also update the cached mod on abilities (DEC-PF2-03: derived, but
    // the schema exposes `.mod` for items that reference it directly).
    // Ensure the abilities sub-object exists before writing back onto it —
    // otherwise this write would throw the same TypeError we just guarded
    // against above.
    if (!sys.abilities || typeof sys.abilities !== "object") {
      (sys as unknown as Record<string, unknown>)["abilities"] = {};
    }
    for (const ability of ["str", "dex", "con", "int", "wis", "cha"] as const) {
      const slot = sys.abilities[ability];
      if (!slot || typeof slot !== "object") {
        sys.abilities[ability] = { value: 10, mod: mods[ability] };
      } else {
        slot.mod = mods[ability];
      }
    }
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

    // ROBUSTNESS (audit issue 1): system.attributes.hp may be absent on a
    // minimal-but-schema-valid doc. Default to 0/0/0 rather than throwing —
    // a freshly created character with no authored HP simply derives 0 HP.
    const hp = sys.attributes?.hp as { value?: number; max?: number; temp?: number } | undefined;

    // Base HP max from stored value; if character was built with class+ancestry HP
    // the importer stores the total in attributes.hp.max already.
    // If ancestry HP info is stored separately, class HP per level × (level + conMod)
    // would be computed here — but for MVP the importer provides the total directly.
    const storedMax = hp?.max ?? 0;
    const storedValue = hp?.value ?? 0;

    // No drained reduction at base phase — applied in stepCharDrainedHp (derived).
    derived["hp"] = {
      value: Math.min(storedValue, storedMax),
      max: storedMax,
      temp: hp?.temp ?? 0,
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
    const doomedValue = sys.attributes?.doomed?.value ?? 0;
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
    const level = getLevel(sys);

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
    const level = getLevel(sys);

    const saveAbilities = {
      fortitude: "con",
      reflex: "dex",
      will: "wis",
    } as const;

    const saves: Record<string, DerivedStatistic> = {};
    // ROBUSTNESS (audit issue 1): system.saves may be entirely absent.
    const sysSaves = sys.saves ?? ({} as CharacterSystem["saves"]);

    for (const [saveName, ability] of Object.entries(saveAbilities) as [
      "fortitude" | "reflex" | "will",
      "con" | "dex" | "wis",
    ][]) {
      const rank = sysSaves[saveName]?.rank ?? 0;
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
    const level = getLevel(sys);
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
 * Derive all 16 canonical skills (REQ-PF2-012, DEC-R10-07) plus any
 * persisted Lore/custom skills found in `system.skills`.
 *
 * Untrained canonical skills (not present in `system.skills`, or present
 * with `rank: 0`) are ALWAYS derived — with base = abilityMod only (rank 0
 * contributes no proficiency bonus, REQ-PF2-011) — so the sheet can show and
 * roll all 16 skills even when the underlying document only stores the
 * trained ones. `derived.skills` therefore always has at least the 16
 * canonical slugs, plus any Lore/custom entries persisted in `system.skills`
 * that aren't among the 16 (e.g. "underworld-lore").
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
    const level = getLevel(sys);

    const skillsResult: Record<string, DerivedStatistic> = {};
    const persisted = sys.skills ?? {};

    const deriveOne = (slug: string, rank: number, isLore: boolean): DerivedStatistic => {
      // Determine key ability: Lore uses INT; canonical skills use SKILL_ABILITY map.
      const ability: string = isLore
        ? "int"
        : (SKILL_ABILITY[slug as keyof typeof SKILL_ABILITY] ?? "int");

      const mod = abilityMods?.[ability] ?? 0;
      const base = mod + proficiencyBonus(rank, level);

      // Selectors: specific "skill:acrobatics" + broad "skill-check"
      return resolveStatisticMulti(
        slug,
        base,
        [`skill:${slug}`, "skill-check"],
        ctx.synthetics,
        ctx.rollOptions,
      );
    };

    // All 16 canonical skills — always present, untrained (rank 0) if not
    // stored on the document (DEC-R10-07: every skill is shown and rollable).
    for (const slug of SKILL_SLUGS) {
      const stored = persisted[slug] as { rank?: number } | undefined;
      skillsResult[slug] = deriveOne(slug, stored?.rank ?? 0, false);
    }

    // Any additional persisted skills (Lore, or custom entries) not already
    // covered by the canonical 16.
    for (const [slug, skillData] of Object.entries(persisted)) {
      if (slug in skillsResult) continue;
      const rank = (skillData as { rank: number }).rank ?? 0;
      const isLore = (skillData as { lore?: boolean }).lore === true;
      skillsResult[slug] = deriveOne(slug, rank, isLore);
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
    const level = getLevel(sys);

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
// STEP 8b (derived phase): Archetype (dedication) class DCs
// REQ-PF2-016, DEC-R12-04
// ---------------------------------------------------------------------------

/**
 * Read `system.subfeatures.proficiencies.<slug>` off a feat item, tolerating
 * both `{ attribute, rank }` and partial/absent shapes. Returns null when
 * the feat carries no such subfeature block.
 */
function readArchetypeProficiency(
  itemSys: Record<string, unknown>,
): { slug: string; attribute?: string; rank?: number } | null {
  const subfeatures = itemSys["subfeatures"];
  if (!subfeatures || typeof subfeatures !== "object") return null;
  const profs = (subfeatures as Record<string, unknown>)["proficiencies"];
  if (!profs || typeof profs !== "object") return null;
  // The first (and, for dedications, only) key is the archetype slug.
  for (const [slug, raw] of Object.entries(profs as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const attribute = typeof entry["attribute"] === "string" ? entry["attribute"] : undefined;
    const rank = typeof entry["rank"] === "number" ? entry["rank"] : undefined;
    return { slug, ...(attribute ? { attribute } : {}), ...(rank !== undefined ? { rank } : {}) };
  }
  return null;
}

/**
 * Derive class DCs granted by archetype/multiclass dedication feats
 * (DEC-R12-04), separate from the base-class `classDC`.
 *
 * A dedication is detected as a feat item whose `system.category === "class"`
 * AND whose `system.traits.value` includes "dedication". Its class DC is
 * built from the feat's own `subfeatures.proficiencies.<slug>` block
 * (`{ attribute, rank }`), falling back to ARCHETYPE_KEY_ABILITY + Trained
 * (rank 1) when that block is absent (dedications always grant at least
 * Trained). Only dedications that actually grant a class-DC proficiency
 * (either via the subfeature block or a known ARCHETYPE_KEY_ABILITY entry)
 * produce an output row — a bare "flavor" dedication contributes nothing.
 *
 * total = abilityMod(attribute) + proficiencyBonus(rank, level); dc = 10 + total.
 *
 * Every read is guarded: this runs against RAW persisted docs (no Zod
 * defaults) and the r11 malformed-input posture applies — a feat authored
 * outside the schema must be skipped, never throw.
 *
 * Reads:  system.derived.abilityMods, system.level, doc.items (dedication feats)
 * Writes: system.derived.archetypeClassDCs
 */
export const stepCharArchetypeClassDCs: DeriveStep = {
  id: "pf2e.character.derived.archetypeClassDCs",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: ["system.derived.abilityMods", "system.level"],
  writes: ["system.derived.archetypeClassDCs"],

  run(doc) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);
    const abilityMods = derived["abilityMods"] as Record<string, number> | undefined;
    const level = getLevel(sys);

    const results: ArchetypeClassDC[] = [];
    const seen = new Set<string>();

    const rawItems = doc["items"];
    if (Array.isArray(rawItems)) {
      for (const raw of rawItems) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        if (item["type"] !== "feat") continue;

        const itemSys = (item["system"] as Record<string, unknown> | undefined) ?? {};
        if (itemSys["category"] !== "class") continue;

        const traitsBlock = itemSys["traits"] as { value?: unknown } | undefined;
        const traits = Array.isArray(traitsBlock?.value) ? (traitsBlock.value as unknown[]) : [];
        if (!traits.includes("dedication")) continue;

        const prof = readArchetypeProficiency(itemSys);
        const slug = prof?.slug;
        if (!slug) continue; // dedication grants no class-DC proficiency

        // Fallbacks: dedications grant Trained (rank 1); key ability from the
        // subfeature block, then the extensible map.
        const ability = prof.attribute ?? ARCHETYPE_KEY_ABILITY[slug];
        if (!ability) continue; // unknown key ability — cannot derive a DC
        const rank = prof.rank ?? 1;

        if (seen.has(slug)) continue;
        seen.add(slug);

        const mod = abilityMods?.[ability] ?? 0;
        const total = mod + proficiencyBonus(rank, level);
        results.push({
          slug,
          label: ARCHETYPE_LABEL[slug] ?? titleCaseSlug(slug),
          ability,
          rank,
          total,
          dc: 10 + total,
        });
      }
    }

    derived["archetypeClassDCs"] = results;
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
    const level = getLevel(sys);

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
 * Render a PURE rollable damage formula for `@dice-roller/rpg-dice-roller`
 * (CONTRACT 3) — no damage type in the text.
 *
 * `NdX+M` (or `NdX-M` for a negative bonus, or bare `NdX` when bonus is 0).
 */
function renderDamageRoll(dice: number, die: string, flatBonus: number): string {
  if (flatBonus === 0) return `${String(dice)}${die}`;
  const sign = flatBonus > 0 ? "+" : "";
  return `${String(dice)}${die}${sign}${String(flatBonus)}`;
}

/**
 * Render a PURE rollable critical damage formula (CONTRACT 3) — no damage
 * type in the text. Mirrors `renderCritDamageFormula`'s semantics: the base
 * pool is doubled, deadly adds one (undoubled) extra die outside the
 * doubling, and fatal adds one extra die of the fatal size outside the
 * doubling (fatal does NOT replace the base die — same as the display
 * formula above).
 */
function renderCritDamageRoll(
  dice: number,
  die: string,
  flatBonus: number,
  deadlyDie: string | undefined,
  fatalDie: string | undefined,
): string {
  const base = `(${renderDamageRoll(dice, die, flatBonus)})*2`;
  if (fatalDie !== undefined) return `${base}+1${fatalDie}`;
  if (deadlyDie !== undefined) return `${base}+1${deadlyDie}`;
  return base;
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
      const damageRoll = renderDamageRoll(
        descriptor.damageDice,
        descriptor.damageDie,
        descriptor.damageBonus,
      );
      const critDamageRoll = renderCritDamageRoll(
        descriptor.damageDice,
        descriptor.damageDie,
        descriptor.damageBonus,
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
        damageRoll,
        critDamageRoll,
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
  // Build-driven steps (base phase) run FIRST, before any consumer of
  // system.abilities/saves/perception/proficiencies/skills/attributes.hp —
  // they no-op entirely on r9 manual-entry actors (no embedded class item).
  stepCharBuildAbilities,
  stepCharApplyClass,
  stepCharBuildSkills,
  stepCharBuildHp,
  stepCharAbilityMods,
  stepCharCollectEquipment,
  stepCharHp,
  stepCharToughness,
  stepCharFocusClamp,
  stepCharDyingMax,
  stepCharAc,
  stepCharSaves,
  stepCharPerception,
  stepCharSkills,
  stepCharClassDC,
  stepCharArchetypeClassDCs,
  stepCharDrainedHp,
  stepCharStrikes,
  stepCharSpellcasting,
  stepCharSpeed,
  stepCharElementalBlasts,
];
