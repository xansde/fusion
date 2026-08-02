/**
 * Curadoria de conteúdo por classe (r21).
 *
 * Antes desta camada, "que classe entra no pack" era um predicado ad-hoc
 * escrito à mão em build-mvp-subset.mjs (`doc.name === 'Magus' || doc.name ===
 * 'Kineticist'`) e as tabelas de progressão eram constantes hardcoded em
 * transform.mjs. Cada classe nova custava código novo em dois arquivos
 * compartilhados — o que impede trabalho paralelo e convida à duplicata.
 *
 * Aqui a curadoria vira DADO: um arquivo JSON por classe em `classes/`, lido
 * por este loader. Adicionar uma classe = adicionar um arquivo. O pipeline
 * continua determinístico e a geração dos packs continua acontecendo uma
 * única vez, no fim.
 *
 * Contrato de cada arquivo em `classes/<slug>.json` — ver `.fusion-build/
 * r21-plan.md` §3.3. Campos desconhecidos são REJEITADOS (não ignorados):
 * um typo numa chave de curadoria sai como pack silenciosamente errado.
 *
 * Nada aqui lê o vendor nem os packs: este módulo só carrega, valida e
 * agrega configuração. Quem lê o vendor é quem chama.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CLASSES_DIR = join(__dirname, "classes");

/** Chaves aceitas no topo de um arquivo de curadoria de classe. */
const TOP_LEVEL_KEYS = new Set([
  "class",
  "displayName",
  "vendorClassFile",
  "keyAbilityOptions",
  "hp",
  "choiceAxes",
  "classFeats",
  "classFeatures",
  "spellcasting",
  "focusSpells",
  "prerequisites",
  "dedupe",
  "notes",
  // Campos de integração (preenchidos pela integração central, não pelo
  // levantamento por classe):
  "proficiencyUpgradeExtras",
  "proficiencyMirrors",
  // Informativo: declara que os níveis emitidos para esta classe
  // (featuresByLevel, proficiencyUpgrades) são níveis DE CLASSE, não de
  // personagem — a distinção que a spec 30 vai precisar. Hoje os dois números
  // são iguais; o campo existe para que a leitura futura não dependa de
  // arqueologia (spec 31 §4.3).
  "levelBasis",
]);

const REQUIRED_KEYS = ["class", "displayName", "vendorClassFile", "classFeats", "classFeatures"];

/**
 * Converte "hybrid-study" → "hybridStudy". Usado para derivar a `category`
 * de um eixo de sub-escolha a partir da otherTag do vendor
 * ("magus-hybrid-study" → "hybridStudy"), sem lista escrita à mão.
 */
export function axisCategoryFromOtherTag(otherTag, classSlug) {
  const prefix = `${classSlug}-`;
  const raw = otherTag.startsWith(prefix) ? otherTag.slice(prefix.length) : otherTag;
  return raw.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function fail(file, msg) {
  throw new Error(`[curation] ${file}: ${msg}`);
}

/** Valida um objeto de curadoria e devolve a versão normalizada (com defaults). */
export function validateClassCuration(cfg, file) {
  if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) {
    fail(file, "o arquivo precisa ser um objeto JSON");
  }
  for (const key of Object.keys(cfg)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      fail(file, `chave desconhecida "${key}" (aceitas: ${[...TOP_LEVEL_KEYS].join(", ")})`);
    }
  }
  for (const key of REQUIRED_KEYS) {
    if (cfg[key] === undefined) fail(file, `chave obrigatória ausente: "${key}"`);
  }
  if (typeof cfg.class !== "string" || !/^[a-z][a-z0-9-]*$/.test(cfg.class)) {
    fail(file, `"class" precisa ser um slug kebab-case (recebido: ${JSON.stringify(cfg.class)})`);
  }
  if (typeof cfg.classFeats !== "object" || cfg.classFeats === null) {
    fail(file, '"classFeats" precisa ser objeto');
  }
  if (typeof cfg.classFeats.trait !== "string" || cfg.classFeats.trait.length === 0) {
    fail(file, '"classFeats.trait" é obrigatório');
  }

  const axes = (cfg.choiceAxes ?? []).map((axis, i) => {
    if (typeof axis?.otherTag !== "string") fail(file, `choiceAxes[${i}].otherTag ausente`);
    if (typeof axis?.featureNameInItemsMap !== "string") {
      fail(file, `choiceAxes[${i}].featureNameInItemsMap ausente (nome canônico da uuid)`);
    }
    return {
      ...axis,
      // Derivada da otherTag quando não declarada: "magus-hybrid-study" →
      // "hybridStudy" (exatamente a category que o pack já usa hoje).
      category: axis.category ?? axisCategoryFromOtherTag(axis.otherTag, cfg.class),
      choose: axis.choose ?? 1,
    };
  });

  return {
    class: cfg.class,
    displayName: cfg.displayName,
    vendorClassFile: cfg.vendorClassFile,
    keyAbilityOptions: cfg.keyAbilityOptions ?? [],
    hp: cfg.hp ?? null,
    choiceAxes: axes,
    classFeats: {
      trait: cfg.classFeats.trait,
      includeSharedClassFeats: cfg.classFeats.includeSharedClassFeats ?? true,
      levelMax: cfg.classFeats.levelMax ?? 20,
      // Recorte adicional por trait, para curadoria estreita. Existe porque a
      // r18 trouxe do Kineticist apenas os impulsos de Ar e Metal até o nível
      // 4 (a janela do Finn) — sem isto, migrar aquela curadoria para dado
      // mudaria o pack em vez de reproduzi-lo.
      requireTraitsAll: cfg.classFeats.requireTraitsAll ?? [],
      requireTraitsAny: cfg.classFeats.requireTraitsAny ?? [],
      extraNames: cfg.classFeats.extraNames ?? [],
      excludeNames: cfg.classFeats.excludeNames ?? [],
    },
    classFeatures: {
      fromItemsMap: cfg.classFeatures.fromItemsMap ?? true,
      extraNames: cfg.classFeatures.extraNames ?? [],
      sharedWithOtherClasses: cfg.classFeatures.sharedWithOtherClasses ?? [],
      alreadyInPacks: cfg.classFeatures.alreadyInPacks ?? [],
      missingFromPacks: cfg.classFeatures.missingFromPacks ?? [],
    },
    spellcasting: cfg.spellcasting ?? null,
    focusSpells: cfg.focusSpells ?? { names: [], alreadyInPacks: [] },
    prerequisites: cfg.prerequisites ?? { internalChains: [], referencesOutsideSelection: [] },
    dedupe: cfg.dedupe ?? { featsAlreadyInPacks: [], collisionsDetected: [] },
    notes: cfg.notes ?? [],
    proficiencyUpgradeExtras: cfg.proficiencyUpgradeExtras ?? [],
    proficiencyMirrors: cfg.proficiencyMirrors ?? {},
  };
}

