/**
 * mechanics-overlay.mjs — pure logic for building/merging the mechanics
 * overlay (mechanics.json). No CLI side effects — safe to import from tests
 * and from grants-from-rules.mjs / apply.mjs.
 *
 * Overlay schema (contract §3.a):
 *   {
 *     schemaVersion, packId, generatedAt, generator,
 *     entries: { [docId]: { sourceHash, grants: Grant[], unlocks: Unlock[] } }
 *   }
 */

import { normalizeDocMechanics } from "./normalize-rules.mjs";
import { mechanicsSourceHash } from "./hash.mjs";

export const MECHANICS_FILENAME = "mechanics.json";
export const MECHANICS_SCHEMA_VERSION = 1;
export const GENERATOR_NAME = "tools/translate-packs@0.1.0";

/** Strips the internal bookkeeping fields (_flag, _docId) normalize-rules.mjs adds to grants for calibration/labeling. */
function toPublicGrant(grant) {
  const { _flag, _docId, ...publicGrant } = grant;
  return publicGrant;
}

/**
 * Builds the mechanics.rules.json-shaped result for one pack: normalizes
 * every doc's rule elements into grants/unlocks and stamps a sourceHash.
 *
 * @param {object[]} docs - raw Fusion docs from documents.json.
 * @returns {{ entries: Record<string, {sourceHash, grants, unlocks}> }}
 */
export function extractMechanicsForPack(docs) {
  const entries = {};

  for (const doc of docs) {
    const { grants, unlocks } = normalizeDocMechanics(doc);
    // Only emit an entry when there's something to say — keeps the overlay
    // lean (matches the contract's example: Alchemist Dedication has no
    // ChoiceSet-driven grant, so it's registered as "sem grant de escolha"
    // rather than an empty placeholder entry).
    if (grants.length === 0 && unlocks.length === 0) continue;

    entries[doc._id] = {
      sourceHash: mechanicsSourceHash(doc),
      grants: grants.map(toPublicGrant),
      unlocks,
    };
  }

  return { entries };
}

/**
 * Merges freshly-extracted mechanics entries into an existing (or fresh)
 * pack overlay. Deterministic-only entries (source: "rule-element") always
 * win over a stale curated/llm entry for the same doc id+sourceHash, since
 * they're recomputed from the ground truth on every run.
 *
 * Idempotent: entries are re-sorted by key on every merge.
 */
export function mergeMechanicsOverlay({
  packId,
  existingOverlay,
  freshEntries,
  generatedAt = new Date().toISOString(),
}) {
  const entries = { ...(existingOverlay?.entries ?? {}), ...freshEntries };

  const sortedEntries = {};
  for (const key of Object.keys(entries).sort()) {
    sortedEntries[key] = entries[key];
  }

  return {
    schemaVersion: MECHANICS_SCHEMA_VERSION,
    packId,
    generatedAt,
    generator: GENERATOR_NAME,
    entries: sortedEntries,
  };
}
