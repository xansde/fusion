/**
 * rollModeIcons.ts — the icons of the four roll modes.
 *
 * Spec 38 (`specs/38-aba-chat.md`), DEC-ACH-04 / REQ-ACH-040: the selector shows the four
 * modes as **drawn icons, never emoji** — emoji change shape and colour per operating
 * system and never follow the theme; a drawn glyph does. Spec 42 raises the same rule to a
 * principle of the whole drawer (REQ-NPC-094).
 *
 * ui-chat (22/10/2026): drawn from the ONE icon set of Fusion (`@fusion/shared` `iconSvg`,
 * Lucide subset, ISC) instead of four shapes of their own, so the chat reads like the rail,
 * the sheets and the header. No `<title>`: the accessible name is the button's `aria-label`.
 */

import { iconSvg, type RollMode } from "@fusion/shared";

const SIZE = 18;

/** Public — a globe: the whole table sees it. */
export const publicRollIcon: string = iconSvg("globe", { size: SIZE });

/** To the GM — the GM's screen (a shield): only the roller and the GM read it. */
export const gmRollIcon: string = iconSvg("shield", { size: SIZE });

/** Blind — an eye struck through: the roller does not see the result either. */
export const blindRollIcon: string = iconSvg("eye-off", { size: SIZE });

/** Self — a single figure: nobody else is in the room. */
export const selfRollIcon: string = iconSvg("user", { size: SIZE });

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
