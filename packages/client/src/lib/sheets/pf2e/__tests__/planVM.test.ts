/**
 * planVM.test.ts — Unit tests for the PF2e level-by-level character builder
 * ("Plano" column) pure view-model.
 *
 * Tests are 100% headless (no PIXI, no Svelte, no browser APIs) and validate
 * every generated op against the real wire Zod schemas from @fusion/shared,
 * mirroring the protocol established by characterSheetVM.test.ts.
 *
 * REQ-PF2-010, REQ-PF2-011, REQ-PF2-012, REQ-PF2-083.
 * Spec: 17-sistema-pf2e.md; DEC-R10-01/05/08 (.fusion-build/r10-plan.md).
 */

import { describe, it, expect } from "vitest";
import {
  derivePlan,
  planContext,
  isFeatEligible,
  isClassChoiceOption,
  spellSlotsForLevel,
  computeAbilityScores,
  applyClass,
  applyAncestry,
  applyHeritage,
  applyBackground,
  chooseFeat,
  isFeatAtRepeatCap,
  chooseClassChoice,
  chooseSkillTraining,
  chooseSkillIncrease,
  setAbilityBoosts,
  markAbilityBoostsChoice,
  abilityBoostsSlotContext,
  isAbilityBoostsSlotFilled,
  setFreeArchetype,
  removeChoice,
  classGrantRefsFromClassDoc,
  levelUp,
  levelSet,
  skillTrainingDialogContext,
  confirmSkillTraining,
  addLoreSkill,
  skillProficiencyBonus,
  previewAbilityScores,
  grantedFeatChoiceFor,
  matchesGrantedFeatFilter,
  ancestryChoiceGrantFor,
  isAncestryAdoptable,
  chooseAdoptedAncestry,
  detailsRequestForSlot,
  detailsRequestForAutoFeature,
  findEntryUuidByName,
  resolveDetailsEntryUuid,
  pickDefaultEntryUuid,
  buildContentNameTranslator,
  abilityBoostsGrid,
  ABILITY_GRID_ORDER,
  planGhostEntryCleanup,
  healGranterRefs,
  actorSpellEntries,
  classFeatureGrantRefs,
  classGrantSlot,
  backgroundLoreHealOps,
  readBackgroundTrainings,
  loreSlug,
  detailsRequestForAbcChip,
  checkFeatPrerequisites,
  _knownPossessedNamesForTests,
  CLASS_CHOICE_SLOTS,
  CLASS_CHOICE_SLOT_OPTIONS,
  type PlanOpBuilderContext,
  type AbcChip,
  type PlanSlotModel,
  type FeatDocLike,
  type PlanIndexEntryLike,
  type PlanNameIndexEntry,
} from "../planVM.js";
import type { DocUpdatePayload } from "../characterSheetVM.js";
import {
  DocCreatePayloadSchema,
  DocUpdatePayloadSchema,
  DocDeletePayloadSchema,
} from "@fusion/shared";
import {
  ABILITY_HELP,
  SKILL_HELP,
  LORE_HELP,
  TEML_LEGEND,
  skillHelpFor,
  abilityHelpFor,
} from "../../../../components/sheets/pf2e/plan/abilitySkillHelp.js";

// ---------------------------------------------------------------------------
// Real compendium fixtures (systems/pf2e/packs/*-core/documents.json,
// R10-B). Kept minimal but structurally faithful — these are the exact
// shapes the op builders receive from the compendium picker.
// ---------------------------------------------------------------------------

function magusClassDoc(): Record<string, unknown> {
  return {
    _id: "fk29yXFinPhreKL0",
    name: "Magus",
    type: "class",
    img: "icons/placeholder/feat.svg",
    system: {
      attacks: { advanced: 0, martial: 1, simple: 1, unarmed: 1 },
      defenses: { heavy: 0, light: 1, medium: 1, unarmored: 1 },
      description: "",
      hp: 8,
      keyAbility: ["dex", "str"],
      perception: 1,
      savingThrows: { fortitude: 2, reflex: 1, will: 2 },
      skillIncreaseLevels: [3, 5, 7, 9, 11, 13, 15, 17, 19],
      spellcasting: {
        tradition: "arcane",
        type: "prepared",
        ability: "int",
        cantripsKnown: [{ level: 1, count: 5 }],
        slots: [
          { level: 1, slots: { "1": 1 } },
          { level: 2, slots: { "1": 2 } },
          { level: 3, slots: { "1": 2, "2": 1 } },
        ],
      },
      trainedSkills: { value: ["arcana"], additional: 2 },
      traits: { rarity: "common", value: [] },
      // Every class is Trained in its own class DC (final r10 audit issue #1
      // — keep in sync with the corrected pack default in transform.mjs).
      classDC: 1,
      featLevels: {
        ancestry: [1, 5, 9, 13, 17],
        class: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
        general: [3, 7, 11, 15, 19],
        skill: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
      },
      proficiencyUpgrades: [],
      featuresByLevel: [
        { level: 1, uuid: "xvC1jNDkNdNtZQiF", name: "Arcane Spellcasting (Magus)" },
        { level: 1, uuid: "pf6KyAB13Qf5GQ9Q", name: "Arcane Cascade" },
        { level: 1, uuid: "sy7rtPbt8x4XsYkp", name: "Spellstrike" },
        { level: 1, uuid: "YQVqWitPCozoffq5", name: "Hybrid Study" },
        { level: 1, uuid: "4TibtVUC1A4nu3lj", name: "Conflux Spells" },
        { level: 5, uuid: "LVADu3YwnAamOx70", name: "Weapon Expertise" },
      ],
    },
    flags: { fusion: { conversion: "full", sourceId: "HQBA9Yx2s8ycvz3C" } },
  };
}

/**
 * Minimal class docs (r21-W1) — only the fields buildLevelPlan/derivePlan
 * actually read (`featuresByLevel`, `type: "class"`); every other
 * ClassSystemLike field is optional and defaults safely (see planVM.ts's
 * ClassSystemLike). `featuresByLevel[level 1]` names are copied VERBATIM from
 * systems/pf2e/packs/classes-core/documents.json (measured, not invented) so
 * CLASS_CHOICE_SLOTS's placeholder-name lookup is exercised against the real
 * vendor string, apostrophe included.
 */
function barbarianClassDoc(): Record<string, unknown> {
  return {
    _id: "class-barbarian",
    name: "Barbarian",
    type: "class",
    system: {
      featuresByLevel: [
        { level: 1, uuid: "uuid-instinct", name: "Instinct" },
        { level: 1, uuid: "uuid-rage", name: "Rage" },
        { level: 1, uuid: "uuid-quick-tempered", name: "Quick-Tempered" },
      ],
    },
  };
}

function rogueClassDoc(): Record<string, unknown> {
  return {
    _id: "class-rogue",
    name: "Rogue",
    type: "class",
    system: {
      featuresByLevel: [
        { level: 1, uuid: "uuid-racket", name: "Rogue's Racket" },
        { level: 1, uuid: "uuid-sneak-attack", name: "Sneak Attack" },
        { level: 1, uuid: "uuid-surprise-attack", name: "Surprise Attack" },
      ],
    },
  };
}

function rangerClassDoc(): Record<string, unknown> {
  return {
    _id: "class-ranger",
    name: "Ranger",
    type: "class",
    system: {
      featuresByLevel: [
        { level: 1, uuid: "uuid-hunters-edge", name: "Hunter's Edge" },
        { level: 1, uuid: "uuid-hunt-prey", name: "Hunt Prey" },
      ],
    },
  };
}

function wizardClassDoc(): Record<string, unknown> {
  return {
    _id: "class-wizard",
    name: "Wizard",
    type: "class",
    system: {
      featuresByLevel: [
        { level: 1, uuid: "uuid-wizard-spellcasting", name: "Wizard Spellcasting" },
        { level: 1, uuid: "uuid-arcane-school", name: "Arcane School" },
        { level: 1, uuid: "uuid-arcane-bond", name: "Arcane Bond" },
        { level: 1, uuid: "uuid-arcane-thesis", name: "Arcane Thesis" },
      ],
    },
  };
}

function fighterClassDoc(): Record<string, unknown> {
  return {
    _id: "class-fighter",
    name: "Fighter",
    type: "class",
    system: {
      featuresByLevel: [
        { level: 1, uuid: "uuid-reactive-strike", name: "Reactive Strike" },
        { level: 1, uuid: "uuid-shield-block", name: "Shield Block" },
      ],
    },
  };
}

/**
 * Real Bard class doc (systems/pf2e/packs/classes-core/documents.json,
 * verbatim level-1 featuresByLevel + spellcasting table) — used to cover
 * defect 1 (Bard's "Composition Spells" level-1 feature must grant a focus
 * pool, occult tradition/cha ability, same as its own `spellcasting` block).
 */
function bardClassDoc(): Record<string, unknown> {
  return {
    _id: "RtdtWLmWtoAnurXp",
    name: "Bard",
    type: "class",
    system: {
      keyAbility: ["cha"],
      spellcasting: {
        tradition: "occult",
        type: "spontaneous",
        ability: "cha",
        cantripsKnown: [{ level: 1, count: 5 }],
        slots: [{ level: 1, slots: { "1": 2 } }],
      },
      featuresByLevel: [
        { level: 1, uuid: "IPkRrReHUSAhWrb3", name: "Spell Repertoire" },
        { level: 1, uuid: "Kj1d35aAxgbTMvMH", name: "Composition Spells" },
        { level: 1, uuid: "7eBIHN2oYLJ81B4I", name: "Muses" },
        { level: 1, uuid: "PXvWhbENzMQMijDB", name: "Occult Spellcasting" },
      ],
    },
  };
}

/**
 * Real Champion class doc — has NO `spellcasting` block at all (verified
 * against the vendor pack + curation/classes/champion.json's deliberate
 * `"spellcasting": null`), yet grants a focus pool via the level-1
 * "Devotion Spells" feature (divine tradition, Charisma ability — core
 * rules text). Covers defect 1's second, harder half: `hasFocusFeature`
 * finding the feature is not enough on its own when there's no
 * `spellcasting.tradition` to gate on.
 */
function championClassDoc(): Record<string, unknown> {
  return {
    _id: "YPn8O9OwbqDx8bRa",
    name: "Champion",
    type: "class",
    system: {
      keyAbility: ["dex", "str"],
      featuresByLevel: [
        { level: 1, uuid: "2zmRjnSK4X2ScHWJ", name: "Deity (Champion)" },
        { level: 1, uuid: "G95Xci9mfJ6PTALk", name: "Cause" },
        { level: 1, uuid: "wBba2TDXECeWhXXn", name: "Devotion Spells" },
        { level: 1, uuid: "MbMJIRm8Ecdwk7pi", name: "Shield Block" },
      ],
    },
  };
}

/**
 * Real Sorcerer class doc — `spellcasting.tradition` is `null` (bloodline-
 * deferred, r22) and `traditionByBloodline` carries all 18 real lineages
 * verbatim from the vendor pack, `draconic: null` included (the one lineage
 * with no resolved tradition in the data — falls back to "arcane", see
 * `resolveBloodlineTradition`).
 */
function sorcererClassDoc(): Record<string, unknown> {
  return {
    _id: "Gj4x9YABawAwNRrp",
    name: "Sorcerer",
    type: "class",
    system: {
      keyAbility: ["cha"],
      spellcasting: {
        tradition: null,
        type: "spontaneous",
        ability: "cha",
        cantripsKnown: [{ level: 1, count: 5 }],
        slots: [{ level: 1, slots: { "1": 2 } }],
        traditionByBloodline: {
          aberrant: "occult",
          aesir: "divine",
          angelic: "divine",
          demonic: "divine",
          diabolic: "divine",
          draconic: null,
          elemental: "primal",
          fey: "primal",
          genie: "arcane",
          hag: "occult",
          harrow: "occult",
          imperial: "arcane",
          nymph: "primal",
          phoenix: "primal",
          psychopomp: "divine",
          shadow: "occult",
          undead: "divine",
          wyrmblessed: "divine",
        },
      },
      featuresByLevel: [
        { level: 1, uuid: "IPkRrReHUSAhWrb3", name: "Spell Repertoire" },
        { level: 1, uuid: "jAAzTvbs12s8pHtT", name: "Sorcerous Potency" },
        { level: 1, uuid: "FMCbwY7W87AHaS48", name: "Sorcerer Spellcasting" },
        { level: 1, uuid: "LsAiWeNtI6QMpBqZ", name: "Bloodline" },
        { level: 1, uuid: "J6Cm1EsbCKXRHMW2", name: "Bloodline Spells" },
      ],
    },
  };
}

/** A "Bloodline: <Name>" classFeature doc (class-features-core shape) for `chooseClassChoice(ctx, "bloodline", 1, doc)`. */
function bloodlineFeatureDoc(name: string): Record<string, unknown> {
  return {
    _id: `bloodline-${name.toLowerCase()}`,
    name: `Bloodline: ${name}`,
    type: "classFeature",
    system: {
      category: "classfeature",
      traits: { rarity: "common", value: ["sorcerer"] },
    },
  };
}

function ratfolkAncestryDoc(): Record<string, unknown> {
  return {
    _id: "3FBntMsNiVE09eEx",
    name: "Ratfolk",
    type: "ancestry",
    img: "icons/placeholder/feat.svg",
    system: {
      boosts: ["dex", "int", "free"],
      flaws: ["str"],
      hp: 6,
      size: "sm",
      speed: 25,
      traits: { rarity: "uncommon", value: ["humanoid", "ratfolk"] },
      vision: "low-light-vision",
    },
    flags: { fusion: { conversion: "full" } },
  };
}

function fleshwarpAncestryDoc(): Record<string, unknown> {
  return {
    _id: "mIPhGOdhzDGvbu5m",
    name: "Fleshwarp",
    type: "ancestry",
    img: "icons/placeholder/feat.svg",
    system: {
      boosts: ["free", "free"],
      flaws: [],
      hp: 10,
      size: "med",
      speed: 25,
      traits: { rarity: "uncommon", value: ["aberration", "humanoid"] },
      vision: "darkvision",
    },
    flags: { fusion: { conversion: "full" } },
  };
}

/** Fleshwarp-tagged ancestry feat, same shape as cheekPouchesAncestryFeatDoc (which is Ratfolk-tagged) — used to prove an ADOPTED ancestry's own feats become eligible in the ancestryFeat slot, not just the character's real ancestry's. */
function fleshwarpUnusualAnatomyAncestryFeatDoc(): Record<string, unknown> {
  return {
    _id: "feat-unusual-anatomy",
    name: "Unusual Anatomy",
    type: "feat",
    system: {
      category: "ancestry",
      level: 1,
      traits: { rarity: "common", value: ["fleshwarp"] },
    },
  };
}

function snowRatHeritageDoc(): Record<string, unknown> {
  return {
    _id: "heritage-snow-rat",
    name: "Snow Rat",
    type: "heritage",
    img: "icons/placeholder/feat.svg",
    system: { traits: { rarity: "common", value: ["ratfolk"] } },
    flags: { fusion: { conversion: "full" } },
  };
}

function fireworksPerformerBackgroundDoc(): Record<string, unknown> {
  return {
    _id: "XGTsuhOCcthVvoFt",
    name: "Fireworks Performer",
    type: "background",
    img: "icons/placeholder/feat.svg",
    system: {
      boosts: ["free", "free"],
      trainedSkills: { custom: "", lore: ["Fireworks Lore"], value: ["performance"] },
      traits: { rarity: "common", value: [] },
      skills: { performance: { value: 1 } },
    },
    flags: { fusion: { conversion: "full" } },
  };
}

function arcaneFistsFeatDoc(): Record<string, unknown> {
  // Magus class feat (level 1, category "class", trait "magus").
  return {
    _id: "LnqNcjwgAeuFwU1B",
    name: "Arcane Fists",
    type: "feat",
    img: "icons/placeholder/feat.svg",
    system: {
      actionType: "passive",
      actions: null,
      category: "class",
      description: "",
      level: 1,
      prerequisites: [],
      rules: [],
      traits: { rarity: "common", value: ["magus"] },
    },
  };
}

/**
 * "Acupuncturist" — real feats-core skill feat, NO `system.maxTakable`
 * (defect W2 frente 1: this exact feat was reported pickable twice).
 * `flags.fusion.sourceId` mirrors the real vendor-stamped value from
 * systems/pf2e/packs/feats-core/documents.json.
 */
function acupuncturistFeatDoc(): Record<string, unknown> {
  return {
    _id: "M8xeH0tnP75X0DFY",
    name: "Acupuncturist",
    type: "feat",
    system: {
      category: "skill",
      level: 1,
      prerequisites: [{ value: "trained in Medicine" }],
      traits: { rarity: "common", value: ["downtime", "manipulate"] },
    },
    flags: { fusion: { sourceId: "SC95hfEEHQs7E9cG" } },
  };
}

/**
 * "Armor Proficiency" — real feats-core general feat with `system.maxTakable:
 * 3` (one of only two feats in the pack that carry a numeric maxTakable — W2
 * frente 1 task rule 3: "verifique com um feat real do pack"). Repeatable up
 * to 3 times.
 */
function armorProficiencyFeatDoc(): Record<string, unknown> {
  return {
    _id: "1vyVMmsWAgpqsxd7",
    name: "Armor Proficiency",
    type: "feat",
    system: {
      category: "general",
      level: 1,
      maxTakable: 3,
      prerequisites: [],
      traits: { rarity: "common", value: [] },
    },
    flags: { fusion: { sourceId: "BStw1cANwx5baL6d" } },
  };
}

/** An embedded copy of `featDoc` as it would sit on the actor's `items` array after being chosen via chooseFeat. */
function embeddedFeatItem(
  featDoc: Record<string, unknown>,
  itemId: string,
  build: { level: number; slot: string },
): Record<string, unknown> {
  const { _id: _drop, flags, ...rest } = featDoc;
  const existingFusion = (flags as Record<string, unknown> | undefined)?.["fusion"] as
    | Record<string, unknown>
    | undefined;
  return {
    ...rest,
    _id: itemId,
    flags: { fusion: { ...existingFusion, build } },
  };
}

function cheekPouchesAncestryFeatDoc(): Record<string, unknown> {
  return {
    _id: "feat-cheek-pouches",
    name: "Cheek Pouches",
    type: "feat",
    system: {
      category: "ancestry",
      level: 1,
      traits: { rarity: "common", value: ["ratfolk"] },
    },
  };
}

function adoptedAncestryGeneralFeatDoc(): Record<string, unknown> {
  return {
    _id: "feat-adopted-ancestry",
    name: "Adopted Ancestry",
    type: "feat",
    system: {
      category: "general",
      level: 1,
      traits: { rarity: "common", value: ["general"] },
    },
  };
}

function speedrunStratsSkillFeatDoc(): Record<string, unknown> {
  return {
    _id: "feat-speedrun-strats",
    name: "Speedrun Strats",
    type: "feat",
    system: {
      category: "skill",
      level: 1,
      traits: { rarity: "common", value: [] },
    },
  };
}

function alchemistDedicationFeatDoc(): Record<string, unknown> {
  return {
    _id: "feat-alchemist-dedication",
    name: "Alchemist Dedication",
    type: "feat",
    system: {
      category: "class",
      level: 2,
      traits: { rarity: "common", value: ["archetype", "dedication", "multiclass"] },
    },
  };
}

/**
 * Basic Concoction (W1-D) — real fixture from systems/pf2e/packs/feats-core/
 * documents.json: "You gain a 1st- or 2nd-level alchemist feat." Category
 * "class", trait "archetype" (NOT "alchemist" — the GRANTING feat's own
 * traits are unrelated to the traits of what it grants), level 4. Its
 * `rules[]` carries the vendor's `grant-item` pointed at an unresolved
 * ChoiceSet placeholder (`{item|flags.system.rulesSelections.basicConcoction}`)
 * — confirmed unconverted in `flags.fusion.unconvertedRules` (kind
 * "ChoiceSet", filter `["item:category:class","item:trait:alchemist",
 * {"lte":["item:level",2]}]`) — this fixture keeps that shape verbatim so the
 * grant lookup is exercised against the exact vendor data, not an
 * approximation.
 */
function basicConcoctionFeatDoc(): Record<string, unknown> {
  return {
    _id: "bduri70co98T1fwA",
    name: "Basic Concoction",
    type: "feat",
    img: "icons/placeholder/feat.svg",
    system: {
      actionType: "passive",
      actions: null,
      category: "class",
      description: "<p>You gain a 1st- or 2nd-level alchemist feat.</p>",
      level: 4,
      prerequisites: [{ value: "Alchemist Dedication" }],
      rules: [
        {
          kind: "grant-item",
          slug: null,
          label: null,
          uuid: "{item|flags.system.rulesSelections.basicConcoction}",
          inMemoryOnly: false,
          predicate: null,
          alterations: [],
          priority: null,
        },
      ],
      traits: { rarity: "common", value: ["archetype"] },
    },
    flags: {
      fusion: {
        conversion: "partial",
        unconvertedRules: [
          {
            adjustName: false,
            choices: {
              filter: ["item:category:class", "item:trait:alchemist", { lte: ["item:level", 2] }],
              itemType: "feat",
            },
            flag: "basicConcoction",
            key: "ChoiceSet",
            prompt: "PF2E.SpecificRule.Prompt.LevelOneOrTwoClassFeat",
          },
        ],
      },
    },
  };
}

/** A 1st-level alchemist class feat — satisfies Basic Concoction's grant filter (category:class, trait:alchemist, level<=2). */
function alchemicalFamiliarFeatDoc(): Record<string, unknown> {
  return {
    _id: "feat-alchemical-familiar",
    name: "Alchemical Familiar",
    type: "feat",
    system: {
      category: "class",
      level: 1,
      traits: { rarity: "common", value: ["alchemist"] },
    },
  };
}

/** A general feat — does NOT satisfy Basic Concoction's grant filter (wrong category, no alchemist trait). Used to assert the filter rejects it. */
function ineligibleGeneralFeatDoc(): Record<string, unknown> {
  return {
    _id: "feat-ineligible-general",
    name: "Fleet",
    type: "feat",
    system: {
      category: "general",
      level: 1,
      traits: { rarity: "common", value: [] },
    },
  };
}

/** Narrow a compendium fixture doc's `system` block down to the minimal FeatDocLike shape `matchesGrantedFeatFilter`/`isFeatEligible` consume — cast is safe, every fixture in this file fully populates category/level/traits. */
function asFeatDocLike(doc: Record<string, unknown>): FeatDocLike {
  return {
    system: doc["system"] as { category: string; level: number; traits: { value: string[] } },
  };
}

function starlitSpanHybridStudyDoc(): Record<string, unknown> {
  return {
    _id: "RD63JAZ4zd2UvGQ4",
    name: "Starlit Span",
    type: "classFeature",
    system: {
      actionType: { value: "passive" },
      actions: { value: null },
      category: "hybridStudy",
      description: "",
      level: 1,
      prerequisites: [],
      rules: [],
      traits: { otherTags: ["magus-hybrid-study"], rarity: "common", value: ["magus"] },
    },
  };
}

// ---------------------------------------------------------------------------
// Actor doc fixtures
// ---------------------------------------------------------------------------

function baseCharacterDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "actor-tobias",
    name: "Tobias",
    type: "character",
    items: [],
    system: {
      level: { value: 1 },
      details: {},
    },
    ...overrides,
  };
}

/** Tobias at level 3 with the Magus class embedded + level 1/2/3 choices made. */
function tobiasLevel3Doc(): Record<string, unknown> {
  return {
    _id: "actor-tobias",
    name: "Tobias",
    type: "character",
    items: [
      { ...ratfolkAncestryDoc(), _id: "item-ancestry" },
      { ...snowRatHeritageDoc(), _id: "item-heritage" },
      { ...fireworksPerformerBackgroundDoc(), _id: "item-background" },
      { ...magusClassDoc(), _id: "item-class" },
      {
        ...cheekPouchesAncestryFeatDoc(),
        _id: "item-ancestry-feat-1",
        flags: { fusion: { build: { level: 1, slot: "ancestryFeat-1" } } },
      },
      {
        ...starlitSpanHybridStudyDoc(),
        _id: "item-hybrid-study-1",
        flags: { fusion: { build: { level: 1, slot: "hybridStudy-1" } } },
      },
      {
        ...arcaneFistsFeatDoc(),
        _id: "item-class-feat-2",
        flags: { fusion: { build: { level: 2, slot: "classFeat-2" } } },
      },
      {
        ...speedrunStratsSkillFeatDoc(),
        _id: "item-skill-feat-2",
        system: {
          ...(speedrunStratsSkillFeatDoc()["system"] as Record<string, unknown>),
          level: 2,
        },
        flags: { fusion: { build: { level: 2, slot: "skillFeat-2" } } },
      },
      {
        ...alchemistDedicationFeatDoc(),
        _id: "item-archetype-feat-2",
        flags: { fusion: { build: { level: 2, slot: "archetypeFeat-2" } } },
      },
      {
        ...adoptedAncestryGeneralFeatDoc(),
        _id: "item-general-feat-3",
        system: {
          ...(adoptedAncestryGeneralFeatDoc()["system"] as Record<string, unknown>),
          level: 3,
        },
        flags: { fusion: { build: { level: 3, slot: "generalFeat-3" } } },
      },
    ],
    system: {
      level: { value: 3 },
      details: {},
      build: {
        abilities: {
          ancestryBoosts: ["dex", "int"],
          ancestryFlaws: ["str"],
          ancestryFree: ["cha"],
          backgroundBoosts: [],
          classBoost: ["int"],
          levelledBoosts: {},
        },
        choices: [
          { level: 1, slot: "abilityBoosts-1", type: "abilityBoosts" },
          { level: 1, slot: "skillTraining-1-0", type: "skillTraining", skill: "stealth", rank: 1 },
          {
            level: 1,
            slot: "skillTraining-1-1",
            type: "skillTraining",
            skill: "thievery",
            rank: 1,
          },
          { level: 3, slot: "skillIncrease-3", type: "skillIncrease", skill: "stealth", rank: 2 },
        ],
        bonusHp: 0,
        bonusHpPerLevel: 0,
        freeArchetype: true,
      },
    },
  };
}

/**
 * Tobias level 3 with a COMPLETE ability-boost ledger (R11 fixture — every
 * origin filled in, per the task prompt's rule facts):
 *   - ancestry: dex/int fixed boosts, str flaw, cha free (Ratfolk: 1 free).
 *   - background: int/dex free (Fireworks Performer: 2 free — modeled here
 *     via `backgroundFree`, NOT `backgroundBoosts`, per R11 item 1's schema
 *     fix).
 *   - class: str boost (key ability choice for this fixture; distinct from
 *     the ACTUAL Magus doc's dex/str choice — synthetic on purpose so the
 *     math lands on the plan's target scores, same disclaimer as
 *     derivations-build.test.ts).
 *   - levelled N1: int/dex/con/cha (the 4 free level-1 boosts every PF2e
 *     Remaster character gets, independent of ancestry/background/class).
 *
 * Expected resulting scores (verified by hand + computeAbilityScores):
 *   str 10, dex 16, con 12, int 16, wis 10, cha 14.
 */
function tobiasLevel3DocComplete(): Record<string, unknown> {
  const base = tobiasLevel3Doc();
  const sys = base["system"] as Record<string, unknown> & { build: Record<string, unknown> };
  sys.build["abilities"] = {
    ancestryBoosts: ["dex", "int"],
    ancestryFlaws: ["str"],
    ancestryFree: ["cha"],
    backgroundBoosts: [],
    backgroundFree: ["int", "dex"],
    classBoost: ["str"],
    levelledBoosts: { "1": ["int", "dex", "con", "cha"] },
  };
  return base;
}

function ctx(doc: Record<string, unknown>, editable = true): PlanOpBuilderContext {
  return { actorId: "actor-tobias", doc, editable };
}

// ---------------------------------------------------------------------------
// derivePlan
// ---------------------------------------------------------------------------

describe("derivePlan — needsClass gate", () => {
  it("returns needsClass:true and empty levels when no class item is embedded", () => {
    const plan = derivePlan(baseCharacterDoc());
    expect(plan.needsClass).toBe(true);
    expect(plan.levels).toEqual([]);
  });

  it("still returns ABC cards (ancestry/heritage/background) without a class", () => {
    const doc = baseCharacterDoc({
      items: [{ ...ratfolkAncestryDoc(), _id: "item-ancestry" }],
    });
    const plan = derivePlan(doc);
    const ancestryCard = plan.abc.find((c) => c.kind === "ancestry")!;
    expect(ancestryCard.filled).toBe(true);
    expect(ancestryCard.name).toBe("Ratfolk");
    const classCard = plan.abc.find((c) => c.kind === "class")!;
    expect(classCard.filled).toBe(false);
  });
});

