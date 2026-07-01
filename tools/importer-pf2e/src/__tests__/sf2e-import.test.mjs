/**
 * sf2e-import.test.mjs — Testes do pipeline de importação SF2E → Fusion (M4).
 *
 * Mirrors transform.test.mjs's structure/guards for the sf2e system
 * selection (--system sf2e). Verifies:
 *   1. fusionId determinístico e sem colisão cross-system (mesmo pf2eId/pack
 *      name usado em pf2e e sf2e nunca produz o mesmo fusionId — REQ-SF2-048).
 *   2. Packs commitados em systems/sf2e/packs/ têm estrutura válida
 *      (pack.json, documents.json, index.json).
 *   3. Nenhuma arte Paizo (systems/pf2e/ ou systems/sf2e/) nos packs commitados.
 *   4. Nenhuma prosa de flavor (description/gmNotes/publicNotes/privateNotes)
 *      nos packs commitados — mesma política de clean-room do pf2e
 *      (spec 26 §D4, REQ-LEG-010) espelhada para sf2e.
 *   5. Traits SF-exclusivos (robot, tech, analog, etc.) presentes no
 *      bestiário/armas curados — confirma que o importer não rejeita
 *      traits desconhecidos (REQ-SF2-047).
 *   6. Deltas mecânicos SF2e (grade/ammo/charges de tech weapons, augType de
 *      augmentações) sobrevivem ao transform.
 *
 * Execução:
 *   node --test src/__tests__/sf2e-import.test.mjs
 *
 * Pré-requisito: rodar (nesta ordem) a partir de tools/importer-pf2e/:
 *   node src/extract.mjs --system sf2e
 *   node src/normalize.mjs --system sf2e --skip-extract
 *   node src/transform.mjs --system sf2e
 *   node src/build-mvp-subset.mjs --system sf2e
 *
 * REQ-SF2-044..048. Refs: analysis/04-sf2e-disponibilidade.md,
 * analysis/08-sf2e-import.md, specs/18-sistema-sf2e.md.
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
const SF2E_OUT_DIR = join(OUT_DIR, 'sf2e');
const SF2E_PACKS_DIR = join(IMPORTER_ROOT, '..', '..', 'systems', 'sf2e', 'packs');

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

function deriveFusionId(packName, sourceId) {
  const input = `${packName}:${sourceId}`;
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

function loadSf2eTransformed(packName) {
  return loadJson(join(SF2E_OUT_DIR, packName, 'transformed.json'));
}

/** Returns the prose length of a system.* field, handling string | {value}. */
function proseLen(value) {
  if (typeof value === 'string') return value.length;
  if (value && typeof value === 'object' && typeof value.value === 'string') {
    return value.value.length;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// 1. fusionId — namespacing keeps sf2e distinct from pf2e (REQ-SF2-048)
// ---------------------------------------------------------------------------

describe('sf2e fusionId derivation is namespaced away from pf2e', () => {
  it('sf2e:equipment namespace differs from pf2e equipment namespace for the same sourceId', () => {
    // Arc Rifle's sf2e sourceId happens to differ from any pf2e weapon id in
    // practice, but the namespacing must hold even in the adversarial case
    // where the same literal sourceId string is reused across systems.
    const sharedSourceId = 'LJdbVTOZog39EEbi'; // pf2e Longsword's real id, reused hypothetically
    const pf2eFusionId = deriveFusionId('equipment', sharedSourceId);
    const sf2eFusionId = deriveFusionId('sf2e:equipment', sharedSourceId);
    assert.notEqual(pf2eFusionId, sf2eFusionId, 'sf2e and pf2e fusionIds must never collide for the same pack name + sourceId');
  });

  it('is deterministic across runs', () => {
    const a = deriveFusionId('sf2e:equipment', 'TAgaAiDMPGnF87Vv');
    const b = deriveFusionId('sf2e:equipment', 'TAgaAiDMPGnF87Vv');
    assert.equal(a, b);
  });
});

// ---------------------------------------------------------------------------
// 2. Transformed output (out/sf2e/**) — structural checks, mirrors pf2e's
// ---------------------------------------------------------------------------

describe('sf2e weapon transform (Arc Rifle — tech weapon delta)', () => {
  const getArcRifle = () => {
    const docs = loadSf2eTransformed('equipment');
    return docs.find(d => d.name === 'Arc Rifle' && d.type === 'weapon');
  };

  it('Arc Rifle is in transformed sf2e equipment', () => {
    assert.ok(getArcRifle(), 'Arc Rifle not found in out/sf2e/equipment/transformed.json');
  });

  it('has valid fusionId matching the sf2e-namespaced derivation', () => {
    const doc = getArcRifle();
    assert.ok(isValidFusionId(doc._id));
    const expected = deriveFusionId('sf2e:equipment', doc.flags.fusion.sourceId);
    assert.equal(doc._id, expected);
  });

  it('preserves the D-SF2-02 tech weapon delta (grade, ammo, charges, expend)', () => {
    const doc = getArcRifle();
    assert.equal(doc.system.grade, 'commercial', 'Expected grade "commercial"');
    assert.ok(doc.system.ammo, 'Missing ammo block');
    assert.equal(doc.system.ammo.baseType, 'battery');
    assert.equal(doc.system.expend, 2);
    assert.ok(doc.system.traits.value.includes('tech'), 'Expected "tech" trait');
  });

  it('img points to placeholder, not Paizo/sf2e art', () => {
    const doc = getArcRifle();
    assert.ok(doc.img.startsWith('icons/placeholder'));
    assert.ok(!doc.img.includes('systems/sf2e'));
    assert.ok(!doc.img.includes('systems/pf2e'));
  });
});

describe('sf2e augmentation transform (D-SF2-03)', () => {
  const getAugmentations = () => {
    const docs = loadSf2eTransformed('equipment');
    return docs.filter(d => d.type === 'equipment' && d.system?.usage === 'implanted');
  };

  it('augmentations are detected via usage:"implanted" (real data has no dedicated type)', () => {
    const augs = getAugmentations();
    assert.ok(augs.length > 0, 'Expected at least one implanted-usage equipment doc');
  });

  it('augType is backfilled from the category trait when present', () => {
    const augs = getAugmentations();
    const withCategory = augs.filter(a => ['apex', 'biotech', 'magitech', 'necrograft', 'tech'].some(t => a.system.traits.value.includes(t)));
    for (const a of withCategory) {
      assert.ok(a.system.augType, `Expected augType backfilled for "${a.name}"`);
    }
  });
});

describe('sf2e conditions transform (glitching/suppressed/untethered — type "effect")', () => {
  const getConditions = () => loadSf2eTransformed('conditions');

  it('all 3 sf2e-exclusive conditions are transformed', () => {
    assert.equal(getConditions().length, 3);
  });

  it('every doc is type "effect" (real data shape, not "condition")', () => {
    for (const doc of getConditions()) {
      assert.equal(doc.type, 'effect', `Expected type "effect" for "${doc.name}"`);
    }
  });

  it('Suppressed has its two FlatModifiers converted', () => {
    const suppressed = getConditions().find(d => d.name === 'Suppressed');
    assert.ok(suppressed);
    const flatMods = suppressed.system.rules.filter(r => r.kind === 'flat-modifier');
    assert.equal(flatMods.length, 2);
    const attack = flatMods.find(m => m.selector === 'attack');
    assert.equal(attack.value, -1);
    const speed = flatMods.find(m => m.selector === 'all-speeds');
    assert.equal(speed.value, -10);
  });

  it('Untethered grants the Push Off action', () => {
    const untethered = getConditions().find(d => d.name === 'Untethered');
    assert.ok(untethered);
    const grant = untethered.system.rules.find(r => r.kind === 'grant-item');
    assert.ok(grant, 'Expected a grant-item rule');
    assert.ok(grant.uuid.includes('Push Off'));
  });
});

// ---------------------------------------------------------------------------
// 3. Committed packs — systems/sf2e/packs/
// ---------------------------------------------------------------------------

describe('sf2e MVP packs (systems/sf2e/packs/)', () => {
  const packSlugs = ['conditions', 'weapons-core', 'armor-core', 'augmentations-core', 'bestiary-core', 'spells-core'];

  for (const slug of packSlugs) {
    describe(`sf2e.${slug}`, () => {
      const packDir = join(SF2E_PACKS_DIR, slug);

      it('pack.json exists with required fields and ORC license', () => {
        const manifest = loadJson(join(packDir, 'pack.json'));
        assert.ok(manifest.id, 'Missing id');
        assert.equal(manifest.systemId, 'sf2e');
        assert.ok(manifest.license, 'Missing license block');
        assert.equal(manifest.license.license, 'ORC', 'Pack must be ORC-licensed');
        assert.ok(manifest.license.attribution, 'Missing attribution');
        assert.ok(typeof manifest.documentCount === 'number');
      });

      it('documents.json exists and count matches manifest', () => {
        const manifest = loadJson(join(packDir, 'pack.json'));
        const docs = loadJson(join(packDir, 'documents.json'));
        assert.ok(Array.isArray(docs));
        assert.equal(docs.length, manifest.documentCount);
      });

      it('index.json exists with valid entries', () => {
        const index = loadJson(join(packDir, 'index.json'));
        assert.ok(Array.isArray(index));
        assert.ok(index.length > 0, 'Index must not be empty');
        for (const entry of index.slice(0, 5)) {
          assert.ok(entry._id);
          assert.ok(entry.name);
          assert.ok(entry.uuid.startsWith('Compendium.sf2e.'), `Invalid uuid format: "${entry.uuid}"`);
        }
      });

      it('all documents have valid fusionId', () => {
        const docs = loadJson(join(packDir, 'documents.json'));
        for (const doc of docs) {
          assert.ok(isValidFusionId(doc._id), `Invalid fusionId "${doc._id}" in ${slug}`);
        }
      });

      it('no Paizo/sf2e proprietary art in documents', () => {
        const docs = loadJson(join(packDir, 'documents.json'));
        const str = JSON.stringify(docs);
        assert.ok(!str.includes('"systems/sf2e/'), `Paizo sf2e art found in ${slug}`);
        assert.ok(!str.includes('"systems/pf2e/'), `Paizo pf2e art found in ${slug}`);
      });
    });
  }

  it('conditions has exactly the 3 sf2e-exclusive conditions', () => {
    const docs = loadJson(join(SF2E_PACKS_DIR, 'conditions', 'documents.json'));
    assert.equal(docs.length, 3);
  });

  it('weapons-core is a modest curated subset (10-30 weapons)', () => {
    const docs = loadJson(join(SF2E_PACKS_DIR, 'weapons-core', 'documents.json'));
    assert.ok(docs.length >= 10 && docs.length <= 30, `Expected 10-30 weapons, got ${docs.length}`);
  });

  it('bestiary-core is a modest curated subset (8-15 creatures)', () => {
    const docs = loadJson(join(SF2E_PACKS_DIR, 'bestiary-core', 'documents.json'));
    assert.ok(docs.length >= 8 && docs.length <= 15, `Expected 8-15 creatures, got ${docs.length}`);
  });
});

// ---------------------------------------------------------------------------
// 4. Flavor-prose policy (clean-room, mirrors pf2e's guard) — REQ-LEG-010
// ---------------------------------------------------------------------------

describe('sf2e flavor-prose policy (committed packs)', () => {
  const MAX_PROSE_LEN = 0;
  const PROSE_FIELDS = ['description', 'gmNotes', 'publicNotes', 'privateNotes'];
  const itemPackSlugs = ['conditions', 'weapons-core', 'armor-core', 'augmentations-core', 'spells-core'];

  for (const slug of itemPackSlugs) {
    it(`sf2e.${slug}: no flavor prose in any document or embedded item`, () => {
      const docs = loadJson(join(SF2E_PACKS_DIR, slug, 'documents.json'));
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

  it('sf2e.bestiary-core: NPC details carry no flavor prose', () => {
    const docs = loadJson(join(SF2E_PACKS_DIR, 'bestiary-core', 'documents.json'));
    for (const doc of docs) {
      const details = doc.system?.details ?? {};
      for (const field of ['publicNotes', 'blurb', 'privateNotes']) {
        const len = proseLen(details[field]);
        assert.ok(
          len <= MAX_PROSE_LEN,
          `Flavor prose leaked: bestiary doc "${doc.name}" details.${field} has ${len} chars`,
        );
      }
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

  it('no known Paizo/sf2e flavor sentence appears in committed packs', () => {
    // Sentence fragments from real sf2e descriptions the importer must strip.
    const KNOWN_PROSE = [
      "you're in a zero gravity",
      'This rifle’s oversized body',
      'automatically tracks a database of associated names',
    ];
    for (const slug of [...itemPackSlugs, 'bestiary-core']) {
      const str = JSON.stringify(loadJson(join(SF2E_PACKS_DIR, slug, 'documents.json'))).toLowerCase();
      for (const fragment of KNOWN_PROSE) {
        assert.ok(
          !str.includes(fragment.toLowerCase()),
          `Known Paizo/sf2e prose fragment found in ${slug}: "${fragment}"`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. SF-exclusive trait coverage (REQ-SF2-047) — importer never rejects them
// ---------------------------------------------------------------------------

describe('SF2e-exclusive trait allowlist coverage', () => {
  it('curated bestiary-core includes creatures with "robot" and "tech" traits', () => {
    const docs = loadJson(join(SF2E_PACKS_DIR, 'bestiary-core', 'documents.json'));
    const allTraits = new Set(docs.flatMap(d => d.system?.traits?.value ?? []));
    assert.ok(allTraits.has('robot'), 'Expected at least one creature with the "robot" trait');
    assert.ok(allTraits.has('tech'), 'Expected at least one creature with the "tech" trait');
  });

  it('curated weapons-core includes both "tech" and "analog" weapons', () => {
    const docs = loadJson(join(SF2E_PACKS_DIR, 'weapons-core', 'documents.json'));
    const hasTech = docs.some(d => d.system.traits.value.includes('tech'));
    const hasAnalog = docs.some(d => d.system.traits.value.includes('analog'));
    assert.ok(hasTech, 'Expected at least one weapon with the "tech" trait');
    assert.ok(hasAnalog, 'Expected at least one weapon with the "analog" trait');
  });

  it('curated weapons-core includes at least one "automatic" or area-trait weapon', () => {
    const docs = loadJson(join(SF2E_PACKS_DIR, 'weapons-core', 'documents.json'));
    const hasAutomaticOrArea = docs.some(d =>
      d.system.traits.value.includes('automatic') ||
      d.system.traits.value.some(t => t.startsWith('area-')),
    );
    assert.ok(hasAutomaticOrArea, 'Expected at least one weapon with "automatic" or an "area-*" trait');
  });
});

// ---------------------------------------------------------------------------
// 6. UUID map verification (sf2e-namespaced, separate from pf2e's map)
// ---------------------------------------------------------------------------

describe('sf2e fusion-uuid-map.json', () => {
  const mapPath = join(SF2E_OUT_DIR, 'fusion-uuid-map.json');

  it('exists and includes the packs used for the MVP subset', () => {
    const map = loadJson(mapPath);
    const keys = Object.keys(map);
    assert.ok(keys.includes('conditions'));
    assert.ok(keys.includes('equipment'));
  });

  it('Arc Rifle fusionId is stable and sf2e-namespaced', () => {
    const map = loadJson(mapPath);
    const arcRifleFusionId = map['equipment']?.['TAgaAiDMPGnF87Vv'];
    assert.ok(arcRifleFusionId, 'Arc Rifle fusionId not in sf2e uuid map');
    const expected = deriveFusionId('sf2e:equipment', 'TAgaAiDMPGnF87Vv');
    assert.equal(arcRifleFusionId, expected);
  });
});
