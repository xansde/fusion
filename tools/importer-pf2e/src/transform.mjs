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
function transformDoc(normDoc, packName, stats, fusionIdPackKey = packName, pipelineSystem = 'pf2e') {
  const pf2eId = normDoc.pf2eSourceId ?? normDoc._id;
  const fusionId = deriveFusionId(fusionIdPackKey, pf2eId);
  const fusionType = resolveFusionType(normDoc);

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
    unconvertedRules: stripRuleProse(unconvertedRules),
    assetSubstitutions,
  };

  // --- Build system with converted rules ---
  const system = buildSystem(normDoc, convertedRules, packName, fusionType, pipelineSystem);

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
        rules: stripRuleProse(itemConverted),
      },
      flags: {
        fusion: {
          conversion: itemUnconverted.length > 0 ? 'partial' : 'full',
          unconvertedRules: stripRuleProse(itemUnconverted),
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
    type: fusionType,
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
 * Resolves the Fusion document `type` for a normalized vendor document.
 *
 * The vendor stores class features as `type: "feat"` with
 * `system.category: "classfeature"` (there is no dedicated vendor item
 * type) — the Fusion schema instead models them as their own item type
 * `classFeature` (systems/pf2e/src/schemas/item-class-feature.ts, R10-A).
 *
 * The vendor also has a dedicated `type: "backpack"` for container items
 * (Backpack, Spacious Pouch, etc.) while Fusion models every item that
 * holds other items — including the vendor's own `type: "container"`
 * (Chest, etc.) — as the single `container` type (ContainerSystemSchema,
 * systems/pf2e/src/schemas/item-equipment.ts). Without this mapping,
 * `buildSystem`'s switch never matches `"backpack"` and falls through to
 * the passthrough default, leaving `bulk`/`level`/`description` as raw
 * `{value: ...}` wrapper objects instead of flattened primitives (r18-N2d
 * bugfix — Spacious Pouch).
 *
 * Every other vendor type maps 1:1 to the same Fusion type name.
 *
 * R10-B (DEC-R10-06); r18-N2d (backpack → container).
 */
function resolveFusionType(normDoc) {
  if (normDoc.type === 'feat' && normDoc.system?.category === 'classfeature') {
    return 'classFeature';
  }
  if (normDoc.type === 'backpack') {
    return 'container';
  }
  return normDoc.type;
}

/**
 * Builds the system object for a Fusion document.
 * Maps pf2e system fields to Fusion system fields per document type.
 * REQ-CMP-027/027a.
 */
function buildSystem(normDoc, convertedRules, packName, fusionType = normDoc.type, pipelineSystem = 'pf2e') {
  const src = normDoc.system ?? {};
  const stripped = stripNormalizationMeta(src);

  // Add converted rules
  const system = { ...stripped, rules: stripRuleProse(convertedRules) };

  // Type-specific field normalization.
  // Item types run through stripFlavorProse() so committed packs never carry
  // copyrighted description prose (REQ-LEG-010, spec 26 §D4). Actor types keep
  // their own targeted prose stripping inside normalizeActorSystem.
  switch (fusionType) {
    case 'weapon':
      return stripFlavorProse(normalizeWeaponSystem(system, src, pipelineSystem));
    case 'armor':
    case 'shield':
      return stripFlavorProse(normalizeArmorSystem(system, src));
    case 'spell':
      return stripFlavorProse(normalizeSpellSystem(system, src));
    case 'classFeature':
      return stripFlavorProse(normalizeClassFeatureSystem(system, src));
    case 'feat':
    case 'action':
      return stripFlavorProse(normalizeFeatSystem(system, src));
    case 'condition':
      return stripFlavorProse(normalizeConditionSystem(system, src, normDoc.name));
    case 'npc':
    case 'character':
    case 'hazard':
    case 'loot':
      return normalizeActorSystem(system, src, fusionType);
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
    case 'class':
      return stripFlavorProse(normalizeClassSystem(system, src, normDoc.name));
    case 'ancestry':
      return stripFlavorProse(normalizeAncestrySystem(system, src));
    case 'heritage':
      return stripFlavorProse(normalizeHeritageSystem(system, src));
    case 'background':
      return stripFlavorProse(normalizeBackgroundSystem(system, src));
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
// Flavor-prose stripping (clean-room — spec 26 §D4, REQ-LEG-010, policy update
// W2-C1 2026-07-05: product decision — "eu preciso saber o que cada opção faz
// para selecionar").
//
// NAMES and structured MECHANICAL fields (system.damage, traits, level, price,
// etc.) are Open Game Content (ORC) and are KEPT — as always.
//
// `system.description` is now a SPECIAL CASE: the vendor's rules-text prose
// (spell/feat/class/etc. descriptions) is itself licensed content — every
// pf2e/sf2e document that carries one also carries a `system.publication`
// block declaring which license covers it (`{license: 'ORC'|'OGL', ...}`,
// verified against vendor/pf2e/packs/**: classes/spells/feats/conditions/
// equipment all set this). Per DEC-LEG (W2-C1), description text under an
// ORC or OGL publication CAN be redistributed with attribution (see each
// pack.json's `license.attribution` + the new `license.textAttribution`,
// build-mvp-subset.mjs) and is therefore PRESERVED. Documents with no
// `publication` block at all (e.g. bestiary NPCs — which don't even carry a
// `system.description` field; their prose lives in `details.blurb`/
// `publicNotes`, always stripped in normalizeActorSystem) or a license
// outside the {ORC, OGL} allowlist keep description blanked, unchanged from
// the prior conservative default.
//
// `gmNotes`/`publicNotes`/`privateNotes` are NEVER rules text — they are
// GM-only authoring notes / lore asides — and stay unconditionally cleared
// regardless of license, same as before.
//
// For conditions the mechanical EFFECT already lives in rules[]; description
// prose (when preserved) is supplementary flavor/reminder text, not the sole
// carrier of mechanics.
// ---------------------------------------------------------------------------

/** Licenses under which vendor `system.description` prose may be redistributed (with attribution). */
const REDISTRIBUTABLE_DESCRIPTION_LICENSES = new Set(['ORC', 'OGL']);

/** Names of system.* prose fields that are GM/publisher-only flavor and must always be cleared. */
const ALWAYS_STRIPPED_PROSE_FIELDS = ['gmNotes', 'publicNotes', 'privateNotes'];

/**
 * Returns a copy of an item system object with GM/publisher-only flavor
 * fields always cleared, and `description` cleared UNLESS the document's
 * `system.publication.license` is ORC or OGL (policy update W2-C1) — in
 * which case the mechanical rules-text description is preserved verbatim
 * (HTML/UUID-refs untouched; a future panel formats it for display).
 * Mechanical fields (damage, traits, level, price, etc.) are always untouched.
 */
function stripFlavorProse(system) {
  const out = { ...system };
  for (const field of ALWAYS_STRIPPED_PROSE_FIELDS) {
    if (field in out) {
      // Preserve the field key (schema may expect it) but blank the prose.
      out[field] = '';
    }
  }
  if ('description' in out) {
    const license = out.publication?.license;
    if (!REDISTRIBUTABLE_DESCRIPTION_LICENSES.has(license)) {
      // Blank in whichever shape the field currently has — most normalizers
      // already flatten to a plain string (`?? ''`), but the embedded-item
      // call site (buildSystem's items[] map) passes the RAW vendor
      // system.* through unnormalized, where description is still the
      // vendor's `{value: string}` wrapper.
      out.description =
        out.description && typeof out.description === 'object' && 'value' in out.description
          ? { ...out.description, value: '' }
          : '';
    }
    // else: ORC/OGL — keep out.description as-is (preserved verbatim,
    // whichever shape it arrived in).
  }
  return out;
}

/**
 * REQ-LEG-010 hardening (r10 final clean-room audit finding): rule elements
 * carry verbatim book prose in their `text` field (Note/RollNote REs — e.g.
 * "Mortal Healing" shipped the full feat paragraph in rules[0].text AND in
 * rules[0].raw.text). stripFlavorProse only covers top-level description
 * fields, so that prose survived the RE pipeline into committed packs.
 *
 * Blanks every non-empty `text` string on rule descriptors, on their
 * embedded `raw` copies, and on unconverted raw REs, leaving a
 * `textStripped: true` marker so a future in-app rules editor knows a note
 * existed (the mechanical trigger — selector/outcome/predicate — is kept).
 */
/**
 * Clean-room cap for spell `target` (REQ-LEG-010, r10 final audit): keep
 * short mechanical shorthands ("1 creature", "1 willing creature") but blank
 * anything long enough to be book prose. 60 chars comfortably covers every
 * legitimate mechanical target phrase observed in the vendor data.
 */
function capSpellTarget(target) {
  if (typeof target !== 'string') return '';
  return target.length > 60 ? '' : target;
}

/**
 * Recursively walks `node` (plain object or array), blanking every non-empty
 * `text` string field it finds, wherever it is nested. Returns a boolean
 * flag alongside the (deep-cloned) result indicating whether anything was
 * actually stripped.
 *
 * Hardening (W2, pf2e.actions-core, r11-follow-up): the original
 * stripRuleProse only checked `rule.text` and `rule.raw.text` — a flat,
 * one-level check. Real vendor ItemAlteration REs (e.g. Spellstrike, Breath
 * Weapon, Flash of Grandeur — all in actions/class/**) nest their `text`
 * inside a `value` ARRAY of sub-objects (`re.value[].text`), which the flat
 * check never visited, letting that field survive verbatim into
 * flags.fusion.unconvertedRules (and its `raw` copy) unstripped. Every
 * observed instance in the vendor data is an i18n key or an `@Embed[...]`
 * UUID reference rather than book prose, but the guard must not rely on
 * that being true forever — REQ-LEG-010 requires no `text`/`raw.text` field
 * survives ANYWHERE in rules[], not just at the shapes seen so far.
 */
function deepStripText(node) {
  if (Array.isArray(node)) {
    let stripped = false;
    const out = node.map((item) => {
      const [next, didStrip] = deepStripTextInner(item);
      if (didStrip) stripped = true;
      return next;
    });
    return [out, stripped];
  }
  return deepStripTextInner(node);
}

function deepStripTextInner(node) {
  if (node === null || typeof node !== 'object') return [node, false];
  if (Array.isArray(node)) return deepStripText(node);
  let stripped = false;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'text' && typeof v === 'string' && v.length > 0) {
      out[k] = '';
      stripped = true;
    } else if (v !== null && typeof v === 'object') {
      const [next, didStrip] = deepStripText(v);
      out[k] = next;
      if (didStrip) stripped = true;
    } else {
      out[k] = v;
    }
  }
  return [out, stripped];
}

function stripRuleProse(rules) {
  return (rules ?? []).map((rule) => {
    if (!rule || typeof rule !== 'object') return rule;
    const [stripped, didStrip] = deepStripTextInner(rule);
    if (didStrip) stripped.textStripped = true;
    return stripped;
  });
}

// ---------------------------------------------------------------------------
// Type-specific system normalizers
// Analysis 02-schema-actor-item.md, spec 17.
// ---------------------------------------------------------------------------

function normalizeWeaponSystem(system, src, pipelineSystem = 'pf2e') {
  // FIX (R10-B3 packs-validation): several vendor `{value: ...}` wrapper
  // fields carry an explicit `null` payload (reload, splashDamage) for the
  // vast majority of weapons — verified against every doc in
  // vendor/pf2e/packs/pf2e/equipment/*.json (e.g. bastard-sword.json has
  // `reload: {value: null}`, `splashDamage: {value: 0}`). A plain
  // `src.x?.value ?? src.x ?? ...` chain is WRONG for these: `null ?? src.x`
  // evaluates the truthy wrapper OBJECT itself (`??` only advances past
  // `null`/`undefined`, and the wrapper is neither), producing an object
  // where the Fusion schema expects a string/number. Same class of bug as
  // normalizeFeatSystem.actions (see hasValueWrapper below) — unwrap
  // explicitly and only fall through to `src.x` when it ISN'T the wrapper
  // shape.
  const reload = hasValueWrapper(src.reload) ? (src.reload.value ?? '-') : (src.reload ?? system.reload ?? '-');
  const splashDamage = hasValueWrapper(src.splashDamage)
    ? (src.splashDamage.value ?? undefined)
    : (src.splashDamage ?? system.splashDamage ?? undefined);

  // `material` is always present on vendor weapons as `{grade: null, type:
  // null}` (unworked base weapons carry no special material) — the Fusion
  // schema declares grade/type as optional strings, so explicit nulls must
  // become `undefined` rather than being passed through as `null`.
  const rawMaterial = src.material ?? system.material;
  const material =
    rawMaterial && typeof rawMaterial === 'object'
      ? { grade: rawMaterial.grade ?? undefined, type: rawMaterial.type ?? undefined }
      : undefined;

  // `ammo` on the vendor is a structured object (`{baseType, builtIn,
  // capacity}`). The two systems' Fusion schemas disagree on the expected
  // shape (verified against systems/{pf2e,sf2e}/src/schemas/item-weapon.ts):
  //   - pf2e WeaponSystemSchema.ammo: z.string().nullable().optional() — a
  //     UUID/slug reference. Flatten the vendor object to its `baseType`
  //     slug (e.g. "arrows", "bolts", "sling-bullets"); melee/no-ammo
  //     weapons keep `null`.
  //   - sf2e WeaponSystemSchema.ammo: AmmoSchema — `{baseType, builtIn,
  //     capacity}.nullable()`, i.e. the FULL object (REQ-SF2-018/020, Tech
  //     weapon charge tracking). Flattening to a string here would fail Zod
  //     validation (`Expected object, received string`) — keep the object
  //     shape, defaulting missing sub-fields the same way the schema does.
  //     Some vendor items (e.g. grenades, which are themselves the ammo)
  //     carry `{baseType: null, builtIn: false}` with no real base type —
  //     `AmmoBaseTypeSchema` is a required enum, so a null baseType means
  //     "no ammo tracking" and the whole field must fall back to `null`.
  const rawAmmo = src.ammo ?? system.ammo;
  let ammo;
  if (pipelineSystem === 'sf2e') {
    ammo =
      rawAmmo && typeof rawAmmo === 'object' && rawAmmo.baseType != null
        ? {
            baseType: rawAmmo.baseType,
            builtIn: rawAmmo.builtIn ?? false,
            capacity: rawAmmo.capacity ?? 1,
          }
        : null;
  } else {
    ammo = rawAmmo && typeof rawAmmo === 'object' ? (rawAmmo.baseType ?? null) : (rawAmmo ?? null);
  }

  return {
    ...system,
    // Flatten nested pf2e fields to Fusion format
    damage: src.damage ?? system.damage,
    category: src.category ?? system.category ?? 'simple',
    weaponGroup: src.group ?? system.weaponGroup ?? null, // pf2e uses "group"
    range: src.range ?? system.range ?? null,
    reload,
    bulk: src.bulk?.value ?? src.bulk ?? system.bulk ?? 0,
    price: src.price?.value ?? src.price ?? system.price ?? {},
    quantity: src.quantity ?? system.quantity ?? 1,
    level: src.level?.value ?? src.level ?? system.level ?? 0,
    usage: src.usage?.value ?? src.usage ?? system.usage ?? 'held-in-one-hand',
    size: src.size ?? system.size ?? 'med',
    bonus: src.bonus?.value ?? src.bonus ?? system.bonus ?? 0,
    bonusDamage: src.bonusDamage?.value ?? src.bonusDamage ?? system.bonusDamage ?? 0,
    material,
    ammo,
    splashDamage,
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
  };
}

function normalizeArmorSystem(system, src) {
  // `material` is always present on vendor armor as `{grade: null, type:
  // null}` (unworked base armor carries no special material) — same bug
  // class as normalizeWeaponSystem.material (see its comment): explicit
  // nulls must become `undefined`, not pass through as `null`.
  const rawMaterial = src.material ?? system.material;
  const material =
    rawMaterial && typeof rawMaterial === 'object'
      ? { grade: rawMaterial.grade ?? undefined, type: rawMaterial.type ?? undefined }
      : undefined;

  // `baseItem` is `null` on vendor armor that isn't a runed/precious variant
  // of a base item (e.g. Elven Chain — r18-N2d bugfix). Same bug class as
  // `material` above: ArmorSystemSchema's `baseItem: z.string().optional()`
  // accepts a string or `undefined` but rejects an explicit `null`.
  const rawBaseItem = src.baseItem ?? system.baseItem;
  const baseItem = typeof rawBaseItem === 'string' ? rawBaseItem : undefined;

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
    material,
    baseItem,
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
    // FIX (R10-B3 packs-validation): area/duration/defense/heightening are
    // all `.optional()` in SpellSystemSchema (absent when the spell has
    // none), but the vendor stores "none" as an explicit `null` on ~88% of
    // spells-core docs (712/806) rather than omitting the key. Zod's
    // `.optional()` accepts `undefined`, not `null` — so `?? null` here was
    // producing a value the schema itself rejects. Falling through to
    // `undefined` keeps the same "absent" semantics the schema expects.
    area: normalizeSpellArea(src.area ?? system.area),
    duration: src.duration ?? system.duration ?? undefined,
    // Clean-room cap (r10 final audit): most vendor targets are short
    // mechanical phrases ("1 creature"), but a few carry a verbatim book
    // sentence (e.g. Magnetic Dominion, ~110 chars from Rage of Elements).
    // Anything longer than a mechanical shorthand is blanked (REQ-LEG-010).
    target: capSpellTarget(src.target?.value ?? src.target ?? system.target ?? ''),
    defense: normalizeSpellDefense(src.defense ?? system.defense),
    damage: src.damage ?? system.damage ?? {},
    heightening: normalizeSpellHeightening(src.heightening ?? system.heightening),
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [], traditions: [] },
    requirements: src.requirements ?? system.requirements ?? '',
    counteraction: src.counteraction ?? system.counteraction ?? false,
    cost: src.cost?.value ?? src.cost ?? system.cost ?? '',
  };
}

