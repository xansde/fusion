/**
 * @fusion/system-pf2e — Formulas of the "class levels" multiclass variant.
 *
 * Pure functions over the (class level, character level) pair. No document
 * access, no side effects — so every one of them is exhaustively testable,
 * which is exactly what REQ-MCL-200 demands.
 *
 * Every threshold and bonus these read comes from `./params.ts`. Nothing is
 * hard-coded here; re-balancing the house rule means editing params, then
 * re-running the 204-pair sweep.
 *
 * Under single class (`classLevel === characterLevel`) every formula here
 * reproduces RAW exactly (REQ-MCL-202) — that is a tested property, not a
 * hope.
 *
 * Clean-room: house rule by Igor (Wayfinder), used with permission and
 * attribution; PF2e mechanics are ORC/OGL facts, never copied text.
 *
 * Spec: 30-multiclasse-por-niveis.md §6.7, §7.1.
 */

import {
  DEDICATION_SPELL_RANK_BY_LEVEL,
  EFFECTIVE_RANK_DIVISOR,
  GRANTED_ACTOR_CLASS_LEVEL_BONUS,
  MAX_CHARACTER_LEVEL,
  SUMMON_CLASS_LEVEL_BONUS,
} from "./params.js";

/**
 * Spell rank the FREE archetype route grants at `characterLevel` — the
 * balance floor of REQ-MCL-200.
 *
 * Staircase lookup: the highest threshold at or below the level. Returns 0
 * below the first threshold (the free route grants no slot yet).
 */
export function dedicationSpellRank(characterLevel: number): number {
  let rank = 0;
  for (const entry of DEDICATION_SPELL_RANK_BY_LEVEL) {
    if (entry.characterLevel <= characterLevel && entry.rank > rank) {
      rank = entry.rank;
    }
  }
  return rank;
}

/**
 * Effective rank a cantrip / focus spell / slot spell is cast at under the
 * variant: `ceil(characterLevel / 2)` (REQ-MCL-061).
 *
 * Note this reads the CHARACTER level, not the class level — a `Fighter 4 /
 * Wizard 1` casts their wizard cantrips at rank 3, same as any level-5
 * character. The class level governs how MANY slots they get (the native
 * class table), never how hard the spell hits.
 */
export function effectiveSpellRank(characterLevel: number): number {
  return Math.ceil(characterLevel / EFFECTIVE_RANK_DIVISOR);
}

/**
 * Rank for a spell carrying the `summon` or `incarnate` trait (REQ-MCL-062):
 *
 *   min( max( ceil(classLevel/2) + bonus , dedicationRank(characterLevel) ) ,
 *        effectiveSpellRank(characterLevel) )
 *
 * Three clauses, three jobs:
 *   - `ceil(classLevel/2) + bonus` — what the class level itself earns;
 *   - `max(..., dedicationRank)`   — the floor: never worse than the free
 *     archetype route would have given at this character level. This clause
 *     is the whole of REQ-MCL-200 on this axis;
 *   - `min(..., effectiveSpellRank)` — the ceiling: a dip never out-summons
 *     what the character's own level supports.
 *
 * Summoning is singled out because it is the one axis where a dip's output
 * scales with the creature's level rather than the caster's numbers, so an
 * uncapped formula lets a 1-level dip conjure at full power.
 */
export function summonSpellRank(classLevel: number, characterLevel: number): number {
  const earned = Math.ceil(classLevel / EFFECTIVE_RANK_DIVISOR) + SUMMON_CLASS_LEVEL_BONUS;
  const floor = dedicationSpellRank(characterLevel);
  const ceiling = effectiveSpellRank(characterLevel);
  return Math.min(Math.max(earned, floor), ceiling);
}

/**
 * Level of an actor granted by a class — animal companion, familiar, eidolon
 * (REQ-MCL-063): `min(classLevel + bonus, characterLevel)`.
 *
 * Single class collapses to `min(L + 2, L) === L`, i.e. exactly RAW: the
 * companion is the master's level (REQ-MCL-202).
 */
export function grantedActorLevel(classLevel: number, characterLevel: number): number {
  return Math.min(classLevel + GRANTED_ACTOR_CLASS_LEVEL_BONUS, characterLevel);
}

/**
 * Traits that put a spell on the capped summoning axis (REQ-MCL-062).
 *
 * Scope is decided BY TRAIT, never by a curated list of spell names
 * (REQ-MCL-064): a curated list silently omits every spell added later, and
 * omission here reads as "uncapped", which is the failure direction that
 * matters.
 */
const SUMMON_AXIS_TRAITS = ["summon", "incarnate"] as const;

/**
 * The rank a spell is cast at under the variant.
 *
 * Summon/incarnate spells take the capped route (REQ-MCL-062); everything
 * else — cantrips, focus spells, ordinary slot spells — is cast at the
 * character's effective rank (REQ-MCL-061).
 *
 * Spells whose slots come from an ARCHETYPE run RAW with no elevation at all
 * (REQ-MCL-065): the free archetype route is the baseline the variant is
 * measured against, so elevating it too would move the very floor the
 * balance invariant stands on.
 */
export function spellcastRank(
  traits: readonly string[],
  classLevel: number,
  characterLevel: number,
  options: { fromArchetype?: boolean; nativeRank?: number } = {},
): number {
  if (options.fromArchetype === true)
    return options.nativeRank ?? dedicationSpellRank(characterLevel);
  const onSummonAxis = traits.some((trait) =>
    (SUMMON_AXIS_TRAITS as readonly string[]).includes(trait),
  );
  return onSummonAxis
    ? summonSpellRank(classLevel, characterLevel)
    : effectiveSpellRank(characterLevel);
}

/**
 * How much the variant lifted a caster above their class's native rank —
 * the number the sheet shows as "elevation gained" (REQ-MCL-067).
 *
 * Zero for a single-class caster, always (REQ-MCL-202).
 */
export function rankElevation(nativeRank: number, characterLevel: number): number {
  return Math.max(0, effectiveSpellRank(characterLevel) - nativeRank);
}

/**
 * Every `(classLevel, characterLevel)` pair the invariant sweep must cover:
 * `1 ≤ classLevel ≤ characterLevel` and `4 ≤ characterLevel ≤ 20` — the
 * "204 pairs" of REQ-MCL-200.
 *
 * Character levels below 4 are excluded because the free archetype route
 * grants no spell slot there, so there is no floor to compare against.
 *
 * Exported (rather than inlined in the test) so that any NEW capped axis can
 * reuse the same enumeration and cannot quietly sample instead of sweeping —
 * REQ-MCL-201.
 */
export function invariantPairs(
  maxCharacterLevel: number = MAX_CHARACTER_LEVEL,
): Array<{ classLevel: number; characterLevel: number }> {
  const pairs: Array<{ classLevel: number; characterLevel: number }> = [];
  for (let characterLevel = 4; characterLevel <= maxCharacterLevel; characterLevel++) {
    for (let classLevel = 1; classLevel <= characterLevel; classLevel++) {
      pairs.push({ classLevel, characterLevel });
    }
  }
  return pairs;
}
