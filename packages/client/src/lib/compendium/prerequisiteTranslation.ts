/**
 * prerequisiteTranslation.ts — translate a feat/classFeature's raw EN
 * `system.prerequisites[].value` prose into pt-BR (issue #32).
 *
 * THE PROBLEM: neither the compendium details panel (documentDetails.ts's
 * `prerequisitesField`) nor the Plan column's unmet-requirement chip
 * (planVM.ts's `checkFeatPrerequisites` → `FUSION.Sheet.Plan.Requirement.
 * PrerequisiteUnmet`) ever translated `system.prerequisites` — a pt-BR sheet
 * showed "Pré-requisitos: dragon instinct" and "Exige dragon instinct."
 * verbatim, even though the SAME option is already translated everywhere
 * else ("Instinto Dracônico").
 *
 * WHY COMPOSITION, NOT A 626-ENTRY DICTIONARY: a measurement of the live
 * feats-core pack (998 documents, 1219 occurrences, 626 distinct strings —
 * see issue #32) found the vocabulary that actually needs hand-authoring is
 * small: ~32 compound "rank in <subject>" subjects, ~15 subclass-axis suffix
 * words, and under 100 standalone prose fragments. Everything else already
 * has a translation SOMEWHERE — a skill name, a rank word, or another
 * document's own pt-BR `name` — so this module composes the pt-BR string
 * from those existing pieces instead of duplicating them. Resolution order,
 * each tier attempted only if the previous one fails:
 *
 *   1. RANK TEMPLATE — "trained|expert|master|legendary in|at <subject>"
 *      (optionally "<rank> <Skill>" with no preposition). `<subject>` may be
 *      an "A, B, or C" / "A and B" list; every item must resolve (a skill,
 *      "Perception", "<Save> saves", "<X> Lore", or a curated compound
 *      subject) or the whole rank template is abandoned (never a half-
 *      translated list).
 *   2. DOCUMENT NAME — the text matches (case-insensitively) another
 *      document's EN `name` in {@link DOCUMENT_NAMES_PT} (feats-core first,
 *      then class-features-core, ancestry-features-core, heritages-core,
 *      ancestries-core, backgrounds-core, actions-core — see
 *      gen-prerequisite-names.mjs for the exact priority and homonym
 *      handling). Also tried after stripping a trailing subclass-axis noun
 *      ("eldritch trickster racket" → "Eldritch Trickster") so a bare axis
 *      phrase resolves even when the vendor prose doesn't literally match a
 *      document's full name. THIS is "resolve by document, not by
 *      dictionary": DOCUMENT_NAMES_PT is generated from the SAME overlay
 *      tools/translate-packs writes for descriptions, so coverage grows on
 *      its own as more docs get translated — no dictionary entry to add.
 *   3. CURATED VOCABULARY — a hand-authored pt-BR phrase in
 *      {@link CURATED_PREREQUISITE_PT}, for prose that names no document at
 *      all (e.g. "focus pool", "holy", "an animal companion").
 *   4. GENERIC TEMPLATES — "<Name> Dedication" / "<Name> heritage" / "<Name>
 *      ethnicity|affiliation" / "<Ability> +N" / "bloodline that grants <X>
 *      spells": the STRUCTURAL word is always translatable even when the
 *      named archetype/heritage/ethnicity isn't itself a curated document
 *      (many aren't — they reference splatbook content outside Fusion's
 *      core packs) or hasn't been translated yet.
 *   5. LIST — an "A, B, or C" / "A and B" list (outside the rank template)
 *      resolves item-by-item through tiers 2-4; every item must resolve.
 *   6. FALLBACK — the raw EN string, unchanged. Never invented, never
 *      partially translated outside the list case above.
 *
 * Consumers: documentDetails.ts's `prerequisitesField` (details panel) and
 * planVM.ts's `checkFeatPrerequisites` (Plan column unmet-requirement chip).
 */

import { DOCUMENT_NAMES_PT } from "./documentNamesPt.js";

// ---------------------------------------------------------------------------
// Small, stable vocabularies
// ---------------------------------------------------------------------------

/**
 * The 16 canonical PF2e skills, EN → pt-BR. Deliberately a local copy rather
 * than importing `packages/client/src/lib/sheets/pf2e/skillNames.ts`: that
 * module lives in the sheets/pf2e "territory" (see its own header comment on
 * avoiding cross-territory edits) while this one lives in compendium/,
 * mirroring documentDetails.ts's existing SAVE_LABELS_PT pattern of a small
 * local map rather than a cross-module import for a handful of fixed terms.
 */
