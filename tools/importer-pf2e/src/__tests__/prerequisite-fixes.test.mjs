/**
 * prerequisite-fixes.test.mjs — issues #26/#28/#30/#46.
 *
 * `system.prerequisites[].value` is vendor free text ("Inner Upheaval",
 * "paladin cause", "bloodline the grants occult spells", two separate
 * entries meant as "A or B"...) — when the text names something no pack
 * document carries, the prerequisite edge is permanently lost. Hand-patching
 * a pack's generated documents.json would "fix" it until the next
 * `build-mvp-subset.mjs` run silently regenerates the broken text — so the
 * fix has to be DATA (curation/classes/*.json's `prerequisiteFixes`) applied
 * by `applyPrerequisiteFixes` before the pack is written.
 *
 * This suite tests the MECHANISM against synthetic docs (no dependency on
 * `out/` or `systems/pf2e/packs/` being present) — the mechanism's effect on
 * the REAL packs is covered by grafo-de-feats.test.mjs, which runs against
 * the committed, already-fixed `documents.json`.
 *
 * Execução:
 *   node --test src/__tests__/prerequisite-fixes.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyPrerequisiteFixes,
  assertAllPrerequisiteFixesApplied,
  loadClassCuration,
  validateClassCuration,
} from "../curation/index.mjs";

// loadClassCuration() caches by module-level singleton — every test below
// exercises applyPrerequisiteFixes/assertAllPrerequisiteFixesApplied against
// whatever the CURRENT curation/classes/*.json declares, so these tests are
// read-only assertions about the real, already-fixed curation data (no
// synthetic curation injected) — deliberately, so a regression in any class
// file's prerequisiteFixes breaks here too, not just in grafo-de-feats.

describe("applyPrerequisiteFixes — rename kind", () => {
  it("rewrites the matching entry's value, leaves other entries on the same feat untouched", () => {
    const docs = [
      {
        name: "Elemental Fist",
        system: { prerequisites: [{ value: "Inner Upheaval" }] },
      },
      {
        name: "Aura of Vengeance",
        system: { prerequisites: [{ value: "Exalt" }, { value: "Vengeful Oath" }] },
      },
    ];
    applyPrerequisiteFixes(docs);
    assert.equal(docs[0].system.prerequisites[0].value, "Qi Spells");
    assert.equal(docs[1].system.prerequisites[0].value, "Exalted Reaction");
    assert.equal(docs[1].system.prerequisites[1].value, "Vengeful Oath");
  });

  it("a fix whose feat isn't in this docs array is a silent no-op HERE (another pack may hold it) — returns it un-touched", () => {
    const docs = [{ name: "Some Other Feat", system: { prerequisites: [{ value: "x" }] } }];
    const touched = applyPrerequisiteFixes(docs);
    assert.equal(docs[0].system.prerequisites[0].value, "x");
    assert.equal(touched.has("Elemental Fist"), false);
  });
});

describe("applyPrerequisiteFixes — merge kind (issue #30)", () => {
  it("collapses N separate entries into ONE 'A or B' entry when they match replaceEntries exactly", () => {
    const docs = [
      {
        name: "Master of Many Styles",
        system: {
          prerequisites: [{ value: "Opening Stance (Fighter)" }, { value: "Reflexive Stance (Monk)" }],
        },
      },
    ];
    applyPrerequisiteFixes(docs);
    assert.deepEqual(docs[0].system.prerequisites, [
      { value: "Opening Stance (Fighter) or Reflexive Stance (Monk)" },
    ]);
  });

  it("throws when the current entries don't match replaceEntries exactly (stale merge guard)", () => {
    const docs = [
      {
        name: "Master of Many Styles",
        system: { prerequisites: [{ value: "Opening Stance (Fighter)" }] },
      },
    ];
    assert.throws(() => applyPrerequisiteFixes(docs), /não batem com replaceEntries/);
  });
});

describe("applyPrerequisiteFixes — validation", () => {
  it("kind 'rename' requires from/to", () => {
    assert.throws(
      () => validateClassCuration({ ...minimalCfg(), prerequisiteFixes: [{ featName: "X", kind: "rename" }] }, "x.json"),
      /from ausente/,
    );
  });

  it("kind 'merge' requires replaceEntries (2+) and with", () => {
    assert.throws(
      () =>
        validateClassCuration(
          { ...minimalCfg(), prerequisiteFixes: [{ featName: "X", kind: "merge", replaceEntries: ["a"], with: "a or b" }] },
          "x.json",
        ),
      /replaceEntries/,
    );
  });

  it("rejects an unknown kind", () => {
    assert.throws(
      () =>
        validateClassCuration(
          { ...minimalCfg(), prerequisiteFixes: [{ featName: "X", kind: "delete" }] },
          "x.json",
        ),
      /kind precisa ser/,
    );
  });
});

describe("assertAllPrerequisiteFixesApplied — coverage against the REAL curated fixes", () => {
  it("throws when a declared fix's featName was found in NEITHER pack (stale fix guard)", () => {
    assert.throws(
      () => assertAllPrerequisiteFixesApplied([new Set(), new Set()]),
      /nunca aplicados/,
    );
  });

  it("does not throw when every currently-declared fix was found in at least one pack", () => {
    // Simulates a full build-mvp-subset run: union the featNames every real
    // curated fix targets (they're all real feat names in this repo's own
    // packs) and hand that back as "found everywhere" — proves the assertion
    // itself is satisfiable, not just that it CAN throw.
    const allNames = new Set();
    for (const cfg of loadClassCuration().values()) {
      for (const fix of cfg.prerequisiteFixes) allNames.add(fix.featName);
    }
    assert.doesNotThrow(() => assertAllPrerequisiteFixesApplied([allNames]));
  });
});

function minimalCfg() {
  return {
    class: "test-class",
    displayName: "Test Class",
    vendorClassFile: "classes/test-class.json",
    classFeats: { trait: "test-class" },
    classFeatures: {},
  };
}
