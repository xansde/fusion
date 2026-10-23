/**
 * Tests for compendium.ts shared types and helpers.
 *
 * REQ-CMP-007..009, REQ-CMP-013..014
 * Coverage:
 *   - buildCompendiumUuid / parseCompendiumUuid
 *   - normalizeSearchText
 *   - matchesTextSearch
 *   - matchesFilters
 *   - searchPackIndex
 *   - PackManifestSchema / PackIndexEntrySchema validation
 */

import { describe, it, expect } from "vitest";
import {
  buildPackDocUuid,
  parsePackDocUuid,
  normalizeSearchText,
  matchesTextSearch,
  matchesFilters,
  searchPackIndex,
  PackManifestSchema,
  PackIndexEntrySchema,
  PackI18nOverlaySchema,
} from "../compendium.js";
import type { PackIndexEntry } from "../compendium.js";
import { PackMechanicsOverlaySchema, GrantSchema } from "../mechanics.js";

// ---------------------------------------------------------------------------
// buildCompendiumUuid / parseCompendiumUuid
// ---------------------------------------------------------------------------

describe("buildPackDocUuid", () => {
  it("builds UUID in Compendium.<packId>.<DocType>.<docId> format", () => {
    const uuid = buildPackDocUuid("pf2e.conditions", "Item", "abc123");
    expect(uuid).toBe("Compendium.pf2e.conditions.Item.abc123");
  });
});

describe("parsePackDocUuid", () => {
  it("parses a valid compendium UUID", () => {
    const result = parsePackDocUuid("Compendium.pf2e.conditions.Item.abc123");
    expect(result).toEqual({ packId: "pf2e.conditions", docType: "Item", docId: "abc123" });
  });

  it("returns null for world UUIDs", () => {
    expect(parsePackDocUuid("Actor.abc123")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePackDocUuid("")).toBeNull();
  });

  it("returns null for missing parts", () => {
    expect(parsePackDocUuid("Compendium.pf2e.Item.abc123")).toBeNull();
  });

  it("round-trips with buildPackDocUuid", () => {
    const uuid = buildPackDocUuid("pf2e.bestiary-core", "Actor", "xyz789");
    const parsed = parsePackDocUuid(uuid);
    expect(parsed).toEqual({ packId: "pf2e.bestiary-core", docType: "Actor", docId: "xyz789" });
  });
});

// ---------------------------------------------------------------------------
// normalizeSearchText
// ---------------------------------------------------------------------------