/** `null` → `undefined` for the optional `area` block (see normalizeSpellSystem). */
function normalizeSpellArea(area) {
  return area ?? undefined;
}

/**
 * Normalizes the vendor `defense` block: drops an explicit `null`
 * (SpellSystemSchema.defense is `.optional()`) and unwraps `save: null`
 * (present alongside a real `passive` defense on spells like Banishing
 * Touch — `{passive: {statistic: "ac"}, save: null}`) to `undefined` so it
 * matches the schema's optional `save` field instead of failing
 * `Expected object, received null`.
 */
function normalizeSpellDefense(defense) {
  if (!defense || typeof defense !== 'object') return undefined;
  return {
    ...defense,
    save: defense.save ?? undefined,
    passive: defense.passive ?? undefined,
  };
}

/**
 * Normalizes the vendor `heightening` block. SpellSystemSchema.heightening
 * is a discriminated union on `type` ("interval" | "fixed"); a small number
 * of vendor spells (e.g. Enervation) carry a `heightening` object with
 * neither — just `{damage: {}}`, an empty/legacy shape with no usable
 * heightening data. Dropping it to `undefined` is the correct clean-room
 * choice: there's no structured rule to preserve, and passing it through
 * would fail Fusion's own schema without adding any information.
 */
function normalizeSpellHeightening(heightening) {
  if (!heightening || typeof heightening !== 'object') return undefined;
  if (heightening.type !== 'interval' && heightening.type !== 'fixed') return undefined;
  return heightening;
}

