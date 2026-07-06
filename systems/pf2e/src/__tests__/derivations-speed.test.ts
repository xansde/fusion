/**
 * @fusion/system-pf2e — Speed derivation tests (r16-G1).
 *
 * User report: "Fleet não está concedendo bônus de movimentação." A Ratfolk
 * (base land speed 25) with the Fleet feat embedded (system.rules =
 * [{kind:"flat-modifier", selector:"land-speed", value:5, mode:"add",
 * type:"untyped"}]) should show 30, not 25 — the derive pipeline never
 * consumed embedded-item FlatModifiers for speed before this fix.
 *
 * REQ-PF2-012.
 */

import { describe, it, expect } from "vitest";
import type { DeriveContext } from "@fusion/system-api";
import { emptySynthetics } from "@fusion/system-api";
import { pf2eSystem } from "../index.js";

function emptyCtx(): DeriveContext {
  return {
    system: pf2eSystem,
    synthetics: emptySynthetics(),
    rollOptions: new Set<string>(),
  };
}

/** Run all "base" + "derived" phase character steps in topological order. */
function runCharacterPipeline(doc: Record<string, unknown>): void {
  const baseSteps = pf2eSystem.deriveSteps.sortedForPhase("base", "Actor", "character");
  for (const step of baseSteps) step.run(doc, emptyCtx());

  const derivedSteps = pf2eSystem.deriveSteps.sortedForPhase("derived", "Actor", "character");
  for (const step of derivedSteps) step.run(doc, emptyCtx());
}

/** Minimal Tobias-like Ratfolk character doc: base land speed 25. */
function makeRatfolkDoc(items: Record<string, unknown>[] = []): Record<string, unknown> {
  return {
    system: {
      systemVersion: "0.1.0",
      level: { value: 1 },
      abilities: {
        str: { value: 10, mod: 0 },
        dex: { value: 14, mod: 0 },
        con: { value: 12, mod: 0 },
        int: { value: 10, mod: 0 },
        wis: { value: 10, mod: 0 },
        cha: { value: 10, mod: 0 },
      },
      attributes: {
        hp: { value: 8, max: 8, temp: 0 },
        doomed: { value: 0 },
      },
      speed: { value: 25, otherSpeeds: [] },
      saves: { fortitude: { rank: 0 }, reflex: { rank: 0 }, will: { rank: 0 } },
      perception: { rank: 0, senses: [] },
      skills: {},
      proficiencies: {
        classDC: { rank: 0 },
        weapons: { unarmed: 0, simple: 0, martial: 0, advanced: 0 },
        armor: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
      },
      resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
      details: { keyAbility: "str", level: 1 },
      traits: { rarity: "common", value: [], size: "sm" },
    } as Record<string, unknown>,
    items,
  };
}

/** Fleet's real on-disk pack shape (feats-core/documents.json, verified live). */
const FLEET_ITEM: Record<string, unknown> = {
  _id: "0HnNSd6e9uxkh1zh",
  name: "Fleet",
  type: "feat",
  system: {
    actionType: "passive",
    category: "general",
    level: 1,
    rules: [
      {
        kind: "flat-modifier",
        slug: null,
        label: null,
        selector: "land-speed",
        value: 5,
        mode: "add",
        type: "untyped",
        predicate: null,
        priority: null,
        raw: { key: "FlatModifier", selector: "land-speed", value: 5 },
      },
    ],
    traits: { rarity: "common", value: ["general"] },
  },
};

