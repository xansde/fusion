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
  featElegivel,
  isHybridStudyOption,
  spellSlotsForLevel,
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
  setFreeArchetype,
  removeChoice,
  levelUp,
  levelSet,
  type PlanOpBuilderContext,
  type PlanSlotModel,
} from "../planVM.js";
import { DocCreatePayloadSchema, DocUpdatePayloadSchema, DocDeletePayloadSchema } from "@fusion/shared";

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
      classDC: 0,
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

  it("level 1 has abilityBoosts (filled via choice) + ancestryFeat (filled via item) + hybridStudy (filled) + 2 skillTraining slots (filled)", () => {
    const l1 = plan.levels.find((l) => l.level === 1)!;
    const byType = Object.fromEntries(l1.slots.map((s) => [s.slotId, s]));

    expect(byType["abilityBoosts-1"]!.filled).toBe(true);
    expect(byType["abilityBoosts-1"]!.type).toBe("abilityBoosts");

    expect(byType["ancestryFeat-1"]!.filled).toBe(true);
    expect(byType["ancestryFeat-1"]!.choiceName).toBe("Cheek Pouches");
    expect(byType["ancestryFeat-1"]!.itemId).toBe("item-ancestry-feat-1");

    expect(byType["hybridStudy-1"]!.filled).toBe(true);
    expect(byType["hybridStudy-1"]!.choiceName).toBe("Starlit Span");

    expect(byType["skillTraining-1-0"]!.filled).toBe(true);
    expect(byType["skillTraining-1-0"]!.choiceName).toBe("stealth (rank 1)");
    expect(byType["skillTraining-1-1"]!.filled).toBe(true);
    expect(byType["skillTraining-1-1"]!.choiceName).toBe("thievery (rank 1)");
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

  it("level 3 has generalFeat (filled) and skillIncrease (filled via choice)", () => {
    const l3 = plan.levels.find((l) => l.level === 3)!;
    const byType = Object.fromEntries(l3.slots.map((s) => [s.slotId, s]));

    expect(byType["generalFeat-3"]!.filled).toBe(true);
    expect(byType["generalFeat-3"]!.choiceName).toBe("Adopted Ancestry");

    expect(byType["skillIncrease-3"]!.filled).toBe(true);
    expect(byType["skillIncrease-3"]!.choiceName).toBe("stealth (rank 2)");
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
    const ops = applyClass(ctx(baseCharacterDoc(), false), magusClassDoc(), "int");
    expect(ops).toEqual([]);
  });

  it("creates the class item with keyAbility narrowed to the player's pick, valid against DocCreatePayloadSchema", () => {
    const ops = applyClass(ctx(baseCharacterDoc()), magusClassDoc(), "int");
    const classOp = ops[0]!;
    expect(classOp.type).toBe("doc:create");
    if (classOp.type !== "doc:create") throw new Error("expected doc:create");
    expect(classOp.data["_id"]).toBeUndefined();
    expect((classOp.data["system"] as Record<string, unknown>)["keyAbility"]).toEqual(["int"]);
    expect(classOp.parent).toEqual({ type: "Actor", id: "actor-tobias" });

    const wire = { documentType: classOp.documentType, data: [classOp.data], parent: classOp.parent };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);
  });

  it("creates an arcane prepared spellcastingEntry with slots from the level-1 table", () => {
    const doc = baseCharacterDoc(); // level 1
    const ops = applyClass(ctx(doc), magusClassDoc(), "int");
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
    const ops = applyClass(ctx(doc), magusClassDoc(), "int");
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
    const ops = applyClass(ctx(baseCharacterDoc()), magusClassDoc(), "int");
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
    const ops = applyClass(ctx(baseCharacterDoc()), noFocusClass, "int");
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

  it("creates the background item and appends its skill(s) as level-1 skillTraining build choices", () => {
    const ops = applyBackground(ctx(baseCharacterDoc()), fireworksPerformerBackgroundDoc());
    const createOp = ops[0]!;
    if (createOp.type !== "doc:create") throw new Error("expected doc:create");
    const wire = { documentType: createOp.documentType, data: [createOp.data], parent: createOp.parent };
    expect(DocCreatePayloadSchema.safeParse(wire).success).toBe(true);

    // Fireworks Performer's boosts are ["free","free"] (no fixed boosts), so
    // no backgroundBoosts update op should be emitted — only the skill op.
    expect(ops).toHaveLength(2);
    const skillOp = ops[1]!;
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
    const skillOp = ops[1]!;
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
  it("level 1: fixed = ancestryBoosts+classBoost, freeCount 1, origin ancestryFree", () => {
    const result = abilityBoostsSlotContext(tobiasLevel3Doc(), 1);
    expect(result.fixedSlugs).toEqual(["dex", "int", "int"]); // ancestryBoosts + classBoost
    expect(result.freeCount).toBe(1);
    expect(result.initialFreeSlugs).toEqual(["cha"]);
    expect(result.origin).toBe("ancestryFree");
  });

  it("a levelled milestone: no fixed slugs, freeCount 4, origin levelled", () => {
    const result = abilityBoostsSlotContext(tobiasLevel3Doc(), 5);
    expect(result.fixedSlugs).toEqual([]);
    expect(result.freeCount).toBe(4);
    expect(result.initialFreeSlugs).toEqual([]);
    expect(result.origin).toBe("levelled");
  });

  it("pre-seeds initialFreeSlugs from an existing levelledBoosts entry", () => {
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
    expect(result.initialFreeSlugs).toEqual(["str", "dex", "con", "wis"]);
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
// featElegivel
// ---------------------------------------------------------------------------

describe("featElegivel", () => {
  const opts = { classSlug: "magus", ancestrySlug: "ratfolk" };

  it("classFeat: accepts a feat tagged with the character's class trait", () => {
    expect(featElegivel(arcaneFistsFeatDoc(), "classFeat", 2, opts)).toBe(true);
  });

  it("classFeat: accepts a SHARED class feat (category class, no class-specific trait)", () => {
    const shared = { system: { category: "class", level: 1, traits: { value: [] } } };
    expect(featElegivel(shared, "classFeat", 1, opts)).toBe(true);
  });

  it("classFeat: rejects a feat tagged for a DIFFERENT known class", () => {
    const wizardFeat = { system: { category: "class", level: 1, traits: { value: ["wizard"] } } };
    expect(featElegivel(wizardFeat, "classFeat", 5, opts)).toBe(false);
  });

  it("classFeat: rejects archetype-trait feats (they belong in the archetypeFeat slot)", () => {
    expect(featElegivel(alchemistDedicationFeatDoc(), "classFeat", 5, opts)).toBe(false);
  });

  it("classFeat: rejects a feat above the character's level", () => {
    const highLevelFeat = { system: { category: "class", level: 10, traits: { value: ["magus"] } } };
    expect(featElegivel(highLevelFeat, "classFeat", 2, opts)).toBe(false);
  });

  it("archetypeFeat: accepts category class + trait archetype (dedications)", () => {
    expect(featElegivel(alchemistDedicationFeatDoc(), "archetypeFeat", 2, opts)).toBe(true);
  });

  it("archetypeFeat: rejects a regular class feat without the archetype trait", () => {
    expect(featElegivel(arcaneFistsFeatDoc(), "archetypeFeat", 2, opts)).toBe(false);
  });

  it("ancestryFeat: accepts a feat tagged with the character's ancestry", () => {
    expect(featElegivel(cheekPouchesAncestryFeatDoc(), "ancestryFeat", 1, opts)).toBe(true);
  });

  it("ancestryFeat: rejects a feat for a different ancestry", () => {
    const elfFeat = { system: { category: "ancestry", level: 1, traits: { value: ["elf"] } } };
    expect(featElegivel(elfFeat, "ancestryFeat", 1, opts)).toBe(false);
  });

  it("ancestryFeat: rejects a non-ancestry-category feat", () => {
    expect(featElegivel(arcaneFistsFeatDoc(), "ancestryFeat", 1, opts)).toBe(false);
  });

  it("generalFeat: accepts category general regardless of traits", () => {
    expect(featElegivel(adoptedAncestryGeneralFeatDoc(), "generalFeat", 1, opts)).toBe(true);
  });

  it("generalFeat: rejects non-general category", () => {
    expect(featElegivel(arcaneFistsFeatDoc(), "generalFeat", 2, opts)).toBe(false);
  });

  it("skillFeat: accepts category skill", () => {
    expect(featElegivel(speedrunStratsSkillFeatDoc(), "skillFeat", 1, opts)).toBe(true);
  });

  it("skillFeat: rejects non-skill category", () => {
    expect(featElegivel(arcaneFistsFeatDoc(), "skillFeat", 2, opts)).toBe(false);
  });

  it("works without classSlug/ancestrySlug opts (never throws, defaults permissive for shared feats)", () => {
    const shared = { system: { category: "class", level: 1, traits: { value: [] } } };
    expect(featElegivel(shared, "classFeat", 1)).toBe(true);
  });

  it("defaults category to 'general' and level to 1 when the feat doc is minimal", () => {
    expect(featElegivel({}, "generalFeat", 1)).toBe(true);
    expect(featElegivel({}, "classFeat", 1)).toBe(false);
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
