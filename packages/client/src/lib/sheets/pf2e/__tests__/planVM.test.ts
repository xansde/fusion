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
  isHybridStudyOption,
  spellSlotsForLevel,
  computeAbilityScores,
  applyClass,
  applyAncestry,
  applyHeritage,
  applyBackground,
  chooseFeat,
  chooseHybridStudy,
  chooseSkillTraining,
  chooseSkillIncrease,
  setAbilityBoosts,
  markAbilityBoostsChoice,
  abilityBoostsSlotContext,
  isAbilityBoostsSlotFilled,
  setFreeArchetype,
  removeChoice,
  levelUp,
  levelSet,
  skillTrainingDialogContext,
  confirmSkillTraining,
  addLoreSkill,
  skillProficiencyBonus,
  previewAbilityScores,
  grantedFeatChoiceFor,
  matchesGrantedFeatFilter,
  detailsRequestForSlot,
  detailsRequestForAutoFeature,
  findEntryUuidByName,
  pickDefaultEntryUuid,
  type PlanOpBuilderContext,
  type PlanSlotModel,
  type FeatDocLike,
  type PlanIndexEntryLike,
} from "../planVM.js";
import type { DocUpdatePayload } from "../characterSheetVM.js";
import { DocCreatePayloadSchema, DocUpdatePayloadSchema, DocDeletePayloadSchema } from "@fusion/shared";
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
    flags: { fusion: { conversion: "full" } },
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
  return { system: doc["system"] as { category: string; level: number; traits: { value: string[] } } };
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
        system: { ...(speedrunStratsSkillFeatDoc()["system"] as Record<string, unknown>), level: 2 },
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
          { level: 1, slot: "skillTraining-1-1", type: "skillTraining", skill: "thievery", rank: 1 },
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
      expect.arrayContaining(["Arcane Spellcasting (Magus)", "Arcane Cascade", "Spellstrike", "Conflux Spells"]),
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
    expect((classOp.data["system"] as Record<string, unknown>)["keyAbility"]).toEqual(["dex", "str"]);
    expect(classOp.parent).toEqual({ type: "Actor", id: "actor-tobias" });

    const wire = { documentType: classOp.documentType, data: [classOp.data], parent: classOp.parent };
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

    const wire = { documentType: entryOp.documentType, data: [entryOp.data], parent: entryOp.parent };
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

    const wire = { documentType: focusOp.documentType, data: [focusOp.data], parent: focusOp.parent };
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
    const wire = { documentType: createOp.documentType, data: [createOp.data], parent: createOp.parent };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);

    const updateOp = ops[1]!;
    expect(updateOp.type).toBe("doc:update");
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(updateOp.diff["system.build.abilities.ancestryBoosts"]).toEqual(["dex", "int"]);
    expect(updateOp.diff["system.build.abilities.ancestryFlaws"]).toEqual(["str"]);
    expect(updateOp.diff["system.build.abilities.ancestryFree"]).toEqual([]);

    const wireUpdate = { documentType: updateOp.documentType, updates: [{ _id: updateOp.id, diff: updateOp.diff }] };
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
});

// ---------------------------------------------------------------------------
// applyBackground
// ---------------------------------------------------------------------------

