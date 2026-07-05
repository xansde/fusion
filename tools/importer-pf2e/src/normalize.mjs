/**
 * normalize.mjs — Fase 2 do pipeline de importação PF2E/SF2E → Fusion
 *
 * Transforma cada documento bruto (saída do extract.mjs) no Formato Intermediário
 * documentado em analysis/06-formato-intermediario.md. Suporta seleção de
 * sistema (--system pf2e|sf2e) — REQ-SF2-044, mesma política de clean-room
 * para ambos.
 *
 * Regras de transformação:
 *   - Mantém: type, name, _id (original pf2e/sf2e), system.*, rules[]
 *   - Remove: flags de módulos (_stats, flags.*), campos Foundry internos (sort, folder)
 *   - Substitui: img proprietária → "icons/placeholder.svg" + originalImgRef (somente nome do arquivo)
 *   - Preserva: rules[] intacto (transform M3-D converte)
 *
 * Saídas:
 *   - out/<pack>/normalized.json         — array de documentos normalizados (pf2e)
 *   - out/sf2e/<pack>/normalized.json    — idem (sf2e)
 *   - samples/<pack>/ | samples/sf2e/<pack>/ — 3 documentos normalizados por pack (commitáveis)
 *   - analysis/07-relatorio-normalize.md — estatísticas e pendências (pf2e)
 *   - analysis/07-relatorio-normalize-sf2e.md — idem (sf2e)
 *
 * Zero dependências externas — Node 22 ESM puro.
 *
 * Uso:
 *   node src/normalize.mjs [--system pf2e|sf2e] [--packs equipment,spells,conditions,pathfinder-monster-core]
 *   node src/normalize.mjs --skip-extract   # usa out/<pack>/raw.json já existente
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const IMPORTER_ROOT = join(__dirname, "..");
const VENDOR_ROOT = join(IMPORTER_ROOT, "vendor", "pf2e", "packs");
const OUT_DIR = join(IMPORTER_ROOT, "out");
const SAMPLES_DIR = join(IMPORTER_ROOT, "samples");
const ANALYSIS_DIR = join(IMPORTER_ROOT, "analysis");

/** @param {'pf2e'|'sf2e'} system */
function vendorBaseFor(system) {
  return join(VENDOR_ROOT, system);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
/**
 * R10-B (DEC-R10-06) added classes/class-features/feats/ancestries/
 * heritages/backgrounds — vendor source packs for the Magus builder MVP
 * subset (classes-core, class-features-core, feats-core, ancestries-core,
 * heritages-core, backgrounds-core in build-mvp-subset.mjs).
 *
 * W2 (Actions tab, r11-follow-up) added "actions" — vendor source pack for
 * pf2e.actions-core (build-mvp-subset.mjs). See CATEGORY_SUBFOLDERS below
 * for which of its physical subfolders are curated into the MVP pack.
 */
const DEFAULT_TARGET_PACKS_BY_SYSTEM = {
  pf2e: [
    "equipment",
    "spells",
    "conditions",
    "pathfinder-monster-core",
    "classes",
    "class-features",
    "feats",
    "ancestries",
    "heritages",
    "backgrounds",
    "actions",
  ],
  sf2e: ["equipment", "spells", "conditions", "alien-core-bestiary", "rulebook-bestiaries"],
};

/**
 * Packs whose first-level vendor subfolder is a meaningful gameplay category
 * that should survive normalization as `system.fusionCategory` (the vendor's
 * own `folder` field — a Foundry folder _id — is stripped by
 * FOUNDRY_INTERNAL_FIELDS and does not by itself carry a readable category
 * name; the physical subfolder name is 1:1 with the pack's top-level
 * `_folders.json` root folders — see BUILD-LOG r11 W2 entry).
 *
 * Only "actions" needs this today. Injected in loadRawDocs() by tagging each
 * raw doc with a non-Foundry `__fusionCategory` field (read and deleted by
 * normalizeDoc()) before the doc is normalized.
 */
const CATEGORY_SUBFOLDER_PACKS = new Set(["actions"]);

/**
 * SF2e-exclusive trait allowlist (REQ-SF2-044/047; analysis 04 §6 item 2).
 * The importer never REJECTS unknown traits (pf2e already keeps `traits`
 * as free-form passthrough), but this list documents which SF-exclusive
 * traits are expected to survive normalize/transform unmodified, and backs
 * the coverage check in the sf2e import report. Cross-checked against every
 * `traits.value` in vendor/pf2e/packs/sf2e/equipment/weapons/*.json and
 * .../augmentations/**.
 */
const SF2E_EXCLUSIVE_TRAIT_ALLOWLIST = new Set([
  // Tech / sci-fi weapon & item traits
  "tech",
  "analog",
  "automatic",
  "area",
  "tracking",
  "unwieldy",
  "seeking",
  "injection",
  "line",
  "radioactive",
  "powered",
  "reload-holster",
  // Creature/ancestry traits exclusive to or reintroduced by SF2e
  "robot",
  "alien",
  "android",
  "cyborg",
  "technological",
  "construct",
  "void-adapted",
  "starship",
]);

/** Placeholder global conforme especificação. */
const PLACEHOLDER_IMG = "icons/placeholder.svg";

/**
 * Placeholder por tipo de documento (mais específico, usado como metadata).
 * Segue convenção de packages/shared/assets/icons/placeholder/.
 */
const TYPE_PLACEHOLDERS = {
  weapon: "icons/placeholder/weapon.svg",
  armor: "icons/placeholder/armor.svg",
  shield: "icons/placeholder/armor.svg",
  spell: "icons/placeholder/spell.svg",
  consumable: "icons/placeholder/consumable.svg",
  equipment: "icons/placeholder/item.svg",
  backpack: "icons/placeholder/item.svg",
  kit: "icons/placeholder/item.svg",
  treasure: "icons/placeholder/item.svg",
  ammo: "icons/placeholder/item.svg",
  npc: "icons/placeholder/npc.svg",
  character: "icons/placeholder/npc.svg",
  familiar: "icons/placeholder/npc.svg",
  hazard: "icons/placeholder/npc.svg",
  feat: "icons/placeholder/feat.svg",
  action: "icons/placeholder/feat.svg",
  background: "icons/placeholder/feat.svg",
  heritage: "icons/placeholder/feat.svg",
  ancestry: "icons/placeholder/feat.svg",
  class: "icons/placeholder/feat.svg",
  classFeature: "icons/placeholder/feat.svg",
  effect: "icons/placeholder/effect.svg",
  condition: "icons/placeholder/condition.svg",
  deity: "icons/placeholder/item.svg",
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Extrai apenas o nome do arquivo de um path (sem diretório).
 * Exemplo: "systems/pf2e/icons/conditions/blinded.webp" → "blinded.webp"
 */
function imgFilename(imgPath) {
  if (!imgPath || typeof imgPath !== "string") return null;
  return basename(imgPath);
}

/**
 * Verifica se um campo img é proprietário (Paizo/pf2e ou Paizo/sf2e).
 * Arte proprietária: paths que começam com "systems/pf2e/" ou "systems/sf2e/"
 * (o mesmo repositório hospeda ambos os sistemas — analysis 04 §5).
 * Arte de fontes neutras (Foundry core icons): "icons/" sem "systems/".
 * Todos os paths são substituídos por placeholder (conservador).
 */
function isProprietaryImg(img) {
  if (!img || typeof img !== "string") return false;
  return true; // Substituir TODOS — política conservadora conforme specs/26
}

/** True when an img path is under a system's own proprietary art tree. */
function isSystemProprietaryPath(imgPath) {
  return imgPath.startsWith("systems/pf2e/") || imgPath.startsWith("systems/sf2e/");
}

// ---------------------------------------------------------------------------
// Salvaguarda por-documento: sf2e/pf2e cross-leak (REQ-SF2-048)
// ---------------------------------------------------------------------------

/**
 * A separação sf2e/pf2e hoje é feita SOMENTE pela pasta física de origem
 * (vendor/pf2e/packs/<system>/<pack>/...) — não há campo literal
 * `"system": "pf2e"` nos dados reais do vendor (a spec 18 REQ-SF2-048
 * descreve esse campo de forma aproximada). O sinal real e verificável é
 * `doc.system.publication.title`: o compendium real da Paizo às vezes
 * inclui, por engano, uma entrada cujo livro-fonte é puramente do outro
 * sistema (ex.: `sf2e/bestiary-effects/effect-resonance.json`, com
 * `publication.title: "Pathfinder Monster Core 2"`, dentro de um pack que
 * é 36/37 "Starfinder ..." — ver analysis/04-sf2e-disponibilidade.md).
 *
 * Esta checagem é DELIBERADAMENTE restrita a um match de prefixo no título
 * do PRÓPRIO documento raiz (não em rules[] internas, que legitimamente
 * referenciam predicados/traits cruzados entre pf2e e sf2e — SF2e herda
 * boa parte do vocabulário mecânico de PF2e por design, REQ-SF2-004..006).
 * Um match aqui é um forte indício de que o documento é, na origem, um
 * item do outro sistema catalogado na pasta errada.
 */
const PF2E_BOOK_TITLE_PREFIXES = ["Pathfinder "];
const SF2E_BOOK_TITLE_PREFIXES = ["Starfinder "];

/**
 * Detecta se um documento, ao ser processado sob `expectedSystem`, carrega
 * um `publication.title` que só faz sentido no sistema oposto — sinal de
 * vazamento cross-system (REQ-SF2-048).
 *
 * @param {object} doc — documento bruto (ainda não normalizado)
 * @param {'pf2e'|'sf2e'} expectedSystem — sistema sob o qual `doc` está sendo processado
 * @returns {{leaked: boolean, detectedSystem: 'pf2e'|'sf2e'|null, title: string|null}}
 */
function detectCrossSystemLeak(doc, expectedSystem) {
  const title = doc?.system?.publication?.title;
  if (!title || typeof title !== "string") {
    return { leaked: false, detectedSystem: null, title: null };
  }

  const looksLikePf2e = PF2E_BOOK_TITLE_PREFIXES.some((p) => title.startsWith(p));
  const looksLikeSf2e = SF2E_BOOK_TITLE_PREFIXES.some((p) => title.startsWith(p));

  // Título ambíguo (não bate com nenhum prefixo conhecido, ou bate com
  // ambos — não deve acontecer dado os prefixos escolhidos) — não é sinal
  // suficiente para pular a entrada.
  if (looksLikePf2e === looksLikeSf2e) {
    return { leaked: false, detectedSystem: null, title };
  }

  const detectedSystem = looksLikePf2e ? "pf2e" : "sf2e";
  const leaked = detectedSystem !== expectedSystem;
  return { leaked, detectedSystem, title };
}

/**
 * Remove campos Foundry internos que não devem constar no formato intermediário.
 * Campos removidos:
 *   - _stats       — metadados de sincronização de compendium (compendiumSource, etc.)
 *   - flags        — flags de módulos pf2e (linkedWeapon, etc.)
 *   - sort         — ordem de exibição na UI
 *   - folder       — ID de pasta no Foundry
 *   - ownership    — permissões por usuário
 *   - _key         — chave de pacote interna
 */
const FOUNDRY_INTERNAL_FIELDS = new Set(["_stats", "flags", "sort", "folder", "ownership", "_key"]);

/**
 * Campos system.* que são puramente de UI/Foundry e não mecânicos.
 * Removidos no nível system:
 *   - (nenhum por padrão — preservar tudo em system.* para o M3-D decidir)
 *
 * Nota: system.description.value é preservado (texto ORC/OGL).
 */
const SYSTEM_FIELDS_TO_REMOVE = new Set([]);

// ---------------------------------------------------------------------------
// Normalização de documento
// ---------------------------------------------------------------------------

/**
 * Estatísticas acumuladas de normalização.
 * @typedef {{
 *   total: number,
 *   imgReplaced: number,
 *   imgReplacedProprietaryPf2e: number,
 *   imgReplacedFoundryCore: number,
 *   flagsRemoved: number,
 *   statsRemoved: number,
 *   sortRemoved: number,
 *   folderRemoved: number,
 *   docsWithRules: number,
 *   totalRuleEntries: number,
 *   ruleKeys: Record<string, number>,
 *   byType: Record<string, number>,
 *   embeddedItemsProcessed: number,
 *   crossSystemLeaksSkipped: number,
 * }} NormStats
 */

/**
 * Normaliza um único documento pf2e para o Formato Intermediário Fusion.
 * Também atualiza as estatísticas in-place.
 *
 * @param {object} doc — documento bruto do pf2e
 * @param {NormStats} stats — estatísticas acumuladas (mutadas)
 * @param {'pf2e'|'sf2e'} [system='pf2e'] — sistema sob o qual `doc` está sendo
 *   processado (pasta física de origem). Usado para a salvaguarda
 *   cross-system defensiva do REQ-SF2-048 — ver detectCrossSystemLeak().
 * @returns {object|null} documento normalizado, ou `null` se o doc foi
 *   pulado por vazamento cross-system detectado (REQ-SF2-048).
 */
function normalizeDoc(doc, stats, system = "pf2e") {
  // Salvaguarda defensiva por-documento (REQ-SF2-048): a separação sf2e/pf2e
  // é feita pela pasta física de origem (vendorBaseFor), mas o compendium
  // real da Paizo ocasionalmente cataloga uma entrada do sistema errado
  // dentro da pasta do outro (ex.: sf2e/bestiary-effects/effect-resonance.json,
  // com publication.title "Pathfinder Monster Core 2"). Detectar e pular tais
  // entradas em vez de silenciosamente importá-las como se fossem do sistema
  // sendo processado.
  const leakCheck = detectCrossSystemLeak(doc, system);
  if (leakCheck.leaked) {
    stats.crossSystemLeaksSkipped++;
    console.warn(
      `[normalize] AVISO: doc ${doc._id ?? "(sem id)"} ("${doc.name ?? "(sem nome)"}") ` +
        `parece ser do sistema '${leakCheck.detectedSystem}' (publication.title="${leakCheck.title}") ` +
        `mas está sendo processado sob '${system}' — pulando (REQ-SF2-048).`,
    );
    return null;
  }

  // Category tag injected by loadRawDocs() for CATEGORY_SUBFOLDER_PACKS —
  // read here (before it's copied into system.* below) and never left on the
  // raw doc object itself, since `doc` may be a normalizeDoc argument shared
  // across calls in some future caller.
  const fusionCategory = doc.__fusionCategory;

  const type = doc.type ?? "(sem tipo)";
  stats.byType[type] = (stats.byType[type] ?? 0) + 1;
  stats.total++;

  // Placeholder por tipo
  const typePlaceholder = TYPE_PLACEHOLDERS[type] ?? PLACEHOLDER_IMG;

  // Campos removidos — rastrear para stats
  const removedFields = [];

  // --- Construir documento normalizado ---
  const out = {};

  // _id: preservar original pf2e (M3-D gera fusionId via hash)
  out._id = doc._id;
  out.pf2eSourceId = doc._id; // redundante aqui mas explícito para rastreabilidade

  // type e name: sempre preservar
  out.type = type;
  out.name = doc.name ?? "";

  // img: substituir por placeholder + registrar originalImgRef
  const origImg = doc.img;
  if (origImg) {
    out.img = typePlaceholder;
    out.originalImgRef = imgFilename(origImg); // apenas nome do arquivo, sem path
    stats.imgReplaced++;
    if (isSystemProprietaryPath(origImg)) {
      stats.imgReplacedProprietaryPf2e++;
    } else {
      stats.imgReplacedFoundryCore++;
    }
  } else {
    out.img = typePlaceholder;
    out.originalImgRef = null;
  }

  // Campos Foundry internos — remover e registrar
  for (const field of FOUNDRY_INTERNAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(doc, field)) {
      removedFields.push(field);
      if (field === "flags") stats.flagsRemoved++;
      if (field === "_stats") stats.statsRemoved++;
      if (field === "sort") stats.sortRemoved++;
      if (field === "folder") stats.folderRemoved++;
    }
  }

  // system.*: preservar integralmente
  if (doc.system) {
    out.system = deepClone(doc.system);
  }

  // fusionCategory: physical vendor subfolder name, injected only for packs
  // in CATEGORY_SUBFOLDER_PACKS (currently "actions") — see loadRawDocs().
  // Kept separate from the vendor's own `system.category` field (which is a
  // gameplay tag like "offensive"/"defensive"/"interaction", orthogonal to
  // navigation grouping).
  if (fusionCategory) {
    out.system = out.system ?? {};
    out.system.fusionCategory = fusionCategory;
  }

  // rules[]: preservado de system.rules (já incluso acima)
  // Registrar stats de rules
  const rules = doc.system?.rules ?? [];
  if (Array.isArray(rules) && rules.length > 0) {
    stats.docsWithRules++;
    stats.totalRuleEntries += rules.length;
    for (const rule of rules) {
      const key = rule?.key ?? "(sem key)";
      stats.ruleKeys[key] = (stats.ruleKeys[key] ?? 0) + 1;
    }
  }

  // items[]: documentos embutidos (NPC/character actors)
  if (Array.isArray(doc.items) && doc.items.length > 0) {
    out.items = doc.items.map((item) => normalizeEmbeddedItem(item, stats));
    stats.embeddedItemsProcessed += doc.items.length;
  }

  // Metadados de normalização (não fazem parte do schema de jogo)
  out._fusion = {
    normalizedAt: new Date().toISOString(),
    removedFields,
  };

  return out;
}

/**
 * Normaliza um item embutido dentro de um actor (NPC, character, etc.).
 * Aplica as mesmas regras de img e remoção de campos internos.
 */
function normalizeEmbeddedItem(item, stats) {
  const itemType = item.type ?? "(sem tipo)";
  const typePlaceholder = TYPE_PLACEHOLDERS[itemType] ?? PLACEHOLDER_IMG;
  const out = {};

  out._id = item._id;
  out.type = itemType;
  out.name = item.name ?? "";

  // img do item embutido
  const origImg = item.img;
  if (origImg) {
    out.img = typePlaceholder;
    out.originalImgRef = imgFilename(origImg);
    stats.imgReplaced++;
    if (isSystemProprietaryPath(origImg)) {
      stats.imgReplacedProprietaryPf2e++;
    } else {
      stats.imgReplacedFoundryCore++;
    }
  } else {
    out.img = typePlaceholder;
    out.originalImgRef = null;
  }

  // Remover campos internos
  // (_stats, flags, sort já não são copiados — construção seletiva acima)

  // system.*: preservar
  if (item.system) {
    out.system = deepClone(item.system);
  }

  // rules[] do item
  const itemRules = item.system?.rules ?? [];
  if (Array.isArray(itemRules) && itemRules.length > 0) {
    stats.docsWithRules++;
    stats.totalRuleEntries += itemRules.length;
    for (const rule of itemRules) {
      const key = rule?.key ?? "(sem key)";
      stats.ruleKeys[key] = (stats.ruleKeys[key] ?? 0) + 1;
    }
  }

  return out;
}

/**
 * Clone profundo simples (via JSON) — suficiente para documentos sem circular refs.
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Leitura de documentos brutos
// ---------------------------------------------------------------------------

/**
 * Carrega documentos brutos — de out/<pack>/raw.json (se existir e --skip-extract,
 * pf2e) ou out/sf2e/<pack>/raw.json (sf2e), ou diretamente do vendor (walk
 * recursivo) caso contrário.
 */
function loadRawDocs(packName, skipExtract, system, vendorBase) {
  if (skipExtract) {
    const rawPath =
      system === "pf2e"
        ? join(OUT_DIR, packName, "raw.json")
        : join(OUT_DIR, system, packName, "raw.json");
    if (existsSync(rawPath)) {
      return JSON.parse(readFileSync(rawPath, "utf8"));
    }
    console.warn(
      `[normalize] raw.json não encontrado para ${packName}, lendo diretamente do vendor...`,
    );
  }

  // Ler diretamente do vendor
  const packDir = join(vendorBase, packName);
  if (!existsSync(packDir)) {
    throw new Error(`Pack não encontrado: ${packDir}`);
  }

  const tagCategory = CATEGORY_SUBFOLDER_PACKS.has(packName);

  // Walks the pack dir recursively. `category` tracks the pack's first-level
  // subfolder name (e.g. "basic", "skill", "class") as files are visited —
  // undefined at the pack root itself, set once entering a first-level dir.
  function walkJsonFiles(dir, acc = [], category) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        walkJsonFiles(full, acc, category ?? e.name);
      } else if (e.name.endsWith(".json") && e.name !== "_folders.json") {
        acc.push({ path: full, category });
      }
    }
    return acc;
  }

  return walkJsonFiles(packDir).map(({ path: f, category }) => {
    const doc = JSON.parse(readFileSync(f, "utf8"));
    if (tagCategory && category) {
      doc.__fusionCategory = category;
    }
    return doc;
  });
}

