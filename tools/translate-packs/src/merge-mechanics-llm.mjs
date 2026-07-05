/**
 * merge-mechanics-llm.mjs — Stage 3b of the translate-packs pipeline.
 *
 * Folds the LLM mechanics extraction (out/mechanics-llm/<pack>/chunk-*.json)
 * into each pack's existing mechanics.json overlay, WITHOUT ever overriding a
 * deterministic rule-element entry.
 *
 * Precedence contract (mirrors mechanics.ts's MechanicsSource ordering):
 *   rule-element  >  llm  >  (nothing)
 * The rule-element overlay (produced by grants-from-rules.mjs) is the ground
 * truth. The LLM pass only ADDS entries for docs the deterministic extractor
 * left out — on a docId conflict the rule-element entry always wins and the
 * LLM entry is dropped whole (never partially merged into an existing entry).
 *
 * LLM input format (per pack, one or more chunk-*.json, merged by name order):
 *   { [docId]: { grants: LlmGrant[], unlocks: LlmUnlock[] } }
 * where an LlmGrant is a FLAT shape distinct from the overlay's Grant schema:
 *   { kind, category, maxLevel|null, traits: string[], count, notes, ... }
 *
 * Only grants that map cleanly onto the overlay's Grant schema survive:
 *   - kind must be "featChoice"        -> Grant.kind = "feat-choice"
 *   - category must be one of the 5 GrantCategory values
 * Everything else (spellChoice / spellAccess / formulaGrant / itemChoice /
 * itemQuirk, or a non-feat category like "focus"/"tattoo"/"aftereffect") has
 * NO representation in this overlay (which models feat-choice slots only) and
 * is discarded — recorded in the summary's `droppedGrants` for auditing.
 *
 * LLM unlocks are only kept when kind === "ancestry-feat-eligibility" (the
 * sole shape UnlockSchema accepts); the current LLM pass emits none of that
 * kind, so all LLM unlocks are dropped (recorded in `droppedUnlocks`).
 *
 * Every added grant is stamped source:"llm", confidence:0.7. The merged
 * overlay is validated against PackMechanicsOverlaySchema from @fusion/shared
 * before being written. No I/O here except reading the LLM chunks; writing is
 * done by the caller (apply-style) via writeOverlay. This module is otherwise
 * pure so it can be unit-tested.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mechanicsSourceHash } from "./hash.mjs";
import {
  MECHANICS_SCHEMA_VERSION,
  GENERATOR_NAME,
} from "./mechanics-overlay.mjs";
import { findMonorepoRoot } from "./pack-io.mjs";

/** The confidence stamped on every LLM-sourced grant (design contract §3.c). */
export const LLM_CONFIDENCE = 0.7;

/** The 5 feat categories the overlay's Grant schema accepts. */
const GRANT_CATEGORIES = new Set([
  "class",
  "ancestry",
  "skill",
  "general",
  "archetype",
]);

/** The only Unlock kind the overlay schema accepts. */
const ACCEPTED_UNLOCK_KINDS = new Set(["ancestry-feat-eligibility"]);

/**
 * REVIEW DENYLIST — docIds whose LLM grant is a false positive and must NOT
 * be added, keyed for auditability. The overlay models "pick a feat meeting
 * declarative predicates" (planVM.ts GRANTED_FEAT_CHOICES). A feat that grants
 * ONE SPECIFIC named feat is a fixed award, not a player choice — modelling it
 * as a category-wide feat-choice would wrongly open a picker over the whole
 * category (a talent-gating bug). The LLM conflated "grants <Named Feat>" with
 * "grants a choice of <category> feat". These four were verified against their
 * descriptions in the sample review:
 *
 *   MmNT1k1Zu26jGSXc  Ratfolk Lore     -> "the Additional Lore general feat"  (fixed)
 *   ZtXtqMxa3sZvhZ4m  Skull Creeper    -> "the Intimidating Glare skill feat" (fixed)
 *   W2TtTf4vbOLuac4K  Aloof Firmament  -> "the Cat Fall general feat"         (fixed, conditional)
 *   9qxi3y111QjyQ7oE  Sparkling Targe  -> "the Shield Block general feat"     (fixed)
 *
 * Engine Bay (UfknkTVC2ks7AnzY) is KEPT: "you gain a different 1st-level skill
 * feat you qualify for" is a genuine bounded choice (skill, level ≤ 1).
 */
export const LLM_REVIEW_DENYLIST = new Set([
  "MmNT1k1Zu26jGSXc",
  "ZtXtqMxa3sZvhZ4m",
  "W2TtTf4vbOLuac4K",
  "9qxi3y111QjyQ7oE",
]);

/**
 * Lazily loads PackMechanicsOverlaySchema from the compiled @fusion/shared
 * ESM build (dist/mechanics.js). Resolved by path from the monorepo root so
 * the tool runs from any cwd and does not need @fusion/shared on its own
 * node resolution path (it isn't a dependency of this workspace package).
 */
let _schemaPromise = null;
export function loadOverlaySchema(root = findMonorepoRoot()) {
  if (!_schemaPromise) {
    const distPath = join(root, "packages", "shared", "dist", "mechanics.js");
    _schemaPromise = import(pathToFileURL(distPath).href).then(
      (m) => m.PackMechanicsOverlaySchema,
    );
  }
  return _schemaPromise;
}

/**
 * Reads and left-to-right merges every `chunk-*.json` for a pack under an
 * LLM output dir. Returns {} if the pack has no LLM chunks yet.
 *
 * @returns {Record<string, {grants?: object[], unlocks?: object[]}>}
 */
