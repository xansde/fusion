/**
 * @fusion/system-pf2e — Pack validation tests (R10-B3).
 *
 * Loads every `systems/pf2e/packs/<slug>/documents.json` produced by
 * tools/importer-pf2e and validates every document against the real Zod
 * schema for its `type`, plus a set of r10 domain invariants (Magus
 * spellcasting progression, Tobias's feats, hybrid studies, ratfolk
 * heritages, focus spells, license/attribution blocks).
 *
 * Clean-room: mechanical facts / structural shape are asserted here.
 * `system.description` (policy update W2-C1, REQ-LEG-010, 2026-07-05) is
 * PRESERVED whenever the document's `system.publication.license` is ORC or
 * OGL — that prose is itself licensed rules text, redistributable with
 * attribution (see each pack.json's `license.textAttribution`) — and stays
 * blank only for documents without an ORC/OGL publication (e.g. NPC actors,
 * whose lore fields `gmNotes`/`publicNotes`/`privateNotes` remain always
 * stripped regardless of license, asserted explicitly below).
 *
 * REQ-PF2-003, DEC-R10-06.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseWeaponSystem } from "../schemas/item-weapon.js";
import { parseArmorSystem } from "../schemas/item-armor.js";
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
  parseActionSystem,
  parseEquipmentSystem,
  parseConsumableSystem,
  parseContainerSystem,
} from "../schemas/item-equipment.js";
import { PackManifestSchema } from "@fusion/shared";
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
  /** Pack audience, next to `license` (REQ-CMP-004a). Absent reads as "all". */
  audience?: string;
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
  action: parseActionSystem,
  // NPC/monster actors: bestiary-core is documentType "Actor", type "npc".
  // NpcSystemSchema was hardened (see actor-npc.ts header) to match the real
  // shape produced by transform.mjs normalizeActorSystem, so we validate the
  // full schema here rather than a minimal shape-only check.
  npc: parseNpcSystem,
  // Physical item types (r18-N2d, pf2e.equipment-core — Finn's gear).
  // "backpack" isn't listed here: transform.mjs's resolveFusionType() remaps
  // the vendor's "backpack" type to Fusion's "container" before the doc is
  // written, so committed packs never carry a literal type "backpack".
  armor: parseArmorSystem,
  equipment: parseEquipmentSystem,
  consumable: parseConsumableSystem,
  container: parseContainerSystem,
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
        "actions-core",
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
      expect(
        idsInPack.has(ref.uuid),
        `featuresByLevel uuid "${ref.uuid}" (${ref.name}) not found in class-features-core`,
      ).toBe(true);
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

  // r12 blocker guard: the focus-spell picker filters spells-core by the
  // `focus` trait. A previous build only included the 12 Magus focus spells
  // (the pipeline selected focus spells via the `magus` trait, missing the
  // other ~446 class-agnostic focus spells because focus spells carry an
  // empty traits.traditions and so never matched the `arcane` branch either).
  // These assertions lock in that EVERY vendor focus spell is present and
  // that every focus spell in the pack actually carries the `focus` trait
  // (so the picker's trait filter has data to show).
  it("spells-core contains focus spells (picker filters by the 'focus' trait)", () => {
    const spells = loadDocuments("spells-core");
    const focusSpells = spells.filter((s) => {
      const value = (s.system as { traits?: { value?: unknown } }).traits?.value;
      return Array.isArray(value) && value.includes("focus");
    });
    // The vendor snapshot ships hundreds of focus spells across every class;
    // a healthy pack has far more than the 12 Magus ones that used to leak in.
    expect(focusSpells.length).toBeGreaterThan(100);
    // Shooting Star (Starlit Span) must specifically be among them.
    expect(focusSpells.map((s) => s.name)).toContain("Shooting Star");
  });

  it("Shooting Star's traits include 'focus', and Magus focus spells keep both 'focus' and 'magus'", () => {
    const spells = loadDocuments("spells-core");
    const shootingStar = spells.find((s) => s.name === "Shooting Star");
    expect(shootingStar).toBeDefined();
    const ssTraits = (shootingStar!.system as { traits?: { value?: unknown } }).traits?.value;
    const ssValues = Array.isArray(ssTraits)
      ? ssTraits.filter((v): v is string => typeof v === "string")
      : [];
    // Shooting Star is a Magus (Starlit Span) focus spell — it must carry
    // BOTH traits so it surfaces under the picker's focus filter AND remains
    // discoverable as a Magus conflux spell.
    expect(ssValues).toEqual(expect.arrayContaining(["focus", "magus"]));
  });

  it("the picker's 'focus' trait filter surfaces every focus spell, and each is index-consistent", () => {
    const spells = loadDocuments("spells-core");
    const isFocus = (doc: RawDoc): boolean => {
      const value = (doc.system as { traits?: { value?: unknown } }).traits?.value;
      return Array.isArray(value) && value.includes("focus");
    };

    const focusSpells = spells.filter(isFocus);
    // The bug this guards: a build where focus spells were selected by the
    // `magus` trait pulled in only 12; a class-agnostic `focus`-trait selector
    // must ship hundreds (cleric/druid/bard/sorcerer/... focus spells too).
    expect(focusSpells.length).toBeGreaterThan(100);

    // The picker reads the SEARCH INDEX (index.json), not documents.json.
    // Assert the index's system.traits.value carries `focus` for the same set
    // of docs — otherwise the picker's chip filter would silently disagree
    // with the pack (index vs. document drift).
    const indexRaw = readFileSync(resolve(PACKS_ROOT, "spells-core", "index.json"), "utf-8");
    const index = JSON.parse(indexRaw) as Array<{
      _id: string;
      name: string;
      index: Record<string, unknown>;
    }>;
    const indexFocusIds = new Set(
      index
        .filter((e) => {
          const value = e.index["system.traits.value"];
          return Array.isArray(value) && value.includes("focus");
        })
        .map((e) => e._id),
    );
    const docFocusIds = new Set(focusSpells.map((s) => s._id));
    const onlyInDocs = [...docFocusIds].filter((id) => !indexFocusIds.has(id));
    const onlyInIndex = [...indexFocusIds].filter((id) => !docFocusIds.has(id));
    expect(onlyInDocs, `focus in documents but not index: ${onlyInDocs.join(", ")}`).toEqual([]);
    expect(onlyInIndex, `focus in index but not documents: ${onlyInIndex.join(", ")}`).toEqual([]);
  });

  it("system.description is present only on documents whose system.publication.license is ORC or OGL (policy update W2-C1, stripFlavorProse)", () => {
    const offenders: string[] = [];
    const REDISTRIBUTABLE = new Set(["ORC", "OGL"]);
    for (const slug of listPackSlugs()) {
      for (const doc of loadDocuments(slug)) {
        const sys = doc.system as { description?: unknown; publication?: { license?: string } };
        const license = sys.publication?.license;
        const desc = sys.description;
        const descLen =
          typeof desc === "string"
            ? desc.length
            : desc &&
                typeof desc === "object" &&
                "value" in (desc as Record<string, unknown>) &&
                typeof (desc as { value: unknown }).value === "string"
              ? (desc as { value: string }).value.length
              : 0;
        if (descLen > 0 && !REDISTRIBUTABLE.has(license ?? "")) {
          offenders.push(
            `[${slug}] "${doc.name}": system.description non-empty without an ORC/OGL publication.license (got "${license}")`,
          );
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

  // ---------------------------------------------------------------------------
  // 2g. published audience of every pack
  // REQ-CPD-072, REQ-PF2-140, REQ-PF2-141, REQ-PF2-143
  // ---------------------------------------------------------------------------

  /**
   * Which packs the system publishes for the GM alone is read from what each
   * pack CONTAINS, never from a list of slugs. A creature pack read by a player
   * is the monster manual open on the table (REQ-CPD-072, REQ-PF2-141), and that
   * requirement binds "qualquer pack de criaturas que o sistema venha a publicar
   * depois". A literal slug set does not satisfy it — a `bestiary-2` published as
   * "all" would be a leak these assertions never looked at, while the same pack
   * published correctly as "gm" would FAIL the REQ-PF2-143 assertion below. Same
   * rule the generator applies (tools/importer-pf2e/src/pack-audience.mjs).
   *
   * The sibling requirement about hazard packs (spec 17, "Plateia dos packs
   * publicados") is deliberately NOT claimed by this file: no committed pack
   * carries a `hazard` document, so any assertion here about them is vacuously
   * true and would pass with the whole rule deleted. It is proved with real
   * mutation power against the generator's rule, over hazard packs that do not
   * exist yet, in tools/importer-pf2e/src/__tests__/pack-audience.test.mjs.
   * Do not re-add that requirement id to this file: the tripwire below is a
   * guard over committed packs, not a proof.
   */
  const packsContaining = (type: string): string[] =>
    listPackSlugs().filter((slug) => loadDocuments(slug).some((doc) => doc.type === type));

  const creaturePacks = packsContaining("npc");
  const hazardPacks = packsContaining("hazard");
  const gmOnlySlugs = new Set([...creaturePacks, ...hazardPacks]);

  it("REQ-CPD-072 / REQ-PF2-141: every pack carrying creatures is published with audience 'gm'", () => {
    // Non-vacuity guard: the detector must actually be finding the bestiary,
    // otherwise an empty `creaturePacks` would make the loop below pass for free.
    expect(creaturePacks, "no creature pack found — the content detector is broken").toContain(
      "bestiary-core",
    );

    const offenders: string[] = [];
    for (const slug of creaturePacks) {
      const parsed = PackManifestSchema.parse(loadPackJson(slug));
      if (parsed.documentType !== "Actor") {
        offenders.push(`[${slug}] carries creatures but documentType is "${parsed.documentType}"`);
      }
      if (parsed.audience !== "gm") {
        offenders.push(`[${slug}] audience is "${parsed.audience}", expected "gm"`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
    expect(PackManifestSchema.parse(loadPackJson("bestiary-core")).id).toBe("pf2e.bestiary-core");
  });

  it("REQ-PF2-143: every pack without creatures or hazards is published with audience 'all'", () => {
    const offenders: string[] = [];
    for (const slug of listPackSlugs()) {
      if (gmOnlySlugs.has(slug)) continue;
      const parsed = PackManifestSchema.parse(loadPackJson(slug));
      if (parsed.audience !== "all") {
        offenders.push(`[${slug}] audience is "${parsed.audience}", expected "all"`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("REQ-PF2-140: every published pack declares audience in its manifest", () => {
    const missing = listPackSlugs().filter(
      (slug) => typeof loadPackJson(slug).audience !== "string",
    );
    expect(missing, `packs without a declared audience: ${missing.join(", ")}`).toEqual([]);
  });

  it("tripwire (no coverage claim): a committed pack carrying hazards is published with audience 'gm'", () => {
    // Vacuous by construction today — no committed pack carries a hazard, so
    // this list is empty and the assertion cannot fail; deleting the generator's
    // entire audience rule leaves it green. That is why it claims no requirement
    // id (see the note above the detector). Its job is to catch the day hazards
    // actually ship in a committed pack: it fails until that pack is published
    // as "gm", and the REQ-PF2-143 assertion above stops demanding "all" of the
    // same pack at the same moment, because both read the same content.
    const wrongAudience = hazardPacks.filter(
      (slug) => PackManifestSchema.parse(loadPackJson(slug)).audience !== "gm",
    );
    expect(
      wrongAudience,
      `hazard packs not published as "gm": ${wrongAudience.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * The committed roster of pf2e.bestiary-core, written down BY HAND here.
   *
   * This list is the anchor that makes the REQ-PF2-144 assertions below able to
   * fail. Comparing `documents.json` against the manifest's `documentCount`
   * would prove nothing: `writePack` derives BOTH from the same in-memory array
   * in the same run (tools/importer-pf2e/src/build-mvp-subset.mjs — the manifest
   * gets `documentCount: docs.length` right next to the `JSON.stringify(docs)`
   * that becomes documents.json), so a generation that truncated the bestiary
   * from ten creatures to one would move both numbers together and stay green.
   * REQ-PF2-144 forbids precisely "omitir, truncar ou redigir documento de um
   * pack `gm` na geração", so the guard has to be anchored outside the
   * generator's own bookkeeping.
   *
   * A vendor bump that ADDS creatures is fine (the assertions are containment +
   * floor, not equality); dropping any of these is the regression being caught.
   */
  const COMMITTED_BESTIARY_CREATURES = [
    "Eagle",
    "Giant Rat",
    "Goblin Warrior",
    "Guard Dog",
    "Hryngar Sharpshooter",
    "Kobold Warrior",
    "Leaf Leshy",
    "Orc Scrapper",
    "Skeleton Guard",
    "Zombie Shambler",
  ];

  it("REQ-PF2-144: the GM-only pack omits no creature — every committed one is still published", () => {
    const docs = loadDocuments("bestiary-core");
    const names = docs.map((doc) => doc.name);
    const missing = COMMITTED_BESTIARY_CREATURES.filter((name) => !names.includes(name));
    expect(missing, `bestiary-core lost creatures: ${missing.join(", ")}`).toEqual([]);
    expect(docs.length).toBeGreaterThanOrEqual(COMMITTED_BESTIARY_CREATURES.length);
  });

  it("REQ-PF2-144: no creature of the GM-only pack is truncated or redacted", () => {
    const offenders: string[] = [];
    for (const doc of loadDocuments("bestiary-core")) {
      const label = `[bestiary-core] "${doc.name}" (${doc._id})`;
      if (doc.name.length === 0) offenders.push(`${label}: empty name`);
      if (!doc.system) {
        offenders.push(`${label}: lost its system block`);
        continue;
      }
      // The mechanical content a "redacted for players" copy would blank out.
      // A creature the GM cannot run is a creature that was redacted, whatever
      // the document count says.
      const system = doc.system as {
        attributes?: { hp?: { max?: unknown }; ac?: { value?: unknown } };
        details?: { level?: { value?: unknown } };
        traits?: { value?: unknown };
      };
      const hp = system.attributes?.hp?.max;
      const ac = system.attributes?.ac?.value;
      const level = system.details?.level?.value;
      const traits = system.traits?.value;
      const items = (doc as { items?: unknown }).items;
      if (typeof hp !== "number" || hp <= 0) offenders.push(`${label}: system.attributes.hp.max`);
      if (typeof ac !== "number" || ac <= 0) offenders.push(`${label}: system.attributes.ac.value`);
      if (typeof level !== "number") offenders.push(`${label}: system.details.level.value`);
      if (!Array.isArray(traits) || traits.length === 0) offenders.push(`${label}: traits`);
      if (!Array.isArray(items) || items.length === 0) {
        offenders.push(`${label}: no embedded items (attacks/abilities stripped)`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("REQ-PF2-144: the GM-only pack's index.json publishes the same documents, none dropped", () => {
    // index.json is a SEPARATE committed artifact from documents.json. Set
    // equality on both keys — the storage id and the identity the project
    // treats as canonical (flags.fusion.sourceId) — means an omission on
    // either side denounces itself instead of cancelling out.
    const docs = loadDocuments("bestiary-core");
    const index = loadIndexJson("bestiary-core");
    expect(index, "bestiary-core/index.json is missing").not.toBeNull();

    expect(new Set(index!.map((entry) => entry._id))).toEqual(new Set(docs.map((doc) => doc._id)));

    const docSourceIds = new Set(docs.map((doc) => readDotPath(doc, SOURCE_ID_FIELD)));
    const indexSourceIds = new Set(index!.map((entry) => entry.index?.[SOURCE_ID_FIELD]));
    expect(docSourceIds.has(undefined), "a bestiary document lost its sourceId").toBe(false);
    expect(indexSourceIds).toEqual(docSourceIds);
  });
});

// ---------------------------------------------------------------------------
// 2g. r20-X5 — ancestry-features-core + Aeronaut free-feat grant
// ---------------------------------------------------------------------------

describe("packs-validation: r20-X5 ancestry features + Aeronaut grant", () => {
  const ancestryFeatures = loadDocuments("ancestry-features-core");

  it("ancestry-features-core is non-empty (whole vendor pack; actual count 55 at r20-X5)", () => {
    // Resilient: assert a lower bound, not the exact number — a vendor bump may
    // add/remove ancestry features without this test needing an edit.
    expect(ancestryFeatures.length).toBeGreaterThanOrEqual(50);
  });

  it("every ancestry feature is type 'feat' with category 'ancestryfeature'", () => {
    const offenders = ancestryFeatures
      .filter((d) => d.type !== "feat" || d.system.category !== "ancestryfeature")
      .map((d) => `${d.name} (type=${d.type}, category=${String(d.system.category)})`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("contains the features referenced by ancestries-core's system.items maps (Unusual Anatomy, Sharp Teeth)", () => {
    // These are the two auto-conceded features the committed ancestries
    // (Fleshwarp, Ratfolk) reference — the whole point of the pack. Nominal
    // existence check (resilient to id churn).
    const names = new Set(ancestryFeatures.map((d) => d.name));
    for (const feature of ["Unusual Anatomy", "Sharp Teeth"]) {
      expect(names.has(feature), `ancestry-features-core missing "${feature}"`).toBe(true);
    }
  });

  it("every ancestries-core system.items feature resolves to a doc in ancestry-features-core (no dangling grants)", () => {
    // The client materializes each ABC system.items entry against
    // ancestry-features-core by NAME; a referenced feature with no matching
    // doc would render as a non-clickable informative chip (the bug this pack
    // fixes). Guard that every referenced ancestry feature is present.
    const featureNames = new Set(ancestryFeatures.map((d) => normalize(d.name)));
    const missing: string[] = [];
    for (const ancestry of loadDocuments("ancestries-core")) {
      const items =
        (ancestry.system as { items?: Record<string, { uuid?: string; name?: string }> }).items ??
        {};
      for (const entry of Object.values(items)) {
        const uuid = entry.uuid ?? "";
        // Only ancestry-feature grants live in this pack; skip other vendors.
        if (!uuid.includes(".ancestryfeatures.")) continue;
        const name = entry.name ?? uuid.split(".Item.")[1] ?? "";
        if (name && !featureNames.has(normalize(name))) {
          missing.push(`${ancestry.name} → "${name}"`);
        }
      }
    }
    expect(missing, `dangling ancestry-feature grants: ${missing.join(", ")}`).toEqual([]);
  });

  it("Aeronaut background grants Assurance via system.items (r20-X5 curated free feat)", () => {
    // The vendor Aeronaut ships an empty system.items; r20-X5 injects the
    // Assurance grant its own description @UUID names (with Piloting Lore). NOT
    // Powerful Leap — that is a level-based skill-feat slot in Finn's build, not
    // a background benefit (official Battlecry! text grants only Assurance).
    const aeronaut = loadDocuments("backgrounds-core").find((d) => d.name === "Aeronaut");
    expect(aeronaut, "backgrounds-core missing Aeronaut").toBeDefined();
    const items =
      (aeronaut!.system as { items?: Record<string, { uuid?: string; name?: string }> }).items ??
      {};
    const grantedNames = Object.values(items).map((e) => e.name);
    expect(grantedNames).toContain("Assurance");
    const assurance = Object.values(items).find((e) => e.name === "Assurance");
    expect(assurance?.uuid).toBe("Compendium.pf2e.feats-srd.Item.Assurance");
  });

  it("Assurance resolves in feats-core (so the Aeronaut grant materializes)", () => {
    // The grant's uuid targets feats-srd → feats-core; the feat must be present
    // there for the client to materialize it as a clickable chip.
    const feats = loadDocuments("feats-core");
    expect(feats.map((f) => f.name)).toContain("Assurance");
  });
});

function normalize(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// 3. pf2e.actions-core domain invariants (W2, r11-follow-up)
// ---------------------------------------------------------------------------

describe("packs-validation: actions-core domain invariants", () => {
  const ACTIONS_CORE_CURATED_CATEGORIES = new Set([
    "basic",
    "skill",
    "exploration",
    "downtime",
    "class",
    "equipment",
    "ancestry",
    "archetype",
    "background",
    "familiar",
    "heritage",
    "spells",
    "stamina",
    "mythic",
  ]);
  const VALID_ACTION_TYPES = new Set(["action", "reaction", "free", "passive"]);

  const docs = loadDocuments("actions-core");

  it("actions-core has documents (non-empty pack)", () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  it("every document is type 'action'", () => {
    const offenders = docs.filter((d) => d.type !== "action").map((d) => `${d.name} (${d.type})`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every document has a valid system.actionType (action/reaction/free/passive)", () => {
    const offenders: string[] = [];
    for (const doc of docs) {
      const actionType = (doc.system as Record<string, unknown>)["actionType"];
      if (typeof actionType !== "string" || !VALID_ACTION_TYPES.has(actionType)) {
        offenders.push(`"${doc.name}": system.actionType = ${JSON.stringify(actionType)}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("system.actions cost is coherent with actionType (1-3 for 'action', null/1 otherwise)", () => {
    const offenders: string[] = [];
    for (const doc of docs) {
      const sys = doc.system as Record<string, unknown>;
      const actionType = sys["actionType"];
      const actions = sys["actions"];
      if (actionType === "action") {
        if (typeof actions !== "number" || actions < 1 || actions > 3) {
          offenders.push(
            `"${doc.name}": actionType="action" but system.actions = ${JSON.stringify(actions)}`,
          );
        }
      } else if (actions !== null && actions !== 1) {
        // Reactions/free actions occasionally carry actions:1 in the vendor
        // data (e.g. some free actions); passive/reaction never carry 2-3.
        offenders.push(
          `"${doc.name}": actionType="${String(actionType)}" but system.actions = ${JSON.stringify(actions)}`,
        );
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every document's system.fusionCategory is in the curated category set", () => {
    const offenders: string[] = [];
    for (const doc of docs) {
      const category = (doc.system as Record<string, unknown>)["fusionCategory"];
      if (typeof category !== "string" || !ACTIONS_CORE_CURATED_CATEGORIES.has(category)) {
        offenders.push(`"${doc.name}": system.fusionCategory = ${JSON.stringify(category)}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("excludes subsystems/vehicles/aftermath/campaign noise categories entirely", () => {
    const excluded = new Set(["subsystems", "vehicles", "aftermath", "campaign"]);
    const offenders = docs
      .filter((d) =>
        excluded.has((d.system as Record<string, unknown>)["fusionCategory"] as string),
      )
      .map((d) => d.name);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every document carries an ORC/OGL publication and a non-empty description (clean-room r11 policy)", () => {
    const offenders: string[] = [];
    for (const doc of docs) {
      const sys = doc.system as Record<string, unknown>;
      const publication = sys["publication"] as { license?: string } | undefined;
      const license = publication?.license;
      if (license !== "ORC" && license !== "OGL") {
        offenders.push(`"${doc.name}": system.publication.license = ${JSON.stringify(license)}`);
        continue;
      }
      const description = sys["description"];
      if (typeof description !== "string" || description.length === 0) {
        offenders.push(`"${doc.name}": empty system.description despite ORC/OGL license`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no rule element (at any nesting depth) leaks a non-empty text field without textStripped", () => {
    // Stronger than the flat rules[].text/rules[].raw.text check above (2e-bis):
    // real actions-core ItemAlteration REs nest `text` inside a `value[]`
    // array of sub-objects (rules[].raw.value[].text), which a one-level
    // check never visits. Walks the FULL rule/unconvertedRule tree.
    const offenders: string[] = [];
    const walk = (node: unknown, path: string, docLabel: string, ruleStripped: boolean): void => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${path}[${i}]`, docLabel, ruleStripped));
        return;
      }
      if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        const stripped = ruleStripped || obj["textStripped"] === true;
        for (const [k, v] of Object.entries(obj)) {
          if (k === "text" && typeof v === "string" && v.length > 0 && !stripped) {
            offenders.push(`${docLabel}: ${path}.text non-empty without textStripped marker`);
          }
          walk(v, `${path}.${k}`, docLabel, stripped);
        }
      }
    };
    for (const doc of docs) {
      const docLabel = `"${doc.name}"`;
      const sys = doc.system as Record<string, unknown>;
      walk(sys["rules"], "rules", docLabel, false);
      const fusion = (doc as { flags?: { fusion?: Record<string, unknown> } }).flags?.fusion;
      walk(fusion?.["unconvertedRules"], "unconvertedRules", docLabel, false);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no document carries gmNotes/publicNotes/privateNotes prose", () => {
    const offenders: string[] = [];
    for (const doc of docs) {
      const sys = doc.system as Record<string, unknown>;
      for (const field of ["gmNotes", "publicNotes", "privateNotes"]) {
        const value = sys[field];
        if (typeof value === "string" && value.length > 0) {
          offenders.push(`"${doc.name}": system.${field} non-empty`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Document identity in the pack INDEX (issue #41)
//
// The project rule is "document identity is `flags.fusion.sourceId`, never the
// name" — a homonym is normal in PF2e (the spell and the ancestry feature both
// named "Unusual Anatomy"). Client code already honours it: spellHeal.ts builds
// a `uuidBySourceId` map from `entry.index["flags.fusion.sourceId"]` and tries
// the sourceId BEFORE the name.
//
// But no pack declared that field in `indexFields`, so the value was always
// undefined, the map was always empty, and resolution ALWAYS degraded to the
// name. The rule was violated in practice by code that looked like it obeyed.
// ---------------------------------------------------------------------------

const SOURCE_ID_FIELD = "flags.fusion.sourceId";

/** Read a dot-path out of a plain object, like the index builders do. */
function readDotPath(obj: unknown, path: string): unknown {
  let value: unknown = obj;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
    if (value === undefined) return undefined;
  }
  return value;
}

interface IndexEntry {
  _id: string;
  index?: Record<string, unknown>;
}

function loadIndexJson(slug: string): IndexEntry[] | null {
  const path = resolve(PACKS_ROOT, slug, "index.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as IndexEntry[];
}

describe("packs-validation: sourceId is resolvable from the index (issue #41)", () => {
  it.each(listPackSlugs())("%s declares flags.fusion.sourceId in indexFields", (slug) => {
    const manifest = loadPackJson(slug);
    expect(
      manifest.indexFields,
      `${slug}/pack.json must index ${SOURCE_ID_FIELD} — without it every sourceId lookup silently falls back to the name`,
    ).toContain(SOURCE_ID_FIELD);
  });

  it.each(listPackSlugs())("%s's committed index.json carries every sourceId", (slug) => {
    const index = loadIndexJson(slug);
    if (index === null) return; // index.json is optional; the server rebuilds from documents.json

    const sourceIdByDocId = new Map<string, string>();
    for (const doc of loadDocuments(slug)) {
      const sourceId = readDotPath(doc, SOURCE_ID_FIELD);
      if (typeof sourceId === "string" && sourceId.length > 0) {
        sourceIdByDocId.set(String((doc as unknown as { _id: string })._id), sourceId);
      }
    }

    const missing: string[] = [];
    for (const entry of index) {
      const expected = sourceIdByDocId.get(entry._id);
      if (expected === undefined) continue; // doc genuinely has no sourceId
      if (entry.index?.[SOURCE_ID_FIELD] !== expected) missing.push(entry._id);
    }

    expect(
      missing.slice(0, 5),
      `${slug}/index.json is stale for ${String(missing.length)} entrie(s) — regenerate it after changing indexFields`,
    ).toEqual([]);
  });

  it("no two documents inside a pack share a sourceId (it must be a key)", () => {
    const offenders: string[] = [];
    for (const slug of listPackSlugs()) {
      const seen = new Map<string, string>();
      for (const doc of loadDocuments(slug)) {
        const sourceId = readDotPath(doc, SOURCE_ID_FIELD);
        if (typeof sourceId !== "string" || sourceId.length === 0) continue;
        const previous = seen.get(sourceId);
        if (previous !== undefined) {
          offenders.push(`${slug}: ${sourceId} used by both ${previous} and ${String(doc.name)}`);
        } else {
          seen.set(sourceId, String(doc.name));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. issue #1 — Player Core ancestries/backgrounds/heritages
//
// Before this fix, ancestries-core/backgrounds-core/heritages-core only
// carried the two hand-picked docs needed by the Magus/Finn fixtures
// (Ratfolk+Fleshwarp, Fireworks Performer+Aeronaut, 7 Ratfolk heritages +
// Sylph) — every OTHER PF2e sheet (Fighter, Cleric, ...) had ZERO playable
// ancestry to pick, so Speed stayed 0 ft and ancestry HP never applied
// (evidence: only 2 options in the "Escolher Ancestralidade" dialog).
// This block asserts the 8 Player Core ancestries are present, each with a
// mechanically valid ancestry (hp/speed/boosts) and at least one
// corresponding heritage in heritages-core — plus a regression guard that
// the pre-existing Magus/Finn fixtures were not dropped.
// ---------------------------------------------------------------------------

describe("packs-validation: issue #1 — Player Core ancestries/backgrounds/heritages", () => {
  const PLAYER_CORE_ANCESTRY_NAMES = [
    "Dwarf",
    "Elf",
    "Gnome",
    "Goblin",
    "Halfling",
    "Human",
    "Leshy",
    "Orc",
  ];

  const ancestries = loadDocuments("ancestries-core");
  const heritages = loadDocuments("heritages-core");
  const backgrounds = loadDocuments("backgrounds-core");

  it("ancestries-core contains all 8 Player Core ancestries, each with valid hp/speed/boosts", () => {
    const byName = new Map(ancestries.map((a) => [a.name, a]));
    const missing = PLAYER_CORE_ANCESTRY_NAMES.filter((name) => !byName.has(name));
    expect(
      missing,
      `ancestries-core missing Player Core ancestries: ${missing.join(", ")}`,
    ).toEqual([]);

    for (const name of PLAYER_CORE_ANCESTRY_NAMES) {
      const system = parseAncestrySystem(byName.get(name)!.system);
      expect(system.hp, `${name}: ancestry hp must be > 0`).toBeGreaterThan(0);
      expect(system.speed, `${name}: ancestry speed must be > 0`).toBeGreaterThan(0);
      expect(
        system.boosts.length,
        `${name}: ancestry must grant at least one boost slot`,
      ).toBeGreaterThan(0);
    }
  });

  it("every Player Core ancestry has at least one corresponding heritage in heritages-core", () => {
    const missing: string[] = [];
    for (const name of PLAYER_CORE_ANCESTRY_NAMES) {
      const slug = name.toLowerCase();
      const own = heritages.filter(
        (h) => (h.system as { ancestry?: { slug?: string } }).ancestry?.slug === slug,
      );
      if (own.length === 0) missing.push(name);
    }
    expect(missing, `ancestries with no heritage in heritages-core: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("backgrounds-core contains the 40 Player Core backgrounds", () => {
    const playerCoreCount = backgrounds.filter(
      (b) =>
        (b.system as { publication?: { title?: string } }).publication?.title ===
        "Pathfinder Player Core",
    ).length;
    expect(playerCoreCount).toBe(40);
  });

  it("regression guard: the pre-existing Magus/Finn fixtures are still present", () => {
    expect(ancestries.map((a) => a.name)).toEqual(expect.arrayContaining(["Ratfolk", "Fleshwarp"]));
    expect(backgrounds.map((b) => b.name)).toEqual(
      expect.arrayContaining(["Fireworks Performer", "Aeronaut"]),
    );
    expect(heritages.map((h) => h.name)).toEqual(expect.arrayContaining(["Snow Rat", "Sylph"]));
  });

  it("no ancestry/background/heritage doc leaks Paizo art (placeholder img only)", () => {
    for (const doc of [...ancestries, ...backgrounds, ...heritages]) {
      expect(
        typeof doc.img === "string" && doc.img.startsWith("icons/placeholder"),
        `${doc.name} (${doc.type}) has non-placeholder img: ${String(doc.img)}`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. issue #24 — skill/general feats of level >= 9
//
// Before this fix, isFeatsCoreDoc() in build-mvp-subset.mjs capped skill and
// general feats at level <= 8 (an R10-B acceptance-criterion cutoff for the
// single-character Tobias build, never revisited for the r22 12-class MVP
// that reaches character level 20). Every skill/general feat slot at level
// 9+ opened empty, and Rogue's "Steal Spell" (level 16) could never resolve
// its "Legendary Thief" prerequisite (a level-15 skill feat) because that
// document simply didn't exist in feats-core. This block asserts the cap is
// gone (representative feats above level 8, including the two acceptance
// anchors from the issue) without regressing the feats that were already
// below the old cutoff.
// ---------------------------------------------------------------------------

describe("packs-validation: issue #24 — skill/general feats level >= 9", () => {
  const feats = loadDocuments("feats-core");
  const byName = new Map(feats.map((f) => [f.name, f]));

  it("feats-core contains skill feats above the old level-8 cutoff, including the two acceptance anchors", () => {
    const expected: Array<[name: string, level: number]> = [
      ["Legendary Thief", 15], // Steal Spell (Rogue 16) prerequisite — the issue's headline case
      ["Scare to Death", 15], // resolves Raging Intimidation's grant for free (issue #16 overlap)
      ["Terrain Ghost", 18],
    ];
    for (const [name, level] of expected) {
      const doc = byName.get(name);
      expect(doc, `feats-core missing skill feat "${name}"`).toBeDefined();
      expect((doc!.system as { category?: string }).category).toBe("skill");
      expect((doc!.system as { level?: number }).level).toBe(level);
    }
  });

  it("feats-core contains general feats above the old level-8 cutoff", () => {
    const expected: Array<[name: string, level: number]> = [
      ["Incredible Investiture", 11],
      ["True Perception", 19],
    ];
    for (const [name, level] of expected) {
      const doc = byName.get(name);
      expect(doc, `feats-core missing general feat "${name}"`).toBeDefined();
      expect((doc!.system as { category?: string }).category).toBe("general");
      expect((doc!.system as { level?: number }).level).toBe(level);
    }
  });

  it("regression guard: skill/general feats at or below the old level-8 cutoff are still present", () => {
    expect(byName.has("Impressive Performance")).toBe(true); // Tobias acceptance criterion, skill, level 2
  });

  it("no skill/general feat above level 8 leaks Paizo art (placeholder img only)", () => {
    const highLevel = feats.filter((f) => {
      const system = f.system as { category?: string; level?: number };
      return (
        (system.category === "skill" || system.category === "general") && (system.level ?? 0) > 8
      );
    });
    expect(
      highLevel.length,
      "expected at least one skill/general feat above level 8",
    ).toBeGreaterThan(0);
    for (const doc of highLevel) {
      expect(
        typeof doc.img === "string" && doc.img.startsWith("icons/placeholder"),
        `${doc.name} (level ${(doc.system as { level?: number }).level}) has non-placeholder img: ${String(doc.img)}`,
      ).toBe(true);
    }
  });
});