const SKILL_NAMES_PT: Readonly<Record<string, string>> = Object.freeze({
  acrobatics: "Acrobacia",
  arcana: "Arcanismo",
  athletics: "Atletismo",
  crafting: "Ofício",
  deception: "Enganação",
  diplomacy: "Diplomacia",
  intimidation: "Intimidação",
  medicine: "Medicina",
  nature: "Natureza",
  occultism: "Ocultismo",
  performance: "Atuação",
  religion: "Religião",
  society: "Sociedade",
  stealth: "Furtividade",
  survival: "Sobrevivência",
  thievery: "Ladinagem",
});

const RANK_NAMES_PT: Readonly<Record<string, string>> = Object.freeze({
  trained: "treinado",
  expert: "especialista",
  master: "mestre",
  legendary: "lendário",
});

const SAVE_NAMES_PT: Readonly<Record<string, string>> = Object.freeze({
  fortitude: "Fortitude",
  reflex: "Reflexos",
  will: "Vontade",
});

const ABILITY_NAMES_PT: Readonly<Record<string, string>> = Object.freeze({
  strength: "Força",
  dexterity: "Destreza",
  constitution: "Constituição",
  intelligence: "Inteligência",
  wisdom: "Sabedoria",
  charisma: "Carisma",
});

const TRADITION_NAMES_PT: Readonly<Record<string, string>> = Object.freeze({
  arcane: "arcanas",
  divine: "divinas",
  occult: "ocultas",
  primal: "primais",
});

/**
 * Compound "rank in <subject>" subjects that are NOT a skill/Perception/save
 * (e.g. "expert in unarmed attacks", "trained in medium armor"). Keyed
 * lowercased. Rank-agnostic — the same subject phrase is reused whatever the
 * rank word is.
 */
const RANK_SUBJECT_VOCAB_PT: Readonly<Record<string, string>> = Object.freeze({
  "unarmed attacks": "ataques desarmados",
  "medium armor": "armadura média",
  "heavy armor": "armadura pesada",
  "light armor": "armadura leve",
  "simple weapons": "armas simples",
  "martial weapons": "armas marciais",
  "advanced weapons": "armas avançadas",
  "a skill with the recall knowledge action": "uma perícia com a ação Recordar Conhecimento",
  "a skill used to recall knowledge": "uma perícia usada para Recordar Conhecimento",
  "a recall knowledge skill": "uma perícia de Recordar Conhecimento",
  "a decipher writing skill": "uma perícia de Decifrar Escrita",
  "a lore skill": "uma perícia de Saber",
  "at least one skill": "pelo menos uma perícia",
  "your deity's favoured weapon": "a arma favorita da sua divindade",
  "your deity's favored weapon": "a arma favorita da sua divindade",
  "clan daggers": "adagas de clã",
  "the weapon you chose for unconventional weaponry":
    "a arma escolhida em Armamento Não Convencional",
  "lore about a specific terrain": "Saber sobre um terreno específico",
});

/**
 * Standalone prose that names no document at all (never resolvable "by
 * document") — hand-curated from the highest-occurrence residue of the
 * live feats-core measurement (issue #32). Keyed lowercased; an entry also
 * matches with a leading "a "/"an " article stripped (see
 * {@link stripArticle}), so "familiar" covers both "familiar" and
 * "a familiar".
 */
