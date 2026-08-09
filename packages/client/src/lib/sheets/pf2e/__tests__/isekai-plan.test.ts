/**
 * isekai-plan.test.ts — the Isekai layer's surface in the "Plano" column and
 * the ops that write it.
 *
 * Two contracts here:
 *   - with the variant off, the Plan is byte-identical to what it was before
 *     the layer existed (no chip, no slot, no change);
 *   - with it on, each Minor Blessing appears as a locked chip on the card of
 *     the level that grants it, from BOTH archetypes, and the Major Blessing
 *     lands on level 1.
 */

import { describe, it, expect } from "vitest";
import {
  derivePlan,
  getIsekaiVariant,
  getIsekaiArchetypes,
  setIsekaiVariant,
  toggleIsekaiArchetype,
  setIsekaiTracker,
  type PlanOpBuilderContext,
} from "../planVM.js";
import { DocUpdatePayloadSchema } from "@fusion/shared";
import type { DocUpdatePayload } from "../characterSheetVM.js";

/** A minimal class item — enough for derivePlan to emit level cards. */
function classItem(): Record<string, unknown> {
  return {
    _id: "item-class",
    name: "Fighter",
    type: "class",
    system: {
      hp: 10,
      keyAbility: ["str"],
      featLevels: { ancestry: [1], class: [1, 2], general: [3], skill: [2] },
      skillIncreaseLevels: [3],
      abilityBoostLevels: [5],
      trainedSkills: { value: ["athletics"], additional: 3 },
      featuresByLevel: [{ level: 1, uuid: "feat-attack", name: "Attack of Opportunity" }],
    },
  };
}

function doc(
  options: {
    level?: number;
    variantOn?: boolean;
    archetypes?: string[];
    trackers?: Record<string, Record<string, unknown>>;
  } = {},
): Record<string, unknown> {
  const system: Record<string, unknown> = {
    level: { value: options.level ?? 12 },
    details: {},
    build: { variantRules: { isekai: options.variantOn ?? false } },
  };
  if (options.archetypes || options.trackers) {
    system["isekai"] = {
      archetypes: options.archetypes ?? [],
      trackers: options.trackers ?? {},
    };
  }
  return { _id: "actor-x", name: "X", type: "character", items: [classItem()], system };
}

function ctx(d: Record<string, unknown>, editable = true): PlanOpBuilderContext {
  return { actorId: "actor-x", doc: d, editable };
}

/**
 * The op in its WIRE shape — the client's `DocUpdatePayload` carries `id`+
 * `diff` flat, while the protocol envelope batches them under `updates[]`.
 * Same conversion `sendOpFn` does, mirroring `planVM.test.ts`.
 */
function wire(op: DocUpdatePayload | null): unknown {
  return { documentType: op?.documentType, updates: [{ _id: op?.id, diff: op?.diff }] };
}

/** Every Isekai chip on the card of `level`. */
function isekaiChipsAt(d: Record<string, unknown>, level: number) {
  const plan = derivePlan(d);
  const card = plan.levels.find((l) => l.level === level);
  return (card?.autoFeatures ?? []).filter((f) => f.isekai !== undefined);
}

// ---------------------------------------------------------------------------
// Reading the toggle
// ---------------------------------------------------------------------------

