/**
 * icons.ts — the icons of the sidebar rail.
 *
 * Spec 36 (`specs/36-gaveta-lateral.md`) §5.1: the rail is icon-only (REQ-GAV-001),
 * and REQ-NPC-094 (spec 42) raises DEC-ACH-04 to a principle of the whole drawer —
 * **no icon is ever an emoji or a symbol character**. Emoji change shape and colour
 * per operating system and never follow the theme; a drawn glyph does.
 *
 * Since ui-fundacao (22/10/2026) the rail draws from the app's one icon set
 * (`@fusion/shared` `iconSvg`, a Lucide subset, ISC — see NOTICE): the rail, the sheets
 * and every panel now share one drawing (24×24 grid, 1.75 round stroke, currentColor).
 * The markup is a string, not a component, because that is what
 * `registerSidebarTab({ icon })` takes: the registry validates the string is SVG and
 * rejects pictographs outright (`lib/sidebar/registry.ts`). The accessible name is the
 * button's `aria-label` (REQ-GAV-002); the glyph itself is decorative.
 */

import { iconSvg, type IconName } from "@fusion/shared";

function icon(name: IconName): string {
  return iconSvg(name, { size: 20 });
}

/** Chat — a speech bubble. */
export const chatIcon: string = icon("message-square");

/** Contacts — two people, the players' own roster. */
export const contactsIcon: string = icon("users");

/** Combat — two crossed blades. */
export const combatIcon: string = icon("swords");

/** Compendium — an open book. */
export const compendiumIcon: string = icon("book-open");

/** Sound — a speaker with sound waves. */
export const soundIcon: string = icon("volume-2");

/** NPCs — the theatre masks: the GM's cast. */
export const npcsIcon: string = icon("drama");

/** Scenes — a folded map. */
export const scenesIcon: string = icon("map");

/** Settings — a gear: where the footer tab is looked for. */
export const settingsIcon: string = icon("settings");

/**
 * The icons of the core tabs (DEC-GAV-01), keyed by tab id.
 *
 * Whoever registers a tab passes the markup: `icon: sidebarIcons.chat`.
 */
export const sidebarIcons: Record<string, string> = {
  chat: chatIcon,
  contacts: contactsIcon,
  combat: combatIcon,
  compendium: compendiumIcon,
  sound: soundIcon,
  npcs: npcsIcon,
  scenes: scenesIcon,
  settings: settingsIcon,
};
