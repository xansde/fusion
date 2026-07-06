#!/usr/bin/env node
/**
 * fix-missing-accents.mjs — restores missing pt-BR diacritics in translated
 * pack overlays (r13 translation waves dropped accents on a subset of docs).
 *
 * Applies a curated, UNAMBIGUOUS dictionary of unaccented -> accented pt-BR
 * word forms (whole-word, case-preserving) to `name` and `description` in
 * `systems/pf2e/packs/<pack>/i18n.pt-BR.json` overlays.
 *
 * Deliberately EXCLUDES ambiguous forms that are valid pt-BR words with or
 * without an accent depending on grammatical role (e.g. "e"/"é", "esta"/"está",
 * "para"/"pára", "tem"/"têm", "as"/"às", "so"/"só", "ja" is safe but "pode"/
 * "pôde" and "sabia"/"sábia" are not) — see DICTIONARY below and its inline
 * rationale. Those residual cases are handled by manual/LLM review, not here.
 *
 * Never touches enricher STRUCTURAL spans (`@Tag[...]`) — reuses
 * extractEnricherSpans from fix-enricher-structural.mjs so dice formulas, UUIDs
 * and slugs inside `@Damage[...]`, `@Check[...]`, `@Template[...]`, etc. are
 * left byte-identical. The optional trailing `{label}` of an enricher IS
 * eligible for substitution, same as any other prose text.
 *
 * Idempotent: re-running after a fix is a no-op (dictionary values are already
 * fully accented, so the unaccented-word regex no longer matches them).
 *
 * Usage:
 *   node src/fix-missing-accents.mjs [--packs pack1,pack2] [--dry-run] [--report out/accents-report.json]
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  resolveSystemPacksDir,
  listPackSlugs,
  readOverlay,
  writeOverlay,
  ensureDir,
} from "./pack-io.mjs";
import { extractEnricherSpans } from "./fix-enricher-structural.mjs";

const I18N_FILENAME = "i18n.pt-BR.json";

// ===========================================================================
// Curated dictionary: unaccented (lowercase) -> correctly accented pt-BR form.
//
// Every entry here is a word that, in the Fusion pack corpus (TTRPG rules
// prose: spells, feats, actions, conditions), is UNAMBIGUOUSLY missing an
// accent — i.e. the unaccented spelling is never itself a valid distinct
// pt-BR word in this register. Deliberately excluded (checked, NOT included):
//   e/é, esta/está, estas/estás, esse-family (already correct unaccented),
//   as/às, tem/têm, para/pára (archaic, unused), sabia/sábia, pode/pôde,
//   po(r)/pôr vs "por", ha/há (only 2 letters, too risky), so/só, da/dá,
//   pela/pelá(n/a), acerto (correct as-is), faca/faça and esta/está (ambiguous
//   verb-vs-noun forms — left to manual/LLM review), and any word already
//   used correctly unaccented elsewhere (elas, esse, eles, embora, tempo,
//   raio, luz, mente, mover, redor, dia).
// ===========================================================================
export const DICTIONARY = {
  // pronoun / core grammar
  voce: "você",
  nao: "não",

  // irregular / short high-frequency forms not covered by the suffix rules below
  distancia: "distância",
  ilusao: "ilusão",
  visao: "visão",
  bencao: "bênção",
  bencoes: "bênçãos",
  orgao: "órgão",
  orgaos: "órgãos",
  religiao: "religião",
  regiao: "região",
  regioes: "regiões",

  // adjectives / adverbs
  dificil: "difícil",
  rapido: "rápido",
  rapida: "rápida",
  proximo: "próximo",
  proxima: "próxima",
  magica: "mágica",
  magicas: "mágicas",
  magico: "mágico",
  magicos: "mágicos",
  basico: "básico",
  basica: "básica",
  basicas: "básicas",
  maximo: "máximo",
  habil: "hábil",
  habeis: "hábeis",
  razoavel: "razoável",
  razoaveis: "razoáveis",

  // nouns
  nivel: "nível",
  niveis: "níveis",
  numero: "número",
  area: "área",
  areas: "áreas",
  agua: "água",
  trovao: "trovão",
  parametro: "parâmetro",
  parametros: "parâmetros",
  habito: "hábito",
  habitos: "hábitos",
  fenomeno: "fenômeno",
  fenomenos: "fenômenos",
  razao: "razão",
  razoes: "razões",
  ambito: "âmbito",
  pronuncia: "pronúncia",
  graca: "graça",
  gracas: "graças",
  pratica: "prática",
  praticas: "práticas",
  pratico: "prático",
  praticos: "práticos",

  // adverbs / connectives
  tambem: "também",
  ate: "até",
  apos: "após",
  alem: "além",
  atraves: "através",
  entao: "então",
  tres: "três",

  // -ência / -ância nouns: kept as an EXPLICIT list (not a suffix rule) because
  // "-encia"/"-ancia" is NOT a safe blanket suffix — "silencia" (3rd person of
  // the verb "silenciar", e.g. "Voce silencia a voz do alvo") is a real,
  // correctly-unaccented pt-BR word that would be corrupted into the
  // nonexistent "silência" by a generic rule. Every entry below was verified
  // against the actual corpus (see fix-missing-accents dictionary audit).
  resistencia: "resistência",
  resistencias: "resistências",
  circunstancia: "circunstância",
  circunstancias: "circunstâncias",
  proficiencia: "proficiência",
  frequencia: "frequência",
  aparencia: "aparência",
  aparencias: "aparências",
  sobrevivencia: "sobrevivência",
  experiencia: "experiência",
  inteligencia: "inteligência",
  audiencia: "audiência",
  confluencia: "confluência",
  essencia: "essência",
  existencia: "existência",
  potencia: "potência",
  videncia: "vidência",
  violencia: "violência",
  providencia: "providência",
  dependencia: "dependência",
  preferencia: "preferência",
  sequencias: "sequências",
  transferencia: "transferência",
  deficiencia: "deficiência",
  resiliencia: "resiliência",
  aderencia: "aderência",
  ausencia: "ausência",
  exigencia: "exigência",
  influencia: "influência",
  referencia: "referência",
  necromancia: "necromância",
  elegancia: "elegância",
  substancias: "substâncias",
  ganancia: "ganância",
  prestancia: "prestância",
  tolerancia: "tolerância",
  jactancia: "jactância",
  jactancias: "jactâncias",

  // additional adjectives/nouns found in a broader residual sweep (not
  // covered by the mission's seed pattern, but equally unambiguous — pt-BR
  // has no valid unaccented reading of these words). Explicitly NOT included
  // here: "heroico", "celestial", "primordial" — all correctly spelled
  // WITHOUT an accent in pt-BR (the 1990/2009 orthographic agreement dropped
  // the accent from "-eico"/paroxytone forms like these).
  facil: "fácil",
  faceis: "fáceis",
  util: "útil",
  uteis: "úteis",
  possivel: "possível",
  impossivel: "impossível",
  unico: "único",
  unica: "única",
  unicos: "únicos",
  unicas: "únicas",
  publico: "público",
  publica: "pública",
  publicos: "públicos",
  publicas: "públicas",
  proprio: "próprio",
  propria: "própria",
  proprios: "próprios",
  proprias: "próprias",
  ultimo: "último",
  ultima: "última",
  ultimos: "últimos",
  ultimas: "últimas",
  minimo: "mínimo",
  minima: "mínima",
  minimos: "mínimos",
  minimas: "mínimas",
  generico: "genérico",
  generica: "genérica",
  genericos: "genéricos",
  genericas: "genéricas",
  especifico: "específico",
  especifica: "específica",
  especificos: "específicos",
  especificas: "específicas",
  acido: "ácido",
  acidos: "ácidos",
  fisico: "físico",
  fisica: "física",
  fisicos: "físicos",
  fisicas: "físicas",
  toxico: "tóxico",
  toxica: "tóxica",
  toxicos: "tóxicos",
  toxicas: "tóxicas",

  // found via a same-doc accent-inconsistency sweep (same stem appearing both
  // accented and unaccented in the same description — a strong signal of a
  // residual miss), each verified unambiguous in context.
  multidao: "multidão",
  momentanea: "momentânea",
  doenca: "doença",
  doencas: "doenças",
  prismatico: "prismático",
  prismatica: "prismática",
  ilusoria: "ilusória",
  ilusorio: "ilusório",
  estomago: "estômago",
  polen: "pólen",
  artificio: "artifício",
  espiritos: "espíritos",
  puxao: "puxão",
  talao: "talão",
  historia: "história",
};

// ===========================================================================
// Regular suffix rules — cover the large, productive -ção/-ções family without
// enumerating every noun (evocacao, transmutacao, reacao, etc. all fall out of
// these two patterns). This suffix is unambiguous in pt-BR: a word ending in
// "-cao"/"-coes" is never a distinct valid word without the cedilla+tilde
// (unlike "-encia"/"-ancia", which collides with real verb forms like
// "silencia" — see DICTIONARY above). Matched whole-word, case-preserving,
// same as DICTIONARY.
// ===========================================================================
const SUFFIX_RULES = [
  { pattern: /^([a-z]+)cao$/i, replace: (m) => `${m[1]}ção` },
  { pattern: /^([a-z]+)coes$/i, replace: (m) => `${m[1]}ções` },
];

/** Looks up a lowercase word in DICTIONARY, falling back to SUFFIX_RULES. Returns null if no rule applies. */
export function lookupReplacement(lowerWord) {
  if (DICTIONARY[lowerWord]) return DICTIONARY[lowerWord];
  for (const rule of SUFFIX_RULES) {
    const m = lowerWord.match(rule.pattern);
    if (m) return rule.replace(m);
  }
  return null;
}

