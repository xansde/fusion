/**
 * traitGroups.test.ts — Unit tests for the trait filter grouping (W2-F).
 *
 * Two layers:
 *   1. Pure unit tests against TRAIT_GROUPS/groupTraits with small synthetic
 *      inputs — the standard headless VM-test shape used across
 *      lib/sheets/pf2e (mirrors characterSheetVM.test.ts/planVM.test.ts).
 *   2. A live coverage check against the real compendium packs
 *      (systems/pf2e/packs/{spells-core,feats-core,class-features-core}) —
 *      guards against future pack imports introducing new traits that
 *      silently fall into "Outros"/"Other" past the agreed <10% budget.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TRAIT_GROUPS, GROUP_OTHER_KEY, groupTraits } from "../traitGroups.js";

// ---------------------------------------------------------------------------
// Part 1 — Pure unit tests
// ---------------------------------------------------------------------------

describe("TRAIT_GROUPS map integrity", () => {
  it("has no trait duplicated across two different groups", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [groupKey, def] of TRAIT_GROUPS) {
      for (const trait of def.traits) {
        const owner = seen.get(trait);
        if (owner && owner !== groupKey) {
          duplicates.push(`${trait} (${owner} vs ${groupKey})`);
        }
        seen.set(trait, groupKey);
      }
    }
    expect(duplicates, `Traits in multiple groups: ${duplicates.join(", ")}`).toHaveLength(0);
  });

  it("no group key collides with the reserved GROUP_OTHER_KEY", () => {
    const keys = TRAIT_GROUPS.map(([key]) => key);
    expect(keys).not.toContain(GROUP_OTHER_KEY);
  });

  it("every group has at least one trait and a labelKey", () => {
    for (const [key, def] of TRAIT_GROUPS) {
      expect(def.traits.length, `group ${key} is empty`).toBeGreaterThan(0);
      expect(def.labelKey, `group ${key} has no labelKey`).toMatch(/^FUSION\.Sheet\.TraitGroups\./);
    }
  });
});

describe("groupTraits()", () => {
  it("buckets known traits into their curated groups, alphabetized within group", () => {
    const result = groupTraits(["fire", "acid", "mental", "wizard"]);
    const damage = result.find((g) => g.key === "damageEnergy");
    const mental = result.find((g) => g.key === "mentalEffect");
    const cls = result.find((g) => g.key === "classTrait");

    expect(damage?.traits).toEqual(["acid", "fire"]);
    expect(mental?.traits).toEqual(["mental"]);
    expect(cls?.traits).toEqual(["wizard"]);
  });

  it("preserves the curated group order (rarity/affinity before traditions before class)", () => {
    const result = groupTraits(["wizard", "arcane", "mythic"]);
    const order = result.map((g) => g.key);
    expect(order.indexOf("rarityAffinity")).toBeLessThan(order.indexOf("traditions"));
    expect(order.indexOf("traditions")).toBeLessThan(order.indexOf("classTrait"));
  });

  it("omits groups with no matching trait in the input", () => {
    const result = groupTraits(["fire"]);
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe("damageEnergy");
  });

  it("routes unknown traits to the terminal Outros/Other group", () => {
    const result = groupTraits(["fire", "totally-unknown-trait"]);
    const other = result.at(-1);
    expect(other?.key).toBe(GROUP_OTHER_KEY);
    expect(other?.labelKey).toBe("FUSION.Sheet.TraitGroups.Other");
    expect(other?.traits).toEqual(["totally-unknown-trait"]);
  });

  it("Other always sorts last even if curated groups come after it alphabetically", () => {
    // "archetypeTrait" is the very last curated group; an unknown trait must
    // still land after it.
    const result = groupTraits(["archetype", "unknown-xyz"]);
    expect(result.at(-1)?.key).toBe(GROUP_OTHER_KEY);
  });

  it("de-duplicates repeated input traits", () => {
    const result = groupTraits(["fire", "fire", "fire"]);
    expect(result[0]?.traits).toEqual(["fire"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupTraits([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — Live coverage against the real compendium packs
// ---------------------------------------------------------------------------

describe("Live pack coverage (spells-core, feats-core, class-features-core)", () => {
  function loadPackTraits(packRelativePath: string): string[] {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const absPath = path.resolve(here, "../../../../../../../systems/pf2e/packs", packRelativePath);
    const docs = JSON.parse(readFileSync(absPath, "utf8")) as Array<{
      system?: { traits?: { value?: unknown } };
    }>;
    const traits: string[] = [];
    for (const doc of docs) {
      const raw = doc.system?.traits?.value;
      if (Array.isArray(raw)) {
        for (const t of raw) if (typeof t === "string") traits.push(t);
      }
    }
    return traits;
  }

  it("classifies at least 90% of the real distinct traits (budget agreed in W2-F)", () => {
    const packs = ["spells-core", "feats-core", "class-features-core"];
    const distinct = new Set<string>();
    for (const pack of packs) {
      for (const t of loadPackTraits(`${pack}/documents.json`)) distinct.add(t);
    }

    expect(distinct.size, "expected the packs to expose a non-trivial trait vocabulary").toBeGreaterThan(50);

    const grouped = groupTraits([...distinct]);
    const other = grouped.find((g) => g.key === GROUP_OTHER_KEY);
    const otherCount = other?.traits.length ?? 0;
    const otherRatio = otherCount / distinct.size;

    expect(
      otherRatio,
      `Other bucket too large: ${otherCount}/${distinct.size} (${(otherRatio * 100).toFixed(1)}%) — traits: ${other?.traits.join(", ")}`,
    ).toBeLessThan(0.1);
  });
});