describe("stepCharSpeed (r16-G1 — Fleet +5 land speed)", () => {
  it("Ratfolk WITHOUT Fleet: derived speed stays at base 25", () => {
    const doc = makeRatfolkDoc([]);
    runCharacterPipeline(doc);

    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const speed = derived["speed"] as { value: number; base: number };
    expect(speed.base).toBe(25);
    expect(speed.value).toBe(25);
  });

  it("Ratfolk WITH Fleet: derived speed becomes 30 (25 base + 5 untyped)", () => {
    const doc = makeRatfolkDoc([FLEET_ITEM]);
    runCharacterPipeline(doc);

    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const speed = derived["speed"] as {
      value: number;
      base: number;
      modifiers: { slug: string; label: string; type: string; value: number }[];
    };
    expect(speed.base).toBe(25);
    expect(speed.value).toBe(30);
    expect(speed.modifiers).toHaveLength(1);
    expect(speed.modifiers[0]).toMatchObject({ label: "Fleet", type: "untyped", value: 5 });
  });

  it("two untyped Speed feats SUM only up to the stacking rule (untyped bonuses: highest-only, PF2e RAW)", () => {
    // Two independent +5 untyped land-speed FlatModifiers — PF2e RAW says
    // untyped BONUSES don't stack (highest wins), unlike untyped penalties
    // (MAP, range) which are additive. This mirrors PF2E_STACKING_TABLE
    // already used by stepCharAc/stepCharSaves (modifierStacking.ts).
    const secondFeat: Record<string, unknown> = {
      _id: "second-speed-feat",
      name: "Second Speed Feat",
      type: "feat",
      system: {
        category: "general",
        level: 1,
        rules: [
          {
            kind: "flat-modifier",
            selector: "land-speed",
            value: 5,
            mode: "add",
            type: "untyped",
          },
        ],
      },
    };
    const doc = makeRatfolkDoc([FLEET_ITEM, secondFeat]);
    runCharacterPipeline(doc);

    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const speed = derived["speed"] as { value: number };
    // Highest-only: both are +5 untyped, so only one +5 applies (RAW).
    expect(speed.value).toBe(30);
  });

  it("two DIFFERENT-typed Speed bonuses (status vs untyped) DO sum", () => {
    const statusFeat: Record<string, unknown> = {
      _id: "status-speed-item",
      name: "Status Speed Item",
      type: "heritage",
      system: {
        rules: [
          {
            kind: "flat-modifier",
            selector: "land-speed",
            value: 5,
            mode: "add",
            type: "status",
          },
        ],
      },
    };
    const doc = makeRatfolkDoc([FLEET_ITEM, statusFeat]);
    runCharacterPipeline(doc);

    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const speed = derived["speed"] as { value: number };
    // untyped +5 (Fleet) + status +5 (different type) → both apply: 25+5+5=35.
    expect(speed.value).toBe(35);
  });

  it("two SAME-typed (status) Speed bonuses do NOT stack — only the highest applies", () => {
    const statusFeatLow: Record<string, unknown> = {
      _id: "status-speed-low",
      name: "Status Speed Low",
      type: "heritage",
      system: {
        rules: [{ kind: "flat-modifier", selector: "land-speed", value: 5, type: "status" }],
      },
    };
    const statusFeatHigh: Record<string, unknown> = {
      _id: "status-speed-high",
      name: "Status Speed High",
      type: "classFeature",
      system: {
        rules: [{ kind: "flat-modifier", selector: "land-speed", value: 10, type: "status" }],
      },
    };
    const doc = makeRatfolkDoc([statusFeatLow, statusFeatHigh]);
    runCharacterPipeline(doc);

    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const speed = derived["speed"] as { value: number };
    // Same type (status): highest-only → +10, not +15. 25 + 10 = 35.
    expect(speed.value).toBe(35);
  });

  it("broad 'speed' selector also applies (not just the specific 'land-speed')", () => {
    const broadFeat: Record<string, unknown> = {
      _id: "broad-speed-feat",
      name: "Broad Speed Feat",
      type: "feat",
      system: {
        rules: [{ kind: "flat-modifier", selector: "speed", value: 5, type: "untyped" }],
      },
    };
    const doc = makeRatfolkDoc([broadFeat]);
    runCharacterPipeline(doc);

    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const speed = derived["speed"] as { value: number };
    expect(speed.value).toBe(30);
  });

  it("otherSpeeds pass through unmodified", () => {
    const doc = makeRatfolkDoc([FLEET_ITEM]);
    (doc["system"] as Record<string, unknown>)["speed"] = {
      value: 25,
      otherSpeeds: [{ type: "swim", value: 10 }],
    };
    runCharacterPipeline(doc);

    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const speed = derived["speed"] as { otherSpeeds: { type: string; value: number }[] };
    expect(speed.otherSpeeds).toEqual([{ type: "swim", value: 10 }]);
  });

  it("malformed item (rules not an array) degrades to no modifier, does not throw", () => {
    const malformed: Record<string, unknown> = {
      _id: "malformed-1",
      name: "Malformed Feat",
      type: "feat",
      system: { rules: "not-an-array" },
    };
    const doc = makeRatfolkDoc([malformed]);
    expect(() => runCharacterPipeline(doc)).not.toThrow();

    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const speed = derived["speed"] as { value: number };
    expect(speed.value).toBe(25);
  });

  it("missing system.speed entirely degrades to base 0, does not throw", () => {
    const doc = makeRatfolkDoc([]);
    delete (doc["system"] as Record<string, unknown>)["speed"];
    expect(() => runCharacterPipeline(doc)).not.toThrow();

    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const speed = derived["speed"] as { value: number; base: number };
    expect(speed.base).toBe(0);
    expect(speed.value).toBe(0);
  });
});
