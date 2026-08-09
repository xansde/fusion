/**
 * isekai-tab.test.ts — the Isekai tab's view-model.
 *
 * The tab answers one question per section: how much Focus can I spend, what
 * can I spend it on, and what is each tracker holding. These tests pin the
 * arithmetic — especially the locked-Focus reading, which must trust the
 * server rather than recount from the trackers.
 */

import { describe, it, expect } from "vitest";
import type { RollResultData } from "@fusion/shared";
import {
  buildIsekaiTabModel,
  d20ResultsFrom,
  isekaiFocusModel,
  isekaiTrackerModels,
} from "../isekai/tabVM.js";

function doc(
  options: {
    level?: number;
    focus?: { value: number; max: number };
    locked?: number;
    trackers?: Record<string, Record<string, unknown>>;
  } = {},
): Record<string, unknown> {
  const system: Record<string, unknown> = {
    level: { value: options.level ?? 12 },
    resources: { focusPoints: options.focus ?? { value: 3, max: 3 } },
  };
  if (options.locked !== undefined) system["derived"] = { isekaiFocusLocked: options.locked };
  if (options.trackers) system["isekai"] = { trackers: options.trackers };
  return { _id: "actor-x", type: "character", system };
}

describe("isekaiFocusModel", () => {
  it("reads a full pool with no locks", () => {
    expect(isekaiFocusModel(doc())).toEqual({ value: 3, max: 3, locked: 0, spendable: 3 });
  });

  it("subtracts the locks from what is spendable, keeping max at the pool size", () => {
    // The sheet renders "1/3 · 2 travado": the player must see the pool IS
    // three, and that two points are held by their own choices.
    const model = isekaiFocusModel(doc({ focus: { value: 1, max: 3 }, locked: 2 }));
    expect(model).toEqual({ value: 1, max: 3, locked: 2, spendable: 1 });
  });

  it("clamps a stale value down to what the locks left spendable", () => {
    const model = isekaiFocusModel(doc({ focus: { value: 3, max: 3 }, locked: 2 }));
    expect(model.value).toBe(1);
  });

  it("treats a missing derived block as zero locks, never as an error", () => {
    const model = isekaiFocusModel(doc({ focus: { value: 2, max: 3 } }));
    expect(model.locked).toBe(0);
    expect(model.spendable).toBe(3);
  });

  it("never reports a pool wider than the published cap", () => {
    const model = isekaiFocusModel(doc({ focus: { value: 9, max: 9 } }));
    expect(model.max).toBe(3);
    expect(model.value).toBe(3);
  });

  it("survives a document with no resources at all", () => {
    expect(isekaiFocusModel({ system: {} })).toEqual({
      value: 0,
      max: 0,
      locked: 0,
      spendable: 0,
    });
  });

  it("ignores a locked count larger than the pool", () => {
    const model = isekaiFocusModel(doc({ focus: { value: 0, max: 3 }, locked: 9 }));
    expect(model.locked).toBe(3);
    expect(model.spendable).toBe(0);
  });
});

describe("isekaiTrackerModels", () => {
  it("returns one model per archetype that has a tracker, in pick order", () => {
    const models = isekaiTrackerModels(doc(), ["sortudo", "carismatico"]);
    expect(models.map((m) => m.archetype.id)).toEqual(["sortudo", "carismatico"]);
    expect(models.map((m) => m.def.kind)).toEqual(["dice-pool", "roster"]);
  });

  it("skips the Queridinho, which deliberately has none", () => {
    const models = isekaiTrackerModels(doc(), ["queridinho", "fodao"]);
    expect(models.map((m) => m.archetype.id)).toEqual(["fodao"]);
  });

  it("hands each widget its own persisted state", () => {
    const models = isekaiTrackerModels(
      doc({ trackers: { sortudo: { destinyDice: [14, 3, 20] } } }),
      ["sortudo"],
    );
    expect(models[0]?.state).toEqual([14, 3, 20]);
  });

  it("hands undefined for a tracker never written yet", () => {
    expect(isekaiTrackerModels(doc(), ["sortudo"])[0]?.state).toBeUndefined();
  });

  it("ignores an archetype id the content no longer knows", () => {
    expect(isekaiTrackerModels(doc(), ["nao-existe"])).toEqual([]);
  });
});

