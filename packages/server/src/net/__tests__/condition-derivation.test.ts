/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
/**
 * Conditions through the real derivation pipeline (etapa 3a): what the sheet shows after a
 * condition is applied. Expectations are PF2e remaster rules, not the pack's table.
 */
import { describe, it, expect } from "vitest";
import { pf2eSystem } from "@fusion/system-pf2e";
import { runActorDerivation } from "../derive-runner.js";

function fighter(held: Array<{ slug: string; value?: number }>): Record<string, unknown> {
  return {
    type: "character",
    system: {
      systemVersion: "0.1.0",
      level: { value: 5 },
      abilities: {
        str: { value: 18, mod: 0 },
        dex: { value: 16, mod: 0 },
        con: { value: 14, mod: 0 },
        int: { value: 10, mod: 0 },
        wis: { value: 12, mod: 0 },
        cha: { value: 8, mod: 0 },
      },
      attributes: {
        hp: { value: 75, max: 75, temp: 0 },
        ac: { value: 10 },
        speed: { value: 25, otherSpeeds: [] },
        dying: { value: 0, max: 4 },
        wounded: { value: 0 },
        doomed: { value: 0 },
        iwr: { immunities: [], weaknesses: [], resistances: [] },
      },
      saves: {
        fortitude: { rank: 2 },
        reflex: { rank: 1 },
        will: { rank: 2 },
      },
      perception: { rank: 2, senses: [] },
      skills: {
        athletics: { rank: 2 },
        acrobatics: { rank: 1 },
        stealth: { rank: 0 },
      },
      proficiencies: {
        classDC: { rank: 2 },
        weapons: { unarmed: 1, simple: 1, martial: 2, advanced: 0 },
        armor: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
      },
      resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
      details: { keyAbility: "str", level: 5 },
      traits: { rarity: "common", value: [], size: "med" },
    },
    items: held.map((h) => ({
      type: "condition",
      name: h.slug,
      system: { slug: h.slug, ...(h.value !== undefined ? { value: h.value } : {}) },
    })),
  };
}

type Derived = Record<string, any>;
function derive(held: Array<{ slug: string; value?: number }>): Derived {
  const doc = fighter(held);
  expect(runActorDerivation(doc, pf2eSystem)).toBe(true);
  return (doc["system"] as Record<string, any>)["derived"] as Derived;
}

// Unarmored baseline of this fighter: AC 20 (10 + Dex 3 + proficiency 7), level 5, HP 75.
describe("conditions through the derivation pipeline", () => {
  it("drained 2 lowers max HP by level x 2 and Fortitude by 2", () => {
    const base = derive([]);
    const drained = derive([{ slug: "drained", value: 2 }]);
    expect(drained.hp.max).toBe(75 - 5 * 2);
    expect(drained.hp.drainedHpReduction).toBe(10);
    expect(drained.saves.fortitude.total).toBe(base.saves.fortitude.total - 2);
  });

  it("prone: off-guard (-2 AC)", () => {
    expect(derive([{ slug: "prone" }]).ac.total).toBe(18);
  });

  it("grabbed: off-guard (-2 AC), and the implied condition leaves with its source", () => {
    expect(derive([{ slug: "grabbed" }]).ac.total).toBe(18);
    expect(derive([]).ac.total).toBe(20);
  });

  it("a hand-applied off-guard together with grabbed is still -2, not -4", () => {
    expect(derive([{ slug: "grabbed" }, { slug: "off-guard" }]).ac.total).toBe(18);
  });

  it("blinded does not touch AC, only Perception (-4)", () => {
    const base = derive([]);
    const blind = derive([{ slug: "blinded" }]);
    expect(blind.ac.total).toBe(20);
    expect(blind.perception.total).toBe(base.perception.total - 4);
  });

  it("deafened: -2 to initiative", () => {
    const deaf = derive([{ slug: "deafened" }]);
    const base = derive([]);
    const baseInit = base.initiative?.total ?? base.perception.total;
    expect(deaf.initiative.total).toBe(baseInit - 2);
  });

  it("doomed 1 brings the maximum dying value down to 3", () => {
    expect(derive([{ slug: "doomed", value: 1 }]).dyingMax).toBe(3);
  });
});

describe("NPCs take the same implications (generic fallback materializer)", () => {
  function npcAc(held: Array<{ slug: string; value?: number }>): number {
    const doc: Record<string, unknown> = {
      type: "npc",
      system: { attributes: { ac: { value: 20 }, hp: { value: 10, max: 10 } } },
      items: held.map((h) => ({ type: "condition", name: h.slug, system: { slug: h.slug } })),
    };
    expect(runActorDerivation(doc, pf2eSystem)).toBe(true);
    const derived = (doc["system"] as Record<string, any>)["derived"] as Derived;
    return derived.ac.total ?? derived.ac.value;
  }
  it("grabbed makes an NPC off-guard: -2 AC", () => {
    expect(npcAc([{ slug: "grabbed" }])).toBe(npcAc([]) - 2);
  });
  it("a hand-applied off-guard with grabbed is still -2", () => {
    expect(npcAc([{ slug: "grabbed" }, { slug: "off-guard" }])).toBe(npcAc([]) - 2);
  });
});
