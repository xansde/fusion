/**
 * rollDisplay.ts — turning a server roll into the line a player reads at a glance.
 *
 * REQ-ACH-021: a displayed roll shows the formula, the value of EACH die and the
 * applied modifier, besides the total, WITHOUT interaction. The structured terms the
 * server persists (REQ-ROL-028..030) already carry everything needed; this module is
 * the single pure place that turns them into text, so the top-level roll card
 * (REQ-ACH-021), the nested child rolls of a card (REQ-ACH-022) and each target's
 * saving throw (REQ-ACH-023) all read the same way and cannot drift apart.
 *
 * No Svelte, no DOM, no i18n — numbers and punctuation only, fully unit-testable.
 * Labels around it (flavor, degree of success) are the component's business.
 */

import type { DiceResult, RollResultData, RollTermResult } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One die of a dice term, already reduced to what the display needs. */
export interface DisplayDie {
  value: number;
  /** Rolled but not counted (kept visible, struck through). */
  discarded: boolean;
  /** Produced by an explosion modifier. */
  exploded: boolean;
  rerolled: boolean;
  /** Marked as a success by a `cs` modifier. */
  success: boolean;
  /** Marked as a failure by a `cf` modifier. */
  failure: boolean;
  /** d20 natural maximum. */
  crit: boolean;
  /** d20 natural 1. */
  fumble: boolean;
}

/**
 * `dice` — a group of dice with their individual values;
 * `number` — a flat modifier;
 * `operator` — the sign gluing two segments;
 * `other` — a term this module cannot expand (parenthetical, pool, function),
 * shown verbatim with its total so nothing is silently dropped.
 */
export type RollSegmentKind = "dice" | "number" | "operator" | "other";

/** One readable piece of the breakdown line. */
export interface RollSegment {
  kind: RollSegmentKind;
  /** The term expression as the server wrote it (e.g. "2d4", "+", "4"). */
  expression: string;
  /** What the reader sees for this segment (e.g. "[3, 2]", "+", "4"). */
  text: string;
  /** Individual dice — empty for every non-dice kind. */
  dice: DisplayDie[];
  /** Numeric contribution, or null when the term is an operator. */
  value: number | null;
  /** `[...]` annotation on the term (e.g. a damage type), or null. */
  flavor: string | null;
}

/** Everything a roll needs to be read without a single click. */
export interface RollDisplay {
  formula: string;
  expandedFormula: string;
  total: number;
  flavor: string | null;
  segments: RollSegment[];
  /** One-line breakdown, e.g. "[3, 2] + 4". */
  breakdown: string;
  /** Formula, breakdown and total in one string, e.g. "2d4+4 → [3, 2] + 4 = 9". */
  summary: string;
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

function toDisplayDie(die: DiceResult, faces: number | undefined): DisplayDie {
  const isD20 = faces === 20;
  return {
    value: die.result,
    discarded: die.discarded === true || !die.active,
    exploded: die.exploded === true,
    rerolled: die.rerolled === true,
    success: die.success === true,
    failure: die.failure === true,
    crit: isD20 && die.result === 20,
    fumble: isD20 && die.result === 1,
  };
}

/**
 * Render a group of dice as `[3, 2]`. A discarded die stays visible wrapped in
 * `~` (`[6, 5, 4, ~1~]`) — hiding it would make the formula lie about what was
 * rolled; an exploded die is suffixed with `!`.
 */
export function formatDiceGroup(dice: readonly DisplayDie[]): string {
  const parts = dice.map((die) => {
    const value = die.exploded ? `${String(die.value)}!` : String(die.value);
    return die.discarded ? `~${value}~` : value;
  });
  return `[${parts.join(", ")}]`;
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

function segmentFor(term: RollTermResult): RollSegment {
  const flavor = term.flavor ?? null;

  if (term.type === "dice" && Array.isArray(term.results)) {
    const dice = term.results.map((d) => toDisplayDie(d, term.faces));
    return {
      kind: "dice",
      expression: term.expression,
      text: formatDiceGroup(dice),
      dice,
      value: term.total,
      flavor,
    };
  }

  if (term.type === "operator") {
    return {
      kind: "operator",
      expression: term.expression,
      text: term.expression,
      dice: [],
      value: null,
      flavor,
    };
  }

  if (term.type === "numeric") {
    return {
      kind: "number",
      expression: term.expression,
      text: String(term.total),
      dice: [],
      value: term.total,
      flavor,
    };
  }

  // parenthetical / pool / function / a dice term with no results array: keep the
  // expression AND its total, so an unexpandable term is still accounted for.
  return {
    kind: "other",
    expression: term.expression,
    text: `${term.expression} (${String(term.total)})`,
    dice: [],
    value: term.total,
    flavor,
  };
}

/** Split a roll into readable segments, in the order the server evaluated them. */
export function buildRollSegments(roll: RollResultData): RollSegment[] {
  return roll.terms.map(segmentFor);
}

/** The flat modifiers of a roll — what REQ-ACH-021 calls "the applied modifier". */
export function rollModifierSegments(roll: RollResultData): RollSegment[] {
  return buildRollSegments(roll).filter((segment) => segment.kind === "number");
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * The breakdown line, e.g. `[3, 2] + 4`. A roll whose terms did not survive
 * (older message, stripped payload) degrades to its total rather than to an
 * empty line — the reader always sees a number.
 */
export function rollBreakdown(roll: RollResultData): string {
  return joinSegments(buildRollSegments(roll), roll.total);
}

/** Join already-built segments into the breakdown line (single source of truth). */
function joinSegments(segments: readonly RollSegment[], total: number): string {
  if (segments.length === 0) return String(total);
  return segments
    .map((s) => s.text)
    .join(" ")
    .trim();
}

/** Formula, breakdown and total in a single line: `2d4+4 → [3, 2] + 4 = 9`. */
export function rollSummary(roll: RollResultData): string {
  return `${roll.formula} → ${rollBreakdown(roll)} = ${String(roll.total)}`;
}

/** Everything the card needs about one roll, computed once. */
export function buildRollDisplay(roll: RollResultData): RollDisplay {
  const segments = buildRollSegments(roll);
  const breakdown = joinSegments(segments, roll.total);

  return {
    formula: roll.formula,
    expandedFormula: roll.expandedFormula,
    total: roll.total,
    flavor: roll.flavor ?? null,
    segments,
    breakdown,
    summary: `${roll.formula} → ${breakdown} = ${String(roll.total)}`,
  };
}
