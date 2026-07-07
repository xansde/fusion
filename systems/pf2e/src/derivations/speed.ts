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
import type { CharacterSystem } from "../schemas/actor-character.js";
import {
  collectEmbeddedModifiers,
  collectEquippedEquipmentModifiers,
  stackEmbeddedModifiers,
} from "./embeddedModifiers.js";

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc["system"] as Record<string, unknown>) ?? {};
}

function getCharSystem(doc: Record<string, unknown>): CharacterSystem {
  return getSystem(doc) as unknown as CharacterSystem;
}

function getLevel(sys: CharacterSystem): number {
  const level = sys.level as { value?: number } | undefined;
  return level?.value ?? 1;
}

function getDerived(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = getSystem(doc);
  if (!sys["derived"] || typeof sys["derived"] !== "object") {
    sys["derived"] = {};
  }
  return sys["derived"] as Record<string, unknown>;
}

/**
 * Selectors this step cares about: the specific "land-speed" and the broad
 * "speed". Extraction/stacking is delegated to the generalized embedded-item
 * scanner (embeddedModifiers.ts) — the same one Toughness's `hp` FlatModifier
 * uses (r18-N2b).
 */
const SPEED_SELECTORS = new Set(["land-speed", "speed"]);

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

    const level = getLevel(sys);
    // Feats/heritages/classFeatures/ancestries (e.g. Fleet) AND equipped gear
    // (e.g. Boots of Bounding's +5-foot land-speed item bonus) both feed land
    // speed. The two scans cover disjoint item sets, so concatenating them
    // before stacking cannot double-count.
    const featSources = collectEmbeddedModifiers(doc, SPEED_SELECTORS, { level }, "Speed Modifier");
    const gearSources = collectEquippedEquipmentModifiers(
      doc,
      SPEED_SELECTORS,
      { level },
      "Speed Modifier",
    );
    const { sum: modSum, modifiers } = stackEmbeddedModifiers([...featSources, ...gearSources]);

    derived["speed"] = {
      value: baseValue + modSum,
      base: baseValue,
      modifiers,
      otherSpeeds,
    };
  },
};
