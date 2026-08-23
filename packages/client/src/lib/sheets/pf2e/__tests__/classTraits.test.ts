/**
 * Class-trait leak gate (r29).
 *
 * `isFeatEligible` decides whether a feat may fill a `classFeat` slot. A feat
 * tagged for ANOTHER class must be rejected; a SHARED class feat (no class
 * trait at all) must stay eligible. Both rules hinge on one lookup table —
 * `KNOWN_CLASS_TRAITS` — and that table is a hand-maintained list of slugs.
 *
 * The failure mode this file exists for: when a class is imported into the
 * packs but its slug is never added to that table, its feats stop "looking
 * class-tagged" and silently become eligible for EVERY class. That is not a
 * hypothetical — the r29 class survey found the Psychic in exactly that state
 * (44 feats leaking into every other class's picker), months after the class
 * was merged, because nothing compared the table against the packs.
 *
 * So the gate here is deliberately NOT a copy of the table (that would be
 * circular — it would pass no matter which slugs are missing). It derives the
 * class slugs from `classes-core`, the pack the importer generates, and asserts
 * the BEHAVIOUR: a feat of class A is never eligible for class B. A class
 * imported without wiring its trait fails this test on the next run.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { isFeatEligible } from "../planVM.js";

const PACKS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "systems",
  "pf2e",
  "packs",
);

type PackDoc = {
  name?: string;
  system?: {
    category?: string;
    level?: number;
    traits?: { value?: string[] };
  };
};

function readPack(slug: string): PackDoc[] {
  return JSON.parse(readFileSync(join(PACKS, slug, "documents.json"), "utf8")) as PackDoc[];
}

/**
 * Class slugs as the PACK sees them — every curated class document's name,
 * lowercased (every PF2e class name is a single word, so this is the same
 * string the feats carry as a trait). Independent of the lookup table under
 * test, which is the whole point.
 */
const CLASS_SLUGS: string[] = readPack("classes-core")
  .map((d) => (d.name ?? "").toLowerCase())
  .filter((s) => s.length > 0)
  .sort();

/** Class feats that are not archetype feats — the population the slot draws from. */
const CLASS_FEATS: PackDoc[] = readPack("feats-core").filter(
  (d) => d.system?.category === "class" && !(d.system?.traits?.value ?? []).includes("archetype"),
);

const LEVEL_20 = 20;

describe("class feat eligibility does not leak across classes", () => {
  it("the packs actually carry curated classes and their feats (guards against a vacuous pass)", () => {
    expect(CLASS_SLUGS.length).toBeGreaterThanOrEqual(15);
    expect(CLASS_FEATS.length).toBeGreaterThan(1000);
  });

  it("a feat tagged for one curated class is never eligible for a different class", () => {
    const leaks: string[] = [];

    for (const feat of CLASS_FEATS) {
      const traits = feat.system?.traits?.value ?? [];
      const owners = CLASS_SLUGS.filter((slug) => traits.includes(slug));
      // Shared class feats (no class trait at all) are covered by their own
      // test below — they are SUPPOSED to be eligible everywhere.
      if (owners.length === 0) continue;

      for (const other of CLASS_SLUGS) {
        if (owners.includes(other)) continue;
        if (isFeatEligible(feat, "classFeat", LEVEL_20, { classSlug: other })) {
          leaks.push(`${feat.name ?? "?"} [${owners.join("+")}] → ${other}`);
        }
      }
    }

    // Report the classes involved, not 44 * 14 individual lines.
    expect(leaks.slice(0, 20)).toEqual([]);
    expect(leaks).toHaveLength(0);
  });

  it("a feat carrying the character's own class trait stays eligible", () => {
    const fighterFeats = CLASS_FEATS.filter((d) =>
      (d.system?.traits?.value ?? []).includes("fighter"),
    );
    expect(fighterFeats.length).toBeGreaterThan(0);

    for (const feat of fighterFeats.slice(0, 25)) {
      expect(
        isFeatEligible(feat, "classFeat", LEVEL_20, { classSlug: "fighter" }),
        `"${feat.name}" carries the fighter trait and should be eligible for a fighter`,
      ).toBe(true);
    }
  });

  /**
   * Synthetic, not from the packs: today EVERY class feat in `feats-core`
   * carries at least one class trait (measured — the shared-class-feats folder
   * tags each feat with every class that gets it), so there is no real
   * document to assert this branch against. It still has to hold: widening
   * KNOWN_CLASS_TRAITS must never turn "untagged" into "rejected", or a future
   * genuinely class-less feat would silently vanish from every picker.
   */
  it("a class feat with no class trait at all stays eligible for any class", () => {
    const untagged = {
      name: "Untagged Class Feat (fixture)",
      system: { category: "class", level: 1, traits: { value: ["general"] } },
    };
    for (const slug of ["fighter", "wizard", "psychic"]) {
      expect(isFeatEligible(untagged, "classFeat", LEVEL_20, { classSlug: slug })).toBe(true);
    }
  });
});