describe("buildIsekaiTabModel", () => {
  it("resolves the archetypes while keeping the raw ids", () => {
    const model = buildIsekaiTabModel(doc(), ["fodao", "nao-existe"]);
    expect(model.archetypes.map((a) => a.id)).toEqual(["fodao"]);
    expect(model.archetypeIds).toEqual(["fodao", "nao-existe"]);
  });

  it("lists only the actions unlocked at the character's level", () => {
    const low = buildIsekaiTabModel(doc({ level: 3 }), ["fodao"]);
    expect(low.actions.map((r) => r.action.id)).not.toContain("passada");
    const high = buildIsekaiTabModel(doc({ level: 12 }), ["fodao"]);
    expect(high.actions.map((r) => r.action.id)).toContain("passada");
  });

  it("merges the actions of both archetypes", () => {
    const model = buildIsekaiTabModel(doc(), ["fodao", "sortudo"]);
    const ids = model.actions.map((r) => r.action.id);
    expect(ids).toContain("soco-serio");
    expect(ids).toContain("hoje-e-meu-dia");
  });

  it("floors the level at 1 for a document with none", () => {
    expect(buildIsekaiTabModel({ system: {} }, ["fodao"]).level).toBe(1);
  });

  it("returns an empty model for a character with no archetypes", () => {
    const model = buildIsekaiTabModel(doc(), []);
    expect(model.archetypes).toEqual([]);
    expect(model.actions).toEqual([]);
    expect(model.trackers).toEqual([]);
  });
});

describe("d20ResultsFrom", () => {
  function roll(terms: RollResultData["terms"]): RollResultData {
    return {
      rollId: "r1",
      formula: "3d20",
      expandedFormula: "3d20",
      total: 0,
      terms,
      rollMode: "public",
      timestamp: 0,
      warnings: [],
    };
  }

  it("returns the faces of a d20 term in order", () => {
    const r = roll([
      {
        type: "dice",
        expression: "3d20",
        total: 37,
        faces: 20,
        number: 3,
        results: [
          { result: 14, active: true },
          { result: 3, active: true },
          { result: 20, active: true },
        ],
      },
    ]);
    expect(d20ResultsFrom(r)).toEqual([14, 3, 20]);
  });

  it("skips a discarded die — a die the formula threw away was never banked", () => {
    const r = roll([
      {
        type: "dice",
        expression: "2d20kh1",
        total: 18,
        faces: 20,
        number: 2,
        results: [
          { result: 18, active: true },
          { result: 4, active: false, discarded: true },
        ],
      },
    ]);
    expect(d20ResultsFrom(r)).toEqual([18]);
  });

  it("ignores dice that are not d20", () => {
    const r = roll([
      {
        type: "dice",
        expression: "2d6",
        total: 7,
        faces: 6,
        number: 2,
        results: [{ result: 3, active: true }],
      },
      {
        type: "dice",
        expression: "1d20",
        total: 11,
        faces: 20,
        number: 1,
        results: [{ result: 11, active: true }],
      },
    ]);
    expect(d20ResultsFrom(r)).toEqual([11]);
  });

  it("ignores numeric terms, so a modifier never becomes a banked die", () => {
    const r = roll([
      {
        type: "dice",
        expression: "1d20",
        total: 9,
        faces: 20,
        number: 1,
        results: [{ result: 9, active: true }],
      },
      { type: "operator", expression: "+", total: 0 },
      { type: "numeric", expression: "5", total: 5 },
    ]);
    expect(d20ResultsFrom(r)).toEqual([9]);
  });

  it("returns nothing when the roll never arrived", () => {
    expect(d20ResultsFrom(undefined)).toEqual([]);
  });

  it("returns nothing for a term with no results array", () => {
    expect(
      d20ResultsFrom(roll([{ type: "dice", expression: "1d20", total: 7, faces: 20 }])),
    ).toEqual([]);
  });
});