const CURATED_PREREQUISITE_PT: Readonly<Record<string, string>> = Object.freeze({
  "focus pool": "reserva de foco",
  "warden spells": "magias de guardião",
  "orc ferocity": "Ferocidade Orc",
  unholy: "profano",
  holy: "sagrado",
  "animal companion": "companheiro animal",
  "halfling luck": "Sorte Halfling",
  "orc warmask": "Máscara de Guerra Orc",
  "lay on hands": "impor as mãos",
  "healing font": "fonte de cura",
  "you follow a deity": "você segue uma divindade",
  "exactly one kinetic element": "exatamente um elemento cinético",
  "devotion spell (lay on hands)": "magia devocional (impor as mãos)",
  "harmful font": "fonte prejudicial",
  familiar: "familiar",
  "divine spells": "magias divinas",
  "cleric with a negative font, oracle of bones, or necromancer wizard":
    "clérigo com fonte negativa, oráculo dos ossos ou mago necromante",
  counterspell: "Contramagia",
  "untamed order": "Ordem Selvagem",
  "bloodline spell": "magia de linhagem",
  "at least 100 years old": "pelo menos 100 anos de idade",
  "ancestral longevity": "Longevidade Ancestral",
  "illusion sense": "Sentido de Ilusão",
  "acute scent": "Faro Aguçado",
  scent: "faro",
  "blessed armament": "armamento abençoado",
  "blessed shield": "escudo abençoado",
  "champion's reaction": "reação de campeão",
  "blessed swiftness": "rapidez abençoada",
  "fiendsbane oath": "Voto Contra Demônios",
  "holy or unholy trait": "traço sagrado ou profano",
  "evil alignment": "alinhamento maligno",
  "good-aligned deity": "divindade de alinhamento bom",
  "you follow a good-aligned deity": "você segue uma divindade de alinhamento bom",
  "bloodline that grants divine spells": "linhagem que concede magias divinas",
  "follower of a specific religion": "seguidor de uma religião específica",
  "follower of a specific religion or philosophy":
    "seguidor de uma religião ou filosofia específica",
  darkvision: "visão no escuro",
  "low-light vision": "visão na penumbra",
  "spellcasting class feature": "característica de classe de conjuração",
  "ability to cast focus spells": "capacidade de conjurar magias de foco",
  "ki spells": "magias de ki",
  "domain spells": "magias de domínio",
  "one or more domain spells": "uma ou mais magias de domínio",
  "curriculum spells": "magias de currículo",
  "assurance in that skill": "Garantia na mesma perícia",
  "medium size": "tamanho Médio",
  "mature animal companion": "companheiro animal maduro",
  "courageous anthem": "hino corajoso",
  "touch of the void": "toque do vazio",
  "shields of the spirit": "escudos do espírito",
  "wholeness of body": "Inteireza do Corpo",
  "sneak attack 2d6": "ataque furtivo 2d6",
  "you aren't unholy": "você não é profano",
  "any feat with the oath trait": "qualquer talento com o traço voto",
  "two or more kinetic elements": "dois ou mais elementos cinéticos",
  "at least one stance feat": "pelo menos um talento de postura",
  "at least two stances": "pelo menos duas posturas",
  "can't have a patron deity": "não pode ter uma divindade patrona",
  "you have died at least once": "você já morreu ao menos uma vez",
  "you must have a signature trick": "você precisa ter um truque de assinatura",
  "ability to create or control undead": "capacidade de criar ou controlar mortos-vivos",
  "ability to permanently create or control undead":
    "capacidade de criar ou controlar mortos-vivos permanentemente",
  "able to create or control undead": "capaz de criar ou controlar mortos-vivos",
  "dispel magic in your spell repertoire": "dissipar magia no seu repertório de magias",
  "one or more stance impulses that affect your kinetic aura":
    "um ou mais ímpetos de postura que afetam sua aura cinética",
  "dimensional assault focus spell": "magia de foco Investida Dimensional",
  "trained with your deity's favored weapon": "treinado com a arma favorita da sua divindade",
  "deity with a simple or unarmed attack favored weapon":
    "divindade cuja arma favorita é simples ou é um ataque desarmado",
  "can cast 3rd rank spells": "consegue conjurar magias de elevação 3",
});

/**
 * Subclass-axis trailing noun phrases: stripped from the end of the text so
 * the remaining option name can be looked up in the document-name index
 * (e.g. "eldritch trickster racket" → strip "racket" → "Eldritch Trickster").
 * Verified against every axis-shaped `system.prerequisites` string in
 * feats-core (issue #32); "heritage" is included for the same reason ("dokkaebi
 * goblin heritage" → "Dokkaebi Goblin"). Longest/most-specific phrases first.
 */
const AXIS_SUFFIXES: readonly string[] = [
  "hybrid study",
  "hunter's edge",
  "hunter s edge",
  "arcane school",
  "arcane thesis",
  "racket",
  "instinct",
  "thesis",
  "school",
  "edge",
  "gate",
  "muse",
  "cause",
  "doctrine",
  "bloodline",
  "heritage",
];

// ---------------------------------------------------------------------------
// Small string helpers
// ---------------------------------------------------------------------------

function normalizeKey(text: string): string {
  return text.trim().toLowerCase().replace(/[’]/g, "'");
}

function stripArticle(text: string): string {
  return text.replace(/^(a|an)\s+/i, "").trim();
}

