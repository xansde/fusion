/**
 * mechanics-overlay.test.mjs — tests for mechanics.json build/merge logic.
 *
 * Owner: implementer A (pipeline). Runs under `node --test`. Pure in-memory
 * fixtures (small synthetic docs), plus one check against the real
 * feats-core fixture used elsewhere in this suite.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  extractMechanicsForPack,
  mergeMechanicsOverlay,
  MECHANICS_SCHEMA_VERSION,
} from "../mechanics-overlay.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "feats-core-samples.json"), "utf8"),
);

test("extractMechanicsForPack omits docs with no grants/unlocks (e.g. Alchemist Dedication)", () => {
  const docs = Object.values(fixtures);
  const { entries } = extractMechanicsForPack(docs);
  const alchemistDedicationId = fixtures["Alchemist Dedication"]._id;
  assert.equal(entries[alchemistDedicationId], undefined);
});

test("extractMechanicsForPack strips internal bookkeeping fields (_flag, _docId) from public grants", () => {
  const docs = [fixtures["Basic Concoction"]];
  const { entries } = extractMechanicsForPack(docs);
  const entry = entries[fixtures["Basic Concoction"]._id];
  assert.ok(entry);
  assert.equal(entry.grants[0]._flag, undefined);
  assert.equal(entry.grants[0]._docId, undefined);
});

test("extractMechanicsForPack stamps a sourceHash per entry", () => {
  const docs = [fixtures["Basic Concoction"]];
  const { entries } = extractMechanicsForPack(docs);
  const entry = entries[fixtures["Basic Concoction"]._id];
  assert.equal(typeof entry.sourceHash, "string");
  assert.ok(entry.sourceHash.length > 0);
});

test("mergeMechanicsOverlay produces the documented schema shape with sorted entries", () => {
  const overlay = mergeMechanicsOverlay({
    packId: "pf2e.feats-core",
    existingOverlay: null,
    freshEntries: {
      zId: { sourceHash: "h1", grants: [], unlocks: [] },
      aId: { sourceHash: "h2", grants: [], unlocks: [] },
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(overlay.schemaVersion, MECHANICS_SCHEMA_VERSION);
  assert.equal(overlay.packId, "pf2e.feats-core");
  assert.deepEqual(Object.keys(overlay.entries), ["aId", "zId"]);
});

test("mergeMechanicsOverlay is idempotent", () => {
  const freshEntries = { docA: { sourceHash: "h1", grants: [], unlocks: [] } };
  const first = mergeMechanicsOverlay({
    packId: "pf2e.feats-core",
    existingOverlay: null,
    freshEntries,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  const second = mergeMechanicsOverlay({
    packId: "pf2e.feats-core",
    existingOverlay: first,
    freshEntries,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(first.entries, second.entries);
});

test("mergeMechanicsOverlay: fresh rule-element entries overwrite stale entries for the same doc id", () => {
  const existingOverlay = {
    entries: { docA: { sourceHash: "old-hash", grants: [{ kind: "feat-choice", confidence: 0.5 }], unlocks: [] } },
  };
  const freshEntries = { docA: { sourceHash: "new-hash", grants: [{ kind: "feat-choice", confidence: 1.0 }], unlocks: [] } };
  const merged = mergeMechanicsOverlay({ packId: "pf2e.feats-core", existingOverlay, freshEntries });
  assert.equal(merged.entries.docA.sourceHash, "new-hash");
  assert.equal(merged.entries.docA.grants[0].confidence, 1.0);
});

test("mergeMechanicsOverlay preserves existing entries not present in the fresh batch", () => {
  const existingOverlay = {
    entries: { keepMe: { sourceHash: "h1", grants: [], unlocks: [] } },
  };
  const merged = mergeMechanicsOverlay({
    packId: "pf2e.feats-core",
    existingOverlay,
    freshEntries: { otherDoc: { sourceHash: "h2", grants: [], unlocks: [] } },
  });
  assert.ok(merged.entries.keepMe);
  assert.ok(merged.entries.otherDoc);
});
