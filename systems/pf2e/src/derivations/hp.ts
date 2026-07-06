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
 * Ordering: this step runs in the BASE phase and folds the Toughness bonus into
 * `system.attributes.hp.max` — the SAME raw path `stepCharBuildHp` writes and
 * `stepCharHp` reads. topoSort therefore orders it strictly between them:
 *   stepCharBuildHp.writes(attributes.hp) → stepCharToughness.reads(attributes.hp)
 *   stepCharToughness.writes(attributes.hp) → stepCharHp.reads(attributes.hp)
 * This "write upstream, let the existing consumer read normally" injection
 * (identical to how stepCharBuildAbilities/stepCharBuildHp inject) means the
 * downstream derived-phase steps (stepCharHp → stepCharDrainedHp) need zero
 * changes and there is NO reads/writes cycle: this step never touches
 * `system.derived.hp`, so it can never form an edge with the derived-phase
 * drainedHp step. Applying Toughness to the raw max BEFORE drained is also
 * correct RAW: Toughness permanently raises the max; drained temporarily
 * reduces the (already Toughness-boosted) max.
 *
 * Stacking: HP-max bonuses are additive per PF2e RAW (there is no
 * "highest-untyped-wins" rule for HP the way there is for skill/speed bonuses).
 * We therefore SUM every matched `hp` FlatModifier rather than routing through
 * resolveStacking's highest-wins table; the MVP only ever has one (Toughness),
 * but summing is the correct general behavior.
 *
 * Gate: only fires when there is at least one matching `hp` FlatModifier — a
 * character with no Toughness-like feat is left completely untouched.
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

/** Selector this step cares about: `hp` (max-HP FlatModifiers, e.g. Toughness). */
const HP_SELECTORS = new Set(["hp"]);

/**
 * Fold `hp` FlatModifiers from embedded feats/heritages/classFeatures/
 * ancestries into `system.attributes.hp.max` (bumping `.value` by the same
 * amount when the character is at full HP, so a freshly built Toughness
 * character shows the boosted total rather than sitting "below max").
 *
 * Runs AFTER stepCharBuildHp (which sets attributes.hp.max from the class/
 * ancestry table) and BEFORE stepCharHp (which copies attributes.hp into
 * derived.hp). No-op when no `hp` FlatModifier is present.
 *
 * Reads:  system.attributes.hp, system.level, doc.items
 * Writes: system.attributes.hp
 */
export const stepCharToughness: DeriveStep = {
  id: "pf2e.character.base.toughnessHp",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "base",
  // "system.attributes.hp" must match stepCharBuildHp.writes / stepCharHp.reads
  // exact strings so topoSort orders this strictly between them (edges are
  // exact-string membership tests — see packages/system-api/src/derive.ts).
  reads: ["system.attributes.hp", "system.level"],
  writes: ["system.attributes.hp"],

  run(doc) {
    const sys = getCharSystem(doc);
    const level = getLevel(sys);

    const sources = collectEmbeddedModifiers(doc, HP_SELECTORS, { level }, "HP Bonus");
    if (sources.length === 0) return;

    // HP-max bonuses are additive (no highest-wins table for HP) — sum them.
    const bonus = sources.reduce((acc, s) => acc + s.value, 0);
    if (bonus === 0) return;

    if (!sys.attributes || typeof sys.attributes !== "object") {
      (sys as unknown as Record<string, unknown>)["attributes"] = {};
    }
    const hp = sys.attributes.hp as
      | { value?: number; max?: number; temp?: number }
      | undefined;
    const currentMax = hp?.max ?? 0;
    const currentValue = hp?.value ?? currentMax;
    const wasFull = currentValue >= currentMax;
    const newMax = currentMax + bonus;

    sys.attributes.hp = {
      value: wasFull ? newMax : currentValue,
      max: newMax,
      temp: hp?.temp ?? 0,
    };
  },
};
