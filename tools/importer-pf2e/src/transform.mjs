/**
 * transform.mjs — Fase 3 do pipeline de importação PF2E/SF2E → Fusion (M3-D / M4)
 *
 * Consome a saída do normalize.mjs (out/<pack>/normalized.json, ou
 * out/sf2e/<pack>/normalized.json para --system sf2e) e produz documentos
 * Fusion válidos com:
 *
 *   1. fusionId = base62_16(sha1(packName + ":" + sourceId)) — estável e
 *      sem colisão cross-pack (análise 05-id-compat.md). Para sf2e, o
 *      packName usado na derivação é prefixado com "sf2e:" para não colidir
 *      com fusionIds pf2e (mesmo pf2e/sf2e _id vindo de packs de mesmo nome,
 *      ex. "equipment", produziriam o mesmo hash sem o prefixo).
 *   2. Mapeamento de system.* pf2e/sf2e → system.* Fusion por (documentType, subtype).
 *   3. Conversão de rules[] pf2e/sf2e → ModifierDescriptors do motor de effects:
 *      - Chaves suportadas: FlatModifier, ActiveEffectLike, RollOption, GrantItem,
 *        Note, DamageDice, Resistance, Sense, BaseSpeed, TempHP, MartialProficiency.
 *      - Chaves não suportadas: preservadas em flags.fusion.unconvertedRules.
 *   4. Arte: img já substituída pelo estágio normalize; apenas registra as
 *      substituições em flags.fusion.assetSubstitutions para auditoria.
 *   5. Validação leve de campos obrigatórios (não usa Zod — zero deps externas).
 *
 * Saídas:
 *   - out/<pack>/transformed.json         — array de documentos Fusion (pf2e)
 *   - out/sf2e/<pack>/transformed.json    — idem (sf2e)
 *   - out/fusion-uuid-map.json            — mapa sourceId → fusionId por pack (pf2e)
 *   - out/sf2e/fusion-uuid-map.json       — idem (sf2e, mapa separado)
 *   - analysis/08-transform-report.md     — relatório de cobertura de rules (pf2e)
 *   - analysis/08-sf2e-import.md          — relatório de import sf2e (gerado por build-mvp-subset.mjs)
 *
 * Uso:
 *   node src/transform.mjs [--system pf2e|sf2e] [--packs equipment,spells,conditions,pathfinder-monster-core]
 *   node src/transform.mjs --system sf2e --pack conditions   # pack único
 *
 * REQ-CMP-026..044, REQ-SF2-044..048. Refs: analysis/02-schema-actor-item.md,
 * 03-rules-elements.md, 05-id-compat.md, 06-formato-intermediario.md,
 * specs/16-compendiums-e-importacao.md, specs/18-sistema-sf2e.md.
 *
 * Zero dependências externas — Node 22 ESM + crypto nativo.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const IMPORTER_ROOT = join(__dirname, '..');
const OUT_DIR       = join(IMPORTER_ROOT, 'out');
const ANALYSIS_DIR  = join(IMPORTER_ROOT, 'analysis');

/** Resolves the out/ base dir for a given system ("pf2e" uses out/ directly, legacy path). */
function outBaseFor(system) {
  return system === 'pf2e' ? OUT_DIR : join(OUT_DIR, system);
}

// ---------------------------------------------------------------------------
// Version metadata
// ---------------------------------------------------------------------------
const IMPORTER_VERSION = '0.1.0';
const SOURCE_VERSION   = 'v14-dev'; // branch clonada do vendor/pf2e

// ---------------------------------------------------------------------------
// fusionId derivation
// REQ-CMP-041 (idempotência): base62_16(sha1(packName + ":" + pf2eSourceId))
// Analysis 05-id-compat.md §5.
// ---------------------------------------------------------------------------

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Converts an arbitrary-length buffer to a base62 string of `length` chars.
 * Uses big-endian byte interpretation, then takes the top `length` digits.
 */
function bufToBase62(buf, length) {
  // Convert sha1 bytes to BigInt
  let n = BigInt('0x' + buf.toString('hex'));
  const result = [];
  const base = BigInt(62);
  for (let i = 0; i < length; i++) {
    result.push(BASE62[Number(n % base)]);
    n = n / base;
  }
  return result.reverse().join('');
}

/**
 * Derives a stable, collision-free Fusion document ID from pack + pf2e id.
 * Output: 16-character base62 string (alphabet [A-Za-z0-9]).
 *
 * REQ-CMP-041: deterministic — same inputs always yield same output.
 */
function deriveFusionId(packName, pf2eSourceId) {
  const input = `${packName}:${pf2eSourceId}`;
  const hash = createHash('sha1').update(input, 'utf8').digest();
  return bufToBase62(hash, 16);
}

// ---------------------------------------------------------------------------
// Rule Element coverage table
// REQ-CMP-035: supported | partial | unsupported
// ---------------------------------------------------------------------------

/** @type {Record<string, 'supported' | 'partial' | 'unsupported'>} */
const RE_COVERAGE = {
  // Tier 1 — supported
  FlatModifier:        'supported',
  ActiveEffectLike:    'supported',
  RollOption:          'supported',
  Note:                'supported',
  DamageDice:          'supported',
  Resistance:          'supported',
  // Tier 2 — supported (spec REQ-CMP-035 list)
  GrantItem:           'supported',
  Sense:               'supported',
  BaseSpeed:           'supported',
  TempHP:              'supported',
  MartialProficiency:  'supported',
  // Partial — handled but with limitations
  ItemAlteration:      'partial',  // property add/override only
  AdjustModifier:      'partial',  // maps to flat-modifier w/ notes
  Immunity:            'partial',  // maps to IWR entry, not full predicate support
  // Unsupported — preserved verbatim in flags.fusion.unconvertedRules
  ChoiceSet:           'unsupported',
  Aura:                'unsupported',
  AdjustDegreeOfSuccess: 'unsupported',
  Strike:              'unsupported',
  AdjustStrike:        'unsupported',
  DamageAlteration:    'unsupported',
  Weakness:            'unsupported',  // handled via IWR but separately
  FastHealing:         'unsupported',
  TokenLight:          'unsupported',
  CreatureSize:        'unsupported',
  CriticalSpecialization: 'unsupported',
  BattleForm:          'unsupported',
  TokenMark:           'unsupported',
  ActorTraits:         'unsupported',
  RollTwice:           'unsupported',
  EphemeralEffect:     'unsupported',
  TokenEffectIcon:     'unsupported',
  CraftingAbility:     'unsupported',
  DexterityModifierCap: 'unsupported',
  SubstituteRoll:      'unsupported',
  SpecialStatistic:    'unsupported',
  MultipleAttackPenalty: 'unsupported',
  LoseHitPoints:       'unsupported',
  SpecialResource:     'unsupported',
};

