/**
 * @fusion/system-pf2e — Speed derivation (land speed + other movement types).
 *
 * BUG (r16-G1 user report): "Fleet não está concedendo bônus de movimentação."
 * Fleet's pack RE is correctly normalized —
 *   { kind: "flat-modifier", selector: "land-speed", value: 5, mode: "add",
 *     type: "untyped" }
 * — on the embedded feat item's `system.rules[]`, but NOTHING in the derive
 * pipeline ever reads it: `stepCharCollectEquipment` only materializes
 * weapons/armor, and the effects-engine EffectSource pipeline
 * (`derive-runner.ts` materializeEffectSources) only converts embedded
 * `type:"condition"` items into EffectSources — feats/heritages/ancestries/
 * classFeatures are never visited for effect purposes. So `land-speed`
 * FlatModifiers from embedded items silently vanish; the sheet just shows the
 * raw `system.speed.value` (25 for a Ratfolk) forever, no matter how many
 * Speed-boosting feats are taken.
 *
 * This step closes that specific gap WITHOUT touching the generic
 * EffectSource/Synthetics pipeline (that would mean editing
 * packages/server/src/net/derive-runner.ts, outside this batch's territory
 * and a much larger blast radius affecting every selector, not just speed).
 * Instead it scans `doc.items` directly for the same four "embedded, rules-
 * carrying" item types stepCharArchetypeClassDCs already scans one of
 * (feat) — feat / heritage / classFeature / ancestry — extracts their
 * `system.rules[]` entries with `kind === "flat-modifier"` (the real,
 * on-disk pack shape; `type === "flatModifier"` is also accepted for the
 * hand-authored EffectRule shape used by schemas-item.test.ts fixtures) whose
 * `selector` matches "land-speed" or the broad "speed", and applies PF2e
 * stacking (`resolveStacking` from @fusion/engine-2e — same untyped/typed
 * rules AC and saves already use) on top of the base `system.speed.value`.
 *
 * Two untyped FlatModifiers (e.g. two different Speed feats) correctly SUM
 * (PF2e RAW: untyped penalties stack, but the r16-G1 case in point — untyped
 * BONUSES do NOT stack, highest wins per PF2E_STACKING_TABLE). Two same-typed
 * bonuses (e.g. two "status" Speed bonuses) do NOT stack — only the highest
 * applies — exactly mirroring stepCharAc/stepCharSaves.
 *
 * Reads:  system.speed, doc.items (feat/heritage/classFeature/ancestry)
 * Writes: system.derived.speed
 *
 * Clean-room: ORC/OGL mechanics only (stacking table is a fact of the rule
 * system, already implemented in engine-2e). No Foundry code copied.
 * REQ-PF2-012.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import type { DeriveStep } from "@fusion/system-api";
import { resolveStacking, type Modifier } from "@fusion/engine-2e";
import type { CharacterSystem } from "../schemas/actor-character.js";
import type { ModifierBreakdown } from "./types.js";

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc["system"] as Record<string, unknown>) ?? {};
}

function getCharSystem(doc: Record<string, unknown>): CharacterSystem {
  return getSystem(doc) as unknown as CharacterSystem;
}

function getDerived(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = getSystem(doc);
  if (!sys["derived"] || typeof sys["derived"] !== "object") {
    sys["derived"] = {};
  }
  return sys["derived"] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Embedded-item rule scanning
// ---------------------------------------------------------------------------

/** Item types that may carry `system.rules[]` and are embedded (not equipment). */
const RULE_CARRYING_EMBEDDED_TYPES = new Set(["feat", "heritage", "classFeature", "ancestry"]);

/** One resolved FlatModifier extracted from an embedded item's rules. */
interface SpeedModifierSource {
  readonly slug: string;
  readonly label: string;
  readonly type: string;
  readonly value: number;
}

/**
 * A single raw rule entry as persisted on an item's `system.rules[]`.
 *
 * Real pack docs use `kind` (kebab-case, importer's ModifierDescriptor shape
 * — spec 16). `type` (camelCase) is tolerated for hand-authored EffectRule
 * fixtures (schemas-item.test.ts style) that predate the importer's `kind`
 * convention (see schema-primitives.ts EffectRuleSchema docstring).
 */
interface RawRule {
  readonly kind?: unknown;
  readonly type?: unknown;
  readonly selector?: unknown;
  readonly value?: unknown;
  readonly mode?: unknown;
  readonly modifierType?: unknown;
  readonly slug?: unknown;
  readonly label?: unknown;
}

function isFlatModifierRule(rule: RawRule): boolean {
  return rule.kind === "flat-modifier" || rule.type === "flatModifier";
}

/** Selectors this step cares about: the specific "land-speed" and the broad "speed". */
const SPEED_SELECTORS = new Set(["land-speed", "speed"]);

function matchesSpeedSelector(selector: unknown): boolean {
  if (typeof selector === "string") return SPEED_SELECTORS.has(selector);
  if (Array.isArray(selector)) {
    return selector.some((s) => typeof s === "string" && SPEED_SELECTORS.has(s));
  }
  return false;
}

