/**
 * Initiative formula utilities.
 *
 * Provides:
 *   - defaultInitiativeComparator: the engine's built-in sort order
 *   - sortCombatants: applies a formula's comparator (or the default) to
 *     produce a sorted copy of the combatants array
 *   - GENERIC_1D20_FORMULA_ID: constant id for the built-in formula
 *
 * The actual dice-rolling implementation (generic-1d20) lives in
 * packages/server because it depends on RollService. This file only
 * exports the pure comparator logic that can run on both server and client.
 *
 * Spec: 10-combate-e-iniciativa.md §DEC-CBT-02..04, §REQ-CBT-013..016
 * Spec: 15-api-de-sistemas.md §REQ-SYS-042
 * REQ-ARQ-002: shared must NOT import from server, client, system-api, or systems/*.
 */

import type { CombatantDocument, InitiativeEntry, InitiativeFormula } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * ID of the built-in generic initiative formula.
 * Rolls 1d20 with no modifiers.
 *
 * Systems plug in their own formulas in M3-A. Until then, "generic-1d20" is
 * the only registered formula and applies to all combatTypes.
 *
 * REQ-CBT-012: nucleus defines this as a fallback; system API can override.
 */
export const GENERIC_1D20_FORMULA_ID = "generic-1d20" as const;

// ---------------------------------------------------------------------------
// Default comparator
// ---------------------------------------------------------------------------

/**
 * Default initiative comparator used when a formula does not provide compare().
 *
 * Ordering rules (REQ-CBT-013, DEC-CBT-04):
 *   1. Combatants with initiative=null always sort AFTER those with a value.
 *   2. Among combatants with values: sort by `total` descending (higher = first).
 *   3. Tie in `total`: sort by `tiebreaker` descending (higher = first) when
 *      at least one entry has a tiebreaker defined.
 *   4. Tie in both: preserve original insertion order (stable — caller must
 *      pass entries with a meaningful insertionIndex if stability is needed;
 *      here we return 0 and rely on Array.prototype.sort being stable in V8).
 *
 * This comparator is a total order and safe to pass to Array.prototype.sort().
 *
 * REQ-CBT-016: combatants with initiative=null go to the end.
 */
export function defaultInitiativeComparator(a: InitiativeEntry, b: InitiativeEntry): number {
  const aTotal = a.total === null || !isFinite(a.total) ? null : a.total;
  const bTotal = b.total === null || !isFinite(b.total) ? null : b.total;

  // Rule 1: null values sink to the bottom
  if (aTotal === null && bTotal === null) return 0;
  if (aTotal === null) return 1; // a goes after b
  if (bTotal === null) return -1; // a goes before b

  // Rule 2: sort by total descending
  const diff = bTotal - aTotal;
  if (diff !== 0) return diff;

  // Rule 3: sort by tiebreaker descending
  const aTb = a.tiebreaker ?? undefined;
  const bTb = b.tiebreaker ?? undefined;

  if (aTb !== undefined && bTb !== undefined) {
    const tbDiff = bTb - aTb;
    if (tbDiff !== 0) return tbDiff;
  } else if (aTb !== undefined) {
    return -1; // a has tiebreaker, b does not → a goes first
  } else if (bTb !== undefined) {
    return 1; // b has tiebreaker, a does not → b goes first
  }

  // Rule 4: stable — return 0 (sort is stable in Node.js / V8 since ~v10)
  return 0;
}

// ---------------------------------------------------------------------------
// sortCombatants
// ---------------------------------------------------------------------------

/**
 * Sort a combatants array using the given formula's compare() function, or the
 * default comparator when formula.compare is not provided.
 *
 * Returns a NEW array; the input is NOT mutated.
 *
 * REQ-CBT-016: ordered turns array is derived by applying the comparator.
 * REQ-CBT-013: compare() has precedence over tiebreaker.
 *
 * @param combatants - The raw combatants array from CombatDocument.
 * @param formula    - The active InitiativeFormula (may omit compare).
 * @param tiebreakerMap - Optional map from combatant._id to tiebreaker value,
 *   produced during a batch roll. When absent, tiebreaker is read from nowhere
 *   (the combatant has no tiebreaker stored — it is only used during the sort
 *   that immediately follows a roll result).
 * @returns A new sorted array.
 */
