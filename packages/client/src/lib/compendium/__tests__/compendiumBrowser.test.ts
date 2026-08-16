/**
 * Tests for compendiumBrowser.ts — pure TS browser logic.
 *
 * REQ-CMP-012..018
 * Coverage:
 *   - groupPacksByType: groups and sorts packs
 *   - filterEntries: text search (accent-insensitive) + field filters
 *   - buildSearchQuery: UI state → CompendiumSearchPayload
 *   - buildCompendiumDragPayload: drag payload for actor/item
 *   - sortEntries: sort by name/level/type
 *   - buildDocumentPreview: extracts fields by type
 *   - highlightMatch: HTML escaping + mark wrapping
 */

import { describe, it, expect } from "vitest";
import type { PackManifest, PackIndexEntry } from "@fusion/shared";
import {
  groupPacksByType,
  filterEntries,
  buildSearchQuery,
  buildCompendiumDragPayload,
  sortEntries,
  buildDocumentPreview,
  highlightMatch,
  fallbackIcon,
  isKnownPlaceholderImg,
  entryDisplayName,
  entrySecondaryName,
} from "../compendiumBrowser.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeManifest(
  partial: Partial<PackManifest> & { id: string; documentType: PackManifest["documentType"] },
): PackManifest {
  return {
    label: partial.id,
    systemId: "pf2e",
    indexFields: [],
    license: {
      license: "ORC",
      attribution: "Test",
      reservedNotice: "",
    },
    // Parsed manifests always carry a resolved audience (REQ-CMP-004a).
    audience: "all",
    source: { repo: null, version: null, importerVersion: "0.1.0" },
    documentCount: 0,
    generatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 1,
    ...partial,
  };
}