function normalizeFeatSystem(system, src) {
  return {
    ...system,
    level: src.level?.value ?? src.level ?? system.level ?? 1,
    actionType: src.actionType?.value ?? src.actionType ?? system.actionType ?? null,
    // NOTE: src.actions.value is legitimately `null` for the vast majority
    // of feats (passive feats carry no action count — 4473/5987 in the
    // vendor `feats` pack). A plain `src.actions?.value ?? src.actions ?? ...`
    // chain is WRONG here: `null ?? src.actions` evaluates the truthy wrapper
    // object `src.actions` (e.g. `{value: null}`) instead of falling through,
    // because `??` only advances past `null`/`undefined`, and the wrapper
    // object itself is neither. Must explicitly unwrap the object shape
    // first and only fall back to `src.actions` when it ISN'T the
    // `{value: ...}` wrapper (i.e. already a plain number/null, as system.*
    // callers may pass it after a prior normalization pass).
    actions: hasValueWrapper(src.actions)
      ? (src.actions.value ?? null)
      : (src.actions ?? system.actions ?? null),
    category: src.category ?? system.category ?? null,
    frequency: normalizeFrequency(src.frequency ?? system.frequency),
    description: src.description?.value ?? src.description ?? system.description ?? '',
    prerequisites: src.prerequisites?.value ?? src.prerequisites ?? system.prerequisites ?? [],
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
  };
}

/** True when `val` is a plain `{value: ...}` wrapper object (vendor Foundry field shape). */
function hasValueWrapper(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val) && 'value' in val;
}

/**
 * Maps a vendor `frequency.per` unit to the Fusion FeatSystemSchema enum
 * ("day" | "encounter" | "hour" | "minute" | "round" | "turn").
 *
 * The vendor stores most frequencies as those same slugs directly (e.g.
 * `{max:1, per:"day"}`), but a minority use raw ISO 8601 duration strings
 * instead (verified against every feat in vendor/pf2e/packs/pf2e/feats/**:
 * `PT1H` = 1 hour, `PT10M` = 10 minutes — e.g. Aura Sight, Sacred Defense,
 * Maelstrom Flow use "PT1H"; Myth Hunter uses "PT10M"). This is a units
 * conversion of mechanical data (not prose) — safe to encode clean-room.
 * Unrecognized values are dropped (returns undefined) rather than passed
 * through invalid, per REQ-PF2-204's spirit of never producing documents
 * that fail Fusion's own schema.
 */
