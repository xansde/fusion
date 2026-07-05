/**
 * @fusion/system-pf2e — Archetype (dedication) class-DC derivation tests
 * (W3 r12, DEC-R12-04).
 *
 * Covers stepCharArchetypeClassDCs:
 *   1. Alchemist Dedication → INT-based Trained class DC. Real Tobias case:
 *      level 3, INT 16 (+3) → 10 + 3 + proficiencyBonus(1, 3) = 10 + 3 + 5 = 18.
 *   2. Detection: only feats with category "class" AND trait "dedication"
 *      AND a subfeatures.proficiencies.<slug> block produce a row. Bare
 *      class feats and non-dedication class feats contribute nothing.
 *   3. Fallbacks: missing rank → Trained (1); missing attribute → the
 *      extensible ARCHETYPE_KEY_ABILITY map (alchemist → int).
 *   4. Robustness (r11 posture): malformed feats never throw; no dedications
 *      → empty array; runs safely inside the full pipeline (ledger partial).
 *
 * Clean-room: ORC/OGL mechanics only. No proprietary Paizo content.
 * REQ-PF2-016, DEC-R12-04.
 */

import { describe, it, expect } from "vitest";
import { emptySynthetics } from "@fusion/system-api";
import type { DeriveContext } from "@fusion/system-api";
import { pf2eSystem } from "../index.js";
import { stepCharAbilityMods, stepCharArchetypeClassDCs } from "../derivations/character.js";
import type { ArchetypeClassDC } from "../derivations/types.js";

function emptyCtx(): DeriveContext {
  return {
    system: pf2eSystem,
    synthetics: emptySynthetics(),
    rollOptions: new Set<string>(),
  };
}

/** Run ability mods (base) then the archetype-DC step (derived), in order. */
function runArchetypeSteps(doc: Record<string, unknown>): ArchetypeClassDC[] {
  stepCharAbilityMods.run(doc, emptyCtx());
  stepCharArchetypeClassDCs.run(doc, emptyCtx());
  const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<string, unknown>;
  return (derived["archetypeClassDCs"] as ArchetypeClassDC[] | undefined) ?? [];
}

/** Minimal level-N character doc with INT `intScore` and the given feat items. */
function makeDoc(
  intScore: number,
  level: number,
  feats: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    _id: "actor-tobias",
    type: "character",
    items: feats,
    system: {
      level: { value: level },
      abilities: {
        str: { value: 10 },
        dex: { value: 18 },
        con: { value: 10 },
        int: { value: intScore },
        wis: { value: 12 },
        cha: { value: 10 },
      },
    },
  };
}

