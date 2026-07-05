/**
 * glossary.mjs — loader + deterministic application of the pt-BR glossary.
 *
 * See ../GLOSSARY.md for the clean-room policy this module enforces:
 * generic mechanical terms only, no proprietary phrasing, EN always the
 * fallback, deterministic word-boundary substitution (auditable — no
 * learned "style" from any copyrighted localization).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_GLOSSARY_PATH = join(__dirname, "..", "glossary.pt-BR.json");

/** Loads the glossary.pt-BR.json file (default path or an override, e.g. for tests). */
export function loadGlossary(path = DEFAULT_GLOSSARY_PATH) {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.terms !== "object") {
    throw new Error(`Invalid glossary file at ${path}: missing "terms" object`);
  }
  return parsed;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the glossary's terms sorted by descending EN-term length, so that
 * multi-word terms (e.g. "class feat") are matched/replaced before their
 * single-word substrings (e.g. "feat") — prevents partial-term corruption.
 */
export function sortedTermEntries(glossary) {
  return Object.entries(glossary.terms).sort((a, b) => b[0].length - a[0].length);
}

/**
 * Reports which glossary terms (by EN key) are present in a piece of EN
 * source text — used by qa.mjs to verify a translated doc's key mechanical
 * terms were actually covered by the glossary pass.
 */
export function findGlossaryTermsInText(text, glossary) {
  const lowerText = text.toLowerCase();
  const found = [];
  for (const [term] of sortedTermEntries(glossary)) {
    const pattern = new RegExp(`\\b${escapeRegExp(term.toLowerCase())}\\b`);
    if (pattern.test(lowerText)) found.push(term);
  }
  return found;
}