function isSkillWord(word: string): boolean {
  return Object.prototype.hasOwnProperty.call(SKILL_NAMES_PT, word.trim().toLowerCase());
}

/** "<X> Lore" → X; bare "Lore" → "" (both valid, only the parenthetical differs); no match → null. */
function loreMatch(word: string): string | null {
  const trimmed = word.trim();
  if (/^lore$/i.test(trimmed)) return "";
  const m = /^(.+) lore$/i.exec(trimmed);
  return m?.[1]?.trim() ?? null;
}

function isPerception(word: string): boolean {
  return word.trim().toLowerCase() === "perception";
}

/** "<Stat> saves" → pt-BR stat name, or null. */
function savesMatch(word: string): string | null {
  const m = /^([A-Za-z]+) saves$/i.exec(word.trim());
  if (!m?.[1]) return null;
  return SAVE_NAMES_PT[m[1].toLowerCase()] ?? null;
}

interface SplitList {
  items: string[];
  conj: "or" | "and" | "," | null;
}

/** "A, B, or C" / "A and B" / "A, B" → items + which conjunction joined them. */
function splitList(subject: string): SplitList {
  const orMatch = /^(.+?),?\s+or\s+(.+)$/i.exec(subject);
  const andMatch = /^(.+?),?\s+and\s+(.+)$/i.exec(subject);
  let conj: SplitList["conj"] = null;
  if (orMatch) conj = "or";
  else if (andMatch) conj = "and";

  if (!conj) {
    if (subject.includes(",")) {
      return {
        items: subject
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        conj: ",",
      };
    }
    return { items: [subject.trim()], conj: null };
  }

  const m = conj === "or" ? orMatch : andMatch;
  const head = m?.[1] ?? "";
  const tail = m?.[2] ?? "";
  const items = head
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (tail.trim()) items.push(tail.trim());
  return { items, conj };
}

/** Join already-translated items with the pt-BR form of the original conjunction. */
function joinConj(items: string[], conj: SplitList["conj"]): string {
  if (items.length === 1) return items[0] ?? "";
  const joiner = conj === "and" || conj === "," ? "e" : "ou";
  const last = items[items.length - 1] ?? "";
  if (items.length === 2) return `${items[0] ?? ""} ${joiner} ${last}`;
  return `${items.slice(0, -1).join(", ")} ${joiner} ${last}`;
}

// ---------------------------------------------------------------------------
// Tier 1 — "rank in <subject>"
// ---------------------------------------------------------------------------

function resolveRankSubjectItem(raw: string): string | null {
  const trimmed = raw.trim();
  if (isSkillWord(trimmed)) return SKILL_NAMES_PT[trimmed.toLowerCase()] ?? null;
  const lore = loreMatch(trimmed);
  if (lore !== null) return lore ? `Saber (${lore})` : "Saber";
  if (isPerception(trimmed)) return "Percepção";
  const save = savesMatch(trimmed);
  if (save) return `salvaguardas de ${save}`;
  return RANK_SUBJECT_VOCAB_PT[normalizeKey(trimmed)] ?? null;
}

function tryRankSubject(text: string): string | null {
  const m = /^(trained|expert|master|legendary)\s+(?:in|at)\s+(.+)$/i.exec(text);
  if (!m?.[1] || !m[2]) {
    // Bare "<rank> <Skill>" with no preposition, e.g. "legendary Stealth".
    const bare = /^(trained|expert|master|legendary)\s+([A-Za-z]+)$/i.exec(text);
    if (bare?.[1] && bare[2] && isSkillWord(bare[2])) {
      const rankPt = RANK_NAMES_PT[bare[1].toLowerCase()];
      const skillPt = SKILL_NAMES_PT[bare[2].toLowerCase()];
      return rankPt && skillPt ? `${rankPt} em ${skillPt}` : null;
    }
    return null;
  }

  const rankPt = RANK_NAMES_PT[m[1].toLowerCase()];
  if (!rankPt) return null;

  const subject = m[2].replace(/^either\s+/i, "");
  const { items, conj } = splitList(subject);
  const resolved = items.map(resolveRankSubjectItem);
  if (resolved.some((r) => r === null)) return null;
  return `${rankPt} em ${joinConj(resolved as string[], conj)}`;
}

// ---------------------------------------------------------------------------
// Tier 2 — document name (direct or axis-suffix-stripped)
// ---------------------------------------------------------------------------

