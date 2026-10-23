/**
 * resultLine.test.ts — the view model of one compendium line (spec 43 §5.5, G093).
 *
 * Covers REQ-CPD-040 (image or type icon, translated name plus the original),
 * REQ-CPD-041 (the index fields the PACK declared, with no document loaded),
 * REQ-CPD-042 (the matched run marked), REQ-CPD-043 (the in-world seal, which
 * informs and promises nothing — DEC-CPD-12), REQ-CPD-044 (draggable only where
 * §5.7 gives a destination), REQ-CPD-045 (a broken or placeholder image falls
 * back to the type icon) and REQ-CPD-046 (no creature statistic on an
 * unprivileged line).
 */

import { describe, expect, it } from "vitest";
import type { PackIndexEntry } from "@fusion/shared";

import {
  buildResultLine,
  buildWorldOriginIndex,
  entryIsInWorld,
  fieldFallbackLabel,
  hasDragDestination,
  highlightSegments,
  isCreatureStatField,
  isPlaceholderImage,
  matchesQuery,
  resolveFieldLabel,
  resultLineIcon,
  type ResultLineContext,
} from "../resultLine.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<PackIndexEntry> = {}): PackIndexEntry {
  return {
    _id: "abc0123456789def",
    uuid: "Compendium.pf2e.spells-core.Item.abc0123456789def",
    name: "Fireball",
    img: "icons/spells/fireball.webp",
    type: "spell",
    index: {},
    ...overrides,
  } as PackIndexEntry;
}

const TRANSLATED = makeEntry({
  name: "Fireball",
  namePt: "Bola de Fogo",
  i18n: { ptBR: { name: "Bola de Fogo" } },
  index: { "system.level.value": 3, "system.traits.value": ["fire", "arcane"] },
});

function context(overrides: Partial<ResultLineContext> = {}): ResultLineContext {
  return {
    documentType: "Item",
    packId: "pf2e.spells-core",
    indexFields: ["system.level.value", "system.traits.value"],
    locale: "pt-BR",
    viewerIsPrivileged: false,
    ...overrides,
  };
}

/** Flatten segments back to text, to assert nothing was lost in the split. */
function textOf(segments: readonly { text: string }[] | null): string {
  return (segments ?? []).map((s) => s.text).join("");
}

function markedOf(segments: readonly { text: string; matched: boolean }[] | null): string[] {
  return (segments ?? []).filter((s) => s.matched).map((s) => s.text);
}

// ---------------------------------------------------------------------------

describe("REQ-CPD-040: two names, the translated one in front", () => {
  it("shows the pt-BR name as the headline and the original underneath", () => {
    const line = buildResultLine(TRANSLATED, context());

    expect(line.nameText).toBe("Bola de Fogo");
    expect(line.secondaryNameText).toBe("Fireball");
  });

  it("drops the second line when there is only one name to show", () => {
    const line = buildResultLine(makeEntry({ name: "Fireball" }), context());

    expect(line.nameText).toBe("Fireball");
    expect(line.secondaryNameText).toBeNull();
    expect(line.secondaryName).toBeNull();
  });

  it("falls back to the original name when the reader is not reading pt-BR", () => {
    const line = buildResultLine(TRANSLATED, context({ locale: "en" }));

    expect(line.nameText).toBe("Fireball");
    expect(line.secondaryNameText).toBeNull();
  });

  it("names a type icon for every document type, and one for the unknown", () => {
    expect(resultLineIcon("Actor")).toBe("actor");
    expect(resultLineIcon("JournalEntry")).toBe("journal");
    expect(resultLineIcon("Whatever")).toBe("unknown");
  });
});

describe("REQ-CPD-041: the fields the pack declared, without loading the document", () => {
  it("shows exactly the declared paths that the entry carries a value for", () => {
    const line = buildResultLine(TRANSLATED, context({ viewerIsPrivileged: true }));

    expect(line.fields.map((f) => f.key)).toEqual(["system.level.value", "system.traits.value"]);
    expect(line.fields[0]?.value).toBe("3");
    // Arrays flatten to text; nothing here needed the full document.
    expect(line.fields[1]?.value).toBe("fire, arcane");
  });

  it("ignores a declared path the entry has no value for, instead of drawing a blank", () => {
    const line = buildResultLine(
      makeEntry({ index: { "system.level.value": 1 } }),
      context({ indexFields: ["system.level.value", "system.group"] }),
    );

    expect(line.fields.map((f) => f.key)).toEqual(["system.level.value"]);
  });

  it("never draws a field the pack did not declare, even when the index carries it", () => {
    const line = buildResultLine(
      makeEntry({ index: { "system.level.value": 1, "system.group": "sword" } }),
      context({ indexFields: ["system.level.value"] }),
    );

    expect(line.fields.map((f) => f.key)).toEqual(["system.level.value"]);
  });

  it("keeps the origin flags out of sight — they feed the seal, they are not a field", () => {
    const line = buildResultLine(
      makeEntry({ index: { "flags.fusion.sourceId": "src-1", "system.level.value": 2 } }),
      context({ indexFields: ["flags.fusion.sourceId", "system.level.value"] }),
    );

    expect(line.fields.map((f) => f.key)).toEqual(["system.level.value"]);
  });

  it("labels a field the bundle does not name with a word, never with the raw key", () => {
    const line = buildResultLine(
      makeEntry({ index: { "system.made.up.value": "x" } }),
      context({ indexFields: ["system.made.up.value"] }),
    );

    const field = line.fields[0];
    expect(field).toBeDefined();
    // The resolver answers with the key itself when it misses — the fallback wins.
    expect(resolveFieldLabel(field!, (key) => key)).toBe("Up");
    expect(fieldFallbackLabel("system.level.value")).toBe("Level");
    // A bundle that DOES name it wins over the fallback.
    expect(resolveFieldLabel(field!, () => "Inventado")).toBe("Inventado");
  });
});