// ---------------------------------------------------------------------------
// Escrita de saídas
// ---------------------------------------------------------------------------

function writeNormalized(packName, docs, system) {
  const dir = system === "pf2e" ? join(OUT_DIR, packName) : join(OUT_DIR, system, packName);
  ensureDir(dir);
  const outPath = join(dir, "normalized.json");
  writeFileSync(outPath, JSON.stringify(docs, null, 2), "utf8");
  const label = system === "pf2e" ? packName : `${system}/${packName}`;
  console.log(`[normalize] out/${label}/normalized.json — ${docs.length} docs`);
  return outPath;
}

function writeSamples(packName, docs, system) {
  const dir = system === "pf2e" ? join(SAMPLES_DIR, packName) : join(SAMPLES_DIR, system, packName);
  ensureDir(dir);
  // Pegar 3 documentos distribuídos (início, meio, fim)
  const indices = [0, Math.floor(docs.length / 2), docs.length - 1].filter((i) => i < docs.length);
  const samples = [...new Set(indices)].map((i) => docs[i]);
  for (let i = 0; i < samples.length; i++) {
    const samplePath = join(dir, `sample-${i + 1}.json`);
    writeFileSync(samplePath, JSON.stringify(samples[i], null, 2), "utf8");
  }
  const label = system === "pf2e" ? packName : `${system}/${packName}`;
  console.log(`[normalize] samples/${label}/ — ${samples.length} amostras`);
  return samples;
}

