/**
 * @fusion/system-pf2e — Spellcasting derivation.
 *
 * Derives per-entry spell DC / spell attack from each `spellcastingEntry`
 * item on the character, populating `system.derived.spellcasting`
 * (CONTRACT 2 — see task brief).
 *
 * Clean-room: ORC/OGL mechanics only.
 * REQ-PF2-017, REQ-PF2-080..083.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import type { DeriveStep } from "@fusion/system-api";
import { resolveStatisticMulti, proficiencyBonus } from "./helpers.js";

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc["system"] as Record<string, unknown>) ?? {};
}

function getDerived(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = getSystem(doc);
  if (!sys["derived"] || typeof sys["derived"] !== "object") {
    sys["derived"] = {};
  }
  return sys["derived"] as Record<string, unknown>;
}

function getLevel(sys: Record<string, unknown>): number {
  const level = sys["level"] as { value?: number } | undefined;
  return level?.value ?? 1;
}

/** Read `system.ability` tolerating both `{ value: "int" }` and a plain string. */
function readAbility(itemSys: Record<string, unknown>): string {
  const ability = itemSys["ability"];
  if (typeof ability === "string") return ability;
  if (ability && typeof ability === "object") {
    const value = (ability as { value?: unknown }).value;
    if (typeof value === "string") return value;
  }
  return "int";
}

/** Read `system.proficiency` tolerating both `{ value: 1 }` and a plain number. */
function readProficiencyRank(itemSys: Record<string, unknown>): number {
  const proficiency = itemSys["proficiency"];
  if (typeof proficiency === "number") return proficiency;
  if (proficiency && typeof proficiency === "object") {
    const value = (proficiency as { value?: unknown }).value;
    if (typeof value === "number") return value;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// STEP (derived phase): spellcasting DC/attack per entry
// REQ-PF2-017, REQ-PF2-080..083
// ---------------------------------------------------------------------------

/**
 * Derive spell DC/attack for every `spellcastingEntry` item.
 *
 * Reads:  system.derived.abilityMods, system.level, doc.items
 * Writes: system.derived.spellcasting
 */
export const stepCharSpellcasting: DeriveStep = {
  id: "pf2e.character.derived.spellcasting",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: ["system.derived.abilityMods", "system.level"],
  writes: ["system.derived.spellcasting"],

  run(doc, ctx) {
    const sys = getSystem(doc);
    const derived = getDerived(doc);
    const abilityMods = derived["abilityMods"] as Record<string, number> | undefined;
    const level = getLevel(sys);

    const result: Record<string, { dc: number; attack: number; ability: string; rank: number }> =
      {};

    const rawItems = doc["items"];
    if (Array.isArray(rawItems)) {
      for (const raw of rawItems) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        if (item["type"] !== "spellcastingEntry") continue;

        const entryId = (item["_id"] as string | undefined) ?? "";
        const itemSys = (item["system"] as Record<string, unknown> | undefined) ?? {};

        const ability = readAbility(itemSys);
        const rank = readProficiencyRank(itemSys);
        const abilityMod = abilityMods?.[ability] ?? 0;
        const base = abilityMod + proficiencyBonus(rank, level);

        const stat = resolveStatisticMulti(
          "spell-attack",
          base,
          ["spell-attack-roll", "attack-roll"],
          ctx.synthetics,
          ctx.rollOptions,
        );

        result[entryId] = {
          dc: 10 + stat.total,
          attack: stat.total,
          ability,
          rank,
        };
      }
    }

    derived["spellcasting"] = result;
  },
};
