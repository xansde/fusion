/**
 * @fusion/system-pf2e — Build-driven character derivation steps.
 *
 * These steps only activate when the actor has an embedded `type: 'class'`
 * item (DEC-R10-01, DEC-R10-02, DEC-R10-07 / R10-A item 5). They compute
 * ability scores, class proficiency ranks, trained skills, and HP from the
 * structured `system.build` block + the class item's progression table,
 * and write the results back onto the SAME `system.*` paths the r9 manual
 * steps (stepCharAbilityMods, stepCharAc, stepCharSaves, stepCharPerception,
 * stepCharClassDC, stepCharSkills, stepCharHp) already read.
 *
 * This "inject upstream, reuse downstream" approach means the existing
 * derived-phase steps need zero changes to pick up build-driven numbers —
 * they just see already-updated `system.abilities/saves/perception/...`
 * values, exactly like a manually-authored r9 doc.
 *
 * Compat r9: every step in this file no-ops (returns immediately) when no
 * embedded `type: 'class'` item is found, leaving r9 manual-entry actors
 * completely untouched.
 *
 * Clean-room: ORC/OGL mechanics only (ability boost math, HP formula are
 * facts of the rule system). No Foundry code copied.
 * REQ-PF2-010, REQ-PF2-011, REQ-PF2-012, REQ-PF2-021, REQ-PF2-083.
 * Spec: 17-sistema-pf2e.md; DEC-R10-01/02/07 (.fusion-build/r10-plan.md).
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import type { DeriveStep } from "@fusion/system-api";
import type { CharacterSystem } from "../schemas/actor-character.js";
import type { ClassSystem, ClassSpellcasting } from "../schemas/item-equipment.js";
import { ABILITY_SLUGS, type AbilitySlug } from "../types.js";

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc["system"] as Record<string, unknown>) ?? {};
}

function getCharSystem(doc: Record<string, unknown>): CharacterSystem {
  return getSystem(doc) as unknown as CharacterSystem;
}

function getLevel(sys: CharacterSystem): number {
  const level = sys.level as { value?: number } | undefined;
  return level?.value ?? 1;
}

// ---------------------------------------------------------------------------
// Shared helper: find the embedded class item (if any)
// ---------------------------------------------------------------------------

interface RawItem {
  _id?: string;
  type?: string;
  name?: string;
  system?: Record<string, unknown>;
}

/**
 * Find the first embedded `type: 'class'` item on the document.
 *
 * The builder model (DEC-R10-01) supports at most one class item per
 * character for the MVP (multiclass archetypes are represented as feats,
 * not a second class item).
 */
function findClassItem(doc: Record<string, unknown>): ClassSystem | undefined {
  const rawItems = doc["items"];
  if (!Array.isArray(rawItems)) return undefined;
  for (const raw of rawItems as RawItem[]) {
    if (raw && typeof raw === "object" && raw.type === "class") {
      return (raw.system ?? {}) as unknown as ClassSystem;
    }
  }
  return undefined;
}

