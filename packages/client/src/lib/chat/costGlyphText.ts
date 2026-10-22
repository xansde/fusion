/**
 * costGlyphText.ts — split the PF2e cost characters (◆ ◇ ↺ ⟳) out of a chat line
 * (ui-login-admin, 22/10/2026).
 *
 * The spell-cast announcement the sheet and the action bar post is plain text with the cost
 * written as characters ("lança Raio de Fogo (grau 2) ◆◆"). A font draws those differently on
 * every system, and the docs/design/ui rule is that the cost is drawn by Fusion's own marks
 * (`components/common/CostGlyphs.svelte`). Splitting at render time covers every message
 * already stored — nothing is migrated — and gives each run its words ("2 ações") for screen
 * readers, from the same formatter the compendium and the action bar use.
 */

import { formatActionCost } from "../compendium/documentDetails.js";
import type { SupportedLocale } from "../i18n/i18n.js";

export type CostGlyphPart =
  | { kind: "text"; text: string }
  | { kind: "cost"; glyphs: string; label: string };

const RUN = /[◆◇↺⟳]+/gu;

/** The words for one run, via `formatActionCost` (one source for glyph ↔ label). */
function labelFor(run: string, locale: SupportedLocale): string {
  const chars = Array.from(run);
  const token =
    chars.every((c) => c === "◆") && chars.length <= 4
      ? String(chars.length)
      : run === "◇"
        ? "free"
        : run === "↺" || run === "⟳"
          ? "reaction"
          : null;
  if (token !== null) return formatActionCost(token, locale).label;
  // A run the formatter cannot read as one cost: name each mark in turn.
  return chars.map((c) => labelFor(c, locale)).join(", ");
}

/** `text` as alternating text and cost runs; a line without glyphs is one text part. */
export function splitCostGlyphs(text: string, locale: SupportedLocale): CostGlyphPart[] {
  const parts: CostGlyphPart[] = [];
  let last = 0;
  for (const match of text.matchAll(RUN)) {
    const start = match.index;
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    parts.push({ kind: "cost", glyphs: match[0], label: labelFor(match[0], locale) });
    last = start + match[0].length;
  }
  if (last < text.length || parts.length === 0) {
    parts.push({ kind: "text", text: text.slice(last) });
  }
  return parts;
}
