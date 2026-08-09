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
  // Programmatic corrections to `system.prerequisites[].value` TEXT for a
  // named feat/class-feature of THIS class (issues #26/#28/#30/#46) — unlike
  // "prerequisites" above (pure documentation, never read by transform/
  // build-mvp-subset), every entry here is APPLIED to the transformed docs
  // by applyPrerequisiteFixes() before the pack is written, so the fix is
  // reproducible from a clean vendor clone instead of a hand-patched
  // documents.json that the next importer run would silently overwrite. See
  // that function's doc comment for the two supported `kind`s.
  "prerequisiteFixes",
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

  const prerequisiteFixes = (cfg.prerequisiteFixes ?? []).map((fix, i) => {
    const where = `prerequisiteFixes[${i}]`;
    if (typeof fix?.featName !== "string" || fix.featName.length === 0) {
      fail(file, `${where}.featName ausente`);
    }
    if (fix.kind === "rename") {
      if (typeof fix.from !== "string" || fix.from.length === 0) {
        fail(file, `${where}.from ausente (kind "rename")`);
      }
      if (typeof fix.to !== "string" || fix.to.length === 0) {
        fail(file, `${where}.to ausente (kind "rename")`);
      }
    } else if (fix.kind === "merge") {
      if (!Array.isArray(fix.replaceEntries) || fix.replaceEntries.length < 2) {
        fail(file, `${where}.replaceEntries precisa ter 2+ textos (kind "merge")`);
      }
      if (typeof fix.with !== "string" || fix.with.length === 0) {
        fail(file, `${where}.with ausente (kind "merge")`);
      }
    } else {
      fail(file, `${where}.kind precisa ser "rename" ou "merge" (recebido: ${JSON.stringify(fix?.kind)})`);
    }
    return fix;
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
    prerequisiteFixes,
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
 * otherTag → level do eixo (o nível de personagem em que a feature que CONCEDE
 * a escolha é obtida).
 *
 * r25: existe porque o vendor zera `system.level.value` nas features que são
 * OPÇÃO de um eixo (`Blessed Armament`/`Blessed Shield` do Champion vêm com 0),
 * e 0 reprova o schema (`level >= 1`). O nível certo é o da feature concessora,
 * que a curadoria já declara em `choiceAxes[].level` — este mapa é só o que
 * ligava esse dado, até agora morto, ao transform.
 */
export function axisLevelByOtherTag() {
  const out = new Map();
  for (const cfg of loadClassCuration().values()) {
    for (const axis of cfg.choiceAxes) out.set(axis.otherTag, axis.level);
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

// ---------------------------------------------------------------------------
// prerequisiteFixes (issues #26/#28/#30/#46) — reconciling `system.
// prerequisites[].value` free text that names something no pack document
// carries (a pre-remaster name, a vendor typo, or two separate entries that
// are really "A or B") into text that DOES resolve, WITHOUT hand-editing the
// generated documents.json (the next `build-mvp-subset.mjs` run would
// silently overwrite a hand patch). Declared per-class in curation/classes/
// *.json (`prerequisiteFixes`), applied here against whichever pack's
// transformed docs actually contain the named feat.
// ---------------------------------------------------------------------------

/** Every `prerequisiteFixes` entry across every curated class, in file order. */
export function allPrerequisiteFixes() {
  const out = [];
  for (const cfg of loadClassCuration().values()) {
    for (const fix of cfg.prerequisiteFixes) out.push(fix);
  }
  return out;
}

/**
 * Applies every declared prerequisite fix whose `featName` matches a doc in
 * `docs`, MUTATING that doc's `system.prerequisites` in place. A fix whose
 * feat IS found but whose expected `from`/`replaceEntries` text is no longer
 * there THROWS immediately — the alternative (silently skipping) would let a
 * future vendor-data change quietly resurrect the exact bug the fix closed.
 * A fix whose feat isn't in THIS `docs` array is left for another call to
 * find (a feat lives in exactly one pack; the caller doesn't know which
 * ahead of time) — returns the Set of featNames actually touched here so the
 * caller can accumulate coverage across every pack it calls this on.
 *
 * kind "rename": replaces ONE entry's text (`from` → `to`), leaving any
 * other entries on the same feat untouched (e.g. Aura of Vengeance keeps its
 * "Vengeful Oath" entry when only "Exalt" is renamed).
 *
 * kind "merge": vendor modeled an "A or B" alternative as TWO SEPARATE
 * `prerequisites` entries (issue #30 — Master of Many Styles), which every
 * consumer (grafo-de-feats.mjs, planVM.ts) reads as AND, not OR. Collapses
 * the whole array into a single entry whose text joins the alternatives with
 * " or " (the same convention the vendor itself uses elsewhere, e.g. "Deflect
 * Projectile or Monastic Archer Stance"). `replaceEntries` must match the
 * feat's CURRENT full prerequisites array exactly (any order) — a partial or
 * stale match throws, same rationale as "rename" above.
 */
export function applyPrerequisiteFixes(docs) {
  const byName = new Map(docs.map((d) => [d.name, d]));
  const touched = new Set();
  for (const fix of allPrerequisiteFixes()) {
    const doc = byName.get(fix.featName);
    if (!doc) continue;
    touched.add(fix.featName);
    const prereqs = doc.system?.prerequisites;
    if (!Array.isArray(prereqs)) {
      throw new Error(`[prerequisiteFixes] "${fix.featName}": system.prerequisites não é array`);
    }
    const textOf = (p) => (typeof p === "string" ? p : p?.value);
    if (fix.kind === "rename") {
      const entry = prereqs.find((p) => textOf(p) === fix.from);
      if (!entry || typeof entry !== "object") {
        throw new Error(
          `[prerequisiteFixes] "${fix.featName}": entrada "${fix.from}" não encontrada em ${JSON.stringify(prereqs)} — dado do vendor mudou?`,
        );
      }
      entry.value = fix.to;
    } else if (fix.kind === "merge") {
      const texts = prereqs.map(textOf);
      const sameSet =
        texts.length === fix.replaceEntries.length &&
        fix.replaceEntries.every((t) => texts.includes(t)) &&
        texts.every((t) => fix.replaceEntries.includes(t));
      if (!sameSet) {
        throw new Error(
          `[prerequisiteFixes] "${fix.featName}": prerequisites atuais ${JSON.stringify(texts)} não batem com replaceEntries ${JSON.stringify(fix.replaceEntries)} — dado do vendor mudou?`,
        );
      }
      doc.system.prerequisites = [{ value: fix.with }];
    }
  }
  return touched;
}

/**
 * Fails the build loudly when a declared `prerequisiteFixes` entry never
 * found its target feat in ANY of the packs `applyPrerequisiteFixes` was run
 * against — a stale fix (typo'd featName, or the feat got renamed/removed
 * upstream) must be caught here, not become a silent no-op that quietly
 * un-fixes the issue it was written for.
 * @param {Iterable<Set<string>>} touchedSets one `applyPrerequisiteFixes` return value per pack
 */
export function assertAllPrerequisiteFixesApplied(touchedSets) {
  const touched = new Set([...touchedSets].flatMap((s) => [...s]));
  const missing = allPrerequisiteFixes()
    .map((fix) => fix.featName)
    .filter((name) => !touched.has(name));
  if (missing.length > 0) {
    throw new Error(
      `[prerequisiteFixes] nunca aplicados (feat não encontrado em pack nenhum): ${missing.join(", ")}`,
    );
  }
}
