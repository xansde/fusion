/**
 * merge-mechanics-llm.test.mjs — tests for the LLM mechanics merge (Stage 3b).
 *
 * Covers grant/unlock adaptation (flat LLM shape -> overlay Grant/Unlock),
 * the drop of unrepresentable kinds, rule-element precedence, the review
 * denylist, idempotency, and schema validation of the merged overlay against
 * the real @fusion/shared PackMechanicsOverlaySchema.
 *
 * Owner: implementer A (pipeline). Runs under `node --test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adaptLlmGrant,
  adaptLlmUnlock,
  buildLlmAdditions,
  mergeLlmIntoOverlay,
  loadOverlaySchema,
  LLM_CONFIDENCE,
  LLM_REVIEW_DENYLIST,
} from "../merge-mechanics-llm.mjs";

// --- adaptLlmGrant ----------------------------------------------------------

test("adaptLlmGrant maps a featChoice with traits+maxLevel to a feat-choice grant", () => {
  const g = adaptLlmGrant({ kind: "featChoice", category: "class", maxLevel: 2, traits: ["alchemist"], count: 1 });
  assert.deepEqual(g, {
    kind: "feat-choice",
    category: "class",
    count: 1,
    filters: { traits: ["alchemist"], maxLevel: 2 },
    source: "llm",
    confidence: LLM_CONFIDENCE,
  });
});

test("adaptLlmGrant yields an empty filters object when maxLevel is null and traits empty", () => {
  const g = adaptLlmGrant({ kind: "featChoice", category: "skill", maxLevel: null, traits: [], count: 1 });
  assert.deepEqual(g.filters, {});
  assert.equal(g.category, "skill");
});

test("adaptLlmGrant defaults count to 1 when missing or invalid", () => {
  assert.equal(adaptLlmGrant({ kind: "featChoice", category: "general" }).count, 1);
  assert.equal(adaptLlmGrant({ kind: "featChoice", category: "general", count: 0 }).count, 1);
  assert.equal(adaptLlmGrant({ kind: "featChoice", category: "general", count: 3 }).count, 3);
});

test("adaptLlmGrant returns null for non-featChoice kinds", () => {
  for (const kind of ["spellChoice", "spellAccess", "formulaGrant", "itemChoice", "itemQuirk"]) {
    assert.equal(adaptLlmGrant({ kind, category: "general" }), null, `kind ${kind} must be dropped`);
  }
});

test("adaptLlmGrant returns null for categories outside the 5 feat categories", () => {
  for (const category of ["focus", "aftereffect", "tattoo", "special", undefined]) {
    assert.equal(adaptLlmGrant({ kind: "featChoice", category }), null, `category ${category} must be dropped`);
  }
});

// --- adaptLlmUnlock ---------------------------------------------------------

test("adaptLlmUnlock keeps only ancestry-feat-eligibility", () => {
  assert.equal(adaptLlmUnlock({ kind: "focusPointIncrease" }), null);
  assert.equal(adaptLlmUnlock({ kind: "ancestryExpansion" }), null);
  const u = adaptLlmUnlock({ kind: "ancestry-feat-eligibility", mechanism: "adopted-ancestry", filters: { excludeOwnAncestry: true } });
  assert.equal(u.kind, "ancestry-feat-eligibility");
  assert.equal(u.mechanism, "adopted-ancestry");
  assert.equal(u.source, "llm");
  assert.equal(u.confidence, LLM_CONFIDENCE);
});

// --- buildLlmAdditions ------------------------------------------------------

function docsMap(...ids) {
  // Minimal docs — sourceHash only reads system.rules / flags, absent here (-> stable hash).
  return new Map(ids.map((id) => [id, { _id: id, name: id, system: {}, flags: {} }]));
}

test("buildLlmAdditions skips a docId already owned by a rule-element entry (precedence)", () => {
  const llmChunks = { A: { grants: [{ kind: "featChoice", category: "class", traits: ["alchemist"], maxLevel: 2, count: 1 }] } };
  const existingOverlay = { entries: { A: { sourceHash: "re", grants: [{ kind: "feat-choice", source: "rule-element" }], unlocks: [] } } };
  const { added, stats } = buildLlmAdditions({ llmChunks, existingOverlay, docsById: docsMap("A"), denylist: new Set() });
  assert.deepEqual(added, {});
  assert.deepEqual(stats.conflicts, ["A"]);
});

test("buildLlmAdditions honors the review denylist", () => {
  const llmChunks = { X: { grants: [{ kind: "featChoice", category: "general", traits: [], maxLevel: null, count: 1 }] } };
  const { added, stats } = buildLlmAdditions({ llmChunks, existingOverlay: null, docsById: docsMap("X"), denylist: new Set(["X"]) });
  assert.deepEqual(added, {});
  assert.deepEqual(stats.denied, ["X"]);
});

test("buildLlmAdditions adds a fresh entry for a new doc with a valid grant", () => {
  const llmChunks = { B: { grants: [{ kind: "featChoice", category: "skill", traits: [], maxLevel: 1, count: 1 }], unlocks: [] } };
  const { added, stats } = buildLlmAdditions({ llmChunks, existingOverlay: null, docsById: docsMap("B"), denylist: new Set() });
  assert.ok(added.B, "entry B should be added");
  assert.equal(added.B.grants[0].source, "llm");
  assert.equal(added.B.grants[0].filters.maxLevel, 1);
  assert.equal(typeof added.B.sourceHash, "string");
  assert.equal(stats.addedGrantCount, 1);
});

test("buildLlmAdditions drops unrepresentable grants but keeps the doc if anything survives", () => {
  const llmChunks = {
    C: {
      grants: [
        { kind: "spellChoice", category: "focus" }, // dropped
        { kind: "featChoice", category: "general", traits: [], maxLevel: null, count: 1 }, // kept
      ],
      unlocks: [{ kind: "focusPointIncrease" }], // dropped
    },
  };
  const { added, stats } = buildLlmAdditions({ llmChunks, existingOverlay: null, docsById: docsMap("C"), denylist: new Set() });
  assert.equal(added.C.grants.length, 1);
  assert.equal(added.C.unlocks.length, 0);
  assert.equal(stats.droppedGrants.length, 1);
  assert.equal(stats.droppedUnlocks.length, 1);
});

test("buildLlmAdditions omits a doc when nothing survives adaptation", () => {
  const llmChunks = { D: { grants: [{ kind: "spellAccess", category: "focus" }], unlocks: [{ kind: "familiarGrant" }] } };
  const { added } = buildLlmAdditions({ llmChunks, existingOverlay: null, docsById: docsMap("D"), denylist: new Set() });
  assert.equal(added.D, undefined);
});

test("buildLlmAdditions records a docId absent from the pack as missing", () => {
  const llmChunks = { GHOST: { grants: [{ kind: "featChoice", category: "general", traits: [], maxLevel: null, count: 1 }] } };
  const { added, stats } = buildLlmAdditions({ llmChunks, existingOverlay: null, docsById: docsMap("REAL"), denylist: new Set() });
  assert.equal(added.GHOST, undefined);
  assert.deepEqual(stats.missingDocs, ["GHOST"]);
});

// --- mergeLlmIntoOverlay ----------------------------------------------------

test("mergeLlmIntoOverlay carries existing rule-element entries through and sorts", () => {
  const existingOverlay = {
    schemaVersion: 1,
    entries: { zRE: { sourceHash: "h", grants: [], unlocks: [] } },
  };
  const additions = { aLLM: { sourceHash: "h2", grants: [], unlocks: [] } };
  const merged = mergeLlmIntoOverlay({ packId: "pf2e.feats-core", existingOverlay, additions, generatedAt: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(Object.keys(merged.entries), ["aLLM", "zRE"]);
  assert.equal(merged.schemaVersion, 1);
});

test("mergeLlmIntoOverlay: existing entry wins over an addition sharing its docId", () => {
  const existingOverlay = { entries: { A: { sourceHash: "re", grants: [{ source: "rule-element" }], unlocks: [] } } };
  const additions = { A: { sourceHash: "llm", grants: [{ source: "llm" }], unlocks: [] } };
  const merged = mergeLlmIntoOverlay({ packId: "p", existingOverlay, additions, generatedAt: "t" });
  assert.equal(merged.entries.A.sourceHash, "re");
  assert.equal(merged.entries.A.grants[0].source, "rule-element");
});

test("mergeLlmIntoOverlay is idempotent", () => {
  const additions = { A: { sourceHash: "h", grants: [{ kind: "feat-choice", category: "skill", count: 1, filters: {}, source: "llm", confidence: LLM_CONFIDENCE }], unlocks: [] } };
  const first = mergeLlmIntoOverlay({ packId: "p", existingOverlay: null, additions, generatedAt: "t" });
  const second = mergeLlmIntoOverlay({ packId: "p", existingOverlay: first, additions, generatedAt: "t" });
  assert.deepEqual(first.entries, second.entries);
});

// --- schema validation ------------------------------------------------------

test("merged overlay validates against @fusion/shared PackMechanicsOverlaySchema", async () => {
  const OverlaySchema = await loadOverlaySchema();
  const additions = {
    B: {
      sourceHash: "abc",
      grants: [{ kind: "feat-choice", category: "skill", count: 1, filters: { maxLevel: 1 }, source: "llm", confidence: LLM_CONFIDENCE }],
      unlocks: [],
    },
  };
  const merged = mergeLlmIntoOverlay({ packId: "pf2e.feats-core", existingOverlay: null, additions, generatedAt: "2026-01-01T00:00:00.000Z" });
  const parsed = OverlaySchema.safeParse(merged);
  assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues));
});

test("an adapted LLM grant validates against the shared Grant schema fields", async () => {
  const OverlaySchema = await loadOverlaySchema();
  const grant = adaptLlmGrant({ kind: "featChoice", category: "class", traits: ["alchemist"], maxLevel: 2, count: 1 });
  const merged = mergeLlmIntoOverlay({
    packId: "p",
    existingOverlay: null,
    additions: { Z: { sourceHash: "h", grants: [grant], unlocks: [] } },
    generatedAt: "t",
  });
  assert.ok(OverlaySchema.safeParse(merged).success);
});

test("LLM_REVIEW_DENYLIST holds the four hand-removed false positives", () => {
  assert.equal(LLM_REVIEW_DENYLIST.size, 4);
  for (const id of ["MmNT1k1Zu26jGSXc", "ZtXtqMxa3sZvhZ4m", "W2TtTf4vbOLuac4K", "9qxi3y111QjyQ7oE"]) {
    assert.ok(LLM_REVIEW_DENYLIST.has(id), `${id} must be denied`);
  }
});