describe("REQ-CPD-042: the run that matched is marked", () => {
  it("marks the matched run inside the translated name", () => {
    const line = buildResultLine(TRANSLATED, context({ search: "fogo" }));

    expect(textOf(line.name)).toBe("Bola de Fogo");
    expect(markedOf(line.name)).toEqual(["Fogo"]);
  });

  it("marks it in the original name too, so typing either language shows why", () => {
    const line = buildResultLine(TRANSLATED, context({ search: "ball" }));

    expect(markedOf(line.name)).toEqual([]);
    expect(markedOf(line.secondaryName)).toEqual(["ball"]);
  });

  it("marks a match that landed inside a declared field", () => {
    const line = buildResultLine(
      TRANSLATED,
      context({ search: "arcane", viewerIsPrivileged: true }),
    );

    expect(markedOf(line.fields[1]?.segments ?? [])).toEqual(["arcane"]);
  });

  it("ignores case and accents, exactly like the search that produced the hit", () => {
    expect(markedOf(highlightSegments("Ilusão Menor", "ilusao"))).toEqual(["Ilusão"]);
    expect(markedOf(highlightSegments("Ilusão Menor", "MENOR"))).toEqual(["Menor"]);
    expect(matchesQuery("Ilusão Menor", "ilusao")).toBe(true);
    expect(matchesQuery("Ilusão Menor", "fogo")).toBe(false);
  });

  it("keeps the text intact whatever it marks, and marks nothing without a query", () => {
    const accented = "Áurea Ação de Núvem";
    for (const query of ["", "  ", "aurea", "acao", "nuvem", "de"]) {
      expect(textOf(highlightSegments(accented, query))).toBe(accented);
    }
    expect(markedOf(highlightSegments(accented, ""))).toEqual([]);
    // Every occurrence is marked, not only the first.
    expect(markedOf(highlightSegments("ba ba ba", "ba"))).toHaveLength(3);
  });
});

describe("REQ-CPD-043: the in-world seal informs, and promises nothing (DEC-CPD-12)", () => {
  const IN_PACK = makeEntry({
    index: { "flags.fusion.sourceId": "vendor-src-1" },
  });

  /** A world clone: new `_id`, no uuid — only `flags.fusion` survived. */
  const WORLD_CLONE = {
    _id: "worldid000000001",
    name: "Fireball",
    flags: { fusion: { sourceId: "vendor-src-1", packName: "spells" } },
  };

  it("lights up when a world document came from this entry", () => {
    const index = buildWorldOriginIndex([WORLD_CLONE]);

    expect(entryIsInWorld(IN_PACK, index)).toBe(true);
    expect(buildResultLine(IN_PACK, context({ worldOrigins: index })).inWorld).toBe(true);
  });

  it("stays dark for an entry nothing in the world came from", () => {
    const index = buildWorldOriginIndex([WORLD_CLONE]);
    const other = makeEntry({ index: { "flags.fusion.sourceId": "vendor-src-2" } });

    expect(entryIsInWorld(other, index)).toBe(false);
  });

  it("does not match on `_id`, because the clone gets a new one (REQ-CMP-021)", () => {
    // Same document, imported: the world copy's `_id` differs from the pack's.
    const index = buildWorldOriginIndex([{ _id: IN_PACK._id, flags: {} }]);

    expect(entryIsInWorld(IN_PACK, index)).toBe(false);
  });

  it("stays dark for an entry whose pack declares no origin to compare", () => {
    const index = buildWorldOriginIndex([WORLD_CLONE]);

    expect(entryIsInWorld(makeEntry({ index: {} }), index)).toBe(false);
  });

  it("requires the pack name to agree when the entry declares one", () => {
    const index = buildWorldOriginIndex([WORLD_CLONE]);
    const agreeing = makeEntry({
      index: { "flags.fusion.sourceId": "vendor-src-1", "flags.fusion.packName": "spells" },
    });
    const disagreeing = makeEntry({
      index: { "flags.fusion.sourceId": "vendor-src-1", "flags.fusion.packName": "equipment" },
    });

    expect(entryIsInWorld(agreeing, index)).toBe(true);
    expect(entryIsInWorld(disagreeing, index)).toBe(false);
  });

  it("survives world documents that carry no fusion flags at all", () => {
    const index = buildWorldOriginIndex([{}, null, "nonsense", { flags: { fusion: {} } }]);

    expect(index.bySourceId.size).toBe(0);
    expect(entryIsInWorld(IN_PACK, index)).toBe(false);
  });
});

