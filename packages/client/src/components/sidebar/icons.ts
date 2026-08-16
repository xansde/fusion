/**
 * icons.ts — drawn icons for the sidebar rail.
 *
 * Spec 36 (`specs/36-gaveta-lateral.md`) §5.1: the rail is icon-only (REQ-GAV-001),
 * and REQ-NPC-094 (spec 42) raises DEC-ACH-04 to a principle of the whole drawer —
 * **no icon is ever an emoji or a symbol character**. Emoji change shape and colour
 * per operating system and never follow the theme; a drawn glyph does.
 *
 * Every icon here is inline SVG markup (a string, not a component) because that is
 * what `registerSidebarTab({ icon })` takes: the registry validates the string is
 * SVG and rejects pictographs outright (`lib/sidebar/registry.ts`).
 *
 * All shapes are original, drawn for Fusion — nothing is traced from another VTT.
 *
 * Conventions, so the whole rail reads as one set:
 *  - 24×24 viewBox, `currentColor` stroke, no fill, 1.75 stroke width;
 *  - round caps/joins; no text, no `<title>` (the accessible name is the button's
 *    `aria-label`, REQ-GAV-002);
 *  - `aria-hidden` is applied by the rail on the wrapper, not baked in here.
 */

/** Shared attributes of every rail icon. */
const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" ' +
  'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
  'stroke-linejoin="round" focusable="false">';

function icon(body: string): string {
  return `${SVG_OPEN}${body}</svg>`;
}

/** Chat — a speech bubble with a tail. */
export const chatIcon: string = icon(
  '<path d="M4 6.5a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z"/>',
);

/** Contacts — two people, the players' own roster. */
export const contactsIcon: string = icon(
  '<circle cx="9" cy="8" r="3"/>' +
    '<path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/>' +
    '<path d="M16 5.6a3 3 0 0 1 0 5.8"/>' +
    '<path d="M17.2 14.4a5.5 5.5 0 0 1 3.3 5.1"/>',
);

/** Combat — two crossed blades. */
export const combatIcon: string = icon(
  '<path d="M4 4h3l9.5 9.5"/>' +
    '<path d="M20 4h-3L7.5 13.5"/>' +
    '<path d="M5.5 20 9 16.5"/>' +
    '<path d="M18.5 20 15 16.5"/>',
);

/** Compendium — a closed book with a spine. */
export const compendiumIcon: string = icon(
  '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5z"/>' +
    '<path d="M5 17.5h14"/>' +
    '<path d="M9 3v14.5"/>',
);

/** NPCs — a figure behind a stage mask: the GM's cast. */
export const npcsIcon: string = icon(
  '<circle cx="10" cy="7.5" r="3.5"/>' +
    '<path d="M4 20a6 6 0 0 1 8.6-5.4"/>' +
    '<path d="M14.5 13h6v3.5a3 3 0 0 1-3 3 3 3 0 0 1-3-3z"/>' +
    '<path d="M16.2 15.4h.01"/>' +
    '<path d="M18.8 15.4h.01"/>',
);

/**
 * The provisional Atores directory — a plain indexed list.
 *
 * It exists only until spec 42's NPCs tab takes authoring over (DEC-CTT-01, G078)
 * and then goes away with the panel. It gets a glyph of its own because the two
 * tabs are live at the same time during that window, and a rail that draws the
 * same shape twice is a rail the user cannot read.
 */
export const actorsLegacyIcon: string = icon(
  '<path d="M4 5.5h16v13H4z"/>' +
    '<path d="M8 5.5v13"/>' +
    '<path d="M11 9.5h6"/>' +
    '<path d="M11 12.5h6"/>' +
    '<path d="M11 15.5h4"/>',
);

/** Scenes — a folded map. */
export const scenesIcon: string = icon(
  '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/>' +
    '<path d="M9 4v13.5"/>' +
    '<path d="M15 6.5V20"/>',
);

/** Settings — a gear: where the footer tab is looked for. */
export const settingsIcon: string = icon(
  '<circle cx="12" cy="12" r="3.25"/>' +
    '<path d="M12 2.75v2.6"/>' +
    '<path d="M12 18.65v2.6"/>' +
    '<path d="M21.25 12h-2.6"/>' +
    '<path d="M5.35 12h-2.6"/>' +
    '<path d="m18.55 5.45-1.85 1.85"/>' +
    '<path d="m7.3 16.7-1.85 1.85"/>' +
    '<path d="m18.55 18.55-1.85-1.85"/>' +
    '<path d="m7.3 7.3-1.85-1.85"/>',
);

/**
 * The drawn icons of the seven core tabs (DEC-GAV-01), keyed by tab id.
 *
 * Whoever registers a tab passes the markup: `icon: sidebarIcons.chat`.
 */
export const sidebarIcons: Record<string, string> = {
  chat: chatIcon,
  contacts: contactsIcon,
  combat: combatIcon,
  compendium: compendiumIcon,
  npcs: npcsIcon,
  scenes: scenesIcon,
  settings: settingsIcon,
};
