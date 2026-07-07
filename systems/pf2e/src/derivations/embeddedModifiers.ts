/**
 * @fusion/system-pf2e — Generalized scanner for FlatModifiers carried by
 * embedded rule-bearing items (feat / heritage / classFeature / ancestry).
 *
 * Origin (r16-G1 → r18-N2b): `stepCharSpeed` first proved the pattern —
 * embedded feats/heritages/classFeatures/ancestries carry `system.rules[]`
 * FlatModifier entries (the real on-disk pack shape uses `kind:"flat-modifier"`;
 * hand-authored EffectRule fixtures use `type:"flatModifier"`) whose `selector`
 * targets a derived statistic (e.g. Fleet → `land-speed`). NOTHING in the
 * generic EffectSource/Synthetics pipeline visits these item types (only
 * `type:"condition"` items become EffectSources — see
 * packages/server/src/net/derive-runner.ts materializeEffectSources), so those
 * modifiers silently vanish unless a derive step scans `doc.items` directly.
 *
 * This module lifts that scan out of speed.ts so other statistics can reuse it
 * WITHOUT touching the generic pipeline (a much larger blast radius). r18-N2b's
 * first consumer beyond speed: the Toughness feat's
 *   { kind:"flat-modifier", selector:"hp", value:"@actor.level" }
 * rule (HP max +level), which must reach `system.derived.hp.max`.
 *
 * Value expressions: the pack shape allows string expressions like
 * `@actor.level`. This scanner resolves the small, closed set the MVP feats
 * actually use (`@actor.level` → the character level passed by the caller);
 * any other non-numeric expression degrades to 0 (skipped) rather than being
 * mis-evaluated — a conservative posture matching the rest of this package's
 * malformed-input handling (r11).
 *
 * Clean-room: ORC/OGL mechanics only (the stacking table + selector semantics
 * are facts of the rule system, already implemented in engine-2e). No Foundry
 * code copied.
 * REQ-PF2-012, REQ-PF2-021.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import { resolveStacking, type Modifier } from "@fusion/engine-2e";
import type { ModifierBreakdown } from "./types.js";
import { isEquippedFlag } from "./equipment.js";

/** Item types that may carry `system.rules[]` and are embedded (not equipment). */
export const RULE_CARRYING_EMBEDDED_TYPES = new Set([
  "feat",
  "heritage",
  "classFeature",
  "ancestry",
]);

/** One resolved FlatModifier extracted from an embedded item's rules. */
export interface EmbeddedModifierSource {
  readonly slug: string;
  readonly label: string;
  readonly type: string;
  readonly value: number;
}

/**
 * A single raw rule entry as persisted on an item's `system.rules[]`.
 *
 * Real pack docs use `kind` (kebab-case, importer's ModifierDescriptor shape —
 * spec 16). `type` (camelCase, value `"flatModifier"`) is tolerated for
 * hand-authored EffectRule fixtures that predate the importer's `kind`
 * convention.
 */
interface RawRule {
  readonly kind?: unknown;
  readonly type?: unknown;
  readonly key?: unknown;
  readonly selector?: unknown;
  readonly value?: unknown;
  readonly mode?: unknown;
  readonly modifierType?: unknown;
  readonly slug?: unknown;
  readonly label?: unknown;
}

function isFlatModifierRule(rule: RawRule): boolean {
  // `kind` = importer's normalized shape; `type:"flatModifier"` = hand-authored
  // EffectRule fixtures; `key:"FlatModifier"` = the raw vendor pack shape (as
  // used by the Toughness feat straight from vendor JSON, unnormalized).
  return (
    rule.kind === "flat-modifier" ||
    rule.type === "flatModifier" ||
    rule.key === "FlatModifier"
  );
}

/**
 * Level value expressions the vendor packs / importer use interchangeably for
 * "the character's level". The raw vendor shape is `@actor.level`; the importer
 * normalizes it to the full actor-data path `@actor.details.level.value` (each
 * rule's `raw.value` preserves the original `@actor.level`). Both — plus the
 * intermediate `@actor.level.value` — must resolve to the character level.
 *
 * r20 verificação viva: a compendium-materialized Toughness carried the
 * normalized `@actor.details.level.value`, which the resolver did not recognize,
 * so its `hp` FlatModifier silently degraded to +0 and Finn's HP stuck at 46
 * instead of 49. The hand-authored fixtures only ever used `@actor.level`, so
 * the unit tests never caught the divergence.
 */
const LEVEL_VALUE_EXPRESSIONS: ReadonlySet<string> = new Set([
  "@actor.level",
  "@actor.level.value",
  "@actor.details.level.value",
]);

/**
 * Resolve a rule's `value` into a number. Numeric values pass through; the
 * closed set of level expressions in {@link LEVEL_VALUE_EXPRESSIONS} resolves to
 * the character `level`; any other string expression (an unsupported `@actor.*`
 * path or arithmetic) degrades to 0 so a feat we don't fully model can't inject
 * a wrong bonus. `context.level` is the only actor field the MVP feats reference.
 */
function resolveRuleValue(raw: unknown, context: { level: number }): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (LEVEL_VALUE_EXPRESSIONS.has(trimmed)) return context.level;
    const asNumber = Number(trimmed);
    if (!Number.isNaN(asNumber)) return asNumber;
  }
  return 0;
}

function matchesSelector(selector: unknown, wanted: ReadonlySet<string>): boolean {
  if (typeof selector === "string") return wanted.has(selector);
  if (Array.isArray(selector)) {
    return selector.some((s) => typeof s === "string" && wanted.has(s));
  }
  return false;
}