/**
 * Computa cobertura da allowlist de traits SF2e-exclusivos sobre um conjunto
 * de documentos normalizados. Não rejeita traits desconhecidos — apenas
 * relata quais traits da allowlist foram de fato observados nos dados
 * (analysis 04 §6 item 2, REQ-SF2-047).
 */
function scanSf2eTraits(docs) {
  const seen = new Set();
  const visit = (traitsBlock) => {
    const values = traitsBlock?.value;
    if (Array.isArray(values)) {
      for (const t of values) {
        if (SF2E_EXCLUSIVE_TRAIT_ALLOWLIST.has(t)) seen.add(t);
      }
    }
  };
  for (const doc of docs) {
    visit(doc.system?.traits);
    for (const item of doc.items ?? []) {
      visit(item.system?.traits);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Relatório analysis/07
// ---------------------------------------------------------------------------

function writeNormalizeReport(packResults, system, traitCoverage) {
  const lines = [];
  const systemLabel = system.toUpperCase();
  lines.push(`# 07 — Relatório de Normalização ${systemLabel} → Formato Intermediário Fusion`);
  lines.push("");
  lines.push(`> Gerado em: ${new Date().toISOString().split("T")[0]}`);
  lines.push(`> Script: \`src/normalize.mjs --system ${system}\``);
  lines.push(`> Estágio: EXTRACT/NORMALIZE (M2-P${system === "sf2e" ? " / M4" : ""})`);
  lines.push("");
  if (system === "sf2e" && traitCoverage) {
    lines.push("## 0. Allowlist de traits SF2e-exclusivos (REQ-SF2-044/047)");
    lines.push("");
    lines.push("O importer não rejeita nenhum trait desconhecido (traits são passthrough");
    lines.push("livre desde o pf2e); esta tabela apenas documenta cobertura observada da");
    lines.push("allowlist de traits SF-exclusivos contra os packs processados nesta run.");
    lines.push("");
    lines.push("| Trait | Observado nos packs processados |");
    lines.push("|---|---|");
    for (const t of [...SF2E_EXCLUSIVE_TRAIT_ALLOWLIST].sort()) {
      lines.push(`| \`${t}\` | ${traitCoverage.has(t) ? "✅ sim" : "— não"} |`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## 1. Sumário por pack");
  lines.push("");
  lines.push(
    "| Pack | Docs | img substituídas | img Paizo | img FoundryCore | Docs c/ rules | Entradas rules | Itens embutidos |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");

  let grandTotal = 0,
    grandImgReplaced = 0,
    grandImgPaizo = 0,
    grandImgFoundry = 0;
  let grandDocsWithRules = 0,
    grandRuleEntries = 0,
    grandEmbedded = 0;

  for (const { packName, stats } of packResults) {
    grandTotal += stats.total;
    grandImgReplaced += stats.imgReplaced;
    grandImgPaizo += stats.imgReplacedProprietaryPf2e;
    grandImgFoundry += stats.imgReplacedFoundryCore;
    grandDocsWithRules += stats.docsWithRules;
    grandRuleEntries += stats.totalRuleEntries;
    grandEmbedded += stats.embeddedItemsProcessed;

    lines.push(
      `| **${packName}** | ${stats.total} | ${stats.imgReplaced} | ${stats.imgReplacedProprietaryPf2e} | ${stats.imgReplacedFoundryCore} | ${stats.docsWithRules} | ${stats.totalRuleEntries} | ${stats.embeddedItemsProcessed} |`,
    );
  }

  lines.push(
    `| **TOTAL** | **${grandTotal}** | **${grandImgReplaced}** | **${grandImgPaizo}** | **${grandImgFoundry}** | **${grandDocsWithRules}** | **${grandRuleEntries}** | **${grandEmbedded}** |`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Campos removidos por categoria");
  lines.push("");
  lines.push("| Categoria | Campo | Política | Motivo |");
  lines.push("|---|---|---|---|");
  lines.push(
    "| Metadados Foundry | `_stats` | Removido | Dados de sincronização de compendium (compendiumSource) — sem valor no Fusion |",
  );
  lines.push(
    "| Metadados Foundry | `flags` | Removido | Flags de módulos pf2e (ex: `linkedWeapon`) — específicas do Foundry VTT |",
  );
  lines.push(
    "| UI Foundry | `sort` | Removido | Ordem de exibição na UI do Foundry — irrelevante no Fusion |",
  );
  lines.push(
    "| UI Foundry | `folder` | Removido | ID de pasta no Foundry — estrutura não transportável |",
  );
  lines.push(
    "| Arte Paizo | `img` (paths `systems/pf2e/`) | Substituído | Arte proprietária Paizo — proibida por specs/26 |",
  );
  lines.push(
    "| Arte Foundry Core | `img` (paths `icons/`) | Substituído | Política conservadora — substituir todos os imgs por placeholder |",
  );
  lines.push("");
  lines.push("**Campos preservados:**");
  lines.push("");
  lines.push("| Campo | Motivo |");
  lines.push("|---|---|");
  lines.push("| `_id` | _id original pf2e — rastreabilidade e derivação de fusionId no M3-D |");
  lines.push("| `pf2eSourceId` | Cópia explícita do _id original para rastreabilidade |");
  lines.push("| `type` | Tipo de documento — classificação fundamental |");
  lines.push("| `name` | Nome canônico ORC/OGL |");
  lines.push("| `system.*` | Todos os campos mecânicos — integralmente preservados |");
  lines.push("| `system.rules[]` | Rule Elements — preservados intactos para conversão no M3-D |");
  lines.push(
    "| `items[]` | Itens embutidos em actors (NPC, character) — normalizados recursivamente |",
  );
  lines.push(
    "| `originalImgRef` | Nome do arquivo img original (ex: `blinded.webp`) — apenas para auditoria |",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 3. Tamanhos estimados de output");
  lines.push("");
  lines.push("| Pack | Docs | Tamanho estimado normalized.json |");
  lines.push("|---|---|---|");

  for (const { packName, normalizedDocs } of packResults) {
    const sizeBytes = JSON.stringify(normalizedDocs).length;
    const sizeMb = (sizeBytes / 1024 / 1024).toFixed(2);
    lines.push(`| ${packName} | ${normalizedDocs.length} | ~${sizeMb} MB |`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 4. Rule Elements — top 10 por frequência (packs alvo)");
  lines.push("");
  lines.push("| Rule Key | Ocorrências |");
  lines.push("|---|---|");

  // Agregar ruleKeys de todos os packs
  const allRuleKeys = {};
  for (const { stats } of packResults) {
    for (const [key, count] of Object.entries(stats.ruleKeys)) {
      allRuleKeys[key] = (allRuleKeys[key] ?? 0) + count;
    }
  }
  const sortedRuleKeys = Object.entries(allRuleKeys)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);
  for (const [key, count] of sortedRuleKeys) {
    lines.push(`| \`${key}\` | ${count} |`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 5. Tipos de documento por pack");
  lines.push("");

  for (const { packName, stats } of packResults) {
    lines.push(`### ${packName}`);
    lines.push("");
    lines.push("| Tipo | Docs |");
    lines.push("|---|---|");
    const sorted = Object.entries(stats.byType).sort(([, a], [, b]) => b - a);
    for (const [t, cnt] of sorted) {
      lines.push(`| ${t} | ${cnt} |`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 6. Pendências para o estágio TRANSFORM (M3-D)");
  lines.push("");
  lines.push("As pendências abaixo NÃO são resolvidas neste estágio:");
  lines.push("");
  lines.push("| # | Pendência | Responsável |");
  lines.push("|---|---|---|");
  lines.push(
    '| 1 | **Derivação de UUID Fusion**: `fusionId = base62_16(sha1(packName + ":" + pf2eSourceId))` | M3-D transform |',
  );
  lines.push(
    "| 2 | **Mapa de UUIDs**: construção e persistência de `out/fusion-uuid-map.json` | M3-D transform |",
  );
  lines.push(
    "| 3 | **Reescrita de UUIDs em rules[]**: `Compendium.pf2e.*` → UUIDs Fusion | M3-D patchUuids |",
  );
  lines.push(
    "| 4 | **Marcação de Rule Elements não suportados**: `_unsupported: true` nos REs sem suporte Fusion | M3-D rules/ |",
  );
  lines.push(
    "| 5 | **Validação Zod**: schema completo de documento Fusion normalizado | M3-D schema/ |",
  );
  lines.push(
    "| 6 | **Serialização NDJSON**: conversão de normalized.json → documents.ndjson por pack | M3-E pack |",
  );
  lines.push(
    "| 7 | **pack.json**: geração de metadados de pack (docCount, licenses, sourceCommit) | M3-E pack |",
  );
  lines.push(
    "| 8 | **Strip de lore**: flag `--strip-lore` para remover texto narrativo proprietário | M3-D transform |",
  );
  lines.push(
    "| 9 | **system.description.value**: avaliar texto ORC vs. lore não reutilizável por documento | M3-D + revisão legal |",
  );
  lines.push(
    "| 10 | **Itens embutidos (items[])**: fusionId dos itens embutidos em NPC actors | M3-D transform |",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 7. Notas sobre originalImgRef");
  lines.push("");
  lines.push("O campo `originalImgRef` contém **apenas o nome do arquivo** (sem path completo),");
  lines.push("por exemplo: `blinded.webp`, `longsword.webp`, `fireball.webp`.");
  lines.push("");
  lines.push("Não contém o path original (`systems/pf2e/icons/...`) para evitar");
  lines.push("qualquer referência acidental a arte proprietária no output. Serve");
  lines.push('exclusivamente para auditoria manual ("qual era a arte original?")');
  lines.push("e para correlação futura com arte licenciada compatível.");

  const reportName =
    system === "pf2e" ? "07-relatorio-normalize.md" : "07-relatorio-normalize-sf2e.md";
  const reportPath = join(ANALYSIS_DIR, reportName);
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`[normalize] analysis/${reportName} escrito`);
  return reportPath;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const skipExtract = args.includes("--skip-extract");
  const packsEq = args.find((a) => a.startsWith("--packs="));
  const packsIdx = args.indexOf("--packs");
  const packsFlag = packsEq ? packsEq.split("=")[1] : packsIdx !== -1 ? args[packsIdx + 1] : null;

  const systemEq = args.find((a) => a.startsWith("--system="));
  const systemIdx = args.indexOf("--system");
  const systemFlag = systemEq
    ? systemEq.split("=")[1]
    : systemIdx !== -1
      ? args[systemIdx + 1]
      : null;
  const system = systemFlag === "sf2e" ? "sf2e" : "pf2e";
  const vendorBase = vendorBaseFor(system);

  let targetPacks = packsFlag
    ? packsFlag.split(",").map((p) => p.trim())
    : DEFAULT_TARGET_PACKS_BY_SYSTEM[system];

  // Remover flags que possam ter vazado como packs (ex: --skip-extract)
  targetPacks = targetPacks.filter((p) => !p.startsWith("--"));

  console.log(`[normalize] Sistema: ${system}`);
  console.log(`[normalize] Packs alvo: ${targetPacks.join(", ")}`);
  if (skipExtract) {
    console.log(
      `[normalize] Modo: --skip-extract (lendo de out/${system === "pf2e" ? "" : system + "/"}<pack>/raw.json)`,
    );
  }

  ensureDir(OUT_DIR);
  ensureDir(SAMPLES_DIR);
  ensureDir(ANALYSIS_DIR);

  const packResults = [];

  for (const packName of targetPacks) {
    console.log(`\n[normalize] === Pack: ${packName} ===`);

    // 1. Carregar documentos brutos
    let rawDocs;
    try {
      rawDocs = loadRawDocs(packName, skipExtract, system, vendorBase);
      console.log(`[normalize] ${packName}: ${rawDocs.length} docs brutos carregados`);
    } catch (err) {
      console.error(`[normalize] ERRO ao carregar ${packName}: ${err.message}`);
      continue;
    }

    // 2. Normalizar
    const stats = {
      total: 0,
      imgReplaced: 0,
      imgReplacedProprietaryPf2e: 0,
      imgReplacedFoundryCore: 0,
      flagsRemoved: 0,
      statsRemoved: 0,
      sortRemoved: 0,
      folderRemoved: 0,
      docsWithRules: 0,
      totalRuleEntries: 0,
      ruleKeys: {},
      byType: {},
      embeddedItemsProcessed: 0,
      crossSystemLeaksSkipped: 0,
    };

    const normalizedDocs = [];
    for (const doc of rawDocs) {
      try {
        const normalized = normalizeDoc(doc, stats, system);
        if (normalized !== null) {
          normalizedDocs.push(normalized);
        }
      } catch (err) {
        console.error(
          `[normalize] Erro ao normalizar doc ${doc._id} (${packName}): ${err.message}`,
        );
      }
    }

    console.log(`[normalize] ${packName}: ${normalizedDocs.length} docs normalizados`);
    console.log(
      `[normalize] ${packName}: ${stats.imgReplaced} imgs substituídas (${stats.imgReplacedProprietaryPf2e} Paizo + ${stats.imgReplacedFoundryCore} FoundryCore)`,
    );
    console.log(
      `[normalize] ${packName}: ${stats.docsWithRules} docs c/ rules, ${stats.totalRuleEntries} entradas`,
    );
    if (stats.crossSystemLeaksSkipped > 0) {
      console.log(
        `[normalize] ${packName}: ${stats.crossSystemLeaksSkipped} docs pulados por vazamento cross-system (REQ-SF2-048)`,
      );
    }

    // 3. Escrever outputs
    writeNormalized(packName, normalizedDocs, system);
    writeSamples(packName, normalizedDocs, system);

    packResults.push({ packName, stats, normalizedDocs });
  }

  // 4. Gerar relatório (+ cobertura da allowlist de traits SF-exclusivos)
  const traitCoverage =
    system === "sf2e" ? scanSf2eTraits(packResults.flatMap((r) => r.normalizedDocs)) : null;
  writeNormalizeReport(packResults, system, traitCoverage);

  // 5. Sumário final
  const grandTotal = packResults.reduce((s, r) => s + r.stats.total, 0);
  const grandImg = packResults.reduce((s, r) => s + r.stats.imgReplaced, 0);
  console.log("\n[normalize] === SUMÁRIO FINAL ===");
  console.log(`Packs processados: ${packResults.length}`);
  console.log(`Total documentos normalizados: ${grandTotal}`);
  console.log(`Total imgs substituídas: ${grandImg}`);
  console.log(
    `Relatório: analysis/${system === "pf2e" ? "07-relatorio-normalize.md" : "07-relatorio-normalize-sf2e.md"}`,
  );
  console.log(
    `Amostras: samples/${system === "pf2e" ? "" : system + "/"}<pack>/sample-{1,2,3}.json`,
  );
}

main().catch((err) => {
  console.error("[normalize] FATAL:", err);
  process.exit(1);
});
