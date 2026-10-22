/**
 * icons.ts — the drawn icons of the action bar (BAR-F1-04; spec 53 REQ-BAR-029, RNF-BAR-07,
 * DEC-BAR-15).
 *
 * A slot shows an icon and, under it, the entry's short name. The icons are a small free set drawn
 * for Fusion — the one the approved prototype uses (`docs/design/barra-de-acoes/prototipo-barra-fiel.html`)
 * — and NEVER Paizo art or another VTT's: the generic icons repeat across entries (two swords side by
 * side), which is exactly why the name sits under them.
 *
 * Since the UI foundation (22/10/2026) the bar also draws every glyph of the app's ONE icon set
 * (`@fusion/shared` `iconSvg`, a Lucide subset): a provider may name one of those ("mountain",
 * "lock-open"…) and the Testes tab gives each check a drawing of its own. The bar's own drawings
 * below win on a shared name, so the slots that already exist keep their look.
 *
 * An entry names its icon with `entry.icon` (a key of this set). An unknown or missing key falls
 * back to the icon of its `kind`, so a provider that picks a key this set does not have still gets a
 * slot that reads. Same conventions as the drawer rail (`components/sidebar/icons.ts`): 24×24 viewBox,
 * `currentColor` stroke, no fill, 1.75 stroke width, round caps and joins, no text.
 *
 * Every icon is inline SVG markup injected with `{@html}`, which is only defensible because nothing
 * here comes from outside this file: the keys index a constant table. A test still runs each icon
 * through the rail's allowlist (`isDrawnSvgIcon`), so a careless edit cannot slip a script in.
 */

import { ICON_NAMES, iconSvg as sharedIconSvg, isIconName } from "@fusion/shared";

import type { ActionBarEntryKind, ActionBarTab } from "../../lib/actionbar/types.js";

/** The inner markup of each icon (the `<svg>` shell is added by {@link iconSvg}). */
const ICONS: Readonly<Record<string, string>> = {
  sword:
    '<path d="M20.5 3.5 19.5 9 9.5 19 5 14.5 15 4.5z"/><path d="M3.5 13l7.5 7.5"/><path d="M6.5 17.5 3.5 20.5"/>',
  gun: '<path d="M3 8.5h15a1.5 1.5 0 0 1 1.5 1.5v1.5H12.5l-1 5H7.5l1-5H3z"/><path d="M16 8.5V7"/>',
  bow: '<path d="M6 3c8 3 8 15 0 18"/><path d="M6 3v18"/><path d="M6 12h14m-3.5-3L20 12l-3.5 3"/>',
  fist: '<rect x="6" y="9" width="12" height="9" rx="3"/><path d="M9 9v3.5M12 9v3.5M15 9v3.5"/><path d="M8 18v2h8v-2"/>',
  flail:
    '<path d="M5 20l7-9"/><circle cx="15.5" cy="7.5" r="3.5"/><path d="M13.7 5.7l3.6 3.6M17.3 5.7l-3.6 3.6"/>',
  claw: '<path d="M6 4c1 6 1 11-1 16M12 3c1 6 1 12-.5 18M18 4c1 6 1 11-1 16"/>',
  spark: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  flame:
    '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4 0 1.5 1 2.2 1.8 2.2C11 9.5 11.5 6 12 3z"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
  wave: '<path d="M3 9c2.5-3 4.5-3 7 0s4.5 3 7 0 3-2 4-1"/><path d="M3 15c2.5-3 4.5-3 7 0s4.5 3 7 0 3-2 4-1"/>',
  missiles:
    '<path d="M3 6h12m-3-2.5L15 6l-3 2.5"/><path d="M3 12h16m-3-2.5L19 12l-3 2.5"/><path d="M3 18h10m-3-2.5L13 18l-3 2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:
    '<path d="M2.5 12S6 5.5 12 5.5c2 0 3.8.7 5.2 1.6M21.5 12S18 18.5 12 18.5c-2 0-3.8-.7-5.2-1.6"/><path d="M4 4l16 16"/>',
  mask: '<path d="M4 6c5 2 11 2 16 0v6a8 8 0 0 1-16 0z"/><path d="M8.5 11h2M13.5 11h2"/><path d="M9.5 15.5c1.5 1 3.5 1 5 0"/>',
  hood: '<path d="M12 3c-4 0-6 3-6 6 0 2 1 3 1 5l-2 5h14l-2-5c0-2 1-3 1-5 0-3-2-6-6-6z"/><path d="M9.5 10.5c1 1.5 4 1.5 5 0"/>',
  foot: '<ellipse cx="12" cy="15.5" rx="4" ry="5"/><circle cx="8" cy="8" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="16" cy="8" r="1.4"/>',
  feet: '<ellipse cx="8" cy="15" rx="2.6" ry="4"/><circle cx="6.5" cy="8.6" r="1.1"/><circle cx="9.6" cy="8" r="1.1"/><ellipse cx="16.5" cy="12" rx="2.6" ry="4"/><circle cx="15" cy="5.6" r="1.1"/><circle cx="18.1" cy="5" r="1.1"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5z"/><path d="M5 17.5h14"/><path d="M9 3v14.5"/>',
  target:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  hand: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V11m0-3a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-.5A5.5 5.5 0 0 1 7 16.5L4.5 12.5a1.4 1.4 0 0 1 2.3-1.6L8 12.5"/>',
  star: '<path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.3L12 17.2 6.4 20.2l1.2-6.3L3 9.6l6.3-.8z"/>',
  flask:
    '<path d="M9.5 3h5M10.5 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L13.5 9V3"/><path d="M8 15h8"/>',
  torch:
    '<path d="M12 3c1.5 2 3 3 3 5a3 3 0 0 1-6 0c0-1 .5-2 1-2.5.3 1 1 1.5 1.5 1.5-.5-1.5.5-2.5.5-4z"/><path d="M10 12h4l-1 9h-2z"/>',
  food: '<path d="M15 4a5 5 0 0 1 0 8l-2 2-3-3 2-2a5 5 0 0 1 3-5z"/><path d="M10 14l-4 4m-1-1 2 2"/>',
  drop: '<path d="M12 3c3.5 4.5 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 2.5-6.5 6-11z"/>',
  rope: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><path d="M12 4V3M12 20v1"/>',
  chalk: '<path d="M5 19L16 8l3 3L8 22z"/><path d="M14 10l3 3"/>',
  bag: '<path d="M8 8h8l2 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/>',
  paw: '<ellipse cx="12" cy="16" rx="4.5" ry="3.5"/><circle cx="6.5" cy="11" r="1.7"/><circle cx="10" cy="7" r="1.7"/><circle cx="14" cy="7" r="1.7"/><circle cx="17.5" cy="11" r="1.7"/>',
  d20: '<path d="M12 2.5l8.5 5v9L12 21.5 3.5 16.5v-9z"/><path d="M12 7l4.5 8h-9z"/>',
  react: '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v4.5h-4.5"/>',
  bloom:
    '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="6" r="2.4"/><circle cx="17.7" cy="10.2" r="2.4"/><circle cx="15.5" cy="17" r="2.4"/><circle cx="8.5" cy="17" r="2.4"/><circle cx="6.3" cy="10.2" r="2.4"/>',
  push: '<path d="M4 12h14m-5-5 5 5-5 5"/><path d="M4 6v12"/>',
  down: '<path d="M12 4v11m-4-4 4 4 4-4"/><path d="M4 20h16"/>',
  heart: '<path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10z"/>',
};