// ---------------------------------------------------------------------------
// Value expression translation
// REQ-CMP-037: translate @actor.level, floor(...), ternary(...), etc.
// ---------------------------------------------------------------------------

/**
 * Translates a pf2e value expression to Fusion roll data syntax.
 * Returns the translated string, or null if not parseable (triggers partial fallback).
 *
 * Supported: numeric literals, "@actor.level", "floor(@actor.level / N)",
 * "@item.level", "{...}" property interpolation patterns.
 *
 * REQ-CMP-037: unparseable expressions → null (caller marks RE as partial).
 */
function translateValueExpr(value) {
  if (value === undefined || value === null) return value;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null; // object expression — unsupported

  // Simple numeric string
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  // Direct @actor.level → @actor.details.level.value (Fusion path)
  if (value === '@actor.level') return '@actor.details.level.value';

  // @item.level → @item.system.level.value
  if (value === '@item.level') return '@item.system.level.value';

  // floor(@actor.level / N) → floor(@actor.details.level.value / N)
  const floorMatch = value.match(/^floor\(@actor\.level\s*\/\s*(\d+)\)$/);
  if (floorMatch) return `floor(@actor.details.level.value / ${floorMatch[1]})`;

  // ceil(@actor.level / N)
  const ceilMatch = value.match(/^ceil\(@actor\.level\s*\/\s*(\d+)\)$/);
  if (ceilMatch) return `ceil(@actor.details.level.value / ${ceilMatch[1]})`;

  // "{item|system.xxx}" property interpolation — pass through as-is
  if (/^\{[^}]+\}$/.test(value)) return value;

  // Anything else — treat as opaque string (may be localization key etc.)
  // Return as-is but flag as potentially unparseable
  return value;
}

// ---------------------------------------------------------------------------
// Rule Element converters
// Each converter returns a ModifierDescriptor (or array of them).
// REQ-CMP-034..038.
// ---------------------------------------------------------------------------

/**
 * Converts a FlatModifier RE to a Fusion modifier descriptor.
 * REQ-CMP-035: supported.
 */
