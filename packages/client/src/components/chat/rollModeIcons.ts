/**
 * rollModeIcons.ts — drawn icons for the four roll modes.
 *
 * Spec 38 (`specs/38-aba-chat.md`), DEC-ACH-04 / REQ-ACH-040: the selector shows the four
 * modes as **drawn icons, never emoji** — emoji change shape and colour per operating
 * system and never follow the theme; a drawn glyph does. Spec 42 raises the same rule to a
 * principle of the whole drawer (REQ-NPC-094).
 *
 * Same conventions as the rail's set (`components/sidebar/icons.ts`), so the two read as
 * one system: 24×24 viewBox, `currentColor` stroke, no fill, 1.75 stroke width, round
 * caps/joins, no text and no `<title>` (the accessible name is the button's `aria-label`).
 *
 * All shapes are original, drawn for Fusion — nothing is traced from another VTT.
 */

import type { RollMode } from "@fusion/shared";

const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" ' +
  'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
  'stroke-linejoin="round" focusable="false">';

function icon(body: string): string {
  return `${SVG_OPEN}${body}</svg>`;
}

/** Public — a globe: the whole table sees it. */
export const publicRollIcon: string = icon(
  '<circle cx="12" cy="12" r="8.5"/>' +
    '<path d="M3.5 12h17"/>' +
    '<path d="M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5"/>' +
    '<path d="M12 3.5c-2.4 2.6-3.6 5.4-3.6 8.5s1.2 5.9 3.6 8.5"/>',
);

/** To the GM — a folded note pointing at a single reader behind the screen. */
export const gmRollIcon: string = icon(
  '<path d="M3.5 7.5h11v9h-11z"/>' +
    '<path d="m3.5 7.5 5.5 4.5 5.5-4.5"/>' +
    '<circle cx="18.5" cy="9" r="2"/>' +
    '<path d="M15.5 17a3 3 0 0 1 6 0"/>',
);

/** Blind — an eye struck through: the roller does not see the result either. */
export const blindRollIcon: string = icon(
  '<path d="M3 12s3.5-5.5 9-5.5c1.6 0 3 .5 4.2 1.2"/>' +
    '<path d="M20.4 9.6c.4.5.6 1 .6 1.2 0 .6-3.5 5.7-9 5.7-1 0-1.9-.2-2.7-.5"/>' +
    '<path d="M10.4 10.4a2.2 2.2 0 0 0 3.1 3.1"/>' +
    '<path d="m4 20 16-16"/>',
);

/** Self — a single figure inside a closed frame: nobody else is in the room. */
export const selfRollIcon: string = icon(
  '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/>' +
    '<circle cx="12" cy="10" r="2.4"/>' +
    '<path d="M7.8 17.2a4.5 4.5 0 0 1 8.4 0"/>',
);

/** The four modes in the order the panel draws them (DEC-ACH-04). */
export const ROLL_MODE_ORDER: readonly RollMode[] = ["public", "gmroll", "blindroll", "selfroll"];

/** Icon markup by mode — indexed lookup, so a new mode cannot be forgotten silently. */
export const rollModeIcons: Record<RollMode, string> = {
  public: publicRollIcon,
  gmroll: gmRollIcon,
  blindroll: blindRollIcon,
  selfroll: selfRollIcon,
};

/** i18n key stem of each mode, so label and help stay a pair. */
export const rollModeI18nStem: Record<RollMode, string> = {
  public: "FUSION.Chat.RollMode.Public",
  gmroll: "FUSION.Chat.RollMode.Gm",
  blindroll: "FUSION.Chat.RollMode.Blind",
  selfroll: "FUSION.Chat.RollMode.Self",
};