/** Find the first embedded `type: 'ancestry'` item's HP grant, if any. */
function findAncestryHp(doc: Record<string, unknown>): number | undefined {
  const rawItems = doc["items"];
  if (!Array.isArray(rawItems)) return undefined;
  for (const raw of rawItems as RawItem[]) {
    if (raw && typeof raw === "object" && raw.type === "ancestry") {
      const hp = (raw.system as { hp?: unknown } | undefined)?.hp;
      return typeof hp === "number" ? hp : undefined;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// STEP (base phase): ability scores from build boosts
// REQ-PF2-010. Gate: system.build?.abilities present AND a class item exists.
// ---------------------------------------------------------------------------

/**
 * PF2e Remaster ability boost math: base score 10; each boost adds +2 while
 * the running score is below 18, else +1; each flaw subtracts 2.
 *
 * Boosts/flaws are applied in a fixed origin order (ancestry boosts →
 * ancestry flaws → ancestry free boosts → background boosts → background
 * free boosts → class boost → levelled boosts up to the character's current
 * level, in level order) — this mirrors the PF2e Remaster character-creation
 * sequence (a fact of the rule system, not copyrighted prose).
 */
function computeAbilityScores(
  build: NonNullable<CharacterSystem["build"]>,
  level: number,
): Record<AbilitySlug, number> {
  const scores: Record<AbilitySlug, number> = {
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
  };

  const applyBoost = (slug: string): void => {
    if (!ABILITY_SLUGS.includes(slug as AbilitySlug)) return;
    const ability = slug as AbilitySlug;
    scores[ability] += scores[ability] < 18 ? 2 : 1;
  };
  const applyFlaw = (slug: string): void => {
    if (!ABILITY_SLUGS.includes(slug as AbilitySlug)) return;
    const ability = slug as AbilitySlug;
    scores[ability] -= 2;
  };

  // EVERY array read is guarded (`?? []`): this runs against RAW persisted
  // docs (no Zod defaults applied), and real-world ledgers carry only the
  // keys their dialogs have written so far — the user's actual Tobias had
  // backgroundFree/classBoost but NO backgroundBoosts key, which made the
  // unguarded iteration throw "abilities.backgroundBoosts is not iterable"
  // inside recomputeDerivedIfNeeded's try/catch and silently freeze the
  // stored derived (r11 live-verification finding). Degrade to "no boosts
  // from that origin" instead — same defensive posture as the rest of this
  // file's malformed-input handling.
  const abilities = build.abilities;
  for (const slug of abilities.ancestryBoosts ?? []) applyBoost(slug);
  for (const slug of abilities.ancestryFlaws ?? []) applyFlaw(slug);
  for (const slug of abilities.ancestryFree ?? []) applyBoost(slug);
  for (const slug of abilities.backgroundBoosts ?? []) applyBoost(slug);
  for (const slug of abilities.backgroundFree ?? []) applyBoost(slug);
  for (const slug of abilities.classBoost ?? []) applyBoost(slug);

  const levelledLevels = Object.keys(abilities.levelledBoosts ?? {})
    .map((lvl) => Number(lvl))
    .filter((lvl) => !Number.isNaN(lvl) && lvl <= level)
    .sort((a, b) => a - b);
  for (const lvl of levelledLevels) {
    const boosts = (abilities.levelledBoosts ?? {})[String(lvl)] ?? [];
    for (const slug of boosts) applyBoost(slug);
  }

  return scores;
}

/**
 * Overwrite `system.abilities.*.value` from the build's boost/flaw ledger.
 *
 * Runs in the "base" phase, BEFORE `stepCharAbilityMods` (which reads
 * `system.abilities.*.value` and computes `.mod`). This is the least
 * invasive injection point: downstream steps (AC, saves, perception,
 * classDC, strikes, skills) already read `system.derived.abilityMods`,
 * which stepCharAbilityMods computes from whatever is in `system.abilities`
 * at that point — so overwriting the raw scores here is sufficient to
 * propagate build-driven abilities through the entire pipeline unchanged.
 *
 * Gate: `system.build?.abilities` present AND an embedded `type:'class'`
 * item exists. Without both, this step no-ops (r9 manual abilities stand).
 *
 * Reads:  system.build, doc.items (class item presence)
 * Writes: system.abilities.*.value
 */
export const stepCharBuildAbilities: DeriveStep = {
  id: "pf2e.character.base.buildAbilities",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  reads: ["system.build", "system.level"],
  // NOTE: these must match the EXACT strings stepCharAbilityMods.reads uses
  // (topo-sort edges are exact-string membership tests, not path prefixes —
  // see packages/system-api/src/derive.ts topoSort()).
  writes: [
    "system.abilities.str.value",
    "system.abilities.dex.value",
    "system.abilities.con.value",
    "system.abilities.int.value",
    "system.abilities.wis.value",
    "system.abilities.cha.value",
  ],

  run(doc) {
    const sys = getCharSystem(doc);
    if (!sys.build?.abilities) return;
    if (!findClassItem(doc)) return;

    const level = getLevel(sys);
    const scores = computeAbilityScores(sys.build, level);

    if (!sys.abilities || typeof sys.abilities !== "object") {
      (sys as unknown as Record<string, unknown>)["abilities"] = {};
    }
    for (const ability of ABILITY_SLUGS) {
      const existing = sys.abilities[ability] as { mod?: number } | undefined;
      sys.abilities[ability] = { value: scores[ability], mod: existing?.mod ?? 0 };
    }
  },
};

// ---------------------------------------------------------------------------
// STEP (base phase): apply class proficiencies/HP-relevant fields
// Gate: an embedded type:'class' item exists.
// ---------------------------------------------------------------------------

/**
 * Resolve the effective rank for a given `stat` slug at `level`, starting
 * from the class's level-1 rank and applying any `proficiencyUpgrades`
 * entries for that stat with `level <= character level`, keeping the
 * highest rank seen (upgrades only ever increase rank; the highest entry
 * at-or-below the character's level is authoritative).
 */
function effectiveRank(
  initialRank: number,
  stat: string,
  upgrades: ClassSystem["proficiencyUpgrades"],
  level: number,
): number {
  let rank = initialRank;
  for (const upgrade of upgrades) {
    if (upgrade.stat === stat && upgrade.level <= level && upgrade.rank > rank) {
      rank = upgrade.rank;
    }
  }
  return rank;
}

/**
 * Apply the class item's level-1 proficiencies plus proficiencyUpgrades (at
 * or below the character's level) onto the same `system.*` paths the r9
 * derived steps already read: `system.details.keyAbility`,
 * `system.perception.rank`, `system.saves.*.rank`,
 * `system.proficiencies.classDC.rank`, `system.proficiencies.weapons.*`,
 * `system.proficiencies.armor.*`.
 *
 * `keyAbility` uses the FIRST entry of the class's `keyAbility` array. For
 * classes offering a choice (Magus offers STR or DEX), the builder UI
 * (R10-D) records the pick by narrowing the EMBEDDED class item's
 * `keyAbility` array to the chosen slug at apply time — the actor's item is
 * a copy of the pack document, so this never mutates the compendium. This
 * step then needs no choice-resolution logic of its own.
 *
 * Gate: an embedded `type:'class'` item exists. Without it, no-op (r9
 * manual proficiencies stand).
 *
 * Reads:  doc.items (class item), system.level
 * Writes: system.details.keyAbility, system.perception.rank,
 *         system.saves.*.rank, system.proficiencies.*
 */
export const stepCharApplyClass: DeriveStep = {
  id: "pf2e.character.base.applyClass",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  reads: ["system.level", "system.build"],
  // NOTE: exact strings matching what stepCharClassDC/stepCharPerception/
  // stepCharSaves/stepCharAc/stepCharStrikes declare in their own `reads`
  // (topo-sort edges are exact-string membership tests — see
  // packages/system-api/src/derive.ts topoSort()).
  writes: [
    "system.details.keyAbility",
    "system.perception.rank",
    "system.saves",
    "system.proficiencies.classDC",
    "system.proficiencies.armor",
    "system.proficiencies.weapons",
  ],

  run(doc) {
    const sys = getCharSystem(doc);
    const classSystem = findClassItem(doc);
    if (!classSystem) return;

    const level = getLevel(sys);
    const upgrades = classSystem.proficiencyUpgrades ?? [];

    // Key ability: the player's pick lives in build.abilities.classBoost
    // (chosen in the builder's boosts dialog — r11); the class item keeps
    // its FULL keyAbility option list, so keyAbility[0] is only the
    // fallback for docs without a recorded choice.
    // All classSystem.* sub-object reads below are guarded (`?.`/`??`):
    // findClassItem() casts raw.system without a Zod parse, so a class item
    // authored outside the schema (e.g. {system:{hp:8}}) must degrade to
    // rank-0 defaults instead of throwing mid-derive.
    const classBoostPick = sys.build?.abilities?.classBoost?.[0];
    const keyAbility = classBoostPick ?? classSystem.keyAbility?.[0];
    if (keyAbility) {
      if (!sys.details || typeof sys.details !== "object") {
        (sys as unknown as Record<string, unknown>)["details"] = {};
      }
      (sys.details as unknown as Record<string, unknown>)["keyAbility"] = keyAbility;
    }

    // Perception.
    const perceptionRank = effectiveRank(classSystem.perception ?? 0, "perception", upgrades, level);
    if (!sys.perception || typeof sys.perception !== "object") {
      (sys as unknown as Record<string, unknown>)["perception"] = { rank: 0, senses: [] };
    }
    sys.perception.rank = perceptionRank as CharacterSystem["perception"]["rank"];

    // Saving throws.
    if (!sys.saves || typeof sys.saves !== "object") {
      (sys as unknown as Record<string, unknown>)["saves"] = {
        fortitude: { rank: 0 },
        reflex: { rank: 0 },
        will: { rank: 0 },
      };
    }
    for (const save of ["fortitude", "reflex", "will"] as const) {
      const initial = classSystem.savingThrows?.[save] ?? 0;
      sys.saves[save] = {
        rank: effectiveRank(initial, save, upgrades, level) as CharacterSystem["saves"]["fortitude"]["rank"],
      };
    }

    // Class DC.
    if (!sys.proficiencies || typeof sys.proficiencies !== "object") {
      (sys as unknown as Record<string, unknown>)["proficiencies"] = {};
    }
    const classDcRank = effectiveRank(classSystem.classDC ?? 0, "classDC", upgrades, level);
    sys.proficiencies.classDC = {
      rank: classDcRank as CharacterSystem["proficiencies"]["classDC"]["rank"],
    };

    // Weapon category proficiencies (class `attacks` map = initial ranks).
    const weaponCategories = ["unarmed", "simple", "martial", "advanced"] as const;
    const existingWeapons = sys.proficiencies.weapons ?? {
      unarmed: 0,
      simple: 0,
      martial: 0,
      advanced: 0,
    };
    const weapons = { ...existingWeapons };
    for (const category of weaponCategories) {
      const initial = classSystem.attacks?.[category] ?? existingWeapons[category] ?? 0;
      weapons[category] = effectiveRank(
        initial,
        `weapons.${category}`,
        upgrades,
        level,
      ) as CharacterSystem["proficiencies"]["weapons"]["unarmed"];
    }
    sys.proficiencies.weapons = weapons;

    // Armor category proficiencies (class `defenses` map = initial ranks).
    const armorCategories = ["unarmored", "light", "medium", "heavy"] as const;
    const existingArmor = sys.proficiencies.armor ?? {
      unarmored: 0,
      light: 0,
      medium: 0,
      heavy: 0,
    };
    const armor = { ...existingArmor };
    for (const category of armorCategories) {
      const initial = classSystem.defenses?.[category] ?? existingArmor[category] ?? 0;
      armor[category] = effectiveRank(
        initial,
        `armor.${category}`,
        upgrades,
        level,
      ) as CharacterSystem["proficiencies"]["armor"]["unarmored"];
    }
    sys.proficiencies.armor = armor;
  },
};

// ---------------------------------------------------------------------------
// STEP (base phase): trained skills from class + build choices
// Gate: an embedded type:'class' item exists.
// ---------------------------------------------------------------------------

/**
 * Apply the class's initial trained skills (`trainedSkills.value`) plus any
 * `build.choices` of type "skillTraining"/"skillIncrease" with
 * `level <= character level`, onto `system.skills.<slug>.rank`.
 *
 * Merge policy: build-driven ranks are a FLOOR, not an override — the
 * effective rank is `max(manualRank, buildRank)`. This lets a GM hand-tune a
 * skill upward (e.g. via a homebrew bonus rank recorded manually) without
 * the builder silently reverting it, while still guaranteeing the build's
 * guaranteed training always applies even if the skill was previously
 * untrained (rank 0) in `system.skills`.
 *
 * `trainedSkills.additional` (free skill choices without a fixed slug) is
 * NOT resolved here — the actual skill slugs chosen for those free slots
 * are recorded as "skillTraining" build.choices by the builder UI (R10-D),
 * so by the time this step runs they are already concrete skill slugs in
 * `build.choices`. This step only reads slugs, never guesses.
 *
 * Gate: an embedded `type:'class'` item exists. Without it, no-op (r9
 * manual skill ranks stand).
 *
 * Reads:  doc.items (class item), system.build.choices, system.level
 * Writes: system.skills.<slug>.rank
 */
export const stepCharBuildSkills: DeriveStep = {
  id: "pf2e.character.base.buildSkills",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  reads: ["system.build", "system.level"],
  writes: ["system.skills"],

  run(doc) {
    const sys = getCharSystem(doc);
    const classSystem = findClassItem(doc);
    if (!classSystem) return;

    const level = getLevel(sys);
    if (!sys.skills || typeof sys.skills !== "object") {
      (sys as unknown as Record<string, unknown>)["skills"] = {};
    }

    const setFloor = (slug: string, rank: number): void => {
      const existing = sys.skills[slug] as { rank?: number; lore?: boolean } | undefined;
      const manualRank = existing?.rank ?? 0;
      const effective = Math.max(manualRank, rank) as CharacterSystem["skills"][string]["rank"];
      sys.skills[slug] = { rank: effective, ...(existing?.lore ? { lore: true } : {}) };
    };

    // Level-1 trained skills granted directly by the class.
    for (const slug of classSystem.trainedSkills?.value ?? []) {
      setFloor(slug, 1);
    }

    // Build choices: skillTraining (untrained → trained) / skillIncrease
    // (bump one rank), applied in level order so increases stack correctly.
    const choices = sys.build?.choices ?? [];
    const skillChoices = choices
      .filter(
        (c) =>
          (c.type === "skillTraining" || c.type === "skillIncrease") &&
          c.level <= level &&
          c.skill,
      )
      .sort((a, b) => a.level - b.level);

    for (const choice of skillChoices) {
      const slug = choice.skill;
      if (!slug) continue;
      // Explicit rank wins. Fallbacks: skillTraining → trained (1);
      // skillIncrease → one rank above the current effective rank, capped at
      // legendary (4). The builder UI normally records an explicit rank —
      // this fallback keeps a rank-less skillIncrease from being silently
      // ignored (audit r10-A, low issue 3).
      const current = (sys.skills[slug] as { rank?: number } | undefined)?.rank ?? 0;
      const targetRank =
        choice.rank ?? (choice.type === "skillTraining" ? 1 : Math.min(current + 1, 4));
      setFloor(slug, targetRank);
    }
  },
};

// ---------------------------------------------------------------------------
// STEP (base phase): HP from ancestry + class + build bonuses
// Gate: class item present AND (ancestry item present OR system.build present).
// ---------------------------------------------------------------------------

/**
 * Compute `hpMax = ancestryHp + (classHp + conMod) * level + bonusHp +
 * bonusHpPerLevel * level` and overwrite `system.attributes.hp.max` BEFORE
 * `stepCharHp` (base phase) reads it — same injection strategy as abilities:
 * write upstream, let the existing consumer read normally.
 *
 * conMod is read from `system.abilities.con.value` directly (computed with
 * the same formula as `abilityMod`, duplicated here as a tiny inline
 * `floor((score-10)/2)` to avoid a circular import from helpers.ts, which
 * would need to reach back into build.ts — kept self-contained instead).
 * Runs AFTER `stepCharBuildAbilities` because this step's `reads` includes
 * the exact string "system.abilities.con.value" that stepCharBuildAbilities
 * declares in `writes` — topo-sort orders by reads/writes edges
 * (packages/system-api/src/derive.ts topoSort()), NOT by declaration order
 * in CHARACTER_DERIVE_STEPS — so the CON score used here already reflects
 * build-driven ability boosts.
 *
 * Gate: an embedded `type:'class'` item exists AND (an embedded
 * `type:'ancestry'` item exists OR `system.build` is present). Without a
 * class item, this step no-ops entirely and `stepCharHp` uses the r9
 * manually-authored `system.attributes.hp.max` untouched.
 *
 * Reads:  doc.items (class + ancestry), system.build, system.abilities.con,
 *         system.level
 * Writes: system.attributes.hp.max
 */
export const stepCharBuildHp: DeriveStep = {
  id: "pf2e.character.base.buildHp",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  // "system.abilities.con.value" must match stepCharBuildAbilities.writes'
  // exact string so this step is ordered after it (topo-sort edges are
  // exact-string membership tests — see packages/system-api/src/derive.ts).
  reads: ["system.build", "system.abilities.con.value", "system.level"],
  writes: ["system.attributes.hp"],

  run(doc) {
    const sys = getCharSystem(doc);
    const classSystem = findClassItem(doc);
    if (!classSystem) return;

    const ancestryHp = findAncestryHp(doc);
    if (ancestryHp === undefined && !sys.build) return;

    const level = getLevel(sys);
    const conScore = sys.abilities?.con?.value ?? 10;
    const conMod = Math.floor((conScore - 10) / 2);

    const bonusHp = sys.build?.bonusHp ?? 0;
    const bonusHpPerLevel = sys.build?.bonusHpPerLevel ?? 0;

    const hpMax =
      (ancestryHp ?? 0) + ((classSystem.hp ?? 0) + conMod) * level + bonusHp + bonusHpPerLevel * level;

    if (!sys.attributes || typeof sys.attributes !== "object") {
      (sys as unknown as Record<string, unknown>)["attributes"] = {};
    }
    const existingHp = sys.attributes.hp as { value?: number; temp?: number } | undefined;
    sys.attributes.hp = {
      value: existingHp?.value ?? hpMax,
      max: hpMax,
      temp: existingHp?.temp ?? 0,
    };
  },
};

// ---------------------------------------------------------------------------
// STEP (base phase): focus points clamp (REQ-PF2-083, DEC-R10-02)
// Always active (not gated by class item) — a second guard on top of the
// schema's `.max(3)` bound, per the A1 report's double-guard design.
// ---------------------------------------------------------------------------

/**
 * Clamp `system.resources.focusPoints.max` to 3 and `.value` to the
 * (already-clamped) max. REQ-PF2-083 / DEC-R10-02.
 *
 * Unlike the other steps in this file, this one is NOT gated by the
 * presence of a class item — the 3-point focus pool cap is a hard PF2e
 * Remaster rule that applies to every character, build-driven or manual.
 *
 * Reads:  system.resources.focusPoints
 * Writes: system.resources.focusPoints
 */
export const stepCharFocusClamp: DeriveStep = {
  id: "pf2e.character.base.focusClamp",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  reads: ["system.resources"],
  writes: ["system.resources"],

  run(doc) {
    const sys = getCharSystem(doc);
    const focus = sys.resources?.focusPoints as { value?: number; max?: number } | undefined;
    if (!focus) return;

    const clampedMax = Math.min(3, focus.max ?? 0);
    const clampedValue = Math.min(focus.value ?? 0, clampedMax);

    if (!sys.resources || typeof sys.resources !== "object") {
      (sys as unknown as Record<string, unknown>)["resources"] = {};
    }
    sys.resources.focusPoints = { value: clampedValue, max: clampedMax };
  },
};

// ---------------------------------------------------------------------------
// Pure helper: spell slots for a given character level from a class's
// spellcasting progression table (consumed by the R10-D client builder and
// unit-tested here in isolation).
// ---------------------------------------------------------------------------

/**
 * Resolve the number of cantrips known and spell slots per rank for a given
 * character level, from a `ClassSpellcasting` progression table.
 *
 * Looks up the ENTRY WHOSE `level` EXACTLY equals `characterLevel` in both
 * `cantripsKnown` and `slots` (the class's progression table is expected to
 * carry one entry per level, mirroring the vendor's per-level cantrip/slot
 * tables). If no entry exists for that exact level (e.g. a level below the
 * class's first spellcasting level), falls back to the highest entry at or
 * below `characterLevel`, and to 0/empty when none qualify.
 *
 * Pure and side-effect free — safe for reuse by the client builder VM to
 * preview a level-up's spellcasting slots before committing.
 */
export function spellSlotsForLevel(
  progression: ClassSpellcasting,
  characterLevel: number,
): { cantripsKnown: number; slotsByRank: Record<string, number> } {
  const bestAtOrBelow = <T extends { level: number }>(entries: T[]): T | undefined => {
    let best: T | undefined;
    for (const entry of entries) {
      if (entry.level <= characterLevel && (!best || entry.level > best.level)) {
        best = entry;
      }
    }
    return best;
  };

  const cantripEntry = bestAtOrBelow(progression.cantripsKnown ?? []);
  const slotEntry = bestAtOrBelow(progression.slots ?? []);

  return {
    cantripsKnown: cantripEntry?.count ?? 0,
    slotsByRank: slotEntry?.slots ?? {},
  };
}

// ---------------------------------------------------------------------------
// All build-driven character derivation steps (base phase). Execution order
// relative to the r9 consumer steps is enforced by reads/writes edges in
// topoSort (packages/system-api/src/derive.ts) — NOT by this array's order.
// ---------------------------------------------------------------------------

export const BUILD_DERIVE_STEPS: DeriveStep[] = [
  stepCharBuildAbilities,
  stepCharApplyClass,
  stepCharBuildSkills,
  stepCharBuildHp,
  stepCharFocusClamp,
];