/**
 * Extract FlatModifiers matching `selectors` from one embedded item's
 * `system.rules[]`.
 *
 * Guarded like every other embedded-item reader in this package (r11
 * malformed-input posture): a feat authored outside the schema (missing
 * `rules`, non-array `rules`, a rule missing `value`) degrades to "no
 * modifiers from this item" instead of throwing mid-derive.
 */
function modifiersFromItem(
  item: Record<string, unknown>,
  selectors: ReadonlySet<string>,
  context: { level: number },
  fallbackLabel: string,
): EmbeddedModifierSource[] {
  const itemSys = item["system"] as Record<string, unknown> | undefined;
  const rawRules = itemSys?.["rules"];
  if (!Array.isArray(rawRules)) return [];

  const itemName = typeof item["name"] === "string" ? item["name"] : fallbackLabel;
  const itemId = typeof item["_id"] === "string" ? item["_id"] : itemName;

  const results: EmbeddedModifierSource[] = [];
  let index = 0;
  for (const raw of rawRules as RawRule[]) {
    index += 1;
    if (!raw || typeof raw !== "object") continue;
    if (!isFlatModifierRule(raw)) continue;
    if (!matchesSelector(raw.selector, selectors)) continue;

    const value = resolveRuleValue(raw.value, context);
    if (value === 0) continue;

    const modType =
      typeof raw.modifierType === "string"
        ? raw.modifierType
        : typeof raw.type === "string" && raw.type !== "flatModifier"
          ? raw.type
          : "untyped";

    const slug =
      typeof raw.slug === "string" && raw.slug.length > 0
        ? raw.slug
        : `${itemId}-${String(index)}`;
    const label = typeof raw.label === "string" && raw.label.length > 0 ? raw.label : itemName;

    results.push({ slug, label, type: modType, value });
  }
  return results;
}

/**
 * Scan `doc.items` for feat/heritage/classFeature/ancestry items and collect
 * every FlatModifier they carry whose `selector` is one of `selectors`.
 *
 * @param doc         The actor document.
 * @param selectors   The selector strings to match (e.g. `["hp"]`, or
 *                    `["land-speed", "speed"]`).
 * @param context     `{ level }` for resolving `@actor.level` value expressions.
 * @param fallbackLabel Display label when an item/rule carries no name/label.
 */
export function collectEmbeddedModifiers(
  doc: Record<string, unknown>,
  selectors: ReadonlySet<string>,
  context: { level: number },
  fallbackLabel = "Modifier",
): EmbeddedModifierSource[] {
  const rawItems = doc["items"];
  if (!Array.isArray(rawItems)) return [];

  const results: EmbeddedModifierSource[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (!RULE_CARRYING_EMBEDDED_TYPES.has(item["type"] as string)) continue;
    results.push(...modifiersFromItem(item, selectors, context, fallbackLabel));
  }
  return results;
}

/**
 * Scan `doc.items` for EQUIPPED physical gear (anything NOT in
 * {@link RULE_CARRYING_EMBEDDED_TYPES} — i.e. equipment / weapon / armor /
 * shield / consumable / treasure — that passes {@link isEquippedFlag}) and
 * collect every FlatModifier it carries whose `selector` is one of `selectors`.
 *
 * Complements {@link collectEmbeddedModifiers}: feats/heritages/classFeatures/
 * ancestries are never "equipped", and worn/held gear is never one of those
 * embedded types, so the two scans cover disjoint item sets and can be summed
 * without double-counting. This is how a worn magic item (e.g. Boots of
 * Bounding: a +5-foot land-speed item bonus) reaches a derived statistic —
 * mirroring how stepCharAc reads the equipped armor's bonus.
 *
 * r20 verificação viva: Finn's Speed stuck at 25 instead of 30 because the
 * +5 land-speed came from Boots of Bounding (type `equipment`), which the
 * feat-only scan skipped. Guarded on `isEquippedFlag` so unequipped gear
 * contributes nothing — the same equipped predicate the AC/strikes collector
 * uses (investiture is not modelled in the MVP; `equipped` is the only state).
 *
 * @param doc         The actor document.
 * @param selectors   The selector strings to match (e.g. `["land-speed", "speed"]`).
 * @param context     `{ level }` for resolving `@actor.level`-style value expressions.
 * @param fallbackLabel Display label when an item/rule carries no name/label.
 */
export function collectEquippedEquipmentModifiers(
  doc: Record<string, unknown>,
  selectors: ReadonlySet<string>,
  context: { level: number },
  fallbackLabel = "Modifier",
): EmbeddedModifierSource[] {
  const rawItems = doc["items"];
  if (!Array.isArray(rawItems)) return [];

  const results: EmbeddedModifierSource[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    // Embedded rule-bearing items are the OTHER scan's territory; skip them so
    // the two callers never see the same source twice.
    if (RULE_CARRYING_EMBEDDED_TYPES.has(item["type"] as string)) continue;
    const itemSys = item["system"] as Record<string, unknown> | undefined;
    if (!isEquippedFlag(itemSys)) continue;
    results.push(...modifiersFromItem(item, selectors, context, fallbackLabel));
  }
  return results;
}

/**
 * Convenience: apply PF2e stacking to a collected list and return both the
 * stacked sum and the breakdown for UI display. Mirrors what
 * stepCharAc/stepCharSaves/stepCharSpeed do inline.
 */
export function stackEmbeddedModifiers(sources: EmbeddedModifierSource[]): {
  sum: number;
  modifiers: ModifierBreakdown[];
} {
  const asModifiers: Modifier[] = sources.map((s) => ({
    slug: s.slug,
    type: s.type,
    value: s.value,
  }));
  const sum = resolveStacking(asModifiers);
  const modifiers: ModifierBreakdown[] = sources.map((s) => ({
    slug: s.slug,
    label: s.label,
    type: s.type,
    value: s.value,
  }));
  return { sum, modifiers };
}
