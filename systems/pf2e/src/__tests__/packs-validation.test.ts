/**
 * @fusion/system-pf2e — Pack validation tests (R10-B3).
 *
 * Loads every `systems/pf2e/packs/<slug>/documents.json` produced by
 * tools/importer-pf2e and validates every document against the real Zod
 * schema for its `type`, plus a set of r10 domain invariants (Magus
 * spellcasting progression, Tobias's feats, hybrid studies, ratfolk
 * heritages, focus spells, license/attribution blocks).
 *
 * Clean-room: only mechanical facts / structural shape are asserted here —
 * no vendor prose is read or compared (stripFlavorProse guarantees empty
 * `description` fields, asserted explicitly below).
 *
 * REQ-PF2-003, DEC-R10-06.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseWeaponSystem } from "../schemas/item-weapon.js";
import { parseConditionSystem } from "../schemas/item-condition.js";
import { parseSpellSystem } from "../schemas/item-spell.js";
import { parseFeatSystem } from "../schemas/item-feat.js";
import { parseClassFeatureSystem } from "../schemas/item-class-feature.js";
import { parseNpcSystem } from "../schemas/actor-npc.js";
import {
  parseClassSystem,
  parseAncestrySystem,
  parseHeritageSystem,
  parseBackgroundSystem,
} from "../schemas/item-equipment.js";
import { spellSlotsForLevel } from "../derivations/build.js";
import type { ClassSystem } from "../schemas/item-equipment.js";

// ---------------------------------------------------------------------------
// Pack loading helpers
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PACKS_ROOT = resolve(__dirname, "../../packs");

interface RawDoc {
  _id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
  [key: string]: unknown;
}

interface PackJson {
  id: string;
  label: string;
  documentType: string;
  license?: {
    license?: string;
    attribution?: string;
    reservedNotice?: string;
    sourceRepo?: string;
    sourceVersion?: string;
  };
  [key: string]: unknown;
}

function listPackSlugs(): string[] {
  return readdirSync(PACKS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((slug) => existsSync(resolve(PACKS_ROOT, slug, "documents.json")));
}

function loadDocuments(slug: string): RawDoc[] {
  const raw = readFileSync(resolve(PACKS_ROOT, slug, "documents.json"), "utf-8");
  return JSON.parse(raw) as RawDoc[];
}

function loadPackJson(slug: string): PackJson {
  const raw = readFileSync(resolve(PACKS_ROOT, slug, "pack.json"), "utf-8");
  return JSON.parse(raw) as PackJson;
}

/** Zod parse* functions keyed by document `type`. Types without a full item
 * schema in this package (none currently) would need a documented fallback. */
const PARSERS_BY_TYPE: Record<string, (data: unknown) => unknown> = {
  weapon: parseWeaponSystem,
  condition: parseConditionSystem,
  spell: parseSpellSystem,
  feat: parseFeatSystem,
  classFeature: parseClassFeatureSystem,
  class: parseClassSystem,
  ancestry: parseAncestrySystem,
  heritage: parseHeritageSystem,
  background: parseBackgroundSystem,
  // NPC/monster actors: bestiary-core is documentType "Actor", type "npc".
  // NpcSystemSchema was hardened (see actor-npc.ts header) to match the real
  // shape produced by transform.mjs normalizeActorSystem, so we validate the
  // full schema here rather than a minimal shape-only check.
  npc: parseNpcSystem,
};

