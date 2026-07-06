/**
 * messageFormatter.ts — pure formatting utilities for chat messages.
 *
 * Converts ChatMessage data structures into display-friendly strings/objects.
 * No DOM, no Svelte runes, no side effects. Fully testable.
 *
 * REQ-CHT-007..015: five message types, roll modes, whisper, emote.
 * REQ-ROL-028..030: structured RollResultData for rich rendering.
 */

import type { ChatMessage, RollResultData, RollTermResult, DiceResult } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of formatting a single DiceResult for display. */
export interface FormattedDie {
  value: number;
  active: boolean;
  discarded: boolean;
  /** On a d20: true if result === faces (critical success indicator). */
  isCrit: boolean;
  /** On a d20: true if result === 1 (fumble indicator). */
  isFumble: boolean;
  /** cs modifier marked this die as a success. */
  isSuccess: boolean;
  /** cf modifier marked this die as a failure. */
  isFailure: boolean;
  exploded: boolean;
  rerolled: boolean;
}

/** Formatted term for the breakdown display. */
export interface FormattedTerm {
  type: RollTermResult["type"];
  expression: string;
  total: number;
  flavor?: string;
  /** Only for dice terms. */
  dice?: FormattedDie[];
  /** Number of faces (for crit/fumble coloring). */
  faces?: number;
}

/** Complete formatted roll for display. */
export interface FormattedRoll {
  rollId: string;
  formula: string;
  expandedFormula: string;
  total: number;
  flavor?: string;
  rollMode: RollResultData["rollMode"];
  terms: FormattedTerm[];
  warnings: string[];
  degreeOfSuccess?: string;
  rerollOf?: string;
}

/** Display metadata for a ChatMessage row. */
export interface MessageDisplayMeta {
  /** CSS class suffix for message type styling. */
  typeClass: string;
  /** Formatted time string (HH:MM). */
  timeStr: string;
  /** Speaker alias. */
  alias: string;
  /** Whether this message is a whisper (show recipient hint). */
  isWhisper: boolean;
  /** Whether this is a blind roll (non-GM sees no roll detail). */
  isBlind: boolean;
}

// ---------------------------------------------------------------------------
// Die formatting
// ---------------------------------------------------------------------------

export function formatDie(die: DiceResult, faces?: number): FormattedDie {
  const isD20 = faces === 20;
  return {
    value: die.result,
    active: die.active,
    discarded: die.discarded ?? false,
    isCrit: isD20 && die.result === 20,
    isFumble: isD20 && die.result === 1,
    isSuccess: die.success ?? false,
    isFailure: die.failure ?? false,
    exploded: die.exploded ?? false,
    rerolled: die.rerolled ?? false,
  };
}

// ---------------------------------------------------------------------------
// Term formatting
// ---------------------------------------------------------------------------

export function formatTerm(term: RollTermResult): FormattedTerm {
  const base: FormattedTerm = {
    type: term.type,
    expression: term.expression,
    total: term.total,
    // exactOptionalPropertyTypes: only set if actually present
    ...(term.flavor !== undefined ? { flavor: term.flavor } : {}),
  };

  if (term.type === "dice" && Array.isArray(term.results)) {
    if (term.faces !== undefined) {
      base.faces = term.faces;
    }
    base.dice = term.results.map((d) => formatDie(d, term.faces));
  }

  return base;
}

// ---------------------------------------------------------------------------
// Roll formatting
// ---------------------------------------------------------------------------

export function formatRoll(roll: RollResultData): FormattedRoll {
  return {
    rollId: roll.rollId,
    formula: roll.formula,
    expandedFormula: roll.expandedFormula,
    total: roll.total,
    // exactOptionalPropertyTypes: only spread if actually present
    ...(roll.flavor !== undefined ? { flavor: roll.flavor } : {}),
    ...(roll.degreeOfSuccess !== undefined ? { degreeOfSuccess: roll.degreeOfSuccess } : {}),
    ...(roll.rerollOf !== undefined ? { rerollOf: roll.rerollOf } : {}),
    rollMode: roll.rollMode,
    terms: roll.terms.map(formatTerm),
    warnings: roll.warnings,
  };
}

// ---------------------------------------------------------------------------
// Message display meta
// ---------------------------------------------------------------------------

export function getMessageDisplayMeta(msg: ChatMessage): MessageDisplayMeta {
  const typeClassMap: Record<string, string> = {
    text: "msg--text",
    roll: "msg--roll",
    emote: "msg--emote",
    whisper: "msg--whisper",
    system: "msg--system",
  };

  const date = new Date(msg.timestamp);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");

  return {
    typeClass: typeClassMap[msg.type] ?? "msg--text",
    timeStr: `${h}:${m}`,
    alias: msg.speaker.alias,
    isWhisper: msg.whisper.length > 0,
    isBlind: msg.blind,
  };
}

// ---------------------------------------------------------------------------
// Total display with crit coloring
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Degree of success — display mapping (r17.1)
// ---------------------------------------------------------------------------

/**
 * The four PF2e degree-of-success strings the server persists on a graded roll
 * (aligned with `RollResultData.degreeOfSuccess`). Anything else is unknown.
 */
export type DegreeKey = "criticalSuccess" | "success" | "failure" | "criticalFailure";

const DEGREE_KEYS: readonly DegreeKey[] = [
  "criticalSuccess",
  "success",
  "failure",
  "criticalFailure",
];

/** Narrow an arbitrary degree string to a known DegreeKey, or null. */
export function toDegreeKey(degree: string | undefined): DegreeKey | null {
  if (degree && (DEGREE_KEYS as readonly string[]).includes(degree)) {
    return degree as DegreeKey;
  }
  return null;
}

/** i18n key for a degree badge label (e.g. "FUSION.Chat.Degree.success"). */
export function degreeLabelKey(degree: DegreeKey): string {
  return `FUSION.Chat.Degree.${degree}`;
}

/** i18n key for the basic-save per-degree damage hint. */
export function basicSaveHintKey(degree: DegreeKey): string {
  return `FUSION.Chat.BasicSave.${degree}`;
}

/**
 * CSS modifier class for coloring a degree badge, coherent with the roll-total
 * crit/fumble palette (success/crit-success → green family, failures → red).
 */
export function degreeCssClass(degree: DegreeKey): string {
  switch (degree) {
    case "criticalSuccess":
      return "dos--crit-success";
    case "success":
      return "dos--success";
    case "failure":
      return "dos--failure";
    case "criticalFailure":
      return "dos--crit-failure";
  }
}

/** Returns "crit", "fumble", or "" for a roll total on a single-die roll. */
export function getRollTotalClass(roll: FormattedRoll): "crit" | "fumble" | "" {
  // Single d20 roll — check for nat 20/1
  const diceTerm = roll.terms.find((t) => t.type === "dice" && t.faces === 20);
  if (!diceTerm?.dice || diceTerm.dice.length !== 1) return "";
  const die = diceTerm.dice[0];
  if (!die) return "";
  if (die.isCrit) return "crit";
  if (die.isFumble) return "fumble";
  return "";
}