/** Other names providers may use for a drawing that already exists here. */
const ALIASES: Readonly<Record<string, string>> = {
  boot: "foot",
  heal: "heart",
  lightning: "bolt",
  fire: "flame",
  ice: "snow",
  water: "wave",
  skill: "d20",
  potion: "flask",
  reaction: "react",
};

/** The icon an entry gets when it names none, or one this set does not have. */
const KIND_ICON: Readonly<Record<ActionBarEntryKind, string>> = {
  strike: "sword",
  spell: "spark",
  action: "foot",
  item: "bag",
  reaction: "react",
  toggle: "hood",
  check: "d20",
};

/** The icon of each tab of the bar: glyphs of the shared set (protótipo (b) da direção A). */
export const TAB_ICON: Readonly<Record<ActionBarTab | "favorites", string>> = {
  favorites: "star",
  strikes: "sword",
  spells: "wand-sparkles",
  actions: "zap",
  items: "backpack",
  reactions: "rotate-ccw",
  checks: "dice-5",
};

/** Every key the set draws (aliases excluded): the bar's own drawings, then the shared glyphs. */
export const ICON_KEYS: readonly string[] = [
  ...Object.keys(ICONS),
  ...ICON_NAMES.filter((name) => !Object.hasOwn(ICONS, name)),
];

function isKnownKey(key: string): boolean {
  return Object.hasOwn(ICONS, key) || isIconName(key);
}

/**
 * The key of the icon to draw: the entry's own when this set has it (or an alias of it), else the
 * one of its kind.
 */
export function iconKeyFor(icon: string | undefined, kind: ActionBarEntryKind): string {
  if (icon !== undefined) {
    const key = Object.hasOwn(ALIASES, icon) ? ALIASES[icon] : icon;
    if (key !== undefined && isKnownKey(key)) return key;
  }
  return KIND_ICON[kind];
}

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
  'stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">';

/** The complete `<svg>` of a key of this set; an unknown key draws the "spark". */
export function iconSvg(key: string): string {
  if (!Object.hasOwn(ICONS, key) && isIconName(key)) return sharedIconSvg(key, { size: 24 });
  const inner = Object.hasOwn(ICONS, key) ? ICONS[key] : ICONS["spark"];
  return `${SVG_OPEN}${inner ?? ""}</svg>`;
}
