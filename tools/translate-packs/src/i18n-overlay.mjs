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
import { stripHtmlToText } from "./qa-checks.mjs";

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
 * Builds translation work-units for one pack's docs.
 *
 * A doc is only skipped when it is REALLY translated (issue #9, parent of
 * #27 — the QA gate had the identical blind spot before it was fixed). The
 * decision, per doc:
 *
 *   | existing entry | hash matches | EN has prose | noDescription | PT description | -> |
 *   |-----------------|--------------|--------------|----------------|-----------------|----|
 *   | none            | -            | -            | -              | -               | EMIT (stale=false) |
 *   | present         | no (stale)   | -            | -              | -               | EMIT (stale=true) |
 *   | present         | yes          | no           | -              | -               | SKIP (nothing to translate) |
 *   | present         | yes          | yes          | true           | -               | SKIP (explicit valve) |
 *   | present         | yes          | yes          | false/absent   | non-empty       | SKIP (actually translated) |
 *   | present         | yes          | yes          | false/absent   | absent/""       | EMIT (reason: "missing-description") |
 *
 * "EN has prose" uses the EXACT same definition as the QA gate's
 * `checkDoc` (src/qa-checks.mjs): `stripHtmlToText(description).trim().length > 0`.
 * If this ever diverges from qa-checks.mjs, the extractor and the QA gate
 * will disagree about what counts as translatable text again.
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
    const staleHash = Boolean(existing) && existing.sourceHash !== sourceHash;

    if (existing && !staleHash) {
      const hasProse = stripHtmlToText(description).trim().length > 0;
      const hasDescriptionPt = existing.description !== undefined && existing.description !== "";

      if (!hasProse || existing.noDescription === true || hasDescriptionPt) {
        // Nothing left to translate: EN carries no real prose, the doc is
        // explicitly marked name-only (noDescription valve), or a real
        // pt-BR description is already present and the hash still matches.
        skipped++;
        continue;
      }

      // EN has real prose and the hash matches (name+description
      // unchanged since the entry was written), but the entry has no
      // description and no explicit noDescription valve — this is the
      // invisible gap: re-emit it, flagged so the translator knows the
      // `name` is already done and only the description is missing.
      const { unconvertedRules, systemRules } = extractRelevantRules(doc);
      units.push({
        id: doc._id,
        name,
        description,
        sourceHash,
        stale: false,
        reason: "missing-description",
        unconvertedRules,
        systemRules,
      });
      continue;
    }

    const { unconvertedRules, systemRules } = extractRelevantRules(doc);
    units.push({
      id: doc._id,
      name,
      description,
      sourceHash,
      stale: staleHash,
      unconvertedRules,
      systemRules,
    });
  }

  return { units, skipped };
}

/**
 * Merges freshly-translated entries into an existing (or fresh) overlay.
 *
 * `translations` is a map keyed by doc id: { [id]: { name, description?,
 * noDescription?, prerequisites? } }. `sourceHashesById` supplies the sourceHash to stamp
 * for each id (computed from the current EN doc at merge time — NOT
 * trusted from the translation input — so a stale translation can never
 * silently claim freshness).
 *
 * `noDescription` (the escape-hatch valve from PackI18nEntrySchema,
 * packages/shared/src/compendium.ts) and `prerequisites` (issue #32's
 * per-document prerequisite-translation escape hatch — see the schema doc
 * comment) are PackI18nEntry fields besides name/description/sourceHash —
 * both must survive a re-merge or the doc silently loses them the next time
 * apply.mjs runs. Precedence per id:
 *   noDescription:
 *     1. `translation.noDescription` explicit in this batch -> wins (lets a
 *        translator declare or revoke the valve deliberately).
 *     2. `translation.description` present in this batch -> a real
 *        description was just supplied, so any old valve is stale -> cleared.
 *     3. otherwise -> carried over from the existing entry, if any.
 *   prerequisites:
 *     1. `translation.prerequisites` explicit in this batch -> wins (lets a
 *        translator set or revise it deliberately).
 *     2. otherwise -> carried over from the existing entry, if any. Unlike
 *        noDescription, a fresh `description` does NOT invalidate it — the
 *        two fields translate different `system` sub-paths (description vs.
 *        prerequisites), so retranslating one says nothing about the other.
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
    const existingEntry = entries[id];
    const entry = { name: translation.name, sourceHash };
    if (translation.description !== undefined) entry.description = translation.description;

    let noDescription;
    if (translation.noDescription !== undefined) {
      noDescription = translation.noDescription;
    } else if (translation.description !== undefined) {
      noDescription = undefined; // a fresh description was provided -> any old valve is stale.
    } else {
      noDescription = existingEntry?.noDescription; // carry over, untouched this round.
    }
    if (noDescription !== undefined) entry.noDescription = noDescription;

    const prerequisites =
      translation.prerequisites !== undefined
        ? translation.prerequisites
        : existingEntry?.prerequisites; // carry over, untouched this round.
    if (prerequisites !== undefined) entry.prerequisites = prerequisites;

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