function normalizeFrequency(frequency) {
  if (!frequency || typeof frequency !== 'object') return undefined;
  const ISO_DURATION_TO_UNIT = { PT1H: 'hour', PT10M: 'minute' };
  const per = ISO_DURATION_TO_UNIT[frequency.per] ?? frequency.per;
  const VALID_PER = new Set(['day', 'encounter', 'hour', 'minute', 'round', 'turn']);
  if (!VALID_PER.has(per) || typeof frequency.max !== 'number') return undefined;
  return { max: frequency.max, per };
}

/**
 * Normalizes a condition's system block.
 *
 * FIX (R10-B3 packs-validation): two real bugs found and fixed here —
 *
 * 1. `slug` (ConditionSystemSchema requires a non-empty string) was
 *    computed into a local variable but never written into the returned
 *    object — every one of the 43 conditions failed validation with
 *    `slug: Required`. The vendor doesn't carry a `system.slug` field at
 *    all (verified against every doc in vendor/pf2e/packs/pf2e/conditionitems/
 *    — conditions are identified by document *name*, not a system field),
 *    so the slug must be derived from the document name, same convention
 *    as `classSlugFromName` used elsewhere in this file for classes.
 * 2. `value` (ConditionSystemSchema: `z.number().int().min(1).optional()`)
 *    was passed through as the vendor's `{isValued: boolean, value: number
 *    | null}` wrapper object untouched. Unwrapped here: valued conditions
 *    (e.g. Frightened 2, Clumsy 1) get their numeric `value`; non-valued
 *    conditions (most of the 43) get `undefined` (schema's "absent" state)
 *    instead of `null` — REQ-PF2-054 (highest value wins) already reads
 *    this field on the LIVE item instance in `conditions-manager.ts`, not
 *    on this compendium doc, so unwrapping here is purely a schema-shape
 *    fix with no runtime behavior change.
 */