export function sortCombatants(
  combatants: readonly CombatantDocument[],
  formula?: Pick<InitiativeFormula, "compare">,
  tiebreakerMap?: ReadonlyMap<string, number>,
): CombatantDocument[] {
  const entries: Array<{ combatant: CombatantDocument; entry: InitiativeEntry }> = combatants.map(
    (c) => {
      const tb = tiebreakerMap?.get(c._id);
      const entry: InitiativeEntry = {
        combatant: c,
        total: c.initiative,
        ...(tb !== undefined ? { tiebreaker: tb } : {}),
      };
      return { combatant: c, entry };
    },
  );

  const compareFn =
    formula?.compare ??
    ((a: InitiativeEntry, b: InitiativeEntry) => defaultInitiativeComparator(a, b));

  // Wrap the compare function so that null-initiative entries always sink
  // to the bottom even when the formula's compare doesn't handle nulls.
  const safeCompare = (
    a: { combatant: CombatantDocument; entry: InitiativeEntry },
    b: { combatant: CombatantDocument; entry: InitiativeEntry },
  ): number => {
    const aHasInitiative = a.combatant.initiative !== null;
    const bHasInitiative = b.combatant.initiative !== null;

    if (!aHasInitiative && !bHasInitiative) return 0;
    if (!aHasInitiative) return 1;
    if (!bHasInitiative) return -1;

    return compareFn(a.entry, b.entry);
  };

  entries.sort(safeCompare);

  return entries.map((e) => e.combatant);
}

// ---------------------------------------------------------------------------
// activeCombatant helper
// ---------------------------------------------------------------------------

/**
 * Return the combatant at the current turn index, or null if the combat has
 * not started, is ended, or the index is out of bounds.
 *
 * REQ-CBT-020: turnIndex = 0 at startCombat.
 */
export function activeCombatant(
  combatants: readonly CombatantDocument[],
  turnIndex: number,
  started: boolean,
): CombatantDocument | null {
  if (!started || combatants.length === 0) return null;
  const idx = Math.max(0, Math.min(turnIndex, combatants.length - 1));
  return combatants[idx] ?? null;
}

/**
 * Resolve the authoritative active combatant _id from a combatants array and a
 * positional turnIndex.
 *
 * This is computed from the GM's FULL combatants array (the server's view) at
 * each transition and stored on CombatDocument.activeCombatantId so clients can
 * resolve "whose turn it is" by `_id` rather than by index. Player payloads are
 * redacted (hidden combatants stripped), which shifts positions — only an `_id`
 * pointer survives that redaction.
 *
 * Returns null when the combat has not started, is empty, or the index has no
 * combatant.
 *
 * REQ-CBT-042 / REQ-CBT-050: active highlight and turn marker derive from this.
 */
export function computeActiveCombatantId(
  combatants: readonly CombatantDocument[],
  turnIndex: number,
  started: boolean,
): string | null {
  return activeCombatant(combatants, turnIndex, started)?._id ?? null;
}

// ---------------------------------------------------------------------------
// nextTurnIndex helper
// ---------------------------------------------------------------------------

/**
 * Compute the next (turnIndex, round) pair after advancing one turn.
 *
 * Handles:
 *   - skipDefeated: skips combatants with defeated=true.
 *   - Wraps around at the end of the combatants array → increment round.
 *
 * Returns null if there are no eligible combatants (all defeated + skipDefeated).
 *
 * REQ-CBT-021: nextTurn advances turnIndex, wraps to 0 and increments round.
 * REQ-CBT-023: with skipDefeated, defeated combatants are skipped.
 */
export function nextTurnIndex(
  combatants: readonly CombatantDocument[],
  currentTurnIndex: number,
  currentRound: number,
  skipDefeated: boolean,
): { turnIndex: number; round: number } | null {
  const len = combatants.length;
  if (len === 0) return null;

  let turnIndex = currentTurnIndex;
  let round = currentRound;

  // Guard against infinite loop if all combatants are defeated
  let checked = 0;

  do {
    turnIndex += 1;
    if (turnIndex >= len) {
      turnIndex = 0;
      round += 1;
    }
    checked += 1;
    if (checked > len) return null; // all combatants are defeated
  } while (skipDefeated && (combatants[turnIndex]?.defeated ?? false));

  return { turnIndex, round };
}

// ---------------------------------------------------------------------------
// previousTurnIndex helper
// ---------------------------------------------------------------------------

/**
 * Compute the previous (turnIndex, round) pair after going back one turn.
 *
 * REQ-CBT-022: previousTurn recedes; wraps to last and decrements round.
 */
export function previousTurnIndex(
  combatants: readonly CombatantDocument[],
  currentTurnIndex: number,
  currentRound: number,
  skipDefeated: boolean,
): { turnIndex: number; round: number } | null {
  const len = combatants.length;
  if (len === 0) return null;

  let turnIndex = currentTurnIndex;
  let round = currentRound;

  let checked = 0;

  do {
    turnIndex -= 1;
    if (turnIndex < 0) {
      turnIndex = len - 1;
      round = Math.max(1, round - 1);
    }
    checked += 1;
    if (checked > len) return null;
  } while (skipDefeated && (combatants[turnIndex]?.defeated ?? false));

  return { turnIndex, round };
}
