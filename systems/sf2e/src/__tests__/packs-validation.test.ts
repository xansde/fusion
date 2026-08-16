/**
 * @fusion/system-sf2e — Pack validation tests.
 *
 * Mirrors `systems/pf2e/src/__tests__/packs-validation.test.ts` (R10-B3):
 * loads every `systems/sf2e/packs/<slug>/documents.json` produced by
 * tools/importer-pf2e (--system sf2e) and validates every document against
 * the real Zod schema for its `type`, plus a set of domain invariants
 * (clean-room description stripping, pack.json license/attribution blocks).
 *
 * Clean-room: mechanical facts / structural shape are asserted here.
 * `system.description` (policy update W2-C1, REQ-LEG-010, 2026-07-05) is
 * PRESERVED whenever the document's `system.publication.license` is ORC or
 * OGL — licensed rules text, redistributable with attribution — and stays
 * blank only for documents without an ORC/OGL publication (e.g. NPC actors,
 * whose lore fields remain always stripped, asserted explicitly below).
 *
 * REQ-SF2-003, REQ-SF2-044..048.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseWeaponSystem } from "../schemas/item-weapon.js";
import { parseArmorSystem } from "../schemas/item-armor.js";
import { parseEffectSystem } from "../schemas/item-effect.js";
import { parseSpellSystem } from "../schemas/item-spell.js";
import { parseNpcSystem } from "../schemas/actor-npc.js";
import { parseEquipmentSystem } from "../schemas/item-equipment.js";

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
  /** Who may see the shelf. Absent parses as "all" (REQ-CMP-004a). */
  audience?: string;
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

/**
 * Zod parse* functions keyed by document `type`. The sf2e vendor compendium
 * does not always use the Fusion-conceptual type name for its Foundry
 * document `type` field:
 *   - conditions pack: `type: "effect"` (not "condition") — see
 *     systems/sf2e/src/schemas/item-effect.ts docstring.
 *   - augmentations-core pack: `type: "equipment"` (not "augmentation") —
 *     the real compendium models augmentations as generic equipment with
 *     `usage: "implanted"` and an `augType` trait-derived field; see
 *     systems/sf2e/src/schemas/item-augmentation.ts docstring and
 *     tools/importer-pf2e/src/transform.mjs normalizeEquipmentSystem.
 */
const PARSERS_BY_TYPE: Record<string, (data: unknown) => unknown> = {
  weapon: parseWeaponSystem,
  armor: parseArmorSystem,
  effect: parseEffectSystem,
  spell: parseSpellSystem,
  npc: parseNpcSystem,
  equipment: parseEquipmentSystem,
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

describe("packs-validation (sf2e): every document validates against its Zod schema", () => {
  const slugs = listPackSlugs();

  it("discovers at least the MVP sf2e packs", () => {
    expect(slugs).toEqual(
      expect.arrayContaining([
        "conditions",
        "weapons-core",
        "armor-core",
        "augmentations-core",
        "bestiary-core",
        "spells-core",
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
// 2. Clean-room invariants
// ---------------------------------------------------------------------------

describe("packs-validation (sf2e): clean-room invariants", () => {
  const slugs = listPackSlugs();

  it("system.description is present only on documents whose system.publication.license is ORC or OGL (policy update W2-C1, stripFlavorProse)", () => {
    const offenders: string[] = [];
    const REDISTRIBUTABLE = new Set(["ORC", "OGL"]);
    for (const slug of slugs) {
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

  it("no document in any pack has a non-placeholder img (Paizo art policy)", () => {
    const offenders: string[] = [];
    for (const slug of slugs) {
      for (const doc of loadDocuments(slug)) {
        const img = doc.img;
        if (typeof img === "string" && img.length > 0 && !img.startsWith("icons/placeholder")) {
          offenders.push(`[${slug}] "${doc.name}": img = "${img}"`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every pack.json has a license block with attribution", () => {
    const failures: string[] = [];
    for (const slug of slugs) {
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
  // Pack audience — REQ-CMP-004a, REQ-CMP-010a, REQ-CPD-071
  //
  // The alien bestiary is a shelf of creatures exactly like the pf2e one, and
  // the same `writePack` in tools/importer-pf2e generates both. The audience,
  // however, is only *declared* here: an absent `audience` parses as `"all"`
  // (REQ-CMP-004a), so a manifest that stays silent is a manifest published to
  // the players — the leak REQ-CPD-071 exists to close, and the reason these
  // assertions read the committed file instead of trusting the generator.
  //
  // Note on requirement ownership: spec 17 spells this out for PF2e
  // (REQ-PF2-140..145) and spec 43 names PF2e in REQ-CPD-072; spec 18 never got
  // the sibling amendment, so what binds SF2e today is the system-agnostic pair
  // REQ-CMP-004a + REQ-CPD-071. Registered as an open question.
  //
  // The rule is read from what each pack CONTAINS, never from a list of slugs —
  // same rule the generator applies (tools/importer-pf2e/src/pack-audience.mjs),
  // so the next alien pack is born `gm` without anyone editing a list here.
  // ---------------------------------------------------------------------------

  const GM_ONLY_DOCUMENT_TYPES = new Set(["npc", "hazard"]);

  const gmOnlySlugs = slugs.filter((slug) =>
    loadDocuments(slug).some((doc) => GM_ONLY_DOCUMENT_TYPES.has(doc.type)),
  );

  it("REQ-CMP-004a: every sf2e pack.json declares an audience — silence would publish it to everyone", () => {
    const missing = slugs.filter((slug) => loadPackJson(slug).audience === undefined);
    expect(missing, `packs without a declared audience: ${missing.join(", ")}`).toEqual([]);
  });

  it("REQ-CPD-071 / REQ-CMP-010a: every sf2e pack carrying creatures is published with audience 'gm'", () => {
    // Non-vacuity guard: the content detector must actually be finding the
    // alien bestiary, otherwise the loop below would pass for free.
    expect(gmOnlySlugs, "no creature pack found — the content detector is broken").toContain(
      "bestiary-core",
    );

    const offenders: string[] = [];
    for (const slug of gmOnlySlugs) {
      const packJson = loadPackJson(slug);
      if (packJson.documentType !== "Actor") {
        offenders.push(
          `[${slug}] carries creatures but documentType is "${packJson.documentType}"`,
        );
      }
      if (packJson.audience !== "gm") {
        offenders.push(`[${slug}] audience is "${String(packJson.audience)}", expected "gm"`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("REQ-CMP-004a: every sf2e pack without creatures or hazards is published with audience 'all'", () => {
    const offenders: string[] = [];
    for (const slug of slugs) {
      if (gmOnlySlugs.includes(slug)) continue;
      const packJson = loadPackJson(slug);
      if (packJson.audience !== "all") {
        offenders.push(`[${slug}] audience is "${String(packJson.audience)}", expected "all"`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
