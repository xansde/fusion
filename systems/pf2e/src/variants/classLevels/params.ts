/**
 * @fusion/system-pf2e — Tunable parameters of the "class levels" variant.
 *
 * EVERY number the house rule can be re-balanced on lives in this file, and
 * nowhere else. The formulas in `formulas.ts` read from here; no derivation
 * step hard-codes a threshold, a cap or a bonus.
 *
 * That separation is deliberate. This is a HOUSE RULE, not a published rule:
 * the table is expected to tweak it after play, and a tweak must be "edit a
 * number, re-run the invariant sweep" — never a refactor of derivation code.
 * If you find yourself adding a magic number to a formula, add it here first.
 *
 * After changing anything in this file, run:
 *   pnpm --filter @fusion/system-pf2e test class-levels
 * The 204-pair invariant sweep (REQ-MCL-200) is what tells you whether the
 * new numbers still hold the balance floor. It is not decoration.
 *
 * Clean-room: the PF2e side of these numbers (archetype spell-rank cadence)
 * is a fact of the published rules (ORC/OGL). The house rule itself is
 * original design by Igor (Wayfinder project), used with the author's
 * permission (2026-08-01) and with attribution.
 *
 * Spec: 30-multiclasse-por-niveis.md §3, §6.7, §7.1.
 */

/**
 * Highest character level the variant supports (Σ of class levels).
 *
 * Kept as a parameter rather than a literal so a table wanting to playtest
 * beyond 20 changes one number and lets the test suite report what breaks
 * (class progression tables stop at 20, so expect breakage — that is the
 * point of finding out here instead of in play). Q-MCL-02.
 */
export const MAX_CHARACTER_LEVEL = 20;

/**
 * Spell rank the FREE archetype route hands out at each character level —
 * the "dedication rank" of §3, and the balance floor the class-level route
 * must never fall below (REQ-MCL-200).
 *
 * Read as a staircase: the entry that applies at character level L is the
 * highest threshold ≤ L. Below the first threshold the free route grants no
 * spell slot at all, hence rank 0.
 *
 * This is the published archetype cadence (1@4, 2@6, 3@8, 4@12, 5@14, 6@16,
 * 7@18, 8@20), not a house-rule invention — change it only to track an
 * errata, not to re-balance.
 */
export const DEDICATION_SPELL_RANK_BY_LEVEL: ReadonlyArray<{
  readonly characterLevel: number;
  readonly rank: number;
}> = [
  { characterLevel: 4, rank: 1 },
  { characterLevel: 6, rank: 2 },
  { characterLevel: 8, rank: 3 },
  { characterLevel: 12, rank: 4 },
  { characterLevel: 14, rank: 5 },
  { characterLevel: 16, rank: 6 },
  { characterLevel: 18, rank: 7 },
  { characterLevel: 20, rank: 8 },
];

/**
 * Bonus added to `ceil(classLevel / 2)` when ranking a `summon`/`incarnate`
 * spell (REQ-MCL-062).
 *
 * This is the lever that decides how much a dip is worth on the summoning
 * axis. Raising it makes dips stronger; lowering it can push pairs below the
 * dedication floor — which the invariant sweep will catch.
 */
export const SUMMON_CLASS_LEVEL_BONUS = 2;

/**
 * Bonus added to the class level when levelling a GRANTED ACTOR — animal
 * companion, familiar, eidolon (REQ-MCL-063).
 *
 * Same lever as above, for the companion axis. Capped by character level, so
 * a single-class character is unaffected (REQ-MCL-202).
 */
export const GRANTED_ACTOR_CLASS_LEVEL_BONUS = 2;

/**
 * Hard cap on the focus pool, regardless of how many classes grant focus
 * spells (REQ-MCL-066). Matches the published cap; the variant does not
 * widen it just because the character has two casting classes.
 */
export const FOCUS_POOL_CAP = 3;

/**
 * Divisor behind the "effective rank" of the variant: a spell is cast at
 * `ceil(characterLevel / EFFECTIVE_RANK_DIVISOR)` (REQ-MCL-061).
 *
 * At 2 this reproduces the published spell-rank-by-level curve exactly, so a
 * single-class caster sees no change at all. Treat it as structural rather
 * than tunable — moving it re-writes the whole progression, and the sweep
 * will not save you from that.
 */
export const EFFECTIVE_RANK_DIVISOR = 2;
