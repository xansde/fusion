/**
 * @fusion/system-pf2e — HP FlatModifier derivation (Toughness & friends).
 *
 * PF2e feats like Toughness raise the character's HP maximum via a
 * FlatModifier on the `hp` selector:
 *   { key:"FlatModifier", selector:"hp", value:"@actor.level" }   (Toughness)
 * The generic EffectSource/Synthetics pipeline never visits embedded
 * feat/heritage/classFeature/ancestry items (only `type:"condition"` items
 * become EffectSources — derive-runner.ts materializeEffectSources), so these
 * `hp` FlatModifiers were silently dropped — exactly the same gap
 * `stepCharSpeed` closed for `land-speed` (r16-G1). r18-N2b reuses the SAME
 * generalized embedded-item scanner (embeddedModifiers.ts) here for `hp`.
 *
 * Ordering: this step runs in the BASE phase, reading `system.derived.hp`
 * (written by stepCharHp, also base) and writing it back with the Toughness
 * bonus folded into `max` and `value` (a fresh full-HP character shows the
 * boosted total). Running in the base phase — before the derived-phase
 * `stepCharDrainedHp` reads `system.derived.hp` — means drained's temporary
 * reduction correctly applies ON TOP of the Toughness-boosted max (PF2e RAW:
 * Toughness is a permanent max-HP increase; drained is a temporary reduction
 * of the current max). Keeping both writers of `system.derived.hp` (stepCharHp
 * and this step) in the same phase lets topoSort order them by the
 * stepCharHp.writes → stepCharToughness.reads edge (stepCharToughness never
 * writes anything stepCharHp reads, so there is no cycle). stepCharDrainedHp is
 * a separate phase and is never compared against these two.
 *
 * Stacking: HP bonuses from multiple sources stack per PF2e RAW (there is no
 * "highest untyped bonus wins" rule for HP the way there is for skill/speed
 * bonuses — HP-max increases are simply additive). We therefore SUM every
 * matched `hp` FlatModifier rather than routing through resolveStacking's
 * highest-wins table; the MVP only ever has one (Toughness), but summing is the
 * correct general behavior.
 *
 * Clean-room: ORC/OGL mechanics only. No Foundry code copied.
 * REQ-PF2-021.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import type { DeriveStep } from "@fusion/system-api";
import type { CharacterSystem } from "../schemas/actor-character.js";
import { collectEmbeddedModifiers } from "./embeddedModifiers.js";

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

/** Selector this step cares about: `hp` (max-HP FlatModifiers, e.g. Toughness). */
const HP_SELECTORS = new Set(["hp"]);

/**
 * Fold `hp` FlatModifiers from embedded feats/heritages/classFeatures/
 * ancestries into `system.derived.hp.max` (and bump `.value` by the same
 * amount when the character is at full HP, so a freshly built Toughness
 * character shows the boosted total rather than sitting "below max").
 *
 * Reads:  system.derived.hp, system.level, doc.items
 * Writes: system.derived.hp
 */
export const stepCharToughness: DeriveStep = {
  id: "pf2e.character.base.toughnessHp",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  // "system.derived.hp" must match stepCharHp.writes' exact string so this
  // step is ordered AFTER it (topo-sort edges are exact-string membership
  // tests — see packages/system-api/src/derive.ts topoSort()).
  reads: ["system.derived.hp", "system.level"],
  writes: ["system.derived.hp"],

  run(doc) {
    const sys = getCharSystem(doc);
    const derived = getDerived(doc);
    const level = getLevel(sys);

    const existingHp = derived["hp"] as
      | { value: number; max: number; temp: number; drainedHpReduction: number }
      | undefined;
    if (!existingHp) return; // stepCharHp did not run — nothing to boost.

    const sources = collectEmbeddedModifiers(doc, HP_SELECTORS, { level }, "HP Bonus");
    if (sources.length === 0) return;

    // HP-max bonuses are additive (no highest-wins table for HP) — sum them.
    const bonus = sources.reduce((acc, s) => acc + s.value, 0);
    if (bonus === 0) return;

    const wasFull = existingHp.value >= existingHp.max;
    const newMax = existingHp.max + bonus;
    derived["hp"] = {
      value: wasFull ? newMax : existingHp.value,
      max: newMax,
      temp: existingHp.temp,
      drainedHpReduction: existingHp.drainedHpReduction,
    };
  },
};
