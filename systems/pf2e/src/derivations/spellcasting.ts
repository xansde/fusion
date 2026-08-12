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
import { effectiveRank } from "./build.js";
import {
  resolveClassLevels,
  type EmbeddedClass,
  type ResolvedClassLevels,
} from "../variants/classLevels/levels.js";

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

/** Read `item.flags.fusion.classKey`, when present (see `resolveEntryClass`). */
function readClassKeyFlag(item: Record<string, unknown>): string | undefined {
  const flags = item["flags"];
  if (!flags || typeof flags !== "object") return undefined;
  const fusion = (flags as Record<string, unknown>)["fusion"];
  if (!fusion || typeof fusion !== "object") return undefined;
  const classKey = (fusion as Record<string, unknown>)["classKey"];
  return typeof classKey === "string" ? classKey : undefined;
}

/**
 * Resolve which embedded `type: 'class'` item "owns" a spellcasting entry,
 * for proficiency-progression purposes (issue #13).
 *
 * A multiclass-by-levels entry (built by `chooseClassLevel` in planVM) is
 * stamped with `flags.fusion.classKey` at creation and resolves directly.
 * The PRIMARY class's own entry (built by `applyClass` — every single-class
 * character, and the first class of a multiclass build) is never stamped,
 * so it falls back to the resolved "first class" (`levels.firstClass`), and
 * finally to the sole embedded class item when there is exactly one — the
 * common case, since a single-class character never touches
 * `chooseClassLevel` at all. Returns undefined only when no class item can
 * be attributed (r9 manual-entry actor, or an unresolvable multiclass
 * ambiguity) — the caller keeps the item's stored rank frozen in that case,
 * same as before this fix.
 */
function resolveEntryClass(
  classKey: string | undefined,
  levels: ResolvedClassLevels,
): EmbeddedClass | undefined {
  if (classKey) {
    const owner = levels.classes.get(classKey);
    if (owner) return owner;
  }
  if (levels.firstClass) {
    const owner = levels.classes.get(levels.firstClass);
    if (owner) return owner;
  }
  const all = [...levels.classes.values()];
  return all.length === 1 ? all[0] : undefined;
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

    // Resolved once per run: the embedded class item(s) plus which class
    // level each carries — the same mechanism stepCharApplyClass already
    // uses for weapons/saves/perception/classDC (build.ts effectiveRank).
    // Spellcasting entries never had this applied (issue #13): they were
    // born at `proficiency.value: 1` (trained) by planVM and stayed there
    // for the entry's whole lifetime, up to 6 ranks short of a level-20
    // spellcaster's true (legendary) proficiency.
    const levels = resolveClassLevels(doc, level);

    const rawItems = doc["items"];
    if (Array.isArray(rawItems)) {
      for (const raw of rawItems) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        if (item["type"] !== "spellcastingEntry") continue;

        const entryId = (item["_id"] as string | undefined) ?? "";
        const itemSys = (item["system"] as Record<string, unknown> | undefined) ?? {};

        const ability = readAbility(itemSys);
        const storedRank = readProficiencyRank(itemSys);
        const owner = resolveEntryClass(readClassKeyFlag(item), levels);
        const rank = owner
          ? effectiveRank(
              storedRank,
              "spellcasting",
              owner.system.proficiencyUpgrades ?? [],
              levels.ctx.classLevels[owner.key] ?? level,
            )
          : storedRank;
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
