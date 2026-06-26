/**
 * build-mvp-subset.mjs — Gera o SUBCONJUNTO MVP commitável de packs Fusion.
 *
 * Consome os documentos transformados (out/<pack>/transformed.json) e
 * seleciona um subconjunto curado para o MVP da primeira sessão jogável.
 *
 * Subconjunto:
 *   - pf2e.weapons-core:    ~30 armas básicas (ORC, dados mecânicos)
 *   - pf2e.conditions:      todas as 43 condições
 *   - pf2e.bestiary-core:   10 monstros de nível -1 a 3 (ORC)
 *   - pf2e.spells-core:     15 magias comuns level 1-3 (ORC)
 *
 * Saída: systems/pf2e/packs/<packSlug>/
 *   - documents.json  — array de documentos Fusion (commitável)
 *   - pack.json       — manifesto com licença ORC e metadados
 *
 * REQ-CMP-001..004, REQ-CMP-030..033, REQ-CMP-040..044.
 * Spec 16 §Formato de pack e armazenamento, §Pipeline §Versionamento.
 *
 * Zero dependências externas — Node 22 ESM puro.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMPORTER_ROOT = join(__dirname, '..');
const OUT_DIR       = join(IMPORTER_ROOT, 'out');
const PACKS_OUT_DIR = join(IMPORTER_ROOT, '..', '..', 'systems', 'pf2e', 'packs');

const IMPORTER_VERSION = '0.1.0';
const SOURCE_VERSION   = 'v14-dev';

// ---------------------------------------------------------------------------
// Pack manifests (REQ-CMP-003/004/040)
// ---------------------------------------------------------------------------

/** @type {Record<string, import('../types.js').PackManifest>} */
const PACK_MANIFESTS = {
  'weapons-core': {
    id: 'pf2e.weapons-core',
    label: 'PF2e Core Weapons',
    documentType: 'Item',
    systemId: 'pf2e',
    indexFields: ['system.level', 'system.category', 'system.traits.value', 'system.damage'],
    license: {
      license: 'ORC',
      attribution: 'Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.',
      reservedNotice: 'Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.',
      sourceRepo: 'github.com/foundryvtt/pf2e',
      sourceVersion: SOURCE_VERSION,
    },
    source: {
      repo: 'github.com/foundryvtt/pf2e',
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  'conditions': {
    id: 'pf2e.conditions',
    label: 'PF2e Conditions',
    documentType: 'Item',
    systemId: 'pf2e',
    indexFields: ['system.group', 'system.value.isValued'],
    license: {
      license: 'ORC',
      attribution: 'Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.',
      reservedNotice: 'Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.',
      sourceRepo: 'github.com/foundryvtt/pf2e',
      sourceVersion: SOURCE_VERSION,
    },
    source: {
      repo: 'github.com/foundryvtt/pf2e',
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  'bestiary-core': {
    id: 'pf2e.bestiary-core',
    label: 'PF2e Core Bestiary',
    documentType: 'Actor',
    systemId: 'pf2e',
    indexFields: ['system.details.level.value', 'system.traits.value', 'system.attributes.hp.max'],
    license: {
      license: 'ORC',
      attribution: 'Pathfinder Monster Core © 2024 Paizo Inc. Licensed under the ORC License.',
      reservedNotice: 'Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.',
      sourceRepo: 'github.com/foundryvtt/pf2e',
      sourceVersion: SOURCE_VERSION,
    },
    source: {
      repo: 'github.com/foundryvtt/pf2e',
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
  'spells-core': {
    id: 'pf2e.spells-core',
    label: 'PF2e Core Spells',
    documentType: 'Item',
    systemId: 'pf2e',
    indexFields: ['system.level', 'system.traits.value', 'system.traits.traditions', 'system.traits.rarity'],
    license: {
      license: 'ORC',
      attribution: 'Pathfinder Player Core © 2023 Paizo Inc. Licensed under the ORC License.',
      reservedNotice: 'Pathfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.',
      sourceRepo: 'github.com/foundryvtt/pf2e',
      sourceVersion: SOURCE_VERSION,
    },
    source: {
      repo: 'github.com/foundryvtt/pf2e',
      version: SOURCE_VERSION,
      importerVersion: IMPORTER_VERSION,
    },
    schemaVersion: 1,
  },
};

// ---------------------------------------------------------------------------
// MVP weapon selection — ~30 armas básicas curadas
// fusionIds pré-calculados (derivados de base62_16(sha1(packName + ":" + pf2eId)))
// pf2eIds da análise 05-id-compat.md / dados da normalização.
// ---------------------------------------------------------------------------

/** pf2eSourceIds das armas selecionadas para o MVP (curadas da análise). */
const MVP_WEAPON_PF2E_IDS = new Set([
  // Simple weapons — melee
  'rQWaJhI5Bko5x14Z', // Dagger
  'c58wczIzH2gzeXQL', // Club
  'tOhoGvmCMw4JpWcS', // Spear
  '5fu6dCtqhdBnHNqh', // Morningstar
  'LGgvev6AV0So8tP9', // Hatchet
  'JNt7GmLCCVz5BiEI', // Javelin
  'Tt4Qw64fwrxhr5gT', // Dart
  'UCH4myuFnokGv0vF', // Sling
  'FVjTuBCIefAgloUU', // Staff
  // Martial weapons — melee
  'LJdbVTOZog39EEbi', // Longsword
  '7tKkkF8eZ4iCLJtp', // Shortsword
  'tH5GirEy7YB3ZgCk', // Rapier
  't5FbyZtRL4qV0V7k', // Flail
  'rXt4629QSg7KDTgJ', // Warhammer
  'mlrmkpOlwpnGkw4I', // Maul
  '8COlYvHe6hKCXY8x', // Greataxe
  'UX71GkWBL9g41VwM', // Greatsword
  'War0uyLBx1jA0Ge7', // Battle Axe
  'FJrsDoaIXksVjld9', // Trident
  'hMYdSFmMWzidzHih', // Bo Staff
  'TDrO7Xdyn7juFy3c', // Kukri
  'f1gwoTkf3Nn0v3PN', // Whip
  '6KWYmeRMxsQfWhhJ', // Bastard Sword
  // Ranged
  'hIgqLgH3YcLZBeoT', // Shortbow
  'MVAWttmT0QDa7LsV', // Longbow
  '62nnVQvGhoVLLl2K', // Crossbow
  'e4NwsnPnpQKbDZ9F', // Composite Shortbow
  'dUC8Fsa6FZtVikS3', // Composite Longbow
  'XyA6PKV46aNlLXOd', // Hand Crossbow
  // Unarmed / natural
  // (include one advanced to round out)
  'oSQET5hKn9q4xlrl', // Gnome Flickmace (advanced)
]);

/** pf2eSourceIds das magias selecionadas para o MVP. */
const MVP_SPELL_PF2E_IDS = new Set([
  // Level 1 cantrips / rank 1
  'kBhaPuzLUSwS6vVf', // Electric Arc (L1)
  'gpzpAAAJ1Lza2JVl', // Detect Magic (L1)
  'izcxFQFwf3woCnFs', // Guidance (L1)
  'WBmvzNDfpwka3qT4', // Light (L1)
  'TVKNbcgTee19PXZR', // Shield (L1)
  '4gBIw4IDrSfFHik4', // Daze (L1)
  'SnjhtQYexDtNDdEg', // Stabilize (L1)
  'rfZpqmj0AIIdkVIs', // Heal (L1)
  'wdA52JJnsuQWeyqz', // Harm (L1)
  '4koZzrnMXhhosn0D', // Fear (L1)
  'jfVCuOpzC6mUrf6f', // Hydraulic Push (L1)
  'IxhGEKl63R4QBvkj', // Frostbite (L1)
  '6DfLZBl8wKIV03Iq', // Ignition (L1)
  // Level 2
  'XXqE1eY3w3z6xJCB', // Invisibility (L2)
  '4GE2ZdODgIQtg51c', // Darkness (L2)
  '9HpwDN4MYQJnW0LG', // Dispel Magic (L2)
  // Level 3
  'sxQZ6yqTn0czJxVd', // Fireball (L3)
  '9AAkVUCwF6WVNNY2', // Lightning Bolt (L3)
  'o6YCGx4lycsYpww4', // Haste (L3)
  'WsUwpfmhKrKwoIe3', // Slow (L3)
  'KqvqNAfGIE5a9wSv', // Heroism (L3)
  // Level 4
  'A2JfEKe6BZcTG1S8', // Fly (L4)
]);

/** pf2eSourceIds dos monstros selecionados para o MVP. */
const MVP_MONSTER_PF2E_IDS = new Set([
  // Level -1 (starter encounters)
  'trchDxbDR2TiPMxT', // Skeleton Guard
  'fLLKuOXwPq1Iq0U4', // Goblin Warrior
  'KHTYbQgR5hnFZdGL', // Guard Dog
  'BIZfjoz8DZt75EDn', // Kobold Warrior
  'iIJPJcDT8wlJ8z5M', // Giant Rat
  'Xo4IGzw28hivgMmM', // Zombie Shambler
  'WBPEvEqIGvxeQKlp', // Eagle
  // Level 0
  'YReM6QbqwUz3UTP7', // Orc Scrapper
  'v1UK3IwCB8wCbL3L', // Leaf Leshy
  'Ytp0kRaG8iexmPfN', // Hryngar Sharpshooter
  // Level 1+
  // (add a few more interesting ones from L1-3)
]);

// ---------------------------------------------------------------------------
// Build pack documents
// ---------------------------------------------------------------------------

function loadTransformed(packName) {
  const path = join(OUT_DIR, packName, 'transformed.json');
  if (!existsSync(path)) {
    throw new Error(`transformed.json not found for pack "${packName}". Run transform.mjs first.`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Filters transformed docs to the MVP subset.
 * Uses flags.fusion.sourceId to match original pf2e IDs.
 */
function filterToMvpSubset(docs, selectedPf2eIds) {
  return docs.filter(doc => {
    const sourceId = doc.flags?.fusion?.sourceId;
    return sourceId && selectedPf2eIds.has(sourceId);
  });
}

/**
 * Writes pack documents and manifest to systems/pf2e/packs/<slug>/.
 * REQ-CMP-003/004/030.
 */
function writePack(slug, docs, manifest) {
  const packDir = join(PACKS_OUT_DIR, slug);
  mkdirSync(packDir, { recursive: true });

  // Finalize manifest with counts
  const finalManifest = {
    ...manifest,
    documentCount: docs.length,
    generatedAt: new Date().toISOString(),
  };

  // Write pack.json (REQ-CMP-003)
  writeFileSync(join(packDir, 'pack.json'), JSON.stringify(finalManifest, null, 2), 'utf8');

  // Write documents.json (commitável — formato JSON array)
  // In the full pipeline this would be a pack.db (SQLite), but for the MVP
  // commitável subset we use JSON. The server loads this via PackLoader.
  writeFileSync(join(packDir, 'documents.json'), JSON.stringify(docs, null, 2), 'utf8');

  console.log(`[build-mvp] ${slug}: ${docs.length} docs → systems/pf2e/packs/${slug}/`);
  return finalManifest;
}

/**
 * Builds an index entry per document for lazy loading.
 * REQ-CMP-007.
 */
function buildIndex(packId, docs, indexFields) {
  return docs.map(doc => {
    const indexData = {};
    for (const field of indexFields) {
      // Resolve nested path like "system.level"
      const parts = field.split('.');
      let value = doc;
      for (const part of parts) {
        value = value?.[part];
        if (value === undefined) break;
      }
      if (value !== undefined) indexData[field] = value;
    }
    return {
      _id: doc._id,
      uuid: `Compendium.${packId}.${doc.type === 'npc' ? 'Actor' : 'Item'}.${doc._id}`,
      name: doc.name,
      img: doc.img ?? null,
      type: doc.type ?? null,
      index: indexData,
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[build-mvp] Gerando subconjunto MVP de packs Fusion...\n');
  mkdirSync(PACKS_OUT_DIR, { recursive: true });

  const report = {
    packs: [],
    generatedAt: new Date().toISOString(),
    importerVersion: IMPORTER_VERSION,
    sourceVersion: SOURCE_VERSION,
  };

  // --- 1. Conditions (all 43) ---
  {
    console.log('[build-mvp] === Pack: conditions ===');
    const all = loadTransformed('conditions');
    const docs = all; // All conditions included
    const manifest = PACK_MANIFESTS['conditions'];
    const finalManifest = writePack('conditions', docs, manifest);

    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, 'conditions', 'index.json'),
      JSON.stringify(index, null, 2),
      'utf8',
    );

    report.packs.push({ packId: manifest.id, slug: 'conditions', documentCount: docs.length });
  }

  // --- 2. Weapons core (~30 curadas) ---
  {
    console.log('[build-mvp] === Pack: weapons-core ===');
    const all = loadTransformed('equipment');
    const weapons = all.filter(d => d.type === 'weapon');
    const docs = filterToMvpSubset(weapons, MVP_WEAPON_PF2E_IDS);
    console.log(`[build-mvp] weapons-core: ${docs.length} selecionadas de ${weapons.length} armas`);

    const manifest = PACK_MANIFESTS['weapons-core'];
    const finalManifest = writePack('weapons-core', docs, manifest);

    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, 'weapons-core', 'index.json'),
      JSON.stringify(index, null, 2),
      'utf8',
    );

    report.packs.push({ packId: manifest.id, slug: 'weapons-core', documentCount: docs.length });
  }

  // --- 3. Core Bestiary (~10 monstros) ---
  {
    console.log('[build-mvp] === Pack: bestiary-core ===');
    const all = loadTransformed('pathfinder-monster-core');
    const monsters = all.filter(d => d.type === 'npc');
    const curated = filterToMvpSubset(monsters, MVP_MONSTER_PF2E_IDS);

    // Supplement with additional L1-3 ORC monsters to reach ~10 total
    const alreadySelected = new Set(curated.map(d => d._id));
    const supplemental = monsters
      .filter(m => !alreadySelected.has(m._id))
      .filter(m => {
        const level = m.system?.details?.level?.value ?? 0;
        const pub = m.system?.details?.publication?.license;
        return pub === 'ORC' && level >= 1 && level <= 3;
      })
      .sort((a, b) => (a.system?.details?.level?.value ?? 0) - (b.system?.details?.level?.value ?? 0))
      .slice(0, Math.max(0, 10 - curated.length));

    const docs = [...curated, ...supplemental];
    console.log(`[build-mvp] bestiary-core: ${docs.length} monstros selecionados`);

    const manifest = PACK_MANIFESTS['bestiary-core'];
    const finalManifest = writePack('bestiary-core', docs, manifest);

    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, 'bestiary-core', 'index.json'),
      JSON.stringify(index, null, 2),
      'utf8',
    );

    report.packs.push({ packId: manifest.id, slug: 'bestiary-core', documentCount: docs.length });
  }

  // --- 4. Core Spells (~20) ---
  {
    console.log('[build-mvp] === Pack: spells-core ===');
    const all = loadTransformed('spells');
    const curated = filterToMvpSubset(all, MVP_SPELL_PF2E_IDS);
    const docs = curated;
    console.log(`[build-mvp] spells-core: ${docs.length} magias selecionadas`);

    const manifest = PACK_MANIFESTS['spells-core'];
    const finalManifest = writePack('spells-core', docs, manifest);

    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(PACKS_OUT_DIR, 'spells-core', 'index.json'),
      JSON.stringify(index, null, 2),
      'utf8',
    );

    report.packs.push({ packId: manifest.id, slug: 'spells-core', documentCount: docs.length });
  }

  // Write build report
  const reportPath = join(PACKS_OUT_DIR, 'build-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n[build-mvp] === SUMÁRIO ===');
  for (const p of report.packs) {
    console.log(`  ${p.packId}: ${p.documentCount} documentos`);
  }
  console.log(`\nPacks em: systems/pf2e/packs/`);
}

main().catch(err => {
  console.error('[build-mvp] FATAL:', err);
  process.exit(1);
});
