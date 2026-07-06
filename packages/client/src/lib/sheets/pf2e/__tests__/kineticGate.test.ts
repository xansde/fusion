/**
 * kineticGate.test.ts — Kineticist "Kinetic Gate" builder support (r18-N2c).
 *
 * Covers the client-side Kinetic Gate flow that feeds the r18-N2b derivation:
 *   - a level-1 `kineticGate` slot appears ONLY for a class with the Kinetic
 *     Gate feature (Kineticist), and NOT for other classes (Magus);
 *   - chooseKineticGate emits the "Kinetic Gate" classFeature carrying
 *     `system.kineticGates: [{element, damageType}]` — the exact shape
 *     stepCharElementalBlasts reads (systems/pf2e/src/derivations/
 *     elementalBlast.ts);
 *   - single vs dual gate → 1 or 2 picks; invalid damage types fall back to the
 *     element's first valid option;
 *   - the classFeat picker's impulse filter (isFeatEligible + gateElements): an
 *     Air+Metal kineticist can pick Air/Metal impulses but not a Fire impulse,
 *     while non-impulse class feats and gate-less characters are unaffected;
 *   - readGateElements reads the chosen elements back for the filter;
 *   - the planVM damage-type table stays in sync with the derivation's table.
 *
 * 100% headless (no PIXI/Svelte/browser). Ops validated against the wire Zod
 * schema, mirroring planVM.test.ts.
 *
 * REQ-PF2-010, REQ-PF2-030, REQ-PF2-034.
 */