describe("getIsekaiVariant / getIsekaiArchetypes", () => {
  it("reads the variant as off when the block is absent entirely", () => {
    expect(getIsekaiVariant({})).toBe(false);
    expect(getIsekaiArchetypes({})).toEqual([]);
  });

  it("reads the picked archetypes", () => {
    const sys = doc({ variantOn: true, archetypes: ["fodao", "sortudo"] })["system"] as Record<
      string,
      unknown
    >;
    expect(getIsekaiVariant(sys)).toBe(true);
    expect(getIsekaiArchetypes(sys)).toEqual(["fodao", "sortudo"]);
  });

  it("drops non-string garbage from the archetype list", () => {
    expect(getIsekaiArchetypes({ isekai: { archetypes: ["fodao", 42, null] } })).toEqual(["fodao"]);
  });

  it("returns an empty list when archetypes is not an array", () => {
    expect(getIsekaiArchetypes({ isekai: { archetypes: "fodao" } })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The Plan surface
// ---------------------------------------------------------------------------

describe("derivePlan — with the Isekai variant off", () => {
  it("emits no Isekai chip at any level", () => {
    const d = doc({ variantOn: false, archetypes: ["fodao", "sortudo"] });
    const plan = derivePlan(d);
    for (const card of plan.levels) {
      expect(
        card.autoFeatures.every((f) => f.isekai === undefined),
        `level ${String(card.level)}`,
      ).toBe(true);
    }
  });

  it("keeps the class's own auto features untouched", () => {
    const plan = derivePlan(doc({ variantOn: false }));
    const level1 = plan.levels.find((l) => l.level === 1);
    expect(level1?.autoFeatures.map((f) => f.name)).toContain("Attack of Opportunity");
  });
});

describe("derivePlan — with the Isekai variant on", () => {
  const d = doc({ variantOn: true, archetypes: ["fodao", "sortudo"], level: 12 });

  it("puts the Major Blessing of each archetype on level 1", () => {
    const names = isekaiChipsAt(d, 1).map((f) => f.name);
    expect(names).toContain("Físico Impossível");
    expect(names).toContain("Dados do Destino");
  });

  it("puts both level-1 Minor Blessings of an archetype on level 1", () => {
    const names = isekaiChipsAt(d, 1).map((f) => f.name);
    expect(names).toContain("Couraça de Protagonista");
    expect(names).toContain("Vitalidade Sobre-Humana");
  });

  it("puts a level-6 blessing on the level-6 card, not before", () => {
    expect(isekaiChipsAt(d, 5).map((f) => f.name)).not.toContain("Passada Imparável");
    expect(isekaiChipsAt(d, 6).map((f) => f.name)).toContain("Passada Imparável");
  });

  it("merges both archetypes on the same card", () => {
    const at12 = isekaiChipsAt(d, 12).map((f) => f.name);
    expect(at12).toContain("Plot Armor");
    expect(at12).toContain("A Casa Sempre Vence");
  });

  it("marks every Isekai chip as locked — a blessing is never a pick", () => {
    for (const chip of isekaiChipsAt(d, 1)) {
      expect(chip.locked).toBe(true);
    }
  });

  it("carries the archetype's identity and colour for the chip's accent", () => {
    const chip = isekaiChipsAt(d, 6).find((f) => f.name === "Passada Imparável");
    expect(chip?.isekai?.archetypeId).toBe("fodao");
    expect(chip?.isekai?.color).toBe("#bb3a33");
    expect(chip?.isekai?.text).toContain("Speed +10 ft");
  });

  it("never resolves an Isekai chip against a compendium pack", () => {
    // These chips have no document behind them: a details request must not go
    // hunting for "Plot Armor" in feats-core and show something unrelated.
    for (const chip of isekaiChipsAt(d, 12)) {
      expect(chip.docId).toBeUndefined();
      expect(chip.sourceId).toBeUndefined();
      expect(chip.detailsPackSlug).toBeUndefined();
    }
  });

  it("emits nothing when the toggle is on but no archetype is picked", () => {
    const empty = doc({ variantOn: true, archetypes: [] });
    for (const card of derivePlan(empty).levels) {
      expect(card.autoFeatures.every((f) => f.isekai === undefined)).toBe(true);
    }
  });

  it("ignores an archetype id the content no longer knows", () => {
    const stale = doc({ variantOn: true, archetypes: ["fodao", "arquétipo-removido"] });
    const names = isekaiChipsAt(stale, 1).map((f) => f.name);
    expect(names).toContain("Físico Impossível");
    expect(names.length).toBeGreaterThan(0);
  });

  it("shows a level-5 blessing only for the archetype that has one", () => {
    // The Queridinho's ladder uses 5 where everyone else uses 4.
    const q = doc({ variantOn: true, archetypes: ["queridinho", "fodao"], level: 12 });
    expect(isekaiChipsAt(q, 5).map((f) => f.isekai?.archetypeId)).toEqual(["queridinho"]);
    expect(isekaiChipsAt(q, 4).map((f) => f.isekai?.archetypeId)).toEqual(["fodao"]);
  });

  it("stops at the character's level — no chips for levels not yet reached", () => {
    const low = doc({ variantOn: true, archetypes: ["fodao"], level: 3 });
    const plan = derivePlan(low);
    expect(plan.levels.map((l) => l.level)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

describe("setIsekaiVariant", () => {
  it("writes the toggle", () => {
    const op = setIsekaiVariant(ctx(doc()), true);
    expect(op?.diff).toEqual({ "system.build.variantRules.isekai": true });
    expect(DocUpdatePayloadSchema.safeParse(wire(op)).success).toBe(true);
  });

  it("keeps the archetype picks when turned OFF", () => {
    // Same contract as the class-levels variant: flipping the switch back must
    // not have lost the plan.
    const op = setIsekaiVariant(ctx(doc({ variantOn: true, archetypes: ["fodao"] })), false);
    expect(op?.diff).toEqual({ "system.build.variantRules.isekai": false });
  });

  it("returns null for a non-editable sheet", () => {
    expect(setIsekaiVariant(ctx(doc(), false), true)).toBeNull();
  });
});

describe("toggleIsekaiArchetype", () => {
  it("adds the first archetype", () => {
    const op = toggleIsekaiArchetype(ctx(doc({ variantOn: true })), "fodao");
    expect(op?.diff).toEqual({ "system.isekai.archetypes": ["fodao"] });
  });

  it("adds a second one alongside the first", () => {
    const op = toggleIsekaiArchetype(
      ctx(doc({ variantOn: true, archetypes: ["fodao"] })),
      "sortudo",
    );
    expect(op?.diff).toEqual({ "system.isekai.archetypes": ["fodao", "sortudo"] });
  });

  it("refuses a third — the cap is the layer's whole balance premise", () => {
    const op = toggleIsekaiArchetype(
      ctx(doc({ variantOn: true, archetypes: ["fodao", "sortudo"] })),
      "crafter",
    );
    expect(op).toBeNull();
  });

  it("removes an archetype already picked", () => {
    const op = toggleIsekaiArchetype(
      ctx(doc({ variantOn: true, archetypes: ["fodao", "sortudo"] })),
      "fodao",
    );
    expect(op?.diff).toEqual({ "system.isekai.archetypes": ["sortudo"] });
  });

  it("un-picking keeps the tracker state, so re-picking restores it", () => {
    // The state is the player's log of a whole campaign — a mis-click on the
    // selector must not delete their Séquito.
    const op = toggleIsekaiArchetype(
      ctx(
        doc({
          variantOn: true,
          archetypes: ["carismatico"],
          trackers: {
            carismatico: { retinue: [{ id: "a", name: "Gobta", tier: "base", named: false }] },
          },
        }),
      ),
      "carismatico",
    );
    expect(Object.keys(op?.diff ?? {})).toEqual(["system.isekai.archetypes"]);
  });

  it("refuses an id no archetype has — never write junk into the sheet", () => {
    expect(toggleIsekaiArchetype(ctx(doc({ variantOn: true })), "nao-existe")).toBeNull();
  });

  it("returns null for a non-editable sheet", () => {
    expect(toggleIsekaiArchetype(ctx(doc({ variantOn: true }), false), "fodao")).toBeNull();
  });

  it("produces a wire-valid op", () => {
    const op = toggleIsekaiArchetype(ctx(doc({ variantOn: true })), "fodao");
    expect(DocUpdatePayloadSchema.safeParse(wire(op)).success).toBe(true);
  });
});

describe("setIsekaiTracker", () => {
  it("writes one tracker's state without touching the others", () => {
    const op = setIsekaiTracker(
      ctx(doc({ variantOn: true, archetypes: ["sortudo"] })),
      "sortudo",
      "destinyDice",
      [14, 3, 20],
    );
    expect(op?.diff).toEqual({ "system.isekai.trackers.sortudo.destinyDice": [14, 3, 20] });
    expect(DocUpdatePayloadSchema.safeParse(wire(op)).success).toBe(true);
  });

  it("refuses to write a tracker for an archetype the character did not pick", () => {
    const op = setIsekaiTracker(
      ctx(doc({ variantOn: true, archetypes: ["sortudo"] })),
      "carismatico",
      "retinue",
      [],
    );
    expect(op).toBeNull();
  });

  it("refuses a tracker id that archetype does not have", () => {
    const op = setIsekaiTracker(
      ctx(doc({ variantOn: true, archetypes: ["sortudo"] })),
      "sortudo",
      "retinue",
      [],
    );
    expect(op).toBeNull();
  });

  it("returns null for a non-editable sheet", () => {
    expect(
      setIsekaiTracker(
        ctx(doc({ variantOn: true, archetypes: ["sortudo"] }), false),
        "sortudo",
        "destinyDice",
        [],
      ),
    ).toBeNull();
  });
});
