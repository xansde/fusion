/**
 * @fusion/system-pf2e — Familiar / companion derivation steps.
 *
 * A familiar's statistics are almost entirely a function of its master
 * (spec 29 §1.1 / §3.3, REQ-PET-003/004). The remaster rules the MVP
 * implements for `companionKind: "familiar"` and `"pet"`:
 *
 *   HP          = 5 × master level
 *   AC          = master's AC (before circumstance/status)
 *   Fort/Ref/Will = master's save modifiers
 *   Perception  = master's Perception modifier
 *   Attack mod  = master level + master's spellcasting/key ability modifier
 *   Acrobatics  = master level + master's ability modifier   (default trained)
 *   Stealth     = master level + master's ability modifier   (default trained)
 *   Speed       = 25 ft base (+ fly/climb/etc. from selected abilities — those
 *                 are applied as BaseSpeed effects on the embedded ability
 *                 items, handled by the generic effects pipeline, not here)
 *
 * Cross-actor note (Q-PET-02): the server derivation pipeline is single-actor,
 * so these steps read the master's stats from the `system.master` cache that
 * the client petsVM snapshots from the LIVE master document (see
 * actor-familiar.ts docstring). No master document is read here.
 *
 * `animalCompanion` / `mount` are NOT derived in the MVP (their stats come from
 * a creature-type table — REQ-PET-005, V2). The steps below no-op for them by
 * leaving the authored values in place.
 *
 * Clean-room: remaster (ORC) mechanics only. No Foundry code copied.
 * REQ-PET-003, REQ-PET-004.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import type { DeriveStep } from "@fusion/system-api";
import type { FamiliarSystem } from "../schemas/actor-familiar.js";

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

function getFamiliarSystem(doc: Record<string, unknown>): FamiliarSystem {
  return doc["system"] as Record<string, unknown> as unknown as FamiliarSystem;
}

function getDerived(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = doc["system"] as Record<string, unknown>;
  if (!sys) {
    doc["system"] = {};
  }
  const s = doc["system"] as Record<string, unknown>;
  if (!s["derived"] || typeof s["derived"] !== "object") {
    s["derived"] = {};
  }
  return s["derived"] as Record<string, unknown>;
}

/** True for the two kinds that mirror their master (familiar + generic pet). */
function mirrorsMaster(kind: string | undefined): boolean {
  return kind === "familiar" || kind === "pet";
}

// ---------------------------------------------------------------------------
// STEP: derive the familiar's whole statblock from the master cache.
//
// A single step (rather than one per statistic) keeps the cross-actor formula
// in one legible place; there are no inter-statistic dependencies here.
// ---------------------------------------------------------------------------

export const stepFamiliarDerived: DeriveStep = {
  id: "pf2e.familiar.derived.stats",
  documentType: "Actor",
  subtypes: ["familiar"],
  phase: "derived",
  reads: [
    "system.companionKind",
    "system.master",
    "system.attributes.hp",
    "system.attributes.speed",
    "system.perception.senses",
    "system.selectedAbilities",
  ],
  writes: ["system.derived"],

  run(doc, _ctx) {
    const sys = getFamiliarSystem(doc);
    const derived = getDerived(doc);

    const kind = sys.companionKind ?? "familiar";
    const master = sys.master ?? {
      level: 1,
      abilityMod: 0,
      ac: 10,
      saves: { fortitude: 0, reflex: 0, will: 0 },
      perception: 0,
    };

    // Speed base (25 ft default for familiars/pets); other speeds (fly/climb)
    // come from ability effects, passed through untouched.
    const speedBase = sys.attributes?.speed?.value ?? 25;
    const otherSpeeds = sys.attributes?.speed?.otherSpeeds ?? [];
    const senses = sys.perception?.senses ?? [];

    if (!mirrorsMaster(kind)) {
      // animalCompanion / mount — no master-mirroring in the MVP. Surface the
      // authored values so the sheet still has a `derived` block to read.
      derived["hp"] = {
        value: sys.attributes?.hp?.value ?? 0,
        max: sys.attributes?.hp?.max ?? 0,
        temp: sys.attributes?.hp?.temp ?? 0,
      };
      derived["ac"] = { total: sys.attributes?.ac?.value ?? 10 };
      derived["perception"] = { total: sys.perception?.mod ?? 0, senses };
      derived["saves"] = {
        fortitude: { total: sys.saves?.fortitude?.value ?? 0 },
        reflex: { total: sys.saves?.reflex?.value ?? 0 },
        will: { total: sys.saves?.will?.value ?? 0 },
      };
      derived["attack"] = { total: 0 };
      derived["skills"] = {};
      derived["speed"] = { value: speedBase, otherSpeeds };
      return;
    }

    const level = master.level ?? 1;
    const abilityMod = master.abilityMod ?? 0;

    // HP = 5 × master level (min 0). Current HP is authored (player-editable);
    // clamp it to the derived max so a level-down never leaves value > max.
    const hpMax = Math.max(0, 5 * level);
    const hpValueAuthored = sys.attributes?.hp?.value ?? hpMax;
    const hpValue = Math.min(hpValueAuthored, hpMax);

    derived["hp"] = {
      value: hpValue,
      max: hpMax,
      temp: sys.attributes?.hp?.temp ?? 0,
    };

    derived["ac"] = { total: master.ac ?? 10 };

    derived["perception"] = { total: master.perception ?? 0, senses };

    derived["saves"] = {
      fortitude: { total: master.saves?.fortitude ?? 0 },
      reflex: { total: master.saves?.reflex ?? 0 },
      will: { total: master.saves?.will ?? 0 },
    };

    // Familiar attack (Strike) and default trained skills key off master level
    // + master's spellcasting/key ability modifier.
    const trainedMod = level + abilityMod;
    derived["attack"] = { total: trainedMod };
    derived["skills"] = {
      acrobatics: { total: trainedMod },
      stealth: { total: trainedMod },
    };

    derived["speed"] = { value: speedBase, otherSpeeds };
  },
};

// ---------------------------------------------------------------------------
// All familiar derivation steps
// ---------------------------------------------------------------------------

export const FAMILIAR_DERIVE_STEPS: DeriveStep[] = [stepFamiliarDerived];
