/**
 * rollBreakdownParts.ts — what the roll card prints under the total (ui-fundacao, 22/10/2026).
 *
 * "Os cálculos não são transparentes": the card used to show `1d20+12 / 2 + 12 / 14`, the modifier
 * already summed. The server now records the parts of the statistic the sheet rolled with
 * (`flags.fusion.breakdown`, checked against the formula) and, separately, the conditional modifiers
 * it added itself (`flags.fusion.conditionalModifiers`). This module turns both into one list of
 * readable rows, in the order they add up. It never computes a rule: it only formats what the
 * server wrote. A part that did not stack (`applied: false`) stays listed, flagged, so the reader
 * sees what did NOT count.
 */

import type { ChatMessage } from "@fusion/shared";

export interface RollBreakdownRow {
  readonly label: string;
  readonly valueFormatted: string;
  readonly applied: boolean;
  /** True for a modifier the server added because of the roll's context (a target, an attacker). */
  readonly conditional: boolean;
}

function signed(value: number): string {
  return value >= 0 ? `+${String(value)}` : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The rows of a roll message's decomposition; empty when the server recorded none. */
export function rollBreakdownRows(message: Pick<ChatMessage, "flags">): RollBreakdownRow[] {
  const fusion = (message.flags as Record<string, unknown> | undefined)?.["fusion"];
  if (!isRecord(fusion)) return [];
  const rows: RollBreakdownRow[] = [];

  const breakdown = fusion["breakdown"];
  const parts = isRecord(breakdown) && Array.isArray(breakdown["parts"]) ? breakdown["parts"] : [];
  for (const part of parts) {
    if (!isRecord(part) || typeof part["label"] !== "string" || typeof part["value"] !== "number")
      continue;
    rows.push({
      label: part["label"],
      valueFormatted: signed(part["value"]),
      applied: part["applied"] !== false,
      conditional: false,
    });
  }

  // Conditional modifiers belong to the roll only when it is explained at all: alone, they are
  // already in the total and the formula, and printing them without the base would mislead.
  if (rows.length === 0) return rows;
  const conditional = Array.isArray(fusion["conditionalModifiers"])
    ? fusion["conditionalModifiers"]
    : [];
  for (const mod of conditional) {
    if (!isRecord(mod) || typeof mod["label"] !== "string" || typeof mod["value"] !== "number")
      continue;
    rows.push({
      label: mod["label"],
      valueFormatted: signed(mod["value"]),
      applied: true,
      conditional: true,
    });
  }
  return rows;
}
