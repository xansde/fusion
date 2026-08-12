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
import { applyClass } from "../planVM.js";
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