describe("applyBackground", () => {
  it("returns [] when not editable", () => {
    expect(applyBackground(ctx(baseCharacterDoc(), false), fireworksPerformerBackgroundDoc())).toEqual(
      [],
    );
  });

  it("creates the background item, resets backgroundFree (fresh apply), and appends its skill(s) as level-1 skillTraining build choices", () => {
    const ops = applyBackground(ctx(baseCharacterDoc()), fireworksPerformerBackgroundDoc());
    const createOp = ops[0]!;
    if (createOp.type !== "doc:create") throw new Error("expected doc:create");
    const wire = { documentType: createOp.documentType, data: [createOp.data], parent: createOp.parent };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);

    // Fireworks Performer's boosts are ["free","free"] (no fixed boosts) —
    // the abilities op still fires (to reset/seed backgroundFree), plus the
    // skill op: 3 ops total.
    expect(ops).toHaveLength(3);
    const abilitiesOp = ops[1]!;
    if (abilitiesOp.type !== "doc:update") throw new Error("expected doc:update");
    expect(abilitiesOp.diff["system.build.abilities.backgroundBoosts"]).toEqual([]);
    expect(abilitiesOp.diff["system.build.abilities.backgroundFree"]).toEqual([]);

    const skillOp = ops[2]!;
    if (skillOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = skillOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      level: 1,
      slot: "backgroundSkill-0",
      type: "skillTraining",
      skill: "performance",
      rank: 1,
    });

    const wireUpdate = { documentType: skillOp.documentType, updates: [{ _id: skillOp.id, diff: skillOp.diff }] };
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
    const skillOp = ops[2]!;
    if (skillOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = skillOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toHaveLength(2);
    expect(choices[0]).toMatchObject({ slot: "abilityBoosts-1" });
    expect(choices[1]).toMatchObject({ slot: "backgroundSkill-0" });
  });
});

// ---------------------------------------------------------------------------
// chooseFeat / chooseHybridStudy
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
    const wire = { documentType: createOp.documentType, data: [createOp.data], parent: createOp.parent };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);

    const updateOp = ops[1]!;
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toEqual([{ level: 2, slot: "classFeat-2", type: "classFeat" }]);
    const wireUpdate = { documentType: updateOp.documentType, updates: [{ _id: updateOp.id, diff: updateOp.diff }] };
    expect(DocUpdatePayloadSchema.safeParse(wireUpdate).success).toBe(true);
  });

  it("appends onto existing choices without clobbering", () => {
    const ops = chooseFeat(ctx(tobiasLevel3Doc()), slot, 2, arcaneFistsFeatDoc());
    const updateOp = ops[1]!;
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices.length).toBe(5); // 4 existing + 1 new
  });
});