function alchemistDedication(
  overrides: { subfeatures?: unknown; traits?: string[]; category?: string } = {},
): Record<string, unknown> {
  return {
    _id: "feat-alch-ded",
    name: "Alchemist Dedication",
    type: "feat",
    system: {
      category: overrides.category ?? "class",
      level: 2,
      traits: { rarity: "common", value: overrides.traits ?? ["archetype", "dedication", "multiclass"] },
      subfeatures:
        "subfeatures" in overrides
          ? overrides.subfeatures
          : { proficiencies: { alchemist: { attribute: "int", rank: 1 } } },
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Real Tobias case — Alchemist Dedication → DC 18
// ---------------------------------------------------------------------------

describe("stepCharArchetypeClassDCs — Alchemist Dedication (Tobias: INT +3, level 3)", () => {
  it("derives an INT-based Trained class DC of 18", () => {
    const doc = makeDoc(16, 3, [alchemistDedication()]);
    const result = runArchetypeSteps(doc);

    expect(result).toHaveLength(1);
    const alch = result[0]!;
    expect(alch.slug).toBe("alchemist");
    expect(alch.label).toBe("Alchemist");
    expect(alch.ability).toBe("int");
    expect(alch.rank).toBe(1);
    // total = INT mod (+3) + proficiencyBonus(1, 3) = 3 + 5 = 8; dc = 18.
    expect(alch.total).toBe(8);
    expect(alch.dc).toBe(18);
  });

  it("scales with level and INT (level 5, INT 18 → +4)", () => {
    const doc = makeDoc(18, 5, [alchemistDedication()]);
    const result = runArchetypeSteps(doc);
    // total = 4 + proficiencyBonus(1, 5) = 4 + 7 = 11; dc = 21.
    expect(result[0]!.dc).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// 2. Detection rules
// ---------------------------------------------------------------------------

describe("stepCharArchetypeClassDCs — detection", () => {
  it("ignores class feats without the 'dedication' trait", () => {
    const magusAnalysis = {
      _id: "feat-magus-analysis",
      name: "Magus's Analysis",
      type: "feat",
      system: { category: "class", level: 1, traits: { rarity: "common", value: ["magus"] } },
    };
    const doc = makeDoc(16, 3, [magusAnalysis]);
    expect(runArchetypeSteps(doc)).toEqual([]);
  });

  it("ignores dedications that grant no class-DC subfeature (bare archetype feats)", () => {
    // A dedication-trait feat WITHOUT subfeatures.proficiencies contributes
    // nothing — not every dedication grants a class DC.
    const basicConcoction = {
      _id: "feat-basic-concoction",
      name: "Basic Concoction",
      type: "feat",
      system: {
        category: "class",
        level: 4,
        traits: { rarity: "common", value: ["archetype"] },
      },
    };
    const doc = makeDoc(16, 3, [basicConcoction]);
    expect(runArchetypeSteps(doc)).toEqual([]);
  });

  it("returns an empty array when there are no dedication feats at all", () => {
    const doc = makeDoc(16, 3, []);
    expect(runArchetypeSteps(doc)).toEqual([]);
  });

  it("deduplicates by slug when the same dedication appears twice", () => {
    const doc = makeDoc(16, 3, [alchemistDedication(), alchemistDedication()]);
    const result = runArchetypeSteps(doc);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Fallbacks (missing rank / attribute)
// ---------------------------------------------------------------------------

describe("stepCharArchetypeClassDCs — fallbacks", () => {
  it("defaults rank to Trained (1) when the subfeature omits it", () => {
    const doc = makeDoc(16, 3, [
      alchemistDedication({ subfeatures: { proficiencies: { alchemist: { attribute: "int" } } } }),
    ]);
    const result = runArchetypeSteps(doc);
    expect(result[0]!.rank).toBe(1);
    expect(result[0]!.dc).toBe(18);
  });

  it("falls back to ARCHETYPE_KEY_ABILITY when the subfeature omits attribute", () => {
    const doc = makeDoc(16, 3, [
      alchemistDedication({ subfeatures: { proficiencies: { alchemist: { rank: 1 } } } }),
    ]);
    const result = runArchetypeSteps(doc);
    expect(result[0]!.ability).toBe("int"); // from the map
    expect(result[0]!.dc).toBe(18);
  });

  it("skips a dedication whose slug is unknown and carries no attribute", () => {
    const doc = makeDoc(16, 3, [
      {
        _id: "feat-unknown-ded",
        name: "Mystery Dedication",
        type: "feat",
        system: {
          category: "class",
          level: 2,
          traits: { rarity: "common", value: ["archetype", "dedication"] },
          subfeatures: { proficiencies: { "mystery-archetype": { rank: 1 } } },
        },
      },
    ]);
    // Unknown slug + no attribute → cannot derive a key ability → skipped.
    expect(runArchetypeSteps(doc)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Robustness (r11 posture) + full pipeline
// ---------------------------------------------------------------------------

describe("stepCharArchetypeClassDCs — robustness", () => {
  it("does not throw on a malformed feat (subfeatures not an object)", () => {
    const doc = makeDoc(16, 3, [
      alchemistDedication({ subfeatures: "not-an-object" }),
      {
        _id: "feat-broken",
        name: "Broken",
        type: "feat",
        system: { category: "class", traits: { value: ["dedication"] }, subfeatures: null },
      },
    ]);
    expect(() => runArchetypeSteps(doc)).not.toThrow();
    // The string-subfeatures Alchemist Dedication yields no proficiency block
    // → no row; the null-subfeatures feat is skipped too.
    expect(runArchetypeSteps(doc)).toEqual([]);
  });

  it("writes archetypeClassDCs when run through the full character pipeline", () => {
    const doc = makeDoc(16, 3, [alchemistDedication()]);
    const baseSteps = pf2eSystem.deriveSteps.sortedForPhase("base", "Actor", "character");
    for (const step of baseSteps) step.run(doc, emptyCtx());
    const derivedSteps = pf2eSystem.deriveSteps.sortedForPhase("derived", "Actor", "character");
    for (const step of derivedSteps) step.run(doc, emptyCtx());

    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const dcs = derived["archetypeClassDCs"] as ArchetypeClassDC[];
    expect(dcs).toHaveLength(1);
    expect(dcs[0]!.dc).toBe(18);
    // The base classDC (Magus-less here) is unaffected — separate field.
    expect(derived["classDC"]).toBeDefined();
  });
});
