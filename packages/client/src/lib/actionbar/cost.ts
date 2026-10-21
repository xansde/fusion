/**
 * cost.ts — adapter from the bar's structured cost to the token the client already formats
 * (BAR-F1-02, Q-BAR-06, D-15).
 *
 * The provider returns a pure, locale-free {@link ActionBarCost}; the shell shows it with
 *
 *     formatActionCost(actionBarCostToken(cost), locale)
 *
 * (`lib/compendium/documentDetails.ts`), so the glyph table (◆ ◆◆ ◆◆◆ ⟳ ◇) and the labels have
 * ONE source. This module therefore carries no glyph, no label and no locale — and declares no
 * second `ActionCost`: the compendium already owns that name.
 *
 * Display data only (D-15): the token is never read as a rule.
 */

import type { ActionBarCost } from "./types.js";

type ActivityCost = Extract<ActionBarCost, { kind: "activity" }>;

/**
 * An activity is either a variable number of actions ("1 to 3", the range form
 * `formatActionCost` reads as action glyphs) or a span of time ("10 minutes", text).
 *
 * A time range must NOT use the "to" form: `formatActionCost` reads any `N to M [word]` as a
 * range of ACTIONS, so "1 to 2 minutes" would be drawn as ◆ a ◆◆. An en dash keeps it text.
 *
 * Domain: the counts of an action activity are 1 to 4 (the formatter's own cap) with `max` not
 * below `min`. Nothing is normalised here — the token mirrors the data: a count outside 1–4
 * makes `formatActionCost` fall back to plain text, and a `max` below `min` is drawn as the
 * inverted range it was given ("3 to 1" → ◆◆◆ a ◆).
 */
function activityToken({ min, max, unit }: ActivityCost): string {
  const isRange = max !== undefined && max !== min;
  if (unit === "action") return isRange ? `${String(min)} to ${String(max)}` : String(min);

  const span = isRange ? `${String(min)}–${String(max)}` : String(min);
  return `${span} ${unit}${(max ?? min) === 1 ? "" : "s"}`;
}

/**
 * The token `formatActionCost` understands for `cost`, or `null` when the entry has no seal
 * (`passive`, `none`).
 *
 *   { kind: "action", count: 2 }                         → "2"
 *   { kind: "reaction" }                                 → "reaction"
 *   { kind: "free" }                                     → "free"
 *   { kind: "activity", unit: "action", min: 1, max: 3 } → "1 to 3"   (no `max`, or `max` equal to `min`: "2")
 *   { kind: "activity", unit: "minute", min: 10 }        → "10 minutes" (text, no glyph; the formatter translates it)
 */
export function actionBarCostToken(cost: ActionBarCost): string | null {
  switch (cost.kind) {
    case "action":
      return String(cost.count);
    case "reaction":
      return "reaction";
    case "free":
      return "free";
    case "activity":
      return activityToken(cost);
    case "passive":
    case "none":
      return null;
  }
}
