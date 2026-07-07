/**
 * gen-client-maps.mjs — generate the client-side static translation maps
 * (traits EN→pt-BR, damage types, tradition names, rarity, area shapes) from
 * the canonical glossary `glossary.pt-BR.json`, correcting the glossary's
 * missing diacritics into orthographically-correct pt-BR (r15-A1).
 *
 * The glossary stores several values WITHOUT accents (a pipeline artefact:
 * "acido", "concentracao", "eletricidade", "forca"…). The compendium details
 * popup shows these as user-facing chips/values, so they must be correctly
 * accented. `ACCENT_FIXES` below is the audited EN-key → accented-pt-BR
 * override; everything else passes through from the glossary verbatim.
 *
 * Output: packages/client/src/lib/compendium/traitNames.ts — a committed
 * static module (no runtime glossary dependency). Re-run after editing the
 * glossary: `node tools/translate-packs/gen-client-maps.mjs`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const glossaryPath = join(here, "glossary.pt-BR.json");
const outPath = join(
  here,
  "..",
  "..",
  "packages",
  "client",
  "src",
  "lib",
  "compendium",
  "traitNames.ts",
);

const glossary = JSON.parse(readFileSync(glossaryPath, "utf-8"));

/**
 * Accent corrections keyed by EN slug. The glossary value is ASCII-folded for
 * the deterministic substitution pipeline; the user-facing chip needs the
 * proper pt-BR orthography. Only entries whose glossary value differs from the
 * correct accented form appear here.
 */
const ACCENT_FIXES = {
  // traits
  aberration: "aberração",
  acid: "ácido",
  agile: "ágil",
  alchemist: "alquimista",
  arcane: "arcano",
  archetype: "arquétipo",
  automaton: "autômato",
  barbarian: "bárbaro",
  champion: "campeão",
  cleric: "clérigo",
  commander: "comandante",
  composition: "composição",
  concentrate: "concentração",
  contingency: "contingência",
  curse: "maldição",
  darkness: "escuridão",
  death: "morte",
  dedication: "dedicação",
  detection: "detecção",
  disease: "doença",
  druid: "druida",
  electricity: "eletricidade",
  emotion: "emoção",
  esoterica: "esotérica",
  exploration: "exploração",
  fear: "medo",
  finalizer: "finalização",
  finisher: "finalização",
  force: "força",
  fungus: "fungo",
  gnome: "gnomo",
  illusion: "ilusão",
  incapacitation: "incapacitação",
  infusion: "infusão",
  magical: "mágico",
  manipulate: "manipulação",
  mindless: "sem-mente",
  misfortune: "azar",
  monk: "monge",
  morph: "metamorfose",
  oread: "oréade",
  polymorph: "transmutação",
  potion: "poção",
  prediction: "previsão",
  psyche: "psique",
  psychic: "psíquico",
  ranger: "patrulheiro",
  revelation: "revelação",
  scrying: "vidência",
  sonic: "sônico",
  sorcerer: "feiticeiro",
  spellshape: "moldar-magia",
  summon: "convocação",
  summoner: "conjurador",
  talisman: "talismã",
  teleportation: "teleporte",
  thaumaturge: "taumaturgo",
  transcendence: "transcendência",
  vitality: "vitalidade",
  visual: "visual",
  void: "vazio",
  // more traits needing accents/cedilla (audited against the generated map)
  backstabber: "traiçoeiro",
  consumable: "consumível",
  cursebound: "atado-à-maldição",
  dwarf: "anão",
  finesse: "precisão",
  flexible: "flexível",
  guardian: "guardião",
  linguistic: "linguístico",
  mythic: "mítico",
  nonlethal: "não-letal",
  oracle: "oráculo",
  skill: "perícia",
  sylph: "sílfide",
  tactic: "tática",
  "two-hand-d12": "duas-mãos-d12",
  "two-hand-d8": "duas-mãos-d8",
  unstable: "instável",
  "versatile-p": "versátil-p",
  "versatile-s": "versátil-c",
  water: "água",
  // damage types
  bludgeoning: "concussão",
  piercing: "perfuração",
  precision: "precisão",
  slashing: "corte",
  spirit: "espírito",
  // area / tradition / rarity handled inline below
};

/** Apply the accent override for a given EN key, else the glossary value. */
function fix(enKey, glossaryValue) {
  return ACCENT_FIXES[enKey] ?? glossaryValue;
}

/** Build an EN→pt-BR record from a glossary category, applying accent fixes. */
function buildMap(category) {
  const out = {};
  for (const [en, pt] of Object.entries(category)) {
    out[en] = fix(en, pt);
  }
  return out;
}

const traits = buildMap(glossary.categories.traits);
const damageTypes = buildMap(glossary.categories.damageTypes);

// Traditions: glossary stores the adjectival feminine ("arcana"); the details
// chip reads better title-cased in the noun/generic form used across the app.
const traditions = {
  arcane: "Arcana",
  divine: "Divina",
  occult: "Oculta",
  primal: "Primal",
};

const rarities = {
  common: "Comum",
  uncommon: "Incomum",
  rare: "Raro",
  unique: "Único",
};

// Area shapes seen in spells-core (system.area.type). Not a glossary category
// (the glossary has "burst"/"cone"/"line" in terms), collected here explicitly.
const areaShapes = {
  burst: "explosão",
  emanation: "emanação",
  cone: "cone",
  line: "linha",
  cylinder: "cilindro",
  cube: "cubo",
  square: "quadrado",
};

function serialize(name, doc, map) {
  const entries = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([en, pt]) => `  ${JSON.stringify(en)}: ${JSON.stringify(pt)},`)
    .join("\n");
  return `/**\n * ${doc}\n */\nexport const ${name}: Readonly<Record<string, string>> = Object.freeze({\n${entries}\n});\n`;
}

const header = `/**
 * traitNames.ts — GENERATED. Do not edit by hand.
 *
 * Static EN→pt-BR display maps for the compendium details popup
 * (DocumentDetailsPanel): trait chips, damage types, tradition/rarity/area
 * labels. Generated from tools/translate-packs/glossary.pt-BR.json with
 * orthographic accent corrections (the glossary stores ASCII-folded values
 * for its deterministic substitution pipeline).
 *
 * Regenerate: node tools/translate-packs/gen-client-maps.mjs
 *
 * Lookups are locale-gated by the caller (EN locale shows the raw slug);
 * an unknown slug falls back to a humanized form of the slug itself.
 */
`;

const body = [
  serialize("TRAIT_NAMES_PT", `Trait slug → pt-BR chip label (${Object.keys(traits).length} traits).`, traits),
  serialize("DAMAGE_TYPE_NAMES_PT", "Damage-type slug → pt-BR.", damageTypes),
  serialize("TRADITION_NAMES_PT", "Magic tradition slug → pt-BR.", traditions),
  serialize("RARITY_NAMES_PT", "Rarity slug → pt-BR.", rarities),
  serialize("AREA_SHAPE_NAMES_PT", "Area-template shape slug → pt-BR.", areaShapes),
].join("\n");

writeFileSync(outPath, header + "\n" + body, "utf-8");
console.log(
  `Wrote ${outPath}\n  traits=${Object.keys(traits).length} damageTypes=${Object.keys(damageTypes).length} traditions=${Object.keys(traditions).length} rarities=${Object.keys(rarities).length} areaShapes=${Object.keys(areaShapes).length}`,
);
