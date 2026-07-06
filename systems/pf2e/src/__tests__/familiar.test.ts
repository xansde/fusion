/**
 * @fusion/system-pf2e — Familiar schema + derivation tests.
 *
 * Covers the MVP acceptance fixture from the r16-G4 brief: Tobias (Ratfolk
 * Magus 3) with the Rat Familiar feat (`familiarAbilities +2` → budget 4).
 * A level-3 master must yield HP 15 and a 4-ability budget on his familiar.
 *
 * REQ-PET-001..004, REQ-PET-006, REQ-PET-007.
 */

import { describe, it, expect } from "vitest";
import { FamiliarSystemSchema, parseFamiliarSystem } from "../schemas/actor-familiar.js";
import { stepFamiliarDerived } from "../derivations/familiar.js";
import { emptySynthetics } from "@fusion/system-api";
import type { DeriveContext } from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("FamiliarSystemSchema", () => {
  it("accepts a minimal familiar and applies defaults", () => {
    const parsed = parseFamiliarSystem({ masterActorId: "abc0123456789def" });
    expect(parsed.companionKind).toBe("familiar");
    expect(parsed.masterActorId).toBe("abc0123456789def");
    expect(parsed.abilitiesBudget.max).toBe(2);
    expect(parsed.selectedAbilities).toEqual([]);
    expect(parsed.attributes.speed.value).toBe(25);
    expect(parsed.traits.size).toBe("tiny");
    expect(parsed.progression.stage).toBe("young");
  });

  it("accepts every companionKind in the enum", () => {
    for (const kind of ["familiar", "pet", "animalCompanion", "mount"] as const) {
      const parsed = parseFamiliarSystem({ companionKind: kind, masterActorId: null });
      expect(parsed.companionKind).toBe(kind);
    }
  });

  it("rejects an unknown companionKind", () => {
    const result = FamiliarSystemSchema.safeParse({ companionKind: "dragon" });
    expect(result.success).toBe(false);
  });

  it("accepts a null master (orphan) — surfaced by the UI, not rejected", () => {
    const parsed = parseFamiliarSystem({ masterActorId: null });
    expect(parsed.masterActorId).toBeNull();
  });

  it("passes through unknown fields (REQ-PF2-204)", () => {
    const parsed = parseFamiliarSystem({ masterActorId: null, derived: { hp: { max: 15 } } });
    expect((parsed as Record<string, unknown>)["derived"]).toEqual({ hp: { max: 15 } });
  });

  it("carries the Rat Familiar 4-ability budget when authored", () => {
    const parsed = parseFamiliarSystem({
      masterActorId: "abc0123456789def",
      abilitiesBudget: { value: 4, max: 4 },
      selectedAbilities: ["darkvision", "flier", "climber", "scent"],
    });
    expect(parsed.abilitiesBudget.max).toBe(4);
    expect(parsed.selectedAbilities).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Build a familiar Actor doc around a system blob for the derive step. */
function familiarDoc(system: Record<string, unknown>): Record<string, unknown> {
  return { _id: "fam0000000000000", type: "familiar", name: "Pickpocket", system };
}

const ctx: DeriveContext = {
  // The familiar step is pure over the doc; synthetics/rollOptions are unused.
  system: undefined as never,
  synthetics: emptySynthetics(),
  rollOptions: new Set<string>(),
};

describe("stepFamiliarDerived", () => {
  it("derives HP = 5 × master level for Tobias's level-3 familiar (→ 15)", () => {
    const doc = familiarDoc(
      parseFamiliarSystem({
        companionKind: "familiar",
        masterActorId: "tob0123456789abc",
        master: {
          level: 3,
          abilityMod: 4,
          ac: 19,
          saves: { fortitude: 8, reflex: 10, will: 7 },
          perception: 9,
          name: "Tobias",
        },
        abilitiesBudget: { value: 4, max: 4 },
      }) as unknown as Record<string, unknown>,
    );

    stepFamiliarDerived.run(doc, ctx);
    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      { total?: number; max?: number; value?: number }
    >;

    expect((derived["hp"] as { max: number }).max).toBe(15);
  });

  it("mirrors the master's AC / saves / perception onto the familiar", () => {
    const doc = familiarDoc(
      parseFamiliarSystem({
        companionKind: "familiar",
        masterActorId: "tob0123456789abc",
        master: {
          level: 3,
          abilityMod: 4,
          ac: 19,
          saves: { fortitude: 8, reflex: 10, will: 7 },
          perception: 9,
        },
      }) as unknown as Record<string, unknown>,
    );

    stepFamiliarDerived.run(doc, ctx);
    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;

    expect((derived["ac"] as { total: number }).total).toBe(19);
    const saves = derived["saves"] as Record<string, { total: number }>;
    expect(saves["fortitude"].total).toBe(8);
    expect(saves["reflex"].total).toBe(10);
    expect(saves["will"].total).toBe(7);
    expect((derived["perception"] as { total: number }).total).toBe(9);
  });

  it("keys attack + trained skills off master level + ability mod", () => {
    const doc = familiarDoc(
      parseFamiliarSystem({
        companionKind: "familiar",
        masterActorId: "tob0123456789abc",
        master: { level: 3, abilityMod: 4, ac: 19, perception: 9 },
      }) as unknown as Record<string, unknown>,
    );

    stepFamiliarDerived.run(doc, ctx);
    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;

    // 3 (level) + 4 (spellcasting ability mod) = 7
    expect((derived["attack"] as { total: number }).total).toBe(7);
    const skills = derived["skills"] as Record<string, { total: number }>;
    expect(skills["acrobatics"].total).toBe(7);
    expect(skills["stealth"].total).toBe(7);
  });

  it("defaults speed to 25 ft and carries other speeds through", () => {
    const doc = familiarDoc(
      parseFamiliarSystem({
        companionKind: "familiar",
        masterActorId: "tob0123456789abc",
        master: { level: 3, abilityMod: 4 },
        attributes: { speed: { value: 25, otherSpeeds: [{ type: "fly", value: 25 }] } },
      }) as unknown as Record<string, unknown>,
    );

    stepFamiliarDerived.run(doc, ctx);
    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const speed = derived["speed"] as { value: number; otherSpeeds: unknown[] };
    expect(speed.value).toBe(25);
    expect(speed.otherSpeeds).toEqual([{ type: "fly", value: 25 }]);
  });

  it("clamps current HP to the derived max after a master level-down", () => {
    const doc = familiarDoc(
      parseFamiliarSystem({
        companionKind: "familiar",
        masterActorId: "tob0123456789abc",
        master: { level: 2 }, // 5×2 = 10 max
        attributes: { hp: { value: 15, max: 15 } }, // stale higher value
      }) as unknown as Record<string, unknown>,
    );

    stepFamiliarDerived.run(doc, ctx);
    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      { max: number; value: number }
    >;
    expect(derived["hp"].max).toBe(10);
    expect(derived["hp"].value).toBe(10);
  });

  it("does not mirror the master for animalCompanion (V2 kind)", () => {
    const doc = familiarDoc(
      parseFamiliarSystem({
        companionKind: "animalCompanion",
        masterActorId: "tob0123456789abc",
        master: { level: 3, ac: 19 },
        attributes: { hp: { value: 20, max: 20 }, ac: { value: 16 } },
      }) as unknown as Record<string, unknown>,
    );

    stepFamiliarDerived.run(doc, ctx);
    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    // Uses the authored statblock AC (16), NOT the master's 19.
    expect((derived["ac"] as { total: number }).total).toBe(16);
    expect((derived["hp"] as { max: number }).max).toBe(20);
  });
});
