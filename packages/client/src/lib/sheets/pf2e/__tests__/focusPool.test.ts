/**
 * focusPool.test.ts — the focus pool a class grants at level 1 (issue #4).
 *
 * PF2e's rule: gaining your first focus spell gives you a focus pool of 1
 * point. The builder used to create the focus spellcastingEntry and never
 * touch `system.resources.focusPoints`, so the pool stayed {value:0,max:0}
 * and the sheet's Cast button — `disabled={vm.focusPoints.value <= 0}` —
 * was dead for every class that has focus spells at all.
 *
 * The assertion is that rule, not a mirror of what applyClass happens to
 * emit (issue #48's circularity).
 */

import { describe, it, expect } from "vitest";
import { applyClass, chooseFeat, chooseClassChoice } from "../planVM.js";
import type { PlanSlotModel, PlanOpBuilderContext } from "../planVM.js";
import type { DocOpPayload } from "../characterSheetVM.js";

/** A class doc shaped like the real compiled packs, parameterized on its level-1 features. */
function classDoc(
  name: string,
  featuresByLevel: Array<{ level: number; uuid: string; name: string }>,
  spellcasting: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    _id: `class-${name.toLowerCase()}`,
    name,
    type: "class",
    system: {
      attacks: { advanced: 0, martial: 1, simple: 1, unarmed: 1 },
      defenses: { heavy: 0, light: 1, medium: 1, unarmored: 1 },
      description: "",
      hp: 8,
      keyAbility: ["cha"],
      perception: 1,
      savingThrows: { fortitude: 2, reflex: 1, will: 2 },
      skillIncreaseLevels: [3, 5],
      trainedSkills: { value: [], additional: 2 },
      traits: { rarity: "common", value: [] },
      featuresByLevel,
      ...(spellcasting ? { spellcasting } : {}),
    },
  };
}

/** Magus-shaped: has a level-1 "<X> Spells" focus feature AND its own spellcasting table. */
function magusLike(): Record<string, unknown> {
  return classDoc("Magus", [{ level: 1, uuid: "u-conflux", name: "Conflux Spells" }], {
    tradition: "arcane",
    type: "prepared",
    ability: "int",
    cantripsKnown: [{ level: 1, count: 5 }],
    slots: [{ level: 1, slots: { "1": 1 } }],
  });
}

/** Champion-shaped: focus feature at level 1, NO spellcasting block (divine/cha comes from rules text). */
function championLike(): Record<string, unknown> {
  return classDoc("Champion", [{ level: 1, uuid: "u-devotion", name: "Devotion Spells" }], null);
}

/** Fighter-shaped: no focus feature at all. */
function fighterLike(): Record<string, unknown> {
  return classDoc("Fighter", [{ level: 1, uuid: "u-reactive", name: "Reactive Strike" }], null);
}

/** A level-1 character sheet with nothing on it yet. */
function characterDoc(): Record<string, unknown> {
  return {
    _id: "actor-1",
    name: "Test",
    type: "character",
    items: [],
    system: { level: { value: 1 }, details: {} },
  };
}

function ctx(actorId = "actor-1") {
  return { actorId, doc: characterDoc(), editable: true };
}

/** The `system.resources.focusPoints.*` values an op set, if it set any. */
function focusPointsFrom(ops: DocOpPayload[]): { value?: unknown; max?: unknown } | undefined {
  for (const op of ops) {
    if (op.type !== "doc:update" || op.documentType !== "Actor") continue;
    const diff = op.diff as Record<string, unknown>;
    const max = diff["system.resources.focusPoints.max"];
    const value = diff["system.resources.focusPoints.value"];
    if (max !== undefined || value !== undefined) return { value, max };
  }
  return undefined;
}