describe("derivePlan — Tobias level 3 (Magus, real fixture)", () => {
  const plan = derivePlan(tobiasLevel3Doc());

  it("returns needsClass:false and one LevelCard per level 1..3", () => {
    expect(plan.needsClass).toBe(false);
    expect(plan.levels.map((l) => l.level)).toEqual([1, 2, 3]);
  });

  it("ABC cards report ancestry/heritage/background/class filled with correct names", () => {
    const byKind = Object.fromEntries(plan.abc.map((c) => [c.kind, c]));
    expect(byKind["ancestry"]!.filled).toBe(true);
    expect(byKind["ancestry"]!.name).toBe("Ratfolk");
    expect(byKind["heritage"]!.filled).toBe(true);
    expect(byKind["heritage"]!.name).toBe("Snow Rat");
    expect(byKind["background"]!.filled).toBe(true);
    expect(byKind["background"]!.name).toBe("Fireworks Performer");
    expect(byKind["class"]!.filled).toBe(true);
    expect(byKind["class"]!.name).toBe("Magus");
  });

  it("class ABC card's subLine reports the chosen hybrid study", () => {
    const classCard = plan.abc.find((c) => c.kind === "class")!;
    expect(classCard.subLine).toBe("Hybrid Study: Starlit Span");
  });

  it("level 1: abilityBoosts UNFILLED (orphan choices marker, no backing ledger data — R11 production bug repro) + ancestryFeat (filled via item) + hybridStudy (filled) + skillTraining group (2/4 filled, R11 item 3 collapsed slot)", () => {
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const byType = Object.fromEntries(l1.slots.map((s) => [s.slotId, s]));

    // The fixture's `choices` array has an `abilityBoosts-1` marker entry,
    // but `abilities.backgroundFree`/`levelledBoosts["1"]` are empty — the
    // EXACT shape of Tobias's real production doc (see R11 task prompt's
    // DIAGNÓSTICO REAL). The slot must report unfilled: filled state is
    // derived from the ledger, never from the marker alone.
    expect(byType["abilityBoosts-1"]!.filled).toBe(false);
    expect(byType["abilityBoosts-1"]!.type).toBe("abilityBoosts");

    expect(byType["ancestryFeat-1"]!.filled).toBe(true);
    expect(byType["ancestryFeat-1"]!.choiceName).toBe("Cheek Pouches");
    expect(byType["ancestryFeat-1"]!.itemId).toBe("item-ancestry-feat-1");

    expect(byType["hybridStudy-1"]!.filled).toBe(true);
    expect(byType["hybridStudy-1"]!.choiceName).toBe("Starlit Span");

    // R11 item 3: every skillTraining-1-* slot collapses into ONE group slot
    // (keyed by the first member's slotId). This fixture's Int mod is +2
    // (classBoost+ancestryBoosts include int) -> additional(2) + 2 = 4 total
    // slots, 2 already filled via choices -> partially filled group (2/4).
    const skillGroup = byType["skillTraining-1-0"]!;
    expect(skillGroup.filled).toBe(false);
    expect(skillGroup.filledCount).toBe(2);
    expect(skillGroup.totalCount).toBe(4);
    expect(skillGroup.choiceName).toBe("2/4");
    expect(skillGroup.groupSlotIds).toEqual([
      "skillTraining-1-0",
      "skillTraining-1-1",
      "skillTraining-1-2",
      "skillTraining-1-3",
    ]);
    expect(byType["skillTraining-1-1"]).toBeUndefined();
  });

  it("level 1 auto-features exclude the 'Hybrid Study' placeholder but include the rest", () => {
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const names = l1.autoFeatures.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Arcane Spellcasting (Magus)",
        "Arcane Cascade",
        "Spellstrike",
        "Conflux Spells",
      ]),
    );
    expect(names).not.toContain("Hybrid Study");
    expect(l1.autoFeatures.every((f) => f.locked)).toBe(true);
  });

  it("level 2 has classFeat + skillFeat (regular Magus feat levels) filled, plus an optional archetypeFeat (freeArchetype on)", () => {
    const l2 = plan.levels.find((l) => l.level === 2)!;
    const byType = Object.fromEntries(l2.slots.map((s) => [s.slotId, s]));

    expect(byType["classFeat-2"]!.filled).toBe(true);
    expect(byType["classFeat-2"]!.choiceName).toBe("Arcane Fists");

    expect(byType["skillFeat-2"]!.filled).toBe(true);
    expect(byType["skillFeat-2"]!.choiceName).toBe("Speedrun Strats");

    expect(byType["archetypeFeat-2"]!.filled).toBe(true);
    expect(byType["archetypeFeat-2"]!.choiceName).toBe("Alchemist Dedication");
    expect(byType["archetypeFeat-2"]!.optional).toBe(true);
  });

  it("level 3 has generalFeat (filled) and skillIncrease group (1/1 filled, R11 item 3 collapsed slot)", () => {
    const l3 = plan.levels.find((l) => l.level === 3)!;
    const byType = Object.fromEntries(l3.slots.map((s) => [s.slotId, s]));

    expect(byType["generalFeat-3"]!.filled).toBe(true);
    expect(byType["generalFeat-3"]!.choiceName).toBe("Adopted Ancestry");

    expect(byType["skillIncrease-3"]!.filled).toBe(true);
    expect(byType["skillIncrease-3"]!.choiceName).toBe("1/1");
    expect(byType["skillIncrease-3"]!.groupSlotIds).toEqual(["skillIncrease-3"]);
  });

  it("no archetypeFeat slot appears on odd levels even with freeArchetype on", () => {
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const l3 = plan.levels.find((l) => l.level === 3)!;
    expect(l1.slots.some((s) => s.type === "archetypeFeat")).toBe(false);
    expect(l3.slots.some((s) => s.type === "archetypeFeat")).toBe(false);
  });
});

