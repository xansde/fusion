/**
 * @fusion/system-pf2e — armor-core / shields-core pack tests (A1, r28).
 *
 * Two things this file guards that packs-validation.test.ts does not:
 *
 * 1. A CATRACA (ratchet) on the exact curated set of the two new packs — by
 *    `flags.fusion.sourceId`, per the project rule "document identity is
 *    sourceId, never the name" (homonyms are normal in PF2e). This locks in
 *    the r28/A1 curation decision (Player Core ∪ Player Core 2, categories
 *    unarmored/light/medium/heavy only, no magic/invested items) so a future
 *    regeneration of the pack can't silently drift.
 *
 * 2. A NON-CIRCULAR jogabilidade check (per the r28 plan and lesson #48 of
 *    project_fusion: "our 12-class sweep only checked derivation against the
 *    pack's own table — circular"). This test does NOT re-derive the
 *    expected AC from the pack's own acBonus/dexCap fields; it hardcodes an
 *    AC computed independently from the PF2e remaster rules (10 + dex +
 *    armor proficiency + item bonus) for a level-1 Fighter in Leather Armor,
 *    then asserts the REAL stepCharAc derivation pipeline — fed with the
 *    REAL armor-core document — reaches that same externally-known number.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emptySynthetics } from "@fusion/system-api";
import type { DeriveContext } from "@fusion/system-api";
import { stepCharCollectEquipment } from "../derivations/equipment.js";
import { stepCharAbilityMods, stepCharAc } from "../derivations/character.js";
import { pf2eSystem } from "../index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PACKS_ROOT = resolve(__dirname, "../../packs");

interface RawDoc {
  _id: string;
  name: string;
  type: string;
  system: Record<string, unknown>;
  flags?: { fusion?: { sourceId?: string } };
}

function loadDocuments(slug: string): RawDoc[] {
  const raw = readFileSync(resolve(PACKS_ROOT, slug, "documents.json"), "utf-8");
  return JSON.parse(raw) as RawDoc[];
}

function emptyCtx(): DeriveContext {
  return {
    system: pf2eSystem,
    synthetics: emptySynthetics(),
    rollOptions: new Set<string>(),
  };
}

function getDerived(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. Catraca — exact curated sets by sourceId (r28/A1 decision)
// ---------------------------------------------------------------------------

const EXPECTED_ARMOR_SOURCE_IDS: Record<string, string> = {
  dDIPA1WE9ESF67EB: "Explorer's Clothing",
  MPcM4Wt6KmWE2kGL: "Chain Shirt",
  "4tIVTg9wj56RrveA": "Leather Armor",
  zBYEU9E7034ENCmh: "Padded Armor",
  ewQZ0VeL38v3qFnN: "Studded Leather Armor",
  r0ifJfoz8aqf0mwk: "Breastplate",
  Kf4eJEXnFPuAsseP: "Chain Mail",
  AnwzlOs0njF9Jqnr: "Hide Armor",
  YMQr577asquZIP65: "Scale Mail",
  Gq1cZWSKOtJhKd2p: "Full Plate",
  pRoikbRo5HFW6YUB: "Half Plate",
  "6AhDKX1dwRwFpQsU": "Splint Mail",
};

const EXPECTED_SHIELD_SOURCE_IDS: Record<string, string> = {
  "1k3AsSW7lpU0kEpY": "Buckler",
  ezVp13Uw8cWW08Da: "Wooden Shield",
  Yr9yCuJiAlFh3QEB: "Steel Shield",
  ltundBNFAnP7bgPr: "Tower Shield",
};

describe("armor-core: catraca (r28/A1 curated set)", () => {
  const docs = loadDocuments("armor-core");

  it("has exactly 12 documents", () => {
    expect(docs.length).toBe(12);
  });

  it("every document is type 'armor'", () => {
    expect(docs.every((d) => d.type === "armor")).toBe(true);
  });

  it("the sourceId set matches the r28/A1 curated list exactly (no drift)", () => {
    const actual = new Map(docs.map((d) => [d.flags?.fusion?.sourceId, d.name]));
    const expectedIds = Object.keys(EXPECTED_ARMOR_SOURCE_IDS).sort();
    expect([...actual.keys()].sort()).toEqual(expectedIds);
    for (const [id, expectedName] of Object.entries(EXPECTED_ARMOR_SOURCE_IDS)) {
      expect(actual.get(id), `sourceId ${id} should be "${expectedName}"`).toBe(expectedName);
    }
  });

  it("covers all four playable categories (unarmored/light/medium/heavy)", () => {
    const categories = new Set(docs.map((d) => d.system["category"]));
    expect(categories).toEqual(new Set(["unarmored", "light", "medium", "heavy"]));
  });

  it("no document carries the magical/invested traits (mundane-only leva)", () => {
    const offenders = docs.filter((d) => {
      const traits = (d.system["traits"] as { value?: string[] } | undefined)?.value ?? [];
      return traits.includes("magical") || traits.includes("invested");
    });
    expect(offenders.map((d) => d.name)).toEqual([]);
  });

  it("no document carries an explicit null for optional numeric fields (strength)", () => {
    // Regression guard for the transform.mjs normalizeArmorSystem finding:
    // vendor docs with no Strength requirement stored an explicit `null`,
    // which ArmorSystemSchema's `.optional()` rejects. Fixed locally in
    // build-mvp-subset.mjs (fixArmorStrengthNull) rather than in the shared
    // out/ pipeline — see that function's comment for why.
    const offenders = docs.filter((d) => d.system["strength"] === null);
    expect(offenders.map((d) => d.name)).toEqual([]);
  });
});

describe("shields-core: catraca (r28/A1 curated set)", () => {
  const docs = loadDocuments("shields-core");

  it("has exactly 4 documents", () => {
    expect(docs.length).toBe(4);
  });

  it("every document is type 'shield'", () => {
    expect(docs.every((d) => d.type === "shield")).toBe(true);
  });

  it("the sourceId set matches the r28/A1 curated list exactly (no drift)", () => {
    const actual = new Map(docs.map((d) => [d.flags?.fusion?.sourceId, d.name]));
    const expectedIds = Object.keys(EXPECTED_SHIELD_SOURCE_IDS).sort();
    expect([...actual.keys()].sort()).toEqual(expectedIds);
    for (const [id, expectedName] of Object.entries(EXPECTED_SHIELD_SOURCE_IDS)) {
      expect(actual.get(id), `sourceId ${id} should be "${expectedName}"`).toBe(expectedName);
    }
  });

  it("no document carries the magical trait (mundane-only leva)", () => {
    const offenders = docs.filter((d) => {
      const traits = (d.system["traits"] as { value?: string[] } | undefined)?.value ?? [];
      return traits.includes("magical");
    });
    expect(offenders.map((d) => d.name)).toEqual([]);
  });

  it("no document carries an explicit null for optional numeric fields (strength)", () => {
    const offenders = docs.filter((d) => d.system["strength"] === null);
    expect(offenders.map((d) => d.name)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Non-circular playability check — real armor-core doc through the real
//    stepCharAc derivation, compared to an AC computed independently from
//    the PF2e remaster rules (NOT re-derived from the pack's own fields).
// ---------------------------------------------------------------------------

describe("armor-core: non-circular AC derivation (lesson #48 — never check against the pack's own table)", () => {
  it("level-1 Fighter, DEX 16 (+3), Trained in light armor, wearing Leather Armor → AC 17", () => {
    // Independent fact check (PF2e remaster rules, not derived from this
    // pack): AC = 10 + dexMod(capped) + armor-proficiency bonus + item bonus.
    //   dexMod = floor((16-10)/2) = +3, Leather Armor dexCap = 4 → capped dex stays +3
    //   Trained proficiency bonus at level 1 = rank(1)*2 + level(1) = 3
    //   Leather Armor item bonus = +1
    //   AC = 10 + 3 + 3 + 1 = 17
    const EXPECTED_AC = 17;

    const armorCoreDocs = loadDocuments("armor-core");
    const leatherArmor = armorCoreDocs.find((d) => d.name === "Leather Armor");
    expect(leatherArmor, "armor-core must contain Leather Armor").toBeDefined();
    expect(leatherArmor!.system["acBonus"]).toBe(1);
    expect(leatherArmor!.system["dexCap"]).toBe(4);
    expect(leatherArmor!.system["category"]).toBe("light");

    const doc: Record<string, unknown> = {
      system: {
        systemVersion: "0.1.0",
        level: { value: 1 },
        abilities: {
          str: { value: 10, mod: 0 },
          dex: { value: 16, mod: 0 },
          con: { value: 10, mod: 0 },
          int: { value: 10, mod: 0 },
          wis: { value: 10, mod: 0 },
          cha: { value: 10, mod: 0 },
        },
        attributes: {
          hp: { value: 10, max: 10, temp: 0 },
          ac: { value: 10 },
          speed: { value: 25, otherSpeeds: [] },
          dying: { value: 0, max: 4 },
          wounded: { value: 0 },
          doomed: { value: 0 },
          iwr: { immunities: [], weaknesses: [], resistances: [] },
        },
        saves: {
          fortitude: { rank: 0 },
          reflex: { rank: 0 },
          will: { rank: 0 },
        },
        perception: { rank: 0, senses: [] },
        skills: {},
        proficiencies: {
          classDC: { rank: 0 },
          weapons: { unarmed: 0, simple: 0, martial: 0, advanced: 0 },
          // Fighters are Trained in light armor from level 1 (REQ-PF2-020 domain fact).
          armor: { unarmored: 0, light: 1, medium: 0, heavy: 0 },
        },
        resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
        details: { keyAbility: "str", level: 1 },
        traits: { rarity: "common", value: [], size: "med" },
      },
      items: [
        {
          _id: leatherArmor!._id,
          name: leatherArmor!.name,
          type: "armor",
          system: {
            ...leatherArmor!.system,
            equipped: true,
          },
        },
      ],
    };

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharCollectEquipment.run(doc, emptyCtx());
    stepCharAc.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const ac = derived["ac"] as { total: number };
    expect(ac.total).toBe(EXPECTED_AC);
  });
});
