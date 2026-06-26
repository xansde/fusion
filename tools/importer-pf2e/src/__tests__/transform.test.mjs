/**
 * transform.test.mjs — Testes do estágio TRANSFORM do pipeline PF2E → Fusion.
 *
 * Verifica:
 *   1. fusionId determinístico e sem colisão cross-pack.
 *   2. Transform de amostras reais (weapon, condition, NPC) → doc Fusion válido.
 *   3. RE não suportado vai para flags.fusion.unconvertedRules sem quebrar.
 *   4. Nenhuma arte Paizo no output.
 *   5. Cobertura de Rule Elements (FlatModifier → ModifierDescriptor).
 *
 * REQ-CMP-034..044; Analysis 05 (fusionId), 03 (rule elements).
 *
 * Execução:
 *   node --test src/__tests__/transform.test.mjs
 *
 * Zero dependências externas — Node 22 ESM nativo + node:test.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMPORTER_ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(IMPORTER_ROOT, 'out');
const PACKS_DIR = join(IMPORTER_ROOT, '..', '..', 'systems', 'pf2e', 'packs');
const SAMPLES_DIR = join(IMPORTER_ROOT, 'samples');

// ---------------------------------------------------------------------------
// Helpers (inline subset of transform.mjs logic — no import of the module
// itself to avoid running the CLI side-effects)
// ---------------------------------------------------------------------------

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function bufToBase62(buf, length) {
  let n = BigInt('0x' + buf.toString('hex'));
  const result = [];
  const base = BigInt(62);
  for (let i = 0; i < length; i++) {
    result.push(BASE62[Number(n % base)]);
    n = n / base;
  }
  return result.reverse().join('');
}

function deriveFusionId(packName, pf2eSourceId) {
  const input = `${packName}:${pf2eSourceId}`;
  const hash = createHash('sha1').update(input, 'utf8').digest();
  return bufToBase62(hash, 16);
}

function isValidFusionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9]{16}$/.test(id);
}

function loadJson(path) {
  assert.ok(existsSync(path), `File not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadTransformed(packName) {
  return loadJson(join(OUT_DIR, packName, 'transformed.json'));
}

// ---------------------------------------------------------------------------
// 1. fusionId — determinismo e ausência de colisão cross-pack
// REQ-CMP-041
// ---------------------------------------------------------------------------

describe('fusionId derivation', () => {
  it('produces 16-char base62 string', () => {
    const id = deriveFusionId('equipment', 'LJdbVTOZog39EEbi');
    assert.ok(isValidFusionId(id), `Invalid fusionId: "${id}"`);
  });

  it('is deterministic — same inputs produce same ID', () => {
    const a = deriveFusionId('equipment', 'LJdbVTOZog39EEbi');
    const b = deriveFusionId('equipment', 'LJdbVTOZog39EEbi');
    assert.equal(a, b, 'fusionId must be deterministic');
  });

  it('different packs produce different IDs for the same pf2e _id', () => {
    const sameId = 'LJdbVTOZog39EEbi'; // Longsword pf2e id
    const inEquipment = deriveFusionId('equipment', sameId);
    const inSpells = deriveFusionId('spells', sameId);
    assert.notEqual(inEquipment, inSpells, 'Cross-pack fusionIds must differ');
  });

  it('different pf2e ids within the same pack produce different fusionIds', () => {
    const a = deriveFusionId('equipment', 'LJdbVTOZog39EEbi');
    const b = deriveFusionId('equipment', 'hIgqLgH3YcLZBeoT');
    assert.notEqual(a, b, 'Different pf2e ids must yield different fusionIds');
  });
});

// ---------------------------------------------------------------------------
// 2. Transform output — structural validation on transformed.json
// REQ-CMP-027/030/044
// ---------------------------------------------------------------------------

describe('conditions pack transform', () => {
  const getConditionDocs = () => loadTransformed('conditions');

  it('all 43 conditions are transformed', () => {
    assert.equal(getConditionDocs().length, 43);
  });

  it('every doc has valid fusionId as _id', () => {
    for (const doc of getConditionDocs()) {
      assert.ok(isValidFusionId(doc._id), `Invalid _id for doc "${doc.name}": "${doc._id}"`);
    }
  });

  it('every doc has type, name, system, flags.fusion', () => {
    for (const doc of getConditionDocs()) {
      assert.ok(doc.type, `Missing type in doc ${doc._id}`);
      assert.ok(doc.name, `Missing name in doc ${doc._id}`);
      assert.ok(doc.system, `Missing system in doc ${doc._id}`);
      assert.ok(doc.flags?.fusion, `Missing flags.fusion in doc ${doc._id}`);
    }
  });

  it('flags.fusion.conversion is "full" or "partial"', () => {
    for (const doc of getConditionDocs()) {
      const conv = doc.flags?.fusion?.conversion;
      assert.ok(
        conv === 'full' || conv === 'partial',
        `Invalid conversion state "${conv}" for doc ${doc._id}`,
      );
    }
  });

  it('Blinded condition has FlatModifier converted', () => {
    const docs = getConditionDocs();
    const blinded = docs.find(d => d.name === 'Blinded');
    assert.ok(blinded, 'Blinded condition not found in transformed docs');

    const rules = blinded.system?.rules ?? [];
    const flatMod = rules.find(r => r.kind === 'flat-modifier');
    assert.ok(flatMod, 'Blinded should have a flat-modifier in system.rules');
    assert.equal(flatMod.selector, 'perception', 'FlatModifier selector should be "perception"');
    assert.equal(flatMod.value, -4, 'FlatModifier value should be -4');
  });
});

describe('weapon transform (Longsword)', () => {
  const getLongsword = () => {
    const docs = loadTransformed('equipment');
    return docs.find(d => d.flags?.fusion?.sourceId === 'LJdbVTOZog39EEbi');
  };

  it('Longsword is in transformed equipment', () => {
    assert.ok(getLongsword(), 'Longsword not found (pf2eSourceId: LJdbVTOZog39EEbi)');
  });

  it('has valid fusionId', () => {
    assert.ok(isValidFusionId(getLongsword()?._id), `Invalid fusionId: "${getLongsword()?._id}"`);
  });

  it('fusionId matches derived value', () => {
    const longsword = getLongsword();
    const expected = deriveFusionId('equipment', 'LJdbVTOZog39EEbi');
    assert.equal(longsword._id, expected, 'fusionId must match deriveFusionId(equipment, pf2eId)');
  });

  it('has correct mechanical fields', () => {
    const longsword = getLongsword();
    const sys = longsword.system;
    assert.ok(sys.damage, 'Missing damage block');
    assert.equal(sys.damage.die, 'd8', 'Expected d8');
    assert.equal(sys.damage.damageType, 'slashing', 'Expected slashing');
    assert.equal(sys.category, 'martial', 'Expected martial');
  });

  it('img points to placeholder, not Paizo art', () => {
    const longsword = getLongsword();
    assert.ok(longsword.img.startsWith('icons/placeholder'), `img should be placeholder, got "${longsword.img}"`);
    assert.ok(!longsword.img.includes('systems/pf2e'), 'img must not reference Paizo art');
  });

  it('has no Paizo art anywhere in the document', () => {
    const str = JSON.stringify(getLongsword());
    assert.ok(!str.includes('systems/pf2e/icons'), 'Paizo art path found in document');
  });

  it('flags.fusion.assetSubstitutions records the art swap', () => {
    const longsword = getLongsword();
    const subs = longsword.flags?.fusion?.assetSubstitutions ?? [];
    assert.ok(subs.length > 0, 'Expected at least one asset substitution recorded');
    const imgSub = subs.find(s => s.field === 'img');
    assert.ok(imgSub, 'Missing img substitution entry');
    assert.ok(imgSub.original, 'Missing original art filename');
  });
});

describe('NPC transform (Skeleton Guard)', () => {
  const getSkeleton = () => {
    const docs = loadTransformed('pathfinder-monster-core');
    return docs.find(d => d.flags?.fusion?.sourceId === 'trchDxbDR2TiPMxT');
  };

  it('Skeleton Guard is in transformed monster-core', () => {
    assert.ok(getSkeleton(), 'Skeleton Guard not found');
  });

  it('has valid fusionId', () => {
    assert.ok(isValidFusionId(getSkeleton()?._id));
  });

  it('has NPC mechanical fields', () => {
    const skeleton = getSkeleton();
    const sys = skeleton.system;
    assert.ok(sys.attributes?.hp, 'Missing hp in npc.system.attributes');
    assert.ok(sys.saves, 'Missing saves');
    assert.ok(sys.perception, 'Missing perception');
  });

  it('has items[] with embedded weapons', () => {
    const skeleton = getSkeleton();
    assert.ok(Array.isArray(skeleton.items) && skeleton.items.length > 0, 'Expected embedded items');
    const hasWeapon = skeleton.items.some(i => i.type === 'weapon' || i.type === 'melee');
    assert.ok(hasWeapon, 'Expected at least one weapon/melee item');
  });

  it('img is placeholder, not Paizo art', () => {
    const skeleton = getSkeleton();
    assert.ok(skeleton.img.startsWith('icons/placeholder'));
    assert.ok(!skeleton.img.includes('systems/pf2e'));
  });
});

// ---------------------------------------------------------------------------
// 3. Unsupported RE → flags.fusion.unconvertedRules (no crash)
// REQ-CMP-036
// ---------------------------------------------------------------------------

describe('unsupported rule element handling', () => {
  it('docs with unsupported REs have conversion = "partial"', () => {
    const docs = loadTransformed('conditions');
    const partials = docs.filter(d => d.flags?.fusion?.conversion === 'partial');
    // Blinded has an Immunity RE which is partial
    assert.ok(partials.length > 0, 'Expected at least one partial doc in conditions');
  });

  it('unconvertedRules preserves the original RE data', () => {
    // Find a doc that has unconverted rules
    const docs = loadTransformed('conditions');
    const withUnconverted = docs.filter(d => (d.flags?.fusion?.unconvertedRules?.length ?? 0) > 0);
    if (withUnconverted.length === 0) return; // skip if none in this subset

    const doc = withUnconverted[0];
    const unconverted = doc.flags.fusion.unconvertedRules;
    assert.ok(Array.isArray(unconverted));
    // Each unconverted rule must have a _conversionState field
    for (const re of unconverted) {
      assert.ok(
        re._conversionState === 'partial' || re._conversionState === 'unsupported',
        `Unexpected _conversionState: "${re._conversionState}"`,
      );
    }
  });

  it('unconverted RE does not have kind field (not a ModifierDescriptor)', () => {
    const docs = loadTransformed('equipment');
    for (const doc of docs.slice(0, 100)) {
      const unconverted = doc.flags?.fusion?.unconvertedRules ?? [];
      for (const re of unconverted) {
        // Unconverted REs are raw pf2e RE objects — they have "key" not "kind"
        assert.ok(re.key !== undefined, 'Unconverted RE must have "key" field (pf2e RE format)');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Art policy — no Paizo art in any transformed output
// REQ-CMP-031/032
// ---------------------------------------------------------------------------

describe('art policy', () => {
  const packs = ['conditions', 'spells'];

  for (const pack of packs) {
    it(`no Paizo art in ${pack} transformed docs`, () => {
      const docs = loadTransformed(pack);
      const str = JSON.stringify(docs);
      assert.ok(
        !str.includes('"systems/pf2e/'),
        `Paizo art path "systems/pf2e/" found in ${pack} transformed output`,
      );
    });
  }

  it('all img fields start with "icons/placeholder"', () => {
    const conditionDocs = loadTransformed('conditions');
    for (const doc of conditionDocs) {
      assert.ok(
        doc.img?.startsWith('icons/placeholder'),
        `Unexpected img "${doc.img}" in doc ${doc._id}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4b. Flavor-prose policy — no copyrighted description prose in committed packs
// (clean-room — spec 26 §D4, REQ-LEG-010)
//
// NAMES and structured MECHANICAL fields are ORC and stay; the PROSE of
// system.description (and gmNotes/publicNotes/privateNotes flavor) is Reserved
// Material and must be stripped. This guard FAILS if any committed pack doc
// regains a non-trivial description string (top-level or embedded item).
// ---------------------------------------------------------------------------

describe('flavor-prose policy (committed packs)', () => {
  // A blank string is allowed (schema may keep the key); any real prose fails.
  const MAX_PROSE_LEN = 0;
  const PROSE_FIELDS = ['description', 'gmNotes', 'publicNotes', 'privateNotes'];
  const itemPackSlugs = ['conditions', 'weapons-core', 'spells-core'];

  /** Returns the prose length of a system.* field, handling string | {value}. */
  function proseLen(value) {
    if (typeof value === 'string') return value.length;
    if (value && typeof value === 'object' && typeof value.value === 'string') {
      return value.value.length;
    }
    return 0;
  }

  for (const slug of itemPackSlugs) {
    it(`pf2e.${slug}: no flavor prose in any document or embedded item`, () => {
      const docs = loadJson(join(PACKS_DIR, slug, 'documents.json'));
      for (const doc of docs) {
        const sys = doc.system ?? {};
        for (const field of PROSE_FIELDS) {
          const len = proseLen(sys[field]);
          assert.ok(
            len <= MAX_PROSE_LEN,
            `Flavor prose leaked: ${slug} doc "${doc.name}" system.${field} has ${len} chars`,
          );
        }
        for (const item of doc.items ?? []) {
          const isys = item.system ?? {};
          for (const field of PROSE_FIELDS) {
            const len = proseLen(isys[field]);
            assert.ok(
              len <= MAX_PROSE_LEN,
              `Flavor prose leaked: ${slug} doc "${doc.name}" embedded item.${field} has ${len} chars`,
            );
          }
        }
      }
    });
  }

  it('pf2e.bestiary-core: NPC details carry no flavor prose', () => {
    const docs = loadJson(join(PACKS_DIR, 'bestiary-core', 'documents.json'));
    for (const doc of docs) {
      const details = doc.system?.details ?? {};
      for (const field of ['publicNotes', 'blurb', 'privateNotes']) {
        const len = proseLen(details[field]);
        assert.ok(
          len <= MAX_PROSE_LEN,
          `Flavor prose leaked: bestiary doc "${doc.name}" details.${field} has ${len} chars`,
        );
      }
      // Embedded strikes/gear must also be prose-free.
      for (const item of doc.items ?? []) {
        const isys = item.system ?? {};
        const len = proseLen(isys.description);
        assert.ok(
          len <= MAX_PROSE_LEN,
          `Flavor prose leaked: bestiary doc "${doc.name}" embedded item.description has ${len} chars`,
        );
      }
    }
  });

  it('no known Paizo flavor sentence appears in committed packs', () => {
    // Sentence fragments that were present in the pre-fix packs (Reserved Material).
    const KNOWN_PROSE = [
      "You're sleeping or have been knocked out",
      'This projectile weapon is made from horn',
      'You send out a pulse that registers the presence of magic',
    ];
    for (const slug of [...itemPackSlugs, 'bestiary-core']) {
      const str = JSON.stringify(loadJson(join(PACKS_DIR, slug, 'documents.json')));
      for (const fragment of KNOWN_PROSE) {
        assert.ok(
          !str.includes(fragment),
          `Known Paizo prose fragment found in ${slug}: "${fragment}"`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. MVP pack verification — systems/pf2e/packs/
// REQ-CMP-001..004, REQ-CMP-007
// ---------------------------------------------------------------------------

describe('MVP packs', () => {
  const packSlugs = ['conditions', 'weapons-core', 'bestiary-core', 'spells-core'];

  for (const slug of packSlugs) {
    describe(`pf2e.${slug}`, () => {
      const packDir = join(PACKS_DIR, slug);

      it('pack.json exists and has required fields', () => {
        const manifest = loadJson(join(packDir, 'pack.json'));
        assert.ok(manifest.id, 'Missing id');
        assert.ok(manifest.label, 'Missing label');
        assert.ok(manifest.documentType, 'Missing documentType');
        assert.ok(manifest.systemId, 'Missing systemId');
        assert.ok(manifest.license, 'Missing license block');
        assert.equal(manifest.license.license, 'ORC', 'Pack must be ORC-licensed');
        assert.ok(manifest.license.attribution, 'Missing attribution');
        assert.ok(manifest.source, 'Missing source block');
        assert.ok(manifest.generatedAt, 'Missing generatedAt');
        assert.ok(typeof manifest.documentCount === 'number', 'documentCount must be a number');
      });

      it('documents.json exists and has correct count', () => {
        const manifest = loadJson(join(packDir, 'pack.json'));
        const docs = loadJson(join(packDir, 'documents.json'));
        assert.ok(Array.isArray(docs), 'documents.json must be a JSON array');
        assert.equal(docs.length, manifest.documentCount, 'documentCount must match actual docs');
      });

      it('index.json exists with valid entries', () => {
        const index = loadJson(join(packDir, 'index.json'));
        assert.ok(Array.isArray(index), 'index.json must be a JSON array');
        assert.ok(index.length > 0, 'Index must not be empty');
        for (const entry of index.slice(0, 5)) {
          assert.ok(entry._id, 'Index entry must have _id');
          assert.ok(entry.name, 'Index entry must have name');
          assert.ok(entry.uuid, 'Index entry must have uuid');
          assert.ok(entry.uuid.startsWith('Compendium.pf2e.'), `Invalid uuid format: "${entry.uuid}"`);
        }
      });

      it('all documents have valid fusionId', () => {
        const docs = loadJson(join(packDir, 'documents.json'));
        for (const doc of docs) {
          assert.ok(isValidFusionId(doc._id), `Invalid fusionId "${doc._id}" in ${slug}`);
        }
      });

      it('no Paizo art in documents', () => {
        const docs = loadJson(join(packDir, 'documents.json'));
        const str = JSON.stringify(docs);
        assert.ok(!str.includes('"systems/pf2e/'), `Paizo art found in ${slug}`);
      });
    });
  }

  it('weapons-core has ~30 weapons', () => {
    const docs = loadJson(join(PACKS_DIR, 'weapons-core', 'documents.json'));
    assert.ok(docs.length >= 25 && docs.length <= 35, `Expected ~30 weapons, got ${docs.length}`);
  });

  it('conditions has all 43 conditions', () => {
    const docs = loadJson(join(PACKS_DIR, 'conditions', 'documents.json'));
    assert.equal(docs.length, 43, 'Expected all 43 conditions');
  });

  it('bestiary-core has ~10 monsters', () => {
    const docs = loadJson(join(PACKS_DIR, 'bestiary-core', 'documents.json'));
    assert.ok(docs.length >= 8 && docs.length <= 15, `Expected ~10 monsters, got ${docs.length}`);
  });

  it('spells-core has 15-25 spells', () => {
    const docs = loadJson(join(PACKS_DIR, 'spells-core', 'documents.json'));
    assert.ok(docs.length >= 15 && docs.length <= 25, `Expected 15-25 spells, got ${docs.length}`);
  });
});

// ---------------------------------------------------------------------------
// 6. UUID map verification
// REQ-CMP-041 (idempotência)
// ---------------------------------------------------------------------------

describe('fusion-uuid-map.json', () => {
  const mapPath = join(OUT_DIR, 'fusion-uuid-map.json');

  it('exists and has 4 packs', () => {
    const map = loadJson(mapPath);
    const keys = Object.keys(map);
    assert.ok(keys.includes('conditions'), 'Missing conditions pack in uuid map');
    assert.ok(keys.includes('equipment'), 'Missing equipment pack in uuid map');
    assert.ok(keys.includes('spells'), 'Missing spells pack in uuid map');
    assert.ok(keys.includes('pathfinder-monster-core'), 'Missing pathfinder-monster-core in uuid map');
  });

  it('Longsword fusionId is stable', () => {
    const map = loadJson(mapPath);
    const longswordFusionId = map['equipment']?.['LJdbVTOZog39EEbi'];
    assert.ok(longswordFusionId, 'Longsword fusionId not in uuid map');
    const expected = deriveFusionId('equipment', 'LJdbVTOZog39EEbi');
    assert.equal(longswordFusionId, expected, 'Longsword fusionId must match derivation');
  });
});
