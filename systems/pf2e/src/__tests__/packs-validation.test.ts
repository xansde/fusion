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
      const items = (ancestry.system as { items?: Record<string, { uuid?: string; name?: string }> }).items ?? {};
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
    const items = (aeronaut!.system as { items?: Record<string, { uuid?: string; name?: string }> }).items ?? {};
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
          offenders.push(`"${doc.name}": actionType="action" but system.actions = ${JSON.stringify(actions)}`);
        }
      } else if (actions !== null && actions !== 1) {
        // Reactions/free actions occasionally carry actions:1 in the vendor
        // data (e.g. some free actions); passive/reaction never carry 2-3.
        offenders.push(`"${doc.name}": actionType="${String(actionType)}" but system.actions = ${JSON.stringify(actions)}`);
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
      .filter((d) => excluded.has((d.system as Record<string, unknown>)["fusionCategory"] as string))
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
