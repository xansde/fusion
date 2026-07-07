/**
 * chatNestedRender.ts — pure classification + formatting of a spell-cast card's
 * nested child rolls (r18-N1).
 *
 * A parent spell-cast announcement groups its children (attack / damage / save
 * rolls). This module splits those children into:
 *   - `rolls`  — the caster's own attack / damage rolls, shown as compact roll
 *     lines (formula + total + flavor, with crit/fumble coloring);
 *   - `saves`  — the targets' saving throws (graded server-side), shown in the
 *     "Salvaguardas" section: one line per roll with the speaker's name, total,
 *     degree badge, and (for basic saves) the per-degree damage hint.
 *
 * Classification is purely structural: a child is a SAVE when its roll carries a
 * server-computed `degreeOfSuccess` (only save checkContexts get graded today);
 * everything else is a plain roll line. No Svelte, no DOM — fully testable.
 */

import type { ChatMessage, RollResultData } from "@fusion/shared";
import { toDegreeKey, getRollTotalClass, formatRoll, type DegreeKey } from "./messageFormatter.js";

/** A caster attack/damage roll rendered as a compact line under the card. */
export interface NestedRollLine {
  messageId: string;
  /** The roll's original formula (e.g. "1d20+9"). */
  formula: string;
  total: number;
  /** Flavor label (e.g. "Ataque", "Arco Elétrico — Dano electricity"), if any. */
  flavor: string | null;
  /** "crit" | "fumble" | "" — d20 single-die coloring (attack rolls). */
  totalClass: "crit" | "fumble" | "";
}

/** A target's saving throw rendered as one line in the "Salvaguardas" section. */
export interface NestedSaveLine {
  messageId: string;
  /** Speaker alias (the target who rolled). */
  alias: string;
  total: number;
  /** Narrowed degree key (for badge label/color), or null for an unknown grade. */
  degree: DegreeKey | null;
  /** Raw degree string (shown verbatim when it doesn't narrow to a key). */
  degreeRaw: string;
  /** True when the parent save was basic (drives the per-degree damage hint). */
  basicSave: boolean;
}

/** Split of a parent card's children into roll lines + save lines. */
export interface NestedChildren {
  rolls: NestedRollLine[];
  saves: NestedSaveLine[];
}

/** The primary roll of a message (index 0), or undefined for a non-roll. */
function primaryRoll(msg: ChatMessage): RollResultData | undefined {
  return msg.rolls?.[0];
}

/** Read the graded degree string off a child's primary roll, or null. */
function childDegree(msg: ChatMessage): string | null {
  const deg = primaryRoll(msg)?.degreeOfSuccess;
  return typeof deg === "string" && deg.length > 0 ? deg : null;
}

/** Read flags.pf2e.checkContext.basicSave off a graded save message. */
function isBasicSave(msg: ChatMessage): boolean {
  const cc = (msg.flags as Record<string, Record<string, unknown>> | undefined)?.["pf2e"]?.[
    "checkContext"
  ] as Record<string, unknown> | undefined;
  return cc?.["kind"] === "save" && cc["basicSave"] === true;
}

/**
 * Classify a parent card's children (r18-N1). A child whose primary roll was
 * graded (`degreeOfSuccess` set) is a SAVE; every other child is a compact roll
 * line (attack / damage). Non-roll children (defensive — should not happen for
 * nested spell rolls) are skipped. Order within each bucket follows the input
 * (chronological) order.
 */
export function classifyNestedChildren(children: readonly ChatMessage[]): NestedChildren {
  const rolls: NestedRollLine[] = [];
  const saves: NestedSaveLine[] = [];

  for (const child of children) {
    const roll = primaryRoll(child);
    if (!roll) continue; // no roll payload → nothing compact to show

    const degreeRaw = childDegree(child);
    if (degreeRaw !== null) {
      // Graded save.
      saves.push({
        messageId: child._id,
        alias: child.speaker.alias,
        total: roll.total,
        degree: toDegreeKey(degreeRaw),
        degreeRaw,
        basicSave: isBasicSave(child),
      });
    } else {
      // Attack / damage roll line.
      const formatted = formatRoll(roll);
      rolls.push({
        messageId: child._id,
        formula: roll.formula,
        total: roll.total,
        flavor: roll.flavor ?? null,
        totalClass: getRollTotalClass(formatted),
      });
    }
  }

  return { rolls, saves };
}