/**
 * Extract land-speed/speed FlatModifiers from one embedded item's
 * `system.rules[]`.
 *
 * Guarded like every other embedded-item reader in this package (r11
 * malformed-input posture): a feat authored outside the schema (missing
 * `rules`, non-array `rules`, a rule missing `value`) degrades to "no
 * modifiers from this item" instead of throwing mid-derive.
 */
function speedModifiersFromItem(item: Record<string, unknown>): SpeedModifierSource[] {
  const itemSys = item["system"] as Record<string, unknown> | undefined;
  const rawRules = itemSys?.["rules"];
  if (!Array.isArray(rawRules)) return [];

  const itemName = typeof item["name"] === "string" ? item["name"] : "Speed Modifier";
  const itemId = typeof item["_id"] === "string" ? item["_id"] : itemName;

  const results: SpeedModifierSource[] = [];
  let index = 0;
  for (const raw of rawRules as RawRule[]) {
    index += 1;
    if (!raw || typeof raw !== "object") continue;
    if (!isFlatModifierRule(raw)) continue;
    if (!matchesSpeedSelector(raw.selector)) continue;

    const value = typeof raw.value === "number" ? raw.value : 0;
    if (value === 0) continue;

    const modType =
      typeof raw.modifierType === "string"
        ? raw.modifierType
        : typeof raw.type === "string" && raw.type !== "flatModifier"
          ? raw.type
          : "untyped";

    const slug =
      typeof raw.slug === "string" && raw.slug.length > 0 ? raw.slug : `${itemId}-${String(index)}`;
    const label = typeof raw.label === "string" && raw.label.length > 0 ? raw.label : itemName;

    results.push({ slug, label, type: modType, value });
  }
  return results;
}

/**
 * Scan `doc.items` for feat/heritage/classFeature/ancestry items and collect
 * every land-speed/speed FlatModifier they carry.
 */
function collectSpeedModifiers(doc: Record<string, unknown>): SpeedModifierSource[] {
  const rawItems = doc["items"];
  if (!Array.isArray(rawItems)) return [];

  const results: SpeedModifierSource[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (!RULE_CARRYING_EMBEDDED_TYPES.has(item["type"] as string)) continue;
    results.push(...speedModifiersFromItem(item));
  }
  return results;
}

// ---------------------------------------------------------------------------
// STEP (derived phase): land speed + other movement types
// REQ-PF2-012
// ---------------------------------------------------------------------------

/**
 * Derive `system.derived.speed` from the base `system.speed.value` plus any
 * land-speed/speed FlatModifiers carried by embedded feats, heritages, class
 * features, or ancestry items — applying PF2e stacking (untyped bonuses:
 * highest-only; other types: highest-bonus/lowest-penalty per type; PF2E
 * RAW — same table stepCharAc/stepCharSaves already use).
 *
 * `otherSpeeds` (climb/swim/fly/burrow) are passed through unmodified for
 * MVP — only land speed is a common early-feat target (Fleet, ancestry
 * feats, etc.); non-land speed modifiers are out of this batch's scope.
 *
 * Runs in the "derived" phase (after effects, alongside AC/saves/etc.) even
 * though it does not currently consume `ctx.synthetics` — this keeps it
 * ordered consistently with the rest of the derived-statistic steps and
 * leaves room for a future migration onto the generic EffectSource pipeline
 * without moving phases.
 *
 * Reads:  system.speed, doc.items (feat/heritage/classFeature/ancestry)
 * Writes: system.derived.speed
 */
export const stepCharSpeed: DeriveStep = {
  id: "pf2e.character.derived.speed",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: ["system.attributes.speed", "system.speed"],
  writes: ["system.derived.speed"],

  run(doc) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);

    // ROBUSTNESS (audit issue 1 posture): the base land speed may live at
    // `system.attributes.speed` (the real Argiburgo/pack shape — verified in the
    // world DB: Tobias has system.attributes.speed.value = 25 and NO
    // system.speed) OR at `system.speed` (hand-authored/schema fixtures). Prefer
    // attributes.speed, fall back to system.speed, then 0 — reading only
    // system.speed made a Ratfolk's 25 vanish, leaving just the +5 Fleet
    // modifier (sheet showed "5 ft" — r16-G1 verificação viva bug).
    const attrsBlock = (sys["attributes"] as Record<string, unknown> | undefined)?.["speed"] as
      | { value?: number; otherSpeeds?: unknown }
      | undefined;
    const speedBlock = sys["speed"] as { value?: number; otherSpeeds?: unknown } | undefined;
    const baseValue = attrsBlock?.value ?? speedBlock?.value ?? 0;
    const otherSpeeds = Array.isArray(attrsBlock?.otherSpeeds)
      ? attrsBlock.otherSpeeds
      : Array.isArray(speedBlock?.otherSpeeds)
        ? speedBlock.otherSpeeds
        : [];

    const sources = collectSpeedModifiers(doc);
    const asModifiers: Modifier[] = sources.map((s) => ({
      slug: s.slug,
      type: s.type,
      value: s.value,
    }));
    const modSum = resolveStacking(asModifiers);

    const modifiers: ModifierBreakdown[] = sources.map((s) => ({
      slug: s.slug,
      label: s.label,
      type: s.type,
      value: s.value,
    }));

    derived["speed"] = {
      value: baseValue + modSum,
      base: baseValue,
      modifiers,
      otherSpeeds,
    };
  },
};