describe("REQ-CPD-044: draggable only where there is somewhere to drop", () => {
  it("gives Actor and Item a destination, and nothing else", () => {
    expect(hasDragDestination("Actor")).toBe(true);
    expect(hasDragDestination("Item")).toBe(true);
    for (const type of ["JournalEntry", "RollTable", "Macro", "Scene", "Playlist"]) {
      expect(hasDragDestination(type)).toBe(false);
    }
  });

  it("marks the line itself, so a line with no destination is not picked up", () => {
    expect(buildResultLine(makeEntry(), context({ documentType: "Actor" })).draggable).toBe(true);
    expect(buildResultLine(makeEntry(), context({ documentType: "JournalEntry" })).draggable).toBe(
      false,
    );
  });
});

describe("REQ-CPD-045: a picture that never arrives is not a hole", () => {
  it("asks for a real image when there is one", () => {
    const line = buildResultLine(makeEntry({ img: "icons/spells/fireball.webp" }), context());

    expect(line.imageSrc).toBe("icons/spells/fireball.webp");
  });

  it("skips the request entirely for a known placeholder path", () => {
    expect(isPlaceholderImage("icons/placeholder/feat.svg")).toBe(true);
    expect(isPlaceholderImage(null)).toBe(true);
    expect(isPlaceholderImage("")).toBe(true);

    const line = buildResultLine(makeEntry({ img: "icons/placeholder/feat.svg" }), context());
    expect(line.imageSrc).toBeNull();
    expect(line.icon).toBe("item");
  });

  it("falls back to the type icon once the image has failed for this entry", () => {
    const entry = makeEntry();
    const broken = new Set([entry.uuid]);
    const line = buildResultLine(entry, context({ brokenImages: broken, documentType: "Actor" }));

    expect(line.imageSrc).toBeNull();
    expect(line.icon).toBe("actor");
  });
});

describe("REQ-CPD-046: no creature statistic on an unprivileged line", () => {
  const CREATURE = makeEntry({
    name: "Goblin Warrior",
    type: "npc",
    index: {
      "system.details.level.value": 1,
      "system.attributes.hp.max": 16,
      "system.attributes.ac.value": 16,
      "system.saves.fortitude.value": 5,
      "system.traits.value": ["goblin", "humanoid"],
    },
  });

  const DECLARED = [
    "system.details.level.value",
    "system.attributes.hp.max",
    "system.attributes.ac.value",
    "system.saves.fortitude.value",
    "system.traits.value",
  ];

  it("drops hit points, armour class and saves for a player", () => {
    const line = buildResultLine(
      CREATURE,
      context({ documentType: "Actor", indexFields: DECLARED, viewerIsPrivileged: false }),
    );
    const keys = line.fields.map((f) => f.key);

    expect(keys).not.toContain("system.attributes.hp.max");
    expect(keys).not.toContain("system.attributes.ac.value");
    expect(keys).not.toContain("system.saves.fortitude.value");
    // ...and no value of theirs leaked into the drawn text either.
    expect(line.fields.map((f) => f.value)).not.toContain("16");
  });

  it("keeps level and traits, which are how the reader filters and sorts", () => {
    const line = buildResultLine(
      CREATURE,
      context({ documentType: "Actor", indexFields: DECLARED, viewerIsPrivileged: false }),
    );

    expect(line.fields.map((f) => f.key)).toEqual([
      "system.details.level.value",
      "system.traits.value",
    ]);
  });

  it("shows the same statistics to a privileged reader", () => {
    const line = buildResultLine(
      CREATURE,
      context({ documentType: "Actor", indexFields: DECLARED, viewerIsPrivileged: true }),
    );

    expect(line.fields.map((f) => f.key)).toEqual(DECLARED);
  });

  it("names the statistic paths it refuses, whatever pack declares them", () => {
    expect(isCreatureStatField("system.attributes.hp.max")).toBe(true);
    expect(isCreatureStatField("system.saves.reflex.value")).toBe(true);
    expect(isCreatureStatField("system.abilities.str.mod")).toBe(true);
    expect(isCreatureStatField("system.perception.value")).toBe(true);
    expect(isCreatureStatField("system.level.value")).toBe(false);
    expect(isCreatureStatField("system.traits.value")).toBe(false);
  });
});