describe("chooseHybridStudy", () => {
  it("uses the fixed hybridStudy-1 slot id/type", () => {
    const ops = chooseHybridStudy(ctx(baseCharacterDoc()), 1, starlitSpanHybridStudyDoc());
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
    expect(choices).toEqual([{ level: 1, slot: "skillTraining-1-0", type: "skillTraining", skill: "stealth", rank: 1 }]);
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
          choices: [{ level: 1, slot: "skillTraining-1-0", type: "skillTraining", skill: "acrobatics", rank: 1 }],
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
    expect(markAbilityBoostsChoice(ctx(baseCharacterDoc(), false), "abilityBoosts-1", 1)).toBeNull();
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

    const wire = { documentType: deleteOp.documentType, ids: [deleteOp.id], parent: deleteOp.parent };
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
    const wire = { documentType: levelOp.documentType, updates: [{ _id: levelOp.id, diff: levelOp.diff }] };
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
          "1": { value: 2, max: 2, prepared: [{ id: "spell-a", expended: false }, { id: "spell-b", expended: true }] },
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
      const wire = { documentType: op.documentType, updates: [{ _id: op.id, diff: op.diff, embedded: op.embedded }] };
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
      system: { ...(magusClassDoc()["system"] as Record<string, unknown>), spellcasting: undefined },
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
    const highLevelFeat = { system: { category: "class", level: 10, traits: { value: ["magus"] } } };
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
// isHybridStudyOption
// ---------------------------------------------------------------------------

describe("isHybridStudyOption", () => {
  it("returns true for a classFeature carrying the magus-hybrid-study otherTag", () => {
    expect(isHybridStudyOption(starlitSpanHybridStudyDoc())).toBe(true);
  });

  it("returns false when otherTags is absent", () => {
    expect(isHybridStudyOption({ system: { traits: {} } })).toBe(false);
  });

  it("returns false when otherTags doesn't include the hybrid-study tag", () => {
    expect(isHybridStudyOption({ system: { traits: { otherTags: ["something-else"] } } })).toBe(false);
  });

  it("returns false for a non-hybrid-study classFeature (e.g. Arcane Cascade)", () => {
    expect(isHybridStudyOption({ system: { traits: { otherTags: [] } } })).toBe(false);
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
    expect(dctx.emptySlotIds).toEqual(["skillTraining-1-2", "skillTraining-1-3", "skillTraining-1-4"]);

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
    expect(confirmSkillTraining(ctx(tobiasLevel3DocComplete(), false), dctx, ["arcana"])).toBeNull();
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
    expect(choices.some((c) => c["skill"] === "stealth" && c["slot"] === "skillTraining-1-0")).toBe(true);
    expect(choices.some((c) => c["skill"] === "thievery" && c["slot"] === "skillTraining-1-1")).toBe(true);
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
    expect(choices.some((c) => c["slot"] === "skillIncrease-3" && c["skill"] === "stealth")).toBe(true);
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
    const level1Training = choices.filter(
      (c) => c["type"] === "skillTraining" && c["level"] === 1,
    );
    // Exactly 5 level-1 training choices, one per group slot — no orphaned
    // thievery entry, no duplicate slot.
    expect(level1Training).toHaveLength(5);
    expect(level1Training.some((c) => c["skill"] === "thievery")).toBe(false);
    expect(level1Training.some((c) => c["skill"] === "medicine" && c["slot"] === "skillTraining-1-1")).toBe(true);
    const slotIds = level1Training.map((c) => c["slot"]);
    expect(new Set(slotIds).size).toBe(5); // all distinct
  });

  it("deselecting a pick removes its choice, leaving the group partially filled", () => {
    const doc = tobiasLevel3DocComplete();
    const dctx = skillTrainingDialogContext(doc, 1, "skillTraining");
    // Player keeps only stealth (deselects thievery, adds nothing).
    const op = confirmSkillTraining(ctx(doc), dctx, ["stealth"]);
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    const level1Training = choices.filter(
      (c) => c["type"] === "skillTraining" && c["level"] === 1,
    );
    expect(level1Training).toHaveLength(1);
    expect(level1Training[0]!["skill"]).toBe("stealth");
    expect(level1Training[0]!["slot"]).toBe("skillTraining-1-0");
    // thievery's choice is gone.
    expect(choices.some((c) => c["skill"] === "thievery")).toBe(false);
  });

  it("re-editing one level's group never disturbs another level/kind's choices", () => {
    const doc = tobiasLevel3DocComplete();
    const dctx = skillTrainingDialogContext(doc, 1, "skillTraining");
    const op = confirmSkillTraining(ctx(doc), dctx, ["stealth", "thievery", "arcana", "athletics", "society"]);
    const choices = op!.diff["system.build.choices"] as Array<Record<string, unknown>>;
    // The level-3 skillIncrease and the abilityBoosts-1 marker are untouched.
    expect(choices.some((c) => c["slot"] === "skillIncrease-3" && c["type"] === "skillIncrease")).toBe(true);
    expect(choices.some((c) => c["slot"] === "abilityBoosts-1" && c["type"] === "abilityBoosts")).toBe(true);
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
    expect(op!.diff["system.skills.lore-nature-lore"]).toEqual({ rank: 0, lore: true, label: "Nature Lore" });
    const wire = { documentType: op!.documentType, updates: [{ _id: op!.id, diff: op!.diff }] };
    expect(DocUpdatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("returns null when a lore with the same slug already exists", () => {
    const doc = baseCharacterDoc({
      system: { level: { value: 1 }, details: {}, skills: { "lore-nature-lore": { rank: 1, lore: true } } },
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
    const tooHigh: FeatDocLike["system"] = { category: "class", level: 3, traits: { value: ["alchemist"] } };
    expect(matchesGrantedFeatFilter({ system: tooHigh }, grant)).toBe(false);
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
    expect(sub.grantFilter?.labelKey).toBe("FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction");
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
    expect((createOp.data["flags"] as Record<string, unknown>)).toMatchObject({
      fusion: { build: { level: 4, slot: "archetypeFeat-4:granted" } },
    });

    const updateOp = ops[1] as DocUpdatePayload;
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toContainEqual({ level: 4, slot: "archetypeFeat-4:granted", type: "grantedFeat" });
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
    expect(deleteOps.map((op) => op.id).sort()).toEqual(["item-archetype-feat-4", "item-granted-feat"].sort());

    const updateOp = ops.find((op) => op.type === "doc:update") as DocUpdatePayload;
    const remainingChoices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
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
// R12 — details-panel resolution (chips + filled slots + picker default)
// ---------------------------------------------------------------------------

describe("detailsRequestForSlot", () => {
  function slot(overrides: Partial<PlanSlotModel>): PlanSlotModel {
    return { slotId: "s", type: "classFeat", label: "Class Feat", filled: true, choiceName: "Sudden Charge", ...overrides };
  }

  it("routes a filled hybrid-study slot to class-features-core", () => {
    const req = detailsRequestForSlot(slot({ type: "hybridStudy", choiceName: "Arcane Fists" }));
    expect(req).toEqual({ packSlug: "class-features-core", name: "Arcane Fists" });
  });

  it("routes every filled feat-family slot to feats-core", () => {
    for (const type of ["ancestryFeat", "classFeat", "generalFeat", "skillFeat", "archetypeFeat", "grantedFeat"] as const) {
      const req = detailsRequestForSlot(slot({ type, choiceName: "Some Feat" }));
      expect(req).toEqual({ packSlug: "feats-core", name: "Some Feat" });
    }
  });

  it("returns null for slot types with no single compendium document", () => {
    expect(detailsRequestForSlot(slot({ type: "abilityBoosts", choiceName: "str, dex" }))).toBeNull();
    expect(detailsRequestForSlot(slot({ type: "skillTraining", choiceName: "2/4" }))).toBeNull();
    expect(detailsRequestForSlot(slot({ type: "skillIncrease", choiceName: "1/1" }))).toBeNull();
  });

  it("returns null for an unfilled slot or one with no choice name", () => {
    expect(detailsRequestForSlot(slot({ filled: false }))).toBeNull();
    // A filled slot missing choiceName entirely (not "choiceName: undefined",
    // which exactOptionalPropertyTypes rejects) also yields no request.
    const noName: PlanSlotModel = { slotId: "s", type: "classFeat", label: "Class Feat", filled: true };
    expect(detailsRequestForSlot(noName)).toBeNull();
  });
});

describe("detailsRequestForAutoFeature", () => {
  it("always resolves an auto-feature against class-features-core", () => {
    const req = detailsRequestForAutoFeature({ name: "Spellstrike", locked: true });
    expect(req).toEqual({ packSlug: "class-features-core", name: "Spellstrike" });
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
    expect(findEntryUuidByName(entries, "spellstrike")).toBe("Compendium.pf2e.class-features-core.Item.b2");
    expect(findEntryUuidByName([{ name: "Estratégia", uuid: "u" }], "estrategia")).toBe("u");
  });

  it("falls back to a UNIQUE prefix match when there is no exact match", () => {
    expect(findEntryUuidByName(entries, "Conflux")).toBe("Compendium.pf2e.class-features-core.Item.c3");
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

describe("pickDefaultEntryUuid", () => {
  it("returns the first entry's uuid so the picker's details panel is never empty", () => {
    expect(pickDefaultEntryUuid([{ name: "A", uuid: "u-a" }, { name: "B", uuid: "u-b" }])).toBe("u-a");
  });

  it("returns null for an empty list", () => {
    expect(pickDefaultEntryUuid([])).toBeNull();
  });
});