function summarizeZodError(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err) {
    const zodErr = err as { issues: Array<{ path: (string | number)[]; message: string }> };
    return zodErr.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// 1. Schema validation — every doc in every pack against its type's schema
// ---------------------------------------------------------------------------

describe("packs-validation: every document validates against its Zod schema", () => {
  const slugs = listPackSlugs();

  it("discovers at least the r10 packs", () => {
    expect(slugs).toEqual(
      expect.arrayContaining([
        "classes-core",
        "class-features-core",
        "feats-core",
        "ancestries-core",
        "heritages-core",
        "backgrounds-core",
        "spells-core",
        "weapons-core",
        "conditions",
        "bestiary-core",
      ]),
    );
  });

  for (const slug of listPackSlugs()) {
    describe(`pack: ${slug}`, () => {
      const docs = loadDocuments(slug);

      it("has at least one document", () => {
        expect(docs.length).toBeGreaterThan(0);
      });

      it("every document's type has a known parser", () => {
        const unknownTypes = [...new Set(docs.map((d) => d.type))].filter(
          (t) => !(t in PARSERS_BY_TYPE),
        );
        expect(unknownTypes, `pack ${slug} has doc types with no schema mapping`).toEqual([]);
      });

      it("every document validates against its type schema", () => {
        const failures: string[] = [];
        for (const doc of docs) {
          const parser = PARSERS_BY_TYPE[doc.type];
          if (!parser) continue; // reported by the previous assertion
          try {
            parser(doc.system);
          } catch (err) {
            failures.push(
              `[${slug}] "${doc.name}" (${doc._id}, type=${doc.type}): ${summarizeZodError(err)}`,
            );
          }
        }
        expect(failures, failures.join("\n")).toEqual([]);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 2a. Magus class: trainedSkills, featLevels/skillIncreaseLevels, spellcasting
// ---------------------------------------------------------------------------

describe("packs-validation: r10 domain invariants", () => {
  const classesDocs = loadDocuments("classes-core");
  const magus = classesDocs.find((d) => d.name === "Magus");

  it("classes-core contains Magus", () => {
    expect(magus).toBeDefined();
  });

  it("Magus classDC is at least Trained (every class is trained in its own class DC — audit issue #1)", () => {
    const system = magus!.system as unknown as ClassSystem;
    expect((system as unknown as { classDC?: number }).classDC ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("Magus trainedSkills includes arcana with 2 additional free choices", () => {
    const system = magus!.system as unknown as ClassSystem;
    expect(system.trainedSkills.value).toContain("arcana");
    expect(system.trainedSkills.additional).toBe(2);
  });

  it("Magus featLevels and skillIncreaseLevels are populated from the vendor", () => {
    const system = magus!.system as unknown as ClassSystem;
    expect(system.featLevels.class.length).toBeGreaterThan(0);
    expect(system.featLevels.ancestry.length).toBeGreaterThan(0);
    expect(system.featLevels.general.length).toBeGreaterThan(0);
    expect(system.featLevels.skill.length).toBeGreaterThan(0);
    expect(system.skillIncreaseLevels).toEqual([3, 5, 7, 9, 11, 13, 15, 17, 19]);
  });

  it("Magus spellcasting at level 3 resolves to cantrips 5, slots {'1':2,'2':1} (Tobias/Pathbuilder AC)", () => {
    // Pathbuilder perDay at level 3 is [5,2,1] — 5 cantrips, two rank-1
    // slots AND one rank-2 slot (official journal table, page "Magus").
    const system = magus!.system as unknown as ClassSystem;
    expect(system.spellcasting).toBeDefined();
    const result = spellSlotsForLevel(system.spellcasting!, 3);
    expect(result.cantripsKnown).toBe(5);
    expect(result.slotsByRank).toEqual({ "1": 2, "2": 1 });
  });

  it("Magus spellcasting at level 5 jumps to {'2':2,'3':2} and never grants rank-10 slots", () => {
    const system = magus!.system as unknown as ClassSystem;
    expect(spellSlotsForLevel(system.spellcasting!, 5).slotsByRank).toEqual({ "2": 2, "3": 2 });
    expect(spellSlotsForLevel(system.spellcasting!, 20).slotsByRank).toEqual({ "8": 2, "9": 2 });
  });

  it("Magus spellcasting at level 1 resolves to cantrips 5, slots {'1':1} (vendor prose anchor)", () => {
    const system = magus!.system as unknown as ClassSystem;
    const result = spellSlotsForLevel(system.spellcasting!, 1);
    expect(result.cantripsKnown).toBe(5);
    expect(result.slotsByRank).toEqual({ "1": 1 });
  });

  it("Magus featuresByLevel resolves all 19 entries to real class-features-core ids (no 'unresolved:')", () => {
    const system = magus!.system as unknown as ClassSystem;
    const classFeatureDocs = loadDocuments("class-features-core");
    const idsInPack = new Set(classFeatureDocs.map((d) => d._id));

    expect(system.featuresByLevel.length).toBeGreaterThan(0);
    const unresolved = system.featuresByLevel.filter((ref) => ref.uuid.startsWith("unresolved:"));
    expect(unresolved, JSON.stringify(unresolved)).toEqual([]);

    for (const ref of system.featuresByLevel) {
      expect(idsInPack.has(ref.uuid), `featuresByLevel uuid "${ref.uuid}" (${ref.name}) not found in class-features-core`).toBe(
        true,
      );
    }
  });

  // ---------------------------------------------------------------------------
  // 2b. Tobias's 7 feats exist in feats-core (acceptance criterion)
  // ---------------------------------------------------------------------------

  it("feats-core contains all 7 of Tobias's feats", () => {
    const feats = loadDocuments("feats-core");
    const names = new Set(feats.map((f) => f.name));
    const expected = [
      "Magus's Analysis",
      "Impressive Performance",
      "Read Lips",
      "Tinkering Fingers",
      "Alchemical Crafting",
      "Fascinating Performance",
      "Alchemist Dedication",
    ];
    const missing = expected.filter((name) => !names.has(name));
    expect(missing, `missing feats: ${missing.join(", ")}`).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 2c. Hybrid studies (category 'hybridStudy') include Starlit Span
  // ---------------------------------------------------------------------------

  it("class-features-core hybrid studies (category 'hybridStudy') include Starlit Span and all 8", () => {
    const classFeatures = loadDocuments("class-features-core");
    const hybridStudies = classFeatures.filter((d) => d.system.category === "hybridStudy");
    const names = hybridStudies.map((d) => d.name).sort();
    expect(names).toEqual(
      [
        "Aloof Firmament",
        "Inexorable Iron",
        "Laughing Shadow",
        "Resurgent Maelstrom",
        "Sparkling Targe",
        "Starlit Span",
        "Twisting Tree",
        "Unfurling Brocade",
      ].sort(),
    );
  });

  // ---------------------------------------------------------------------------
  // 2d. heritages-core contains Snow Rat
  // ---------------------------------------------------------------------------

  it("heritages-core contains Snow Rat", () => {
    const heritages = loadDocuments("heritages-core");
    expect(heritages.map((h) => h.name)).toContain("Snow Rat");
  });

  // ---------------------------------------------------------------------------
  // 2e. spells-core contains Shooting Star (Starlit Span focus spell) and no
  //     document across the validated packs leaks vendor prose.
  // ---------------------------------------------------------------------------

  it("spells-core contains Shooting Star (Starlit Span focus spell)", () => {
    const spells = loadDocuments("spells-core");
    expect(spells.map((s) => s.name)).toContain("Shooting Star");
  });

  it("no document in any pack has a non-empty system.description.value or system.description (stripFlavorProse)", () => {
    const offenders: string[] = [];
    for (const slug of listPackSlugs()) {
      for (const doc of loadDocuments(slug)) {
        const desc = (doc.system as { description?: unknown }).description;
        if (typeof desc === "string" && desc.length > 0) {
          offenders.push(`[${slug}] "${doc.name}": system.description = "${desc.slice(0, 40)}..."`);
        } else if (
          desc &&
          typeof desc === "object" &&
          "value" in (desc as Record<string, unknown>) &&
          typeof (desc as { value: unknown }).value === "string" &&
          ((desc as { value: string }).value.length > 0)
        ) {
          offenders.push(`[${slug}] "${doc.name}": system.description.value non-empty`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 2e-bis. No book prose survives OUTSIDE description either (REQ-LEG-010 —
  // r10 final clean-room audit found prose leaking through rules[].text /
  // rules[].raw.text (Note REs) and through spell `target` sentences).
  // ---------------------------------------------------------------------------

  it("no document carries prose in rules[].text / rules[].raw.text / unconvertedRules[].text, and spell targets stay short", () => {
    const offenders: string[] = [];
    const ruleTextOffender = (rules: unknown, where: string, docLabel: string): void => {
      if (!Array.isArray(rules)) return;
      for (const rule of rules as Array<Record<string, unknown>>) {
        if (!rule || typeof rule !== "object") continue;
        if (typeof rule["text"] === "string" && (rule["text"] as string).length > 0) {
          offenders.push(`${docLabel}: ${where}.text non-empty`);
        }
        const raw = rule["raw"];
        if (
          raw &&
          typeof raw === "object" &&
          typeof (raw as Record<string, unknown>)["text"] === "string" &&
          ((raw as Record<string, unknown>)["text"] as string).length > 0
        ) {
          offenders.push(`${docLabel}: ${where}.raw.text non-empty`);
        }
      }
    };
    for (const slug of listPackSlugs()) {
      for (const doc of loadDocuments(slug)) {
        const docLabel = `[${slug}] "${doc.name}"`;
        const sys = doc.system as Record<string, unknown>;
        ruleTextOffender(sys["rules"], "rules[]", docLabel);
        const fusion = (doc as { flags?: { fusion?: Record<string, unknown> } }).flags?.fusion;
        ruleTextOffender(fusion?.["unconvertedRules"], "unconvertedRules[]", docLabel);
        if (doc.type === "spell") {
          const target = sys["target"];
          const targetStr =
            typeof target === "string"
              ? target
              : typeof (target as Record<string, unknown> | null)?.["value"] === "string"
                ? ((target as Record<string, unknown>)["value"] as string)
                : "";
          if (targetStr.length > 60) {
            offenders.push(`${docLabel}: system.target longer than 60 chars (likely book prose)`);
          }
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 2f. every pack.json has a license block with attribution
  // ---------------------------------------------------------------------------

  it("every pack.json has a license block with attribution", () => {
    const failures: string[] = [];
    for (const slug of listPackSlugs()) {
      const packJson = loadPackJson(slug);
      if (!packJson.license) {
        failures.push(`[${slug}] pack.json missing "license" block`);
        continue;
      }
      if (!packJson.license.attribution || packJson.license.attribution.trim().length === 0) {
        failures.push(`[${slug}] pack.json license block missing non-empty "attribution"`);
      }
      if (!packJson.license.license) {
        failures.push(`[${slug}] pack.json license block missing "license" (e.g. ORC/OGL)`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
