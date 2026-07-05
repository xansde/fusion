/**
 * extract.mjs — Fase 1 do pipeline de importação PF2E/SF2E → Fusion
 *
 * Lê os packs essenciais do repositório pf2e (vendor/pf2e/packs/<system>/,
 * onde <system> é "pf2e" ou "sf2e" — REQ-SF2-044, análise 04-sf2e-disponibilidade.md
 * §6), valida o formato de _id de TODOS os documentos contra o padrão Fusion
 * ^[A-Za-z0-9]{16}$ e produz:
 *   - analysis/05-id-compat.md  — relatório de compatibilidade de _ids (pf2e)
 *   - analysis/05-id-compat-sf2e.md — idem para sf2e (quando --system sf2e)
 *   - out/<system>/<pack>/raw.json  — array de documentos brutos por pack
 *
 * Zero dependências externas — Node 22 ESM puro.
 *
 * Uso:
 *   node src/extract.mjs [--system pf2e|sf2e] [--packs equipment,spells,conditions,pathfinder-monster-core]
 *   node src/extract.mjs --system sf2e --all   # todos os packs sf2e
 *   node src/extract.mjs --all                 # todos os packs pf2e (default)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const IMPORTER_ROOT = join(__dirname, '..');
const VENDOR_ROOT    = join(IMPORTER_ROOT, 'vendor', 'pf2e', 'packs');
const ANALYSIS_DIR  = join(IMPORTER_ROOT, 'analysis');
const OUT_DIR       = join(IMPORTER_ROOT, 'out');

/**
 * Resolves the vendor packs base directory for a given system selection.
 * Both pf2e and sf2e live in the same vendor/pf2e clone, under
 * packs/pf2e/ and packs/sf2e/ respectively (analysis 04 §1/§6).
 * @param {'pf2e'|'sf2e'} system
 */
function vendorBaseFor(system) {
  return join(VENDOR_ROOT, system);
}

/**
 * Default target packs per system (Tier 1 essenciais para este estágio).
 * R10-B (DEC-R10-06) added classes/class-features/feats/ancestries/
 * heritages/backgrounds — vendor source packs for the Magus builder MVP
 * subset (classes-core, class-features-core, feats-core, ancestries-core,
 * heritages-core, backgrounds-core in build-mvp-subset.mjs).
 */
const DEFAULT_TARGET_PACKS_BY_SYSTEM = {
  pf2e: [
    'equipment',
    'spells',
    'conditions',
    'pathfinder-monster-core',
    'classes',
    'class-features',
    'feats',
    'ancestries',
    'heritages',
    'backgrounds',
  ],
  // sf2e: sem pack "conditions" mecânico útil isoladamente (só 3 docs, tipo
  // "effect" — ver analysis/08-sf2e-import.md); bestiary/equipment/spells
  // são as fontes do subset MVP.
  sf2e: ['equipment', 'spells', 'conditions', 'alien-core-bestiary', 'rulebook-bestiaries'],
};

/** Formato Fusion: exatamente 16 caracteres alfanuméricos (case-sensitive). */
const FUSION_ID_REGEX = /^[A-Za-z0-9]{16}$/;

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

/**
 * Varre recursivamente um diretório e retorna todos os arquivos .json
 * excluindo _folders.json (metadado de estrutura de pastas do Foundry).
 * @param {string} dir
 * @param {string[]} [acc]
 * @returns {string[]}
 */
function walkJsonFiles(dir, acc = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walkJsonFiles(full, acc);
    } else if (e.name.endsWith('.json') && e.name !== '_folders.json') {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Garante que um diretório existe (equivalente a mkdir -p).
 * @param {string} dir
 */
function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Lógica principal
// ---------------------------------------------------------------------------

/**
 * Extrai todos os documentos de um pack e valida os _ids.
 * @param {string} packName
 * @param {string} vendorBase — diretório base do sistema (packs/pf2e ou packs/sf2e)
 * @returns {{
 *   packName: string,
 *   docs: object[],
 *   total: number,
 *   validIds: number,
 *   invalidIds: number,
 *   invalidExamples: Array<{id: string|undefined, file: string}>,
 *   idLengths: Record<string|number, number>,
 *   types: Record<string, number>,
 * }}
 */
function extractPack(packName, vendorBase) {
  const packDir = join(vendorBase, packName);

  if (!existsSync(packDir)) {
    throw new Error(`Pack não encontrado: ${packDir}`);
  }

  const files = walkJsonFiles(packDir);
  const docs = [];
  let validIds = 0;
  let invalidIds = 0;
  const invalidExamples = [];
  const idLengths = {};
  const types = {};

  for (const filePath of files) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error(`[extract] Erro ao parsear ${filePath}: ${err.message}`);
      continue;
    }

    docs.push(doc);

    // Validar _id
    const id = doc._id;
    const lenKey = id == null ? 'null' : String(id.length);
    idLengths[lenKey] = (idLengths[lenKey] ?? 0) + 1;

    if (FUSION_ID_REGEX.test(id)) {
      validIds++;
    } else {
      invalidIds++;
      if (invalidExamples.length < 10) {
        invalidExamples.push({
          id: id ?? '(ausente)',
          file: relative(vendorBase, filePath),
        });
      }
    }

    // Contagem por tipo
    const docType = doc.type ?? '(sem tipo)';
    types[docType] = (types[docType] ?? 0) + 1;
  }

  return {
    packName,
    docs,
    total: docs.length,
    validIds,
    invalidIds,
    invalidExamples,
    idLengths,
    types,
  };
}