function makeEntry(
  partial: Partial<PackIndexEntry> & { _id: string; name: string },
): PackIndexEntry {
  return {
    uuid: `Compendium.pf2e.test.Item.${partial._id}`,
    img: null,
    type: null,
    index: {},
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// groupPacksByType
// ---------------------------------------------------------------------------

describe("groupPacksByType", () => {
  it("groups packs by documentType and sorts by label within group", () => {
    const packs: PackManifest[] = [
      makeManifest({ id: "pf2e.weapons", documentType: "Item", label: "Weapons" }),
      makeManifest({ id: "pf2e.spells", documentType: "Item", label: "Spells" }),
      makeManifest({ id: "pf2e.bestiary", documentType: "Actor", label: "Bestiary" }),
    ];

    const groups = groupPacksByType(packs);

    // Actor group comes before Item group
    expect(groups[0]?.documentType).toBe("Actor");
    expect(groups[1]?.documentType).toBe("Item");

    // Within Item group, Spells < Weapons alphabetically
    expect(groups[1]?.packs[0]?.label).toBe("Spells");
    expect(groups[1]?.packs[1]?.label).toBe("Weapons");
  });

  it("returns empty array for empty input", () => {
    expect(groupPacksByType([])).toEqual([]);
  });

  it("handles single pack", () => {
    const packs = [
      makeManifest({ id: "pf2e.conditions", documentType: "Item", label: "Conditions" }),
    ];
    const groups = groupPacksByType(packs);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.documentType).toBe("Item");
    expect(groups[0]?.packs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// filterEntries
// ---------------------------------------------------------------------------

describe("filterEntries", () => {
  const entries: PackIndexEntry[] = [
    makeEntry({
      _id: "a1",
      name: "Fireball",
      type: "spell",
      index: { "system.level.value": 3, "system.traits.value": ["fire"] },
    }),
    makeEntry({
      _id: "a2",
      name: "Ice Storm",
      type: "spell",
      index: { "system.level.value": 4, "system.traits.value": ["cold", "evocation"] },
    }),
    makeEntry({ _id: "a3", name: "Longsword", type: "weapon", index: { "system.level.value": 0 } }),
    makeEntry({
      _id: "a4",
      name: "Firebolt",
      type: "spell",
      index: { "system.level.value": 1, "system.traits.value": ["fire"] },
    }),
  ];

  it("filters by text (case-insensitive)", () => {
    const result = filterEntries(entries, { packId: "p", text: "fire" });
    expect(result.map((e) => e._id)).toEqual(["a1", "a4"]);
  });

  it("filters by text (accent-insensitive)", () => {
    const accentedEntries = [
      makeEntry({ _id: "b1", name: "Maçã", type: "item", index: {} }),
      makeEntry({ _id: "b2", name: "Banana", type: "item", index: {} }),
    ];
    const result = filterEntries(accentedEntries, { packId: "p", text: "maca" });
    expect(result.map((e) => e._id)).toEqual(["b1"]);
  });

  it("filters by level range (lte)", () => {
    const result = filterEntries(entries, {
      packId: "p",
      filters: { "system.level.value": { lte: 3 } },
    });
    expect(result.map((e) => e._id)).toContain("a1"); // level 3
    expect(result.map((e) => e._id)).toContain("a3"); // level 0
    expect(result.map((e) => e._id)).toContain("a4"); // level 1
    expect(result.map((e) => e._id)).not.toContain("a2"); // level 4
  });

  it("filters by trait contains", () => {
    const result = filterEntries(entries, {
      packId: "p",
      filters: { "system.traits.value": { contains: "fire" } },
    });
    expect(result.map((e) => e._id)).toEqual(["a1", "a4"]);
  });

  it("filters by subtype equality", () => {
    const result = filterEntries(entries, {
      packId: "p",
      filters: { type: "weapon" },
    });
    expect(result.map((e) => e._id)).toEqual(["a3"]);
  });

  it("combines text and trait filter", () => {
    const result = filterEntries(entries, {
      packId: "p",
      text: "ice",
      filters: { "system.traits.value": { contains: "cold" } },
    });
    expect(result.map((e) => e._id)).toEqual(["a2"]);
  });

  it("returns all for empty query", () => {
    const result = filterEntries(entries, { packId: "p" });
    expect(result).toHaveLength(entries.length);
  });
});

// ---------------------------------------------------------------------------
// buildSearchQuery
// ---------------------------------------------------------------------------

describe("buildSearchQuery", () => {
  it("builds text-only query", () => {
    const q = buildSearchQuery("pf2e.weapons", { text: "sword" });
    expect(q.packId).toBe("pf2e.weapons");
    expect(q.text).toBe("sword");
    expect(q.filters).toBeUndefined();
  });

  it("builds subtype filter", () => {
    const q = buildSearchQuery("pf2e.items", { text: "", subtype: "weapon" });
    expect(q.filters?.["type"]).toBe("weapon");
  });

  it("builds trait filter", () => {
    const q = buildSearchQuery("pf2e.items", { text: "", trait: "fire" });
    expect(q.filters?.["system.traits.value"]).toEqual({ contains: "fire" });
  });

  it("builds level range filter", () => {
    const q = buildSearchQuery("pf2e.spells", { text: "", maxLevel: 3, minLevel: 1 });
    const levelFilter = q.filters?.["system.level.value"] as { lte?: number; gte?: number };
    expect(levelFilter).toBeDefined();
    expect(levelFilter.lte).toBe(3);
    expect(levelFilter.gte).toBe(1);
  });

  it("returns no filters when none set", () => {
    const q = buildSearchQuery("pf2e.conditions", { text: "" });
    expect(q.filters).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildCompendiumDragPayload
// ---------------------------------------------------------------------------

describe("buildCompendiumDragPayload", () => {
  const actorManifest = makeManifest({ id: "pf2e.bestiary", documentType: "Actor" });
  const itemManifest = makeManifest({ id: "pf2e.weapons", documentType: "Item" });

  it("builds actor drag payload", () => {
    const entry = makeEntry({ _id: "abc123", name: "Goblin", type: "npc", img: "icons/npc.svg" });
    const payload = buildCompendiumDragPayload(entry, actorManifest);
    expect(payload.kind).toBe("compendium-actor");
    expect(payload.uuid).toBe(entry.uuid);
    expect(payload.name).toBe("Goblin");
    expect(payload.img).toBe("icons/npc.svg");
  });

  it("builds item drag payload", () => {
    const entry = makeEntry({ _id: "xyz456", name: "Longsword", type: "weapon" });
    const payload = buildCompendiumDragPayload(entry, itemManifest);
    expect(payload.kind).toBe("compendium-item");
    expect(payload.packId).toBe("pf2e.weapons");
    expect(payload.documentType).toBe("Item");
  });
});

// ---------------------------------------------------------------------------
// sortEntries
// ---------------------------------------------------------------------------

describe("sortEntries", () => {
  const entries: PackIndexEntry[] = [
    makeEntry({ _id: "s1", name: "Zebra", index: { "system.level.value": 5 } }),
    makeEntry({ _id: "s2", name: "Alpha", index: { "system.level.value": 1 } }),
    makeEntry({ _id: "s3", name: "Mango", index: { "system.level.value": 3 } }),
  ];

  it("sorts by name ascending", () => {
    const sorted = sortEntries(entries, "name", true);
    expect(sorted.map((e) => e.name)).toEqual(["Alpha", "Mango", "Zebra"]);
  });

  it("sorts by name descending", () => {
    const sorted = sortEntries(entries, "name", false);
    expect(sorted.map((e) => e.name)).toEqual(["Zebra", "Mango", "Alpha"]);
  });

  it("sorts by level ascending", () => {
    const sorted = sortEntries(entries, "level", true);
    expect(sorted.map((e) => e._id)).toEqual(["s2", "s3", "s1"]);
  });

  it("does not mutate input", () => {
    const original = [...entries];
    sortEntries(entries, "level", false);
    expect(entries).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// buildDocumentPreview
// ---------------------------------------------------------------------------

describe("buildDocumentPreview", () => {
  it("extracts HP and AC for NPC actor", () => {
    const doc = {
      _id: "npc1",
      name: "Goblin",
      type: "npc",
      img: "icons/placeholder/npc.svg",
      system: {
        attributes: { hp: { max: 6 }, ac: { value: 14 } },
        traits: { value: ["goblin"] },
      },
    };
    const preview = buildDocumentPreview(doc);
    expect(preview.name).toBe("Goblin");
    expect(
      preview.fields.find((f) => f.labelKey === "FUSION.Compendium.Field.system.attributes.hp.max")
        ?.value,
    ).toBe("6");
    expect(
      preview.fields.find(
        (f) => f.labelKey === "FUSION.Compendium.Field.system.attributes.ac.value",
      )?.value,
    ).toBe("14");
    expect(
      preview.fields.find((f) => f.labelKey === "FUSION.Compendium.Field.system.traits.value")
        ?.value,
    ).toContain("goblin");
  });

  it("extracts level for spells", () => {
    const doc = {
      _id: "spell1",
      name: "Fireball",
      type: "spell",
      system: {
        level: { value: 3 },
        traits: { value: ["fire", "evocation"] },
        traditions: { value: ["arcane"] },
      },
    };
    const preview = buildDocumentPreview(doc);
    expect(
      preview.fields.find((f) => f.labelKey === "FUSION.Compendium.Field.system.level.value")
        ?.value,
    ).toBe("3");
    expect(
      preview.fields.find((f) => f.labelKey === "FUSION.Compendium.Field.system.traditions.value")
        ?.value,
    ).toContain("arcane");
  });

  it("extracts damage for weapons", () => {
    const doc = {
      _id: "w1",
      name: "Longsword",
      type: "weapon",
      system: {
        damage: { die: "1d8", damageType: "slashing" },
        level: { value: 0 },
      },
    };
    const preview = buildDocumentPreview(doc);
    expect(
      preview.fields.find((f) => f.labelKey === "FUSION.Compendium.Field.system.damage")?.value,
    ).toContain("1d8");
  });

  it("extracts readable fields from system.rules[] (e.g. Blinded condition)", () => {
    const doc = {
      _id: "cond1",
      name: "Blinded",
      type: "condition",
      system: {
        rules: [
          { kind: "flat-modifier", selector: "perception", value: -4, type: "status" },
          { kind: "flat-modifier", subkind: "immunity", damageType: "visual" },
        ],
      },
    };
    const preview = buildDocumentPreview(doc);
    expect(
      preview.fields.some(
        (f) =>
          f.labelKey === "FUSION.Compendium.Preview.Rule.Modifier" &&
          f.value.includes("perception") &&
          f.value.includes("-4"),
      ),
    ).toBe(true);
    expect(
      preview.fields.some(
        (f) =>
          f.labelKey === "FUSION.Compendium.Preview.Rule.Immunity" && f.value.includes("visual"),
      ),
    ).toBe(true);
  });

  it("falls back to a generic label for unmapped rule kinds", () => {
    const doc = {
      _id: "misc1",
      name: "Weird Thing",
      type: "feat",
      system: {
        rules: [{ kind: "some-unmapped-kind", note: "Something happens" }],
      },
    };
    const preview = buildDocumentPreview(doc);
    expect(preview.fields.some((f) => f.value.includes("some-unmapped-kind"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isKnownPlaceholderImg / fallbackIcon
// ---------------------------------------------------------------------------

describe("isKnownPlaceholderImg", () => {
  it("treats known placeholder paths as unusable", () => {
    expect(isKnownPlaceholderImg("icons/placeholder/npc.svg")).toBe(true);
  });

  it("treats null/undefined/empty as unusable", () => {
    expect(isKnownPlaceholderImg(null)).toBe(true);
    expect(isKnownPlaceholderImg(undefined)).toBe(true);
    expect(isKnownPlaceholderImg("")).toBe(true);
  });

  it("treats a real image path as usable", () => {
    expect(isKnownPlaceholderImg("icons/real/npc.png")).toBe(false);
  });
});

describe("fallbackIcon", () => {
  it("returns a distinct icon per Actor subtype", () => {
    expect(fallbackIcon("Actor", "npc")).not.toBe(fallbackIcon("Item", "weapon"));
  });

  it("returns a generic icon for unknown documentType", () => {
    expect(fallbackIcon("Whatever", null)).toBe("❓");
  });
});

// ---------------------------------------------------------------------------
// highlightMatch
// ---------------------------------------------------------------------------

describe("highlightMatch", () => {
  it("wraps matching text in <mark>", () => {
    expect(highlightMatch("Fireball", "fire")).toBe("<mark>Fire</mark>ball");
  });

  it("is case-insensitive", () => {
    expect(highlightMatch("FIRE", "fire")).toBe("<mark>FIRE</mark>");
  });

  it("returns escaped HTML when no match", () => {
    expect(highlightMatch("Longsword", "fire")).toBe("Longsword");
  });

  it("escapes HTML in text", () => {
    expect(highlightMatch("<Spell>", "spell")).toBe("&lt;<mark>Spell</mark>&gt;");
  });

  it("returns escaped HTML for empty query", () => {
    expect(highlightMatch("Hello <world>", "")).toBe("Hello &lt;world&gt;");
  });
});

// ---------------------------------------------------------------------------
// Bilingual display (T1): entryDisplayName / entrySecondaryName
// ---------------------------------------------------------------------------

describe("entryDisplayName / entrySecondaryName", () => {
  const translated = makeEntry({
    _id: "c1",
    name: "Confused",
    type: "condition",
    namePt: "Confuso",
    i18n: { ptBR: { name: "Confuso", description: "Você está confuso." } },
  });

  const untranslated = makeEntry({ _id: "c2", name: "Blinded", type: "condition" });

  it("shows the pt-BR name when locale is pt-BR and a translation exists", () => {
    expect(entryDisplayName(translated, "pt-BR")).toBe("Confuso");
  });

  it("shows the EN name as a secondary line when displaying pt-BR", () => {
    expect(entrySecondaryName(translated, "pt-BR")).toBe("Confused");
  });

  it("falls back to the EN name when locale is en", () => {
    expect(entryDisplayName(translated, "en")).toBe("Confused");
    // No secondary EN line when we are already showing EN.
    expect(entrySecondaryName(translated, "en")).toBeNull();
  });

  it("falls back to the EN name when no translation exists (pt-BR locale)", () => {
    expect(entryDisplayName(untranslated, "pt-BR")).toBe("Blinded");
    expect(entrySecondaryName(untranslated, "pt-BR")).toBeNull();
  });

  it("reads i18n.ptBR.name when namePt flat field is absent", () => {
    const bagOnly = makeEntry({
      _id: "c3",
      name: "Fatigued",
      i18n: { ptBR: { name: "Fatigado" } },
    });
    expect(entryDisplayName(bagOnly, "pt-BR")).toBe("Fatigado");
    expect(entrySecondaryName(bagOnly, "pt-BR")).toBe("Fatigued");
  });
});

// ---------------------------------------------------------------------------
// each_key_duplicate regression (bug #2): Confused preview
// ---------------------------------------------------------------------------

describe("buildDocumentPreview — unique field keys (each_key_duplicate fix)", () => {
  // Reproduces the real "Confused" condition: multiple rules that all fall
  // back to the SAME pt-BR label ("Regra"). Before the fix, the Svelte
  // {#each ... (field.label)} used the label as the key → duplicate keys →
  // Error: each_key_duplicate → the preview spinner spun forever.
  const confusedDoc = {
    _id: "CxtsDpc5Pt0PQPBU",
    name: "Confused",
    type: "condition",
    system: {
      rules: [
        { kind: "roll-option", slug: "target:ally", domain: "all" },
        { kind: "roll-option", slug: "origin:ally", domain: "all" },
        { kind: "grant-item", uuid: "Compendium.pf2e.conditionitems.Item.Off-Guard" },
        { kind: "roll-note", selector: "damage-received", title: "{item|name}" },
      ],
    },
  };

  it("produces a UNIQUE key for every field even when labels collide", () => {
    const preview = buildDocumentPreview(confusedDoc, "pt-BR");
    const keys = preview.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not silently drop any of Confused's four rules", () => {
    const preview = buildDocumentPreview(confusedDoc, "pt-BR");
    // Four rules → four preview fields (Confused has no level/traits/etc.).
    expect(preview.fields).toHaveLength(4);
  });

  it("keeps the human-readable label alongside the unique key", () => {
    const preview = buildDocumentPreview(confusedDoc, "pt-BR");
    // The two roll-options and grant-item collapse to the generic "Regra"
    // label — the collision that used to break keying.
    const regraCount = preview.fields.filter(
      (f) => f.labelKey === "FUSION.Compendium.Preview.Rule.Generic",
    ).length;
    expect(regraCount).toBeGreaterThanOrEqual(2);
    // Every field still carries a label and a key.
    for (const f of preview.fields) {
      expect(f.fallbackLabel.length).toBeGreaterThan(0);
      expect(f.key.length).toBeGreaterThan(0);
    }
  });

  it("still yields unique keys for the Blinded control (distinct labels)", () => {
    const blindedDoc = {
      _id: "b1",
      name: "Blinded",
      type: "condition",
      system: {
        rules: [
          { kind: "flat-modifier", selector: "perception", value: -4, type: "status" },
          { kind: "flat-modifier", subkind: "immunity", damageType: "visual" },
        ],
      },
    };
    const preview = buildDocumentPreview(blindedDoc, "pt-BR");
    const keys = preview.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// buildDocumentPreview — localized name + description (T1)
// ---------------------------------------------------------------------------

describe("buildDocumentPreview — localization", () => {
  const doc = {
    _id: "cond1",
    name: "Confused",
    type: "condition",
    system: { description: "You are addled." },
    i18n: { ptBR: { name: "Confuso", description: "Você está transtornado." } },
  };

  it("prefers the pt-BR overlay name and exposes the EN name as secondary", () => {
    const preview = buildDocumentPreview(doc, "pt-BR");
    expect(preview.name).toBe("Confuso");
    expect(preview.nameSecondary).toBe("Confused");
  });

  it("prefers the pt-BR overlay description", () => {
    const preview = buildDocumentPreview(doc, "pt-BR");
    expect(preview.description).toBe("Você está transtornado.");
  });

  it("falls back to the EN name and description under the en locale", () => {
    const preview = buildDocumentPreview(doc, "en");
    expect(preview.name).toBe("Confused");
    expect(preview.nameSecondary).toBeNull();
    expect(preview.description).toBe("You are addled.");
  });

  it("falls back to the EN description when no pt-BR overlay exists", () => {
    const enOnly = {
      _id: "x",
      name: "Blinded",
      type: "condition",
      system: { description: "You cannot see." },
    };
    const preview = buildDocumentPreview(enOnly, "pt-BR");
    expect(preview.name).toBe("Blinded");
    expect(preview.nameSecondary).toBeNull();
    expect(preview.description).toBe("You cannot see.");
  });

  it("yields a null description when the document carries none", () => {
    const noDesc = { _id: "y", name: "Thing", type: "condition", system: {} };
    expect(buildDocumentPreview(noDesc, "pt-BR").description).toBeNull();
  });
});
