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
 * Value expressions: the pack shape allows string expressions for "character
 * level". The REAL on-disk importer output normalizes Toughness's value to
 * `"@actor.details.level.value"` (verified live in
 * systems/pf2e/packs/feats-core/documents.json) while the raw vendor
 * `raw.value` field (kept for provenance, unused by this scanner) and some
 * hand-authored EffectRule fixtures instead use the shorter `"@actor.level"`.
 * r19-W0 BUG: this scanner only recognized the short form, so Toughness's
 * bonus silently resolved to 0 against the real pack shape — HP stayed at the
 * base total (PV 46) instead of +level (PV 49). Both forms now resolve to
 * `context.level`; any other non-numeric expression still degrades to 0
 * (skipped) rather than being mis-evaluated — a conservative posture matching
 * the rest of this package's malformed-input handling (r11).
 *
 * Clean-room: ORC/OGL mechanics only (the stacking table + selector semantics
 * are facts of the rule system, already implemented in engine-2e). No Foundry
 * code copied.
 * REQ-PF2-012, REQ-PF2-021.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import { resolveStacking, type Modifier } from "@fusion/engine-2e";
import type { ModifierBreakdown } from "./types.js";

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
 * The known "character level" value expressions across pack shapes:
 *   - `@actor.details.level.value` — the real importer-normalized shape
 *     (systems/pf2e/packs/feats-core/documents.json Toughness rule, r19-W0).
 *   - `@actor.level` — the shorter hand-authored EffectRule fixture shape
 *     that predates the importer's normalization (still tolerated).
 */
const LEVEL_VALUE_EXPRESSIONS = new Set(["@actor.details.level.value", "@actor.level"]);

/**
 * Resolve a rule's `value` into a number. Numeric values pass through; either
 * known level expression (see `LEVEL_VALUE_EXPRESSIONS`) resolves to the
 * character `level`; any other string expression (an unsupported `@actor.*`
 * path or arithmetic) degrades to 0 so a feat we don't fully model can't
 * inject a wrong bonus. `context.level` is the only actor field the MVP feats
 * reference.
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
 * @param context     `{ level }` for resolving level value expressions (see
 *                    `LEVEL_VALUE_EXPRESSIONS`).
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
