/**
 * @fusion/system-pf2e — Per-entry spellcasting levels under the class-levels
 * variant.
 *
 * The house rule splits one number into three that a single-class caster
 * never had to tell apart:
 *   - CLASS LEVEL      — how many slots you get (the class's native table);
 *   - NATIVE RANK      — the highest slot rank that table gives you;
 *   - EFFECTIVE RANK   — the rank you actually cast at, `ceil(charLevel/2)`.
 *
 * A `Fighter 3 / Wizard 2` gets a level-2 wizard's slots and casts them at
 * rank 3. Printing only "rank 3" would be a lie by omission — REQ-MCL-067
 * requires the sheet to show all of it, which means derivation has to
 * produce all of it.
 *
 * This step ADDS output; it does not touch `derived.spellcasting` (DC and
 * attack), so a world with the variant off is unaffected either way.
 *
 * Clean-room: ORC/OGL mechanics only. House rule by Igor (Wayfinder), used
 * with permission and attribution.
 * Spec: 30-multiclasse-por-niveis.md §6.7.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

import type { DeriveStep } from "@fusion/system-api";
import type { CharacterSystem } from "../schemas/actor-character.js";
import { spellSlotsForLevel } from "./build.js";
import { resolveClassLevels, type EmbeddedClass } from "../variants/classLevels/levels.js";
import { effectiveSpellRank, rankElevation } from "../variants/classLevels/formulas.js";

/** Per-entry spellcasting levels, for the sheet (REQ-MCL-067). */
export interface SpellcastingLevels {
  /** Which class this entry belongs to (`flags.fusion.classKey`), when known. */
  readonly classKey: string | null;
  /** The character's level IN that class — what the native slot table indexes. */
  readonly classLevel: number;
  /** Highest slot rank the class's own table grants at `classLevel`. */
  readonly nativeRank: number;
  /** Rank spells from this entry are actually cast at (REQ-MCL-061). */
  readonly effectiveRank: number;
  /** `effectiveRank − nativeRank`: what the variant added. Zero under RAW. */
  readonly elevation: number;
  /** Archetype entries run RAW with no elevation (REQ-MCL-065). */
  readonly fromArchetype: boolean;
}

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc["system"] as Record<string, unknown>) ?? {};
}

function getDerived(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = getSystem(doc);
  if (!sys["derived"] || typeof sys["derived"] !== "object") sys["derived"] = {};
  return sys["derived"] as Record<string, unknown>;
}

function readFusionFlags(item: Record<string, unknown>): Record<string, unknown> {
  const flags = item["flags"];
  if (!flags || typeof flags !== "object") return {};
  const fusion = (flags as Record<string, unknown>)["fusion"];
  return fusion && typeof fusion === "object" ? (fusion as Record<string, unknown>) : {};
}

/**
 * Which class does this entry belong to?
 *
 * `flags.fusion.classKey` is authoritative when present. It is ABSENT on
 * every entry created before the variant existed — and that is fine, because
 * such a character has exactly one class, so falling back to the sole
 * spellcasting class is not a guess, it is the only answer. With two casting
 * classes and no flag, we decline to guess and return null rather than
 * attribute the entry to whichever class happened to be listed first.
 */
function resolveEntryClass(
  item: Record<string, unknown>,
  casters: readonly EmbeddedClass[],
): EmbeddedClass | undefined {
  const fusion = readFusionFlags(item);
  const classKey = fusion["classKey"];
  if (typeof classKey === "string") {
    const matched = casters.find((candidate) => candidate.key === classKey);
    if (matched) return matched;
  }
  return casters.length === 1 ? casters[0] : undefined;
}

/** Highest rank with at least one slot in a class's native table. */
function nativeRankAt(entry: EmbeddedClass, classLevel: number): number {
  const progression = entry.system.spellcasting;
  if (!progression) return 0;
  const { slotsByRank } = spellSlotsForLevel(progression, classLevel);
  let best = 0;
  for (const [rank, count] of Object.entries(slotsByRank)) {
    const rankNumber = Number(rank);
    if (!Number.isNaN(rankNumber) && rankNumber > best && (count ?? 0) > 0) best = rankNumber;
  }
  return best;
}

/** Does this entry's slots come from an archetype rather than a class? */
function isArchetypeEntry(item: Record<string, unknown>): boolean {
  const fusion = readFusionFlags(item);
  if (fusion["archetype"] === true) return true;
  const build = fusion["build"];
  const slot = build && typeof build === "object" ? (build as { slot?: unknown }).slot : undefined;
  return typeof slot === "string" && slot.includes("archetype");
}

/**
 * Derive per-entry class level / native rank / effective rank / elevation.
 *
 * Reads:  system.level, system.build, doc.items
 * Writes: system.derived.spellcastingLevels
 */
export const stepCharSpellcastingLevels: DeriveStep = {
  id: "pf2e.character.derived.spellcastingLevels",
  documentType: "Actor",
  subtypes: ["character"],
  phase: "derived",
  reads: ["system.level", "system.build"],
  writes: ["system.derived.spellcastingLevels"],

  run(doc) {
    const sys = getSystem(doc) as unknown as CharacterSystem;
    const characterLevel = (sys.level as { value?: number } | undefined)?.value ?? 1;
    const levels = resolveClassLevels(doc, characterLevel);

    const casters = [...levels.classes.values()].filter(
      (entry) => entry.system.spellcasting !== undefined,
    );

    const result: Record<string, SpellcastingLevels> = {};

    const rawItems = doc["items"];
    if (Array.isArray(rawItems)) {
      for (const raw of rawItems) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        if (item["type"] !== "spellcastingEntry") continue;

        const entryId = (item["_id"] as string | undefined) ?? "";
        const owner = resolveEntryClass(item, casters);
        const classKey = owner?.key ?? null;
        const classLevel = owner ? (levels.ctx.classLevels[owner.key] ?? 0) : characterLevel;
        const nativeRank = owner ? nativeRankAt(owner, classLevel) : 0;
        const fromArchetype = isArchetypeEntry(item);

        // Archetype slots run RAW: no elevation, because the free archetype
        // route is the baseline the whole balance invariant measures against
        // (REQ-MCL-065).
        const effective = fromArchetype ? nativeRank : effectiveSpellRank(characterLevel);

        result[entryId] = {
          classKey,
          classLevel,
          nativeRank,
          effectiveRank: effective,
          elevation: fromArchetype ? 0 : rankElevation(nativeRank, characterLevel),
          fromArchetype,
        };
      }
    }

    getDerived(doc)["spellcastingLevels"] = result;
  },
};
