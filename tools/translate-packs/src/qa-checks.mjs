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
 *                         existed (verbatim) in EN — translation must only
 *                         touch prose/labels, never invent or mutate
 *                         enricher syntax.
 */

import { findGlossaryTermsInText } from "./glossary.mjs";

const DICE_PATTERN = /\d+d\d+(?:[+-]\d+)?/gi;
const TAG_PATTERN = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
const ENRICHER_PATTERN = /@[A-Za-z]+\[[^\]]*\](?:\{[^}]*\})?/g;

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

/**
 * Runs all QA checks for one doc, given its EN name/description and the
 * matching pt-BR overlay entry. Returns a list of failure reason strings
 * (empty = pass).
 */
export function checkDoc({ nameEn, descriptionEn, entry, glossary }) {
  const failures = [];
  if (!entry) return failures; // no translation yet — not a QA failure, just untranslated.

  const descriptionPt = entry.description;
  const hasDescriptionEn = Boolean(descriptionEn);
  const hasDescriptionPt = descriptionPt !== undefined && descriptionPt !== "";

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

    // 3. glossary-applied
    if (glossary) {
      const enPlainText = stripHtmlToText(descriptionEn);
      const termsInEn = findGlossaryTermsInText(enPlainText, glossary);
      if (termsInEn.length > 0) {
        const ptLower = descriptionPt.toLowerCase();
        const anyTranslated = termsInEn.some((term) => {
          const ptTerm = glossary.terms[term];
          return ptTerm && ptLower.includes(ptTerm.toLowerCase());
        });
        if (!anyTranslated) {
          failures.push(
            `glossary-applied: none of the EN glossary terms [${termsInEn.join(", ")}] found translated in PT`,
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

    // 5. no-new-enrichers
    const enrichersEn = extractEnrichers(descriptionEn);
    const enrichersPt = extractEnrichers(descriptionPt);
    for (const enricher of enrichersPt) {
      if (!enrichersEn.has(enricher)) {
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

    const failures = checkDoc({
      nameEn: doc.name,
      descriptionEn: doc.system?.description ?? "",
      entry,
      glossary,
    });

    results.push({ id: doc._id, name: doc.name, pass: failures.length === 0, failures });
  }

  return results;
}