let cache = null;

/**
 * Carrega toda a curadoria de classes de `classes/*.json`, validada.
 * @returns {Map<string, ReturnType<typeof validateClassCuration>>} slug → config
 */
export function loadClassCuration({ force = false } = {}) {
  if (cache && !force) return cache;
  const out = new Map();
  if (!existsSync(CLASSES_DIR)) {
    cache = out;
    return out;
  }
  const files = readdirSync(CLASSES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort(); // ordem estável = saída determinística
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(CLASSES_DIR, f), "utf8"));
    const cfg = validateClassCuration(raw, f);
    if (out.has(cfg.class)) fail(f, `slug duplicado "${cfg.class}"`);
    if (`${cfg.class}.json` !== f) fail(f, `o nome do arquivo tem de ser "${cfg.class}.json"`);
    out.set(cfg.class, cfg);
  }
  cache = out;
  return out;
}

/** Nomes de exibição das classes curadas (para o predicado de classes-core). */
export function curatedClassDisplayNames() {
  return new Set([...loadClassCuration().values()].map((c) => c.displayName));
}

/** Traits de class feat curados: trait → config da classe. */
export function curatedFeatTraits() {
  const out = new Map();
  for (const cfg of loadClassCuration().values()) out.set(cfg.classFeats.trait, cfg);
  return out;
}

/** otherTag → category, para todos os eixos declarados. */
export function axisCategoryByOtherTag() {
  const out = new Map();
  for (const cfg of loadClassCuration().values()) {
    for (const axis of cfg.choiceAxes) out.set(axis.otherTag, axis.category);
  }
  return out;
}

/**
 * Nome canônico de uma class-feature a partir da uuid do `items{}` de uma
 * classe do vendor — o SEGMENTO FINAL da uuid, nunca o campo `name` da
 * entrada (no magus.json, `name` diz "Lightning Reflexes" e a uuid aponta
 * para "Reflex Expertise"; casar por `name` cria documento fantasma).
 */
export function classFeatureNameFromUuid(uuid) {
  const marker = "Compendium.pf2e.classfeatures.Item.";
  return typeof uuid === "string" && uuid.startsWith(marker) ? uuid.slice(marker.length) : null;
}

/**
 * União dos nomes canônicos de class-feature de TODAS as classes curadas,
 * mais os `extraNames` declarados. É um Set: feature compartilhada entre N
 * classes (Shield Block, Weapon Specialization) entra UMA vez — é o
 * mecanismo anti-redundância da rodada.
 *
 * @param {string} vendorClassesDir diretório `vendor/pf2e/packs/pf2e/classes`
 */
export function curatedClassFeatureNames(vendorClassesDir) {
  const names = new Set();
  for (const cfg of loadClassCuration().values()) {
    if (cfg.classFeatures.fromItemsMap) {
      const file = join(vendorClassesDir, `${cfg.class}.json`);
      const json = JSON.parse(readFileSync(file, "utf8"));
      for (const entry of Object.values(json.system?.items ?? {})) {
        names.add(classFeatureNameFromUuid(entry.uuid) ?? entry.name);
      }
    }
    for (const n of cfg.classFeatures.extraNames) names.add(n);
  }
  return names;
}

/**
 * Mapa nível→features do `items{}` de uma classe do vendor, já com o nome
 * canônico resolvido.
 * @returns {Array<{name: string, label: string, level: number}>}
 */
export function classItemsMap(vendorClassesDir, slug) {
  const file = join(vendorClassesDir, `${slug}.json`);
  const json = JSON.parse(readFileSync(file, "utf8"));
  return Object.values(json.system?.items ?? {})
    .map((entry) => ({
      name: classFeatureNameFromUuid(entry.uuid) ?? entry.name,
      label: entry.name,
      level: entry.level,
    }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}
