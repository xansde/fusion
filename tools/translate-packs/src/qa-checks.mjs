/**
 * qa-checks.mjs — pure per-doc translation QA checks. No CLI side effects —
 * safe to import from tests and from qa.mjs.
 *
 *   1. dice-formulas    — the set of \d+d\d+([+-]\d+)? patterns found in EN
 *                         must be IDENTICAL to the set found in PT (dice
 *                         math must never drift during translation).
 *   2. balanced-tags    — PT HTML has the same MULTISET of tag names as EN
 *                         (no tags dropped/added — implies balance, since EN
 *                         is assumed well-formed source HTML).
 *   3. glossary-applied — at least one glossary term present in the EN text
 *                         also appears (in its pt-BR form) in the PT text.
 *                         Skipped when the EN text has zero recognized
 *                         glossary terms (nothing to check).
 *   4. length-ratio     — len(PT) / len(EN) is within [0.5, 2.0].
 *   5. no-new-enrichers — every @Tag[...] enricher present in PT already
 *                         existed (verbatim) in EN, comparing only the
 *                         structural part (@Tag[path/args], before any
 *                         `{label}`) — translating the label text is
 *                         correct and expected; only a changed path/args
 *                         is a real failure.
 */

import { findGlossaryTermsInText } from "./glossary.mjs";

const DICE_PATTERN = /\d+d\d+(?:[+-]\d+)?/gi;
const TAG_PATTERN = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
const ENRICHER_PATTERN = /@[A-Za-z]+\[[^\]]*\](?:\{[^}]*\})?/g;

/** Strips the trailing `{label}` from an enricher match, leaving only the
 * structural `@Tag[path/args]` part — the label may be legitimately
 * translated, but the path/args must never drift. */
function enricherStructuralPart(enricher) {
  const braceIndex = enricher.indexOf("{");
  return braceIndex === -1 ? enricher : enricher.slice(0, braceIndex);
}

function extractDiceFormulas(text) {
  return new Set((text.match(DICE_PATTERN) ?? []).map((m) => m.toLowerCase().replace(/\s+/g, "")));
}

