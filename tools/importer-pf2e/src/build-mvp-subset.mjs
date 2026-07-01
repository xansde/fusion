/**
 * build-mvp-subset.mjs — Gera o SUBCONJUNTO MVP commitável de packs Fusion.
 *
 * Consome os documentos transformados (out/<pack>/transformed.json, ou
 * out/sf2e/<pack>/transformed.json para --system sf2e) e seleciona um
 * subconjunto curado para o MVP da primeira sessão jogável de cada sistema.
 *
 * Subconjunto pf2e (default):
 *   - pf2e.weapons-core:    ~30 armas básicas (ORC, dados mecânicos)
 *   - pf2e.conditions:      todas as 43 condições
 *   - pf2e.bestiary-core:   10 monstros de nível -1 a 3 (ORC)
 *   - pf2e.spells-core:     15 magias comuns level 1-3 (ORC)
 *
 * Subconjunto sf2e (--system sf2e, REQ-SF2-044..048):
 *   - sf2e.weapons-core:       ~30 armas nível 0 (analog + tech: arc/laser/
 *     plasma/automatic/area — cobre traits SF-exclusivos)
 *   - sf2e.armor-core:         ~10 armaduras nível 0
 *   - sf2e.augmentations-core: ~10 augmentações (equipment/usage:implanted)
 *   - sf2e.conditions:         as 3 condições SF-exclusivas (glitching,
 *     suppressed, untethered — type "effect", ver conditions.ts)
 *   - sf2e.bestiary-core:      ~10 criaturas de nível -1 a 3 (ORC), incl.
 *     robots/aliens para exercitar a allowlist de traits SF
 *   - sf2e.spells-core:        ~15 magias comuns nível 1-3 (ORC)
 *
 * Saída: systems/<systemId>/packs/<packSlug>/
 *   - documents.json  — array de documentos Fusion (commitável)
 *   - pack.json       — manifesto com licença ORC e metadados
 *
 * REQ-CMP-001..004, REQ-CMP-030..033, REQ-CMP-040..044, REQ-SF2-044..048.
 * Spec 16 §Formato de pack e armazenamento, §Pipeline §Versionamento.
 * Spec 18 §Compendium packs.
 *
 * Uso:
 *   node src/build-mvp-subset.mjs               # pf2e (default)
 *   node src/build-mvp-subset.mjs --system sf2e  # sf2e
 *
 * Zero dependências externas — Node 22 ESM puro.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMPORTER_ROOT = join(__dirname, '..');
const OUT_DIR       = join(IMPORTER_ROOT, 'out');
const SYSTEMS_ROOT  = join(IMPORTER_ROOT, '..', '..', 'systems');
const PACKS_OUT_DIR = join(SYSTEMS_ROOT, 'pf2e', 'packs');
const SF2E_PACKS_OUT_DIR = join(SYSTEMS_ROOT, 'sf2e', 'packs');

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

/**
 * @param {string} packName
 * @param {'pf2e'|'sf2e'} [system]
 */