describe("applyClass — focus pool (issue #4)", () => {
  it("a class with a level-1 focus feature opens a pool of 1 point", () => {
    const pool = focusPointsFrom(applyClass(ctx(), magusLike()));
    expect(pool).toEqual({ value: 1, max: 1 });
  });

  it("a focus class with no spellcasting block (Champion) also gets the pool", () => {
    const pool = focusPointsFrom(applyClass(ctx(), championLike()));
    expect(pool).toEqual({ value: 1, max: 1 });
  });

  it("a class with no focus feature gets NO pool", () => {
    expect(focusPointsFrom(applyClass(ctx(), fighterLike()))).toBeUndefined();
  });

  it("the pool op accompanies the focus entry — never one without the other", () => {
    const ops = applyClass(ctx(), magusLike());
    const hasEntry = ops.some(
      (o) =>
        o.type === "doc:create" && (o.data as Record<string, unknown>)["name"] === "Focus Spells",
    );
    expect(hasEntry).toBe(true);
    expect(focusPointsFrom(ops)).toBeDefined();
  });

  it("nothing is emitted when the sheet is not editable", () => {
    const ops = applyClass({ actorId: "a", doc: characterDoc(), editable: false }, magusLike());
    expect(ops).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// issue #5 — Cleric/Monk/Ranger/Wizard: focus pool gated behind a later
// CHOICE (feat or axis), not the class item itself. `hasFocusFeature`
// (applyClass) only recognizes a level-1 CLASS FEATURE named "<X> Spells" —
// verified against the real pack (systems/pf2e/packs/classes-core): only
// Bard/Champion/Magus/Sorcerer have one. Cleric/Monk/Ranger's focus spells
// are gated behind an ordinary class FEAT (Domain Initiate/Qi Spells/
// Initiate Warden) with no structured tradition/ability field at all in the
// pack; Wizard's is gated behind the "Arcane School" AXIS, whose name
// doesn't end in " Spells" either. Fixtures below are shaped like the real
// pack docs (level-1 `type: "feat"`/`"classFeature"`, correct class trait),
// but the ability/tradition assertions come from each feat's own RAW text
// (cited in FOCUS_GRANTING_FEAT's doc comment in planVM.ts), never from a
// pack field — there isn't one to read.
// ---------------------------------------------------------------------------

function ctxWithDoc(doc: Record<string, unknown>, actorId = "actor-1"): PlanOpBuilderContext {
  return { actorId, doc, editable: true };
}

const CLASS_FEAT_SLOT: PlanSlotModel = {
  slotId: "classFeat-1",
  type: "classFeat",
  label: "Class Feat",
  filled: false,
};

function domainInitiateFeatDoc(): Record<string, unknown> {
  return {
    _id: "feat-domain-initiate",
    name: "Domain Initiate",
    type: "feat",
    system: { level: 1, traits: { rarity: "common", value: ["cleric"] } },
  };
}

function qiSpellsFeatDoc(): Record<string, unknown> {
  return {
    _id: "feat-qi-spells",
    name: "Qi Spells",
    type: "feat",
    system: { level: 1, traits: { rarity: "common", value: ["monk"] } },
  };
}

function initiateWardenFeatDoc(): Record<string, unknown> {
  return {
    _id: "feat-initiate-warden",
    name: "Initiate Warden",
    type: "feat",
    system: { level: 1, traits: { rarity: "common", value: ["ranger"] } },
  };
}

function toughnessFeatDoc(): Record<string, unknown> {
  return {
    _id: "feat-toughness",
    name: "Toughness",
    type: "feat",
    system: { level: 1, traits: { rarity: "common", value: ["general"] } },
  };
}

function focusEntryOpFrom(ops: DocOpPayload[]): DocOpPayload | undefined {
  return ops.find(
    (o) =>
      o.type === "doc:create" && (o.data as Record<string, unknown>)["name"] === "Focus Spells",
  );
}

describe("chooseFeat — focus pool opens on a chosen FEAT (issue #5: Cleric/Monk/Ranger)", () => {
  it("Domain Initiate (Cleric) opens a divine/wis focus pool", () => {
    const ops = chooseFeat(ctxWithDoc(characterDoc()), CLASS_FEAT_SLOT, 1, domainInitiateFeatDoc());
    const focusOp = focusEntryOpFrom(ops);
    expect(focusOp).toBeDefined();
    if (!focusOp || focusOp.type !== "doc:create") throw new Error("expected doc:create");
    const sys = focusOp.data["system"] as Record<string, unknown>;
    expect((sys["tradition"] as Record<string, unknown>)["value"]).toBe("divine");
    expect((sys["ability"] as Record<string, unknown>)["value"]).toBe("wis");
    expect(sys["isFocusPool"]).toBe(true);
    expect(focusPointsFrom(ops)).toEqual({ value: 1, max: 1 });
  });

  it("Qi Spells (Monk) opens a divine/wis focus pool", () => {
    const ops = chooseFeat(ctxWithDoc(characterDoc()), CLASS_FEAT_SLOT, 1, qiSpellsFeatDoc());
    const focusOp = focusEntryOpFrom(ops);
    if (!focusOp || focusOp.type !== "doc:create") throw new Error("expected doc:create");
    const sys = focusOp.data["system"] as Record<string, unknown>;
    expect((sys["tradition"] as Record<string, unknown>)["value"]).toBe("divine");
    expect((sys["ability"] as Record<string, unknown>)["value"]).toBe("wis");
    expect(focusPointsFrom(ops)).toEqual({ value: 1, max: 1 });
  });

  it("Initiate Warden (Ranger) opens a primal/wis focus pool", () => {
    const ops = chooseFeat(ctxWithDoc(characterDoc()), CLASS_FEAT_SLOT, 1, initiateWardenFeatDoc());
    const focusOp = focusEntryOpFrom(ops);
    if (!focusOp || focusOp.type !== "doc:create") throw new Error("expected doc:create");
    const sys = focusOp.data["system"] as Record<string, unknown>;
    expect((sys["tradition"] as Record<string, unknown>)["value"]).toBe("primal");
    expect((sys["ability"] as Record<string, unknown>)["value"]).toBe("wis");
    expect(focusPointsFrom(ops)).toEqual({ value: 1, max: 1 });
  });

  it("a feat NOT in the focus-granting map never opens a pool (no false positives)", () => {
    const ops = chooseFeat(ctxWithDoc(characterDoc()), CLASS_FEAT_SLOT, 1, toughnessFeatDoc());
    expect(focusPointsFrom(ops)).toBeUndefined();
    expect(focusEntryOpFrom(ops)).toBeUndefined();
  });

  it("re-picking the trigger feat when a focus entry ALREADY exists does not reset an already-spent pool", () => {
    const doc = characterDoc();
    (doc["items"] as Array<Record<string, unknown>>).push({
      _id: "existing-focus",
      name: "Focus Spells",
      type: "spellcastingEntry",
      system: { isFocusPool: true, tradition: { value: "divine" }, ability: { value: "wis" } },
    });
    const ops = chooseFeat(ctxWithDoc(doc), CLASS_FEAT_SLOT, 1, domainInitiateFeatDoc());
    expect(focusEntryOpFrom(ops)).toBeUndefined();
    expect(focusPointsFrom(ops)).toBeUndefined();
  });
});

/** Real Wizard shape: `spellcasting.tradition`/`ability` fixed (arcane/int), "Arcane School" among its level-1 features (no " Spells" suffix). */
function wizardLike(): Record<string, unknown> {
  return classDoc(
    "Wizard",
    [
      { level: 1, uuid: "u-wiz-spellcasting", name: "Wizard Spellcasting" },
      { level: 1, uuid: "u-arcane-school", name: "Arcane School" },
    ],
    {
      tradition: "arcane",
      type: "prepared",
      ability: "int",
      cantripsKnown: [{ level: 1, count: 5 }],
      slots: [{ level: 1, slots: { "1": 2 } }],
    },
  );
}

/** A character with the Wizard class already embedded (as `applyClass` would have left it). */
function wizardActorDoc(): Record<string, unknown> {
  const doc = characterDoc();
  return {
    ...doc,
    items: [
      {
        ...wizardLike(),
        _id: "item-class",
        flags: { fusion: { build: { level: 1, slot: "class" } } },
      },
    ],
  };
}

function schoolFeatureDoc(name: string, id: string): Record<string, unknown> {
  return {
    _id: id,
    name,
    type: "classFeature",
    system: { level: 1, traits: { otherTags: ["wizard-arcane-school"], value: [] } },
  };
}

describe("chooseClassChoice(arcaneSchool) — Wizard focus pool (issue #5)", () => {
  it("choosing a school opens the class's own arcane/int focus pool", () => {
    const ops = chooseClassChoice(
      ctxWithDoc(wizardActorDoc()),
      "arcaneSchool",
      1,
      schoolFeatureDoc("School of Evocation", "feature-evocation"),
    );
    const focusOp = focusEntryOpFrom(ops);
    expect(focusOp).toBeDefined();
    if (!focusOp || focusOp.type !== "doc:create") throw new Error("expected doc:create");
    const sys = focusOp.data["system"] as Record<string, unknown>;
    expect((sys["tradition"] as Record<string, unknown>)["value"]).toBe("arcane");
    expect((sys["ability"] as Record<string, unknown>)["value"]).toBe("int");
    expect(sys["isFocusPool"]).toBe(true);
    expect(focusPointsFrom(ops)).toEqual({ value: 1, max: 1 });
  });

  it("does nothing when the actor has no Wizard class item on the sheet (defensive)", () => {
    const ops = chooseClassChoice(
      ctxWithDoc(characterDoc()),
      "arcaneSchool",
      1,
      schoolFeatureDoc("School of Evocation", "feature-evocation"),
    );
    expect(focusEntryOpFrom(ops)).toBeUndefined();
  });

  it("re-picking a different school does not re-open (or reset) an already-open pool", () => {
    const doc = wizardActorDoc();
    (doc["items"] as Array<Record<string, unknown>>).push({
      _id: "existing-focus",
      name: "Focus Spells",
      type: "spellcastingEntry",
      system: { isFocusPool: true, tradition: { value: "arcane" }, ability: { value: "int" } },
    });
    const ops = chooseClassChoice(
      ctxWithDoc(doc),
      "arcaneSchool",
      1,
      schoolFeatureDoc("School of Abjuration", "feature-abjuration"),
    );
    expect(focusEntryOpFrom(ops)).toBeUndefined();
    expect(focusPointsFrom(ops)).toBeUndefined();
  });
});