describe("normalizeSearchText", () => {
  it("lowercases input", () => {
    expect(normalizeSearchText("FIREBALL")).toBe("fireball");
  });

  it("strips diacritics", () => {
    expect(normalizeSearchText("Maçã")).toBe("maca");
    expect(normalizeSearchText("Açúcar")).toBe("acucar");
    expect(normalizeSearchText("São Paulo")).toBe("sao paulo");
  });

  it("handles empty string", () => {
    expect(normalizeSearchText("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// matchesTextSearch
// ---------------------------------------------------------------------------

describe("matchesTextSearch", () => {
  const entry: PackIndexEntry = {
    _id: "abc",
    uuid: "Compendium.pf2e.test.Item.abc",
    name: "Fireball",
    img: null,
    type: "spell",
    index: {},
  };

  it("matches when query is in name", () => {
    expect(matchesTextSearch(entry, "fire")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesTextSearch(entry, "FIRE")).toBe(true);
  });

  it("does not match when query is not in name", () => {
    expect(matchesTextSearch(entry, "water")).toBe(false);
  });

  it("matches empty query (returns all)", () => {
    expect(matchesTextSearch(entry, "")).toBe(true);
  });

  it("matches accent-insensitively", () => {
    const accented: PackIndexEntry = { ...entry, name: "Maçã" };
    expect(matchesTextSearch(accented, "maca")).toBe(true);
  });

  // --- Bilingual search (T1): match EN name OR pt-BR namePt ---

  it("matches the pt-BR namePt when present (accent-insensitive)", () => {
    const translated: PackIndexEntry = {
      ...entry,
      name: "Basic Concoction",
      namePt: "Concocção Básica",
    };
    // pt-BR term (typed without diacritics) hits the namePt overlay
    expect(matchesTextSearch(translated, "concoccao")).toBe(true);
    // EN term still hits the EN name
    expect(matchesTextSearch(translated, "basic")).toBe(true);
    // A term in neither language matches nothing
    expect(matchesTextSearch(translated, "xyzzy")).toBe(false);
  });

  it("ignores namePt when it does not contain the query but name does", () => {
    const translated: PackIndexEntry = { ...entry, name: "Fireball", namePt: "Bola de Fogo" };
    expect(matchesTextSearch(translated, "fire")).toBe(true);
  });

  it("matches only via namePt when the EN name does not contain the query", () => {
    const translated: PackIndexEntry = { ...entry, name: "Fireball", namePt: "Bola de Fogo" };
    expect(matchesTextSearch(translated, "fogo")).toBe(true);
    expect(matchesTextSearch(translated, "bola")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchesFilters
// ---------------------------------------------------------------------------

describe("matchesFilters", () => {
  const entry: PackIndexEntry = {
    _id: "e1",
    uuid: "Compendium.pf2e.test.Item.e1",
    name: "Test",
    img: null,
    type: "weapon",
    index: {
      "system.level.value": 3,
      "system.traits.value": ["fire", "evocation"],
      "system.category": "martial",
    },
  };

  it("returns true for no filters", () => {
    expect(matchesFilters(entry, undefined)).toBe(true);
    expect(matchesFilters(entry, {})).toBe(true);
  });

  it("equality filter — scalar match", () => {
    expect(matchesFilters(entry, { "system.category": "martial" })).toBe(true);
    expect(matchesFilters(entry, { "system.category": "simple" })).toBe(false);
  });

  it("equality filter against array index value — any-of", () => {
    // scalar filter on an array field: item must include the value
    expect(matchesFilters(entry, { "system.traits.value": "fire" })).toBe(true);
    expect(matchesFilters(entry, { "system.traits.value": "cold" })).toBe(false);
  });

  it("array filter — any-of (at least one must match)", () => {
    expect(matchesFilters(entry, { "system.traits.value": ["fire", "cold"] })).toBe(true);
    expect(matchesFilters(entry, { "system.traits.value": ["cold", "water"] })).toBe(false);
  });

  it("lte range filter", () => {
    expect(matchesFilters(entry, { "system.level.value": { lte: 3 } })).toBe(true);
    expect(matchesFilters(entry, { "system.level.value": { lte: 2 } })).toBe(false);
  });

  it("gte range filter", () => {
    expect(matchesFilters(entry, { "system.level.value": { gte: 3 } })).toBe(true);
    expect(matchesFilters(entry, { "system.level.value": { gte: 4 } })).toBe(false);
  });

  it("contains filter on array", () => {
    expect(matchesFilters(entry, { "system.traits.value": { contains: "fire" } })).toBe(true);
    expect(matchesFilters(entry, { "system.traits.value": { contains: "acid" } })).toBe(false);
  });

  it("numeric level and trait combined", () => {
    const both = {
      "system.level.value": { lte: 5 },
      "system.traits.value": { contains: "evocation" },
    };
    expect(matchesFilters(entry, both)).toBe(true);
    const fail = {
      "system.level.value": { lte: 2 },
      "system.traits.value": { contains: "evocation" },
    };
    expect(matchesFilters(entry, fail)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// searchPackIndex
// ---------------------------------------------------------------------------

describe("searchPackIndex", () => {
  const entries: PackIndexEntry[] = [
    {
      _id: "c1",
      uuid: "Compendium.pf2e.cond.Item.c1",
      name: "Blinded",
      img: null,
      type: "condition",
      index: { "system.group": "senses" },
    },
    {
      _id: "c2",
      uuid: "Compendium.pf2e.cond.Item.c2",
      name: "Confused",
      img: null,
      type: "condition",
      index: { "system.group": "mental" },
    },
    {
      _id: "c3",
      uuid: "Compendium.pf2e.cond.Item.c3",
      name: "Blinking",
      img: null,
      type: "condition",
      index: { "system.group": "senses" },
    },
  ];

  it("filters by text", () => {
    const result = searchPackIndex(entries, { packId: "pf2e.cond", text: "blind" });
    expect(result.map((e) => e._id)).toEqual(["c1"]);
  });

  it("filters by group", () => {
    const result = searchPackIndex(entries, {
      packId: "pf2e.cond",
      filters: { "system.group": "senses" },
    });
    expect(result.map((e) => e._id)).toEqual(["c1", "c3"]);
  });

  it("returns all with empty query", () => {
    const result = searchPackIndex(entries, { packId: "pf2e.cond" });
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// PackManifestSchema
// ---------------------------------------------------------------------------

describe("PackManifestSchema", () => {
  it("validates a valid manifest", () => {
    const result = PackManifestSchema.safeParse({
      id: "pf2e.conditions",
      label: "PF2e Conditions",
      documentType: "Item",
      systemId: "pf2e",
      indexFields: ["system.group"],
      license: {
        license: "ORC",
        attribution: "Paizo",
        reservedNotice: "",
      },
      source: { repo: "github.com/foundryvtt/pf2e", version: "v14-dev", importerVersion: "0.1.0" },
      documentCount: 43,
      generatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown documentType", () => {
    const result = PackManifestSchema.safeParse({
      id: "pf2e.test",
      label: "Test",
      documentType: "Unknown",
      systemId: "pf2e",
      indexFields: [],
      license: { license: "ORC", attribution: "", reservedNotice: "" },
      source: { repo: null, version: null, importerVersion: "0.1.0" },
      documentCount: 0,
      generatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pack audience — REQ-CMP-004a (spec 16), REQ-CPD-070 (spec 43)
// ---------------------------------------------------------------------------

describe("PackManifestSchema audience", () => {
  /** A manifest without the `audience` field — a pack.json written before it existed. */
  function manifestWithout(audience?: unknown): Record<string, unknown> {
    const manifest: Record<string, unknown> = {
      id: "pf2e.conditions",
      label: "PF2e Conditions",
      documentType: "Item",
      systemId: "pf2e",
      indexFields: ["system.group"],
      license: { license: "ORC", attribution: "Paizo", reservedNotice: "" },
      source: { repo: "github.com/foundryvtt/pf2e", version: "v14-dev", importerVersion: "0.1.0" },
      documentCount: 43,
      generatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
    };
    if (audience !== undefined) manifest["audience"] = audience;
    return manifest;
  }

  it("REQ-CMP-004a: an absent audience parses as 'all' — an old pack stays visible to everyone", () => {
    const result = PackManifestSchema.safeParse(manifestWithout());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.audience).toBe("all");
  });

  it("REQ-CPD-070: a manifest may declare audience 'gm' and it survives parsing", () => {
    const result = PackManifestSchema.safeParse(manifestWithout("gm"));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.audience).toBe("gm");
  });

  it("REQ-CPD-070: declaring audience 'all' is accepted and kept", () => {
    const result = PackManifestSchema.safeParse(manifestWithout("all"));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.audience).toBe("all");
  });

  it("REQ-CMP-004a: rejects an audience outside the two declared values", () => {
    for (const bogus of ["player", "trusted", "GM", "", null, 4]) {
      const result = PackManifestSchema.safeParse(manifestWithout(bogus));
      expect(result.success, `audience ${JSON.stringify(bogus)} must not parse`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// PackIndexEntrySchema
// ---------------------------------------------------------------------------

describe("PackIndexEntrySchema", () => {
  it("validates a valid index entry", () => {
    const result = PackIndexEntrySchema.safeParse({
      _id: "abc123",
      uuid: "Compendium.pf2e.conditions.Item.abc123",
      name: "Blinded",
      img: "icons/placeholder/condition.svg",
      type: "condition",
      index: { "system.group": "senses" },
    });
    expect(result.success).toBe(true);
  });

  it("validates entry with null img", () => {
    const result = PackIndexEntrySchema.safeParse({
      _id: "abc123",
      uuid: "Compendium.pf2e.conditions.Item.abc123",
      name: "Test",
      img: null,
      type: null,
      index: {},
    });
    expect(result.success).toBe(true);
  });

  it("validates entry with the optional i18n + namePt overlay fields (T1)", () => {
    const result = PackIndexEntrySchema.safeParse({
      _id: "abc123",
      uuid: "Compendium.pf2e.feats-core.Item.abc123",
      name: "Basic Concoction",
      img: null,
      type: "feat",
      index: {},
      i18n: { ptBR: { name: "Concocção Básica", description: "<p>...</p>" } },
      namePt: "Concocção Básica",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PackI18nOverlaySchema (T1)
// ---------------------------------------------------------------------------

describe("PackI18nOverlaySchema", () => {
  const base = {
    schemaVersion: 1,
    packId: "pf2e.feats-core",
    locale: "pt-BR",
    generatedAt: "2026-07-05T00:00:00.000Z",
    generator: "tools/translate-packs@0.1.0",
    attribution: "Derived fan-content translation of the ORC/OGL EN text.",
    entries: {
      abc123: {
        name: "Concocção Básica",
        description: "<p>Você ganha um talento de alquimista.</p>",
        sourceHash: "deadbeef",
      },
    },
  };

  it("validates a full overlay", () => {
    expect(PackI18nOverlaySchema.safeParse(base).success).toBe(true);
  });

  it("accepts a name-only entry (no description)", () => {
    const nameOnly = {
      ...base,
      entries: { abc123: { name: "Concocção Básica", sourceHash: "deadbeef" } },
    };
    expect(PackI18nOverlaySchema.safeParse(nameOnly).success).toBe(true);
  });

  it("rejects a non-pt-BR locale", () => {
    expect(PackI18nOverlaySchema.safeParse({ ...base, locale: "en" }).success).toBe(false);
  });

  it("rejects an entry missing sourceHash", () => {
    const bad = { ...base, entries: { abc123: { name: "X" } } };
    expect(PackI18nOverlaySchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PackMechanicsOverlaySchema (T1)
// ---------------------------------------------------------------------------

describe("PackMechanicsOverlaySchema", () => {
  it("validates a grant entry (Basic Concoction shape)", () => {
    const overlay = {
      schemaVersion: 1,
      packId: "pf2e.feats-core",
      generatedAt: "2026-07-05T00:00:00.000Z",
      entries: {
        bduri70co98T1fwA: {
          sourceHash: "9a1b",
          grants: [
            {
              kind: "feat-choice",
              category: "class",
              count: 1,
              filters: { traits: ["alchemist"], maxLevel: 2 },
              labelKey: "FUSION.Sheet.Plan.SlotLabel.grantedFeat.basicConcoction",
              source: "rule-element",
              confidence: 1.0,
            },
          ],
          unlocks: [],
        },
      },
    };
    const result = PackMechanicsOverlaySchema.safeParse(overlay);
    expect(result.success).toBe(true);
  });

  it("validates an unlock entry (Adopted Ancestry shape)", () => {
    const overlay = {
      schemaVersion: 1,
      packId: "pf2e.feats-core",
      generatedAt: "2026-07-05T00:00:00.000Z",
      entries: {
        pP1ESEvFaPyF2OFM: {
          sourceHash: "7c22",
          grants: [],
          unlocks: [
            {
              kind: "ancestry-feat-eligibility",
              mechanism: "adopted-ancestry",
              filters: { excludeOwnAncestry: true },
              source: "rule-element",
              confidence: 1.0,
            },
          ],
        },
      },
    };
    expect(PackMechanicsOverlaySchema.safeParse(overlay).success).toBe(true);
  });

  it("defaults count to 1 and grants/unlocks to [] on a minimal entry", () => {
    const grant = GrantSchema.parse({
      kind: "feat-choice",
      category: "general",
      filters: {},
      source: "curated",
      confidence: 0.5,
    });
    expect(grant.count).toBe(1);

    const overlay = PackMechanicsOverlaySchema.parse({
      schemaVersion: 1,
      packId: "pf2e.feats-core",
      generatedAt: "2026-07-05T00:00:00.000Z",
      entries: { x: { sourceHash: "h" } },
    });
    expect(overlay.entries["x"]!.grants).toEqual([]);
    expect(overlay.entries["x"]!.unlocks).toEqual([]);
  });

  it("rejects an invalid grant category", () => {
    const overlay = {
      schemaVersion: 1,
      packId: "pf2e.feats-core",
      generatedAt: "2026-07-05T00:00:00.000Z",
      entries: {
        x: {
          sourceHash: "h",
          grants: [
            {
              kind: "feat-choice",
              category: "bogus",
              filters: {},
              source: "rule-element",
              confidence: 1,
            },
          ],
        },
      },
    };
    expect(PackMechanicsOverlaySchema.safeParse(overlay).success).toBe(false);
  });
});