export function readLlmChunks(llmDir, slug) {
  const packDir = join(llmDir, slug);
  if (!existsSync(packDir)) return {};

  const files = readdirSync(packDir)
    .filter((name) => name.startsWith("chunk-") && name.endsWith(".json"))
    .sort();

  const merged = {};
  for (const file of files) {
    const data = JSON.parse(readFileSync(join(packDir, file), "utf8"));
    // Later chunks win on docId conflict (same convention as readTranslatedFiles).
    Object.assign(merged, data);
  }
  return merged;
}

/**
 * Adapts one flat LLM grant into the overlay's Grant shape, or returns null
 * when it has no valid feat-choice representation.
 *
 * Filters mirror the rule-element normalizer: literal `traits` and a literal
 * numeric `maxLevel` become `filters.{traits,maxLevel}`. An empty filter set
 * yields `filters: {}` (schema-valid).
 */
export function adaptLlmGrant(llmGrant) {
  if (!llmGrant || llmGrant.kind !== "featChoice") return null;
  if (!GRANT_CATEGORIES.has(llmGrant.category)) return null;

  const filters = {};
  if (Array.isArray(llmGrant.traits) && llmGrant.traits.length > 0) {
    filters.traits = [...llmGrant.traits];
  }
  if (typeof llmGrant.maxLevel === "number" && Number.isInteger(llmGrant.maxLevel)) {
    filters.maxLevel = llmGrant.maxLevel;
  }

  const count =
    typeof llmGrant.count === "number" && Number.isInteger(llmGrant.count) && llmGrant.count >= 1
      ? llmGrant.count
      : 1;

  return {
    kind: "feat-choice",
    category: llmGrant.category,
    count,
    filters,
    source: "llm",
    confidence: LLM_CONFIDENCE,
  };
}

/** Adapts one flat LLM unlock, or returns null if its kind is unsupported. */
export function adaptLlmUnlock(llmUnlock) {
  if (!llmUnlock || !ACCEPTED_UNLOCK_KINDS.has(llmUnlock.kind)) return null;
  return {
    kind: llmUnlock.kind,
    mechanism: typeof llmUnlock.mechanism === "string" ? llmUnlock.mechanism : llmUnlock.kind,
    filters: llmUnlock.filters && typeof llmUnlock.filters === "object" ? llmUnlock.filters : {},
    source: "llm",
    confidence: LLM_CONFIDENCE,
  };
}

/**
 * Builds the set of LLM entries to ADD to a pack overlay, given the raw LLM
 * chunk map, the existing (rule-element) overlay, and the pack's docs (for
 * sourceHash + doc existence).
 *
 * @returns {{
 *   added: Record<string, {sourceHash, grants, unlocks}>,
 *   stats: { conflicts: string[], missingDocs: string[], droppedGrants: object[], droppedUnlocks: object[], addedGrantCount: number, addedUnlockCount: number }
 * }}
 */
export function buildLlmAdditions({ llmChunks, existingOverlay, docsById, denylist = LLM_REVIEW_DENYLIST }) {
  const existingIds = new Set(Object.keys(existingOverlay?.entries ?? {}));
  const added = {};
  const stats = {
    conflicts: [],
    missingDocs: [],
    denied: [],
    droppedGrants: [],
    droppedUnlocks: [],
    addedGrantCount: 0,
    addedUnlockCount: 0,
  };

  for (const docId of Object.keys(llmChunks).sort()) {
    // Rule-element precedence: never touch a doc the deterministic pass owns.
    if (existingIds.has(docId)) {
      stats.conflicts.push(docId);
      continue;
    }

    // Sample-review denylist: LLM false positives removed by hand.
    if (denylist.has(docId)) {
      stats.denied.push(docId);
      continue;
    }

    const doc = docsById.get(docId);
    if (!doc) {
      // LLM referenced a doc id absent from the current pack (stale export).
      stats.missingDocs.push(docId);
      continue;
    }

    const raw = llmChunks[docId];
    const grants = [];
    for (const g of raw.grants ?? []) {
      const adapted = adaptLlmGrant(g);
      if (adapted) grants.push(adapted);
      else stats.droppedGrants.push({ docId, kind: g?.kind, category: g?.category });
    }
    const unlocks = [];
    for (const u of raw.unlocks ?? []) {
      const adapted = adaptLlmUnlock(u);
      if (adapted) unlocks.push(adapted);
      else stats.droppedUnlocks.push({ docId, kind: u?.kind });
    }

    // Nothing survived adaptation -> no entry (keeps the overlay lean, same
    // rule extractMechanicsForPack uses).
    if (grants.length === 0 && unlocks.length === 0) continue;

    added[docId] = {
      sourceHash: mechanicsSourceHash(doc),
      grants,
      unlocks,
    };
    stats.addedGrantCount += grants.length;
    stats.addedUnlockCount += unlocks.length;
  }

  return { added, stats };
}

/**
 * Merges LLM additions into an existing overlay, producing a full,
 * schema-shaped overlay with sorted entries. rule-element entries are carried
 * through untouched; LLM entries only fill docIds the existing overlay lacks
 * (buildLlmAdditions already enforced this, but we defensively keep existing
 * on any overlap).
 *
 * Idempotent: re-running with the same inputs yields byte-identical entries.
 */
export function mergeLlmIntoOverlay({
  packId,
  existingOverlay,
  additions,
  generatedAt = new Date().toISOString(),
}) {
  // existing LAST so a rule-element entry always wins a docId tie.
  const entries = { ...additions, ...(existingOverlay?.entries ?? {}) };

  const sortedEntries = {};
  for (const key of Object.keys(entries).sort()) {
    sortedEntries[key] = entries[key];
  }

  return {
    schemaVersion: existingOverlay?.schemaVersion ?? MECHANICS_SCHEMA_VERSION,
    packId,
    generatedAt,
    generator: GENERATOR_NAME,
    entries: sortedEntries,
  };
}