function loadTransformed(packName, system = 'pf2e') {
  const base = system === 'pf2e' ? OUT_DIR : join(OUT_DIR, system);
  const path = join(base, packName, 'transformed.json');
  if (!existsSync(path)) {
    throw new Error(`transformed.json not found for pack "${packName}" (system: ${system}). Run transform.mjs first.`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Filters transformed docs to the MVP subset.
 * Uses flags.fusion.sourceId to match original pf2e/sf2e IDs.
 */
function filterToMvpSubset(docs, selectedPf2eIds) {
  return docs.filter(doc => {
    const sourceId = doc.flags?.fusion?.sourceId;
    return sourceId && selectedPf2eIds.has(sourceId);
  });
}

/**
 * Writes pack documents and manifest to systems/<systemId>/packs/<slug>/.
 * REQ-CMP-003/004/030.
 * @param {string} slug
 * @param {object[]} docs
 * @param {object} manifest
 * @param {string} [packsOutDir] — defaults to PACKS_OUT_DIR (pf2e)
 */
function writePack(slug, docs, manifest, packsOutDir = PACKS_OUT_DIR) {
  const packDir = join(packsOutDir, slug);
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

  const relBase = packsOutDir === SF2E_PACKS_OUT_DIR ? 'systems/sf2e/packs' : 'systems/pf2e/packs';
  console.log(`[build-mvp] ${slug}: ${docs.length} docs → ${relBase}/${slug}/`);
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
// Main — pf2e
// ---------------------------------------------------------------------------

async function buildPf2eSubset() {
  console.log('[build-mvp] Gerando subconjunto MVP de packs Fusion (pf2e)...\n');
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
  return report;
}

// ---------------------------------------------------------------------------
// Main — sf2e (REQ-SF2-044..048)
// ---------------------------------------------------------------------------

/** sf2e MVP pack manifests, mirroring PACK_MANIFESTS' shape (spec 18). */
const SF2E_PACK_MANIFESTS = {
  'weapons-core': {
    id: 'sf2e.weapons-core',
    label: 'SF2e Core Weapons',
    documentType: 'Item',
    systemId: 'sf2e',
    indexFields: ['system.level', 'system.category', 'system.traits.value', 'system.damage', 'system.grade'],
    license: {
      license: 'ORC',
      attribution: 'Starfinder Player Core © 2025 Paizo Inc. Licensed under the ORC License.',
      reservedNotice: 'Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.',
      sourceRepo: 'github.com/foundryvtt/pf2e',
      sourceVersion: SOURCE_VERSION,
    },
    source: { repo: 'github.com/foundryvtt/pf2e', version: SOURCE_VERSION, importerVersion: IMPORTER_VERSION },
    schemaVersion: 1,
  },
  'armor-core': {
    id: 'sf2e.armor-core',
    label: 'SF2e Core Armor',
    documentType: 'Item',
    systemId: 'sf2e',
    indexFields: ['system.level', 'system.category', 'system.traits.value'],
    license: {
      license: 'ORC',
      attribution: 'Starfinder Player Core © 2025 Paizo Inc. Licensed under the ORC License.',
      reservedNotice: 'Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.',
      sourceRepo: 'github.com/foundryvtt/pf2e',
      sourceVersion: SOURCE_VERSION,
    },
    source: { repo: 'github.com/foundryvtt/pf2e', version: SOURCE_VERSION, importerVersion: IMPORTER_VERSION },
    schemaVersion: 1,
  },
  'augmentations-core': {
    id: 'sf2e.augmentations-core',
    label: 'SF2e Core Augmentations',
    documentType: 'Item',
    systemId: 'sf2e',
    indexFields: ['system.level', 'system.traits.value', 'system.usage'],
    license: {
      license: 'ORC',
      attribution: 'Starfinder Player Core © 2025 Paizo Inc. Licensed under the ORC License.',
      reservedNotice: 'Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.',
      sourceRepo: 'github.com/foundryvtt/pf2e',
      sourceVersion: SOURCE_VERSION,
    },
    source: { repo: 'github.com/foundryvtt/pf2e', version: SOURCE_VERSION, importerVersion: IMPORTER_VERSION },
    schemaVersion: 1,
  },
  'conditions': {
    id: 'sf2e.conditions',
    label: 'SF2e Conditions',
    documentType: 'Item',
    systemId: 'sf2e',
    indexFields: ['system.duration', 'system.badge'],
    license: {
      license: 'ORC',
      attribution: 'Starfinder Player Core © 2025 Paizo Inc. Licensed under the ORC License.',
      reservedNotice: 'Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.',
      sourceRepo: 'github.com/foundryvtt/pf2e',
      sourceVersion: SOURCE_VERSION,
    },
    source: { repo: 'github.com/foundryvtt/pf2e', version: SOURCE_VERSION, importerVersion: IMPORTER_VERSION },
    schemaVersion: 1,
  },
  'bestiary-core': {
    id: 'sf2e.bestiary-core',
    label: 'SF2e Core Bestiary',
    documentType: 'Actor',
    systemId: 'sf2e',
    indexFields: ['system.details.level.value', 'system.traits.value', 'system.attributes.hp.max'],
    license: {
      license: 'ORC',
      attribution: 'Starfinder Alien Core © 2025 Paizo Inc. Licensed under the ORC License.',
      reservedNotice: 'Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.',
      sourceRepo: 'github.com/foundryvtt/pf2e',
      sourceVersion: SOURCE_VERSION,
    },
    source: { repo: 'github.com/foundryvtt/pf2e', version: SOURCE_VERSION, importerVersion: IMPORTER_VERSION },
    schemaVersion: 1,
  },
  'spells-core': {
    id: 'sf2e.spells-core',
    label: 'SF2e Core Spells',
    documentType: 'Item',
    systemId: 'sf2e',
    indexFields: ['system.level', 'system.traits.value', 'system.traits.traditions', 'system.traits.rarity'],
    license: {
      license: 'ORC',
      attribution: 'Starfinder Player Core © 2025 Paizo Inc. Licensed under the ORC License.',
      reservedNotice: 'Starfinder, Paizo Inc., and their respective logos are trademarks of Paizo Inc.',
      sourceRepo: 'github.com/foundryvtt/pf2e',
      sourceVersion: SOURCE_VERSION,
    },
    source: { repo: 'github.com/foundryvtt/pf2e', version: SOURCE_VERSION, importerVersion: IMPORTER_VERSION },
    schemaVersion: 1,
  },
};

/**
 * sourceIds curados para o subset MVP sf2e — spread analog/tech, tiers
 * commercial/level-0, cobrindo traits SF-exclusivos (tech, analog, arc,
 * automatic, area-cone). Curados a partir de out/sf2e/equipment/transformed.json
 * (analysis/08-sf2e-import.md tem o detalhamento por arma).
 */
const SF2E_WEAPON_SOURCE_IDS = new Set([
  'M0PsUbGLkBk878YZ', // Arc Pistol (tech, arc)
  'TAgaAiDMPGnF87Vv', // Arc Rifle (tech, arc)
  'qIgcUV22LaDCzmb2', // Laser Pistol (tech)
  '0TSUahGsoVnDZ6kv', // Laser Rifle (tech)
  'O3QRrXVfhNpF0XyY', // Zero Pistol (tech)
  'jLiackiAHgru9OY0', // Plasma Sword (tech, powered)
  'ST6R4rRFf50vzSdJ', // Shock Truncheon (tech, powered, modular)
  '3yWQhmBrAXnBhYaF', // Flamethrower (tech, area-cone, unwieldy)
  'EnufuFPBa1U2pPDn', // Machine Gun (analog, automatic)
  'dxkmvJZOblZ8oImW', // Autotarget Rifle (analog, automatic)
  'V0LgOSOvkNvs2i0x', // Knife (analog, agile, finesse)
  'D4KuxPi9gqFkvZ3h', // Baton (analog, finesse, nonlethal)
  'K0xFwEC6Zv7ghVFa', // Semi-Auto Pistol (analog)
  '8nvXQmFxd5eCkD9v', // Hammer (analog)
  'a2e5svVQ20WrzRTK', // Dueling Sword (analog, versatile-p)
  'gwVhd31nGDXo5HAa', // Crossbolter (analog)
  'sTe6qQmJ1lC1xDfC', // Shock Pad (tech, powered, agile)
  'vpjJYIgYZab0UZFa', // Pulsecaster Pistol (tech, nonlethal)
  'V7epvZwIrMLMYI97', // Coil Rifle (tech, kickback, unwieldy)
  'wbKiBgYY120RyoGg', // Shooting Starknife (analog, thrown-20)
]);

/** sourceIds curados de armaduras nível 0 (analysis/08-sf2e-import.md). */
const SF2E_ARMOR_SOURCE_IDS = new Set([
  'ehsCl5WJTANTlzBy', // Abadarcorp Travel Suit (light)
  'mkMWda6ivlhnXq4d', // Armored Coat (light)
  'aNoSZiPBfxVJYvap', // Carbon Skin (light)
  'FySX3VPYY1YkdBZg', // Estex Suit (light)
  'pcPU3BjbNclch4lS', // Hardlight Series (light)
  '9UiGMq93t13HEz90', // Quilted Armor (light)
  'plBUD8dy3M3gGiHK', // Freebooter Armor (medium)
  'eU5n2fP7DvnFyqov', // Shotalashu Armor (medium)
  'E9MKSSJCOk9ceLKc', // Aegis Series (heavy)
  'wnJTyjfupLw4Cy7G', // Hidden Soldier Armor (heavy)
]);

/**
 * sourceIds curados de augmentações (D-SF2-03; type "equipment" com
 * usage:"implanted" no dado real — ver systems/sf2e/src/schemas/item-augmentation.ts).
 * Spread pelas 5 categorias reais (apex/biotech/magitech/necrograft/tech —
 * pastas em vendor/pf2e/packs/sf2e/equipment/augmentations/, types.ts
 * AUGMENTATION_TYPES).
 */
const SF2E_AUGMENTATION_SOURCE_IDS = new Set([
  'GBtIO5fqFGD9Dzk1', // Autorecognition Lens (tech)
  'uxJScsvafT7Nqwhj', // Hearing Aid (tech)
  '3TQ2WCBNaFwEUDHo', // Datajack (Commercial) (tech)
  'j66fZJrm1nECG3UM', // Dermal Plating (Commercial) (tech)
  'PJaarOSEHTLje8sT', // Retinal Reflectors (tech)
  'ejsPnjUVXf2TJgeD', // Dragon Gland (Commercial) (biotech)
  'zyrPSFBAwL58wCUB', // Gill Sheath (biotech)
  'VYtnxv13EtkyggD4', // Moodskin (magitech)
  'Dmwb9DcWLf9y8JmC', // Telepathy Node (magitech)
  'CBFbt7Xg5YP856ld', // Necrolung (Commercial) (necrograft)
]);

/**
 * sourceIds curados de magias nível 1-3 (analog aos pf2e cantrips/rank-1).
 */
const SF2E_SPELL_SOURCE_IDS = new Set([
  'FEaM1B4WuiqFO7Uk', // Eldritch Lance (L1)
  'JIAIyvj4PV84tnFk', // Chill Gaze (L1)
  'yXD9uU8w8uFD2OBQ', // Delete (L1)
  'd5dmu4HZ3YyrwcaF', // Elemental Weapon (L1)
  'ahXTkKpQtOTAQOFm', // Enhance Weapon (L1)
  'ZBeKxBcUOsXrfMRo', // Implant Data (L1)
  'uBo6g5aW087cLSJR', // Mind Skewer (L1)
  'wOjoJjl2ndZKTuFJ', // Overheat (L1)
  'mAu69GVbFKYzQM5a', // Akashic Fount (L1)
  'smCC1LNhMb7Z1lrU', // Anthem (L1)
]);

/**
 * sourceIds curados de bestiário — inclui robots/aliens para exercitar a
 * allowlist de traits SF-exclusivos (REQ-SF2-047; analysis/04 §6 item 2).
 */
const SF2E_MONSTER_SOURCE_IDS = new Set([
  'rl5p1LLCpKh16viU', // Repair-Class Security Robot (robot, construct, tech) L-1
  'H53Dsx2DYmd9hBIn', // Botnib (fey, gremlin, tech) L-1
  'dxbr3LNg0R66Aj1n', // Cybernetic Zombie (tech, undead) L-1
  'MnOrSqYS5w8tAPXM', // Ordinance-Class Civil Robot (robot, construct, tech) L0
  'pjh2PB4JwYlgMTwj', // Cyanoscum (elemental, plant) L0
  'yhCFz4PyGPpFRr1O', // Akata (aberration) L1
]);

async function buildSf2eSubset() {
  console.log('[build-mvp] Gerando subconjunto MVP de packs Fusion (sf2e)...\n');
  mkdirSync(SF2E_PACKS_OUT_DIR, { recursive: true });

  const report = {
    packs: [],
    generatedAt: new Date().toISOString(),
    importerVersion: IMPORTER_VERSION,
    sourceVersion: SOURCE_VERSION,
    system: 'sf2e',
  };

  const writeSf2ePack = (slug, docs, manifest) => {
    const finalManifest = writePack(slug, docs, manifest, SF2E_PACKS_OUT_DIR);
    const index = buildIndex(manifest.id, docs, manifest.indexFields);
    writeFileSync(
      join(SF2E_PACKS_OUT_DIR, slug, 'index.json'),
      JSON.stringify(index, null, 2),
      'utf8',
    );
    report.packs.push({ packId: manifest.id, slug, documentCount: docs.length });
    return finalManifest;
  };

  // --- 1. Conditions (all 3 SF-exclusive: glitching, suppressed, untethered) ---
  {
    console.log('[build-mvp] === Pack: conditions (sf2e) ===');
    const docs = loadTransformed('conditions', 'sf2e');
    console.log(`[build-mvp] conditions: ${docs.length} condições sf2e-exclusivas`);
    writeSf2ePack('conditions', docs, SF2E_PACK_MANIFESTS['conditions']);
  }

  // --- 2. Weapons core (~20 curadas, spread analog/tech) ---
  {
    console.log('[build-mvp] === Pack: weapons-core (sf2e) ===');
    const all = loadTransformed('equipment', 'sf2e');
    const weapons = all.filter(d => d.type === 'weapon');
    const docs = filterToMvpSubset(weapons, SF2E_WEAPON_SOURCE_IDS);
    console.log(`[build-mvp] weapons-core: ${docs.length} selecionadas de ${weapons.length} armas`);
    writeSf2ePack('weapons-core', docs, SF2E_PACK_MANIFESTS['weapons-core']);
  }

  // --- 3. Armor core (~10 curadas) ---
  {
    console.log('[build-mvp] === Pack: armor-core (sf2e) ===');
    const all = loadTransformed('equipment', 'sf2e');
    const armor = all.filter(d => d.type === 'armor');
    const docs = filterToMvpSubset(armor, SF2E_ARMOR_SOURCE_IDS);
    console.log(`[build-mvp] armor-core: ${docs.length} selecionadas de ${armor.length} armaduras`);
    writeSf2ePack('armor-core', docs, SF2E_PACK_MANIFESTS['armor-core']);
  }

  // --- 4. Augmentations core (D-SF2-03) ---
  {
    console.log('[build-mvp] === Pack: augmentations-core (sf2e) ===');
    const all = loadTransformed('equipment', 'sf2e');
    const augmentations = all.filter(d => d.type === 'equipment' && d.system?.usage === 'implanted');
    const docs = filterToMvpSubset(augmentations, SF2E_AUGMENTATION_SOURCE_IDS);
    console.log(`[build-mvp] augmentations-core: ${docs.length} selecionadas de ${augmentations.length} augmentações`);
    writeSf2ePack('augmentations-core', docs, SF2E_PACK_MANIFESTS['augmentations-core']);
  }

  // --- 5. Bestiary core (~10, incl. robots/aliens p/ allowlist de traits) ---
  {
    console.log('[build-mvp] === Pack: bestiary-core (sf2e) ===');
    const all = loadTransformed('alien-core-bestiary', 'sf2e');
    const monsters = all.filter(d => d.type === 'npc');
    const curated = filterToMvpSubset(monsters, SF2E_MONSTER_SOURCE_IDS);

    // Supplement with additional L-1..L3 ORC monsters to reach ~10 total
    const alreadySelected = new Set(curated.map(d => d._id));
    const supplemental = monsters
      .filter(m => !alreadySelected.has(m._id))
      .filter(m => {
        const level = m.system?.details?.level?.value ?? 0;
        const pub = m.system?.details?.publication?.license;
        return pub === 'ORC' && level >= -1 && level <= 3;
      })
      .sort((a, b) => (a.system?.details?.level?.value ?? 0) - (b.system?.details?.level?.value ?? 0))
      .slice(0, Math.max(0, 10 - curated.length));

    const docs = [...curated, ...supplemental];
    console.log(`[build-mvp] bestiary-core: ${docs.length} criaturas selecionadas`);
    writeSf2ePack('bestiary-core', docs, SF2E_PACK_MANIFESTS['bestiary-core']);
  }

  // --- 6. Spells core (~10 curadas) ---
  {
    console.log('[build-mvp] === Pack: spells-core (sf2e) ===');
    const all = loadTransformed('spells', 'sf2e');
    const docs = filterToMvpSubset(all, SF2E_SPELL_SOURCE_IDS);
    console.log(`[build-mvp] spells-core: ${docs.length} magias selecionadas`);
    writeSf2ePack('spells-core', docs, SF2E_PACK_MANIFESTS['spells-core']);
  }

  // Write build report
  const reportPath = join(SF2E_PACKS_OUT_DIR, 'build-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n[build-mvp] === SUMÁRIO (sf2e) ===');
  for (const p of report.packs) {
    console.log(`  ${p.packId}: ${p.documentCount} documentos`);
  }
  console.log(`\nPacks em: systems/sf2e/packs/`);
  return report;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const systemEq  = args.find(a => a.startsWith('--system='));
  const systemIdx = args.indexOf('--system');
  const systemFlag = systemEq
    ? systemEq.split('=')[1]
    : (systemIdx !== -1 ? args[systemIdx + 1] : null);
  const system = systemFlag === 'sf2e' ? 'sf2e' : 'pf2e';

  if (system === 'sf2e') {
    await buildSf2eSubset();
  } else {
    await buildPf2eSubset();
  }
}

main().catch(err => {
  console.error('[build-mvp] FATAL:', err);
  process.exit(1);
});