function extractTagMultiset(text) {
  const counts = new Map();
  let match;
  TAG_PATTERN.lastIndex = 0;
  while ((match = TAG_PATTERN.exec(text)) !== null) {
    const tag = match[1].toLowerCase();
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

function extractEnrichers(text) {
  return new Set(text.match(ENRICHER_PATTERN) ?? []);
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function mapsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

function stripHtmlToText(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Normalizes text for tolerant comparison: NFD decomposition + diacritic
 * removal + lowercase. The glossary stores pt-BR values without diacritics
 * (e.g. "pericia", "voce pode"), but real translations correctly use
 * accents (e.g. "perícia", "você pode") — both sides must be normalized
 * before comparing, or every accented glossary hit reads as a miss. */
function normalizeForComparison(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Runs all QA checks for one doc, given its EN name/description and the
 * matching pt-BR overlay entry. Returns a list of failure reason strings
 * (empty = pass).
 */
export function checkDoc({ nameEn, descriptionEn, entry, glossary }) {
  const failures = [];
  if (!entry) return failures; // no translation yet — not a QA failure, just untranslated.

  const descriptionPt = entry.description;
  const hasDescriptionPt = descriptionPt !== undefined && descriptionPt !== "";
  // "EN has a description" must mean EN has TEXT to translate — a doc whose
  // description is empty markup (`<p></p>`) has nothing to translate and must
  // not be reported as a gap.
  const enTextLength = descriptionEn ? stripHtmlToText(descriptionEn).trim().length : 0;
  const hasDescriptionEn = enTextLength > 0;

  // 0. missing-description (issue #27) — EN carries prose and the translation
  // came back empty. This is the failure mode that let 679 empty descriptions
  // reach the packs while the QA reported success: the old gate only ran its
  // checks when BOTH sides had a description, and the single `else if` branch
  // covered the INVERSE case (PT without EN).
  //
  // `noDescription: true` is the explicit escape hatch for a doc deliberately
  // left name-only despite EN prose — without it, "not translated yet" and
  // "intentionally has no prose" are the same empty string and the gate would
  // be noise instead of signal.
  if (hasDescriptionEn && !hasDescriptionPt && entry.noDescription !== true) {
    failures.push(
      `missing-description: EN has ${enTextLength} chars of prose but PT description is ${descriptionPt === undefined ? "absent" : "empty"} (set noDescription: true if intentional)`,
    );
  }

  // Only run description-level checks when both sides have a description.
  // (name-only translations, i.e. entry.description === undefined, pass
  // description checks trivially — nothing to validate.)
  if (hasDescriptionEn && hasDescriptionPt) {
    // 1. dice-formulas
    const diceEn = extractDiceFormulas(descriptionEn);
    const dicePt = extractDiceFormulas(descriptionPt);
    if (!setsEqual(diceEn, dicePt)) {
      failures.push(
        `dice-formulas: EN has [${[...diceEn].join(", ")}] but PT has [${[...dicePt].join(", ")}]`,
      );
    }

    // 2. balanced-tags (same tag multiset EN vs PT)
    const tagsEn = extractTagMultiset(descriptionEn);
    const tagsPt = extractTagMultiset(descriptionPt);
    if (!mapsEqual(tagsEn, tagsPt)) {
      failures.push(
        `balanced-tags: tag multiset mismatch (EN=${JSON.stringify([...tagsEn])}, PT=${JSON.stringify([...tagsPt])})`,
      );
    }

    // 3. glossary-applied — HEURISTIC, reported as a warning (never fails the
    // doc): legitimate translations can use morphological variants the flat
    // glossary can't encode. Enricher syntax is stripped from the EN side
    // first so placeholder-only descriptions (e.g. a bare @Localize[...])
    // don't leak path words like "condition" into term extraction.
    if (glossary) {
      const enPlainText = stripHtmlToText(descriptionEn.replace(ENRICHER_PATTERN, " "));
      const termsInEn = findGlossaryTermsInText(enPlainText, glossary);
      if (termsInEn.length > 0) {
        // Normalize both sides (NFD + strip diacritics + lowercase): the
        // glossary stores pt-BR values without accents (e.g. "pericia",
        // "voce pode"), but correct translations use accents ("perícia",
        // "você pode") — a literal includes() would false-positive-fail
        // every one of those.
        const ptNormalized = normalizeForComparison(descriptionPt);
        const anyTranslated = termsInEn.some((term) => {
          const ptTerm = glossary.terms[term];
          return ptTerm && ptNormalized.includes(normalizeForComparison(ptTerm));
        });
        if (!anyTranslated) {
          failures.push(
            `warning:glossary-applied: none of the EN glossary terms [${termsInEn.join(", ")}] found translated in PT`,
          );
        }
      }
    }

    // 4. length-ratio
    const enLen = stripHtmlToText(descriptionEn).length;
    const ptLen = stripHtmlToText(descriptionPt).length;
    if (enLen > 0) {
      const ratio = ptLen / enLen;
      if (ratio < 0.5 || ratio > 2.0) {
        failures.push(`length-ratio: ${ratio.toFixed(2)} outside [0.5, 2.0] (EN=${enLen} chars, PT=${ptLen} chars)`);
      }
    }

    // 5. no-new-enrichers (structural part only — translating the
    // `{label}` is correct and expected; only a changed path/args is
    // a real failure)
    const enrichersEn = extractEnrichers(descriptionEn);
    const enrichersPt = extractEnrichers(descriptionPt);
    const enricherStructuralPartsEn = new Set([...enrichersEn].map(enricherStructuralPart));
    for (const enricher of enrichersPt) {
      if (!enricherStructuralPartsEn.has(enricherStructuralPart(enricher))) {
        failures.push(`no-new-enrichers: PT introduces enricher not present in EN: ${enricher}`);
      }
    }
  } else if (hasDescriptionPt && !hasDescriptionEn) {
    failures.push("no-new-enrichers: PT has a description but EN doc has none");
  }

  void nameEn; // name is currently unchecked beyond existing — reserved for future name-specific QA.
  return failures;
}

/** Runs checkDoc for every doc in a pack that has a translation entry (skips untranslated docs). */
export function runQaForPack(docs, overlay, glossary) {
  const entries = overlay?.entries ?? {};
  const results = [];

  for (const doc of docs) {
    const entry = entries[doc._id];
    if (!entry) continue; // untranslated — nothing to QA yet.

    const all = checkDoc({
      nameEn: doc.name,
      descriptionEn: doc.system?.description ?? "",
      entry,
      glossary,
    });
    // "warning:"-prefixed entries are heuristic findings (glossary-applied):
    // surfaced in the report but they never fail the doc.
    const warnings = all.filter((f) => f.startsWith("warning:"));
    const failures = all.filter((f) => !f.startsWith("warning:"));

    results.push({ id: doc._id, name: doc.name, pass: failures.length === 0, failures, warnings });
  }

  return results;
}
