/**
 * @fusion/system-sf2e — NPC derivation steps.
 *
 * Mirrors `systems/pf2e/src/derivations/npc.ts` verbatim (REQ-SF2-004: NPCs
 * use flat values from their statblock, identical shape to PF2e — confirmed
 * by inspecting the real SF2e bestiary data, see `schemas/actor-npc.ts`
 * docstring). The derivation pipeline only applies condition/effect
 * modifiers on top of the stored totals; NPC totals are stored directly
 * (not computed from TEML + level), so `base` = stored value.
 *
 * Derived selectors used:
 *   "ac"           → general AC modifiers (off-guard, suppressed, etc.)
 *   "saving-throw" → broad save modifier
 *   "fortitude" / "reflex" / "will" → specific save modifier
 *   "perception"   → perception modifier
 *   "skill:<slug>" → individual skill modifier
 *   "skill-check"  → broad skill modifier
 *
 * Clean-room: ORC/OGL mechanics only.
 * REQ-SF2-002, REQ-SF2-004.
 * Spec: 18-sistema-sf2e.md (NpcSystem schema section).
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

import type { DeriveStep } from "@fusion/system-api";
import { resolveStatisticMulti } from "./helpers.js";
import type { NpcSystem } from "../schemas/actor-npc.js";
import type { NpcDerived } from "./types.js";

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

function getNpcSystem(doc: Record<string, unknown>): NpcSystem {
  return doc["system"] as Record<string, unknown> as unknown as NpcSystem;
}

function getDerived(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = doc["system"] as Record<string, unknown>;
  if (!sys["derived"] || typeof sys["derived"] !== "object") {
    sys["derived"] = {};
  }
  return sys["derived"] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// STEP 1 (derived phase): NPC AC with modifiers
// ---------------------------------------------------------------------------

/**
 * Apply condition/effect modifiers to the NPC's stored AC total.
 *
 * Reads:  system.attributes.ac.value
 * Writes: system.derived.ac
 */
export const stepNpcAc: DeriveStep = {
  id: "sf2e.npc.derived.ac",
  documentType: "Actor",
  subtypes: ["npc"],
  phase: "derived",
  reads: ["system.attributes.ac.value"],
  writes: ["system.derived.ac"],

  run(doc, ctx) {
    const sys = getNpcSystem(doc);
    const derived = getDerived(doc);
    const base = sys.attributes.ac.value;

    const stat = resolveStatisticMulti("ac", base, ["ac"], ctx.synthetics, ctx.rollOptions);

    derived["ac"] = { total: stat.total, modifiers: stat.modifiers };
  },
};

// ---------------------------------------------------------------------------
// STEP 2 (derived phase): NPC HP
// ---------------------------------------------------------------------------

/**
 * Propagate HP values to derived (no computation needed for NPCs).
 *
 * Reads:  system.attributes.hp
 * Writes: system.derived.hp
 */
export const stepNpcHp: DeriveStep = {
  id: "sf2e.npc.derived.hp",
  documentType: "Actor",
  subtypes: ["npc"],
  phase: "derived",
  reads: ["system.attributes.hp"],
  writes: ["system.derived.hp"],

  run(doc, _ctx) {
    const sys = getNpcSystem(doc);
    const derived = getDerived(doc);
    derived["hp"] = {
      value: sys.attributes.hp.value,
      max: sys.attributes.hp.max,
      temp: sys.attributes.hp.temp,
    };
  },
};

// ---------------------------------------------------------------------------
// STEP 3 (derived phase): NPC Perception
// ---------------------------------------------------------------------------

/**
 * Apply modifiers to NPC perception (stored as a flat mod).
 *
 * Reads:  system.attributes.perception.mod
 * Writes: system.derived.perception
 */
export const stepNpcPerception: DeriveStep = {
  id: "sf2e.npc.derived.perception",
  documentType: "Actor",
  subtypes: ["npc"],
  phase: "derived",
  reads: ["system.attributes.perception.mod"],
  writes: ["system.derived.perception"],

  run(doc, ctx) {
    const sys = getNpcSystem(doc);
    const derived = getDerived(doc);
    const base = sys.attributes.perception.mod;

    const stat = resolveStatisticMulti(
      "perception",
      base,
      ["perception"],
      ctx.synthetics,
      ctx.rollOptions,
    );

    derived["perception"] = { total: stat.total, modifiers: stat.modifiers };
  },
};

// ---------------------------------------------------------------------------
// STEP 4 (derived phase): NPC Saves
// ---------------------------------------------------------------------------

/**
 * Apply modifiers to the NPC's flat save totals.
 *
 * Reads:  system.saves
 * Writes: system.derived.saves
 */
export const stepNpcSaves: DeriveStep = {
  id: "sf2e.npc.derived.saves",
  documentType: "Actor",
  subtypes: ["npc"],
  phase: "derived",
  reads: ["system.saves"],
  writes: ["system.derived.saves"],

  run(doc, ctx) {
    const sys = getNpcSystem(doc);
    const derived = getDerived(doc);

    const savesResult: Record<
      string,
      { total: number; modifiers: NpcDerived["saves"]["fortitude"]["modifiers"] }
    > = {};

    for (const saveName of ["fortitude", "reflex", "will"] as const) {
      const base = sys.saves[saveName]?.value ?? 0;
      const stat = resolveStatisticMulti(
        saveName,
        base,
        [saveName, "saving-throw"],
        ctx.synthetics,
        ctx.rollOptions,
      );
      savesResult[saveName] = { total: stat.total, modifiers: stat.modifiers };
    }

    derived["saves"] = savesResult;
  },
};

// ---------------------------------------------------------------------------
// STEP 5 (derived phase): NPC Skills
// ---------------------------------------------------------------------------

/**
 * Apply modifiers to NPC skills (stored as flat `base` totals).
 *
 * The 18-skill SF2e set (incl. computers/piloting) is accepted transparently
 * — this loop iterates whatever the statblock provides, same as PF2e.
 *
 * Reads:  system.skills
 * Writes: system.derived.skills
 */
export const stepNpcSkills: DeriveStep = {
  id: "sf2e.npc.derived.skills",
  documentType: "Actor",
  subtypes: ["npc"],
  phase: "derived",
  reads: ["system.skills"],
  writes: ["system.derived.skills"],

  run(doc, ctx) {
    const sys = getNpcSystem(doc);
    const derived = getDerived(doc);

    const skillsResult: Record<
      string,
      { total: number; modifiers: NpcDerived["saves"]["fortitude"]["modifiers"] }
    > = {};

    for (const [slug, skillData] of Object.entries(sys.skills ?? {})) {
      const base = (skillData as { base: number }).base ?? 0;
      const stat = resolveStatisticMulti(
        slug,
        base,
        [`skill:${slug}`, "skill-check"],
        ctx.synthetics,
        ctx.rollOptions,
      );
      skillsResult[slug] = { total: stat.total, modifiers: stat.modifiers };
    }

    derived["skills"] = skillsResult;
  },
};

// ---------------------------------------------------------------------------
// All NPC derivation steps
// ---------------------------------------------------------------------------

export const NPC_DERIVE_STEPS: DeriveStep[] = [
  stepNpcAc,
  stepNpcHp,
  stepNpcPerception,
  stepNpcSaves,
  stepNpcSkills,
];
