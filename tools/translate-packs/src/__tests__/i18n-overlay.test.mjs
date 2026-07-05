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
      doc1: { name: "Raio de Fogo", sourceHash: i18nSourceHash("Fire Bolt", "<p>A bolt of fire.</p>") },
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
