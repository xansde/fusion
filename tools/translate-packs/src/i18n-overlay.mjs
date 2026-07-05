/**
 * i18n-overlay.mjs — pure logic for building/merging the pt-BR translation
 * overlay (i18n.pt-BR.json). No CLI side effects — safe to import from tests
 * and from both extract.mjs (work-unit generation) and apply.mjs (merge).
 *
 * Overlay schema (contract §3.a):
 *   {
 *     schemaVersion, packId, locale: "pt-BR", generatedAt, generator,
 *     attribution,
 *     entries: { [docId]: { name, description?, sourceHash } }
 *   }
 */

import { i18nSourceHash } from "./hash.mjs";

export const I18N_FILENAME = "i18n.pt-BR.json";
export const I18N_SCHEMA_VERSION = 1;
export const GENERATOR_NAME = "tools/translate-packs@0.1.0";

export const ATTRIBUTION_TEXT =
  "Tradução pt-BR derivada (fan-content) do texto ORC/OGL em inglês do pack; " +
  "NÃO é a tradução oficial brasileira. Texto-fonte: foundryvtt/pf2e (ORC/OGL por documento).";

/** Extracts { unconvertedRules, systemRules } needed by grants-from-rules.mjs, kept lean for chunk files. */
function extractRelevantRules(doc) {
  const unconvertedRules = (doc?.flags?.fusion?.unconvertedRules ?? []).filter(
    (r) => r?.key === "ChoiceSet",
  );
  const systemRules = (doc?.system?.rules ?? []).filter((r) => r?.kind === "grant-item");
  return { unconvertedRules, systemRules };
}

/**
 * Builds translation work-units for one pack's docs, skipping docs whose
 * sourceHash already matches a non-stale entry in the existing overlay.
 *
 * @param {object[]} docs - raw Fusion docs from documents.json.
 * @param {object|null} existingOverlay - the pack's current i18n.pt-BR.json (or null).
 * @returns {{ units: object[], skipped: number }}
 */
export function buildWorkUnitsForPack(docs, existingOverlay) {
  const existingEntries = existingOverlay?.entries ?? {};
  const units = [];
  let skipped = 0;

  for (const doc of docs) {
    const name = doc?.name ?? "";
    const description = doc?.system?.description ?? "";
    const sourceHash = i18nSourceHash(name, description);
    const existing = existingEntries[doc._id];

    if (existing && existing.sourceHash === sourceHash) {
      skipped++;
      continue;
    }

    const { unconvertedRules, systemRules } = extractRelevantRules(doc);
    units.push({
      id: doc._id,
      name,
      description,
      sourceHash,
      stale: Boolean(existing) && existing.sourceHash !== sourceHash,
      unconvertedRules,
      systemRules,
    });
  }

  return { units, skipped };
}

/**
 * Merges freshly-translated entries into an existing (or fresh) overlay.
 *
 * `translations` is a map keyed by doc id: { [id]: { name, description? } }.
 * `sourceHashesById` supplies the sourceHash to stamp for each id (computed
 * from the current EN doc at merge time — NOT trusted from the translation
 * input — so a stale translation can never silently claim freshness).
 *
 * Idempotent: merging the same translations twice produces byte-identical
 * output (entries are re-sorted by key on every merge).
 */
export function mergeI18nOverlay({
  packId,
  existingOverlay,
  translations,
  sourceHashesById,
  generatedAt = new Date().toISOString(),
}) {
  const entries = { ...(existingOverlay?.entries ?? {}) };

  for (const [id, translation] of Object.entries(translations)) {
    const sourceHash = sourceHashesById[id];
    if (!sourceHash) continue; // doc no longer exists in the pack — drop silently.
    const entry = { name: translation.name, sourceHash };
    if (translation.description !== undefined) entry.description = translation.description;
    entries[id] = entry;
  }

  const sortedEntries = {};
  for (const key of Object.keys(entries).sort()) {
    sortedEntries[key] = entries[key];
  }

  return {
    schemaVersion: I18N_SCHEMA_VERSION,
    packId,
    locale: "pt-BR",
    generatedAt,
    generator: GENERATOR_NAME,
    attribution: ATTRIBUTION_TEXT,
    entries: sortedEntries,
  };
}

/**
 * Given the current EN docs, returns { [id]: sourceHash } — the trusted hash
 * table used by mergeI18nOverlay to validate incoming translations.
 */
export function computeSourceHashesById(docs) {
  const map = {};
  for (const doc of docs) {
    map[doc._id] = i18nSourceHash(doc?.name ?? "", doc?.system?.description ?? "");
  }
  return map;
}

/**
 * Marks entries in an overlay as stale relative to the current docs (i.e.
 * their stored sourceHash no longer matches the live EN doc) — returns the
 * list of doc ids needing retranslation. Pure read-only helper for
 * reporting/QA; does not mutate the overlay.
 */
export function findStaleEntries(overlay, sourceHashesById) {
  if (!overlay) return [];
  const stale = [];
  for (const [id, entry] of Object.entries(overlay.entries ?? {})) {
    const currentHash = sourceHashesById[id];
    if (currentHash && currentHash !== entry.sourceHash) stale.push(id);
  }
  return stale;
}