function normalizeConditionSystem(system, src, docName) {
  const slug = src.slug ?? system.slug ?? classSlugFromName(docName);
  const rawValue = src.value ?? system.value;
  const value =
    rawValue && typeof rawValue === 'object' && 'isValued' in rawValue
      ? (rawValue.isValued ? (rawValue.value ?? undefined) : undefined)
      : (typeof rawValue === 'number' ? rawValue : undefined);

  return {
    ...system,
    slug,
    overrides: src.overrides ?? system.overrides ?? [],
    duration: src.duration ?? system.duration ?? { unit: 'unlimited', value: 0, expiry: null },
    group: src.group ?? system.group ?? null,
    value,
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
  // `badge.max` (EffectSystemSchema: `z.number().int().positive().optional()`)
  // is present on the vendor as an explicit `null` for uncapped counter
  // badges (e.g. sf2e's Glitching: `{type:"counter", value:1, max:null,
  // min:null, labels:null, loop:false}`) — same bug class as
  // normalizeWeaponSystem.material: explicit null must become `undefined`.
  // `min`/`labels`/`loop` aren't part of the Fusion badge schema and are
  // dropped by Zod's default parse (no `.passthrough()` on that nested
  // object) — omitting them here keeps the transformed doc's shape aligned
  // with what actually survives validation.
  const rawBadge = src.badge ?? system.badge;
  const badge =
    rawBadge && typeof rawBadge === 'object'
      ? { type: rawBadge.type, value: rawBadge.value, max: rawBadge.max ?? undefined }
      : undefined;

  return {
    ...system,
    level: src.level?.value ?? src.level ?? system.level ?? 1,
    duration: src.duration ?? system.duration ?? null,
    badge,
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

// ---------------------------------------------------------------------------
// classFeature (R10-A ClassFeatureSystemSchema; R10-B / DEC-R10-06)
//
// Vendor stores class features as `type: "feat"` with `system.category:
// "classfeature"` — resolveFusionType() reclassifies them to the Fusion
// `classFeature` item type before buildSystem() dispatches here. Hybrid
// Study choices (Magus) are marked in the vendor by
// `traits.otherTags: ["magus-hybrid-study"]` (confirmed against
// vendor/pf2e/packs/pf2e/class-features/starlit-span.json et al.) — these
// become Fusion category "hybridStudy" per DEC-R10-06/ClassFeatureSystemSchema.
// ---------------------------------------------------------------------------

/** otherTags marker the vendor uses for Magus Hybrid Study feature choices. */
const HYBRID_STUDY_TAG = 'magus-hybrid-study';

function normalizeClassFeatureSystem(system, src) {
  const otherTags = src.traits?.otherTags ?? system.traits?.otherTags ?? [];
  const isHybridStudy = Array.isArray(otherTags) && otherTags.includes(HYBRID_STUDY_TAG);

  return {
    ...system,
    level: src.level?.value ?? src.level ?? system.level ?? 1,
    category: isHybridStudy ? 'hybridStudy' : (src.category ?? system.category ?? 'classfeature'),
    prerequisites: src.prerequisites?.value ?? src.prerequisites ?? system.prerequisites ?? [],
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
  };
}

// ---------------------------------------------------------------------------
// class (R10-A ClassSystemSchema; R10-B / DEC-R10-06)
//
// Converts the vendor's flat class shape (ancestryFeatLevels.value,
// classFeatLevels.value, generalFeatLevels.value, skillFeatLevels.value,
// skillIncreaseLevels.value, trainedSkills{value,additional}, keyAbility.value,
// hp, perception, savingThrows{...}, defenses{...}, attacks{...}, items{} map)
// into the Fusion ClassSystemSchema shape (featLevels{ancestry,class,general,
// skill}, trainedSkills, proficiencyUpgrades[], spellcasting?, featuresByLevel[]).
//
// Magus-specific facts baked in here (clean-room, derived from reading the
// vendor's own prose/subfeatures on disk — see decisions in the transform
// report / BUILD-LOG, not copied from any Paizo PDF):
//   - spellcasting progression table: authored from the sole textual anchor
//     available in the vendor (class-features/arcane-spellcasting-magus.json
//     prose: "at 1st level, ... one 1st-rank spell and five cantrips ...
//     no more than two spell slots of your highest rank and ... two spell
//     slots of 1 rank lower"). This is the PF2e Remaster bounded-caster
//     progression (shared shape with Summoner) — cantripsKnown is a constant
//     5 at every level; slots follow the official journal table (two slots
//     of each of the top two ranks, pair moving up every 2 levels from L5).
//   - proficiencyUpgrades: derived from each class-feature file's
//     `system.subfeatures.proficiencies` map (rank numbers) combined with the
//     LEVEL at which the class's own items{} map grants that feature (the
//     generic class-feature file's own `system.level` is shared across
//     several classes and is NOT authoritative for Magus — items{} map is).
// ---------------------------------------------------------------------------

/**
 * Magus arcane prepared spellcasting progression (cantrips known + slots by
 * rank per character level). Transcribed VERBATIM from the official Magus
 * spells-per-day table in the vendor's ORC-licensed class journal
 * (vendor/pf2e/packs/pf2e/journals/classes.json, page "Magus" — the same
 * table the prose in class-features/arcane-spellcasting-magus.json refers
 * to). Invariant stated by the prose and honored by the table: at most two
 * slots of the highest rank plus two of one rank lower; lower ranks are
 * DROPPED as the pair moves up; there are never 10th-rank slots. The `-*`
 * (studious spells bonus slots) column marks in the journal are a separate
 * feature and are intentionally NOT part of this base table.
 * Acceptance anchors: L1 → {"1":1}; L3 → {"1":2,"2":1} (matches the Tobias
 * Pathbuilder export perDay [5,2,1] and the user's screenshot showing a
 * Rank 2 slot at level 3); L5 → {"2":2,"3":2}; L19/L20 → {"8":2,"9":2}.
 */
const MAGUS_SPELLCASTING_TABLE = [
  { level: 1, cantrips: 5, slots: { '1': 1 } },
  { level: 2, cantrips: 5, slots: { '1': 2 } },
  { level: 3, cantrips: 5, slots: { '1': 2, '2': 1 } },
  { level: 4, cantrips: 5, slots: { '1': 2, '2': 2 } },
  { level: 5, cantrips: 5, slots: { '2': 2, '3': 2 } },
  { level: 6, cantrips: 5, slots: { '2': 2, '3': 2 } },
  { level: 7, cantrips: 5, slots: { '3': 2, '4': 2 } },
  { level: 8, cantrips: 5, slots: { '3': 2, '4': 2 } },
  { level: 9, cantrips: 5, slots: { '4': 2, '5': 2 } },
  { level: 10, cantrips: 5, slots: { '4': 2, '5': 2 } },
  { level: 11, cantrips: 5, slots: { '5': 2, '6': 2 } },
  { level: 12, cantrips: 5, slots: { '5': 2, '6': 2 } },
  { level: 13, cantrips: 5, slots: { '6': 2, '7': 2 } },
  { level: 14, cantrips: 5, slots: { '6': 2, '7': 2 } },
  { level: 15, cantrips: 5, slots: { '7': 2, '8': 2 } },
  { level: 16, cantrips: 5, slots: { '7': 2, '8': 2 } },
  { level: 17, cantrips: 5, slots: { '8': 2, '9': 2 } },
  { level: 18, cantrips: 5, slots: { '8': 2, '9': 2 } },
  { level: 19, cantrips: 5, slots: { '8': 2, '9': 2 } },
  { level: 20, cantrips: 5, slots: { '8': 2, '9': 2 } },
];

/**
 * Magus proficiency-rank upgrades by character level, derived from the
 * vendor's items{} map (magus.json — the SOURCE OF TRUTH for which level
 * Magus grants each feature) cross-referenced with each referenced
 * class-feature file's `system.subfeatures.proficiencies` map (rank numbers
 * are TEML: 1=trained, 2=expert, 3=master, 4=legendary). Every rank number
 * below was read directly from the corresponding class-feature file's own
 * `system.subfeatures.proficiencies` map, not guessed from feature name:
 *
 *   - L5  Lightning Reflexes    → class-features/reflex-expertise.json       → reflex:2
 *   - L5  Weapon Expertise      → class-features/weapon-expertise.json       → weapons.simple:2, weapons.unarmed:2,
 *                                  plus rules[].ActiveEffectLike (predicate class:magus) → weapons.martial:2
 *   - L9  Alertness             → class-features/alertness.json              → perception:2
 *   - L9  Expert Spellcaster    → class-features/expert-spellcaster.json     → spellcasting:2
 *   - L9  Resolve               → class-features/resolve.json                → will:3
 *   - L11 Medium Armor Expertise→ class-features/medium-armor-expertise.json → armor.light:2, armor.medium:2, armor.unarmored:2
 *   - L13 Weapon Mastery        → class-features/weapon-mastery.json         → weapons.simple:3, weapons.martial:3, weapons.unarmed:3
 *   - L15 Juggernaut            → class-features/juggernaut.json             → fortitude:3
 *   - L17 Master Spellcaster    → class-features/master-spellcaster.json     → spellcasting:3
 *   - L17 Medium Armor Mastery  → class-features/medium-armor-mastery.json   → armor.light:3, armor.medium:3, armor.unarmored:3
 *
 * NOTE: the class-features/*.json files carry a shared `system.level` used
 * generically across every class that grants that feature (e.g.
 * reflex-expertise.json / alertness.json both say level 3 generically), but
 * a class's own items{} map can grant the SAME feature at a DIFFERENT level
 * under a class-specific label (e.g. magus.json's items{} map grants
 * "Reflex Expertise" — relabeled "Lightning Reflexes" — at level 5, not the
 * generic file's level 3). The class's own items{} map level is therefore
 * the single source of truth used below, not the generic class-feature
 * file's own `system.level`. (Greater Weapon Specialization, also granted at
 * L15, carries a damage-scaling rule, not a subfeatures.proficiencies entry
 * — it is not a proficiency upgrade and is intentionally absent here.)
 */
const MAGUS_PROFICIENCY_UPGRADES = [
  { level: 5, stat: 'weapons.martial', rank: 2 },
  { level: 5, stat: 'weapons.simple', rank: 2 },
  { level: 5, stat: 'weapons.unarmed', rank: 2 },
  { level: 5, stat: 'reflex', rank: 2 },
  { level: 9, stat: 'perception', rank: 2 },
  { level: 9, stat: 'spellcasting', rank: 2 },
  { level: 9, stat: 'will', rank: 3 },
  { level: 11, stat: 'armor.light', rank: 2 },
  { level: 11, stat: 'armor.medium', rank: 2 },
  { level: 11, stat: 'armor.unarmored', rank: 2 },
  { level: 13, stat: 'weapons.simple', rank: 3 },
  { level: 13, stat: 'weapons.martial', rank: 3 },
  { level: 13, stat: 'weapons.unarmed', rank: 3 },
  { level: 15, stat: 'fortitude', rank: 3 },
  { level: 17, stat: 'spellcasting', rank: 3 },
  { level: 17, stat: 'armor.light', rank: 3 },
  { level: 17, stat: 'armor.medium', rank: 3 },
  { level: 17, stat: 'armor.unarmored', rank: 3 },
];

/**
 * Kineticist proficiency-rank upgrades by character level (r18-N2a). Same
 * derivation method as MAGUS_PROFICIENCY_UPGRADES: the vendor kineticist.json
 * `items{}` map is the SOURCE OF TRUTH for the level each feature is granted
 * (the generic class-feature file's own `system.level` is shared across
 * classes and is NOT authoritative), cross-referenced with each referenced
 * class-feature file's `system.subfeatures.proficiencies` map (rank numbers
 * are TEML: 1=trained, 2=expert, 3=master, 4=legendary). Every rank below was
 * read directly from the corresponding class-feature file's own
 * `system.subfeatures.proficiencies` (vendor/pf2e/packs/pf2e/class-features/):
 *
 *   - L3  Will Expertise        → will-expertise.json            → will:2
 *   - L7  Kinetic Durability    → kinetic-durability.json        → fortitude:3
 *   - L7  Kinetic Expertise     → kinetic-expertise.json         → kineticist(classDC):2
 *   - L9  Perception Expertise  → perception-expertise.json      → perception:2
 *   - L11 Weapon Expertise      → weapon-expertise.json          → weapons.simple:2, weapons.unarmed:2
 *   - L13 Light Armor Expertise → light-armor-expertise.json     → armor.light:2, armor.unarmored:2
 *   - L15 Kinetic Mastery       → kinetic-mastery.json           → kineticist(classDC):3
 *   - L15 Greater Kinetic Durability → greater-kinetic-durability.json → fortitude:4
 *   - L19 Kinetic Legend        → kinetic-legend.json            → kineticist(classDC):4
 *   - L19 Light Armor Mastery   → light-armor-mastery.json       → armor.light:3, armor.unarmored:3
 *
 * The kineticist's class-DC ("impulse attack") is what the vendor subfeatures
 * map calls the `kineticist` stat — mapped here to `classDC`, the Fusion
 * proficiencyUpgrades vocabulary for a class's own DC. Weapon Specialization
 * (L7/L13) scales damage rather than a proficiency rank (empty subfeatures
 * proficiencies) and is intentionally absent, as are the Gate's Threshold /
 * Impulse-slot features (no proficiency-rank subfeature).
 * Acceptance anchor (Finn, level 3, Pathbuilder): Will Expertise makes Will
 * EXPERT at L3 (will:2) — the single upgrade that lands by level 3.
 *
 * r18-N2c fix: each `classDC` upgrade below is mirrored by an `impulse`
 * upgrade at the SAME level/rank. Rage of Elements p.14 ("Your impulse
 * attack roll uses the same proficiency and attribute modifier as your
 * kineticist class DC") means impulse and classDC are the SAME rank at
 * every level, not just at level 1 — Kinetic Expertise (L7), Kinetic
 * Mastery (L15) and Kinetic Legend (L19) upgrade both together. The
 * elemental-blast derivation (elementalBlast.ts effectiveImpulseRank) reads
 * `stat === "impulse"` specifically — it does NOT fall back to `classDC` —
 * so without the mirrored entries the Elemental Blast attack stays frozen
 * at Trained past level 7 even though the class DC (and the sheet's
 * class-DC display) correctly upgrades.
 */
const KINETICIST_PROFICIENCY_UPGRADES = [
  { level: 3, stat: 'will', rank: 2 },
  { level: 7, stat: 'fortitude', rank: 3 },
  { level: 7, stat: 'classDC', rank: 2 },
  { level: 7, stat: 'impulse', rank: 2 },
  { level: 9, stat: 'perception', rank: 2 },
  { level: 11, stat: 'weapons.simple', rank: 2 },
  { level: 11, stat: 'weapons.unarmed', rank: 2 },
  { level: 13, stat: 'armor.light', rank: 2 },
  { level: 13, stat: 'armor.unarmored', rank: 2 },
  { level: 15, stat: 'classDC', rank: 3 },
  { level: 15, stat: 'impulse', rank: 3 },
  { level: 15, stat: 'fortitude', rank: 4 },
  { level: 19, stat: 'classDC', rank: 4 },
  { level: 19, stat: 'impulse', rank: 4 },
  { level: 19, stat: 'armor.light', rank: 3 },
  { level: 19, stat: 'armor.unarmored', rank: 3 },
];

/**
 * Class-slug → static proficiency-upgrade table. Magus (R10-B) and Kineticist
 * (r18-N2a) are populated; other classes fall back to an empty array (no
 * upgrades derived) until their own packs are imported.
 */
const CLASS_PROFICIENCY_UPGRADES = {
  magus: MAGUS_PROFICIENCY_UPGRADES,
  kineticist: KINETICIST_PROFICIENCY_UPGRADES,
};

/**
 * Class-slug → spellcasting progression table. Only Magus is populated for
 * R10-B.
 */
const CLASS_SPELLCASTING_TABLES = {
  magus: {
    tradition: 'arcane',
    type: 'prepared',
    ability: 'int',
    cantripsKnown: MAGUS_SPELLCASTING_TABLE.map(({ level, cantrips }) => ({ level, count: cantrips })),
    slots: MAGUS_SPELLCASTING_TABLE.map(({ level, slots }) => ({ level, slots })),
  },
};

/** Derives a class slug from its Fusion document name (lowercase, ascii). */
function classSlugFromName(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Cache of `class-features-core`'s normalized docs, keyed by document name.
 * Populated lazily the first time a class doc needs to resolve a
 * featuresByLevel reference. Not a stats/state variable — pure memoization.
 */
let classFeatureNameToIdCache = null;

/**
 * Looks up the pf2e source `_id` of a class-feature document by its display
 * name, reading `out/class-features/normalized.json` — the normalize.mjs
 * output for the vendor's `class-features` pack (the INTERMEDIATE pack this
 * pipeline stage reads from; `class-features-core` is the CURATED pack name
 * build-mvp-subset.mjs will write to in R10-B and is used only as the
 * `deriveFusionId` namespace below, matching what that later stage will use
 * for the same source doc). normalize.mjs runs before transform.mjs in the
 * pipeline, so this file exists whenever a build's --packs list includes
 * `class-features` (per the R10 plan's batch order: classes + class-features
 * are always transformed together).
 *
 * WHY name-keyed and not uuid-keyed: the vendor's class `items{}` map (e.g.
 * magus.json) references each granted feature by
 * `uuid: "Compendium.pf2e.classfeatures.Item.<Name>"` — using the feature's
 * DISPLAY NAME as the trailing uuid segment, not its pf2e `_id` (confirmed
 * against magus.json: e.g. "Arcane Spellcasting (Magus)"). The class-feature
 * document's own `_id` (needed for `deriveFusionId('class-features-core',
 * _id)` — the SAME derivation class-features-core's own transform pass uses
 * for its `_id`) is therefore only recoverable by matching on name.
 *
 * Returns `null` (with the raw name kept as a fallback label) when the
 * lookup file is absent (e.g. a --packs run that transforms `classes` in
 * isolation without `class-features`) — callers must tolerate a missing
 * fusionId rather than throw, so classes can still be transformed standalone
 * for local iteration.
 */
function resolveClassFeatureSourceId(name) {
  if (classFeatureNameToIdCache === null) {
    classFeatureNameToIdCache = {};
    const path = join(OUT_DIR, 'class-features', 'normalized.json');
    if (existsSync(path)) {
      try {
        const docs = JSON.parse(readFileSync(path, 'utf8'));
        for (const doc of docs) {
          classFeatureNameToIdCache[doc.name] = doc.pf2eSourceId ?? doc._id;
        }
      } catch { /* leave cache empty — resolveClassFeatureSourceId returns null below */ }
    }
  }
  return classFeatureNameToIdCache[name] ?? null;
}

/**
 * Extracts the trailing segment of a vendor compendium uuid, which is the
 * REAL class-feature document name (as filed in the classfeatures
 * compendium) — e.g. "Compendium.pf2e.classfeatures.Item.Reflex Expertise"
 * → "Reflex Expertise". This is NOT always the same string as the items{}
 * map entry's own `name` field: a class can grant a shared feature under a
 * class-specific display label (confirmed against magus.json: entry name
 * "Lightning Reflexes" has uuid "...Item.Reflex Expertise"; "Greater Weapon
 * Specialization (Level 15)" has uuid "...Item.Greater Weapon
 * Specialization"). The uuid segment is therefore the correct join key for
 * resolveClassFeatureSourceId, while the map entry's own `name` is preserved
 * as the Fusion ref's display `name` (the class-specific label).
 */
function classFeatureNameFromUuid(uuid) {
  const marker = 'Compendium.pf2e.classfeatures.Item.';
  return typeof uuid === 'string' && uuid.startsWith(marker) ? uuid.slice(marker.length) : null;
}

/**
 * Converts the vendor's `items{}` class-feature map into Fusion
 * `featuresByLevel[]` entries. Each entry's `uuid` is the fusionId the
 * referenced class-feature document will have once the `class-features`
 * vendor pack is transformed — resolved via `resolveClassFeatureSourceId`
 * (real doc name → pf2e `_id`, see classFeatureNameFromUuid) then the SAME
 * `deriveFusionId('class-features', _id)` call the `class-features` pack's
 * own transform pass uses for its own `_id` (REQ-CMP-041 determinism:
 * fusionId is namespaced by the INPUT vendor pack name — same convention as
 * every other pack, e.g. `pf2e.weapons-core`'s committed docs are
 * `deriveFusionId('equipment', sourceId)`, not `deriveFusionId('weapons-core',
 * sourceId)` — the curated pack slug is a build-mvp-subset.mjs concept only
 * and never participates in fusionId derivation).
 *
 * When the class-features lookup is unavailable (see
 * resolveClassFeatureSourceId — e.g. transforming `classes` standalone
 * without `class-features` in the same --packs run), `uuid` falls back
 * to a deterministic `"unresolved:<name>"` placeholder rather than an empty
 * string, so the ref still satisfies ClassFeatureRefSchema's
 * `uuid: z.string().min(1)` (systems/pf2e/src/schemas/item-equipment.ts).
 * A real build MUST include both packs in the same run (per the R10 plan's
 * batch order) so every ref resolves to a real fusionId.
 */
function classFeatureRefsFromItemsMap(itemsMap, classFeaturesPackKey) {
  const entries = Object.values(itemsMap ?? {});
  return entries
    .map((entry) => {
      const realName = classFeatureNameFromUuid(entry.uuid) ?? entry.name;
      const sourceId = resolveClassFeatureSourceId(realName);
      return {
        level: entry.level,
        uuid: sourceId ? deriveFusionId(classFeaturesPackKey, sourceId) : `unresolved:${entry.name}`,
        name: entry.name,
      };
    })
    .sort((a, b) => a.level - b.level);
}

/**
 * Normalizes a vendor `class` document into the Fusion ClassSystemSchema
 * shape (R10-A). `docName` is the Fusion document's own top-level `name`
 * (e.g. "Magus") — the vendor's class `system.*` object carries no `name`
 * field of its own, so this must come from the caller (`normDoc.name`).
 */
function normalizeClassSystem(system, src, docName) {
  const slug = classSlugFromName(docName);
  // Namespace for deriveFusionId — MUST be the vendor input pack name
  // ("class-features"), matching what processPack() uses as fusionIdPackKey
  // when it later transforms that pack's own docs (see docstring above).
  const classFeaturesPackKey = 'class-features';

  const featLevels = {
    ancestry: src.ancestryFeatLevels?.value ?? [],
    class: src.classFeatLevels?.value ?? [],
    general: src.generalFeatLevels?.value ?? [],
    skill: src.skillFeatLevels?.value ?? [],
  };

  const trainedSkills = {
    value: src.trainedSkills?.value ?? [],
    additional: src.trainedSkills?.additional ?? 0,
  };

  const savingThrows = {};
  if (src.savingThrows?.fortitude !== undefined) savingThrows.fortitude = src.savingThrows.fortitude;
  if (src.savingThrows?.reflex !== undefined) savingThrows.reflex = src.savingThrows.reflex;
  if (src.savingThrows?.will !== undefined) savingThrows.will = src.savingThrows.will;

  const defenses = {};
  for (const [key, val] of Object.entries(src.defenses ?? {})) {
    defenses[key] = val;
  }

  const attacks = {};
  for (const [key, val] of Object.entries(src.attacks ?? {})) {
    if (key === 'other') continue; // vendor "other" is a {name, rank} custom-category slot — not a fixed Fusion stat
    attacks[key] = val;
  }

  // Drop the vendor's raw `items` map (system.items) before spreading `system`
  // below — it is superseded by `featuresByLevel[]` (the Fusion-shaped
  // equivalent, resolved to fusionIds) and, critically, its entries carry
  // RAW Paizo art paths (e.g. "systems/pf2e/icons/features/classes/...webp")
  // that never went through normalize.mjs's placeholder substitution (that
  // pass only rewrites the DOCUMENT's own top-level `img`, not arbitrary
  // nested maps inside `system.*`). Leaving it in would both duplicate data
  // already covered by featuresByLevel and leak proprietary art paths into a
  // committed pack (REQ-LEG art policy). Same treatment for the vendor's
  // other raw `*FeatLevels`/`trainedSkills` wrapper fields, now fully
  // superseded by the Fusion-shaped `featLevels`/`trainedSkills` below.
  const {
    items: _rawItemsMap,
    ancestryFeatLevels: _rawAncestryFeatLevels,
    classFeatLevels: _rawClassFeatLevels,
    generalFeatLevels: _rawGeneralFeatLevels,
    skillFeatLevels: _rawSkillFeatLevels,
    ...restSystem
  } = system;

  return {
    ...restSystem,
    hp: src.hp ?? system.hp,
    keyAbility: src.keyAbility?.value ?? system.keyAbility ?? [],
    perception: src.perception ?? system.perception ?? 0,
    savingThrows,
    defenses,
    attacks,
    // Every class is Trained (rank 1) in its own class DC — a rule fact the
    // vendor class docs don't carry as a field (final r10 audit issue #1:
    // the old `?? 0` default shipped every class untrained, and
    // stepCharApplyClass would overwrite the manual rank with it).
    classDC: src.classDC ?? system.classDC ?? 1,
    // Impulse-attack proficiency rank at level 1 (Kineticist only; r18-N2c
    // fix). Rage of Elements p.14: "Your impulse attack roll uses the same
    // proficiency and attribute modifier as your kineticist class DC" — so
    // impulse starts Trained (rank 1) at level 1, same as classDC above, and
    // is NOT a vendor field either (same gap as classDC's own comment).
    // Every other class defaults to 0 (no impulses) via the schema default.
    ...(slug === 'kineticist' ? { impulse: src.impulse ?? system.impulse ?? 1 } : {}),
    featLevels,
    skillIncreaseLevels: src.skillIncreaseLevels?.value ?? [],
    trainedSkills,
    proficiencyUpgrades: CLASS_PROFICIENCY_UPGRADES[slug] ?? [],
    spellcasting: CLASS_SPELLCASTING_TABLES[slug],
    featuresByLevel: classFeatureRefsFromItemsMap(src.items, classFeaturesPackKey),
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
  };
}

// ---------------------------------------------------------------------------
// ancestry (R10-A AncestrySystemSchema; R10-B / DEC-R10-06)
//
// Vendor ancestry.boosts/flaws are keyed maps ({"0": {value:[...]}, ...}) of
// CHOICE GROUPS (a set of ability slugs the player picks one from — "free"
// meaning any ability). Fusion's AncestrySystemSchema instead models
// `boosts`/`flaws` as a flat array of resolved slugs (one per slot); a group
// with more than one candidate ability (a player choice) is preserved as the
// literal slug "free" — the actual choice is a per-character `system.build`
// decision (DEC-R10-01), not a class/ancestry-level fact.
// ---------------------------------------------------------------------------

/** Flattens a vendor boosts/flaws keyed-group map to an array of Fusion slugs. */
function flattenAncestryBoostGroups(groupMap) {
  const groups = Object.values(groupMap ?? {});
  return groups.map((group) => {
    const options = group?.value ?? [];
    // A single fixed ability boost (e.g. ["dex"]) resolves to that slug;
    // a group with multiple options (player choice) resolves to "free".
    return options.length === 1 ? options[0] : 'free';
  });
}

// Ancestry/heritage/background feature-grant placeholder — these embedded
// `system.items` entries represent granted feats (ancestryfeatures compendium
// entries), matching the same fusion type used for feats/classFeature docs.
const ANCESTRY_ITEM_GRANT_PLACEHOLDER_IMG = 'icons/placeholder/feat.svg';

/**
 * Sanitizes the vendor's `system.items` keyed map (ancestry/heritage/
 * background feature grants — e.g. Ratfolk's "Sharp Teeth", Fleshwarp's
 * "Unusual Anatomy"). Unlike normalizeClassSystem (which drops `items`
 * entirely because it is fully superseded by `featuresByLevel`), these packs
 * have no Fusion-shaped equivalent for the grant list yet, so the map itself
 * (uuid/name/level — data future grants may consume) is preserved. Only the
 * vendor's raw `img` is replaced: those paths point straight at Paizo/Foundry
 * art (e.g. "systems/pf2e/icons/default-icons/feat.svg") that never went
 * through normalize.mjs's placeholder substitution, since that pass only
 * rewrites the DOCUMENT's own top-level `img`, not arbitrary nested maps
 * inside `system.*` (clean-room / REQ-LEG art policy).
 */
function sanitizeItemGrantsMap(itemsMap) {
  if (!itemsMap || typeof itemsMap !== 'object') return itemsMap;
  const sanitized = {};
  for (const [key, entry] of Object.entries(itemsMap)) {
    sanitized[key] = { ...entry, img: ANCESTRY_ITEM_GRANT_PLACEHOLDER_IMG };
  }
  return sanitized;
}

function normalizeAncestrySystem(system, src) {
  return {
    ...system,
    hp: src.hp ?? system.hp,
    speed: src.speed ?? system.speed ?? 25,
    size: src.size ?? system.size ?? 'med',
    boosts: flattenAncestryBoostGroups(src.boosts),
    flaws: flattenAncestryBoostGroups(src.flaws),
    languages: { value: src.languages?.value ?? [] },
    vision: src.vision ?? system.vision ?? 'normal',
    items: sanitizeItemGrantsMap(src.items ?? system.items),
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
  };
}

// ---------------------------------------------------------------------------
// heritage (R10-A HeritageSystemSchema; R10-B / DEC-R10-06)
// Heritages are effect-rule carriers with no dedicated mechanical fields
// beyond what HeritageSystemSchema already exposes — passthrough is enough.
// ---------------------------------------------------------------------------

function normalizeHeritageSystem(system, src) {
  return {
    ...system,
    items: sanitizeItemGrantsMap(src.items ?? system.items),
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
  };
}

// ---------------------------------------------------------------------------
// background (R10-A BackgroundSystemSchema; R10-B / DEC-R10-06)
//
// Vendor backgrounds grant skill training via `trainedSkills.value` (skill
// slugs, always trained rank 1) plus optional `trainedSkills.lore` (Lore
// subcategory names, e.g. "Fireworks Lore" — modeled as Fusion Lore items,
// not part of BackgroundSystemSchema.skills, which only covers the 16
// canonical skills). `boosts` uses the same keyed-group shape as ancestries.
// ---------------------------------------------------------------------------

function normalizeBackgroundSystem(system, src) {
  const skills = {};
  for (const slug of src.trainedSkills?.value ?? []) {
    skills[slug] = { value: 1 }; // backgrounds always grant trained (rank 1)
  }

  return {
    ...system,
    boosts: flattenAncestryBoostGroups(src.boosts),
    skills,
    items: sanitizeItemGrantsMap(src.items ?? system.items),
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits: src.traits ?? system.traits ?? { rarity: 'common', value: [] },
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

  // `material` is present on vendor generic equipment (incl. SF2e
  // augmentations, which the real compendium models as type "equipment")
  // as `{grade: null, type: null}` for unworked items — same bug class as
  // normalizeWeaponSystem.material: explicit nulls must become `undefined`,
  // not pass through as `null`. EquipmentSystemSchema accepts it via
  // `.passthrough()` either way, but the shape should stay consistent with
  // weapon/armor.
  const rawMaterial = src.material ?? system.material;
  const material =
    rawMaterial && typeof rawMaterial === 'object'
      ? { grade: rawMaterial.grade ?? undefined, type: rawMaterial.type ?? undefined }
      : undefined;

  // `baseItem` is `null` on most vendor equipment (only precious-material/
  // runed variants of a base item set it to a string) — r18-N2d bugfix, same
  // bug class as `material`: keep the field consistent (string or undefined,
  // never a bare `null`) across weapon/armor/equipment normalizers.
  const rawBaseItem = src.baseItem ?? system.baseItem;
  const baseItem = typeof rawBaseItem === 'string' ? rawBaseItem : undefined;

  // Vendor `bulk` on container-shaped items (backpack, and any "equipment"/
  // "container" doc that holds other items) carries extra keys beyond the
  // common `{value}` wrapper — `capacity` (max Bulk it can hold) and
  // `ignored`/`heldOrStowed` (Bulk exempted from the wearer's own limit,
  // i.e. ContainerSystemSchema's `bulkReduction`) — see Spacious Pouch /
  // Backpack vendor docs (r18-N2d bugfix). Only derived when present so
  // ordinary non-container equipment (bulk as a bare `{value}` or a plain
  // number) is unaffected.
  const rawBulk = src.bulk ?? system.bulk;
  const hasContainerBulkShape = rawBulk && typeof rawBulk === 'object' && 'capacity' in rawBulk;
  const capacity = hasContainerBulkShape ? rawBulk.capacity ?? 0 : undefined;
  const bulkReduction = hasContainerBulkShape ? rawBulk.ignored ?? 0 : undefined;

  const out = {
    ...system,
    bulk: rawBulk?.value ?? rawBulk ?? 0,
    level: src.level?.value ?? src.level ?? system.level ?? 0,
    price: src.price?.value ?? src.price ?? system.price ?? {},
    quantity: src.quantity ?? system.quantity ?? 1,
    usage,
    size: src.size ?? system.size ?? 'med',
    hp: src.hp ?? system.hp,
    hardness: src.hardness ?? system.hardness,
    material,
    description: src.description?.value ?? src.description ?? system.description ?? '',
    publication: src.publication ?? system.publication,
    traits,
    baseItem,
  };

  if (hasContainerBulkShape) {
    out.capacity = capacity;
    out.bulkReduction = bulkReduction;
  }

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
      const { fusionDoc, pf2eId, fusionId } = transformDoc(normDoc, packName, stats, fusionIdPackKey, system);

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

  // Keep in sync with extract.mjs/normalize.mjs defaults and the README —
  // r10 final audit found this list stale (missing the R10-B builder packs),
  // which made a default `node src/transform.mjs` run silently reuse STALE
  // out/<pack>/transformed.json for feats/classes/etc. in the next build.
  const DEFAULT_PACKS_BY_SYSTEM = {
    pf2e: [
      'conditions', 'equipment', 'spells', 'pathfinder-monster-core',
      'classes', 'class-features', 'feats', 'ancestries', 'heritages', 'backgrounds',
      'actions',
    ],
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
