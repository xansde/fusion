/**
 * conflux-grants.test.mjs — tests for the curated "Conflux Spell" fixed-item
 * grant extraction (r15 A2). Runs under `node --test`.
 *
 * Verifies against the LIVE class-features-core pack that every Magus hybrid
 * study emits its conflux spell as a fixed-item grant, and against synthetic
 * fixtures for the pattern edge cases.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  extractConfluxGrant,
  extractConfluxGrantsForPack,
  mergeConfluxIntoEntries,
  confluxSourceHash,
} from "../conflux-grants.mjs";
import { resolveSystemPacksDir, readPackDocuments } from "../pack-io.mjs";

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

/** A class feature whose description declares a Conflux Spell (Fusion pack shape: description is a bare string). */
function confluxFeatureDoc(spellName, { descShape = "string", type = "classFeature" } = {}) {
  const desc =
    `<p>Some flavour text about the study.</p>\n` +
    `<p><strong>Conflux Spell</strong> @UUID[Compendium.pf2e.spells-srd.Item.${spellName}]</p>`;
  const description = descShape === "value" ? { value: desc } : desc;
  return {
    _id: "doc-" + spellName.replace(/\s+/g, ""),
    name: "Some Study",
    type,
    system: { description, rules: [] },
  };
}

// ---------------------------------------------------------------------------
// extractConfluxGrant — single doc
// ---------------------------------------------------------------------------

test("extractConfluxGrant reads the spell name + vendor from the prose (string description)", () => {
  const grant = extractConfluxGrant(confluxFeatureDoc("Shooting Star"));
  assert.deepEqual(grant, {
    kind: "fixed-item",
    vendor: "spells-srd",
    name: "Shooting Star",
    uuid: "Compendium.pf2e.spells-srd.Item.Shooting Star",
    source: "curated",
    confidence: 1.0,
  });
});

test("extractConfluxGrant tolerates the vendor `{ value }` description shape too", () => {
  const grant = extractConfluxGrant(confluxFeatureDoc("Spinning Staff", { descShape: "value" }));
  assert.equal(grant?.name, "Spinning Staff");
  assert.equal(grant?.vendor, "spells-srd");
});

test("extractConfluxGrant keeps multi-word spell names intact", () => {
  const grant = extractConfluxGrant(confluxFeatureDoc("Home Among Mulberry Leaves"));
  assert.equal(grant?.name, "Home Among Mulberry Leaves");
});

test("extractConfluxGrant returns null for a doc with no Conflux Spell pattern", () => {
  assert.equal(extractConfluxGrant({ system: { description: "<p>Just some feature.</p>" } }), null);
  assert.equal(extractConfluxGrant({ system: {} }), null);
  assert.equal(extractConfluxGrant({}), null);
});

test("extractConfluxGrant ignores a bare 'Conflux Spells' pool label with no @UUID", () => {
  // Some class features mention "Conflux Spells" (the pool) without granting a
  // specific spell — must NOT be treated as a grant.
  assert.equal(
    extractConfluxGrant({ system: { description: "<p>You gain <strong>Conflux Spells</strong>.</p>" } }),
    null,
  );
});

// ---------------------------------------------------------------------------
// extractConfluxGrantsForPack + sourceHash
// ---------------------------------------------------------------------------

test("extractConfluxGrantsForPack stamps a description-derived sourceHash and empty unlocks", () => {
  const doc = confluxFeatureDoc("Shooting Star");
  const entries = extractConfluxGrantsForPack([doc]);
  const entry = entries[doc._id];
  assert.ok(entry);
  assert.equal(entry.sourceHash, confluxSourceHash(doc));
  assert.deepEqual(entry.unlocks, []);
  assert.equal(entry.grants.length, 1);
});

test("confluxSourceHash changes when the referenced spell changes", () => {
  const a = confluxSourceHash(confluxFeatureDoc("Shooting Star"));
  const b = confluxSourceHash(confluxFeatureDoc("Spinning Staff"));
  assert.notEqual(a, b);
});

test("extractConfluxGrantsForPack skips non-feature/feat docs", () => {
  const spellDoc = { _id: "s", type: "spell", system: { description: "<p><strong>Conflux Spell</strong> @UUID[Compendium.pf2e.spells-srd.Item.X]</p>" } };
  assert.deepEqual(extractConfluxGrantsForPack([spellDoc]), {});
});

// ---------------------------------------------------------------------------
// mergeConfluxIntoEntries
// ---------------------------------------------------------------------------

test("mergeConfluxIntoEntries appends to an existing rule-element entry", () => {
  const entries = { d1: { sourceHash: "h", grants: [{ kind: "feat-choice" }], unlocks: [] } };
  const conflux = { d1: { sourceHash: "c", grants: [{ kind: "fixed-item", name: "X" }], unlocks: [] } };
  mergeConfluxIntoEntries(entries, conflux);
  assert.equal(entries.d1.grants.length, 2);
  assert.equal(entries.d1.grants[0].kind, "feat-choice");
  assert.equal(entries.d1.grants[1].kind, "fixed-item");
});

test("mergeConfluxIntoEntries creates a fresh entry for a doc with no prior mechanics", () => {
  const entries = {};
  const conflux = { d2: { sourceHash: "c", grants: [{ kind: "fixed-item", name: "Y" }], unlocks: [] } };
  mergeConfluxIntoEntries(entries, conflux);
  assert.equal(entries.d2.grants[0].name, "Y");
});

// ---------------------------------------------------------------------------
// LIVE pack: every Magus hybrid study grants its conflux spell
// ---------------------------------------------------------------------------

test("LIVE class-features-core: the 5 Magus hybrid studies emit their conflux spell", () => {
  const packsRoot = resolveSystemPacksDir("pf2e");
  const docs = readPackDocuments(packsRoot, "class-features-core");
  const byName = new Map(docs.map((d) => [d.name, d]));

  const expected = {
    "Starlit Span": "Shooting Star",
    "Inexorable Iron": "Thunderous Strike",
    "Laughing Shadow": "Dimensional Assault",
    "Sparkling Targe": "Shielding Strike",
    "Twisting Tree": "Spinning Staff",
  };

  const entries = extractConfluxGrantsForPack(docs);
  for (const [featureName, spellName] of Object.entries(expected)) {
    const doc = byName.get(featureName);
    assert.ok(doc, `missing feature ${featureName} in class-features-core`);
    const entry = entries[doc._id];
    assert.ok(entry, `no conflux grant extracted for ${featureName}`);
    const grant = entry.grants.find((g) => g.kind === "fixed-item");
    assert.ok(grant, `${featureName} has no fixed-item grant`);
    assert.equal(grant.name, spellName, `${featureName} should grant ${spellName}`);
    assert.equal(grant.vendor, "spells-srd");
    assert.equal(grant.source, "curated");
  }
});
