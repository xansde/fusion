/**
 * @fusion/engine-2e — Level context: (class level, character level).
 *
 * Under RAW 2e the two numbers are always equal, so every rule can read a
 * single `level`. The "class levels" multiclass variant (specs/30) breaks
 * that identity: a `Fighter 3 / Wizard 2` has character level 5 but class
 * level 3 in fighter and 2 in wizard.
 *
 * This module makes the pair a first-class concept in the shared 2e core so
 * that any system adopting a similar variant reads the SAME shape, while
 * leaving the variant's semantics (which rule reads which number) to the
 * game system — see DEC-MCL-03.
 *
 * Which number goes where, as a rule of thumb:
 *   - proficiency BONUS  → character level (the +level term)
 *   - proficiency RANK   → class level of whichever class grants it
 *   - spell slots/ranks  → class level (native class table)
 *
 * Clean-room: no proprietary content. The (class level, character level)
 * distinction is a fact of how level-split multiclassing works, not text.
 *
 * Spec: 30-multiclasse-por-niveis.md §5.2, DEC-MCL-03.
 */

import { calculateProficiencyBonus } from "./temlProficiency.js";

/**
 * The pair of levels every 2e rule may need.
 *
 * Under RAW, `classLevels` holds exactly one entry whose value equals
 * `characterLevel` — see {@link singleClassContext}.
 */
export interface LevelContext {
  /** Sum of all class levels. Equals `system.level.value`. */
  readonly characterLevel: number;
  /** Levels per class slug. Under RAW: `{ <class>: characterLevel }`. */
  readonly classLevels: Readonly<Record<string, number>>;
}

/**
 * Build the RAW (single-class) context — the path taken whenever the class
 * levels variant is off, and the shape every pre-variant caller gets.
 */
export function singleClassContext(classSlug: string, level: number): LevelContext {
  return { characterLevel: level, classLevels: { [classSlug]: level } };
}

/**
 * Build a context from a level-split ledger.
 *
 * `characterLevel` is the SUM of the class levels — never a separately
 * supplied number, so the two can't drift apart (REQ-MCL-010/012).
 */
export function classLevelContext(classLevels: Readonly<Record<string, number>>): LevelContext {
  let sum = 0;
  for (const levels of Object.values(classLevels)) sum += levels;
  return { characterLevel: sum, classLevels: { ...classLevels } };
}

/** Level the character has in `classSlug`; 0 when they have none. */
export function classLevelOf(ctx: LevelContext, classSlug: string): number {
  return ctx.classLevels[classSlug] ?? 0;
}

/** Class slugs the character has at least one level in. */
export function classSlugsOf(ctx: LevelContext): string[] {
  return Object.keys(ctx.classLevels).filter((slug) => (ctx.classLevels[slug] ?? 0) > 0);
}

/** True when the character has all their levels in a single class (RAW). */
export function isSingleClass(ctx: LevelContext): boolean {
  return classSlugsOf(ctx).length <= 1;
}

/**
 * Proficiency bonus from a rank plus the CHARACTER level.
 *
 * The `+level` term of the TEML formula is always the character level, no
 * matter which class granted the rank (REQ-MCL-020). This wrapper exists so
 * that call sites holding a `LevelContext` cannot accidentally pass a class
 * level where the character level belongs — the mistake that stays invisible
 * in single-class testing, because there the two numbers agree.
 */
export function proficiencyBonusFor(rank: number, ctx: LevelContext): number {
  return calculateProficiencyBonus(rank, ctx.characterLevel);
}