describe("derivePlan — empty slot when choice/item is absent", () => {
  it("reports classFeat-2 as unfilled when no matching item or choice exists", () => {
    const doc = tobiasLevel3Doc();
    const items = doc["items"] as Array<Record<string, unknown>>;
    doc["items"] = items.filter((i) => i["_id"] !== "item-class-feat-2");
    const plan = derivePlan(doc);
    const l2 = plan.levels.find((l) => l.level === 2)!;
    const slot = l2.slots.find((s) => s.slotId === "classFeat-2")!;
    expect(slot.filled).toBe(false);
    expect(slot.choiceName).toBeUndefined();
  });

  it("no archetypeFeat slot on even levels when freeArchetype is off", () => {
    const doc = tobiasLevel3Doc();
    (doc["system"] as Record<string, unknown> & { build: Record<string, unknown> }).build[
      "freeArchetype"
    ] = false;
    const plan = derivePlan(doc);
    const l2 = plan.levels.find((l) => l.level === 2)!;
    expect(l2.slots.some((s) => s.type === "archetypeFeat")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// derivePlan — class choice slots (r21-W1: instinct/racket/huntersEdge/
// arcaneThesis/arcaneSchool wired the same generic, data-driven way as the
// r19-W2b hybridStudy/kineticGate slots — no `if (className === ...)`
// anywhere; the slot lights up purely because CLASS_CHOICE_SLOTS recognizes
// the placeholder name in the class's own featuresByLevel).
// ---------------------------------------------------------------------------

describe("derivePlan — class choice slots (r21-W1)", () => {
  function level1Doc(classDoc: Record<string, unknown>): Record<string, unknown> {
    return baseCharacterDoc({
      items: [classDoc],
      system: { level: { value: 1 }, details: {} },
    });
  }

  it("Barbarian level 1 emits an UNFILLED 'instinct' slot (not a locked auto-feature chip)", () => {
    const plan = derivePlan(level1Doc(barbarianClassDoc()));
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "instinct-1");
    expect(slot).toBeDefined();
    expect(slot!.type).toBe("instinct");
    expect(slot!.filled).toBe(false);
    // Rage/Quick-Tempered aren't choice placeholders — they stay locked chips.
    expect(l1.autoFeatures.map((f) => f.name)).toEqual(
      expect.arrayContaining(["Rage", "Quick-Tempered"]),
    );
    expect(l1.autoFeatures.some((f) => f.name === "Instinct")).toBe(false);
  });

  it("Rogue level 1 emits an UNFILLED 'racket' slot", () => {
    const plan = derivePlan(level1Doc(rogueClassDoc()));
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "racket-1");
    expect(slot).toBeDefined();
    expect(slot!.type).toBe("racket");
    expect(slot!.filled).toBe(false);
  });

  it("Ranger level 1 emits an UNFILLED 'huntersEdge' slot", () => {
    const plan = derivePlan(level1Doc(rangerClassDoc()));
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "huntersEdge-1");
    expect(slot).toBeDefined();
    expect(slot!.type).toBe("huntersEdge");
    expect(slot!.filled).toBe(false);
  });

  it("Wizard level 1 emits TWO choice slots: 'arcaneSchool' and 'arcaneThesis'", () => {
    const plan = derivePlan(level1Doc(wizardClassDoc()));
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const school = l1.slots.find((s) => s.slotId === "arcaneSchool-1");
    const thesis = l1.slots.find((s) => s.slotId === "arcaneThesis-1");
    expect(school?.type).toBe("arcaneSchool");
    expect(thesis?.type).toBe("arcaneThesis");
    expect(school!.filled).toBe(false);
    expect(thesis!.filled).toBe(false);
  });

  it("Fighter level 1 emits NO choice-axis slot at all (confirmed: no fighter-* otherTag in the packs)", () => {
    const plan = derivePlan(level1Doc(fighterClassDoc()));
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const choiceTypes = [
      "hybridStudy",
      "kineticGate",
      "instinct",
      "racket",
      "huntersEdge",
      "arcaneThesis",
      "arcaneSchool",
    ];
    expect(l1.slots.some((s) => choiceTypes.includes(s.type))).toBe(false);
    expect(l1.autoFeatures.map((f) => f.name)).toEqual(
      expect.arrayContaining(["Reactive Strike", "Shield Block"]),
    );
  });

  it("Magus still emits 'hybridStudy' (r19-W2b behavior unchanged by the r21-W1 generalization)", () => {
    const plan = derivePlan(tobiasLevel3Doc());
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "hybridStudy-1")!;
    expect(slot.type).toBe("hybridStudy");
    expect(slot.filled).toBe(true);
    expect(slot.choiceName).toBe("Starlit Span");
  });
});

// ---------------------------------------------------------------------------
// derivePlan — `system.prerequisites` marking (A1, r21 achado): a Bloodrager
// -instinct Barbarian could pick Draconic Arrogance (prereq "dragon
// instinct") with no mark at all. Marks, never blocks (DEC-BC-05) — the slot
// stays `filled: true`, only `requirementIssue` is set.
// ---------------------------------------------------------------------------

describe("derivePlan — system.prerequisites marking (A1)", () => {
  /** Barbarian with an `instinct` axis slot AND a `classFeat` slot both open at level 1 (the real game grants the class feat at level 2, but level 1 is enough to exercise both slots together in one doc). */
  function barbarianWithClassFeatDoc(): Record<string, unknown> {
    return {
      _id: "class-barbarian",
      name: "Barbarian",
      type: "class",
      system: {
        featuresByLevel: [
          { level: 1, uuid: "uuid-instinct", name: "Instinct" },
          { level: 1, uuid: "uuid-rage", name: "Rage" },
        ],
        featLevels: { ancestry: [], class: [1], general: [], skill: [] },
      },
    };
  }

  function instinctItem(name: string): Record<string, unknown> {
    return {
      _id: "item-instinct",
      name,
      type: "classFeature",
      system: { traits: { otherTags: ["barbarian-instinct"], value: [] } },
      flags: { fusion: { build: { level: 1, slot: "instinct-1" } } },
    };
  }

  function draconicArroganceFeatDoc(): Record<string, unknown> {
    return {
      _id: "item-draconic-arrogance",
      name: "Draconic Arrogance",
      type: "feat",
      system: {
        category: "class",
        level: 1,
        traits: { rarity: "common", value: ["barbarian"] },
        prerequisites: [{ value: "dragon instinct" }],
      },
      flags: { fusion: { build: { level: 1, slot: "classFeat-1" } } },
    };
  }

  function unresolvableFeatDoc(): Record<string, unknown> {
    return {
      _id: "item-unresolvable-feat",
      name: "Unresolvable-Prereq Feat",
      type: "feat",
      system: {
        category: "class",
        level: 1,
        traits: { rarity: "common", value: ["barbarian"] },
        prerequisites: [{ value: "trained in Athletics" }],
      },
      flags: { fusion: { build: { level: 1, slot: "classFeat-1" } } },
    };
  }

  it("Bloodrager instinct + Draconic Arrogance (needs 'dragon instinct'): stays PICKABLE but gets marked unmet", () => {
    const doc = baseCharacterDoc({
      items: [
        barbarianWithClassFeatDoc(),
        instinctItem("Bloodrager"),
        draconicArroganceFeatDoc(),
      ],
      system: { level: { value: 1 }, details: {} },
    });
    const plan = derivePlan(doc);
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "classFeat-1")!;
    expect(slot.filled).toBe(true);
    expect(slot.choiceName).toBe("Draconic Arrogance");
    // issue #32: the reason's `prerequisite` param is now translated to
    // pt-BR via translatePrerequisite (the raw EN "dragon instinct" resolves
    // by document name to class-features-core's own "Dragon Instinct" →
    // "Instinto Dracônico" translation).
    expect(slot.requirementIssue).toEqual({
      reasonKey: "FUSION.Sheet.Plan.Requirement.PrerequisiteUnmet",
      params: { prerequisite: "Instinto Dracônico" },
    });
  });

  it("Dragon Instinct + Draconic Arrogance: requirement satisfied, no mark", () => {
    const doc = baseCharacterDoc({
      items: [
        barbarianWithClassFeatDoc(),
        instinctItem("Dragon Instinct"),
        draconicArroganceFeatDoc(),
      ],
      system: { level: { value: 1 }, details: {} },
    });
    const plan = derivePlan(doc);
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "classFeat-1")!;
    expect(slot.filled).toBe(true);
    expect(slot.requirementIssue).toBeUndefined();
  });

  it("prerequisite prose outside the model (e.g. 'trained in Athletics') is UNKNOWN, never marked", () => {
    const doc = baseCharacterDoc({
      items: [
        barbarianWithClassFeatDoc(),
        instinctItem("Bloodrager"),
        unresolvableFeatDoc(),
      ],
      system: { level: { value: 1 }, details: {} },
    });
    const plan = derivePlan(doc);
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "classFeat-1")!;
    expect(slot.filled).toBe(true);
    expect(slot.requirementIssue).toBeUndefined();
  });

  it("checkFeatPrerequisites: no system.prerequisites → undefined (no issue)", () => {
    expect(
      checkFeatPrerequisites(arcaneFistsFeatDoc(), [], undefined, 5),
    ).toBeUndefined();
  });

  /**
   * issue #45: "animal instinct or untamed order" (Brutal Crush, Creature
   * Comforts, Rip and Tear — all level 4) has "animal instinct" (axis-
   * resolvable, definitively unmet for a non-Animal instinct) OR "untamed
   * order" (Druid's order axis — Druid isn't a curated Fusion class, so this
   * candidate is unresolved FOREVER, not just for this character). Before
   * the fix, ANY single unresolved candidate downgraded the whole entry from
   * "unmet" to "unknown" (DEC-BC-05 leniency for "maybe satisfiable through
   * data this VM doesn't model") — but "untamed order" isn't a data gap,
   * it's provably never satisfiable in Fusion today. That silently hid the
   * SAME mistake this suite's "Animal Skin"-shaped siblings (single-
   * candidate "animal instinct") correctly mark.
   */
  function ripAndTearFeatDoc(): Record<string, unknown> {
    return {
      _id: "item-rip-and-tear",
      name: "Rip and Tear",
      type: "feat",
      system: {
        category: "class",
        level: 1,
        traits: { rarity: "common", value: ["barbarian"] },
        prerequisites: [{ value: "animal instinct or untamed order" }],
      },
      flags: { fusion: { build: { level: 1, slot: "classFeat-1" } } },
    };
  }

  it("Dragon Instinct + Rip and Tear ('animal instinct or untamed order'): marked unmet, same as an 'animal instinct'-only sibling", () => {
    const doc = baseCharacterDoc({
      items: [barbarianWithClassFeatDoc(), instinctItem("Dragon Instinct"), ripAndTearFeatDoc()],
      system: { level: { value: 1 }, details: {} },
    });
    const plan = derivePlan(doc);
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "classFeat-1")!;
    expect(slot.filled).toBe(true);
    // issue #32: "animal instinct" resolves by document name (class-features-
    // core's "Animal Instinct" → "Instinto Animal"); "untamed order" has no
    // curated document (Druid isn't a Fusion class) but IS a real PF2e term,
    // covered by prerequisiteTranslation.ts's curated vocabulary.
    expect(slot.requirementIssue).toEqual({
      reasonKey: "FUSION.Sheet.Plan.Requirement.PrerequisiteUnmet",
      params: { prerequisite: "Instinto Animal ou Ordem Selvagem" },
    });
  });

  it("Animal Instinct + Rip and Tear: requirement satisfied via the 'animal instinct' branch, no mark", () => {
    const doc = baseCharacterDoc({
      items: [barbarianWithClassFeatDoc(), instinctItem("Animal Instinct"), ripAndTearFeatDoc()],
      system: { level: { value: 1 }, details: {} },
    });
    const plan = derivePlan(doc);
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "classFeat-1")!;
    expect(slot.filled).toBe(true);
    expect(slot.requirementIssue).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// derivePlan — Champion "Blessing of the Devoted" choice axis (issue #25)
//
// The vendor's Blessing of the Devoted (level 3 class-feature placeholder)
// carries an unconverted ChoiceSet whose 3 real options (Blessed Armament/
// Shield/Swiftness) were never imported — same omission pattern the "Cause"
// axis already had a fix for. 6 higher-level feats (Radiant Armament, Shield
// of Reckoning, Spectral Advance, Armament Paragon, Shield Paragon, Swift
// Paragon) cite the chosen blessing by name and could never resolve.
// ---------------------------------------------------------------------------

describe("derivePlan — Champion 'Blessing of the Devoted' choice axis (issue #25)", () => {
  function championBlessingClassDoc(): Record<string, unknown> {
    return {
      _id: "class-champion-blessing",
      name: "Champion",
      type: "class",
      system: {
        keyAbility: ["str", "dex"],
        featuresByLevel: [
          { level: 1, uuid: "uuid-cause", name: "Cause" },
          { level: 3, uuid: "uuid-blessing", name: "Blessing of the Devoted" },
        ],
        featLevels: { ancestry: [], class: [2, 4, 10], general: [], skill: [] },
      },
    };
  }

  it("CLASS_CHOICE_SLOTS maps 'Blessing of the Devoted' to slot type 'blessing'", () => {
    expect(CLASS_CHOICE_SLOTS["Blessing of the Devoted"]).toBe("blessing");
  });

  it("CLASS_CHOICE_SLOT_OPTIONS declares blessing's pack + otherTags category + required class", () => {
    expect(CLASS_CHOICE_SLOT_OPTIONS.blessing).toEqual({
      packSlug: "class-features-core",
      category: "blessing-of-the-devoted",
      requiredClass: "champion",
    });
  });

  it("derivePlan emits an (unfilled) 'blessing' slot at level 3 for a Champion", () => {
    const doc = baseCharacterDoc({
      items: [{ ...championBlessingClassDoc(), _id: "item-class" }],
      system: { level: { value: 3 }, details: {} },
    });
    const plan = derivePlan(doc);
    const l3 = plan.levels.find((l) => l.level === 3)!;
    const slot = l3.slots.find((s) => s.slotId === "blessing-3");
    expect(slot).toBeDefined();
    expect(slot!.type).toBe("blessing");
    expect(slot!.filled).toBe(false);
  });

  it("once 'Blessed Armament' is picked, Radiant Armament's prerequisite ('blessed armament') resolves as MET — no false block on the OTHER 5 feats' exact pattern", () => {
    const blessedArmamentItem: Record<string, unknown> = {
      _id: "item-blessed-armament",
      name: "Blessed Armament",
      type: "classFeature",
      system: { traits: { otherTags: ["blessing-of-the-devoted"], value: ["champion"] } },
      flags: { fusion: { build: { level: 3, slot: "blessing-3" } } },
    };
    const radiantArmamentFeat: Record<string, unknown> = {
      _id: "item-radiant-armament",
      name: "Radiant Armament",
      type: "feat",
      system: {
        category: "class",
        level: 10,
        traits: { rarity: "common", value: ["champion"] },
        prerequisites: [{ value: "blessed armament" }],
      },
      flags: { fusion: { build: { level: 10, slot: "classFeat-10" } } },
    };
    const doc = baseCharacterDoc({
      items: [
        { ...championBlessingClassDoc(), _id: "item-class" },
        blessedArmamentItem,
        radiantArmamentFeat,
      ],
      system: { level: { value: 10 }, details: {} },
    });
    const plan = derivePlan(doc);
    const l10 = plan.levels.find((l) => l.level === 10)!;
    const slot = l10.slots.find((s) => s.slotId === "classFeat-10")!;
    expect(slot.filled).toBe(true);
    expect(slot.requirementIssue).toBeUndefined();
  });
});

/**
 * issue #30: "Master of Many Styles" prerequisite is now ONE merged "A or B"
 * entry (see monk.json's prerequisiteFixes) instead of two separate AND'd
 * entries. A pure Monk with Reflexive Stance (their own class feat) but
 * WITHOUT Opening Stance (Fighter-trait, unreachable via a Monk's classFeat
 * slot) must show no requirement issue either way — proving the merge
 * didn't regress the one satisfiable path.
 */
describe("checkFeatPrerequisites — Master of Many Styles merged OR entry (issue #30)", () => {
  it("Reflexive Stance alone satisfies the merged 'A or B' entry — no mark", () => {
    const reflexiveStanceItem: Record<string, unknown> = {
      _id: "item-reflexive-stance",
      name: "Reflexive Stance",
      type: "feat",
      system: { category: "class", level: 12, traits: { rarity: "common", value: ["monk"] } },
      flags: { fusion: { build: { level: 12, slot: "classFeat-12" } } },
    };
    const masterOfManyStylesFeat: Record<string, unknown> = {
      _id: "item-master-of-many-styles",
      name: "Master of Many Styles",
      type: "feat",
      system: {
        category: "class",
        level: 16,
        traits: { rarity: "common", value: ["fighter", "monk"] },
        prerequisites: [{ value: "Opening Stance (Fighter) or Reflexive Stance (Monk)" }],
      },
      flags: { fusion: { build: { level: 16, slot: "classFeat-16" } } },
    };
    const issue = checkFeatPrerequisites(
      masterOfManyStylesFeat,
      [reflexiveStanceItem, masterOfManyStylesFeat],
      undefined,
      16,
    );
    expect(issue).toBeUndefined();
  });
});

/**
 * knownPossessedNames only counts type "feat"/"classFeature" items — spells
 * are DELIBERATELY excluded (see the function's own doc comment). Issue #44
 * evidence #4: "Rallying Anthem" is a genuine homonym in the Bard universe —
 * a class feat (feats-core, DvjgdS2LkEqpPmZP) AND a composition spell
 * (spells-core, QreHVEpW0gbwRbz4), both trait bard, both real documents
 * (verified against the actual packs). Testing THIS through
 * checkFeatPrerequisites' output wouldn't catch a regression: DEC-BC-05 makes
 * "met" and "unresolved" both yield NO mark (only a confirmed axis mismatch
 * ever produces one), so a hypothetical future change that starts counting
 * spells would silently flip "unresolved" to "met" — invisibly, since both
 * already read as undefined downstream. The only way to actually lock this
 * contract is to assert the Set membership directly (re-exported as
 * `_knownPossessedNamesForTests`, mirroring the existing
 * `_readClassSystemForTests` pattern).
 */
describe("knownPossessedNames — spell items excluded by design (issue #44 evidence #4)", () => {
  it("does NOT count a spell item's name as possessed", () => {
    const rallyingAnthemSpell: Record<string, unknown> = {
      _id: "item-rallying-anthem-spell",
      name: "Rallying Anthem",
      type: "spell",
      location: "focus-entry",
      system: { traits: { value: ["bard", "cantrip", "composition"] } },
    };
    const names = _knownPossessedNamesForTests([rallyingAnthemSpell], undefined, 6);
    expect(names.has("rallying anthem")).toBe(false);
  });

  it("DOES count a feat item's name as possessed (the class-feat homonym of the same spell)", () => {
    const rallyingAnthemFeat: Record<string, unknown> = {
      _id: "item-rallying-anthem-feat",
      name: "Rallying Anthem",
      type: "feat",
      system: { category: "class", level: 4, traits: { rarity: "common", value: ["bard"] } },
      flags: { fusion: { build: { level: 4, slot: "classFeat-4" } } },
    };
    const names = _knownPossessedNamesForTests([rallyingAnthemFeat], undefined, 6);
    expect(names.has("rallying anthem")).toBe(true);
  });

  it("DOES count a classFeature item's name as possessed", () => {
    const shieldBlockFeature: Record<string, unknown> = {
      _id: "item-shield-block-feature",
      name: "Shield Block",
      type: "classFeature",
      system: { traits: { value: [] } },
      flags: { fusion: { build: { level: 1, slot: "instinct-1" } } },
    };
    const names = _knownPossessedNamesForTests([shieldBlockFeature], undefined, 6);
    expect(names.has("shield block")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// planContext
// ---------------------------------------------------------------------------

describe("planContext", () => {
  it("derives classSlug/ancestrySlug/keyAbility/level from the doc", () => {
    const ctxInfo = planContext(tobiasLevel3Doc());
    expect(ctxInfo.level).toBe(3);
    expect(ctxInfo.classSlug).toBe("magus");
    expect(ctxInfo.ancestrySlug).toBe("ratfolk");
    expect(ctxInfo.keyAbility).toBe("dex");
  });

  it("omits classSlug/ancestrySlug/keyAbility when no such item exists", () => {
    const ctxInfo = planContext(baseCharacterDoc());
    expect(ctxInfo.level).toBe(1);
    expect(ctxInfo.classSlug).toBeUndefined();
    expect(ctxInfo.ancestrySlug).toBeUndefined();
    expect(ctxInfo.keyAbility).toBeUndefined();
  });

  it("omits adoptedAncestrySlug when no adoptedAncestryChoice pick exists (Tobias hasn't picked one yet)", () => {
    expect(planContext(tobiasLevel3Doc()).adoptedAncestrySlug).toBeUndefined();
  });

  it("derives adoptedAncestrySlug from a recorded adoptedAncestryChoice pick, anywhere in system.build.choices", () => {
    const doc = tobiasLevel3Doc();
    const sysBuild = (doc["system"] as Record<string, unknown>)["build"] as Record<string, unknown>;
    sysBuild["choices"] = [
      ...(sysBuild["choices"] as unknown[]),
      { level: 3, slot: "generalFeat-3:ancestry", type: "adoptedAncestryChoice", ref: "Fleshwarp" },
    ];
    expect(planContext(doc).adoptedAncestrySlug).toBe("fleshwarp");
  });
});

// ---------------------------------------------------------------------------
// spellSlotsForLevel
// ---------------------------------------------------------------------------

describe("spellSlotsForLevel", () => {
  const progression = (magusClassDoc()["system"] as Record<string, unknown>)[
    "spellcasting"
  ] as Parameters<typeof spellSlotsForLevel>[0];

  it("returns the exact rank-1 slots at level 1", () => {
    const result = spellSlotsForLevel(progression, 1);
    expect(result.cantripsKnown).toBe(5);
    expect(result.slotsByRank).toEqual({ "1": 1 });
  });

  it("returns rank 1+2 at level 3 (Tobias's level)", () => {
    const result = spellSlotsForLevel(progression, 3);
    expect(result.slotsByRank).toEqual({ "1": 2, "2": 1 });
  });

  it("falls back to the highest entry at or below the requested level", () => {
    // Level 2.5 doesn't exist; nearest at-or-below is level 2.
    const result = spellSlotsForLevel(progression, 2);
    expect(result.slotsByRank).toEqual({ "1": 2 });
  });

  it("returns zero slots when the character level is below the first entry", () => {
    const result = spellSlotsForLevel({ tradition: "arcane", type: "prepared", ability: "int" }, 5);
    expect(result.cantripsKnown).toBe(0);
    expect(result.slotsByRank).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// applyClass
// ---------------------------------------------------------------------------

describe("applyClass", () => {
  it("returns [] when not editable", () => {
    const ops = applyClass(ctx(baseCharacterDoc(), false), magusClassDoc());
    expect(ops).toEqual([]);
  });

  it("creates the class item keeping the FULL keyAbility option list (choice lives in build.abilities.classBoost), valid against DocCreatePayloadSchema", () => {
    const ops = applyClass(ctx(baseCharacterDoc()), magusClassDoc());
    const classOp = ops[0]!;
    expect(classOp.type).toBe("doc:create");
    if (classOp.type !== "doc:create") throw new Error("expected doc:create");
    expect(classOp.data["_id"]).toBeUndefined();
    expect((classOp.data["system"] as Record<string, unknown>)["keyAbility"]).toEqual([
      "dex",
      "str",
    ]);
    expect(classOp.parent).toEqual({ type: "Actor", id: "actor-tobias" });

    const wire = {
      documentType: classOp.documentType,
      data: [classOp.data],
      parent: classOp.parent,
    };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("creates an arcane prepared spellcastingEntry with slots from the level-1 table", () => {
    const doc = baseCharacterDoc(); // level 1
    const ops = applyClass(ctx(doc), magusClassDoc());
    const entryOp = ops.find(
      (o) => o.type === "doc:create" && (o.data["name"] as string) === "arcane Spells",
    );
    expect(entryOp).toBeDefined();
    if (!entryOp || entryOp.type !== "doc:create") throw new Error("expected doc:create");
    const sys = entryOp.data["system"] as Record<string, unknown>;
    expect(sys["isFocusPool"]).toBe(false);
    expect((sys["prepared"] as Record<string, unknown>)["value"]).toBe("prepared");
    const slots = sys["slots"] as Record<string, { max: number; prepared: unknown[] }>;
    expect(slots["1"]!.max).toBe(1);
    expect(slots["1"]!.prepared).toHaveLength(1);
    expect(slots["0"]!.max).toBe(5); // cantripsKnown at level 1

    const wire = {
      documentType: entryOp.documentType,
      data: [entryOp.data],
      parent: entryOp.parent,
    };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("computes spellcasting slots at the ACTOR's current level, not always level 1", () => {
    const doc = baseCharacterDoc({ system: { level: { value: 3 }, details: {} } });
    const ops = applyClass(ctx(doc), magusClassDoc());
    const entryOp = ops.find(
      (o) => o.type === "doc:create" && (o.data["name"] as string) === "arcane Spells",
    );
    if (!entryOp || entryOp.type !== "doc:create") throw new Error("expected doc:create");
    const slots = (entryOp.data["system"] as Record<string, unknown>)["slots"] as Record<
      string,
      { max: number }
    >;
    expect(slots["1"]!.max).toBe(2);
    expect(slots["2"]!.max).toBe(1);
  });

  it("creates a focus spellcastingEntry when the class has a Conflux/focus feature at level 1", () => {
    const ops = applyClass(ctx(baseCharacterDoc()), magusClassDoc());
    const focusOp = ops.find(
      (o) => o.type === "doc:create" && (o.data["name"] as string) === "Focus Spells",
    );
    expect(focusOp).toBeDefined();
    if (!focusOp || focusOp.type !== "doc:create") throw new Error("expected doc:create");
    const sys = focusOp.data["system"] as Record<string, unknown>;
    expect(sys["isFocusPool"]).toBe(true);
    expect((sys["ability"] as Record<string, unknown>)["value"]).toBe("int");

    const wire = {
      documentType: focusOp.documentType,
      data: [focusOp.data],
      parent: focusOp.parent,
    };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("does not create a focus entry for a class without a Conflux/focus feature", () => {
    const noFocusClass = {
      ...magusClassDoc(),
      system: {
        ...(magusClassDoc()["system"] as Record<string, unknown>),
        featuresByLevel: [{ level: 1, uuid: "x", name: "Some Other Feature" }],
      },
    };
    const ops = applyClass(ctx(baseCharacterDoc()), noFocusClass);
    const focusOp = ops.find(
      (o) => o.type === "doc:create" && (o.data["name"] as string) === "Focus Spells",
    );
    expect(focusOp).toBeUndefined();
  });

  it("stamps the class item + its spellcasting/focus entries with a class-prefixed build flag, so a LATER swap can find and clean them up", () => {
    const ops = applyClass(ctx(baseCharacterDoc()), magusClassDoc());
    const classOp = ops.find(
      (o) => o.type === "doc:create" && (o.data["type"] as string) === "class",
    );
    if (!classOp || classOp.type !== "doc:create") throw new Error("expected doc:create");
    // The class item's PRE-EXISTING fusion flags (sourceId/conversion, from
    // the real pack doc) survive alongside the new build flag — replaceAbcItem
    // needs that sourceId later to find this class's grantedBy items on a
    // future swap (see embeddedItemPayload's merge, not overwrite).
    expect(classOp.data["flags"] as Record<string, unknown>).toEqual({
      fusion: {
        conversion: "full",
        sourceId: "HQBA9Yx2s8ycvz3C",
        build: { level: 1, slot: "class" },
      },
    });

    const spellOp = ops.find(
      (o) => o.type === "doc:create" && (o.data["name"] as string) === "arcane Spells",
    );
    if (!spellOp || spellOp.type !== "doc:create") throw new Error("expected doc:create");
    expect(spellOp.data["flags"] as Record<string, unknown>).toEqual({
      fusion: { build: { level: 1, slot: "class:spellcasting" } },
    });

    const focusOp = ops.find(
      (o) => o.type === "doc:create" && (o.data["name"] as string) === "Focus Spells",
    );
    if (!focusOp || focusOp.type !== "doc:create") throw new Error("expected doc:create");
    expect(focusOp.data["flags"] as Record<string, unknown>).toEqual({
      fusion: { build: { level: 1, slot: "class:focus" } },
    });
  });

  // ---------------------------------------------------------------------------
  // Frente 3 (DEC-BC-05 / "não consigo trocar a classe") — root cause: applyClass
  // only ever doc:created a class item, never removed the PREVIOUS one, so a
  // second class accreted alongside the first — and every reader
  // (findFirstItemByType) matches the FIRST item, so the swap silently did
  // nothing visible. Re-selecting must REPLACE the old class (+ its own
  // spellcasting/focus/granted-action items), while every OTHER pick (feats,
  // ancestry, hybrid study, …) is left completely untouched — those become the
  // requirement-marking job (see derivePlan/checkSlotRequirement tests below),
  // never a silent delete.
  // ---------------------------------------------------------------------------
  describe("re-selecting an ALREADY-APPLIED class (Frente 3)", () => {
    it("deletes the OLD class item and creates the NEW one, instead of accreting a second class item", () => {
      const doc = tobiasLevel3Doc(); // Magus, item _id "item-class"
      const ops = applyClass(ctx(doc), wizardClassDoc());

      const deleteOps = ops.filter((o) => o.type === "doc:delete") as Array<{ id: string }>;
      expect(deleteOps.map((o) => o.id)).toEqual(["item-class"]);

      const classCreateOps = ops.filter(
        (o) => o.type === "doc:create" && (o.data["type"] as string) === "class",
      );
      expect(classCreateOps).toHaveLength(1); // only the new Wizard — no duplicate class item
      if (classCreateOps[0]?.type !== "doc:create") throw new Error("expected doc:create");
      expect(classCreateOps[0].data["name"]).toBe(wizardClassDoc()["name"]);
    });

    it("does NOT touch any other embedded item (ancestry/heritage/background/feats stay exactly as they were)", () => {
      const doc = tobiasLevel3Doc();
      const untouchedIds = [
        "item-ancestry",
        "item-heritage",
        "item-background",
        "item-ancestry-feat-1",
        "item-hybrid-study-1",
        "item-class-feat-2",
        "item-skill-feat-2",
        "item-archetype-feat-2",
        "item-general-feat-3",
      ];
      const ops = applyClass(ctx(doc), wizardClassDoc());
      const deletedIds = new Set(
        ops.filter((o) => o.type === "doc:delete").map((o) => (o as { id: string }).id),
      );
      for (const id of untouchedIds) expect(deletedIds.has(id)).toBe(false);
    });

    it("cascades the delete to the OLD class's own spellcasting/focus entries (class-prefixed build flag) but not to unrelated spellcasting entries", () => {
      const doc: Record<string, unknown> = {
        _id: "actor-x",
        name: "X",
        type: "character",
        items: [
          {
            ...magusClassDoc(),
            _id: "item-class",
            flags: { fusion: { build: { level: 1, slot: "class" } } },
          },
          {
            name: "arcane Spells",
            type: "spellcastingEntry",
            _id: "item-arcane-spells",
            system: { isFocusPool: false },
            flags: { fusion: { build: { level: 1, slot: "class:spellcasting" } } },
          },
          {
            name: "Focus Spells",
            type: "spellcastingEntry",
            _id: "item-focus-spells",
            system: { isFocusPool: true },
            flags: { fusion: { build: { level: 1, slot: "class:focus" } } },
          },
          {
            // An UNRELATED spellcasting entry (e.g. a wand/staff-granted one)
            // that must survive the class swap untouched.
            name: "Unrelated Innate Spells",
            type: "spellcastingEntry",
            _id: "item-unrelated-spells",
            system: { isFocusPool: false },
          },
        ],
        system: { level: { value: 1 }, details: {} },
      };
      const ops = applyClass(ctx(doc), wizardClassDoc());
      const deletedIds = new Set(
        ops.filter((o) => o.type === "doc:delete").map((o) => (o as { id: string }).id),
      );
      expect(deletedIds).toEqual(
        new Set(["item-class", "item-arcane-spells", "item-focus-spells"]),
      );
      expect(deletedIds.has("item-unrelated-spells")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Focus pools for classes previously missed by hasFocusFeature's narrow name
// match (defect 1 — Bard's "Composition Spells" and Champion's "Devotion
// Spells" never matched "Conflux"/"focus"/"Bloodline Spells", and the r22
// guard additionally required `spellcasting?.tradition`, which Champion
// (no `spellcasting` block at all) can never satisfy).
// ---------------------------------------------------------------------------

describe("applyClass — focus pools beyond Magus/Sorcerer (defect 1)", () => {
  it("Bard's Composition Spells (level 1) grants an occult/cha focus pool", () => {
    const ops = applyClass(ctx(baseCharacterDoc()), bardClassDoc());
    const focusOp = ops.find(
      (o) => o.type === "doc:create" && (o.data["name"] as string) === "Focus Spells",
    );
    expect(focusOp, "Bard must get a Focus Spells entry (Composition Spells)").toBeDefined();
    if (!focusOp || focusOp.type !== "doc:create") throw new Error("expected doc:create");
    const sys = focusOp.data["system"] as Record<string, unknown>;
    expect(sys["isFocusPool"]).toBe(true);
    expect((sys["tradition"] as Record<string, unknown>)["value"]).toBe("occult");
    expect((sys["ability"] as Record<string, unknown>)["value"]).toBe("cha");

    const wire = {
      documentType: focusOp.documentType,
      data: [focusOp.data],
      parent: focusOp.parent,
    };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("Champion's Devotion Spells (level 1, class has NO spellcasting block) still grants a divine/cha focus pool", () => {
    const classDoc = championClassDoc();
    expect(
      (classDoc["system"] as Record<string, unknown>)["spellcasting"],
      "fixture must faithfully have no spellcasting block, like the real pack doc",
    ).toBeUndefined();

    const ops = applyClass(ctx(baseCharacterDoc()), classDoc);
    // No non-focus spellcasting entry — Champion isn't a spellcaster.
    const spellEntryOp = ops.find(
      (o) =>
        o.type === "doc:create" &&
        (o.data["type"] as string) === "spellcastingEntry" &&
        ((o.data["system"] as Record<string, unknown>)["isFocusPool"] as boolean) === false,
    );
    expect(spellEntryOp).toBeUndefined();

    const focusOp = ops.find(
      (o) => o.type === "doc:create" && (o.data["name"] as string) === "Focus Spells",
    );
    expect(focusOp, "Champion must get a Focus Spells entry (Devotion Spells)").toBeDefined();
    if (!focusOp || focusOp.type !== "doc:create") throw new Error("expected doc:create");
    const sys = focusOp.data["system"] as Record<string, unknown>;
    expect(sys["isFocusPool"]).toBe(true);
    expect((sys["tradition"] as Record<string, unknown>)["value"]).toBe("divine");
    expect((sys["ability"] as Record<string, unknown>)["value"]).toBe("cha");

    const wire = {
      documentType: focusOp.documentType,
      data: [focusOp.data],
      parent: focusOp.parent,
    };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("Sorcerer (tradition deferred to bloodline) does NOT get a focus entry from applyClass alone", () => {
    const ops = applyClass(ctx(baseCharacterDoc()), sorcererClassDoc());
    const focusOp = ops.find(
      (o) => o.type === "doc:create" && (o.data["name"] as string) === "Focus Spells",
    );
    expect(focusOp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sorcerer bloodline → tradition resolution (defect 3 — zero prior coverage).
// Every lineage in the real `traditionByBloodline` table, `draconic`'s
// documented null-falls-back-to-arcane case included.
// ---------------------------------------------------------------------------

describe("chooseClassChoice(bloodline) — tradition resolution per lineage", () => {
  const EXPECTED_TRADITION: Record<string, string> = {
    Aberrant: "occult",
    Aesir: "divine",
    Angelic: "divine",
    Demonic: "divine",
    Diabolic: "divine",
    Draconic: "arcane", // null in the data — falls back to arcane (r22 documented default)
    Elemental: "primal",
    Fey: "primal",
    Genie: "arcane",
    Hag: "occult",
    Harrow: "occult",
    Imperial: "arcane",
    Nymph: "primal",
    Phoenix: "primal",
    Psychopomp: "divine",
    Shadow: "occult",
    Undead: "divine",
    Wyrmblessed: "divine",
  };

  function sorcererDocWithClassApplied(): Record<string, unknown> {
    const doc = baseCharacterDoc();
    return {
      ...doc,
      items: [
        {
          ...sorcererClassDoc(),
          _id: "item-class",
          flags: { fusion: { build: { level: 1, slot: "class" } } },
        },
      ],
    };
  }

  it.each(Object.entries(EXPECTED_TRADITION))(
    "Bloodline: %s resolves to tradition %s (first pick, builds both entries)",
    (bloodlineName, expectedTradition) => {
      const doc = sorcererDocWithClassApplied();
      const ops = chooseClassChoice(ctx(doc), "bloodline", 1, bloodlineFeatureDoc(bloodlineName));

      const spellOp = ops.find(
        (o) => o.type === "doc:create" && (o.data["name"] as string) === `${expectedTradition} Spells`,
      );
      expect(
        spellOp,
        `Bloodline ${bloodlineName}: expected a "${expectedTradition} Spells" entry, ops: ${JSON.stringify(ops)}`,
      ).toBeDefined();
      if (!spellOp || spellOp.type !== "doc:create") throw new Error("expected doc:create");
      const sys = spellOp.data["system"] as Record<string, unknown>;
      expect((sys["tradition"] as Record<string, unknown>)["value"]).toBe(expectedTradition);
      expect(sys["isFocusPool"]).toBe(false);

      const focusOp = ops.find(
        (o) => o.type === "doc:create" && (o.data["name"] as string) === "Focus Spells",
      );
      expect(focusOp, `Bloodline ${bloodlineName}: expected a Focus Spells entry`).toBeDefined();
      if (!focusOp || focusOp.type !== "doc:create") throw new Error("expected doc:create");
      const focusSys = focusOp.data["system"] as Record<string, unknown>;
      expect((focusSys["tradition"] as Record<string, unknown>)["value"]).toBe(expectedTradition);
      expect(focusSys["isFocusPool"]).toBe(true);

      const wire = {
        documentType: spellOp.documentType,
        data: [spellOp.data],
        parent: spellOp.parent,
      };
      expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);
    },
  );

  // Defect 2: swapping bloodlines must re-stamp BOTH the tradition value AND
  // the "class:spellcasting" entry's NAME (created as `${tradition} Spells`)
  // — restamping only `system.tradition.value` left a stale "occult Spells"
  // name on a divine bloodline's sheet.
  describe("swapping bloodlines (defect 2 — stale entry name)", () => {
    function sorcererDocWithBloodline(tradition: string): Record<string, unknown> {
      const doc = sorcererDocWithClassApplied();
      return {
        ...doc,
        items: [
          ...(doc["items"] as Array<Record<string, unknown>>),
          {
            name: `${tradition} Spells`,
            type: "spellcastingEntry",
            _id: "item-sorc-spells",
            system: { isFocusPool: false, tradition: { value: tradition } },
            flags: { fusion: { build: { level: 1, slot: "class:spellcasting" } } },
          },
          {
            name: "Focus Spells",
            type: "spellcastingEntry",
            _id: "item-sorc-focus",
            system: { isFocusPool: true, tradition: { value: tradition } },
            flags: { fusion: { build: { level: 1, slot: "class:focus" } } },
          },
        ],
      };
    }

    it('re-stamps BOTH system.tradition.value AND name ("occult Spells" -> "divine Spells") when Aberrant is swapped for Angelic', () => {
      const doc = sorcererDocWithBloodline("occult"); // Aberrant
      const ops = chooseClassChoice(ctx(doc), "bloodline", 1, bloodlineFeatureDoc("Angelic"));

      const spellUpdateOp = ops.find(
        (o) => o.type === "doc:update" && o.id === "item-sorc-spells",
      ) as DocUpdatePayload | undefined;
      expect(spellUpdateOp, `expected a doc:update on item-sorc-spells, ops: ${JSON.stringify(ops)}`).toBeDefined();
      expect(spellUpdateOp!.diff["system.tradition.value"]).toBe("divine");
      expect(spellUpdateOp!.diff["name"]).toBe("divine Spells");

      const wireUpdate = {
        documentType: spellUpdateOp!.documentType,
        updates: [
          { _id: spellUpdateOp!.id, diff: spellUpdateOp!.diff, embedded: spellUpdateOp!.embedded },
        ],
      };
      expect(DocUpdatePayloadSchema.safeParse(wireUpdate).success).toBe(true);

      // The focus entry is re-stamped too (tradition only — its name is
      // always the fixed "Focus Spells", never tradition-suffixed).
      const focusUpdateOp = ops.find(
        (o) => o.type === "doc:update" && o.id === "item-sorc-focus",
      ) as DocUpdatePayload | undefined;
      expect(focusUpdateOp).toBeDefined();
      expect(focusUpdateOp!.diff["system.tradition.value"]).toBe("divine");
      expect(focusUpdateOp!.diff["name"]).toBeUndefined();

      // No accidental doc:create — this is a RESTAMP of the existing items,
      // not a fresh pair of entries.
      const createOps = ops.filter((o) => o.type === "doc:create");
      const entryCreates = createOps.filter((o) => (o.data["type"] as string) === "spellcastingEntry");
      expect(entryCreates).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// applyAncestry
// ---------------------------------------------------------------------------

describe("applyAncestry", () => {
  it("returns [] when not editable", () => {
    expect(applyAncestry(ctx(baseCharacterDoc(), false), ratfolkAncestryDoc())).toEqual([]);
  });

  it("creates the ancestry item and merges fixed boosts/flaws/free count into system.build.abilities", () => {
    const ops = applyAncestry(ctx(baseCharacterDoc()), ratfolkAncestryDoc());
    expect(ops).toHaveLength(2);

    const createOp = ops[0]!;
    expect(createOp.type).toBe("doc:create");
    if (createOp.type !== "doc:create") throw new Error("expected doc:create");
    const wire = {
      documentType: createOp.documentType,
      data: [createOp.data],
      parent: createOp.parent,
    };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);

    const updateOp = ops[1]!;
    expect(updateOp.type).toBe("doc:update");
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(updateOp.diff["system.build.abilities.ancestryBoosts"]).toEqual(["dex", "int"]);
    expect(updateOp.diff["system.build.abilities.ancestryFlaws"]).toEqual(["str"]);
    expect(updateOp.diff["system.build.abilities.ancestryFree"]).toEqual([]);

    const wireUpdate = {
      documentType: updateOp.documentType,
      updates: [{ _id: updateOp.id, diff: updateOp.diff }],
    };
    expect(DocUpdatePayloadSchema.safeParse(wireUpdate).success).toBe(true);
  });

  it("preserves existing ancestryFree picks when re-applying an ancestry with the SAME free count", () => {
    const doc = baseCharacterDoc({
      system: {
        level: { value: 1 },
        details: {},
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: ["wis"],
            backgroundBoosts: [],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const ops = applyAncestry(ctx(doc), ratfolkAncestryDoc()); // Ratfolk grants exactly 1 free boost
    const updateOp = ops[1]!;
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(updateOp.diff["system.build.abilities.ancestryFree"]).toEqual(["wis"]);
  });

  it("resets ancestryFree picks when the new ancestry's free count differs", () => {
    const doc = baseCharacterDoc({
      system: {
        level: { value: 1 },
        details: {},
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: ["wis", "cha"], // 2 picks from a previous ancestry
            backgroundBoosts: [],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const ops = applyAncestry(ctx(doc), ratfolkAncestryDoc()); // Ratfolk grants only 1 free boost
    const updateOp = ops[1]!;
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(updateOp.diff["system.build.abilities.ancestryFree"]).toEqual([]);
  });

  // r19-W2b speed bug: applyAncestry wrote the boost ledger but never the base
  // land speed, so a freshly-built character's sheet showed 0 ft (the speed
  // derivation reads the actor's `system.attributes.speed.value`, but the
  // ancestry item carries the number at `system.speed`).
  it("stamps the ancestry's land speed onto system.attributes.speed.value (r19-W2b)", () => {
    const ops = applyAncestry(ctx(baseCharacterDoc()), ratfolkAncestryDoc());
    const updateOp = ops.find((o) => o.type === "doc:update");
    if (!updateOp || updateOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(updateOp.diff["system.attributes.speed.value"]).toBe(25);
    const wire = {
      documentType: updateOp.documentType,
      updates: [{ _id: updateOp.id, diff: updateOp.diff }],
    };
    expect(DocUpdatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("overwrites the speed when SWAPPING to a slower ancestry (setar ao trocar)", () => {
    const dwarf = {
      ...ratfolkAncestryDoc(),
      _id: "anc-dwarf",
      name: "Dwarf",
      system: {
        ...(ratfolkAncestryDoc()["system"] as Record<string, unknown>),
        speed: 20,
      },
    };
    const ops = applyAncestry(ctx(baseCharacterDoc()), dwarf);
    const updateOp = ops.find((o) => o.type === "doc:update");
    if (!updateOp || updateOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(updateOp.diff["system.attributes.speed.value"]).toBe(20);
  });

  // Frente 3 (DEC-BC-05): re-selecting the ancestry card must REPLACE the old
  // ancestry item, not accrete a second one — every reader
  // (findFirstItemByType) matches the FIRST embedded item of the type, so an
  // accreted second ancestry item would leave the sheet showing the OLD one
  // forever (the same "não consigo trocar" bug diagnosed for class).
  it("re-selecting deletes the OLD ancestry item and creates the new one (Frente 3)", () => {
    const doc = tobiasLevel3Doc(); // Ratfolk, item _id "item-ancestry"
    const dwarf = { ...ratfolkAncestryDoc(), _id: "anc-dwarf", name: "Dwarf" };
    const ops = applyAncestry(ctx(doc), dwarf);

    const deleteOps = ops.filter((o) => o.type === "doc:delete") as Array<{ id: string }>;
    expect(deleteOps.map((o) => o.id)).toEqual(["item-ancestry"]);

    const createOps = ops.filter(
      (o) => o.type === "doc:create" && (o.data["type"] as string) === "ancestry",
    );
    expect(createOps).toHaveLength(1); // only Dwarf — no leftover Ratfolk item
  });

  it("does NOT touch the heritage/background/class/feats when swapping ancestry — Frente 3's mark-don't-delete policy applies to THOSE, not a silent removal here", () => {
    const doc = tobiasLevel3Doc();
    const dwarf = { ...ratfolkAncestryDoc(), _id: "anc-dwarf", name: "Dwarf" };
    const ops = applyAncestry(ctx(doc), dwarf);
    const deletedIds = new Set(
      ops.filter((o) => o.type === "doc:delete").map((o) => (o as { id: string }).id),
    );
    expect(deletedIds.has("item-heritage")).toBe(false);
    expect(deletedIds.has("item-class-feat-2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyHeritage
// ---------------------------------------------------------------------------

describe("applyHeritage", () => {
  it("returns [] when not editable", () => {
    expect(applyHeritage(ctx(baseCharacterDoc(), false), snowRatHeritageDoc())).toEqual([]);
  });

  it("creates the heritage item, valid against DocCreatePayloadSchema", () => {
    const ops = applyHeritage(ctx(baseCharacterDoc()), snowRatHeritageDoc());
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    if (op.type !== "doc:create") throw new Error("expected doc:create");
    expect(op.data["_id"]).toBeUndefined();
    const wire = { documentType: op.documentType, data: [op.data], parent: op.parent };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  // Frente 3 (DEC-BC-05): same replace-not-accrete fix as class/ancestry.
  it("re-selecting deletes the OLD heritage item and creates the new one (Frente 3)", () => {
    const doc = tobiasLevel3Doc(); // Snow Rat heritage, item _id "item-heritage"
    const desertRat = { ...snowRatHeritageDoc(), _id: "her-desert", name: "Desert Rat" };
    const ops = applyHeritage(ctx(doc), desertRat);

    const deleteOps = ops.filter((o) => o.type === "doc:delete") as Array<{ id: string }>;
    expect(deleteOps.map((o) => o.id)).toEqual(["item-heritage"]);

    const createOps = ops.filter((o) => o.type === "doc:create");
    expect(createOps).toHaveLength(1);
    if (createOps[0]?.type !== "doc:create") throw new Error("expected doc:create");
    expect(createOps[0].data["name"]).toBe("Desert Rat");
  });
});

// ---------------------------------------------------------------------------
// applyBackground
// ---------------------------------------------------------------------------

describe("applyBackground", () => {
  it("returns [] when not editable", () => {
    expect(
      applyBackground(ctx(baseCharacterDoc(), false), fireworksPerformerBackgroundDoc()),
    ).toEqual([]);
  });

  it("creates the background item, resets backgroundFree (fresh apply), and trains its skill AND lore as level-1 skillTraining build choices (r20-X4)", () => {
    const ops = applyBackground(ctx(baseCharacterDoc()), fireworksPerformerBackgroundDoc());
    const createOp = ops[0]!;
    if (createOp.type !== "doc:create") throw new Error("expected doc:create");
    const wire = {
      documentType: createOp.documentType,
      data: [createOp.data],
      parent: createOp.parent,
    };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);

    // Fireworks Performer's boosts are ["free","free"] (no fixed boosts) — the
    // abilities op still fires (reset/seed backgroundFree), plus the lore-entry
    // op AND the build-choices op: 4 ops total (r20-X4 added the lore branch).
    expect(ops).toHaveLength(4);
    const abilitiesOp = ops[1]!;
    if (abilitiesOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(abilitiesOp.diff["system.build.abilities.backgroundBoosts"]).toEqual([]);
    expect(abilitiesOp.diff["system.build.abilities.backgroundFree"]).toEqual([]);

    // The lore-entry op stamps the custom Lore skill (lore:true) so the
    // derivation treats it as an INT-based Lore.
    const loreEntryOp = ops[2]!;
    if (loreEntryOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(loreEntryOp.diff["system.skills.fireworks-lore"]).toMatchObject({
      rank: 0,
      lore: true,
      label: "Fireworks Lore",
    });

    const skillOp = ops[3]!;
    if (skillOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = skillOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toHaveLength(2);
    expect(choices[0]).toMatchObject({
      level: 1,
      slot: "backgroundSkill-0",
      type: "skillTraining",
      skill: "performance",
      rank: 1,
    });
    expect(choices[1]).toMatchObject({
      level: 1,
      slot: "backgroundLore-0",
      type: "skillTraining",
      skill: "fireworks-lore",
      rank: 1,
    });

    const wireUpdate = {
      documentType: skillOp.documentType,
      updates: [{ _id: skillOp.id, diff: skillOp.diff }],
    };
    expect(DocUpdatePayloadSchema.safeParse(wireUpdate).success).toBe(true);
  });

  it("emits a backgroundBoosts update op when the background has fixed (non-free) boosts", () => {
    const fixedBoostBackground = {
      ...fireworksPerformerBackgroundDoc(),
      system: {
        ...(fireworksPerformerBackgroundDoc()["system"] as Record<string, unknown>),
        boosts: ["wis", "free"],
      },
    };
    const ops = applyBackground(ctx(baseCharacterDoc()), fixedBoostBackground);
    const boostOp = ops.find(
      (o) => o.type === "doc:update" && "system.build.abilities.backgroundBoosts" in o.diff,
    );
    expect(boostOp).toBeDefined();
    if (!boostOp || boostOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(boostOp.diff["system.build.abilities.backgroundBoosts"]).toEqual(["wis"]);
    // Only 1 "free" entry remains → backgroundFree count is 1.
    expect(boostOp.diff["system.build.abilities.backgroundFree"]).toEqual([]);
  });

  it("preserves existing backgroundFree picks when re-applying a background with the SAME free count", () => {
    const doc = baseCharacterDoc({
      system: {
        level: { value: 1 },
        details: {},
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            backgroundFree: ["wis", "cha"],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const ops = applyBackground(ctx(doc), fireworksPerformerBackgroundDoc()); // grants exactly 2 free boosts
    const abilitiesOp = ops[1]!;
    if (abilitiesOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(abilitiesOp.diff["system.build.abilities.backgroundFree"]).toEqual(["wis", "cha"]);
  });

  it("resets backgroundFree picks when the new background's free count differs", () => {
    const doc = baseCharacterDoc({
      system: {
        level: { value: 1 },
        details: {},
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            backgroundFree: ["wis"], // 1 pick from a previous background
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const ops = applyBackground(ctx(doc), fireworksPerformerBackgroundDoc()); // grants 2 free boosts
    const abilitiesOp = ops[1]!;
    if (abilitiesOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(abilitiesOp.diff["system.build.abilities.backgroundFree"]).toEqual([]);
  });

  it("appends new skill choices onto existing choices (does not clobber)", () => {
    const doc = baseCharacterDoc({
      system: {
        level: { value: 1 },
        details: {},
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [{ level: 1, slot: "abilityBoosts-1", type: "abilityBoosts" }],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const ops = applyBackground(ctx(doc), fireworksPerformerBackgroundDoc());
    // ops: [create, abilities, loreEntries, choices] — the choices op is last.
    const skillOp = ops[ops.length - 1]!;
    if (skillOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = skillOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    // Pre-existing abilityBoosts-1 + the background's skill (performance) + lore.
    expect(choices).toHaveLength(3);
    expect(choices[0]).toMatchObject({ slot: "abilityBoosts-1" });
    expect(choices[1]).toMatchObject({ slot: "backgroundSkill-0", skill: "performance" });
    expect(choices[2]).toMatchObject({ slot: "backgroundLore-0", skill: "fireworks-lore" });
  });
});

// ---------------------------------------------------------------------------
// r20-X4 — ABC auto-chips, lore training, class action grants
// ---------------------------------------------------------------------------

describe("readBackgroundTrainings + loreSlug (r20-X4)", () => {
  it("unions trainedSkills.value + normalized skills, and extracts lores", () => {
    const t = readBackgroundTrainings({
      trainedSkills: { value: ["performance"], lore: ["Fireworks Lore"] },
      skills: { performance: { value: 1 } },
    });
    expect(t.skills).toEqual(["performance"]); // deduped across both shapes
    expect(t.lores).toEqual([{ slug: "fireworks-lore", label: "Fireworks Lore" }]);
  });

  it("reads the Aeronaut shape (Piloting Lore) even when normalized skills only has athletics", () => {
    const t = readBackgroundTrainings({
      trainedSkills: { value: ["athletics"], lore: ["Piloting Lore"] },
      skills: { athletics: { value: 1 } },
    });
    expect(t.skills).toEqual(["athletics"]);
    expect(t.lores).toEqual([{ slug: "piloting-lore", label: "Piloting Lore" }]);
  });

  it("loreSlug strips the trailing Lore word and appends -lore", () => {
    expect(loreSlug("Piloting Lore")).toBe("piloting-lore");
    expect(loreSlug("Fireworks Lore")).toBe("fireworks-lore");
    expect(loreSlug("Underworld")).toBe("underworld-lore");
  });
});

describe("applyBackground — Aeronaut lore (r20-X4)", () => {
  function aeronautBackgroundDoc(): Record<string, unknown> {
    return {
      _id: "bg-aeronaut",
      name: "Aeronaut",
      type: "background",
      flags: { fusion: { sourceId: "PutqlPJTPUBkMmSn" } },
      system: {
        boosts: ["free", "free"],
        trainedSkills: { value: ["athletics"], lore: ["Piloting Lore"] },
        skills: { athletics: { value: 1 } },
        items: {},
      },
    };
  }

  it("trains athletics AND the Piloting Lore", () => {
    const ops = applyBackground(ctx(baseCharacterDoc()), aeronautBackgroundDoc());
    const loreEntryOp = ops.find(
      (o) => o.type === "doc:update" && "system.skills.piloting-lore" in o.diff,
    );
    expect(loreEntryOp).toBeDefined();
    const choicesOp = ops[ops.length - 1]!;
    if (choicesOp.type !== "doc:update") throw new Error("expected update");
    const choices = choicesOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices.map((c) => c["skill"])).toEqual(["athletics", "piloting-lore"]);
  });
});

describe("backgroundLoreHealOps (r20-X4)", () => {
  function aeronautDoc(): Record<string, unknown> {
    return {
      name: "Aeronaut",
      type: "background",
      system: {
        trainedSkills: { value: ["athletics"], lore: ["Piloting Lore"] },
        skills: { athletics: { value: 1 } },
      },
    };
  }

  it("adds the missing lore entry + build choice for an already-applied background", () => {
    // Simulates the real Finn: athletics trained, Piloting Lore absent.
    const doc = baseCharacterDoc({
      system: {
        level: { value: 3 },
        details: {},
        skills: { athletics: { rank: 1 } },
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            backgroundFree: [],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [
            {
              level: 1,
              slot: "backgroundSkill-0",
              type: "skillTraining",
              skill: "athletics",
              rank: 1,
            },
          ],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const ops = backgroundLoreHealOps(ctx(doc), aeronautDoc());
    const loreEntryOp = ops.find(
      (o) => o.type === "doc:update" && "system.skills.piloting-lore" in o.diff,
    );
    expect(loreEntryOp).toBeDefined();
    const choicesOp = ops.find((o) => o.type === "doc:update" && "system.build.choices" in o.diff)!;
    if (choicesOp.type !== "doc:update") throw new Error("expected update");
    const choices = choicesOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices.some((c) => c["skill"] === "piloting-lore")).toBe(true);
  });

  it("is idempotent — no ops when the lore is already trained", () => {
    const doc = baseCharacterDoc({
      system: {
        level: { value: 3 },
        details: {},
        skills: { "piloting-lore": { rank: 1, lore: true } },
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            backgroundFree: [],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [
            {
              level: 1,
              slot: "backgroundLore-0",
              type: "skillTraining",
              skill: "piloting-lore",
              rank: 1,
            },
          ],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    expect(backgroundLoreHealOps(ctx(doc), aeronautDoc())).toEqual([]);
  });
});

describe("ABC card chips (r20-X4)", () => {
  it("renders informative Size + Vision + feature chips under the ancestry card", () => {
    const doc = baseCharacterDoc({
      items: [
        {
          ...ratfolkAncestryDoc(),
          _id: "item-ancestry",
          flags: { fusion: { sourceId: "P6PcVnCkh4XMdefw" } },
          system: {
            ...(ratfolkAncestryDoc()["system"] as Record<string, unknown>),
            items: {
              jkllM: {
                level: 1,
                name: "Sharp Teeth",
                uuid: "Compendium.pf2e.ancestryfeatures.Item.Sharp Teeth",
              },
            },
          },
        },
      ],
    });
    const plan = derivePlan(doc);
    const ancestry = plan.abc.find((c) => c.kind === "ancestry")!;
    const names = (ancestry.chips ?? []).map((c) => c.name);
    expect(names).toContain("Sharp Teeth");
    expect(names).toContain("Small");
    expect(names).toContain("Low-Light Vision");
    // Sharp Teeth is NOT materialized in this doc (only the ABC system.items
    // map is present, no embedded grant) → informative chip, not clickable.
    const sharp = ancestry.chips!.find((c) => c.name === "Sharp Teeth")!;
    expect(detailsRequestForAbcChip(sharp)).toBeNull();
  });

  it("renders a MATERIALIZED ancestry feature as a clickable chip routed to ancestry-features-core (r20-X5)", () => {
    const doc = baseCharacterDoc({
      items: [
        {
          ...ratfolkAncestryDoc(),
          _id: "item-ancestry",
          flags: { fusion: { sourceId: "P6PcVnCkh4XMdefw" } },
          system: {
            ...(ratfolkAncestryDoc()["system"] as Record<string, unknown>),
            items: {
              jkllM: {
                level: 1,
                name: "Sharp Teeth",
                uuid: "Compendium.pf2e.ancestryfeatures.Item.Sharp Teeth",
              },
            },
          },
        },
        // The embedded, materialized ancestry feature: type "feat" with the
        // distinguishing category "ancestryfeature" (routes details to
        // ancestry-features-core, NOT feats-core).
        {
          _id: "granted-sharp",
          name: "Sharp Teeth",
          type: "feat",
          flags: { fusion: { sourceId: "SharpTeethSrc001", grantedBy: "P6PcVnCkh4XMdefw" } },
          system: { category: "ancestryfeature", rules: [] },
        },
      ],
    });
    const plan = derivePlan(doc);
    const ancestry = plan.abc.find((c) => c.kind === "ancestry")!;
    const sharp = ancestry.chips!.find((c: AbcChip) => c.name === "Sharp Teeth")!;
    expect(sharp.detailsPackSlug).toBe("ancestry-features-core");
    expect(detailsRequestForAbcChip(sharp)).toEqual({
      packSlug: "ancestry-features-core",
      name: "Sharp Teeth",
      sourceId: "SharpTeethSrc001",
    });
    // Materialized + map entry dedupe to a single chip.
    expect(ancestry.chips!.filter((c) => c.name === "Sharp Teeth")).toHaveLength(1);
  });

  it("renders a MATERIALIZED background free feat as a clickable chip", () => {
    const doc = baseCharacterDoc({
      items: [
        {
          ...fireworksPerformerBackgroundDoc(),
          _id: "item-bg",
          type: "background",
          flags: { fusion: { sourceId: "2lk5NOcu1aUglUdK" } },
          system: {
            ...(fireworksPerformerBackgroundDoc()["system"] as Record<string, unknown>),
            items: {
              wr9b9: {
                level: 1,
                name: "Fascinating Performance",
                uuid: "Compendium.pf2e.feats-srd.Item.Fascinating Performance",
              },
            },
          },
        },
        {
          _id: "granted-fasc",
          name: "Fascinating Performance",
          type: "feat",
          flags: { fusion: { sourceId: "7LB00jkh6JaJr3vS", grantedBy: "2lk5NOcu1aUglUdK" } },
          system: { rules: [] },
        },
      ],
    });
    const plan = derivePlan(doc);
    const bg = plan.abc.find((c) => c.kind === "background")!;
    const fasc = bg.chips!.find((c: AbcChip) => c.name === "Fascinating Performance")!;
    expect(fasc.detailsPackSlug).toBe("feats-core");
    expect(detailsRequestForAbcChip(fasc)).toEqual({
      packSlug: "feats-core",
      name: "Fascinating Performance",
      sourceId: "7LB00jkh6JaJr3vS",
    });
    // No duplicate informative chip for the same feature.
    expect(bg.chips!.filter((c) => c.name === "Fascinating Performance")).toHaveLength(1);
  });
});

describe("classFeatureGrantRefs + classGrantedActionChips (r20-X4)", () => {
  it("classGrantSlot encodes level + normalized feature name", () => {
    expect(classGrantSlot(1, "Kinetic Aura")).toBe("classFeature:1:kinetic aura");
  });

  it("lists non-choice class features to re-scan, tagged by the class sourceId", () => {
    const doc = tobiasLevel3Doc();
    const refs = classFeatureGrantRefs(doc);
    const names = refs.map((r) => r.name);
    // Magus featuresByLevel non-choice: Arcane Spellcasting, Arcane Cascade, Spellstrike, Conflux Spells.
    expect(names).toContain("Spellstrike");
    expect(names).toContain("Arcane Cascade");
    // Hybrid Study is a CHOICE feature → excluded.
    expect(names).not.toContain("Hybrid Study");
    // Every ref is tagged by the class item's sourceId.
    for (const r of refs) {
      expect(r.classSourceId).toBeTruthy();
      expect(r.packSlug).toBe("class-features-core");
    }
  });

  it("surfaces a materialized class-granted action with a NEW name as a locked chip at its feature's level", () => {
    const base = tobiasLevel3Doc();
    const classItem = (base["items"] as Array<Record<string, unknown>>).find(
      (i) => i["type"] === "class",
    )!;
    const classSid = (
      (classItem["flags"] as Record<string, unknown>)["fusion"] as Record<string, unknown>
    )["sourceId"] as string;
    const doc = {
      ...base,
      items: [
        ...(base["items"] as Array<Record<string, unknown>>),
        // A name NOT present in Magus featuresByLevel (mirrors Kineticist's Base
        // Kinesis) → a distinct chip routed to actions-core.
        {
          _id: "granted-mystrike",
          name: "Mystic Strike",
          type: "action",
          flags: {
            fusion: {
              sourceId: "MS_ACT",
              grantedBy: classSid,
              grantedSlot: classGrantSlot(1, "Spellstrike"),
            },
          },
          system: {},
        },
      ],
    };
    const plan = derivePlan(doc);
    const lvl1 = plan.levels.find((l) => l.level === 1)!;
    const chip = lvl1.autoFeatures.find(
      (f) => f.name === "Mystic Strike" && f.detailsPackSlug === "actions-core",
    );
    expect(chip).toBeDefined();
    // Issue #44: the granted action's own sourceId rides along on the chip.
    expect(chip!.sourceId).toBe("MS_ACT");
  });

  it("carries docId on a featuresByLevel-named auto-feature (issue #44)", () => {
    const doc = tobiasLevel3Doc();
    const plan = derivePlan(doc);
    const lvl1 = plan.levels.find((l) => l.level === 1)!;
    const cascade = lvl1.autoFeatures.find((f) => f.name === "Arcane Cascade")!;
    expect(cascade).toBeDefined();
    expect(cascade.docId).toBe("pf6KyAB13Qf5GQ9Q");
  });

  it("DEDUPES a granted action whose name matches a class feature (Magus Spellstrike) — one chip, no duplicate render key", () => {
    const base = tobiasLevel3Doc();
    const classItem = (base["items"] as Array<Record<string, unknown>>).find(
      (i) => i["type"] === "class",
    )!;
    const classSid = (
      (classItem["flags"] as Record<string, unknown>)["fusion"] as Record<string, unknown>
    )["sourceId"] as string;
    const doc = {
      ...base,
      items: [
        ...(base["items"] as Array<Record<string, unknown>>),
        {
          _id: "granted-spellstrike",
          name: "Spellstrike",
          type: "action",
          flags: {
            fusion: {
              sourceId: "SS_ACT",
              grantedBy: classSid,
              grantedSlot: classGrantSlot(1, "Spellstrike"),
            },
          },
          system: {},
        },
      ],
    };
    const plan = derivePlan(doc);
    const lvl1 = plan.levels.find((l) => l.level === 1)!;
    const spellstrikeChips = lvl1.autoFeatures.filter((f) => f.name === "Spellstrike");
    expect(spellstrikeChips).toHaveLength(1); // the feature chip; the action is deduped
    // Every chip name at the level is unique (the LevelCard #each key is the name).
    const names = lvl1.autoFeatures.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// chooseFeat / chooseClassChoice
// ---------------------------------------------------------------------------

describe("chooseFeat", () => {
  const slot: PlanSlotModel = {
    slotId: "classFeat-2",
    type: "classFeat",
    label: "Class Feat",
    filled: false,
  };

  it("returns [] when not editable", () => {
    expect(chooseFeat(ctx(baseCharacterDoc(), false), slot, 2, arcaneFistsFeatDoc())).toEqual([]);
  });

  it("creates the feat item tagged with flags.fusion.build and appends a matching build choice", () => {
    const ops = chooseFeat(ctx(baseCharacterDoc()), slot, 2, arcaneFistsFeatDoc());
    expect(ops).toHaveLength(2);

    const createOp = ops[0]!;
    if (createOp.type !== "doc:create") throw new Error("expected doc:create");
    expect(createOp.data["_id"]).toBeUndefined();
    const flags = createOp.data["flags"] as Record<string, unknown>;
    expect((flags["fusion"] as Record<string, unknown>)["build"]).toEqual({
      level: 2,
      slot: "classFeat-2",
    });
    const wire = {
      documentType: createOp.documentType,
      data: [createOp.data],
      parent: createOp.parent,
    };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);

    const updateOp = ops[1]!;
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toEqual([{ level: 2, slot: "classFeat-2", type: "classFeat" }]);
    const wireUpdate = {
      documentType: updateOp.documentType,
      updates: [{ _id: updateOp.id, diff: updateOp.diff }],
    };
    expect(DocUpdatePayloadSchema.safeParse(wireUpdate).success).toBe(true);
  });

  it("appends onto existing UNRELATED choices without clobbering them", () => {
    // Re-escolher o MESMO talento no MESMO slot é legítimo (a frente 3
    // substitui em vez de acumular) e por isso NÃO cai na guarda de teto de
    // repetição da frente 1 — a contagem ignora o item que está saindo.
    // Integração das duas frentes, r21.
    const ops = chooseFeat(ctx(tobiasLevel3Doc()), slot, 2, arcaneFistsFeatDoc());
    const updateOp = ops.find((op) => op.type === "doc:update")!;
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices.length).toBe(5); // 4 unrelated existing choices + 1 new
  });

  // Frente 3 (DEC-BC-05 / "não consigo trocar a classe"): re-selecting an
  // ALREADY-FILLED slot must REPLACE the previous pick, not accrete a
  // duplicate item under the same slot id — the accretion bug that made
  // every re-select silently do nothing (the OLD item kept winning every
  // `resolveSlot`/`.find()` lookup).
  it("re-selecting an already-filled slot deletes the old item instead of accreting a duplicate", () => {
    const doc = tobiasLevel3Doc();
    // classFeat-2 is already filled with "item-class-feat-2" (Arcane Fists) —
    // re-picking it (even the SAME feat) must replace, not duplicate.
    const ops = chooseFeat(ctx(doc), slot, 2, arcaneFistsFeatDoc());

    const deleteOps = ops.filter((op) => op.type === "doc:delete") as Array<{ id: string }>;
    expect(deleteOps.map((op) => op.id)).toEqual(["item-class-feat-2"]);

    const createOps = ops.filter((op) => op.type === "doc:create");
    expect(createOps).toHaveLength(1); // only the new item — no duplicate left behind

    const updateOp = ops.find((op) => op.type === "doc:update")!;
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    // Exactly ONE classFeat-2 entry survives (the new pick) — no duplicate choice marker.
    expect(choices.filter((c) => c["slot"] === "classFeat-2")).toHaveLength(1);
  });

  it("does NOT emit a delete op when the slot was genuinely empty (first pick, no accretion cost)", () => {
    const ops = chooseFeat(ctx(baseCharacterDoc()), slot, 2, arcaneFistsFeatDoc());
    expect(ops.some((op) => op.type === "doc:delete")).toBe(false);
  });
});

describe("chooseFeat — repeat cap (W2 frente 1: non-repeatable feat picked twice)", () => {
  const slotA: PlanSlotModel = {
    slotId: "skillFeat-2",
    type: "skillFeat",
    label: "Skill Feat",
    filled: false,
  };
  const slotB: PlanSlotModel = {
    slotId: "skillFeat-4",
    type: "skillFeat",
    label: "Skill Feat",
    filled: false,
  };

  it("isFeatAtRepeatCap: false for a fresh character (nothing chosen yet)", () => {
    expect(isFeatAtRepeatCap(baseCharacterDoc(), acupuncturistFeatDoc())).toBe(false);
  });

  it("isFeatAtRepeatCap: true once a non-repeatable feat has been chosen once (by sourceId)", () => {
    const doc = baseCharacterDoc({
      items: [
        embeddedFeatItem(acupuncturistFeatDoc(), "item-1", { level: 2, slot: "skillFeat-2" }),
      ],
    });
    expect(isFeatAtRepeatCap(doc, acupuncturistFeatDoc())).toBe(true);
  });

  it("chooseFeat: accepts the FIRST pick of a non-repeatable feat", () => {
    const ops = chooseFeat(ctx(baseCharacterDoc()), slotA, 2, acupuncturistFeatDoc());
    expect(ops).toHaveLength(2);
  });

  it("chooseFeat: REJECTS a second pick of the same non-repeatable feat in a DIFFERENT slot (the reported defect)", () => {
    const doc = baseCharacterDoc({
      items: [
        embeddedFeatItem(acupuncturistFeatDoc(), "item-1", { level: 2, slot: "skillFeat-2" }),
      ],
    });
    const ops = chooseFeat(ctx(doc), slotB, 4, acupuncturistFeatDoc());
    expect(ops).toEqual([]);
  });

  it("chooseFeat: REJECTS a second pick identified by NAME when the embedded item carries no sourceId (Arcane Fists already on Tobias)", () => {
    // arcaneFistsFeatDoc() has no `flags` at all — featIdentity falls back to
    // `name`, matching the item tobiasLevel3Doc() already embeds at classFeat-2.
    const ops = chooseFeat(ctx(tobiasLevel3Doc()), slotA, 2, arcaneFistsFeatDoc());
    expect(ops).toEqual([]);
  });

  it("chooseFeat: a REPEATABLE feat (maxTakable: 3, real 'Armor Proficiency' data) can be picked up to its cap", () => {
    // 0 taken -> pick 1 accepted.
    expect(chooseFeat(ctx(baseCharacterDoc()), slotA, 1, armorProficiencyFeatDoc())).toHaveLength(
      2,
    );

    // 1 taken -> pick 2 accepted.
    const doc1 = baseCharacterDoc({
      items: [
        embeddedFeatItem(armorProficiencyFeatDoc(), "item-1", { level: 1, slot: "generalFeat-1" }),
      ],
    });
    expect(chooseFeat(ctx(doc1), slotB, 5, armorProficiencyFeatDoc())).toHaveLength(2);

    // 2 taken -> pick 3 (== maxTakable) accepted.
    const doc2 = baseCharacterDoc({
      items: [
        embeddedFeatItem(armorProficiencyFeatDoc(), "item-1", { level: 1, slot: "generalFeat-1" }),
        embeddedFeatItem(armorProficiencyFeatDoc(), "item-2", { level: 5, slot: "generalFeat-5" }),
      ],
    });
    expect(
      chooseFeat(ctx(doc2), { ...slotB, slotId: "generalFeat-9" }, 9, armorProficiencyFeatDoc()),
    ).toHaveLength(2);
  });

  it("chooseFeat: REJECTS the 4th pick of a maxTakable:3 feat", () => {
    const doc3 = baseCharacterDoc({
      items: [
        embeddedFeatItem(armorProficiencyFeatDoc(), "item-1", { level: 1, slot: "generalFeat-1" }),
        embeddedFeatItem(armorProficiencyFeatDoc(), "item-2", { level: 5, slot: "generalFeat-5" }),
        embeddedFeatItem(armorProficiencyFeatDoc(), "item-3", { level: 9, slot: "generalFeat-9" }),
      ],
    });
    expect(isFeatAtRepeatCap(doc3, armorProficiencyFeatDoc())).toBe(true);
    const ops = chooseFeat(
      ctx(doc3),
      { ...slotB, slotId: "generalFeat-13" },
      13,
      armorProficiencyFeatDoc(),
    );
    expect(ops).toEqual([]);
  });

  it("isFeatAtRepeatCap: always false for a non-feat doc (classFeature choices, e.g. hybridStudy, are exempt)", () => {
    expect(isFeatAtRepeatCap(baseCharacterDoc(), starlitSpanHybridStudyDoc())).toBe(false);
  });
});

describe("chooseClassChoice", () => {
  it("hybridStudy: uses the hybridStudy-1 slot id/type (r19-W2b behavior unchanged)", () => {
    const ops = chooseClassChoice(
      ctx(baseCharacterDoc()),
      "hybridStudy",
      1,
      starlitSpanHybridStudyDoc(),
    );
    const createOp = ops[0]!;
    if (createOp.type !== "doc:create") throw new Error("expected doc:create");
    const flags = createOp.data["flags"] as Record<string, unknown>;
    expect((flags["fusion"] as Record<string, unknown>)["build"]).toEqual({
      level: 1,
      slot: "hybridStudy-1",
    });
    const updateOp = ops[1]!;
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices[0]).toMatchObject({ level: 1, slot: "hybridStudy-1", type: "hybridStudy" });
  });

  it("instinct: uses the instinct-1 slot id/type (r21-W1: same op builder, generic over slotType)", () => {
    const ops = chooseClassChoice(ctx(baseCharacterDoc()), "instinct", 1, {
      _id: "feature-animal-instinct",
      name: "Animal Instinct",
      type: "classFeature",
      system: { traits: { otherTags: ["barbarian-instinct"], value: [] } },
    });
    const createOp = ops[0]!;
    if (createOp.type !== "doc:create") throw new Error("expected doc:create");
    const flags = createOp.data["flags"] as Record<string, unknown>;
    expect((flags["fusion"] as Record<string, unknown>)["build"]).toEqual({
      level: 1,
      slot: "instinct-1",
    });
    const updateOp = ops[1]!;
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices[0]).toMatchObject({ level: 1, slot: "instinct-1", type: "instinct" });
  });
});

// ---------------------------------------------------------------------------
// chooseSkillTraining / chooseSkillIncrease
// ---------------------------------------------------------------------------

describe("chooseSkillTraining", () => {
  const slot: PlanSlotModel = {
    slotId: "skillTraining-1-0",
    type: "skillTraining",
    label: "Skill Training",
    filled: false,
  };

  it("returns null when not editable", () => {
    expect(chooseSkillTraining(ctx(baseCharacterDoc(), false), slot, 1, "stealth")).toBeNull();
  });

  it("upserts a rank-1 skillTraining choice, valid against DocUpdatePayloadSchema", () => {
    const op = chooseSkillTraining(ctx(baseCharacterDoc()), slot, 1, "stealth");
    expect(op).not.toBeNull();
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toEqual([
      { level: 1, slot: "skillTraining-1-0", type: "skillTraining", skill: "stealth", rank: 1 },
    ]);
    const wire = { documentType: op!.documentType, updates: [{ _id: op!.id, diff: op!.diff }] };
    expect(DocUpdatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("replaces (not duplicates) a prior choice at the same slot", () => {
    const doc = baseCharacterDoc({
      system: {
        level: { value: 1 },
        details: {},
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [
            {
              level: 1,
              slot: "skillTraining-1-0",
              type: "skillTraining",
              skill: "acrobatics",
              rank: 1,
            },
          ],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const op = chooseSkillTraining(ctx(doc), slot, 1, "stealth");
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ skill: "stealth" });
  });
});

describe("chooseSkillIncrease", () => {
  const slot: PlanSlotModel = {
    slotId: "skillIncrease-3",
    type: "skillIncrease",
    label: "Skill Increase",
    filled: false,
  };

  it("returns null when not editable", () => {
    expect(chooseSkillIncrease(ctx(baseCharacterDoc(), false), slot, 3, "stealth", 1)).toBeNull();
  });

  it("bumps rank from currentRank to currentRank+1, with explicit rank recorded", () => {
    const op = chooseSkillIncrease(ctx(baseCharacterDoc()), slot, 3, "stealth", 1);
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices[0]).toMatchObject({ skill: "stealth", rank: 2, type: "skillIncrease" });
  });

  it("clamps the resulting rank at 4 (Legendary)", () => {
    const op = chooseSkillIncrease(ctx(baseCharacterDoc()), slot, 3, "stealth", 4);
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices[0]).toMatchObject({ rank: 4 });
  });
});

// ---------------------------------------------------------------------------
// setAbilityBoosts / markAbilityBoostsChoice / abilityBoostsSlotContext
// ---------------------------------------------------------------------------

describe("setAbilityBoosts", () => {
  it("returns null when not editable", () => {
    expect(setAbilityBoosts(ctx(baseCharacterDoc(), false), "ancestryFree", ["cha"])).toBeNull();
  });

  it("writes ancestryFree/backgroundBoosts/classBoost to their own path", () => {
    for (const origin of ["ancestryFree", "backgroundBoosts", "classBoost"] as const) {
      const op = setAbilityBoosts(ctx(baseCharacterDoc()), origin, ["wis"]);
      expect(op!.diff[`system.build.abilities.${origin}`]).toEqual(["wis"]);
      const wire = { documentType: op!.documentType, updates: [{ _id: op!.id, diff: op!.diff }] };
      expect(DocUpdatePayloadSchema.safeParse(wire).success).toBe(true);
    }
  });

  it("writes levelledBoosts keyed by the given level, merging with existing levels", () => {
    const doc = baseCharacterDoc({
      system: {
        level: { value: 5 },
        details: {},
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            classBoost: [],
            levelledBoosts: { "10": ["str", "dex", "con", "wis"] },
          },
          choices: [],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const op = setAbilityBoosts(ctx(doc), "levelled", ["int", "wis", "cha", "dex"], 5);
    expect(op!.diff["system.build.abilities.levelledBoosts"]).toEqual({
      "5": ["int", "wis", "cha", "dex"],
      "10": ["str", "dex", "con", "wis"],
    });
  });

  it("returns null for 'levelled' origin without a level", () => {
    expect(setAbilityBoosts(ctx(baseCharacterDoc()), "levelled", ["str"])).toBeNull();
  });
});

describe("markAbilityBoostsChoice", () => {
  it("returns null when not editable", () => {
    expect(
      markAbilityBoostsChoice(ctx(baseCharacterDoc(), false), "abilityBoosts-1", 1),
    ).toBeNull();
  });

  it("upserts a choices entry with type abilityBoosts for the given slot/level", () => {
    const op = markAbilityBoostsChoice(ctx(baseCharacterDoc()), "abilityBoosts-1", 1);
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toEqual([{ level: 1, slot: "abilityBoosts-1", type: "abilityBoosts" }]);
  });

  it("replaces a prior marker at the same slot instead of duplicating", () => {
    const doc = tobiasLevel3Doc(); // already has abilityBoosts-1 marked
    const op = markAbilityBoostsChoice(ctx(doc), "abilityBoosts-1", 1);
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    const aboostEntries = choices.filter((c) => c["slot"] === "abilityBoosts-1");
    expect(aboostEntries).toHaveLength(1);
  });
});

describe("abilityBoostsSlotContext", () => {
  it("level 1: fixed = ancestry+background fixed only; 4 groups incl. classBoost restricted to keyAbility (same-origin exclusions)", () => {
    const result = abilityBoostsSlotContext(tobiasLevel3Doc(), 1);
    // classBoost is a CHOICE group now (r11 live-verification fix), never a
    // fixed slug — and cross-origin repetition must stay possible, so each
    // group only excludes its own origin's fixed boosts.
    expect(result.fixedSlugs).toEqual(["dex", "int"]);
    expect(result.groups).toHaveLength(4);

    const ancestryGroup = result.groups.find((g) => g.origin === "ancestryFree")!;
    // Ratfolk (tobiasLevel3Doc's ancestry item) grants exactly 1 free boost.
    expect(ancestryGroup.freeCount).toBe(1);
    expect(ancestryGroup.initialFreeSlugs).toEqual(["cha"]);
    expect(ancestryGroup.excludedSlugs).toEqual(["dex", "int"]);

    const backgroundGroup = result.groups.find((g) => g.origin === "backgroundFree")!;
    // Fireworks Performer grants 2 free boosts; fixture has none picked yet.
    // Its exclusions are ONLY its own fixed boosts (none) — dex/int stay
    // pickable here (that's how Tobias reaches 16/16).
    expect(backgroundGroup.freeCount).toBe(2);
    expect(backgroundGroup.initialFreeSlugs).toEqual([]);
    expect(backgroundGroup.excludedSlugs).toEqual([]);

    const classGroup = result.groups.find((g) => g.origin === "classBoost")!;
    expect(classGroup.freeCount).toBe(1);
    expect(classGroup.allowedSlugs).toEqual(["dex", "str"]); // Magus keyAbility options
    expect(classGroup.excludedSlugs).toEqual([]);

    const levelledGroup = result.groups.find((g) => g.origin === "levelled")!;
    expect(levelledGroup.freeCount).toBe(4);
    expect(levelledGroup.initialFreeSlugs).toEqual([]);
    expect(levelledGroup.excludedSlugs).toEqual([]);
  });

  it("a levelled milestone: no fixed slugs, a single 'levelled' group with freeCount 4", () => {
    const result = abilityBoostsSlotContext(tobiasLevel3Doc(), 5);
    expect(result.fixedSlugs).toEqual([]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.origin).toBe("levelled");
    expect(result.groups[0]!.freeCount).toBe(4);
    expect(result.groups[0]!.initialFreeSlugs).toEqual([]);
  });

  it("pre-seeds the levelled group's initialFreeSlugs from an existing levelledBoosts entry", () => {
    const doc = baseCharacterDoc({
      system: {
        level: { value: 5 },
        details: {},
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            classBoost: [],
            levelledBoosts: { "5": ["str", "dex", "con", "wis"] },
          },
          choices: [],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const result = abilityBoostsSlotContext(doc, 5);
    expect(result.groups[0]!.initialFreeSlugs).toEqual(["str", "dex", "con", "wis"]);
  });

  it("level 1 without an ancestry/background yet: ancestryFree/backgroundFree groups report freeCount 0", () => {
    const result = abilityBoostsSlotContext(baseCharacterDoc(), 1);
    const ancestryGroup = result.groups.find((g) => g.origin === "ancestryFree")!;
    const backgroundGroup = result.groups.find((g) => g.origin === "backgroundFree")!;
    expect(ancestryGroup.freeCount).toBe(0);
    expect(backgroundGroup.freeCount).toBe(0);
    const levelledGroup = result.groups.find((g) => g.origin === "levelled")!;
    expect(levelledGroup.freeCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// previewAbilityScores (R11 item 2 — AbilityBoostsDialog live preview)
// ---------------------------------------------------------------------------

describe("previewAbilityScores", () => {
  it("overlays the dialog's in-progress picks onto the ledger and returns the resulting scores, matching computeAbilityScores' own math", () => {
    const doc = tobiasLevel3Doc(); // ancestryBoosts dex/int, ancestryFlaws str, classBoost int, no free picks yet
    const slotCtx = abilityBoostsSlotContext(doc, 1);
    const picks = slotCtx.groups.map((g) => {
      if (g.origin === "ancestryFree") return ["cha"];
      if (g.origin === "backgroundFree") return ["wis", "con"];
      if (g.origin === "classBoost") return ["int"];
      return ["int", "dex", "con", "cha"]; // levelled
    });
    const scores = previewAbilityScores(doc, 1, slotCtx.groups, picks);

    const abilities: Parameters<typeof computeAbilityScores>[0] = {
      ancestryBoosts: ["dex", "int"],
      ancestryFlaws: ["str"],
      ancestryFree: ["cha"],
      backgroundBoosts: [],
      backgroundFree: ["wis", "con"],
      classBoost: ["int"],
      levelledBoosts: { "1": ["int", "dex", "con", "cha"] },
    };
    expect(scores).toEqual(computeAbilityScores(abilities, 3));
  });

  it("reacts to picks changing (empty picks -> only fixed boosts apply)", () => {
    const doc = tobiasLevel3Doc();
    const slotCtx = abilityBoostsSlotContext(doc, 1);
    const emptyPicks = slotCtx.groups.map(() => []);
    const scores = previewAbilityScores(doc, 1, slotCtx.groups, emptyPicks);
    // ancestryBoosts dex/int (+2 each), ancestryFlaws str (-2). classBoost is
    // a CHOICE group now (r11): an all-empty in-progress selection clears it
    // from the preview, so int stays at 12 (ancestry only) until picked.
    expect(scores.dex).toBe(12);
    expect(scores.int).toBe(12);
    expect(scores.str).toBe(8);
    expect(scores.cha).toBe(10); // no free picks selected yet
  });

  it("a levelled milestone (non-1) writes into levelledBoosts[level], not ancestryFree/backgroundFree", () => {
    const doc = tobiasLevel3Doc();
    const sys = doc["system"] as Record<string, unknown> & { level: { value: number } };
    sys.level = { value: 5 };
    const slotCtx = abilityBoostsSlotContext(doc, 5);
    const scores = previewAbilityScores(doc, 5, slotCtx.groups, [["str", "str", "str", "str"]]);
    // str: base 8 (10 -2 ancestryFlaw) -> +2 (below 18) four times from the levelled picks = 8+2+2+2+2=16.
    expect(scores.str).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// isAbilityBoostsSlotFilled
// ---------------------------------------------------------------------------

describe("isAbilityBoostsSlotFilled", () => {
  it("reports false when a group with freeCount > 0 has fewer picks than freeCount", () => {
    const slotCtx = abilityBoostsSlotContext(tobiasLevel3Doc(), 1);
    // Fixture has ancestryFree filled (1/1) but backgroundFree empty (0/2)
    // and levelledBoosts["1"] empty (0/4) — overall unfilled.
    expect(isAbilityBoostsSlotFilled(slotCtx)).toBe(false);
  });

  it("reports true when every non-zero group has exactly freeCount picks", () => {
    const doc = tobiasLevel3Doc();
    (doc["system"] as Record<string, unknown> & { build: Record<string, unknown> }).build[
      "abilities"
    ] = {
      ancestryBoosts: ["dex", "int"],
      ancestryFlaws: ["str"],
      ancestryFree: ["cha"],
      backgroundBoosts: [],
      backgroundFree: ["int", "dex"],
      classBoost: ["int"],
      levelledBoosts: { "1": ["int", "dex", "con", "cha"] },
    };
    const slotCtx = abilityBoostsSlotContext(doc, 1);
    expect(isAbilityBoostsSlotFilled(slotCtx)).toBe(true);
  });

  it("a levelled milestone with no picks reports false; with 4 picks reports true", () => {
    const empty = abilityBoostsSlotContext(tobiasLevel3Doc(), 5);
    expect(isAbilityBoostsSlotFilled(empty)).toBe(false);

    const doc = tobiasLevel3Doc();
    (doc["system"] as Record<string, unknown> & { build: Record<string, unknown> }).build[
      "abilities"
    ] = {
      ancestryBoosts: ["dex", "int"],
      ancestryFlaws: ["str"],
      ancestryFree: ["cha"],
      backgroundBoosts: [],
      backgroundFree: [],
      classBoost: ["int"],
      levelledBoosts: { "5": ["str", "wis", "cha", "con"] },
    };
    const filled = abilityBoostsSlotContext(doc, 5);
    expect(isAbilityBoostsSlotFilled(filled)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setFreeArchetype
// ---------------------------------------------------------------------------

describe("setFreeArchetype", () => {
  it("returns null when not editable", () => {
    expect(setFreeArchetype(ctx(baseCharacterDoc(), false), true)).toBeNull();
  });

  it("writes system.build.freeArchetype", () => {
    const op = setFreeArchetype(ctx(baseCharacterDoc()), true);
    expect(op!.diff["system.build.freeArchetype"]).toBe(true);
    const wire = { documentType: op!.documentType, updates: [{ _id: op!.id, diff: op!.diff }] };
    expect(DocUpdatePayloadSchema.safeParse(wire).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeChoice
// ---------------------------------------------------------------------------

describe("removeChoice", () => {
  it("returns [] when not editable", () => {
    const slot: PlanSlotModel = {
      slotId: "classFeat-2",
      type: "classFeat",
      label: "Class Feat",
      filled: true,
      itemId: "item-class-feat-2",
    };
    expect(removeChoice(ctx(tobiasLevel3Doc(), false), slot)).toEqual([]);
  });

  it("deletes the backing item AND strips the matching choices entry (item-backed slot)", () => {
    const doc = tobiasLevel3Doc();
    const slot: PlanSlotModel = {
      slotId: "ancestryFeat-1",
      type: "ancestryFeat",
      label: "Ancestry Feat",
      filled: true,
      itemId: "item-ancestry-feat-1",
    };
    // ancestryFeat-1 in the fixture is item-backed only (no matching choices
    // entry) — verify the delete op and that choices stays untouched-length.
    const ops = removeChoice(ctx(doc), slot);
    expect(ops).toHaveLength(1);
    const deleteOp = ops[0]!;
    expect(deleteOp.type).toBe("doc:delete");
    if (deleteOp.type !== "doc:delete") throw new Error("expected doc:delete");
    expect(deleteOp.id).toBe("item-ancestry-feat-1");
    expect(deleteOp.parent).toEqual({ type: "Actor", id: "actor-tobias" });

    const wire = {
      documentType: deleteOp.documentType,
      ids: [deleteOp.id],
      parent: deleteOp.parent,
    };
    expect(DocDeletePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("strips the choices entry AND deletes nothing for a choice-only slot (skillIncrease)", () => {
    const doc = tobiasLevel3Doc();
    const slot: PlanSlotModel = {
      slotId: "skillIncrease-3",
      type: "skillIncrease",
      label: "Skill Increase",
      filled: true,
    };
    const ops = removeChoice(ctx(doc), slot);
    expect(ops).toHaveLength(1);
    const updateOp = ops[0]!;
    expect(updateOp.type).toBe("doc:update");
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices.some((c) => c["slot"] === "skillIncrease-3")).toBe(false);
    // The other 3 choices survive untouched.
    expect(choices).toHaveLength(3);
  });

  it("handles both item AND choice present defensively (removes both)", () => {
    const doc = tobiasLevel3Doc();
    const items = doc["items"] as Array<Record<string, unknown>>;
    items.push({
      _id: "item-defensive",
      name: "Defensive Test Feat",
      type: "feat",
      system: { category: "class", level: 2, traits: { rarity: "common", value: [] } },
      flags: { fusion: { build: { level: 2, slot: "defensive-slot" } } },
    });
    const choices = (doc["system"] as Record<string, unknown> & { build: Record<string, unknown> })
      .build["choices"] as Array<Record<string, unknown>>;
    choices.push({ level: 2, slot: "defensive-slot", type: "classFeat", itemId: "item-defensive" });

    const slot: PlanSlotModel = {
      slotId: "defensive-slot",
      type: "classFeat",
      label: "Class Feat",
      filled: true,
      itemId: "item-defensive",
    };
    const ops = removeChoice(ctx(doc), slot);
    expect(ops.some((o) => o.type === "doc:delete")).toBe(true);
    expect(ops.some((o) => o.type === "doc:update")).toBe(true);
  });

  it("returns [] (no-op) when the slot was never filled", () => {
    const slot: PlanSlotModel = {
      slotId: "classFeat-4",
      type: "classFeat",
      label: "Class Feat",
      filled: false,
    };
    const ops = removeChoice(ctx(baseCharacterDoc()), slot);
    expect(ops).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// levelUp / levelSet
// ---------------------------------------------------------------------------

describe("levelSet", () => {
  it("returns [] when not editable", () => {
    expect(levelSet(ctx(baseCharacterDoc(), false), 2)).toEqual([]);
  });

  it("updates both system.level.value and system.details.level in one diff", () => {
    const ops = levelSet(ctx(baseCharacterDoc()), 4);
    const levelOp = ops[0]!;
    if (levelOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(levelOp.diff["system.level.value"]).toBe(4);
    expect(levelOp.diff["system.details.level"]).toBe(4);
    const wire = {
      documentType: levelOp.documentType,
      updates: [{ _id: levelOp.id, diff: levelOp.diff }],
    };
    expect(DocUpdatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("clamps to [1, 20]", () => {
    const opsLow = levelSet(ctx(baseCharacterDoc()), -5);
    if (opsLow[0]!.type !== "doc:update") throw new Error("expected doc:update");
    expect(opsLow[0]!.diff["system.level.value"]).toBe(1);

    const opsHigh = levelSet(ctx(baseCharacterDoc()), 99);
    if (opsHigh[0]!.type !== "doc:update") throw new Error("expected doc:update");
    expect(opsHigh[0]!.diff["system.level.value"]).toBe(20);
  });

  it("syncs every non-focus spellcastingEntry's slots.max to the new level, preserving prepared spells", () => {
    const doc = tobiasLevel3Doc(); // level 3, no spellcastingEntry yet in fixture — add one
    const items = doc["items"] as Array<Record<string, unknown>>;
    items.push({
      _id: "entry-arcane",
      name: "arcane Spells",
      type: "spellcastingEntry",
      system: {
        prepared: { value: "prepared" },
        tradition: { value: "arcane" },
        ability: { value: "int" },
        proficiency: { value: 1 },
        isFocusPool: false,
        slots: {
          "1": {
            value: 2,
            max: 2,
            prepared: [
              { id: "spell-a", expended: false },
              { id: "spell-b", expended: true },
            ],
          },
          "2": { value: 1, max: 1, prepared: [{ id: "spell-c", expended: false }] },
        },
      },
    });
    items.push({
      _id: "entry-focus",
      name: "Focus Spells",
      type: "spellcastingEntry",
      system: {
        prepared: { value: "innate" },
        tradition: { value: "arcane" },
        ability: { value: "int" },
        proficiency: { value: 1 },
        isFocusPool: true,
        slots: {},
      },
    });

    const ops = levelSet(ctx(doc), 3); // same level, sanity re-sync
    const entryOps = ops.filter(
      (o) => o.type === "doc:update" && o.documentType === "Item",
    ) as Array<Extract<(typeof ops)[number], { type: "doc:update" }>>;

    // Only the non-focus entry is touched: rank 0 (cantripsKnown=5 at level
    // 1..20, per the fixture's flat table) plus rank 1 and rank 2 at level 3
    // ({1:2, 2:1}) = 3 slot-sync ops.
    expect(entryOps).toHaveLength(3);
    for (const op of entryOps) {
      expect(op.id).toBe("entry-arcane");
      expect(op.embedded).toEqual({ type: "Item", id: "actor-tobias" });
      const wire = {
        documentType: op.documentType,
        updates: [{ _id: op.id, diff: op.diff, embedded: op.embedded }],
      };
      expect(DocUpdatePayloadSchema.safeParse(wire).success).toBe(true);
    }

    const rank1Op = entryOps.find((o) => "system.slots.1" in o.diff)!;
    const rank1Value = rank1Op.diff["system.slots.1"] as { max: number; prepared: unknown[] };
    expect(rank1Value.max).toBe(2);
    expect(rank1Value.prepared).toEqual([
      { id: "spell-a", expended: false },
      { id: "spell-b", expended: true },
    ]);

    const rank2Op = entryOps.find((o) => "system.slots.2" in o.diff)!;
    const rank2Value = rank2Op.diff["system.slots.2"] as { max: number; prepared: unknown[] };
    expect(rank2Value.max).toBe(1);
    expect(rank2Value.prepared).toEqual([{ id: "spell-c", expended: false }]);
  });

  it("extends the prepared array with empty sentinels when max grows", () => {
    const doc = tobiasLevel3Doc();
    const items = doc["items"] as Array<Record<string, unknown>>;
    items.push({
      _id: "entry-arcane",
      name: "arcane Spells",
      type: "spellcastingEntry",
      system: {
        prepared: { value: "prepared" },
        tradition: { value: "arcane" },
        ability: { value: "int" },
        proficiency: { value: 1 },
        isFocusPool: false,
        slots: { "1": { value: 1, max: 1, prepared: [{ id: "spell-a", expended: false }] } },
      },
    });
    const ops = levelSet(ctx(doc), 4); // level 4 -> {1:2,2:2} per fixture's slots table (falls back to level 3's {1:2,2:1} since no level-4 entry — bestAtOrBelow)
    const entryOps = ops.filter(
      (o) => o.type === "doc:update" && o.documentType === "Item" && "system.slots.1" in o.diff,
    ) as Array<Extract<(typeof ops)[number], { type: "doc:update" }>>;
    const rank1Value = entryOps[0]!.diff["system.slots.1"] as { max: number; prepared: unknown[] };
    expect(rank1Value.max).toBe(2);
    expect(rank1Value.prepared).toEqual([
      { id: "spell-a", expended: false },
      { id: "", expended: false },
    ]);
  });

  it("truncates the prepared array when max shrinks", () => {
    const doc = baseCharacterDoc({ system: { level: { value: 3 }, details: {} } });
    const items: Array<Record<string, unknown>> = [
      { ...magusClassDoc(), _id: "item-class" },
      {
        _id: "entry-arcane",
        name: "arcane Spells",
        type: "spellcastingEntry",
        system: {
          prepared: { value: "prepared" },
          tradition: { value: "arcane" },
          ability: { value: "int" },
          proficiency: { value: 1 },
          isFocusPool: false,
          slots: {
            "1": {
              value: 2,
              max: 2,
              prepared: [
                { id: "spell-a", expended: false },
                { id: "spell-b", expended: false },
              ],
            },
          },
        },
      },
    ];
    doc["items"] = items;
    // Level 1 -> rank1 max = 1 (shrinks from 2).
    const ops = levelSet(ctx(doc), 1);
    const rank1Op = ops.find(
      (o) => o.type === "doc:update" && o.documentType === "Item" && "system.slots.1" in o.diff,
    )!;
    if (rank1Op.type !== "doc:update") throw new Error("expected doc:update");
    const rank1Value = rank1Op.diff["system.slots.1"] as { max: number; prepared: unknown[] };
    expect(rank1Value.max).toBe(1);
    expect(rank1Value.prepared).toEqual([{ id: "spell-a", expended: false }]);
  });

  it("does not touch spellcasting entries when the class has no spellcasting table", () => {
    const doc = baseCharacterDoc({ system: { level: { value: 1 }, details: {} } });
    const items = doc["items"] as Array<Record<string, unknown>>;
    const noCastingClass = {
      ...magusClassDoc(),
      system: {
        ...(magusClassDoc()["system"] as Record<string, unknown>),
        spellcasting: undefined,
      },
    };
    items.push({ ...noCastingClass, _id: "item-class" });
    const ops = levelSet(ctx(doc), 2);
    expect(ops).toHaveLength(1); // just the level op
  });

  it("levelUp bumps the current level by exactly 1", () => {
    const doc = tobiasLevel3Doc();
    const ops = levelUp(ctx(doc));
    const levelOp = ops[0]!;
    if (levelOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(levelOp.diff["system.level.value"]).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// isFeatEligible
// ---------------------------------------------------------------------------

describe("isFeatEligible", () => {
  const opts = { classSlug: "magus", ancestrySlug: "ratfolk" };

  it("classFeat: accepts a feat tagged with the character's class trait", () => {
    expect(isFeatEligible(arcaneFistsFeatDoc(), "classFeat", 2, opts)).toBe(true);
  });

  it("classFeat: accepts a SHARED class feat (category class, no class-specific trait)", () => {
    const shared = { system: { category: "class", level: 1, traits: { value: [] } } };
    expect(isFeatEligible(shared, "classFeat", 1, opts)).toBe(true);
  });

  it("classFeat: rejects a feat tagged for a DIFFERENT known class", () => {
    const wizardFeat = { system: { category: "class", level: 1, traits: { value: ["wizard"] } } };
    expect(isFeatEligible(wizardFeat, "classFeat", 5, opts)).toBe(false);
  });

  it("classFeat: rejects archetype-trait feats (they belong in the archetypeFeat slot)", () => {
    expect(isFeatEligible(alchemistDedicationFeatDoc(), "classFeat", 5, opts)).toBe(false);
  });

  it("classFeat: rejects a feat above the character's level", () => {
    const highLevelFeat = {
      system: { category: "class", level: 10, traits: { value: ["magus"] } },
    };
    expect(isFeatEligible(highLevelFeat, "classFeat", 2, opts)).toBe(false);
  });

  it("archetypeFeat: accepts category class + trait archetype (dedications)", () => {
    expect(isFeatEligible(alchemistDedicationFeatDoc(), "archetypeFeat", 2, opts)).toBe(true);
  });

  it("archetypeFeat: rejects a regular class feat without the archetype trait", () => {
    expect(isFeatEligible(arcaneFistsFeatDoc(), "archetypeFeat", 2, opts)).toBe(false);
  });

  it("ancestryFeat: accepts a feat tagged with the character's ancestry", () => {
    expect(isFeatEligible(cheekPouchesAncestryFeatDoc(), "ancestryFeat", 1, opts)).toBe(true);
  });

  it("ancestryFeat: rejects a feat for a different ancestry", () => {
    const elfFeat = { system: { category: "ancestry", level: 1, traits: { value: ["elf"] } } };
    expect(isFeatEligible(elfFeat, "ancestryFeat", 1, opts)).toBe(false);
  });

  it("ancestryFeat: rejects a non-ancestry-category feat", () => {
    expect(isFeatEligible(arcaneFistsFeatDoc(), "ancestryFeat", 1, opts)).toBe(false);
  });

  it("ancestryFeat: accepts a feat for the ADOPTED ancestry when adoptedAncestrySlug matches (Adopted Ancestry's mechanical payoff)", () => {
    const withAdopted = { ...opts, adoptedAncestrySlug: "fleshwarp" };
    expect(
      isFeatEligible(fleshwarpUnusualAnatomyAncestryFeatDoc(), "ancestryFeat", 1, withAdopted),
    ).toBe(true);
  });

  it("ancestryFeat: still accepts the character's OWN ancestry feat when adoptedAncestrySlug is also set", () => {
    const withAdopted = { ...opts, adoptedAncestrySlug: "fleshwarp" };
    expect(isFeatEligible(cheekPouchesAncestryFeatDoc(), "ancestryFeat", 1, withAdopted)).toBe(
      true,
    );
  });

  it("ancestryFeat: rejects a feat for a THIRD ancestry that is neither own nor adopted", () => {
    const withAdopted = { ...opts, adoptedAncestrySlug: "fleshwarp" };
    const elfFeat = { system: { category: "ancestry", level: 1, traits: { value: ["elf"] } } };
    expect(isFeatEligible(elfFeat, "ancestryFeat", 1, withAdopted)).toBe(false);
  });

  it("ancestryFeat: without adoptedAncestrySlug, the adopted ancestry's feat is NOT eligible (baseline unchanged)", () => {
    expect(isFeatEligible(fleshwarpUnusualAnatomyAncestryFeatDoc(), "ancestryFeat", 1, opts)).toBe(
      false,
    );
  });

  it("generalFeat: accepts category general regardless of traits", () => {
    expect(isFeatEligible(adoptedAncestryGeneralFeatDoc(), "generalFeat", 1, opts)).toBe(true);
  });

  it("generalFeat: rejects non-general category", () => {
    expect(isFeatEligible(arcaneFistsFeatDoc(), "generalFeat", 2, opts)).toBe(false);
  });

  it("skillFeat: accepts category skill", () => {
    expect(isFeatEligible(speedrunStratsSkillFeatDoc(), "skillFeat", 1, opts)).toBe(true);
  });

  it("skillFeat: rejects non-skill category", () => {
    expect(isFeatEligible(arcaneFistsFeatDoc(), "skillFeat", 2, opts)).toBe(false);
  });

  it("works without classSlug/ancestrySlug opts (never throws, defaults permissive for shared feats)", () => {
    const shared = { system: { category: "class", level: 1, traits: { value: [] } } };
    expect(isFeatEligible(shared, "classFeat", 1)).toBe(true);
  });

  it("defaults category to 'general' and level to 1 when the feat doc is minimal", () => {
    expect(isFeatEligible({}, "generalFeat", 1)).toBe(true);
    expect(isFeatEligible({}, "classFeat", 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isClassChoiceOption (r21-W1: generalizes r19-W2b's hybridStudy-only
// isHybridStudyOption to any CLASS_CHOICE_SLOT_OPTIONS-registered slot type)
// ---------------------------------------------------------------------------

describe("isClassChoiceOption", () => {
  it("hybridStudy: returns true for a classFeature carrying the magus-hybrid-study otherTag (r19-W2b behavior unchanged)", () => {
    expect(isClassChoiceOption(starlitSpanHybridStudyDoc(), "hybridStudy")).toBe(true);
  });

  it("returns false when otherTags is absent", () => {
    expect(isClassChoiceOption({ system: { traits: {} } }, "hybridStudy")).toBe(false);
  });

  it("returns false when otherTags doesn't include the target slot's tag", () => {
    expect(
      isClassChoiceOption({ system: { traits: { otherTags: ["something-else"] } } }, "hybridStudy"),
    ).toBe(false);
  });

  it("returns false for a non-hybrid-study classFeature (e.g. Arcane Cascade)", () => {
    expect(isClassChoiceOption({ system: { traits: { otherTags: [] } } }, "hybridStudy")).toBe(
      false,
    );
  });

  it("instinct: returns true for a classFeature carrying the barbarian-instinct otherTag", () => {
    expect(
      isClassChoiceOption(
        { system: { traits: { otherTags: ["barbarian-instinct"] } } },
        "instinct",
      ),
    ).toBe(true);
  });

  it("racket: returns true for a classFeature carrying the rogue-racket otherTag", () => {
    expect(
      isClassChoiceOption({ system: { traits: { otherTags: ["rogue-racket"] } } }, "racket"),
    ).toBe(true);
  });

  it("huntersEdge: returns true for a classFeature carrying the ranger-hunters-edge otherTag", () => {
    expect(
      isClassChoiceOption(
        { system: { traits: { otherTags: ["ranger-hunters-edge"] } } },
        "huntersEdge",
      ),
    ).toBe(true);
  });

  it("arcaneThesis: returns true for a classFeature carrying the wizard-arcane-thesis otherTag", () => {
    expect(
      isClassChoiceOption(
        { system: { traits: { otherTags: ["wizard-arcane-thesis"] } } },
        "arcaneThesis",
      ),
    ).toBe(true);
  });

  it("arcaneSchool: returns true for a classFeature carrying the wizard-arcane-school otherTag", () => {
    expect(
      isClassChoiceOption(
        { system: { traits: { otherTags: ["wizard-arcane-school"] } } },
        "arcaneSchool",
      ),
    ).toBe(true);
  });

  it("cross-category tags never cross-qualify (an instinct tag doesn't satisfy a racket slot)", () => {
    expect(
      isClassChoiceOption({ system: { traits: { otherTags: ["barbarian-instinct"] } } }, "racket"),
    ).toBe(false);
  });

  it("kineticGate has no CLASS_CHOICE_SLOT_OPTIONS entry — always false regardless of tags", () => {
    expect(
      isClassChoiceOption(
        { system: { traits: { otherTags: ["barbarian-instinct"] } } },
        "kineticGate",
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeAbilityScores (R11 item 1 — full level-1 dádivas model)
// ---------------------------------------------------------------------------

describe("computeAbilityScores", () => {
  it("Tobias COMPLETE ledger: str 10, dex 16, con 12, int 16, wis 10, cha 14", () => {
    const doc = tobiasLevel3DocComplete();
    const sysBuild = (doc["system"] as Record<string, unknown> & { build: Record<string, unknown> })
      .build["abilities"] as Parameters<typeof computeAbilityScores>[0];
    const scores = computeAbilityScores(sysBuild, 3);
    expect(scores).toEqual({ str: 10, dex: 16, con: 12, int: 16, wis: 10, cha: 14 });
  });

  it("empty ledger stays at base 10 for every ability", () => {
    const scores = computeAbilityScores(
      {
        ancestryBoosts: [],
        ancestryFlaws: [],
        ancestryFree: [],
        backgroundBoosts: [],
        backgroundFree: [],
        classBoost: [],
        levelledBoosts: {},
      },
      1,
    );
    expect(scores).toEqual({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
  });

  it("levelledBoosts entries ABOVE the current level are not applied yet", () => {
    const scores = computeAbilityScores(
      {
        ancestryBoosts: [],
        ancestryFlaws: [],
        ancestryFree: [],
        backgroundBoosts: [],
        backgroundFree: [],
        classBoost: [],
        levelledBoosts: { "5": ["str", "str", "str", "str"] },
      },
      3, // character is only level 3 — the level-5 milestone hasn't happened
    );
    expect(scores.str).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// derivePlan — level-1 skillTraining slot count reacts to Int (R11 item 3,
// audit r10 final issue #4)
// ---------------------------------------------------------------------------

describe("derivePlan — level-1 skillTraining slot count = trainedSkills.additional + max(0, Int mod)", () => {
  it("Tobias COMPLETE ledger (Int 16 -> mod +3, Magus additional=2): skillTraining group totalCount=5 (R11 item 3 collapsed slot)", () => {
    const plan = derivePlan(tobiasLevel3DocComplete());
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const skillGroup = l1.slots.find((s) => s.type === "skillTraining")!;
    expect(skillGroup.totalCount).toBe(5); // additional(2) + Int mod(+3)
    expect(skillGroup.groupSlotIds).toEqual([
      "skillTraining-1-0",
      "skillTraining-1-1",
      "skillTraining-1-2",
      "skillTraining-1-3",
      "skillTraining-1-4",
    ]);
  });

  it("negative Int mod never reduces below trainedSkills.additional (floored at 0)", () => {
    const doc = tobiasLevel3DocComplete();
    const sys = doc["system"] as Record<string, unknown> & { build: Record<string, unknown> };
    // Force a very low Int: no int boosts of any kind, one flaw.
    sys.build["abilities"] = {
      ancestryBoosts: ["dex", "str"],
      ancestryFlaws: ["int"],
      ancestryFree: ["cha"],
      backgroundBoosts: [],
      backgroundFree: ["wis", "con"],
      classBoost: ["str"],
      levelledBoosts: { "1": ["str", "dex", "con", "wis"] },
    };
    const plan = derivePlan(doc);
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const skillGroup = l1.slots.find((s) => s.type === "skillTraining")!;
    // Int lands at 8 (10 - 2 flaw) -> mod -1 -> floored to 0 extra.
    // Magus trainedSkills.additional = 2 -> exactly 2 slots, not fewer.
    expect(skillGroup.totalCount).toBe(2);
  });

  it("reacts reactively: recomputes from the CURRENT ledger every derivePlan call (no stale count)", () => {
    const doc = baseCharacterDoc({
      items: [{ ...magusClassDoc(), _id: "item-class" }],
      system: {
        level: { value: 1 },
        details: {},
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            backgroundFree: [],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const before = derivePlan(doc);
    const l1Before = before.levels.find((l) => l.level === 1)!;
    // Empty ledger -> Int stays at base 10 -> mod 0 -> just additional(2).
    expect(l1Before.slots.find((s) => s.type === "skillTraining")!.totalCount).toBe(2);

    // Simulate the player completing the level-1 boosts (Int now boosted to 16).
    const sys = doc["system"] as Record<string, unknown> & { build: Record<string, unknown> };
    sys.build["abilities"] = {
      ancestryBoosts: ["dex", "int"],
      ancestryFlaws: ["str"],
      ancestryFree: ["cha"],
      backgroundBoosts: [],
      backgroundFree: ["int", "dex"],
      classBoost: ["str"],
      levelledBoosts: { "1": ["int", "dex", "con", "cha"] },
    };
    const after = derivePlan(doc);
    const l1After = after.levels.find((l) => l.level === 1)!;
    expect(l1After.slots.find((s) => s.type === "skillTraining")!.totalCount).toBe(5); // additional(2) + Int mod(+3)
  });
});

// ---------------------------------------------------------------------------
// abilityBoosts-1 slot: ledger -> filled derivation end-to-end (R11 item 2)
// ---------------------------------------------------------------------------

describe("derivePlan — abilityBoosts-1 slot filled state is derived from the ledger, not the choices marker", () => {
  it("orphan marker (Tobias's real production doc shape) reports UNFILLED", () => {
    const plan = derivePlan(tobiasLevel3Doc());
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "abilityBoosts-1")!;
    expect(slot.filled).toBe(false);
  });

  it("completing the ledger (no marker needed) reports FILLED", () => {
    const doc = tobiasLevel3Doc();
    const sys = doc["system"] as Record<string, unknown> & { build: Record<string, unknown> };
    // Strip the orphan marker entirely — filled state must come from the
    // ledger alone.
    sys.build["choices"] = (sys.build["choices"] as Array<Record<string, unknown>>).filter(
      (c) => c["slot"] !== "abilityBoosts-1",
    );
    sys.build["abilities"] = {
      ancestryBoosts: ["dex", "int"],
      ancestryFlaws: ["str"],
      ancestryFree: ["cha"],
      backgroundBoosts: [],
      backgroundFree: ["int", "dex"],
      classBoost: ["str"],
      levelledBoosts: { "1": ["int", "dex", "con", "cha"] },
    };
    const plan = derivePlan(doc);
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "abilityBoosts-1")!;
    expect(slot.filled).toBe(true);
  });

  it("a partially-completed ledger (missing backgroundFree picks) still reports UNFILLED", () => {
    const doc = tobiasLevel3Doc();
    const sys = doc["system"] as Record<string, unknown> & { build: Record<string, unknown> };
    sys.build["abilities"] = {
      ancestryBoosts: ["dex", "int"],
      ancestryFlaws: ["str"],
      ancestryFree: ["cha"],
      backgroundBoosts: [],
      backgroundFree: [], // Fireworks Performer needs 2 — missing
      classBoost: ["str"],
      levelledBoosts: { "1": ["int", "dex", "con", "cha"] },
    };
    const plan = derivePlan(doc);
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const slot = l1.slots.find((s) => s.slotId === "abilityBoosts-1")!;
    expect(slot.filled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// skillProficiencyBonus
// ---------------------------------------------------------------------------

describe("skillProficiencyBonus", () => {
  it("untrained (rank 0) is always +0, level not added", () => {
    expect(skillProficiencyBonus(0, 1)).toBe(0);
    expect(skillProficiencyBonus(0, 20)).toBe(0);
  });

  it("trained..legendary = rank*2 + level", () => {
    expect(skillProficiencyBonus(1, 3)).toBe(5); // trained
    expect(skillProficiencyBonus(2, 3)).toBe(7); // expert
    expect(skillProficiencyBonus(3, 10)).toBe(16); // master
    expect(skillProficiencyBonus(4, 20)).toBe(28); // legendary
  });
});

// ---------------------------------------------------------------------------
// skillTrainingDialogContext / confirmSkillTraining (R11 item 1 — mass
// skill-training picker replacing the one-at-a-time mini-dialog)
// ---------------------------------------------------------------------------

describe("skillTrainingDialogContext", () => {
  it("skillTraining kind: reports totalSlots/emptySlotIds from the level's collapsed group and marks only UNTRAINED skills eligible", () => {
    const dctx = skillTrainingDialogContext(tobiasLevel3DocComplete(), 1, "skillTraining");
    // Tobias complete: additional(2) + Int mod(+3) = 5 total; 2 already
    // filled via choices (stealth, thievery) -> 3 still empty.
    expect(dctx.totalSlots).toBe(5);
    expect(dctx.emptySlotIds).toEqual([
      "skillTraining-1-2",
      "skillTraining-1-3",
      "skillTraining-1-4",
    ]);

    // Tobias is level 3, so effectiveSkillRank folds in BOTH the level-1
    // skillTraining choice (stealth -> 1) and the level-3 skillIncrease
    // choice (stealth -> 2) — current rank is the character's rank RIGHT
    // NOW, not frozen at the level being edited.
    const stealthRow = dctx.rows.find((r) => r.slug === "stealth")!;
    expect(stealthRow.currentRank).toBe(2);
    expect(stealthRow.eligible).toBe(false); // skillTraining slots don't offer already-trained skills

    // "arcana" is the Magus fixture's trainedSkills.value entry -> already
    // rank 1 from the class itself, so it's NOT offered for skillTraining;
    // "athletics" has no floor at all and stays untrained/eligible.
    const arcanaRow = dctx.rows.find((r) => r.slug === "arcana")!;
    expect(arcanaRow.currentRank).toBe(1);
    expect(arcanaRow.eligible).toBe(false);

    const athleticsRow = dctx.rows.find((r) => r.slug === "athletics")!;
    expect(athleticsRow.currentRank).toBe(0);
    expect(athleticsRow.eligible).toBe(true);
    expect(athleticsRow.targetRank).toBe(1);
  });

  it("every one of the 16 canonical skills is present as a row, plus lore skills found on the doc", () => {
    const doc = tobiasLevel3DocComplete();
    const sys = doc["system"] as Record<string, unknown> & { skills?: Record<string, unknown> };
    sys["skills"] = { "lore-nature-lore": { rank: 1, lore: true } };
    const dctx = skillTrainingDialogContext(doc, 1, "skillTraining");
    expect(dctx.rows.map((r) => r.slug)).toContain("lore-nature-lore");
    expect(dctx.rows.filter((r) => !r.isLore)).toHaveLength(16);
  });

  it("skillIncrease kind: eligible rows are trained (rank 1-3), not untrained or already-legendary", () => {
    // A fresh Magus doc (no inherited build.choices) with manual skill ranks
    // set directly, so the eligibility boundaries are isolated from any
    // build-choice floor.
    const doc = baseCharacterDoc({
      items: [{ ...magusClassDoc(), _id: "item-class" }],
      system: {
        level: { value: 3 },
        details: {},
        skills: {
          stealth: { rank: 1 },
          thievery: { rank: 4 }, // already legendary -> not eligible for another increase
        },
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            backgroundFree: [],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const dctx = skillTrainingDialogContext(doc, 3, "skillIncrease");
    const stealthRow = dctx.rows.find((r) => r.slug === "stealth")!;
    expect(stealthRow.eligible).toBe(true);
    expect(stealthRow.targetRank).toBe(2);

    const thieveryRow = dctx.rows.find((r) => r.slug === "thievery")!;
    expect(thieveryRow.eligible).toBe(false);

    // "arcana" is the Magus fixture's trainedSkills.value entry -> already
    // rank 1, NOT eligible for skillTraining, but IS trained-and-eligible
    // for skillIncrease.
    const arcanaRow = dctx.rows.find((r) => r.slug === "arcana")!;
    expect(arcanaRow.eligible).toBe(true);

    const athleticsRow = dctx.rows.find((r) => r.slug === "athletics")!;
    expect(athleticsRow.eligible).toBe(false); // untrained -> can't "increase"
  });

  it("current/target modifiers reflect abilityMod + proficiencyBonus(rank, characterLevel)", () => {
    // Tobias complete: Int mod +3, character level 3.
    const dctx = skillTrainingDialogContext(tobiasLevel3DocComplete(), 1, "skillTraining");
    // "athletics" (str-based, no build floor in this fixture) stays untrained.
    const athleticsRow = dctx.rows.find((r) => r.slug === "athletics")!;
    expect(athleticsRow.abilityMod).toBe(0); // str stays at base 10 in the complete fixture
    expect(athleticsRow.currentMod).toBe(0); // untrained: just the ability mod
    expect(athleticsRow.targetMod).toBe(0 + skillProficiencyBonus(1, 3)); // trained at char level 3
    expect(athleticsRow.targetModFormatted).toBe(`+${String(athleticsRow.targetMod)}`);
  });
});

describe("confirmSkillTraining", () => {
  it("returns null when not editable", () => {
    const dctx = skillTrainingDialogContext(tobiasLevel3DocComplete(), 1, "skillTraining");
    expect(
      confirmSkillTraining(ctx(tobiasLevel3DocComplete(), false), dctx, ["arcana"]),
    ).toBeNull();
  });

  it("persists ALL picks in ONE doc:update carrying the whole choices array (lesson r10: never index arrays)", () => {
    const doc = tobiasLevel3DocComplete();
    const dctx = skillTrainingDialogContext(doc, 1, "skillTraining");
    expect(dctx.groupSlotIds).toHaveLength(5);
    // The dialog seeds with the already-picked skills and sends the FULL list
    // (kept picks + new ones), reconciling the whole level+kind group.
    expect(dctx.filledPicks).toEqual(["stealth", "thievery"]);

    const op = confirmSkillTraining(ctx(doc), dctx, [
      ...dctx.filledPicks,
      "arcana",
      "athletics",
      "medicine",
    ]);
    expect(op).not.toBeNull();
    const wire = { documentType: op!.documentType, updates: [{ _id: op!.id, diff: op!.diff }] };
    expect(DocUpdatePayloadSchema.safeParse(wire).success).toBe(true);

    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    // Pre-existing choices (stealth/thievery) survive on their own slot ids.
    expect(choices.some((c) => c["skill"] === "stealth" && c["slot"] === "skillTraining-1-0")).toBe(
      true,
    );
    expect(
      choices.some((c) => c["skill"] === "thievery" && c["slot"] === "skillTraining-1-1"),
    ).toBe(true);
    // New picks land on the previously-empty slot ids, in order.
    expect(choices).toEqual(
      expect.arrayContaining([
        { level: 1, slot: "skillTraining-1-2", type: "skillTraining", skill: "arcana", rank: 1 },
        { level: 1, slot: "skillTraining-1-3", type: "skillTraining", skill: "athletics", rank: 1 },
        { level: 1, slot: "skillTraining-1-4", type: "skillTraining", skill: "medicine", rank: 1 },
      ]),
    );
    // The unrelated skillIncrease-3 choice is byte-preserved (only this
    // level+kind group is reconciled).
    expect(choices.some((c) => c["slot"] === "skillIncrease-3" && c["skill"] === "stealth")).toBe(
      true,
    );
  });

  it("ignores picks beyond the number of group slots (defensive)", () => {
    const doc = tobiasLevel3DocComplete();
    const dctx = skillTrainingDialogContext(doc, 1, "skillTraining");
    const op = confirmSkillTraining(ctx(doc), dctx, [
      ...dctx.filledPicks,
      "arcana",
      "athletics",
      "medicine",
      "religion", // 6th pick, only 5 slots — dropped
    ]);
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices.some((c) => c["skill"] === "religion")).toBe(false);
  });

  it("skillIncrease kind: recorded rank is targetRank (currentRank+1) from the row, not a hardcoded default", () => {
    const doc = baseCharacterDoc({
      items: [{ ...magusClassDoc(), _id: "item-class" }],
      system: {
        level: { value: 3 },
        details: {},
        skills: { athletics: { rank: 2 } },
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            backgroundFree: [],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
    });
    const dctx = skillTrainingDialogContext(doc, 3, "skillIncrease");
    const op = confirmSkillTraining(ctx(doc), dctx, ["athletics"]);
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices.some((c) => c["skill"] === "athletics" && c["rank"] === 3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R12 item 1 — re-editing a FILLED skillTraining group in place. The dialog
// re-opens pre-populated (`filledPicks`) and confirm reconciles the WHOLE
// level+kind group against the returned pick list, so the ledger of THAT
// origin is substituted, not merely appended to.
// ---------------------------------------------------------------------------

describe("skillTrainingDialogContext — pre-population on re-open (R12 item 1)", () => {
  it("exposes groupSlotIds and filledPicks aligned to the filled slots in slot order", () => {
    const dctx = skillTrainingDialogContext(tobiasLevel3DocComplete(), 1, "skillTraining");
    expect(dctx.groupSlotIds).toEqual([
      "skillTraining-1-0",
      "skillTraining-1-1",
      "skillTraining-1-2",
      "skillTraining-1-3",
      "skillTraining-1-4",
    ]);
    // stealth (slot -0) and thievery (slot -1) are the already-made picks.
    expect(dctx.filledPicks).toEqual(["stealth", "thievery"]);
  });

  it("a skill already picked BY THIS GROUP stays eligible/reversible (its own choice is excluded from currentRank)", () => {
    // thievery is trained ONLY by this level-1 skillTraining group — so when
    // the dialog re-opens it must read as currentRank 0 / eligible so the
    // player can deselect or swap it. (stealth also gets a level-3
    // skillIncrease, so it legitimately stays rank 2 / ineligible here.)
    const dctx = skillTrainingDialogContext(tobiasLevel3DocComplete(), 1, "skillTraining");
    const thievery = dctx.rows.find((r) => r.slug === "thievery")!;
    expect(thievery.currentRank).toBe(0);
    expect(thievery.eligible).toBe(true);

    const stealth = dctx.rows.find((r) => r.slug === "stealth")!;
    expect(stealth.currentRank).toBe(2); // from the level-3 skillIncrease, not this group
    expect(stealth.eligible).toBe(false);
  });
});

describe("confirmSkillTraining — re-edit substitutes the group ledger (R12 item 1)", () => {
  it("swapping a pick replaces the old skill on the SAME slot, no duplication", () => {
    const doc = tobiasLevel3DocComplete();
    const dctx = skillTrainingDialogContext(doc, 1, "skillTraining");
    // Player swaps thievery (slot -1) for medicine, keeps stealth, and fills
    // the 3 empty slots — the dialog sends the FULL reconciled list.
    const op = confirmSkillTraining(ctx(doc), dctx, [
      "stealth",
      "medicine", // was thievery
      "arcana",
      "athletics",
      "society",
    ]);
    expect(op).not.toBeNull();
    const wire = { documentType: op!.documentType, updates: [{ _id: op!.id, diff: op!.diff }] };
    expect(DocUpdatePayloadSchema.safeParse(wire).success).toBe(true);

    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    const level1Training = choices.filter((c) => c["type"] === "skillTraining" && c["level"] === 1);
    // Exactly 5 level-1 training choices, one per group slot — no orphaned
    // thievery entry, no duplicate slot.
    expect(level1Training).toHaveLength(5);
    expect(level1Training.some((c) => c["skill"] === "thievery")).toBe(false);
    expect(
      level1Training.some((c) => c["skill"] === "medicine" && c["slot"] === "skillTraining-1-1"),
    ).toBe(true);
    const slotIds = level1Training.map((c) => c["slot"]);
    expect(new Set(slotIds).size).toBe(5); // all distinct
  });

  it("deselecting a pick removes its choice, leaving the group partially filled", () => {
    const doc = tobiasLevel3DocComplete();
    const dctx = skillTrainingDialogContext(doc, 1, "skillTraining");
    // Player keeps only stealth (deselects thievery, adds nothing).
    const op = confirmSkillTraining(ctx(doc), dctx, ["stealth"]);
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    const level1Training = choices.filter((c) => c["type"] === "skillTraining" && c["level"] === 1);
    expect(level1Training).toHaveLength(1);
    expect(level1Training[0]!["skill"]).toBe("stealth");
    expect(level1Training[0]!["slot"]).toBe("skillTraining-1-0");
    // thievery's choice is gone.
    expect(choices.some((c) => c["skill"] === "thievery")).toBe(false);
  });

  it("re-editing one level's group never disturbs another level/kind's choices", () => {
    const doc = tobiasLevel3DocComplete();
    const dctx = skillTrainingDialogContext(doc, 1, "skillTraining");
    const op = confirmSkillTraining(ctx(doc), dctx, [
      "stealth",
      "thievery",
      "arcana",
      "athletics",
      "society",
    ]);
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    // The level-3 skillIncrease and the abilityBoosts-1 marker are untouched.
    expect(
      choices.some((c) => c["slot"] === "skillIncrease-3" && c["type"] === "skillIncrease"),
    ).toBe(true);
    expect(
      choices.some((c) => c["slot"] === "abilityBoosts-1" && c["type"] === "abilityBoosts"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R12 item 1 — re-editing a FILLED abilityBoosts slot. abilityBoostsSlotContext
// already reads the live ledger, so re-open pre-population is "free"; these
// tests lock in that setAbilityBoosts substitutes only the edited origin and
// that the same-origin exclusion rule survives a re-edit.
// ---------------------------------------------------------------------------

describe("abilityBoosts re-edit (R12 item 1)", () => {
  it("re-opening a filled slot seeds each group from the live ledger (initialFreeSlugs)", () => {
    const slotCtx = abilityBoostsSlotContext(tobiasLevel3DocComplete(), 1);
    const byOrigin = Object.fromEntries(slotCtx.groups.map((g) => [g.origin, g]));
    expect(byOrigin["ancestryFree"]!.initialFreeSlugs).toEqual(["cha"]);
    expect(byOrigin["backgroundFree"]!.initialFreeSlugs).toEqual(["int", "dex"]);
    expect(byOrigin["classBoost"]!.initialFreeSlugs).toEqual(["str"]);
    expect(byOrigin["levelled"]!.initialFreeSlugs).toEqual(["int", "dex", "con", "cha"]);
    // A fully-seeded slot reports filled.
    expect(isAbilityBoostsSlotFilled(slotCtx)).toBe(true);
  });

  it("re-editing ONE origin substitutes only that origin's key, leaving the others intact", () => {
    const doc = tobiasLevel3DocComplete();
    // Player re-opens and changes ancestryFree from [cha] to [wis].
    const op = setAbilityBoosts(ctx(doc), "ancestryFree", ["wis"]);
    expect(op).not.toBeNull();
    expect(op!.diff).toEqual({ "system.build.abilities.ancestryFree": ["wis"] });
    // The op targets ONLY ancestryFree — background/class/levelled keys are
    // absent from the diff, so they are byte-preserved by the merge.
    expect(Object.keys(op!.diff)).toEqual(["system.build.abilities.ancestryFree"]);
  });

  it("re-editing a levelled milestone overwrites only that level's boosts array", () => {
    const doc = tobiasLevel3DocComplete();
    const op = setAbilityBoosts(ctx(doc), "levelled", ["str", "con", "wis", "cha"], 1);
    expect(op).not.toBeNull();
    const levelled = op!.diff["system.build.abilities.levelledBoosts"] as Record<string, unknown>;
    expect(levelled["1"]).toEqual(["str", "con", "wis", "cha"]);
  });

  it("same-origin exclusion (r11) still holds on re-edit — a group excludes only its OWN fixed abilities", () => {
    const slotCtx = abilityBoostsSlotContext(tobiasLevel3DocComplete(), 1);
    const ancestryFree = slotCtx.groups.find((g) => g.origin === "ancestryFree")!;
    // Ratfolk's fixed ancestry boosts are dex/int — excluded from the ancestry
    // FREE group so the same origin can't double-boost them.
    expect(ancestryFree.excludedSlugs).toEqual(expect.arrayContaining(["dex", "int"]));
    // But a DIFFERENT origin (levelled) may still pick dex/int — cross-origin
    // repetition is legal (that's how 16s exist at level 1).
    const levelled = slotCtx.groups.find((g) => g.origin === "levelled")!;
    expect(levelled.excludedSlugs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R12 item 2 — curated ability/skill help text module.
// ---------------------------------------------------------------------------

describe("abilitySkillHelp (R12 item 2)", () => {
  it("covers all six abilities with a name, summary and non-empty affects list", () => {
    for (const slug of ["str", "dex", "con", "int", "wis", "cha"] as const) {
      const help = abilityHelpFor(slug);
      expect(help).not.toBeNull();
      expect(help!.name.length).toBeGreaterThan(0);
      expect(help!.summary.length).toBeGreaterThan(0);
      expect(help!.affects.length).toBeGreaterThan(0);
    }
    expect(Object.keys(ABILITY_HELP)).toHaveLength(6);
  });

  it("returns null help for an unknown ability slug", () => {
    expect(abilityHelpFor("zzz")).toBeNull();
  });

  it("covers all 16 canonical skills with a description and ability key", () => {
    expect(Object.keys(SKILL_HELP)).toHaveLength(16);
    for (const slug of Object.keys(SKILL_HELP)) {
      const help = skillHelpFor(slug);
      expect(help.description.length).toBeGreaterThan(0);
      expect(["str", "dex", "con", "int", "wis", "cha"]).toContain(help.ability);
    }
  });

  it("folds any lore-* slug onto the generic LORE_HELP entry", () => {
    expect(skillHelpFor("lore-warfare")).toBe(LORE_HELP);
    expect(skillHelpFor("lore-anything")).toBe(LORE_HELP);
  });

  it("falls back to LORE_HELP for an unknown non-lore slug rather than throwing", () => {
    expect(skillHelpFor("made-up-skill")).toBe(LORE_HELP);
  });

  it("TEML legend has all five ranks with the Remaster bonus-over-level values", () => {
    expect(TEML_LEGEND.map((r) => r.badge)).toEqual(["U", "T", "E", "M", "L"]);
    expect(TEML_LEGEND.map((r) => r.bonusOverLevel)).toEqual([0, 2, 4, 6, 8]);
  });
});

// ---------------------------------------------------------------------------
// addLoreSkill
// ---------------------------------------------------------------------------

describe("addLoreSkill", () => {
  it("returns null when not editable", () => {
    expect(addLoreSkill(ctx(baseCharacterDoc(), false), "Nature")).toBeNull();
  });

  it("returns null for a blank name", () => {
    expect(addLoreSkill(ctx(baseCharacterDoc()), "   ")).toBeNull();
  });

  it("creates a slugified lore-<name> entry at rank 0, valid against DocUpdatePayloadSchema", () => {
    const op = addLoreSkill(ctx(baseCharacterDoc()), "Nature Lore");
    expect(op).not.toBeNull();
    expect(op!.diff["system.skills.lore-nature-lore"]).toEqual({
      rank: 0,
      lore: true,
      label: "Nature Lore",
    });
    const wire = { documentType: op!.documentType, updates: [{ _id: op!.id, diff: op!.diff }] };
    expect(DocUpdatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("returns null when a lore with the same slug already exists", () => {
    const doc = baseCharacterDoc({
      system: {
        level: { value: 1 },
        details: {},
        skills: { "lore-nature-lore": { rank: 1, lore: true } },
      },
    });
    expect(addLoreSkill(ctx(doc), "Nature Lore")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Granted feat choices (W1-D) — feats that grant a nested feat choice, e.g.
// Basic Concoction (feats-core, level 4, category "class", trait
// "archetype") → "You gain a 1st- or 2nd-level alchemist feat." Modeled via
// GRANTED_FEAT_CHOICES + a `grantedFeat` sub-slot rendered nested under the
// granting feat's own slot (see LevelCard.svelte's `--nested` styling).
// ---------------------------------------------------------------------------

/** Tobias level 3 fixture (freeArchetype on) leveled to 4, with Basic Concoction filling the level-4 archetypeFeat slot instead of a plain archetype feat. */
function tobiasLevel4WithBasicConcoctionDoc(grantedFilled = false): Record<string, unknown> {
  const base = tobiasLevel3Doc();
  const sys = base["system"] as Record<string, unknown> & { level: { value: number } };
  sys.level = { value: 4 };
  const items = [...(base["items"] as Array<Record<string, unknown>>)];
  items.push({
    ...basicConcoctionFeatDoc(),
    _id: "item-archetype-feat-4",
    flags: { fusion: { build: { level: 4, slot: "archetypeFeat-4" } } },
  });
  if (grantedFilled) {
    items.push({
      ...alchemicalFamiliarFeatDoc(),
      _id: "item-granted-feat",
      flags: { fusion: { build: { level: 4, slot: "archetypeFeat-4:granted" } } },
    });
  }
  return { ...base, items };
}

describe("grantedFeatChoiceFor / matchesGrantedFeatFilter", () => {
  it("resolves Basic Concoction's grant filter by name", () => {
    const grant = grantedFeatChoiceFor("Basic Concoction");
    expect(grant).toBeDefined();
    expect(grant!.labelKey).toBe("FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction");
  });

  it("is case/whitespace insensitive (same nameToSlug convention as classSlug/ancestrySlug)", () => {
    expect(grantedFeatChoiceFor("  BASIC CONCOCTION  ")).toBeDefined();
  });

  it("returns undefined for a feat with no registered grant", () => {
    expect(grantedFeatChoiceFor("Arcane Fists")).toBeUndefined();
    expect(grantedFeatChoiceFor(undefined)).toBeUndefined();
  });

  it("accepts a real 1st-level alchemist class feat against Basic Concoction's filter", () => {
    const grant = grantedFeatChoiceFor("Basic Concoction")!;
    expect(matchesGrantedFeatFilter(asFeatDocLike(alchemicalFamiliarFeatDoc()), grant)).toBe(true);
  });

  it("rejects a feat missing category/trait/level constraints", () => {
    const grant = grantedFeatChoiceFor("Basic Concoction")!;
    expect(matchesGrantedFeatFilter(asFeatDocLike(ineligibleGeneralFeatDoc()), grant)).toBe(false);
  });

  it("rejects a class feat of the right trait but ABOVE the level cap", () => {
    const grant = grantedFeatChoiceFor("Basic Concoction")!;
    const tooHigh: FeatDocLike["system"] = {
      category: "class",
      level: 3,
      traits: { value: ["alchemist"] },
    };
    expect(matchesGrantedFeatFilter({ system: tooHigh }, grant)).toBe(false);
  });
});

describe("ancestryChoiceGrantFor / isAncestryAdoptable", () => {
  it("resolves Adopted Ancestry's sub-slot config by name", () => {
    const grant = ancestryChoiceGrantFor("Adopted Ancestry");
    expect(grant).toBeDefined();
    expect(grant!.labelKey).toBe("FUSION.Sheet.Plan.SlotLabel.adoptedAncestryChoice");
  });

  it("is case/whitespace insensitive (same nameToSlug convention as classSlug/ancestrySlug)", () => {
    expect(ancestryChoiceGrantFor("  ADOPTED ANCESTRY  ")).toBeDefined();
  });

  it("returns undefined for a feat with no registered ancestry-choice grant", () => {
    expect(ancestryChoiceGrantFor("Arcane Fists")).toBeUndefined();
    expect(ancestryChoiceGrantFor(undefined)).toBeUndefined();
  });

  it("isAncestryAdoptable: excludes the character's own ancestry (Ratfolk)", () => {
    expect(isAncestryAdoptable("Ratfolk", "ratfolk")).toBe(false);
  });

  it("isAncestryAdoptable: includes every other ancestry (Fleshwarp)", () => {
    expect(isAncestryAdoptable("Fleshwarp", "ratfolk")).toBe(true);
  });

  it("isAncestryAdoptable: case/whitespace insensitive, mirroring nameToSlug", () => {
    expect(isAncestryAdoptable("  RATFOLK  ", "ratfolk")).toBe(false);
  });

  it("isAncestryAdoptable: everything is adoptable when the character has no ancestry yet", () => {
    expect(isAncestryAdoptable("Ratfolk", undefined)).toBe(true);
  });
});

describe("derivePlan — granted feat sub-slot (Basic Concoction, real fixture)", () => {
  it("generates an unfilled grantedFeat sub-slot right after the filled archetypeFeat-4 slot", () => {
    const plan = derivePlan(tobiasLevel4WithBasicConcoctionDoc());
    const l4 = plan.levels.find((l) => l.level === 4)!;
    const parentIdx = l4.slots.findIndex((s) => s.slotId === "archetypeFeat-4");
    const subIdx = l4.slots.findIndex((s) => s.slotId === "archetypeFeat-4:granted");
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBe(parentIdx + 1);

    const sub = l4.slots[subIdx]!;
    expect(sub.type).toBe("grantedFeat");
    expect(sub.filled).toBe(false);
    expect(sub.parentSlotId).toBe("archetypeFeat-4");
    expect(sub.grantFilter?.labelKey).toBe(
      "FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction",
    );
  });

  it("reports the sub-slot filled once the granted alchemist feat is embedded", () => {
    const plan = derivePlan(tobiasLevel4WithBasicConcoctionDoc(true));
    const l4 = plan.levels.find((l) => l.level === 4)!;
    const sub = l4.slots.find((s) => s.slotId === "archetypeFeat-4:granted")!;
    expect(sub.filled).toBe(true);
    expect(sub.choiceName).toBe("Alchemical Familiar");
    expect(sub.itemId).toBe("item-granted-feat");
  });

  it("does NOT generate a sub-slot for a feat with no registered grant (e.g. a plain archetype feat)", () => {
    const plan = derivePlan(tobiasLevel3Doc());
    const l2 = plan.levels.find((l) => l.level === 2)!;
    expect(l2.slots.some((s) => s.slotId === "archetypeFeat-2:granted")).toBe(false);
  });

  it("does NOT generate a sub-slot while the parent slot is still empty", () => {
    const doc = baseCharacterDoc({
      system: { level: { value: 2 }, details: {}, build: { freeArchetype: true } },
      items: [{ ...magusClassDoc(), _id: "item-class" }],
    });
    const plan = derivePlan(doc);
    const l2 = plan.levels.find((l) => l.level === 2)!;
    expect(l2.slots.some((s) => s.slotId === "archetypeFeat-2:granted")).toBe(false);
  });
});

describe("chooseFeat — filling a grantedFeat sub-slot", () => {
  it("embeds the chosen alchemist feat tagged with the sub-slot id and appends a matching build choice", () => {
    const doc = tobiasLevel4WithBasicConcoctionDoc();
    const plan = derivePlan(doc);
    const l4 = plan.levels.find((l) => l.level === 4)!;
    const subSlot = l4.slots.find((s) => s.slotId === "archetypeFeat-4:granted")!;

    const ops = chooseFeat(ctx(doc), subSlot, 4, alchemicalFamiliarFeatDoc());
    expect(ops).toHaveLength(2);

    const createOp = ops[0] as { data: Record<string, unknown> };
    expect(createOp.data["flags"] as Record<string, unknown>).toMatchObject({
      fusion: { build: { level: 4, slot: "archetypeFeat-4:granted" } },
    });

    const updateOp = ops[1] as DocUpdatePayload;
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toContainEqual({
      level: 4,
      slot: "archetypeFeat-4:granted",
      type: "grantedFeat",
    });
  });
});

describe("removeChoice — cascades to a filled grantedFeat sub-slot", () => {
  it("deletes both the parent feat item AND the granted sub-slot's item, and strips both choices entries", () => {
    const doc = tobiasLevel4WithBasicConcoctionDoc(true);
    const sysBuild = (doc["system"] as Record<string, unknown>)["build"] as Record<string, unknown>;
    sysBuild["choices"] = [
      ...(sysBuild["choices"] as unknown[]),
      { level: 4, slot: "archetypeFeat-4", type: "archetypeFeat" },
      { level: 4, slot: "archetypeFeat-4:granted", type: "grantedFeat" },
    ];

    const plan = derivePlan(doc);
    const l4 = plan.levels.find((l) => l.level === 4)!;
    const parentSlot = l4.slots.find((s) => s.slotId === "archetypeFeat-4")!;
    expect(parentSlot.filled).toBe(true);

    const ops = removeChoice(ctx(doc), parentSlot);
    const deleteOps = ops.filter((op) => op.type === "doc:delete") as Array<{ id: string }>;
    expect(deleteOps.map((op) => op.id).sort()).toEqual(
      ["item-archetype-feat-4", "item-granted-feat"].sort(),
    );

    const updateOp = ops.find((op) => op.type === "doc:update") as DocUpdatePayload;
    const remainingChoices = updateOp.diff["system.build.choices"] as Array<
      Record<string, unknown>
    >;
    expect(remainingChoices.some((c) => c["slot"] === "archetypeFeat-4")).toBe(false);
    expect(remainingChoices.some((c) => c["slot"] === "archetypeFeat-4:granted")).toBe(false);
  });

  it("removing the parent when the sub-slot was never filled only deletes the parent item (no-op cascade)", () => {
    const doc = tobiasLevel4WithBasicConcoctionDoc(false);
    const plan = derivePlan(doc);
    const l4 = plan.levels.find((l) => l.level === 4)!;
    const parentSlot = l4.slots.find((s) => s.slotId === "archetypeFeat-4")!;

    const ops = removeChoice(ctx(doc), parentSlot);
    const deleteOps = ops.filter((op) => op.type === "doc:delete") as Array<{ id: string }>;
    expect(deleteOps).toHaveLength(1);
    expect(deleteOps[0]!.id).toBe("item-archetype-feat-4");
  });
});

// ---------------------------------------------------------------------------
// Adopted Ancestry sub-slot (Tobias's tobiasLevel3Doc fixture already embeds
// "Adopted Ancestry" as generalFeat-3, see adoptedAncestryGeneralFeatDoc).
// ---------------------------------------------------------------------------

describe("derivePlan — adopted ancestry sub-slot (Adopted Ancestry, real-shaped fixture)", () => {
  it("generates an unfilled adoptedAncestryChoice sub-slot right after the filled generalFeat-3 slot", () => {
    const plan = derivePlan(tobiasLevel3Doc());
    const l3 = plan.levels.find((l) => l.level === 3)!;
    const parentIdx = l3.slots.findIndex((s) => s.slotId === "generalFeat-3");
    const subIdx = l3.slots.findIndex((s) => s.slotId === "generalFeat-3:ancestry");
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBe(parentIdx + 1);

    const sub = l3.slots[subIdx]!;
    expect(sub.type).toBe("adoptedAncestryChoice");
    expect(sub.filled).toBe(false);
    expect(sub.parentSlotId).toBe("generalFeat-3");
  });

  it("reports the sub-slot filled once the adopted-ancestry choice is recorded, showing the picked ancestry's name", () => {
    const doc = tobiasLevel3Doc();
    const sysBuild = (doc["system"] as Record<string, unknown>)["build"] as Record<string, unknown>;
    sysBuild["choices"] = [
      ...(sysBuild["choices"] as unknown[]),
      { level: 3, slot: "generalFeat-3:ancestry", type: "adoptedAncestryChoice", ref: "Fleshwarp" },
    ];
    const plan = derivePlan(doc);
    const l3 = plan.levels.find((l) => l.level === 3)!;
    const sub = l3.slots.find((s) => s.slotId === "generalFeat-3:ancestry")!;
    expect(sub.filled).toBe(true);
    expect(sub.choiceName).toBe("Fleshwarp");
  });

  it("does NOT generate a sub-slot for a general feat with no registered ancestry-choice grant", () => {
    const doc = tobiasLevel3Doc();
    const items = doc["items"] as Array<Record<string, unknown>>;
    const idx = items.findIndex((it) => it["_id"] === "item-general-feat-3");
    items[idx] = {
      _id: "item-general-feat-3",
      name: "Toughness",
      type: "feat",
      system: { category: "general", level: 3, traits: { value: ["general"] } },
      flags: { fusion: { build: { level: 3, slot: "generalFeat-3" } } },
    };
    const plan = derivePlan(doc);
    const l3 = plan.levels.find((l) => l.level === 3)!;
    expect(l3.slots.some((s) => s.slotId === "generalFeat-3:ancestry")).toBe(false);
  });

  it("does NOT generate a sub-slot while the parent generalFeat slot is still empty", () => {
    const doc = tobiasLevel3Doc();
    const items = doc["items"] as Array<Record<string, unknown>>;
    doc["items"] = items.filter((it) => it["_id"] !== "item-general-feat-3");
    const plan = derivePlan(doc);
    const l3 = plan.levels.find((l) => l.level === 3)!;
    expect(l3.slots.some((s) => s.slotId === "generalFeat-3:ancestry")).toBe(false);
  });
});

describe("chooseAdoptedAncestry", () => {
  it("records a CHOICE-ONLY entry (no embedded item created) carrying the picked ancestry's name in ref", () => {
    const doc = tobiasLevel3Doc();
    const plan = derivePlan(doc);
    const l3 = plan.levels.find((l) => l.level === 3)!;
    const subSlot = l3.slots.find((s) => s.slotId === "generalFeat-3:ancestry")!;

    const op = chooseAdoptedAncestry(ctx(doc), subSlot, 3, fleshwarpAncestryDoc());
    expect(op).not.toBeNull();
    expect(op!.type).toBe("doc:update");
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toContainEqual({
      level: 3,
      slot: "generalFeat-3:ancestry",
      type: "adoptedAncestryChoice",
      ref: "Fleshwarp",
    });
  });

  it("replaces a prior pick for the SAME sub-slot instead of duplicating it (re-choosing swaps)", () => {
    const doc = tobiasLevel3Doc();
    const sysBuild = (doc["system"] as Record<string, unknown>)["build"] as Record<string, unknown>;
    sysBuild["choices"] = [
      ...(sysBuild["choices"] as unknown[]),
      { level: 3, slot: "generalFeat-3:ancestry", type: "adoptedAncestryChoice", ref: "Ratfolk" },
    ];
    const plan = derivePlan(doc);
    const l3 = plan.levels.find((l) => l.level === 3)!;
    const subSlot = l3.slots.find((s) => s.slotId === "generalFeat-3:ancestry")!;

    const op = chooseAdoptedAncestry(ctx(doc), subSlot, 3, fleshwarpAncestryDoc())!;
    const choices = op.diff["system.build.choices"] as Array<Record<string, unknown>>;
    const matching = choices.filter((c) => c["slot"] === "generalFeat-3:ancestry");
    expect(matching).toHaveLength(1);
    expect(matching[0]!["ref"]).toBe("Fleshwarp");
  });

  it("returns null when not editable", () => {
    const doc = tobiasLevel3Doc();
    const plan = derivePlan(doc);
    const l3 = plan.levels.find((l) => l.level === 3)!;
    const subSlot = l3.slots.find((s) => s.slotId === "generalFeat-3:ancestry")!;
    expect(chooseAdoptedAncestry(ctx(doc, false), subSlot, 3, fleshwarpAncestryDoc())).toBeNull();
  });
});

describe("removeChoice — cascades to a filled adoptedAncestryChoice sub-slot", () => {
  it("removing the parent Adopted Ancestry feat deletes only the parent's item (choice-only sub-slot has none) and strips BOTH choices entries", () => {
    const doc = tobiasLevel3Doc();
    const sysBuild = (doc["system"] as Record<string, unknown>)["build"] as Record<string, unknown>;
    sysBuild["choices"] = [
      ...(sysBuild["choices"] as unknown[]),
      { level: 3, slot: "generalFeat-3", type: "generalFeat" },
      { level: 3, slot: "generalFeat-3:ancestry", type: "adoptedAncestryChoice", ref: "Fleshwarp" },
    ];

    const plan = derivePlan(doc);
    const l3 = plan.levels.find((l) => l.level === 3)!;
    const parentSlot = l3.slots.find((s) => s.slotId === "generalFeat-3")!;
    expect(parentSlot.filled).toBe(true);

    const ops = removeChoice(ctx(doc), parentSlot);
    const deleteOps = ops.filter((op) => op.type === "doc:delete") as Array<{ id: string }>;
    expect(deleteOps.map((op) => op.id)).toEqual(["item-general-feat-3"]);

    const updateOp = ops.find((op) => op.type === "doc:update") as DocUpdatePayload;
    const remainingChoices = updateOp.diff["system.build.choices"] as Array<
      Record<string, unknown>
    >;
    expect(remainingChoices.some((c) => c["slot"] === "generalFeat-3")).toBe(false);
    expect(remainingChoices.some((c) => c["slot"] === "generalFeat-3:ancestry")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R12 — details-panel resolution (chips + filled slots + picker default)
// ---------------------------------------------------------------------------

describe("resolveSlot — sourceId population (issue #44)", () => {
  it("carries the embedded item's flags.fusion.sourceId onto the filled slot", () => {
    const doc = {
      _id: "actor-x",
      name: "X",
      type: "character",
      items: [
        { ...magusClassDoc(), _id: "item-class" },
        // Magus's featLevels.skill starts at 2 (see magusClassDoc fixture
        // above) — skillFeat-1 never exists, so the slot lookup below would
        // find nothing at level 1.
        embeddedFeatItem(acupuncturistFeatDoc(), "item-skill-2", {
          level: 2,
          slot: "skillFeat-2",
        }),
      ],
      system: {
        level: { value: 2 },
        details: {},
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            classBoost: ["int"],
            levelledBoosts: {},
          },
          choices: [],
        },
      },
    };
    const plan = derivePlan(doc);
    const lvl2 = plan.levels.find((l) => l.level === 2)!;
    const slot = lvl2.slots.find((s) => s.slotId === "skillFeat-2")!;
    expect(slot.filled).toBe(true);
    expect(slot.sourceId).toBe("SC95hfEEHQs7E9cG");
  });
});

describe("detailsRequestForSlot", () => {
  function slot(overrides: Partial<PlanSlotModel>): PlanSlotModel {
    return {
      slotId: "s",
      type: "classFeat",
      label: "Class Feat",
      filled: true,
      choiceName: "Sudden Charge",
      ...overrides,
    };
  }

  it("routes a filled hybrid-study slot to class-features-core", () => {
    const req = detailsRequestForSlot(slot({ type: "hybridStudy", choiceName: "Arcane Fists" }));
    expect(req).toEqual({ packSlug: "class-features-core", name: "Arcane Fists" });
  });

  // Issue #58: the Plan column already knows the REAL grant level (the
  // enclosing LevelPlanModel.level) when it opens this dialog for a filled
  // slot — passing it through lets the details panel override a shared
  // class-features-core document's divergent static system.level instead of
  // showing it with false confidence.
  it("carries an explicit level through to the request when the caller supplies it", () => {
    const req = detailsRequestForSlot(slot({ type: "hybridStudy", choiceName: "Arcane Fists" }), 9);
    expect(req).toEqual({ packSlug: "class-features-core", name: "Arcane Fists", level: 9 });
  });

  it("omits the level key entirely when the caller doesn't supply one (unchanged behavior)", () => {
    const req = detailsRequestForSlot(slot({ type: "classFeat", choiceName: "Sudden Charge" }));
    expect(req).not.toHaveProperty("level");
  });

  // Issue #44: a slot's backing embedded item's flags.fusion.sourceId (set by
  // resolveSlot) rides along in the request so the details dialog can resolve
  // the EXACT document instead of matching by name.
  it("carries the slot's sourceId through to the request when present", () => {
    const req = detailsRequestForSlot(
      slot({ type: "classFeat", choiceName: "Sudden Charge", sourceId: "SUDDEN_SID" }),
    );
    expect(req).toEqual({ packSlug: "feats-core", name: "Sudden Charge", sourceId: "SUDDEN_SID" });
  });

  it("omits the sourceId key entirely when the slot has none (choice-backed slots, unchanged behavior)", () => {
    const req = detailsRequestForSlot(slot({ type: "classFeat", choiceName: "Sudden Charge" }));
    expect(req).not.toHaveProperty("sourceId");
  });

  it("routes every filled feat-family slot to feats-core", () => {
    for (const type of [
      "ancestryFeat",
      "classFeat",
      "generalFeat",
      "skillFeat",
      "archetypeFeat",
      "grantedFeat",
    ] as const) {
      const req = detailsRequestForSlot(slot({ type, choiceName: "Some Feat" }));
      expect(req).toEqual({ packSlug: "feats-core", name: "Some Feat" });
    }
  });

  it("routes a filled adoptedAncestryChoice sub-slot to ancestries-core", () => {
    const req = detailsRequestForSlot(
      slot({ type: "adoptedAncestryChoice", choiceName: "Fleshwarp" }),
    );
    expect(req).toEqual({ packSlug: "ancestries-core", name: "Fleshwarp" });
  });

  it("returns null for slot types with no single compendium document", () => {
    expect(
      detailsRequestForSlot(slot({ type: "abilityBoosts", choiceName: "str, dex" })),
    ).toBeNull();
    expect(detailsRequestForSlot(slot({ type: "skillTraining", choiceName: "2/4" }))).toBeNull();
    expect(detailsRequestForSlot(slot({ type: "skillIncrease", choiceName: "1/1" }))).toBeNull();
  });

  it("returns null for an unfilled slot or one with no choice name", () => {
    expect(detailsRequestForSlot(slot({ filled: false }))).toBeNull();
    // A filled slot missing choiceName entirely (not "choiceName: undefined",
    // which exactOptionalPropertyTypes rejects) also yields no request.
    const noName: PlanSlotModel = {
      slotId: "s",
      type: "classFeat",
      label: "Class Feat",
      filled: true,
    };
    expect(detailsRequestForSlot(noName)).toBeNull();
  });
});

describe("detailsRequestForAutoFeature", () => {
  it("always resolves an auto-feature against class-features-core", () => {
    const req = detailsRequestForAutoFeature({ name: "Spellstrike", locked: true });
    expect(req).toEqual({ packSlug: "class-features-core", name: "Spellstrike" });
  });

  // Issue #58: locked auto-feature chips (e.g. "Reflex Expertise") are the
  // exact case from the bug report — PlanColumn knows the chip's real grant
  // level (LevelPlanModel.level) and now threads it through.
  it("carries an explicit level through to the request when the caller supplies it", () => {
    const req = detailsRequestForAutoFeature({ name: "Reflex Expertise", locked: true }, 9);
    expect(req).toEqual({ packSlug: "class-features-core", name: "Reflex Expertise", level: 9 });
  });

  it("omits the level key entirely when the caller doesn't supply one (unchanged behavior)", () => {
    const req = detailsRequestForAutoFeature({ name: "Spellstrike", locked: true });
    expect(req).not.toHaveProperty("level");
  });

  // Issue #44: featuresByLevel[].uuid IS the feature's own pack _id (not a
  // Foundry compendium uuid despite the name) — carried as AutoFeatureModel's
  // docId so the details dialog can skip name matching entirely.
  it("carries the feature's docId through to the request when present", () => {
    const req = detailsRequestForAutoFeature({
      name: "Arcane Cascade",
      locked: true,
      docId: "pf6KyAB13Qf5GQ9Q",
    });
    expect(req).toEqual({
      packSlug: "class-features-core",
      name: "Arcane Cascade",
      docId: "pf6KyAB13Qf5GQ9Q",
    });
  });

  // A class-granted action chip (classGrantedActionChips) has no
  // featuresByLevel entry of its own — its identity is the materialized
  // item's sourceId instead.
  it("carries the granted action's sourceId through to the request when present", () => {
    const req = detailsRequestForAutoFeature({
      name: "Mystic Strike",
      locked: true,
      detailsPackSlug: "actions-core",
      sourceId: "MS_ACT",
    });
    expect(req).toEqual({ packSlug: "actions-core", name: "Mystic Strike", sourceId: "MS_ACT" });
  });
});

describe("findEntryUuidByName", () => {
  const entries: PlanIndexEntryLike[] = [
    { name: "Arcane Spellcasting (Magus)", uuid: "Compendium.pf2e.class-features-core.Item.a1" },
    { name: "Spellstrike", uuid: "Compendium.pf2e.class-features-core.Item.b2" },
    { name: "Conflux Spells", uuid: "Compendium.pf2e.class-features-core.Item.c3" },
  ];

  it("matches an exact name (the common chip case, parenthetical included)", () => {
    expect(findEntryUuidByName(entries, "Arcane Spellcasting (Magus)")).toBe(
      "Compendium.pf2e.class-features-core.Item.a1",
    );
  });

  it("is accent- and case-insensitive", () => {
    expect(findEntryUuidByName(entries, "spellstrike")).toBe(
      "Compendium.pf2e.class-features-core.Item.b2",
    );
    expect(findEntryUuidByName([{ name: "Estratégia", uuid: "u" }], "estrategia")).toBe("u");
  });

  it("falls back to a UNIQUE prefix match when there is no exact match", () => {
    expect(findEntryUuidByName(entries, "Conflux")).toBe(
      "Compendium.pf2e.class-features-core.Item.c3",
    );
  });

  it("returns null on no match, empty name, or an ambiguous prefix", () => {
    expect(findEntryUuidByName(entries, "Nonexistent Feature")).toBeNull();
    expect(findEntryUuidByName(entries, "")).toBeNull();
    const ambiguous: PlanIndexEntryLike[] = [
      { name: "Arcane Cascade", uuid: "x1" },
      { name: "Arcane Fists", uuid: "x2" },
    ];
    expect(findEntryUuidByName(ambiguous, "Arcane")).toBeNull();
  });
});

describe("resolveDetailsEntryUuid (issue #44 — id before name)", () => {
  // Same shape findEntryUuidByName's own "ambiguous prefix" fixture uses,
  // extended with the id fields a real PackIndexEntry search result carries
  // (_id always; index["flags.fusion.sourceId"] since issue #41 indexed it).
  const entries: PlanIndexEntryLike[] = [
    {
      name: "Arcane Cascade",
      uuid: "Compendium.pf2e.class-features-core.Item.x1",
      _id: "x1",
      index: { "flags.fusion.sourceId": "SRC_CASCADE" },
    },
    {
      name: "Arcane Fists",
      uuid: "Compendium.pf2e.class-features-core.Item.x2",
      _id: "x2",
      index: { "flags.fusion.sourceId": "SRC_FISTS" },
    },
  ];

  it("resolves by docId even when the request name is an ambiguous prefix of 2+ entries", () => {
    // A chip whose stored name got truncated to "Arcane" would fail name
    // resolution outright (2 prefix candidates, no unique winner — see the
    // fallback test below); docId skips name matching and hits the exact doc.
    expect(
      resolveDetailsEntryUuid(entries, {
        packSlug: "class-features-core",
        name: "Arcane",
        docId: "x2",
      }),
    ).toBe("Compendium.pf2e.class-features-core.Item.x2");
  });

  it("resolves by sourceId under the same ambiguous name, when docId is unavailable", () => {
    expect(
      resolveDetailsEntryUuid(entries, {
        packSlug: "class-features-core",
        name: "Arcane",
        sourceId: "SRC_CASCADE",
      }),
    ).toBe("Compendium.pf2e.class-features-core.Item.x1");
  });

  it("prefers docId over sourceId when both are present", () => {
    expect(
      resolveDetailsEntryUuid(entries, {
        packSlug: "class-features-core",
        name: "Arcane",
        docId: "x1",
        sourceId: "SRC_FISTS",
      }),
    ).toBe("Compendium.pf2e.class-features-core.Item.x1");
  });

  it("falls back to findEntryUuidByName's name resolution when neither id is present — rule 5: never invent an id the data lacks", () => {
    // Reproduces the exact ambiguous-prefix null findEntryUuidByName itself
    // returns for this fixture — the fallback delegates, it doesn't retry.
    expect(
      resolveDetailsEntryUuid(entries, { packSlug: "class-features-core", name: "Arcane" }),
    ).toBeNull();
  });

  it("falls back to name resolution when the given id does not match any entry (stale docId/sourceId)", () => {
    expect(
      resolveDetailsEntryUuid(entries, {
        packSlug: "class-features-core",
        name: "Arcane Fists",
        docId: "no-such-id",
      }),
    ).toBe("Compendium.pf2e.class-features-core.Item.x2");
  });
});

describe("pickDefaultEntryUuid", () => {
  it("returns the first entry's uuid so the picker's details panel is never empty", () => {
    expect(
      pickDefaultEntryUuid([
        { name: "A", uuid: "u-a" },
        { name: "B", uuid: "u-b" },
      ]),
    ).toBe("u-a");
  });

  it("returns null for an empty list", () => {
    expect(pickDefaultEntryUuid([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildContentNameTranslator (B1 r14) — pt-BR display for embedded pack content
// ---------------------------------------------------------------------------

describe("buildContentNameTranslator", () => {
  // Real-shaped index entries (feats-core / class-features-core), matching the
  // exact server-attached namePt overlays for the Tobias audit items.
  const feats: PlanNameIndexEntry[] = [
    { name: "Magus's Analysis", namePt: "Análise do Magus" },
    { name: "Fleet", namePt: "Veloz" },
    { name: "Rat Familiar", namePt: "Familiar Ratkin" },
    // Bon Mot: pt-BR overlay identical to EN (r14 rule: still show BOTH).
    { name: "Bon Mot", namePt: "Bon Mot" },
    // Untranslated pack entry (no namePt) — should EN-fallback.
    { name: "Some Untranslated Feat" },
  ];
  const classFeatures: PlanNameIndexEntry[] = [
    // Nested i18n bag form (no flat namePt) — must be read from i18n.ptBR.name.
    { name: "Starlit Span", i18n: { ptBR: { name: "Alcance Luminoso" } } },
  ];

  it("resolves an embedded EN name to its pt-BR name + keeps the EN as the subtitle", () => {
    const translate = buildContentNameTranslator([feats]);
    expect(translate("Magus's Analysis")).toEqual({
      namePt: "Análise do Magus",
      nameEn: "Magus's Analysis",
    });
    expect(translate("Fleet")).toEqual({ namePt: "Veloz", nameEn: "Fleet" });
  });

  // Issue #65 — the Cleric's `featuresByLevel` entry is literally named "Deity"
  // while the document it points at is named "Deity (Cleric)". Matching by name
  // misses, so the chip rendered in EN even though the translation existed one
  // id away. The id is the exact key and must win.
  it("resolves by docId even when the stored name does not match the document's own", () => {
    const clericFeatures: PlanNameIndexEntry[] = [
      { _id: "Z3bGaIq1FnCfsTrx", name: "Deity (Cleric)", namePt: "Divindade (Clérigo)" },
    ];
    const translate = buildContentNameTranslator([clericFeatures]);

    // Name-only lookup cannot resolve it — that is the bug being fixed.
    expect(translate("Deity")).toEqual({ namePt: "Deity", nameEn: "Deity" });

    // With the docId the class doc already carries, it resolves exactly.
    expect(translate("Deity", "Z3bGaIq1FnCfsTrx")).toEqual({
      namePt: "Divindade (Clérigo)",
      nameEn: "Deity (Cleric)",
    });
  });

  it("falls back to the stored name when the docId is unknown (never crashes, never invents)", () => {
    const translate = buildContentNameTranslator([feats]);
    expect(translate("Fleet", "IdThatIsNotInAnyPack")).toEqual({
      namePt: "Veloz",
      nameEn: "Fleet",
    });
    expect(translate("Totally Unknown", "AlsoUnknownId")).toEqual({
      namePt: "Totally Unknown",
      nameEn: "Totally Unknown",
    });
  });

  it("joins by normalized name, so a pt-BR-copied stored name still resolves", () => {
    const translate = buildContentNameTranslator([feats]);
    // Stored name copied in pt-BR (accent/case-insensitive) still maps to the
    // same bilingual parts — the index is keyed by BOTH EN and pt-BR names.
    expect(translate("analise do magus")).toEqual({
      namePt: "Análise do Magus",
      nameEn: "Magus's Analysis",
    });
  });

  it("returns both parts even when pt-BR equals EN (Bon Mot) — r14 always-both rule", () => {
    const translate = buildContentNameTranslator([feats]);
    expect(translate("Bon Mot")).toEqual({ namePt: "Bon Mot", nameEn: "Bon Mot" });
  });

  it("reads the nested i18n.ptBR.name overlay when no flat namePt is present", () => {
    const translate = buildContentNameTranslator([classFeatures]);
    expect(translate("Starlit Span")).toEqual({
      namePt: "Alcance Luminoso",
      nameEn: "Starlit Span",
    });
  });

  it("EN-falls back for an untranslated pack entry (namePt === EN name)", () => {
    const translate = buildContentNameTranslator([feats]);
    expect(translate("Some Untranslated Feat")).toEqual({
      namePt: "Some Untranslated Feat",
      nameEn: "Some Untranslated Feat",
    });
  });

  it("EN-falls back for a name absent from every pack index", () => {
    const translate = buildContentNameTranslator([feats]);
    expect(translate("Totally Unknown Thing")).toEqual({
      namePt: "Totally Unknown Thing",
      nameEn: "Totally Unknown Thing",
    });
  });

  it("indexes across multiple packs at once", () => {
    const translate = buildContentNameTranslator([feats, classFeatures]);
    expect(translate("Fleet").namePt).toBe("Veloz");
    expect(translate("Starlit Span").namePt).toBe("Alcance Luminoso");
  });

  it("returns the stored name unchanged for an empty string", () => {
    const translate = buildContentNameTranslator([feats]);
    expect(translate("")).toEqual({ namePt: "", nameEn: "" });
  });
});

// ---------------------------------------------------------------------------
// abilityBoostsGrid (B1 r14 #6) — 3×2 net-per-ability grid for a filled slot
// ---------------------------------------------------------------------------

describe("abilityBoostsGrid", () => {
  it("returns the six abilities in FOR/DES/CON/INT/SAB/CAR order", () => {
    const grid = abilityBoostsGrid(tobiasLevel3DocComplete(), 1);
    expect(grid.map((c) => c.slug)).toEqual(["str", "dex", "con", "int", "wis", "cha"]);
    expect(ABILITY_GRID_ORDER).toEqual(["str", "dex", "con", "int", "wis", "cha"]);
  });

  it("computes the NET modifier per ability from the full boost+flaw ledger", () => {
    // Fixture scores: str 10, dex 16, con 12, int 16, wis 10, cha 14
    // → mods FOR +0, DES +3, CON +1, INT +3, SAB +0, CAR +2. STR carries an
    // ancestry FLAW (str) yet its net is still +0 (10) — the grid shows the
    // real outcome, not the raw boost count.
    const grid = abilityBoostsGrid(tobiasLevel3DocComplete(), 1);
    const bySlug = Object.fromEntries(grid.map((c) => [c.slug, c.modFormatted]));
    expect(bySlug["str"]).toBe("+0");
    expect(bySlug["dex"]).toBe("+3");
    expect(bySlug["con"]).toBe("+1");
    expect(bySlug["int"]).toBe("+3");
    expect(bySlug["wis"]).toBe("+0");
    expect(bySlug["cha"]).toBe("+2");
  });

  it("formats a negative net modifier with a minus sign (flaw-dominated ability)", () => {
    // A doc with a lone STR flaw and no STR boost → score 8 → mod -1.
    const doc: Record<string, unknown> = {
      system: {
        level: { value: 1 },
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: ["str"],
            ancestryFree: [],
            backgroundBoosts: [],
            backgroundFree: [],
            classBoost: [],
            levelledBoosts: {},
          },
        },
      },
      items: [],
    };
    const grid = abilityBoostsGrid(doc, 1);
    const str = grid.find((c) => c.slug === "str");
    expect(str?.mod).toBe(-1);
    expect(str?.modFormatted).toBe("-1");
  });

  it("always signs +0 for an untouched ability", () => {
    const doc: Record<string, unknown> = {
      system: { level: { value: 1 }, build: { abilities: {} } },
      items: [],
    };
    const grid = abilityBoostsGrid(doc, 1);
    expect(grid.every((c) => c.modFormatted === "+0")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B2 r14 — fixed-grant chips, cascade, ghost cleanup, heal input
// ---------------------------------------------------------------------------

/**
 * Tobias level 2 with Alchemist Dedication at archetypeFeat-2 that has ALREADY
 * materialized its two fixed grants: Alchemical Crafting (feat) + Quick Alchemy
 * (action), each tagged `flags.fusion.grantedBy = <dedication sourceId>`.
 */
function tobiasWithMaterializedGrantsDoc(): Record<string, unknown> {
  return {
    _id: "actor-tobias",
    name: "Tobias",
    type: "character",
    items: [
      { ...magusClassDoc(), _id: "item-class" },
      {
        ...alchemistDedicationFeatDoc(),
        _id: "item-archetype-feat-2",
        flags: {
          fusion: { sourceId: "CJMkxlxHiHZQYDCz", build: { level: 2, slot: "archetypeFeat-2" } },
        },
      },
      {
        _id: "item-granted-crafting",
        name: "Alchemical Crafting",
        type: "feat",
        system: { category: "skill", level: 1, traits: { value: ["general", "skill"] } },
        flags: {
          fusion: {
            sourceId: "is3Oz9wt11lNq62K",
            grantedBy: "CJMkxlxHiHZQYDCz",
            grantedSlot: "archetypeFeat-2",
          },
        },
      },
      {
        _id: "item-granted-quick-alchemy",
        name: "Quick Alchemy",
        type: "action",
        system: {},
        flags: {
          fusion: {
            sourceId: "yzNJgwzV9XqEhKc6",
            grantedBy: "CJMkxlxHiHZQYDCz",
            grantedSlot: "archetypeFeat-2",
          },
        },
      },
    ],
    system: {
      level: { value: 2 },
      details: {},
      build: {
        abilities: {
          ancestryBoosts: [],
          ancestryFlaws: [],
          ancestryFree: [],
          backgroundBoosts: [],
          classBoost: ["int"],
          levelledBoosts: {},
        },
        choices: [{ level: 2, slot: "archetypeFeat-2", type: "archetypeFeat" }],
        freeArchetype: true,
      },
    },
  };
}

describe("derivePlan — fixed-grant chips (B2 r14 + r15 A2)", () => {
  it("surfaces BOTH the granted FEAT and the granted ACTION as locked nested chips under the granter (r15 A2: everything conceded is visible)", () => {
    const doc = tobiasWithMaterializedGrantsDoc();
    const plan = derivePlan(doc);
    const l2 = plan.levels.find((l) => l.level === 2)!;
    const grantChips = l2.slots.filter((s) => s.lockedGrant);
    // r15 A2: feat AND action BOTH render as Plan chips now (the action ALSO
    // stays in the Actions tab — the two surfaces are independent).
    expect(grantChips).toHaveLength(2);
    const byName = new Map(grantChips.map((c) => [c.choiceName, c]));

    const craftingChip = byName.get("Alchemical Crafting")!;
    expect(craftingChip.parentSlotId).toBe("archetypeFeat-2");
    expect(craftingChip.filled).toBe(true);
    expect(craftingChip.itemId).toBe("item-granted-crafting");
    expect(craftingChip.detailsPackSlug).toBe("feats-core");

    const quickAlchemyChip = byName.get("Quick Alchemy")!;
    expect(quickAlchemyChip.parentSlotId).toBe("archetypeFeat-2");
    expect(quickAlchemyChip.lockedGrant).toBe(true);
    expect(quickAlchemyChip.itemId).toBe("item-granted-quick-alchemy");
    expect(quickAlchemyChip.detailsPackSlug).toBe("actions-core");
  });

  it("routes each locked-grant chip's details to the right pack (feat→feats-core, action→actions-core)", () => {
    const doc = tobiasWithMaterializedGrantsDoc();
    const plan = derivePlan(doc);
    const chips = plan.levels.find((l) => l.level === 2)!.slots.filter((s) => s.lockedGrant);
    const feat = chips.find((c) => c.choiceName === "Alchemical Crafting")!;
    const action = chips.find((c) => c.choiceName === "Quick Alchemy")!;
    expect(detailsRequestForSlot(feat)).toEqual({
      packSlug: "feats-core",
      name: "Alchemical Crafting",
      sourceId: "is3Oz9wt11lNq62K",
    });
    expect(detailsRequestForSlot(action)).toEqual({
      packSlug: "actions-core",
      name: "Quick Alchemy",
      sourceId: "yzNJgwzV9XqEhKc6",
    });
  });

  it("does not surface a grant chip when the granter carries no fusion.sourceId", () => {
    const doc = tobiasWithMaterializedGrantsDoc();
    const granter = (doc["items"] as Array<Record<string, unknown>>).find(
      (i) => i["_id"] === "item-archetype-feat-2",
    )!;
    (granter["flags"] as Record<string, Record<string, unknown>>)["fusion"] = {
      build: { level: 2, slot: "archetypeFeat-2" },
    };
    const plan = derivePlan(doc);
    const grantChips = plan.levels.find((l) => l.level === 2)!.slots.filter((s) => s.lockedGrant);
    expect(grantChips).toHaveLength(0);
  });
});

describe("derivePlan — conflux spell chip under the hybrid study (r15 A2)", () => {
  /**
   * Tobias level 1 whose Starlit Span (hybridStudy-1) has materialized its
   * conflux spell (Shooting Star, focus pool) as a grant, tagged by Starlit
   * Span's sourceId. The chip must render nested under the hybridStudy-1 slot.
   */
  function tobiasWithConfluxSpellDoc(): Record<string, unknown> {
    return {
      _id: "actor-tobias",
      name: "Tobias",
      type: "character",
      items: [
        { ...magusClassDoc(), _id: "item-class" },
        {
          ...starlitSpanHybridStudyDoc(),
          _id: "item-hybrid-study-1",
          flags: {
            fusion: { sourceId: "Pew7duAozEeAemif", build: { level: 1, slot: "hybridStudy-1" } },
          },
        },
        {
          _id: "item-granted-shooting-star",
          name: "Shooting Star",
          type: "spell",
          location: "focus-entry",
          system: { traits: { value: ["focus", "magus"] } },
          flags: {
            fusion: {
              sourceId: "SHOOT_SID",
              grantedBy: "Pew7duAozEeAemif",
              grantedSlot: "hybridStudy-1",
            },
          },
        },
      ],
      system: {
        level: { value: 1 },
        details: {},
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            classBoost: ["int"],
            levelledBoosts: {},
          },
          choices: [{ level: 1, slot: "hybridStudy-1", type: "hybridStudy" }],
        },
      },
    };
  }

  it("surfaces Shooting Star as a locked spell chip nested under hybridStudy-1", () => {
    const plan = derivePlan(tobiasWithConfluxSpellDoc());
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const chip = l1.slots.find((s) => s.lockedGrant && s.choiceName === "Shooting Star")!;
    expect(chip).toBeDefined();
    expect(chip.parentSlotId).toBe("hybridStudy-1");
    expect(chip.detailsPackSlug).toBe("spells-core");
    expect(chip.itemId).toBe("item-granted-shooting-star");
    // Details route to spells-core so the popup resolves the spell doc.
    expect(detailsRequestForSlot(chip)).toEqual({
      packSlug: "spells-core",
      name: "Shooting Star",
      sourceId: "SHOOT_SID",
    });
  });

  it("removeChoice on the hybrid study cascades to the granted conflux spell", () => {
    const doc = tobiasWithConfluxSpellDoc();
    const plan = derivePlan(doc);
    const hybridSlot = plan.levels
      .find((l) => l.level === 1)!
      .slots.find((s) => s.slotId === "hybridStudy-1")!;
    const ops = removeChoice(ctx(doc), hybridSlot);
    const deleteIds = ops
      .filter((op) => op.type === "doc:delete")
      .map((op) => (op as { id: string }).id);
    expect(deleteIds).toContain("item-hybrid-study-1");
    expect(deleteIds).toContain("item-granted-shooting-star");
  });
});

describe("removeChoice — cascades to fixed grants (B2 r14)", () => {
  it("deletes the granter AND every grantedBy item (feat + action), in one op set", () => {
    const doc = tobiasWithMaterializedGrantsDoc();
    const plan = derivePlan(doc);
    const parentSlot = plan.levels
      .find((l) => l.level === 2)!
      .slots.find((s) => s.slotId === "archetypeFeat-2")!;
    expect(parentSlot.filled).toBe(true);

    const ops = removeChoice(ctx(doc), parentSlot);
    const deleteIds = ops
      .filter((op) => op.type === "doc:delete")
      .map((op) => (op as { id: string }).id);
    expect(deleteIds.sort()).toEqual(
      ["item-archetype-feat-2", "item-granted-crafting", "item-granted-quick-alchemy"].sort(),
    );
    // Each delete is a valid wire payload.
    for (const op of ops.filter((o) => o.type === "doc:delete")) {
      const del = op as { documentType: string; id: string; parent: unknown };
      expect(
        DocDeletePayloadSchema.safeParse({
          documentType: del.documentType,
          ids: [del.id],
          parent: del.parent,
        }).success,
      ).toBe(true);
    }
  });

  it("returns [] when not editable", () => {
    const doc = tobiasWithMaterializedGrantsDoc();
    const plan = derivePlan(doc);
    const parentSlot = plan.levels
      .find((l) => l.level === 2)!
      .slots.find((s) => s.slotId === "archetypeFeat-2")!;
    expect(removeChoice(ctx(doc, false), parentSlot)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ghost spellcasting-entry cleanup (gap #12)
// ---------------------------------------------------------------------------

function ghostEntryWorldDoc(
  opts: { ghost?: boolean; twinNonEmpty?: boolean } = {},
): Record<string, unknown> {
  const { ghost = true, twinNonEmpty = true } = opts;
  const items: Array<Record<string, unknown>> = [
    { ...magusClassDoc(), _id: "item-class" },
    {
      _id: "BNyJ0gsmNlULtcai",
      name: "Magias Arcanas",
      type: "spellcastingEntry",
      system: {
        tradition: { value: "arcane" },
        prepared: { value: "prepared" },
        isFocusPool: false,
        slots: {},
      },
    },
  ];
  if (twinNonEmpty) {
    // A real spell located in the non-ghost entry -> makes it non-empty.
    items.push({
      _id: "spell-1",
      name: "Shield",
      type: "spell",
      location: "BNyJ0gsmNlULtcai",
      system: { traits: { value: [] } },
    });
  }
  if (ghost) {
    items.push({
      _id: "sAbd2jdXSJVrTtkX",
      name: "arcane Spells", // auto-generated "<tradition> Spells" pattern
      type: "spellcastingEntry",
      system: {
        tradition: { value: "arcane" },
        prepared: { value: "prepared" },
        isFocusPool: false,
        slots: {},
      },
    });
  }
  return {
    _id: "actor-tobias",
    name: "Tobias",
    type: "character",
    items,
    system: { level: { value: 3 }, details: {}, build: { choices: [] } },
  };
}

describe("planGhostEntryCleanup (gap #12)", () => {
  it("removes the empty auto-named duplicate when a non-empty twin exists", () => {
    const ops = planGhostEntryCleanup(ctx(ghostEntryWorldDoc()));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe("sAbd2jdXSJVrTtkX");
    expect(
      DocDeletePayloadSchema.safeParse({
        documentType: ops[0]!.documentType,
        ids: [ops[0]!.id],
        parent: ops[0]!.parent,
      }).success,
    ).toBe(true);
  });

  it("does NOT remove when the twin entry is itself empty (no clearly-canonical entry to keep)", () => {
    const ops = planGhostEntryCleanup(ctx(ghostEntryWorldDoc({ twinNonEmpty: false })));
    expect(ops).toEqual([]);
  });

  it("does NOT remove a ghost that has its own spells (not actually empty)", () => {
    const doc = ghostEntryWorldDoc();
    (doc["items"] as Array<Record<string, unknown>>).push({
      _id: "spell-2",
      name: "Detect Magic",
      type: "spell",
      location: "sAbd2jdXSJVrTtkX",
      system: { traits: { value: [] } },
    });
    expect(planGhostEntryCleanup(ctx(doc))).toEqual([]);
  });

  it("does NOT remove an entry whose name is NOT the auto-generated pattern", () => {
    const doc = ghostEntryWorldDoc();
    const ghost = (doc["items"] as Array<Record<string, unknown>>).find(
      (i) => i["_id"] === "sAbd2jdXSJVrTtkX",
    )!;
    ghost["name"] = "Magias de Backup"; // human-renamed -> keep
    expect(planGhostEntryCleanup(ctx(doc))).toEqual([]);
  });

  it("never touches focus pools", () => {
    const doc = ghostEntryWorldDoc({ ghost: false });
    (doc["items"] as Array<Record<string, unknown>>).push({
      _id: "focus",
      name: "arcane Spells",
      type: "spellcastingEntry",
      system: {
        tradition: { value: "arcane" },
        prepared: { value: "prepared" },
        isFocusPool: true,
        slots: {},
      },
    });
    expect(planGhostEntryCleanup(ctx(doc))).toEqual([]);
  });

  it("is idempotent (running on a cleaned world yields [])", () => {
    expect(planGhostEntryCleanup(ctx(ghostEntryWorldDoc({ ghost: false })))).toEqual([]);
  });

  it("returns [] when not editable", () => {
    expect(planGhostEntryCleanup(ctx(ghostEntryWorldDoc(), false))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Heal input planners
// ---------------------------------------------------------------------------

describe("healGranterRefs / actorSpellEntries (heal input)", () => {
  it("lists applied feat/feature granters (with sourceId + name + pack), excluding items that are themselves grants", () => {
    const refs = healGranterRefs(tobiasWithMaterializedGrantsDoc());
    // The dedication is a granter; the two granted items are excluded (they carry grantedBy).
    expect(refs.map((r) => r.name)).toEqual(["Alchemist Dedication"]);
    const ded = refs[0]!;
    expect(ded.sourceId).toBe("CJMkxlxHiHZQYDCz");
    expect(ded.slot).toBe("archetypeFeat-2");
    expect(ded.packSlug).toBe("feats-core");
    expect(ded.itemId).toBe("item-archetype-feat-2");
  });

  it("routes a classFeature granter to class-features-core", () => {
    const doc = tobiasWithMaterializedGrantsDoc();
    (doc["items"] as Array<Record<string, unknown>>).push({
      _id: "item-feature",
      name: "Some Feature",
      type: "classFeature",
      flags: { fusion: { sourceId: "featureSrc" } },
      system: {},
    });
    const ref = healGranterRefs(doc).find((r) => r.name === "Some Feature")!;
    expect(ref.packSlug).toBe("class-features-core");
  });

  it("reads the actor's spellcasting entries (id/isFocusPool/tradition)", () => {
    const entries = actorSpellEntries(ghostEntryWorldDoc({ ghost: false }));
    expect(entries).toContainEqual({
      id: "BNyJ0gsmNlULtcai",
      isFocusPool: false,
      tradition: "arcane",
    });
  });
});

// ---------------------------------------------------------------------------
// maxTakable: null means UNLIMITED, not once (issue #57)
//
// 22 feats in feats-core carry `system.maxTakable: null` — Assurance,
// Additional Lore, Multilingual, Skill Training, Domain Initiate, Terrain
// Expertise, Weapon Proficiency… All of them are legitimately taken many
// times (one per skill / language / domain). `featMaxTakable` collapsed any
// non-number to 1, so the second pick was refused.
//
// This only became visible when #57 published `system.maxTakable` to the pack
// index: with the field in the index, the picker's filter would have HIDDEN
// those 22 feats after the first pick.
// ---------------------------------------------------------------------------

/** "Assurance" — real feats-core skill feat with `system.maxTakable: null`. */
function assuranceFeatDoc(): Record<string, unknown> {
  return {
    _id: "3yZFHMS8CTAqTHUS",
    name: "Assurance",
    type: "feat",
    system: {
      category: "skill",
      level: 1,
      maxTakable: null,
      prerequisites: [{ value: "trained in at least one skill" }],
      traits: { rarity: "common", value: ["fortune", "general", "skill"] },
    },
    flags: { fusion: { sourceId: "ULn3jrPHnPYyRO2H" } },
  };
}

describe("repeat cap — maxTakable: null (issue #57)", () => {
  it("does not cap a feat declared maxTakable: null, however many times it was taken", () => {
    const taken = (n: number): Record<string, unknown> =>
      baseCharacterDoc({
        items: Array.from({ length: n }, (_, i) =>
          embeddedFeatItem(assuranceFeatDoc(), `item-${String(i)}`, {
            level: 2,
            slot: `skillFeat-${String(i)}`,
          }),
        ),
      });

    expect(isFeatAtRepeatCap(taken(0), assuranceFeatDoc())).toBe(false);
    expect(isFeatAtRepeatCap(taken(1), assuranceFeatDoc())).toBe(false);
    expect(isFeatAtRepeatCap(taken(7), assuranceFeatDoc())).toBe(false);
  });

  it("still caps a feat with no maxTakable field at one", () => {
    const doc = baseCharacterDoc({
      items: [
        embeddedFeatItem(acupuncturistFeatDoc(), "item-1", { level: 2, slot: "skillFeat-2" }),
      ],
    });
    expect(isFeatAtRepeatCap(doc, acupuncturistFeatDoc())).toBe(true);
  });

  it("still caps a numeric maxTakable at its declared value", () => {
    const armor = armorProficiencyFeatDoc();
    const taken = (n: number): Record<string, unknown> =>
      baseCharacterDoc({
        items: Array.from({ length: n }, (_, i) =>
          embeddedFeatItem(armor, `item-${String(i)}`, {
            level: 3,
            slot: `generalFeat-${String(i)}`,
          }),
        ),
      });
    expect(isFeatAtRepeatCap(taken(2), armor)).toBe(false);
    expect(isFeatAtRepeatCap(taken(3), armor)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeChoice must not leave an orphan choice behind (issue #15, 2nd defect)
//
// The grantedBy cascade deletes every item the granter materialized. If one of
// those items ALSO occupied a build slot — which is exactly the corrupted state
// the old findAdoptableItem produced — its `system.build.choices` entry stayed,
// and resolveSlot read that orphan choice as `filled: true`: a phantom slot,
// marked taken with no item behind it.
//
// The adoption fix stops NEW actors from reaching that state; this keeps the
// removal honest for actors already carrying it.
// ---------------------------------------------------------------------------

describe("removeChoice — orphan choice from a grantedBy cascade (issue #15)", () => {
  it("drops the build choice of an item deleted by the grantedBy cascade", () => {
    const muse = {
      _id: "item-muse",
      name: "Maestro",
      type: "classFeature",
      flags: { fusion: { sourceId: "MAESTRO", build: { level: 1, slot: "muse-1" } } },
      system: {},
    };
    // The corrupted shape: paid slot AND stamped as granted by the muse.
    const adoptedFeat = {
      _id: "item-lc",
      name: "Lingering Composition",
      type: "feat",
      flags: {
        fusion: {
          sourceId: "LINGERING",
          grantedBy: "MAESTRO",
          build: { level: 1, slot: "classFeat-1" },
        },
      },
      system: {},
    };
    const character = baseCharacterDoc({
      items: [muse, adoptedFeat],
      system: {
        level: { value: 1 },
        details: {},
        build: {
          choices: [
            { level: 1, slot: "muse-1", type: "muse", sourceId: "MAESTRO" },
            { level: 1, slot: "classFeat-1", type: "classFeat", sourceId: "LINGERING" },
          ],
        },
      },
    });

    const ops = removeChoice(ctx(character), {
      slotId: "muse-1",
      type: "muse",
      level: 1,
      label: "Muse",
      filled: true,
      itemId: "item-muse",
    } as PlanSlotModel);

    const deleted = ops.filter((o) => o.type === "doc:delete").map((o) => o.id);
    expect(deleted).toContain("item-muse");
    expect(deleted).toContain("item-lc");

    const update = ops.find((o) => o.type === "doc:update");
    expect(update, "choices must be rewritten").toBeDefined();
    const remaining = (update as { diff: Record<string, unknown> }).diff[
      "system.build.choices"
    ] as Array<{ slot: string }>;
    expect(
      remaining.map((c) => c.slot),
      "the deleted feat's own slot must not stay behind as a phantom",
    ).toEqual([]);
  });

  it("keeps an unrelated choice untouched", () => {
    const muse = {
      _id: "item-muse",
      name: "Maestro",
      type: "classFeature",
      flags: { fusion: { sourceId: "MAESTRO", build: { level: 1, slot: "muse-1" } } },
      system: {},
    };
    const character = baseCharacterDoc({
      items: [muse],
      system: {
        level: { value: 1 },
        details: {},
        build: {
          choices: [
            { level: 1, slot: "muse-1", type: "muse", sourceId: "MAESTRO" },
            { level: 2, slot: "skillFeat-2", type: "skillFeat", sourceId: "OTHER" },
          ],
        },
      },
    });

    const ops = removeChoice(ctx(character), {
      slotId: "muse-1",
      type: "muse",
      level: 1,
      label: "Muse",
      filled: true,
      itemId: "item-muse",
    } as PlanSlotModel);

    const update = ops.find((o) => o.type === "doc:update");
    const remaining = (update as { diff: Record<string, unknown> }).diff[
      "system.build.choices"
    ] as Array<{ slot: string }>;
    expect(remaining.map((c) => c.slot)).toEqual(["skillFeat-2"]);
  });
});

// ---------------------------------------------------------------------------
// Class features resolve by document id, not by name (issue #14)
//
// classGrantRefsFromClassDoc emitted only `{ name, packSlug }`, and the caller
// matched on the normalized NAME — against the project rule that identity is
// the document id, never the name.
//
// Measured over the 12 classes: 221 of 221 featuresByLevel entries resolve by
// `uuid` (the pack doc's `_id`), while 5 carry a name the pack does not have:
//
//   Cleric  L1  "Deity"                                 -> "Deity (Cleric)"
//   Magus   L5  "Lightning Reflexes"                    -> "Reflex Expertise"
//   Magus   L15 "Greater Weapon Specialization (Level 15)" -> "Greater Weapon Specialization"
//   Monk    L15 idem
//   Rogue   L9  "Debilitating Strikes"                  -> "Debilitating Strike"
//
// The Rogue case is the expensive one: "Debilitating Strike" declares a
// grant-item for the action of the same name, so a level-9 Rogue never gets
// Debilitating Strike in the Actions tab.
// ---------------------------------------------------------------------------

describe("classGrantRefsFromClassDoc — identity by doc id (issue #14)", () => {
  const rogueSystem = {
    featuresByLevel: [
      { level: 1, uuid: "AAAA1111", name: "Sneak Attack" },
      { level: 9, uuid: "mGyRcs5k6sRE1fVm", name: "Debilitating Strikes" },
    ],
  };

  it("carries the feature's document id alongside the name", () => {
    const refs = classGrantRefsFromClassDoc(rogueSystem, "ROGUE", 9);
    const debilitating = refs.find((r) => r.level === 9);
    expect(debilitating?.docId, "the uuid from featuresByLevel must reach the resolver").toBe(
      "mGyRcs5k6sRE1fVm",
    );
    // The name is still carried — it is the fallback and the log label.
    expect(debilitating?.name).toBe("Debilitating Strikes");
  });

  it("emits a docId for every feature, not just the divergent ones", () => {
    const refs = classGrantRefsFromClassDoc(rogueSystem, "ROGUE", 9);
    expect(refs).toHaveLength(2);
    expect(refs.every((r) => typeof r.docId === "string" && r.docId.length > 0)).toBe(true);
  });

  it("omits docId when the pack data has no uuid (never invents one)", () => {
    const refs = classGrantRefsFromClassDoc(
      { featuresByLevel: [{ level: 1, name: "Homebrew Feature" }] },
      "HOMEBREW",
      1,
    );
    expect(refs[0]?.docId).toBeUndefined();
    expect(refs[0]?.name).toBe("Homebrew Feature");
  });
});
