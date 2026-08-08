/**
 * i18n-overlay.test.mjs — tests for i18n.pt-BR.json build/merge logic.
 *
 * Owner: implementer A (pipeline). Runs under `node --test`. Pure in-memory
 * fixtures — no filesystem writes to the real systems/pf2e/packs/ tree.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkUnitsForPack,
  mergeI18nOverlay,
  computeSourceHashesById,
  findStaleEntries,
  I18N_SCHEMA_VERSION,
} from "../i18n-overlay.mjs";
import { i18nSourceHash } from "../hash.mjs";

const DOCS = [
  { _id: "doc1", name: "Fire Bolt", system: { description: "<p>A bolt of fire.</p>" } },
  { _id: "doc2", name: "Ice Spike", system: { description: "<p>A spike of ice.</p>" } },
];

test("buildWorkUnitsForPack returns every doc as pending when there's no existing overlay", () => {
  const { units, skipped } = buildWorkUnitsForPack(DOCS, null);
  assert.equal(units.length, 2);
  assert.equal(skipped, 0);
  assert.equal(units[0].id, "doc1");
  assert.equal(units[0].name, "Fire Bolt");
  assert.equal(units[0].stale, false);
});

test("buildWorkUnitsForPack skips docs whose sourceHash already matches a translated entry", () => {
  const existingOverlay = {
    entries: {
      // A REAL translation: both name AND description are filled in — this
      // is genuinely done. (A name-only entry with a matching hash is the
      // missing-description gap covered separately below, not a skip case.)
      doc1: {
        name: "Raio de Fogo",
        description: "<p>Um raio de fogo.</p>",
        sourceHash: i18nSourceHash("Fire Bolt", "<p>A bolt of fire.</p>"),
      },
    },
  };
  const { units, skipped } = buildWorkUnitsForPack(DOCS, existingOverlay);
  assert.equal(skipped, 1);
  assert.equal(units.length, 1);
  assert.equal(units[0].id, "doc2");
});

test("buildWorkUnitsForPack marks a translation stale when the EN source changed", () => {
  const existingOverlay = {
    entries: {
      doc1: { name: "Raio de Fogo (velho)", sourceHash: "outdated-hash-that-wont-match" },
    },
  };
  const { units, skipped } = buildWorkUnitsForPack(DOCS, existingOverlay);
  assert.equal(skipped, 0);
  const doc1Unit = units.find((u) => u.id === "doc1");
  assert.ok(doc1Unit);
  assert.equal(doc1Unit.stale, true);
});

// ---------------------------------------------------------------------------
// missing-description gap (issue #9, parent of #27) — a doc whose entry has
// a translated `name`, a matching `sourceHash`, but an ABSENT/EMPTY
// `description` used to be silently treated as "already translated" and
// never re-emitted, even though the EN doc carries real prose. This is the
// same blind spot the QA gate had before issue #27 fixed `checkDoc`.
// ---------------------------------------------------------------------------

test("buildWorkUnitsForPack skips a doc whose EN description has no real prose (markup-only), even without an entry", () => {
  const docsNoProse = [{ _id: "doc1", name: "Empty Feat", system: { description: "<p></p>" } }];
  const { units, skipped } = buildWorkUnitsForPack(docsNoProse, null);
  // No existing entry at all -> still emitted today (the name needs
  // translating). This case only matters once an entry exists; see below.
  assert.equal(units.length, 1);
  assert.equal(skipped, 0);
});

test("buildWorkUnitsForPack skips a doc when EN has no real prose and the entry's hash matches (nothing left to translate)", () => {
  const docsNoProse = [{ _id: "doc1", name: "Empty Feat", system: { description: "<p></p>" } }];
  const existingOverlay = {
    entries: {
      doc1: { name: "Talento Vazio", sourceHash: i18nSourceHash("Empty Feat", "<p></p>") },
    },
  };
  const { units, skipped } = buildWorkUnitsForPack(docsNoProse, existingOverlay);
  assert.equal(units.length, 0);
  assert.equal(skipped, 1);
});

test("buildWorkUnitsForPack EMITS a doc with reason 'missing-description' when EN has prose, hash matches, but the entry has no description", () => {
  const existingOverlay = {
    entries: {
      // name is translated, sourceHash matches the live EN doc, but the
      // description was never filled in (the 679-doc bug).
      doc1: {
        name: "Raio de Fogo",
        sourceHash: i18nSourceHash("Fire Bolt", "<p>A bolt of fire.</p>"),
      },
    },
  };
  const { units, skipped } = buildWorkUnitsForPack(DOCS, existingOverlay);
  const doc1Unit = units.find((u) => u.id === "doc1");
  assert.ok(doc1Unit, "expected doc1 to be re-emitted despite the matching sourceHash");
  assert.equal(doc1Unit.stale, false);
  assert.equal(doc1Unit.reason, "missing-description");
  assert.equal(doc1Unit.name, "Fire Bolt");
  assert.equal(doc1Unit.description, "<p>A bolt of fire.</p>");
  // doc2 has no entry at all -> still emitted as before, no reason needed.
  const doc2Unit = units.find((u) => u.id === "doc2");
  assert.ok(doc2Unit);
  assert.equal(doc2Unit.reason, undefined);
  assert.equal(skipped, 0);
});

test("buildWorkUnitsForPack EMITS with reason 'missing-description' when the entry's description is an empty string (not just absent)", () => {
  const existingOverlay = {
    entries: {
      doc1: {
        name: "Raio de Fogo",
        description: "",
        sourceHash: i18nSourceHash("Fire Bolt", "<p>A bolt of fire.</p>"),
      },
    },
  };
  const { units } = buildWorkUnitsForPack(DOCS, existingOverlay);
  const doc1Unit = units.find((u) => u.id === "doc1");
  assert.ok(doc1Unit);
  assert.equal(doc1Unit.reason, "missing-description");
});

test("buildWorkUnitsForPack skips a doc with a real non-empty description and a matching hash (actually translated)", () => {
  const existingOverlay = {
    entries: {
      doc1: {
        name: "Raio de Fogo",
        description: "<p>Um raio de fogo.</p>",
        sourceHash: i18nSourceHash("Fire Bolt", "<p>A bolt of fire.</p>"),
      },
    },
  };
  const { units, skipped } = buildWorkUnitsForPack(DOCS, existingOverlay);
  assert.equal(
    units.find((u) => u.id === "doc1"),
    undefined,
  );
  assert.equal(skipped, 1);
});

test("buildWorkUnitsForPack skips a doc with noDescription:true even though EN has prose and description is absent (explicit valve)", () => {
  const existingOverlay = {
    entries: {
      doc1: {
        name: "Raio de Fogo",
        noDescription: true,
        sourceHash: i18nSourceHash("Fire Bolt", "<p>A bolt of fire.</p>"),
      },
    },
  };
  const { units, skipped } = buildWorkUnitsForPack(DOCS, existingOverlay);
  assert.equal(
    units.find((u) => u.id === "doc1"),
    undefined,
  );
  assert.equal(skipped, 1);
});

test("mergeI18nOverlay produces the documented schema shape with sorted entries", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const overlay = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay: null,
    translations: {
      doc2: { name: "Espinho de Gelo", description: "<p>Um espinho de gelo.</p>" },
      doc1: { name: "Raio de Fogo" },
    },
    sourceHashesById,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(overlay.schemaVersion, I18N_SCHEMA_VERSION);
  assert.equal(overlay.packId, "pf2e.spells-core");
  assert.equal(overlay.locale, "pt-BR");
  assert.ok(overlay.attribution.length > 0);
  // Sorted key order: doc1 before doc2 regardless of input order.
  assert.deepEqual(Object.keys(overlay.entries), ["doc1", "doc2"]);
  assert.equal(overlay.entries.doc1.name, "Raio de Fogo");
  assert.equal(overlay.entries.doc1.description, undefined);
  assert.equal(overlay.entries.doc2.description, "<p>Um espinho de gelo.</p>");
  assert.equal(overlay.entries.doc1.sourceHash, sourceHashesById.doc1);
});

test("mergeI18nOverlay is idempotent: merging twice yields byte-identical entries", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const translations = { doc1: { name: "Raio de Fogo" } };
  const first = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay: null,
    translations,
    sourceHashesById,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  const second = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay: first,
    translations,
    sourceHashesById,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(first.entries, second.entries);
});

test("mergeI18nOverlay drops translations for doc ids no longer present in sourceHashesById", () => {
  const sourceHashesById = computeSourceHashesById(DOCS); // only doc1, doc2
  const overlay = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay: null,
    translations: { removedDoc: { name: "Should be dropped" } },
    sourceHashesById,
  });
  assert.equal(overlay.entries.removedDoc, undefined);
});

// ---------------------------------------------------------------------------
// noDescription valve — mergeI18nOverlay used to rebuild each merged entry
// from scratch (`{ name, sourceHash }` plus `description` if present),
// silently dropping any other field defined by PackI18nEntrySchema. The only
// other schema field today is `noDescription` (packages/shared/src/compendium.ts,
// PackI18nEntrySchema) — this loses the escape hatch on every re-merge.
// ---------------------------------------------------------------------------

test("mergeI18nOverlay preserves noDescription:true across a re-merge that doesn't mention it", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const existingOverlay = {
    entries: {
      doc1: { name: "Raio de Fogo", noDescription: true, sourceHash: sourceHashesById.doc1 },
    },
  };
  // Re-merging a name-only translation (e.g. a re-run that doesn't touch
  // the description at all) must not silently drop the valve.
  const overlay = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay,
    translations: { doc1: { name: "Raio de Fogo" } },
    sourceHashesById,
  });
  assert.equal(overlay.entries.doc1.noDescription, true);
});

test("mergeI18nOverlay lets a translation batch explicitly declare noDescription:true on a fresh entry", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const overlay = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay: null,
    translations: { doc1: { name: "Raio de Fogo", noDescription: true } },
    sourceHashesById,
  });
  assert.equal(overlay.entries.doc1.noDescription, true);
  assert.equal(overlay.entries.doc1.description, undefined);
});

test("mergeI18nOverlay clears a stale noDescription:true when the new translation provides a real description", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const existingOverlay = {
    entries: {
      doc1: { name: "Raio de Fogo", noDescription: true, sourceHash: sourceHashesById.doc1 },
    },
  };
  const overlay = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay,
    translations: { doc1: { name: "Raio de Fogo", description: "<p>Um raio de fogo.</p>" } },
    sourceHashesById,
  });
  assert.equal(overlay.entries.doc1.noDescription, undefined);
  assert.equal(overlay.entries.doc1.description, "<p>Um raio de fogo.</p>");
});

test("mergeI18nOverlay stays idempotent (byte-identical) when noDescription is involved", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const translations = { doc1: { name: "Raio de Fogo", noDescription: true } };
  const first = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay: null,
    translations,
    sourceHashesById,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  const second = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay: first,
    translations,
    sourceHashesById,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(first.entries, second.entries);
});

test("mergeI18nOverlay preserves existing entries not present in the new translations batch", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const existingOverlay = {
    entries: { doc2: { name: "Espinho de Gelo", sourceHash: sourceHashesById.doc2 } },
  };
  const overlay = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay,
    translations: { doc1: { name: "Raio de Fogo" } },
    sourceHashesById,
  });
  assert.equal(overlay.entries.doc1.name, "Raio de Fogo");
  assert.equal(overlay.entries.doc2.name, "Espinho de Gelo");
});

// ---------------------------------------------------------------------------
// prerequisites escape hatch (issue #32) — mirrors the noDescription valve:
// mergeI18nOverlay must not silently drop it on a re-merge that doesn't
// mention it, and a batch that DOES supply it must win.
// ---------------------------------------------------------------------------

test("mergeI18nOverlay preserves prerequisites across a re-merge that doesn't mention it", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const existingOverlay = {
    entries: {
      doc1: {
        name: "Raio de Fogo",
        prerequisites: ["Ferocidade Orc"],
        sourceHash: sourceHashesById.doc1,
      },
    },
  };
  const overlay = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay,
    translations: { doc1: { name: "Raio de Fogo" } },
    sourceHashesById,
  });
  assert.deepEqual(overlay.entries.doc1.prerequisites, ["Ferocidade Orc"]);
});

test("mergeI18nOverlay lets a translation batch set prerequisites on a fresh entry", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const overlay = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay: null,
    translations: { doc1: { name: "Raio de Fogo", prerequisites: ["Ferocidade Orc"] } },
    sourceHashesById,
  });
  assert.deepEqual(overlay.entries.doc1.prerequisites, ["Ferocidade Orc"]);
});

test("mergeI18nOverlay lets a translation batch overwrite an existing prerequisites value", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const existingOverlay = {
    entries: {
      doc1: { name: "Raio de Fogo", prerequisites: ["old"], sourceHash: sourceHashesById.doc1 },
    },
  };
  const overlay = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay,
    translations: { doc1: { name: "Raio de Fogo", prerequisites: ["new"] } },
    sourceHashesById,
  });
  assert.deepEqual(overlay.entries.doc1.prerequisites, ["new"]);
});

test("mergeI18nOverlay does not invalidate prerequisites when a fresh description is supplied (independent fields)", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const existingOverlay = {
    entries: {
      doc1: {
        name: "Raio de Fogo",
        prerequisites: ["Ferocidade Orc"],
        sourceHash: sourceHashesById.doc1,
      },
    },
  };
  const overlay = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay,
    translations: { doc1: { name: "Raio de Fogo", description: "<p>Um raio de fogo.</p>" } },
    sourceHashesById,
  });
  assert.deepEqual(overlay.entries.doc1.prerequisites, ["Ferocidade Orc"]);
  assert.equal(overlay.entries.doc1.description, "<p>Um raio de fogo.</p>");
});

test("mergeI18nOverlay stays idempotent (byte-identical) when prerequisites is involved", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const translations = { doc1: { name: "Raio de Fogo", prerequisites: ["Ferocidade Orc"] } };
  const first = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay: null,
    translations,
    sourceHashesById,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  const second = mergeI18nOverlay({
    packId: "pf2e.spells-core",
    existingOverlay: first,
    translations,
    sourceHashesById,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(first.entries, second.entries);
});

test("findStaleEntries reports doc ids whose stored sourceHash no longer matches the live doc", () => {
  const sourceHashesById = computeSourceHashesById(DOCS);
  const overlay = {
    entries: {
      doc1: { name: "Raio de Fogo", sourceHash: sourceHashesById.doc1 },
      doc2: { name: "Espinho Velho", sourceHash: "stale-hash" },
    },
  };
  const stale = findStaleEntries(overlay, sourceHashesById);
  assert.deepEqual(stale, ["doc2"]);
});

test("findStaleEntries returns [] for a null overlay", () => {
  assert.deepEqual(findStaleEntries(null, {}), []);
});