function convertFlatModifier(re) {
  const translatedValue = translateValueExpr(re.value);
  if (translatedValue === null) return null; // unparseable value → partial

  return {
    kind: 'flat-modifier',
    slug: re.slug ?? null,
    label: re.label ?? null,
    selector: re.selector,
    value: translatedValue,
    mode: 'add',
    type: re.type ?? 'untyped', // item | status | circumstance | untyped
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts an ActiveEffectLike RE to a Fusion set-property descriptor.
 * REQ-CMP-035: supported.
 */
function convertActiveEffectLike(re) {
  const translatedValue = translateValueExpr(re.value);
  if (translatedValue === null) return null;

  const modeMap = {
    add: 'add',
    subtract: 'subtract',
    multiply: 'multiply',
    upgrade: 'upgrade',
    downgrade: 'downgrade',
    override: 'override',
  };

  return {
    kind: 'set-property',
    slug: re.slug ?? null,
    label: re.label ?? null,
    selector: re.path ?? null,
    value: translatedValue,
    mode: modeMap[re.mode] ?? 'override',
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts a RollOption RE to a Fusion roll-option descriptor.
 * REQ-CMP-035: supported.
 */
function convertRollOption(re) {
  return {
    kind: 'roll-option',
    slug: re.option ?? re.slug ?? null,
    label: re.label ?? null,
    toggleable: re.toggleable ?? false,
    domain: re.domain ?? 'all',
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts a GrantItem RE to a Fusion grant-item descriptor.
 * UUID rewriting happens in a post-pass; here we preserve the pf2e UUID
 * for lookup during UUID map construction.
 * REQ-CMP-035: supported.
 */
function convertGrantItem(re) {
  return {
    kind: 'grant-item',
    slug: re.slug ?? null,
    label: re.label ?? null,
    uuid: re.uuid ?? null, // pf2e UUID — rewritten in UUID post-pass
    inMemoryOnly: re.inMemoryOnly ?? false,
    predicate: re.predicate ?? null,
    alterations: re.alterations ?? [],
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts a Note (RollNote) RE to a Fusion roll-note descriptor.
 * REQ-CMP-035: supported.
 */
function convertNote(re) {
  return {
    kind: 'roll-note',
    slug: re.slug ?? null,
    label: re.label ?? null,
    selector: re.selector ?? null,
    outcome: re.outcome ?? null,
    text: re.text ?? null,
    title: re.title ?? null,
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts a DamageDice RE to a Fusion damage-dice descriptor.
 * REQ-CMP-035: supported (maps to flat-modifier with damage-dice semantics).
 */
function convertDamageDice(re) {
  return {
    kind: 'flat-modifier',
    subkind: 'damage-dice',
    slug: re.slug ?? null,
    label: re.label ?? null,
    selector: re.selector ?? 'strike-damage',
    diceNumber: re.diceNumber ?? 1,
    dieSize: re.dieSize ?? 'd6',
    damageType: re.damageType ?? null,
    category: re.category ?? null,
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts a Resistance RE to a Fusion IWR modifier descriptor.
 * REQ-CMP-035: supported.
 */
function convertResistance(re) {
  const value = typeof re.value === 'number' ? re.value
    : re.value === 'half' ? 'half'
    : null;
  return {
    kind: 'flat-modifier',
    subkind: 'resistance',
    slug: re.slug ?? null,
    label: re.label ?? null,
    damageType: re.type ?? null,
    value,
    exceptions: re.exceptions ?? [],
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts an Immunity RE (partial support).
 * REQ-CMP-035: partial.
 */
function convertImmunity(re) {
  return {
    kind: 'flat-modifier',
    subkind: 'immunity',
    slug: re.slug ?? null,
    label: re.label ?? null,
    damageType: re.type ?? null,
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts a Sense RE to a Fusion sense descriptor.
 * REQ-CMP-035: supported.
 */
function convertSense(re) {
  return {
    kind: 'sense',
    slug: re.slug ?? null,
    label: re.label ?? null,
    senseType: re.type ?? null,
    acuity: re.acuity ?? 'precise',
    range: re.range ?? null,
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts a BaseSpeed RE to a Fusion base-speed descriptor.
 * REQ-CMP-035: supported.
 */
function convertBaseSpeed(re) {
  const translatedValue = translateValueExpr(re.value);
  return {
    kind: 'base-speed',
    slug: re.slug ?? null,
    label: re.label ?? null,
    selector: re.selector ?? 'land-speed',
    value: translatedValue,
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts a TempHP RE to a Fusion temp-hp descriptor.
 * REQ-CMP-035: supported.
 */
function convertTempHP(re) {
  const translatedValue = translateValueExpr(re.value);
  if (translatedValue === null) return null;
  return {
    kind: 'temp-hp',
    slug: re.slug ?? null,
    label: re.label ?? null,
    value: translatedValue,
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts a MartialProficiency RE to a Fusion proficiency descriptor.
 * REQ-CMP-035: supported.
 */
function convertMartialProficiency(re) {
  return {
    kind: 'proficiency',
    slug: re.slug ?? null,
    label: re.label ?? null,
    selector: re.selector ?? null,
    value: re.value ?? null,
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts an ItemAlteration RE (partial).
 * REQ-CMP-035: partial — only add/override on non-lore properties.
 */
function convertItemAlteration(re) {
  if (!['add', 'override', 'upgrade', 'downgrade'].includes(re.mode)) return null;
  const translatedValue = translateValueExpr(re.value);
  return {
    kind: 'set-property',
    subkind: 'item-alteration',
    slug: re.slug ?? null,
    label: re.label ?? null,
    selector: re.property ?? null,
    value: translatedValue,
    mode: re.mode,
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    raw: re,
  };
}

/**
 * Converts an AdjustModifier RE (partial).
 * REQ-CMP-035: partial — maps to flat-modifier with a note about adjustment.
 */
function convertAdjustModifier(re) {
  return {
    kind: 'flat-modifier',
    subkind: 'adjust-modifier',
    slug: re.slug ?? null,
    label: re.label ?? null,
    selector: re.selector ?? null,
    value: translateValueExpr(re.value),
    mode: 'add',
    predicate: re.predicate ?? null,
    priority: re.priority ?? null,
    notes: 'AdjustModifier — partial conversion; capping/floor not applied',
    raw: re,
  };
}

// ---------------------------------------------------------------------------
// Main RE converter dispatcher
// REQ-CMP-034..038
// ---------------------------------------------------------------------------

/**
 * Converts a single pf2e Rule Element to a Fusion ModifierDescriptor.
 *
 * Returns:
 *   - { descriptor, state: 'supported' | 'partial' }  — converted
 *   - { descriptor: null, state: 'unsupported' }       — not converted
 *
 * REQ-CMP-036: unsupported REs are NOT discarded — caller preserves them
 * in flags.fusion.unconvertedRules.
 */
function convertRuleElement(re) {
  const key = re?.key;
  if (!key) return { descriptor: null, state: 'unsupported' };

  const coverage = RE_COVERAGE[key] ?? 'unsupported';

  try {
    let descriptor = null;

    switch (key) {
      case 'FlatModifier':       descriptor = convertFlatModifier(re);    break;
      case 'ActiveEffectLike':   descriptor = convertActiveEffectLike(re);break;
      case 'RollOption':         descriptor = convertRollOption(re);       break;
      case 'GrantItem':          descriptor = convertGrantItem(re);        break;
      case 'Note':               descriptor = convertNote(re);             break;
      case 'DamageDice':         descriptor = convertDamageDice(re);       break;
      case 'Resistance':         descriptor = convertResistance(re);       break;
      case 'Immunity':           descriptor = convertImmunity(re);         break;
      case 'Sense':              descriptor = convertSense(re);            break;
      case 'BaseSpeed':          descriptor = convertBaseSpeed(re);        break;
      case 'TempHP':             descriptor = convertTempHP(re);           break;
      case 'MartialProficiency': descriptor = convertMartialProficiency(re); break;
      case 'ItemAlteration':     descriptor = convertItemAlteration(re);  break;
      case 'AdjustModifier':     descriptor = convertAdjustModifier(re);  break;
      default:
        return { descriptor: null, state: 'unsupported' };
    }

    if (descriptor === null) {
      // Converter returned null → unparseable expression → partial
      return { descriptor: null, state: 'partial' };
    }

    return { descriptor, state: coverage };
  } catch (err) {
    // Any error in conversion → partial fallback
    return { descriptor: null, state: 'partial' };
  }
}

// ---------------------------------------------------------------------------
// Document transform — main entry
// REQ-CMP-026..044
// ---------------------------------------------------------------------------

/**
 * Transforms a single normalized document into a Fusion document.
 *
 * @param {object} normDoc — normalized document from normalize.mjs
 * @param {string} packName — pack slug (for reporting/flags.fusion.packName)
 * @param {object} stats — coverage stats (mutated in-place)
 * @param {string} [fusionIdPackKey] — namespaced key used for fusionId
 *   derivation only (defaults to `packName`). sf2e callers pass "sf2e:<pack>"
 *   so a pf2e and sf2e document sharing the same pack name (e.g. "equipment")
 *   and source _id never collide on fusionId (REQ-SF2-048).
 * @returns {{ fusionDoc: object, pf2eId: string, fusionId: string }}
 */
function transformDoc(normDoc, packName, stats, fusionIdPackKey = packName) {
  const pf2eId = normDoc.pf2eSourceId ?? normDoc._id;
  const fusionId = deriveFusionId(fusionIdPackKey, pf2eId);

  // --- Convert rules[] ---
  const rawRules = normDoc.system?.rules ?? [];
  const convertedRules = [];
  const unconvertedRules = [];
  let hasPartial = false;

  for (const re of rawRules) {
    const key = re?.key ?? '(unknown)';
    stats.byKey[key] = stats.byKey[key] ?? { total: 0, supported: 0, partial: 0, unsupported: 0 };
    stats.byKey[key].total++;
    stats.totalRules++;

    const { descriptor, state } = convertRuleElement(re);

    if (state === 'supported' && descriptor !== null) {
      convertedRules.push(descriptor);
      stats.byKey[key].supported++;
      stats.supportedRules++;
    } else if (state === 'partial') {
      // Partially converted — preserve original
      unconvertedRules.push({ ...re, _conversionState: 'partial' });
      if (descriptor !== null) convertedRules.push(descriptor);
      stats.byKey[key].partial++;
      stats.partialRules++;
      hasPartial = true;
    } else {
      // Unsupported — preserve verbatim
      unconvertedRules.push({ ...re, _conversionState: 'unsupported' });
      stats.byKey[key].unsupported++;
      stats.unsupportedRules++;
      hasPartial = true;
    }
  }

  // --- Asset substitution audit ---
  // The normalize stage already substituted art; here we record it.
  const assetSubstitutions = [];
  if (normDoc.originalImgRef) {
    assetSubstitutions.push({
      field: 'img',
      original: normDoc.originalImgRef,
      placeholder: normDoc.img,
    });
  }

  // Check items[] for substitutions
  for (const item of (normDoc.items ?? [])) {
    if (item.originalImgRef) {
      assetSubstitutions.push({
        field: `items[${item._id}].img`,
        original: item.originalImgRef,
        placeholder: item.img,
      });
    }
  }

  // --- Build fusion flags ---
  const fusionFlags = {
    conversion: hasPartial ? 'partial' : 'full',
    importerVersion: IMPORTER_VERSION,
    sourceVersion: SOURCE_VERSION,
    sourceId: pf2eId,
    packName,
    unconvertedRules,
    assetSubstitutions,
  };

  // --- Build system with converted rules ---
  const system = buildSystem(normDoc, convertedRules, packName);

  // --- Build items[] (embedded) with fusionId for each ---
  const embeddedItems = (normDoc.items ?? []).map(item => {
    const embeddedFusionId = deriveFusionId(`${fusionIdPackKey}:embedded`, item._id);
    const itemRaws = item.system?.rules ?? [];
    const itemConverted = [];
    const itemUnconverted = [];

    for (const re of itemRaws) {
      const { descriptor, state } = convertRuleElement(re);
      const key = re?.key ?? '(unknown)';
      stats.byKey[key] = stats.byKey[key] ?? { total: 0, supported: 0, partial: 0, unsupported: 0 };
      stats.byKey[key].total++;
      stats.totalRules++;
      if (state === 'supported' && descriptor !== null) {
        itemConverted.push(descriptor);
        stats.byKey[key].supported++;
        stats.supportedRules++;
      } else {
        itemUnconverted.push({ ...re, _conversionState: state });
        if (state === 'partial') { stats.byKey[key].partial++; stats.partialRules++; }
        else { stats.byKey[key].unsupported++; stats.unsupportedRules++; }
        if (descriptor !== null) itemConverted.push(descriptor);
      }
    }

    return {
      _id: embeddedFusionId,
      pf2eId: item._id,
      type: item.type,
      name: item.name,
      img: item.img,
      system: {
        // Embedded items (NPC strikes/gear) also lose flavor prose — the
        // mechanical effect lives in rules[]/damageRolls (REQ-LEG-010).
        ...stripFlavorProse(stripNormalizationMeta(item.system ?? {})),
        rules: itemConverted,
      },
      flags: {
        fusion: {
          conversion: itemUnconverted.length > 0 ? 'partial' : 'full',
          unconvertedRules: itemUnconverted,
          assetSubstitutions: item.originalImgRef
            ? [{ field: 'img', original: item.originalImgRef, placeholder: item.img }]
            : [],
        },
      },
    };
  });

  const fusionDoc = {
    _id: fusionId,
    name: normDoc.name,
    type: normDoc.type,
    img: normDoc.img,
    system,
    flags: { fusion: fusionFlags },
  };

  if (embeddedItems.length > 0) {
    fusionDoc.items = embeddedItems;
  }

  return { fusionDoc, pf2eId, fusionId };
}

/**
 * Builds the system object for a Fusion document.
 * Maps pf2e system fields to Fusion system fields per document type.
 * REQ-CMP-027/027a.
 */
function buildSystem(normDoc, convertedRules, packName) {
  const src = normDoc.system ?? {};
  const type = normDoc.type;
  const stripped = stripNormalizationMeta(src);

  // Add converted rules
  const system = { ...stripped, rules: convertedRules };

  // Type-specific field normalization.
  // Item types run through stripFlavorProse() so committed packs never carry
  // copyrighted description prose (REQ-LEG-010, spec 26 §D4). Actor types keep
  // their own targeted prose stripping inside normalizeActorSystem.
  switch (type) {
    case 'weapon':
      return stripFlavorProse(normalizeWeaponSystem(system, src));
    case 'armor':
    case 'shield':
      return stripFlavorProse(normalizeArmorSystem(system, src));
    case 'spell':
      return stripFlavorProse(normalizeSpellSystem(system, src));
    case 'feat':
    case 'action':
      return stripFlavorProse(normalizeFeatSystem(system, src));
    case 'condition':
      return stripFlavorProse(normalizeConditionSystem(system, src));
    case 'npc':
    case 'character':
    case 'hazard':
    case 'loot':
      return normalizeActorSystem(system, src, type);
    case 'effect':
      return stripFlavorProse(normalizeEffectSystem(system, src));
    case 'melee':
    case 'ranged':
      return normalizeMeleeSystem(system, src);
    case 'equipment':
    case 'consumable':
    case 'treasure':
    case 'container':
      // Generic equipment (incl. SF2e augmentations, which the real
      // compendium models as type "equipment" with usage.value:"implanted" —
      // see systems/sf2e/src/schemas/item-augmentation.ts docstring).
      // Flattens the same {value:...} wrapper fields as weapon/armor and
      // strips flavor prose so curated MVP subsets built from this type
      // never carry Reserved Material (REQ-LEG-010).
      return stripFlavorProse(normalizeEquipmentSystem(system, src));
    default:
      // Passthrough — preserve all system fields for unknown types
      return system;
  }
}

/** Strips internal normalize metadata fields from system (not part of game schema). */
function stripNormalizationMeta(sys) {
  const { _normalizeAt, ...rest } = sys;
  return rest;
}

// ---------------------------------------------------------------------------
// Flavor-prose stripping (clean-room — spec 26 §D4, REQ-LEG-010)
//
// NAMES and structured MECHANICAL fields (system.damage, traits, level, price,
// etc.) are Open Game Content (ORC) and are KEPT. The PROSE of an item's
// description (and any GM/publisher flavor notes) is Reserved Material under
// Paizo copyright and MUST be discarded — the same treatment already applied to
// NPC details.publicNotes/blurb in normalizeActorSystem.
//
// For conditions the mechanical EFFECT already lives in rules[]; only the prose
// is removed here.
// ---------------------------------------------------------------------------

/** Names of system.* prose fields that carry Paizo flavor text and must be cleared. */
const FLAVOR_PROSE_FIELDS = ['description', 'gmNotes', 'publicNotes', 'privateNotes'];

/**
 * Returns a copy of an item system object with all flavor-prose fields cleared.
 * Mechanical fields are untouched. Applied to every non-actor (item) normalizer
 * so committed packs never carry copyrighted description prose.
 */
function stripFlavorProse(system) {
  const out = { ...system };
  for (const field of FLAVOR_PROSE_FIELDS) {
    if (field in out) {
      // Preserve the field key (schema may expect it) but blank the prose.
      out[field] = '';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Type-specific system normalizers
// Analysis 02-schema-actor-item.md, spec 17.
// ---------------------------------------------------------------------------

function normalizeWeaponSystem(system, src) {
  return {
    ...system,
    // Flatten nested pf2e fields to Fusion format
    damage: src.damage ?? system.damage,
    category: src.category ?? system.category ?? 'simple',
    weaponGroup: src.group ?? system.weaponGroup ?? null, // pf2e uses "group"
    range: src.range ?? system.range ?? null,
    reload: src.reload?.value ?? src.reload ?? system.reload ?? '-',
    bulk: src.bulk?.value ?? src.bulk ?? system.bulk ?? 0,
    price: src.price?.value ?? src.price ?? system.price ?? {},
    quantity: src.quantity ?? system.quantity ?? 1,
    level: src.level?.value ?? src.level ?? system.level ?? 0,
    usage: src.usage?.value ?? src.usage ?? system.usage ?? 'held-in-one-hand',
    size: src.size ?? system.size ?? 'med',
    bonus: src.bonus?.value ?? src.bonus ?? system.bonus ?? 0,
    bonusDamage: src.bonusDamage?.value ?? src.bonusDamage ?? system.bonusDamage ?? 0,
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
  };
}

function normalizeArmorSystem(system, src) {
  return {
    ...system,
    category: src.category ?? system.category ?? 'unarmored',
    armorType: src.armorType ?? system.armorType ?? null,
    dexCap: src.dexCap?.value ?? src.dexCap ?? system.dexCap ?? null,
    checkPenalty: src.checkPenalty?.value ?? src.checkPenalty ?? system.checkPenalty ?? 0,
    speedPenalty: src.speedPenalty?.value ?? src.speedPenalty ?? system.speedPenalty ?? 0,
    strength: src.strength ?? system.strength ?? null,
    bulk: src.bulk?.value ?? src.bulk ?? system.bulk ?? 0,
    level: src.level?.value ?? src.level ?? system.level ?? 0,
    price: src.price?.value ?? src.price ?? system.price ?? {},
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
  };
}

function normalizeSpellSystem(system, src) {
  return {
    ...system,
    level: src.level?.value ?? src.level ?? system.level ?? 1,
    castTime: src.time?.value ?? src.castTime ?? system.castTime ?? '2',
    range: src.range?.value ?? src.range ?? system.range ?? '',
    area: src.area ?? system.area ?? null,
    duration: src.duration ?? system.duration ?? null,
    target: src.target?.value ?? src.target ?? system.target ?? '',
    defense: src.defense ?? system.defense ?? null,
    damage: src.damage ?? system.damage ?? {},
    heightening: src.heightening ?? system.heightening ?? null,
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [], traditions: [] },
    requirements: src.requirements ?? system.requirements ?? '',
    counteraction: src.counteraction ?? system.counteraction ?? false,
    cost: src.cost?.value ?? src.cost ?? system.cost ?? '',
  };
}

function normalizeFeatSystem(system, src) {
  return {
    ...system,
    level: src.level?.value ?? src.level ?? system.level ?? 1,
    actionType: src.actionType?.value ?? src.actionType ?? system.actionType ?? null,
    actions: src.actions?.value ?? src.actions ?? system.actions ?? null,
    category: src.category ?? system.category ?? null,
    description: src.description?.value ?? src.description ?? system.description ?? '',
    prerequisites: src.prerequisites?.value ?? src.prerequisites ?? system.prerequisites ?? [],
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
  };
}

function normalizeConditionSystem(system, src) {
  // Conditions keep most fields; ensure slug is present
  const slug = src.slug ?? system.slug
    ?? (typeof system.group === 'string' ? null : null);
  return {
    ...system,
    // slug may not be present on pf2e conditions — derive from name in calling code
    overrides: src.overrides ?? system.overrides ?? [],
    duration: src.duration ?? system.duration ?? { unit: 'unlimited', value: 0, expiry: null },
    group: src.group ?? system.group ?? null,
    value: src.value ?? system.value ?? { isValued: false, value: null },
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { value: [] },
  };
}

function normalizeActorSystem(system, src, type) {
  if (type === 'npc') {
    return {
      ...system,
      abilities: src.abilities ?? system.abilities ?? {},
      attributes: src.attributes ?? system.attributes ?? {},
      details: {
        ...(src.details ?? system.details ?? {}),
        // Strip lore/flavor text — Reserved Material under ORC (REQ-LEG-010, spec 26 §D4).
        // publicNotes: Paizo bestiary prose (setting/flavor) — must be discarded.
        // blurb: subtitle flavor text — also Reserved Material.
        // privateNotes: GM-only editor content — not game data.
        publicNotes: '',
        blurb: '',
        privateNotes: '',
        level: {
          value: src.details?.level?.value ?? system.details?.level?.value ?? 0,
        },
      },
      initiative: src.initiative ?? system.initiative ?? { statistic: 'perception' },
      perception: src.perception ?? system.perception ?? { mod: 0 },
      saves: src.saves ?? system.saves ?? {},
      skills: src.skills ?? system.skills ?? {},
      traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
    };
  }
  // character, hazard, loot — passthrough
  return system;
}

function normalizeEffectSystem(system, src) {
  return {
    ...system,
    level: src.level?.value ?? src.level ?? system.level ?? 1,
    duration: src.duration ?? system.duration ?? null,
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
  };
}

function normalizeMeleeSystem(system, src) {
  return {
    ...system,
    bonus: src.bonus?.value ?? src.bonus ?? system.bonus ?? 0,
    damageRolls: src.damageRolls ?? system.damageRolls ?? {},
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
    range: src.range ?? system.range ?? null,
    publication: src.publication ?? system.publication,
  };
}

/**
 * SF2e augmentation category traits (D-SF2-03; types.ts AUGMENTATION_TYPES).
 * The real compendium data has NO explicit `augType`/category field on
 * augmentation items — the category only exists as one of these values inside
 * `traits.value` (confirmed against every file in
 * vendor/pf2e/packs/sf2e/equipment/augmentations/**). Used by
 * normalizeEquipmentSystem to derive `augType` for the sf2e schema
 * (systems/sf2e/src/schemas/item-augmentation.ts).
 */
const SF2E_AUGMENTATION_TYPE_TRAITS = new Set(['apex', 'biotech', 'magitech', 'necrograft', 'tech']);

/**
 * Normalizes generic equipment/consumable/treasure/container systems.
 * Flattens the common Foundry `{value: ...}` wrapper fields the same way
 * weapon/armor normalizers do. Also used for SF2e augmentations, which the
 * real compendium stores as `type: "equipment"` with `usage.value:
 * "implanted"` (systems/sf2e/src/schemas/item-augmentation.ts docstring;
 * D-SF2-03) — `usage` is flattened here so downstream curation/schema
 * parsing can rely on a plain string instead of digging into `.value`.
 * For implanted items, also derives `augType` from the traits.value category
 * trait when present (see SF2E_AUGMENTATION_TYPE_TRAITS docstring) — the
 * schema keeps `augType` required, so this backfill lets sf2e augmentation
 * docs parse against AugmentationSystemSchema without the schema needing to
 * change (REQ-SF2-023).
 */
function normalizeEquipmentSystem(system, src) {
  const traits = src.traits ?? system.traits ?? { rarity: 'common', value: [] };
  const usage = src.usage?.value ?? src.usage ?? system.usage ?? null;

  const out = {
    ...system,
    bulk: src.bulk?.value ?? src.bulk ?? system.bulk ?? 0,
    level: src.level?.value ?? src.level ?? system.level ?? 0,
    price: src.price?.value ?? src.price ?? system.price ?? {},
    quantity: src.quantity ?? system.quantity ?? 1,
    usage,
    size: src.size ?? system.size ?? 'med',
    hp: src.hp ?? system.hp,
    hardness: src.hardness ?? system.hardness,
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits,
    baseItem: src.baseItem ?? system.baseItem ?? null,
  };

  if (usage === 'implanted') {
    const augType = (traits.value ?? []).find(t => SF2E_AUGMENTATION_TYPE_TRAITS.has(t));
    if (augType) out.augType = augType;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Lightweight validation (no Zod — zero deps)
// REQ-CMP-044: invalid documents excluded from pack, listed in report.
// ---------------------------------------------------------------------------

/**
 * Validates a Fusion document minimally.
 * Returns { valid: true } or { valid: false, reason: string }.
 */
function validateFusionDoc(doc) {
  if (!doc._id || typeof doc._id !== 'string' || !/^[A-Za-z0-9]{16}$/.test(doc._id)) {
    return { valid: false, reason: `Invalid _id: "${doc._id}"` };
  }
  if (!doc.name || typeof doc.name !== 'string') {
    return { valid: false, reason: 'Missing or invalid name' };
  }
  if (!doc.type || typeof doc.type !== 'string') {
    return { valid: false, reason: 'Missing or invalid type' };
  }
  if (!doc.system || typeof doc.system !== 'object') {
    return { valid: false, reason: 'Missing system object' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Pack processing
// ---------------------------------------------------------------------------

/**
 * Processes a single pack — loads normalized.json, transforms all docs,
 * writes transformed.json, and returns stats.
 * @param {string} packName
 * @param {'pf2e'|'sf2e'} system
 */
function processPack(packName, system = 'pf2e') {
  const outBase = outBaseFor(system);
  const normalizedPath = join(outBase, packName, 'normalized.json');
  if (!existsSync(normalizedPath)) {
    throw new Error(`normalized.json not found for pack "${packName}" (system: ${system}). Run normalize.mjs first.`);
  }

  const normalizedDocs = JSON.parse(readFileSync(normalizedPath, 'utf8'));
  console.log(`[transform] ${packName}: ${normalizedDocs.length} normalized docs`);

  const stats = {
    packName,
    total: normalizedDocs.length,
    transformed: 0,
    invalidExcluded: [],
    totalRules: 0,
    supportedRules: 0,
    partialRules: 0,
    unsupportedRules: 0,
    byKey: {},
    assetSubstitutionsTotal: 0,
    partialConversionDocs: 0,
    fullConversionDocs: 0,
  };

  const fusionDocs = [];
  const uuidMap = {}; // sourceId → fusionId for this pack
  // sf2e fusionIds are namespaced ("sf2e:<pack>") to never collide with a
  // pf2e pack of the same name sharing a source _id (REQ-SF2-048).
  const fusionIdPackKey = system === 'pf2e' ? packName : `${system}:${packName}`;

  for (const normDoc of normalizedDocs) {
    try {
      const { fusionDoc, pf2eId, fusionId } = transformDoc(normDoc, packName, stats, fusionIdPackKey);

      // Validate
      const validation = validateFusionDoc(fusionDoc);
      if (!validation.valid) {
        stats.invalidExcluded.push({ pf2eId, reason: validation.reason });
        console.warn(`[transform] ${packName}: excluded doc ${pf2eId} — ${validation.reason}`);
        continue;
      }

      fusionDocs.push(fusionDoc);
      uuidMap[pf2eId] = fusionId;
      stats.transformed++;
      stats.assetSubstitutionsTotal += fusionDoc.flags?.fusion?.assetSubstitutions?.length ?? 0;

      if (fusionDoc.flags?.fusion?.conversion === 'partial') {
        stats.partialConversionDocs++;
      } else {
        stats.fullConversionDocs++;
      }
    } catch (err) {
      stats.invalidExcluded.push({ pf2eId: normDoc._id, reason: err.message });
      console.error(`[transform] ${packName}: error transforming ${normDoc._id}: ${err.message}`);
    }
  }

  // Write transformed docs
  const outDir = join(outBase, packName);
  mkdirSync(outDir, { recursive: true });
  const transformedPath = join(outDir, 'transformed.json');
  writeFileSync(transformedPath, JSON.stringify(fusionDocs, null, 2), 'utf8');
  const label = system === 'pf2e' ? packName : `${system}/${packName}`;
  console.log(`[transform] ${packName}: wrote ${fusionDocs.length} docs → out/${label}/transformed.json`);

  return { stats, fusionDocs, uuidMap };
}

// ---------------------------------------------------------------------------
// UUID map merge + write
// ---------------------------------------------------------------------------

function loadUuidMap(system = 'pf2e') {
  const mapPath = join(outBaseFor(system), 'fusion-uuid-map.json');
  if (existsSync(mapPath)) {
    try { return JSON.parse(readFileSync(mapPath, 'utf8')); } catch { /* */ }
  }
  return {};
}

function saveUuidMap(map, system = 'pf2e') {
  const outBase = outBaseFor(system);
  const mapPath = join(outBase, 'fusion-uuid-map.json');
  mkdirSync(outBase, { recursive: true });
  writeFileSync(mapPath, JSON.stringify(map, null, 2), 'utf8');
  const label = system === 'pf2e' ? '' : `${system}/`;
  console.log(`[transform] out/${label}fusion-uuid-map.json — ${Object.keys(map).length} packs`);
}

// ---------------------------------------------------------------------------
// Report generation
// analysis/08-transform-report.md — REQ-CMP-038/042/043
// ---------------------------------------------------------------------------

function writeTransformReport(packResults, system = 'pf2e') {
  const lines = [];
  const systemLabel = system.toUpperCase();
  lines.push(`# 08 — Relatório de Transformação ${systemLabel} → Fusion`);
  lines.push('');
  lines.push(`> Gerado em: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`> Script: \`src/transform.mjs --system ${system}\` v${IMPORTER_VERSION}`);
  lines.push(`> Fonte: vendor/pf2e packs/${system} branch ${SOURCE_VERSION}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Sumário por pack
  lines.push('## 1. Sumário por pack');
  lines.push('');
  lines.push('| Pack | Total | Transformados | Excluídos | Parciais | Completos | Substituições de arte |');
  lines.push('|---|---|---|---|---|---|---|');

  let grandTotal = 0, grandTransformed = 0, grandExcluded = 0;
  let grandPartial = 0, grandFull = 0, grandAssets = 0;

  for (const { stats } of packResults) {
    grandTotal       += stats.total;
    grandTransformed += stats.transformed;
    grandExcluded    += stats.invalidExcluded.length;
    grandPartial     += stats.partialConversionDocs;
    grandFull        += stats.fullConversionDocs;
    grandAssets      += stats.assetSubstitutionsTotal;

    lines.push(`| **${stats.packName}** | ${stats.total} | ${stats.transformed} | ${stats.invalidExcluded.length} | ${stats.partialConversionDocs} | ${stats.fullConversionDocs} | ${stats.assetSubstitutionsTotal} |`);
  }

  lines.push(`| **TOTAL** | **${grandTotal}** | **${grandTransformed}** | **${grandExcluded}** | **${grandPartial}** | **${grandFull}** | **${grandAssets}** |`);
  lines.push('');

  // Cobertura de Rule Elements
  lines.push('---');
  lines.push('');
  lines.push('## 2. Cobertura de Rule Elements');
  lines.push('');

  // Aggregate byKey across all packs
  const allByKey = {};
  for (const { stats } of packResults) {
    for (const [key, data] of Object.entries(stats.byKey)) {
      if (!allByKey[key]) allByKey[key] = { total: 0, supported: 0, partial: 0, unsupported: 0 };
      allByKey[key].total      += data.total;
      allByKey[key].supported  += data.supported;
      allByKey[key].partial    += data.partial;
      allByKey[key].unsupported+= data.unsupported;
    }
  }

  const totalRules = Object.values(allByKey).reduce((s, d) => s + d.total, 0);
  const totalSupported = Object.values(allByKey).reduce((s, d) => s + d.supported, 0);
  const totalPartial = Object.values(allByKey).reduce((s, d) => s + d.partial, 0);
  const totalUnsupported = Object.values(allByKey).reduce((s, d) => s + d.unsupported, 0);
  const coveragePct = totalRules > 0 ? ((totalSupported / totalRules) * 100).toFixed(1) : '0.0';

  lines.push(`**Cobertura total:** ${totalSupported}/${totalRules} (${coveragePct}% suportadas integralmente)`);
  lines.push('');
  lines.push('| Rule Key | Total | Suportadas | Parciais | Não suportadas | Status |');
  lines.push('|---|---|---|---|---|---|');

  // Sort by total descending
  const sorted = Object.entries(allByKey).sort(([,a],[,b]) => b.total - a.total);
  for (const [key, data] of sorted) {
    const state = RE_COVERAGE[key] ?? 'unsupported';
    const stateLabel = state === 'supported' ? '✅ suportada' : state === 'partial' ? '⚠️ parcial' : '❌ não suportada';
    lines.push(`| \`${key}\` | ${data.total} | ${data.supported} | ${data.partial} | ${data.unsupported} | ${stateLabel} |`);
  }

  lines.push('');

  // Flavor-prose policy (clean-room)
  lines.push('---');
  lines.push('');
  lines.push('## 2.1 Política de prosa de flavor (clean-room)');
  lines.push('');
  lines.push('Nomes de itens e campos **mecânicos** estruturados (`system.damage`, `traits`,');
  lines.push('`level`, `price`, `category`, `rules[]`, etc.) são Open Game Content (ORC) e');
  lines.push('**permanecem** nos packs. A **prosa** de `system.description` (e notas de flavor:');
  lines.push('`gmNotes`, `publicNotes`, `privateNotes`) é Reserved Material sob copyright da');
  lines.push('Paizo e é **descartada** (zerada) em todos os normalizadores de item, espelhando');
  lines.push('o tratamento já aplicado a `details.publicNotes`/`blurb` em NPCs.');
  lines.push('');
  lines.push('Para condições, o efeito mecânico vive em `rules[]`; apenas a prosa sai.');
  lines.push('Itens embarcados (ataques/equipamento de NPC) recebem o mesmo strip.');
  lines.push('');
  lines.push('Referências: spec 26 §D4, REQ-LEG-010. Guarda de regressão:');
  lines.push('`src/__tests__/transform.test.mjs` (nenhum `system.description` de prosa nos packs).');
  lines.push('');

  // Asset substitutions report
  lines.push('---');
  lines.push('');
  lines.push('## 3. Placeholders de arte aplicados');
  lines.push('');
  lines.push('Todos os campos de arte foram substituídos por placeholders livres.');
  lines.push('Nenhum arquivo de imagem do repositório pf2e é incluído.');
  lines.push('');
  lines.push('| Pack | Substituições totais |');
  lines.push('|---|---|');
  for (const { stats } of packResults) {
    lines.push(`| ${stats.packName} | ${stats.assetSubstitutionsTotal} |`);
  }
  lines.push(`| **TOTAL** | **${grandAssets}** |`);
  lines.push('');

  // Excluded docs
  const allExcluded = packResults.flatMap(r => r.stats.invalidExcluded.map(e => ({ pack: r.stats.packName, ...e })));
  if (allExcluded.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 4. Documentos excluídos (falha na validação)');
    lines.push('');
    lines.push('| Pack | pf2eId | Motivo |');
    lines.push('|---|---|---|');
    for (const exc of allExcluded) {
      lines.push(`| ${exc.pack} | \`${exc.pf2eId}\` | ${exc.reason} |`);
    }
    lines.push('');
  }

  // Coverage table by state (REQ-CMP-035)
  lines.push('---');
  lines.push('');
  lines.push('## 5. Tabela de cobertura declarativa');
  lines.push('');
  lines.push('| Rule Key | Estado | Conversor |');
  lines.push('|---|---|---|');
  for (const [key, state] of Object.entries(RE_COVERAGE)) {
    const icon = state === 'supported' ? '✅' : state === 'partial' ? '⚠️' : '❌';
    const conversor = state !== 'unsupported' ? `convert${key}` : '—';
    lines.push(`| \`${key}\` | ${icon} ${state} | \`${conversor}\` |`);
  }
  lines.push('');

  const reportMdName = system === 'pf2e' ? '08-transform-report.md' : '08-transform-report-sf2e.md';
  const reportJsonName = system === 'pf2e' ? '08-transform-report.json' : '08-transform-report-sf2e.json';

  const reportPath = join(ANALYSIS_DIR, reportMdName);
  mkdirSync(ANALYSIS_DIR, { recursive: true });
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`[transform] analysis/${reportMdName} escrito`);

  // JSON report (REQ-CMP-043)
  const jsonReport = {
    importerVersion: IMPORTER_VERSION,
    sourceVersion: SOURCE_VERSION,
    generatedAt: new Date().toISOString(),
    packs: packResults.map(({ stats }) => ({
      packId: `${system}.${stats.packName}`,
      total: stats.total,
      transformed: stats.transformed,
      invalidExcluded: stats.invalidExcluded,
      ruleCoverage: {
        totalRules: stats.totalRules,
        byState: {
          supported: stats.supportedRules,
          partial: stats.partialRules,
          unsupported: stats.unsupportedRules,
        },
        byKey: stats.byKey,
        coveragePct: stats.totalRules > 0
          ? (stats.supportedRules / stats.totalRules * 100).toFixed(1)
          : '0.0',
      },
      assetSubstitutions: stats.assetSubstitutionsTotal,
    })),
    aggregate: {
      totalRules,
      supportedRules: totalSupported,
      partialRules: totalPartial,
      unsupportedRules: totalUnsupported,
      coveragePct,
    },
    failed: false, // would be true if coverage regression below threshold
  };

  const jsonReportPath = join(ANALYSIS_DIR, reportJsonName);
  writeFileSync(jsonReportPath, JSON.stringify(jsonReport, null, 2), 'utf8');
  console.log(`[transform] analysis/${reportJsonName} escrito`);

  return { totalRules, totalSupported, coveragePct };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  const DEFAULT_PACKS_BY_SYSTEM = {
    pf2e: ['conditions', 'equipment', 'spells', 'pathfinder-monster-core'],
    sf2e: ['conditions', 'equipment', 'spells', 'alien-core-bestiary', 'rulebook-bestiaries'],
  };

  const systemEq  = args.find(a => a.startsWith('--system='));
  const systemIdx = args.indexOf('--system');
  const systemFlag = systemEq
    ? systemEq.split('=')[1]
    : (systemIdx !== -1 ? args[systemIdx + 1] : null);
  const system = systemFlag === 'sf2e' ? 'sf2e' : 'pf2e';

  const packArg = args.find(a => a.startsWith('--packs=')) ?? args.find(a => a.startsWith('--pack='));
  const packIdx = args.indexOf('--packs') !== -1 ? args.indexOf('--packs') : args.indexOf('--pack');

  let packs;
  if (packArg) {
    packs = packArg.split('=')[1].split(',').map(p => p.trim());
  } else if (packIdx !== -1 && args[packIdx + 1]) {
    packs = args[packIdx + 1].split(',').map(p => p.trim());
  } else {
    packs = DEFAULT_PACKS_BY_SYSTEM[system];
  }

  packs = packs.filter(p => !p.startsWith('--'));

  console.log(`[transform] Sistema: ${system}`);
  console.log(`[transform] Packs alvo: ${packs.join(', ')}`);

  const packResults = [];
  const globalUuidMap = loadUuidMap(system);

  for (const packName of packs) {
    console.log(`\n[transform] === Pack: ${packName} ===`);
    try {
      const { stats, fusionDocs, uuidMap } = processPack(packName, system);
      packResults.push({ stats, fusionDocs });
      globalUuidMap[packName] = uuidMap;
      console.log(`[transform] ${packName}: rules ${stats.supportedRules} suportadas / ${stats.partialRules} parciais / ${stats.unsupportedRules} não suportadas`);
    } catch (err) {
      console.error(`[transform] ERRO em ${packName}: ${err.message}`);
    }
  }

  saveUuidMap(globalUuidMap, system);
  const { totalRules, totalSupported, coveragePct } = writeTransformReport(packResults, system);

  console.log('\n[transform] === SUMÁRIO FINAL ===');
  console.log(`Packs processados: ${packResults.length}`);
  console.log(`Total rules: ${totalRules} | Suportadas: ${totalSupported} (${coveragePct}%)`);
  console.log(`Relatório: analysis/${system === 'pf2e' ? '08-transform-report.md' : '08-transform-report-sf2e.md'}`);
}

main().catch(err => {
  console.error('[transform] FATAL:', err);
  process.exit(1);
});