function tryDocName(text: string, nameIndex: Readonly<Record<string, string>>): string | null {
  const key = normalizeKey(text);
  const direct = nameIndex[key];
  if (direct) return direct;

  for (const suffix of AXIS_SUFFIXES) {
    if (key === suffix) continue; // bare generic axis word: only useful stripped, and stripping it yields "".
    if (key.endsWith(` ${suffix}`)) {
      const stripped = key.slice(0, -(suffix.length + 1)).trim();
      if (stripped) {
        const hit = nameIndex[stripped];
        if (hit) return hit;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier 4 — generic structural templates
// ---------------------------------------------------------------------------

function tryDedicationTemplate(text: string): string | null {
  const m = /^(.+?)\s+Dedication$/i.exec(text.trim());
  return m?.[1] ? `Dedicação ${m[1].trim()}` : null;
}

function tryHeritageTemplate(text: string): string | null {
  const m = /^(.+?)\s+heritage$/i.exec(text.trim());
  return m?.[1] ? `Linhagem ${m[1].trim()}` : null;
}

function tryEthnicityTemplate(text: string): string | null {
  const m = /^(.+?)\s+(ethnicity|affiliation)$/i.exec(text.trim());
  if (!m?.[1] || !m[2]) return null;
  const word = m[2].toLowerCase() === "ethnicity" ? "Etnia" : "Afiliação";
  return `${word} ${m[1].trim()}`;
}

function tryAbilityScoreTemplate(text: string): string | null {
  const m = /^([A-Za-z]+)\s+\+(\d+)$/.exec(text.trim());
  if (!m?.[1] || !m[2]) return null;
  const abilityPt = ABILITY_NAMES_PT[m[1].toLowerCase()];
  return abilityPt ? `${abilityPt} +${m[2]}` : null;
}

function tryBloodlineSpellsTemplate(text: string): string | null {
  const m = /^bloodline that grants (.+) spells$/i.exec(text.trim());
  if (!m?.[1]) return null;
  const { items, conj } = splitList(m[1]);
  const resolved = items.map((it) => TRADITION_NAMES_PT[it.trim().toLowerCase()] ?? null);
  if (resolved.some((r) => r === null)) return null;
  return `linhagem que concede magias ${joinConj(resolved as string[], conj)}`;
}

// ---------------------------------------------------------------------------
// Tiers 2-4 combined — one phrase with no internal list structure
// ---------------------------------------------------------------------------

function resolveAtomicPhrase(
  text: string,
  nameIndex: Readonly<Record<string, string>>,
): string | null {
  const doc = tryDocName(text, nameIndex) ?? tryDocName(stripArticle(text), nameIndex);
  if (doc) return doc;

  const curated =
    CURATED_PREREQUISITE_PT[normalizeKey(text)] ??
    CURATED_PREREQUISITE_PT[normalizeKey(stripArticle(text))];
  if (curated) return curated;

  return (
    tryDedicationTemplate(text) ??
    tryHeritageTemplate(text) ??
    tryEthnicityTemplate(text) ??
    tryAbilityScoreTemplate(text) ??
    tryBloodlineSpellsTemplate(text)
  );
}

// ---------------------------------------------------------------------------
// Tier 5 — list of atomic phrases ("Booming Impale or Prone Impale")
// ---------------------------------------------------------------------------

function tryPhraseList(text: string, nameIndex: Readonly<Record<string, string>>): string | null {
  const { items, conj } = splitList(text);
  if (items.length < 2) return null;
  const resolved = items.map((it) => resolveAtomicPhrase(it, nameIndex));
  if (resolved.some((r) => r === null)) return null;
  return joinConj(resolved as string[], conj);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate one raw EN `system.prerequisites[].value` string to pt-BR.
 * Always attempts a translation (no locale gate) — callers that also
 * support an "en" display locale should skip calling this and use the raw
 * text directly instead (see documentDetails.ts's `prerequisitesField`).
 *
 * `nameIndex` defaults to the generated {@link DOCUMENT_NAMES_PT} map;
 * tests inject a small fixture instead so they don't depend on the live,
 * constantly-changing translation state of the packs.
 *
 * Never throws, never invents: an unresolvable string is returned exactly
 * as given (tier 6 — EN fallback).
 */
export function translatePrerequisite(
  text: string,
  nameIndex: Readonly<Record<string, string>> = DOCUMENT_NAMES_PT,
): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  return (
    tryRankSubject(trimmed) ??
    resolveAtomicPhrase(trimmed, nameIndex) ??
    tryPhraseList(trimmed, nameIndex) ??
    text
  );
}