// Frequent WRONG-accent/typo fixes verified against real pack text (r13
// residue). Keys/values here are checked literal substrings, applied AFTER
// the unaccented-word pass, and are intentionally narrow (not whole-word
// regex driven) because they are misplaced-diacritic or misspelled typos,
// not simply missing accents:
//   - "impossívelmente" has a WRONG accent (pt-BR "-mente" adverbs never
//     carry their own accent, even when derived from an accented adjective
//     like "impossível") -> correct form has NO accent: "impossivelmente".
//   - "radiacancia" is a one-off misspelling of "radiância" (actions-core,
//     "Abencoa Aliado" / Bless Ally), not a suffix-rule case.
//   - "Jaciancias" is a one-off misspelling of "Jactâncias" (feats-core,
//     "Jactancia Triunfante" / Triumphant Boast), inconsistent with the
//     sibling doc that correctly used "Jactancia" (fixed via DICTIONARY).
//   - "critico"/"critica" are DELIBERATELY NOT in DICTIONARY as whole-word
//     rules: "crítico"/"crítica" (adjective: Sucesso Crítico / Falha Crítica)
//     needs the accent, but "critica"/"critico" is ALSO the correct
//     unaccented verb form ("você critica com sucesso" = "you critique
//     successfully", feats-core "Distração Prolongada"). Only the fixed
//     rules-terminology PHRASES below are safe to correct in bulk (each is a
//     literal 2-word collocation that is ALWAYS the adjective in this
//     corpus) — every other occurrence is left to manual/LLM review.
// IMPORTANT: every "wrong" side is matched with \b...\b (whole word/phrase
// boundaries) — plain substring matching would let short phrases corrupt
// longer words that merely start with them (e.g. a naive replace of
// "falha critica" -> "falha crítica" would wrongly match inside "falha
// criticamente", re-introducing a wrong accent on every second run and
// breaking idempotency). See buildWrongAccentPatterns below.
const WRONG_ACCENT_FIXES = [
  ["impossívelmente", "impossivelmente"],
  ["radiacancia", "radiância"],
  ["Radiacancia", "Radiância"],
  ["Jaciancias", "Jactâncias"],
  ["jaciancias", "jactâncias"],
  ["sucesso critico", "sucesso crítico"],
  ["Sucesso Critico", "Sucesso Crítico"],
  ["falha critica", "falha crítica"],
  ["Falha Critica", "Falha Crítica"],
  ["acerto critico", "acerto crítico"],
  ["Acerto Critico", "Acerto Crítico"],
  ["dano critico", "dano crítico"],
  ["Dano Critico", "Dano Crítico"],
  // "especializacao" is already fixed to "especialização" by SUFFIX_RULES
  // (runs before WRONG_ACCENT_FIXES in fixFragment), so match the post-fix form.
  ["especialização critica", "especialização crítica"],
  // "críticamente" is a WRONG accent (same -mente rule as "impossívelmente"
  // above): pt-BR adverbs ending in "-mente" never carry their own accent,
  // even when derived from an accented adjective ("crítico" -> "criticamente",
  // no accent). Found across 47 docs (spells/actions/feats/conditions).
  ["críticamente", "criticamente"],
  ["Críticamente", "Criticamente"],
  ["informação critica", "informação crítica"],
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds \b-delimited regexes for WRONG_ACCENT_FIXES so short phrases never match as a substring of a longer word. */
function buildWrongAccentPatterns(fixes) {
  return fixes.map(([wrong, right]) => ({
    pattern: new RegExp(`\\b${escapeRegExp(wrong)}\\b`, "g"),
    right,
  }));
}

const WRONG_ACCENT_PATTERNS = buildWrongAccentPatterns(WRONG_ACCENT_FIXES);

// Generic word-boundary pattern: matches any run of ASCII letters. Actual
// eligibility for replacement is decided per-match by lookupReplacement, so
// this stays a single pass regardless of how DICTIONARY/SUFFIX_RULES grow.
const WORD_PATTERN = /\b[A-Za-z]+\b/g;

/** Reapplies the case pattern of `sample` onto `word` (all-upper, Title, or lower). */
function matchCase(word, sample) {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return word.toUpperCase();
  if (sample[0] === sample[0].toUpperCase() && sample.slice(1) === sample.slice(1).toLowerCase()) {
    return word[0].toUpperCase() + word.slice(1);
  }
  return word;
}

/**
 * Applies the dictionary + wrong-accent fixes to a plain text fragment
 * (no enricher structural spans inside). Returns { text, count }.
 */
function fixFragment(text) {
  let count = 0;
  let out = text.replace(WORD_PATTERN, (match) => {
    const replacement = lookupReplacement(match.toLowerCase());
    if (!replacement) return match;
    count++;
    return matchCase(replacement, match);
  });
  for (const { pattern, right } of WRONG_ACCENT_PATTERNS) {
    const matches = out.match(pattern);
    if (matches) {
      count += matches.length;
      out = out.replace(pattern, right);
    }
  }
  return { text: out, count };
}

/**
 * Applies fixes to a full string that MAY contain `@Tag[...]` enricher
 * structural spans. Only text outside the structural part (including the
 * `{label}` tail) is touched.
 */
export function fixText(text) {
  if (typeof text !== "string" || text.length === 0) return { text, count: 0 };
  const spans = extractEnricherSpans(text);
  if (spans.length === 0) return fixFragment(text);

  let out = "";
  let cursor = 0;
  let count = 0;
  for (const span of spans) {
    const before = fixFragment(text.slice(cursor, span.start));
    out += before.text;
    count += before.count;

    out += span.structural;
    if (span.label) {
      const label = fixFragment(span.label);
      out += label.text;
      count += label.count;
    }
    cursor = span.end;
  }
  const tail = fixFragment(text.slice(cursor));
  out += tail.text;
  count += tail.count;
  return { text: out, count };
}

function parseArgs(argv) {
  const args = { packs: null, dryRun: false, report: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--packs") args.packs = argv[++i].split(",").map((s) => s.trim());
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--report") args.report = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packsRoot = resolveSystemPacksDir("pf2e");
  const slugs = args.packs ?? listPackSlugs(packsRoot);

  const report = { generatedAt: new Date().toISOString(), packs: {} };
  let grandDocs = 0;
  let grandSubs = 0;

  for (const slug of slugs) {
    const overlay = readOverlay(packsRoot, slug, I18N_FILENAME);
    if (!overlay?.entries) continue;

    let docsTouched = 0;
    let substitutions = 0;
    for (const entry of Object.values(overlay.entries)) {
      let entryTouched = false;
      if (typeof entry.name === "string") {
        const { text, count } = fixText(entry.name);
        if (count > 0) {
          entry.name = text;
          substitutions += count;
          entryTouched = true;
        }
      }
      if (typeof entry.description === "string") {
        const { text, count } = fixText(entry.description);
        if (count > 0) {
          entry.description = text;
          substitutions += count;
          entryTouched = true;
        }
      }
      if (entryTouched) docsTouched++;
    }

    if (docsTouched > 0) {
      report.packs[slug] = { docsTouched, substitutions };
      grandDocs += docsTouched;
      grandSubs += substitutions;
      if (!args.dryRun) writeOverlay(packsRoot, slug, I18N_FILENAME, overlay);
      console.log(
        `[fix-accents] ${slug}: ${docsTouched} doc(s), ${substitutions} substitution(s)${args.dryRun ? " (dry-run)" : ""}`,
      );
    }
  }

  console.log(`[fix-accents] TOTAL: ${grandDocs} doc(s), ${grandSubs} substitution(s)`);

  if (args.report) {
    ensureDir(dirname(args.report));
    writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`[fix-accents] report written to ${args.report}`);
  }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