import { describe, it, expect } from "vitest";
import {
  derivePlan,
  chooseKineticGate,
  readGateElements,
  classHasKineticGate,
  isFeatEligible,
  KINETIC_ELEMENTS,
  KINETIC_ELEMENT_DAMAGE_TYPES,
  type PlanOpBuilderContext,
  type ClassSystemLike,
  type FeatDocLike,
} from "../planVM.js";
import { DocCreatePayloadSchema, DocUpdatePayloadSchema } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fixtures — real vendor shapes (systems/pf2e/packs/*).
// ---------------------------------------------------------------------------

/** Kineticist class doc: keyAbility CON, "Kinetic Gate" at level 1. */
function kineticistClassDoc(): Record<string, unknown> {
  return {
    _id: "ZuJDBnRwp0YQ9IoP",
    name: "Kineticist",
    type: "class",
    img: "icons/placeholder/feat.svg",
    system: {
      attacks: { advanced: 0, martial: 0, simple: 1, unarmed: 1 },
      defenses: { heavy: 0, light: 1, medium: 1, unarmored: 1 },
      hp: 8,
      keyAbility: ["con"],
      perception: 1,
      savingThrows: { fortitude: 2, reflex: 2, will: 1 },
      skillIncreaseLevels: [3, 5, 7, 9, 11, 13, 15, 17, 19],
      trainedSkills: { value: ["nature"], additional: 3 },
      traits: { rarity: "common", value: [] },
      classDC: 1,
      impulse: 1,
      featLevels: {
        ancestry: [1, 5, 9, 13, 17],
        class: [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
        general: [3, 7, 11, 15, 19],
        skill: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
      },
      proficiencyUpgrades: [],
      featuresByLevel: [
        { level: 1, uuid: "cYO6tM48V3dPIOrt", name: "Kinetic Aura" },
        { level: 1, uuid: "MJMyOpvG6rbLdvUk", name: "Kinetic Gate" },
        { level: 1, uuid: "HOwyGH93xrAKXT3Q", name: "Impulses" },
        { level: 3, uuid: "m9zzP0MZI5sIP1ia", name: "Will Expertise" },
      ],
    },
    flags: { fusion: { conversion: "partial" } },
  };
}

/** Magus class doc WITHOUT a Kinetic Gate feature (negative control). */
function magusClassDoc(): Record<string, unknown> {
  return {
    _id: "fk29yXFinPhreKL0",
    name: "Magus",
    type: "class",
    system: {
      hp: 8,
      keyAbility: ["dex", "str"],
      perception: 1,
      savingThrows: { fortitude: 2, reflex: 1, will: 2 },
      skillIncreaseLevels: [3, 5, 7],
      trainedSkills: { value: ["arcana"], additional: 2 },
      traits: { rarity: "common", value: [] },
      featLevels: { ancestry: [1], class: [2], general: [3], skill: [2] },
      featuresByLevel: [{ level: 1, uuid: "y", name: "Hybrid Study" }],
    },
    flags: { fusion: { conversion: "full" } },
  };
}

/** The vendor "Kinetic Gate" classFeature (class-features-core), pre-stamp. */
function kineticGateFeatureDoc(): Record<string, unknown> {
  return {
    _id: "MJMyOpvG6rbLdvUk",
    name: "Kinetic Gate",
    type: "classFeature",
    img: "icons/placeholder/feat.svg",
    system: {
      category: "classfeature",
      description: { value: "…" },
      level: 1,
      traits: { rarity: "common", value: ["kineticist"] },
      rules: [],
    },
    flags: { fusion: { conversion: "partial" } },
  };
}

/** Impulse feat factory: class category, `impulse` trait + one element trait. */
function impulseFeatDoc(name: string, element: string): FeatDocLike {
  return {
    system: {
      category: "class",
      level: 1,
      traits: { value: ["impulse", "kineticist", "primal", element] },
    },
  };
}

function actorDoc(
  classDoc: Record<string, unknown>,
  items: Array<Record<string, unknown>> = [],
): Record<string, unknown> {
  return {
    _id: "actor-finn",
    type: "character",
    system: { level: { value: 3 }, build: { choices: [] } },
    items: [{ ...classDoc, _id: "item-class" }, ...items],
  };
}

function ctx(doc: Record<string, unknown>, editable = true): PlanOpBuilderContext {
  return { actorId: "actor-finn", doc, editable };
}

// ---------------------------------------------------------------------------

describe("Kinetic Gate — slot presence", () => {
  it("classHasKineticGate is true for Kineticist, false for Magus", () => {
    expect(classHasKineticGate(kineticistClassDoc().system as unknown as ClassSystemLike)).toBe(true);
    expect(classHasKineticGate(magusClassDoc().system as unknown as ClassSystemLike)).toBe(false);
  });

  it("adds a level-1 kineticGate slot for a Kineticist actor", () => {
    const plan = derivePlan(actorDoc(kineticistClassDoc()));
    const level1 = plan.levels.find((l) => l.level === 1)!;
    const gate = level1.slots.find((s) => s.type === "kineticGate");
    expect(gate).toBeDefined();
    expect(gate!.slotId).toBe("kineticGate-1");
    expect(gate!.filled).toBe(false);
  });

  it("does NOT add a kineticGate slot for a non-kineticist class", () => {
    const plan = derivePlan(actorDoc(magusClassDoc()));
    const level1 = plan.levels.find((l) => l.level === 1)!;
    expect(level1.slots.some((s) => s.type === "kineticGate")).toBe(false);
  });

  it("marks the gate slot filled once the Kinetic Gate feature is embedded", () => {
    const gateItem = {
      ...kineticGateFeatureDoc(),
      _id: "item-gate",
      system: { ...(kineticGateFeatureDoc().system as object), kineticGates: [{ element: "air", damageType: "electricity" }] },
      flags: { fusion: { build: { level: 1, slot: "kineticGate-1" } } },
    };
    const plan = derivePlan(actorDoc(kineticistClassDoc(), [gateItem]));
    const gate = plan.levels.find((l) => l.level === 1)!.slots.find((s) => s.type === "kineticGate")!;
    expect(gate.filled).toBe(true);
    expect(gate.choiceName).toBe("Kinetic Gate");
  });

  it("does NOT render Kinetic Gate as a locked auto-feature chip (it's a choice slot)", () => {
    const plan = derivePlan(actorDoc(kineticistClassDoc()));
    const level1 = plan.levels.find((l) => l.level === 1)!;
    expect(level1.autoFeatures.some((f) => f.name === "Kinetic Gate")).toBe(false);
    // Kinetic Aura (a real auto feature) still shows.
    expect(level1.autoFeatures.some((f) => f.name === "Kinetic Aura")).toBe(true);
  });
});

describe("chooseKineticGate — op emission", () => {
  it("dual gate emits the classFeature with two kineticGates + a choices marker", () => {
    const doc = actorDoc(kineticistClassDoc());
    const ops = chooseKineticGate(ctx(doc), 1, kineticGateFeatureDoc(), [
      { element: "air", damageType: "electricity" },
      { element: "metal", damageType: "piercing" },
    ]);

    const createOp = ops.find((o) => o.type === "doc:create")!;
    if (createOp.type !== "doc:create") throw new Error("expected doc:create");
    const createWire = { documentType: createOp.documentType, data: [createOp.data], parent: createOp.parent };
    expect(DocCreatePayloadSchema.safeParse(createWire).success).toBe(true);
    const data = createOp.data;
    expect(data["type"]).toBe("classFeature");
    expect(data["name"]).toBe("Kinetic Gate");
    const sys = data["system"] as Record<string, unknown>;
    expect(sys["kineticGates"]).toEqual([
      { element: "air", damageType: "electricity" },
      { element: "metal", damageType: "piercing" },
    ]);
    // build flag stamped for slot resolution
    const flags = data["flags"] as { fusion?: { build?: unknown } };
    expect(flags.fusion?.build).toEqual({ level: 1, slot: "kineticGate-1" });
    // fresh id assigned by server (source _id stripped)
    expect(data["_id"]).toBeUndefined();

    const updateOp = ops.find((o) => o.type === "doc:update")!;
    if (updateOp.type !== "doc:update") throw new Error("expected doc:update");
    const updateWire = { documentType: updateOp.documentType, updates: [{ _id: updateOp.id, diff: updateOp.diff }] };
    expect(DocUpdatePayloadSchema.safeParse(updateWire).success).toBe(true);
    const choices = updateOp.diff["system.build.choices"] as Array<Record<string, unknown>>;
    expect(choices).toContainEqual({ level: 1, slot: "kineticGate-1", type: "kineticGate" });
  });

  it("single gate emits exactly one kineticGate", () => {
    const doc = actorDoc(kineticistClassDoc());
    const ops = chooseKineticGate(ctx(doc), 1, kineticGateFeatureDoc(), [
      { element: "fire", damageType: "fire" },
    ]);
    const data = (ops.find((o) => o.type === "doc:create") as { data: Record<string, unknown> }).data;
    const sys = data["system"] as Record<string, unknown>;
    expect(sys["kineticGates"]).toEqual([{ element: "fire", damageType: "fire" }]);
  });

  it("falls back to the element's first valid damage type when given an invalid one", () => {
    const doc = actorDoc(kineticistClassDoc());
    const ops = chooseKineticGate(ctx(doc), 1, kineticGateFeatureDoc(), [
      { element: "air", damageType: "cold" }, // cold is not valid for air
    ]);
    const data = (ops.find((o) => o.type === "doc:create") as { data: Record<string, unknown> }).data;
    const gates = (data["system"] as Record<string, unknown>)["kineticGates"] as Array<Record<string, unknown>>;
    expect(gates[0]!["damageType"]).toBe("electricity"); // first valid air option
  });

  it("drops picks with an unknown element", () => {
    const doc = actorDoc(kineticistClassDoc());
    const ops = chooseKineticGate(ctx(doc), 1, kineticGateFeatureDoc(), [
      { element: "air", damageType: "slashing" },
      { element: "plasma" as never, damageType: "fire" },
    ]);
    const data = (ops.find((o) => o.type === "doc:create") as { data: Record<string, unknown> }).data;
    const gates = (data["system"] as Record<string, unknown>)["kineticGates"] as Array<Record<string, unknown>>;
    expect(gates).toHaveLength(1);
    expect(gates[0]!["element"]).toBe("air");
  });

  it("returns no ops when not editable", () => {
    const doc = actorDoc(kineticistClassDoc());
    expect(chooseKineticGate(ctx(doc, false), 1, kineticGateFeatureDoc(), [{ element: "air" }])).toEqual([]);
  });
});

describe("readGateElements", () => {
  it("reads elements from the embedded Kinetic Gate feature", () => {
    const gateItem = {
      ...kineticGateFeatureDoc(),
      _id: "item-gate",
      system: {
        ...(kineticGateFeatureDoc().system as object),
        kineticGates: [
          { element: "air", damageType: "electricity" },
          { element: "metal", damageType: "piercing" },
        ],
      },
    };
    const doc = actorDoc(kineticistClassDoc(), [gateItem]);
    expect(readGateElements(doc)).toEqual(["air", "metal"]);
  });

  it("returns [] for a character with no gate chosen", () => {
    expect(readGateElements(actorDoc(kineticistClassDoc()))).toEqual([]);
  });

  it("ignores unknown element slugs", () => {
    const gateItem = {
      ...kineticGateFeatureDoc(),
      _id: "item-gate",
      system: { ...(kineticGateFeatureDoc().system as object), kineticGates: [{ element: "plasma" }, { element: "fire" }] },
    };
    expect(readGateElements(actorDoc(kineticistClassDoc(), [gateItem]))).toEqual(["fire"]);
  });
});

describe("impulse filter — isFeatEligible with gateElements", () => {
  const gates = ["air", "metal"] as const;

  it("allows an impulse of a gate element", () => {
    expect(isFeatEligible(impulseFeatDoc("Aerial Boomerang", "air"), "classFeat", 3, { classSlug: "kineticist", gateElements: gates })).toBe(true);
    expect(isFeatEligible(impulseFeatDoc("Magnetic Pinions", "metal"), "classFeat", 3, { classSlug: "kineticist", gateElements: gates })).toBe(true);
  });

  it("rejects an impulse of a non-gate element", () => {
    expect(isFeatEligible(impulseFeatDoc("Blazing Wave", "fire"), "classFeat", 3, { classSlug: "kineticist", gateElements: gates })).toBe(false);
    expect(isFeatEligible(impulseFeatDoc("Hardwood Palisade", "wood"), "classFeat", 3, { classSlug: "kineticist", gateElements: gates })).toBe(false);
  });

  it("does not gate impulses when the character has no gates (filter is opt-in)", () => {
    expect(isFeatEligible(impulseFeatDoc("Blazing Wave", "fire"), "classFeat", 3, { classSlug: "kineticist" })).toBe(true);
  });

  it("leaves non-impulse class feats unaffected by the element filter", () => {
    const nonImpulse: FeatDocLike = {
      system: { category: "class", level: 1, traits: { value: ["kineticist"] } },
    };
    expect(isFeatEligible(nonImpulse, "classFeat", 3, { classSlug: "kineticist", gateElements: gates })).toBe(true);
  });

  it("allows an impulse with no element trait (element-agnostic impulses)", () => {
    const agnostic: FeatDocLike = {
      system: { category: "class", level: 1, traits: { value: ["impulse", "kineticist"] } },
    };
    expect(isFeatEligible(agnostic, "classFeat", 3, { classSlug: "kineticist", gateElements: gates })).toBe(true);
  });
});

describe("damage-type table sync with the derivation", () => {
  // Mirror of ELEMENT_BLAST_TABLE in systems/pf2e/src/derivations/
  // elementalBlast.ts — this test is the tripwire if the two drift.
  const DERIVATION_TABLE: Record<string, string[]> = {
    air: ["electricity", "slashing"],
    earth: ["bludgeoning", "slashing"],
    fire: ["fire"],
    metal: ["piercing", "slashing"],
    water: ["bludgeoning", "cold"],
    wood: ["bludgeoning", "vitality"],
  };

  it("covers exactly the six elements", () => {
    expect([...KINETIC_ELEMENTS].sort()).toEqual(Object.keys(DERIVATION_TABLE).sort());
  });

  it("offers exactly the derivation's damage types per element", () => {
    for (const el of KINETIC_ELEMENTS) {
      expect(KINETIC_ELEMENT_DAMAGE_TYPES[el]).toEqual(DERIVATION_TABLE[el]);
    }
  });
});