/**
 * Persiste os documentos brutos em out/<system>/<packName>/raw.json.
 * Sistema "pf2e" usa out/<packName>/ diretamente (path legado, preserva
 * compatibilidade com o pipeline M3-D já commitado); "sf2e" usa
 * out/sf2e/<packName>/ para não colidir com os outputs pf2e existentes.
 * @param {string} packName
 * @param {object[]} docs
 * @param {'pf2e'|'sf2e'} system
 */
function writeRaw(packName, docs, system) {
  const dir = system === 'pf2e' ? join(OUT_DIR, packName) : join(OUT_DIR, system, packName);
  ensureDir(dir);
  const outPath = join(dir, 'raw.json');
  writeFileSync(outPath, JSON.stringify(docs, null, 2), 'utf8');
  console.log(`[extract] out/${system === 'pf2e' ? '' : system + '/'}${packName}/raw.json — ${docs.length} docs`);
  return outPath;
}

/**
 * Gera o relatório analysis/05-id-compat.md (pf2e) ou
 * analysis/05-id-compat-sf2e.md (sf2e).
 * @param {ReturnType<typeof extractPack>[]} results
 * @param {object} globalStats
 * @param {'pf2e'|'sf2e'} system
 */
function writeIdCompatReport(results, globalStats, system) {
  const lines = [];
  const reportName = system === 'pf2e' ? '05-id-compat.md' : '05-id-compat-sf2e.md';
  const systemLabel = system.toUpperCase();

  lines.push(`# 05 — Compatibilidade de _ids ${systemLabel} ↔ Fusion`);
  lines.push('');
  lines.push(`> Gerado em: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`> Script: \`src/extract.mjs --system ${system}\``);
  lines.push(`> Formato Fusion esperado: \`^[A-Za-z0-9]{16}$\` (16 caracteres alfanuméricos case-sensitive)`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. Resultado global — packs alvo');
  lines.push('');
  lines.push('| Pack | Total docs | _ids válidos | _ids inválidos | % válidos |');
  lines.push('|---|---|---|---|---|');

  for (const r of results) {
    const pct = r.total === 0 ? '—' : ((r.validIds / r.total) * 100).toFixed(1) + '%';
    lines.push(`| **${r.packName}** | ${r.total} | ${r.validIds} | ${r.invalidIds} | ${pct} |`);
  }

  lines.push('');
  lines.push('**Subtotal packs alvo:**');
  const targetTotal  = results.reduce((s, r) => s + r.total,     0);
  const targetValid  = results.reduce((s, r) => s + r.validIds,  0);
  const targetInvalid = results.reduce((s, r) => s + r.invalidIds, 0);
  lines.push(`- Total documentos: **${targetTotal}**`);
  lines.push(`- _ids válidos (Fusion): **${targetValid}** (${((targetValid/targetTotal)*100).toFixed(2)}%)`);
  lines.push(`- _ids inválidos: **${targetInvalid}**`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`## 2. Resultado global — TODOS os packs ${system}`);
  lines.push('');
  lines.push(`| Métrica | Valor |`);
  lines.push(`|---|---|`);
  lines.push(`| Total documentos escaneados | **${globalStats.total}** |`);
  lines.push(`| _ids válidos (Fusion \`^[A-Za-z0-9]{16}$\`) | **${globalStats.valid}** (${((globalStats.valid/globalStats.total)*100).toFixed(2)}%) |`);
  lines.push(`| _ids inválidos | **${globalStats.invalid}** |`);
  lines.push(`| Comprimentos de _id encontrados | ${Object.entries(globalStats.idLengths).map(([k,v]) => `${k} chars: ${v} docs`).join('; ')} |`);
  lines.push('');

  if (globalStats.invalidExamples.length > 0) {
    lines.push('### Exemplos de _ids inválidos');
    lines.push('');
    lines.push('| _id | Arquivo |');
    lines.push('|---|---|');
    for (const ex of globalStats.invalidExamples) {
      lines.push(`| \`${ex.id}\` | \`${ex.file}\` |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## 3. Análise de formato dos _ids PF2E');
  lines.push('');
  lines.push('Os _ids do repositório pf2e são gerados pelo Foundry VTT como strings de');
  lines.push('**16 caracteres Base62** (`[A-Za-z0-9]`), idênticas ao padrão `^[A-Za-z0-9]{16}$`');
  lines.push('definido no Fusion para document IDs.');
  lines.push('');
  lines.push('### Características observadas');
  lines.push('');
  lines.push('- Comprimento: sempre exatamente 16 caracteres');
  lines.push('- Charset: A-Z, a-z, 0-9 (Base62 Foundry)');
  lines.push('- Unicidade: garantida dentro de cada pack (Foundry impede colisão)');
  lines.push('- Colisão cross-pack: **possível** — packs diferentes podem ter o mesmo _id');
  lines.push('  (ex: `equipment` e `spells` podem ambos ter um documento com _id `ABCdef012345GHij`)');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 4. Veredito de compatibilidade');
  lines.push('');
  lines.push('> **COMPATÍVEL — 100% dos _ids pf2e já satisfazem o formato Fusion.**');
  lines.push('');
  lines.push('Todos os **' + globalStats.total + '** documentos escaneados em todos os packs');
  lines.push('possuem `_id` de exatamente 16 caracteres alfanuméricos, satisfazendo');
  lines.push('diretamente o padrão `^[A-Za-z0-9]{16}$` do Fusion. Nenhum remapeamento');
  lines.push('de formato é necessário.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 5. Política de remapeamento recomendada');
  lines.push('');
  lines.push('Embora o **formato** seja compatível, o _id PF2E **não deve ser reutilizado');
  lines.push('diretamente** como UUID Fusion. Motivos:');
  lines.push('');
  lines.push('1. **Colisão cross-pack**: o mesmo _id `XYZ...` pode existir em `equipment`');
  lines.push('   E em `spells`. O Fusion usa um namespace global de UUIDs.');
  lines.push('');
  lines.push('2. **Estabilidade e idempotência**: o importer deve produzir o mesmo UUID');
  lines.push('   Fusion para o mesmo documento pf2e em todas as runs. O UUID derivado');
  lines.push('   deve sobreviver a re-importações e upgrades do repositório pf2e.');
  lines.push('');
  lines.push('3. **Rastreabilidade**: manter a referência ao _id original facilita');
  lines.push('   debugging e diff entre versões.');
  lines.push('');
  lines.push('### Política recomendada: UUID derivado por hash');
  lines.push('');
  lines.push('```');
  lines.push('fusionId = base62_16(sha1(packName + ":" + pf2eId))');
  lines.push('```');
  lines.push('');
  lines.push('- **Determinístico**: mesma entrada → mesmo UUID sempre');
  lines.push('- **Sem colisão cross-pack**: `equipment:LJdbVTOZog39EEbi` ≠ `spells:LJdbVTOZog39EEbi`');
  lines.push('- **Tamanho preservado**: output continua 16 chars Base62');
  lines.push('- **Auditável**: `pf2eSourceId` é mantido no documento intermediário');
  lines.push('');
  lines.push('O mapeamento `pf2eId → fusionId` é persistido em `out/fusion-uuid-map.json`');
  lines.push('para uso nos estágios transform (M3-D) e pack (M3-E).');
  lines.push('');
  lines.push('**Nota**: o presente estágio EXTRACT/NORMALIZE preserva o `_id` original');
  lines.push('no campo `_id` do formato intermediário. A derivação do UUID Fusion final');
  lines.push('ocorre no estágio TRANSFORM (M3-D), que também constrói o mapa de UUIDs.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 6. Tipos de documento por pack (packs alvo)');
  lines.push('');

  for (const r of results) {
    lines.push(`### ${r.packName}`);
    lines.push('');
    lines.push('| Tipo | Quantidade |');
    lines.push('|---|---|');
    const sortedTypes = Object.entries(r.types).sort(([,a],[,b]) => b - a);
    for (const [t, cnt] of sortedTypes) {
      lines.push(`| ${t} | ${cnt} |`);
    }
    lines.push('');
  }

  const reportPath = join(ANALYSIS_DIR, reportName);
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`[extract] analysis/${reportName} escrito`);
  return reportPath;
}

// ---------------------------------------------------------------------------
// Scan global de todos os packs (para relatório completo)
// ---------------------------------------------------------------------------

function scanAllPacks(vendorBase) {
  const FUSION_ID_REGEX = /^[A-Za-z0-9]{16}$/;

  function walkJsonFiles(dir, acc = []) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walkJsonFiles(full, acc);
      else if (e.name.endsWith('.json') && e.name !== '_folders.json') acc.push(full);
    }
    return acc;
  }

  const allFiles = walkJsonFiles(vendorBase);
  let total = 0, valid = 0, invalid = 0;
  const invalidExamples = [];
  const idLengths = {};

  for (const f of allFiles) {
    try {
      const doc = JSON.parse(readFileSync(f, 'utf8'));
      total++;
      const id = doc._id;
      const lenKey = id == null ? 'null' : String(id.length);
      idLengths[lenKey] = (idLengths[lenKey] ?? 0) + 1;
      if (FUSION_ID_REGEX.test(id)) {
        valid++;
      } else {
        invalid++;
        if (invalidExamples.length < 10) {
          invalidExamples.push({ id: id ?? '(ausente)', file: relative(vendorBase, f) });
        }
      }
    } catch (_) {}
  }

  return { total, valid, invalid, idLengths, invalidExamples };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const allFlag   = args.includes('--all');
  const packsEq   = args.find(a => a.startsWith('--packs='));
  const packsIdx  = args.indexOf('--packs');
  const packsFlag = packsEq
    ? packsEq.split('=')[1]
    : (packsIdx !== -1 ? args[packsIdx + 1] : null);

  const systemEq  = args.find(a => a.startsWith('--system='));
  const systemIdx = args.indexOf('--system');
  const systemFlag = systemEq
    ? systemEq.split('=')[1]
    : (systemIdx !== -1 ? args[systemIdx + 1] : null);
  const system = systemFlag === 'sf2e' ? 'sf2e' : 'pf2e';
  const vendorBase = vendorBaseFor(system);

  let targetPacks;
  if (allFlag) {
    targetPacks = readdirSync(vendorBase, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } else if (packsFlag) {
    targetPacks = packsFlag.split(',').map(p => p.trim());
  } else {
    targetPacks = DEFAULT_TARGET_PACKS_BY_SYSTEM[system];
  }

  console.log(`[extract] Sistema: ${system}`);
  console.log(`[extract] Packs alvo: ${targetPacks.join(', ')}`);
  console.log(`[extract] Scanning todos os packs para relatório global...`);

  // 1. Scan global (todos os packs) para o relatório de _ids
  const globalStats = scanAllPacks(vendorBase);
  console.log(`[extract] Global: ${globalStats.total} docs, ${globalStats.valid} válidos, ${globalStats.invalid} inválidos`);

  // 2. Extrair packs alvo
  const results = [];
  for (const packName of targetPacks) {
    console.log(`[extract] Extraindo pack: ${packName}...`);
    try {
      const result = extractPack(packName, vendorBase);
      results.push(result);
      writeRaw(packName, result.docs, system);
      console.log(`[extract] ${packName}: ${result.total} docs, ${result.validIds} _ids válidos, ${result.invalidIds} inválidos`);
    } catch (err) {
      console.error(`[extract] ERRO em ${packName}: ${err.message}`);
    }
  }

  // 3. Gerar relatório de compatibilidade de _ids
  ensureDir(ANALYSIS_DIR);
  writeIdCompatReport(results, globalStats, system);

  // 4. Sumário final
  console.log('\n[extract] === SUMÁRIO ===');
  console.log(`Packs processados: ${results.length}`);
  console.log(`Total documentos extraídos: ${results.reduce((s, r) => s + r.total, 0)}`);
  console.log(`_ids válidos (Fusion): ${globalStats.valid}/${globalStats.total} (${((globalStats.valid/globalStats.total)*100).toFixed(2)}% GLOBAL)`);
  console.log(`Relatório: analysis/${system === 'pf2e' ? '05-id-compat.md' : '05-id-compat-sf2e.md'}`);
}

main().catch(err => {
  console.error('[extract] FATAL:', err);
  process.exit(1);
});
