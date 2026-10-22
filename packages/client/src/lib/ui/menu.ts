/**
 * menu.ts — the context menu's model and its keyboard, as pure functions (BAR-F1-03).
 *
 * `ContextMenu.svelte` only draws and wires; what it *means* — which items a keyboard can
 * reach, where an arrow goes, what Escape or Tab do — is decided here, on plain data, so it
 * can be tested without a DOM (docs/design/barra-de-acoes/tasks.md §2.10).
 *
 * The shape follows the WAI-ARIA menu pattern: one tab stop, arrows walk the items and wrap
 * around, Home/End jump to the ends. A disabled item is skipped by the arrows — the card's
 * rule — but it stays on screen with its reason, which is also its accessible description.
 *
 * Three keys are deliberately NOT handled here:
 *  - Enter and Space: each item is a native `<button>`, so the browser already turns them into
 *    a click, once. Handling them as well is how an item ends up activated twice.
 *  - Escape and Tab: they close the menu and return the focus to the trigger, which is the
 *    dismissable layer's job (`dismissableLayer.ts`) — one implementation for the menu and the
 *    popover. A menu never traps focus.
 */

import { layerOwnsKey } from "./dismissableLayer.js";

export interface MenuItem {
  /** Handed back to `onselect`. Unique within the menu. */
  id: string;
  label: string;
  /** Trailing text on the right of the label: a value ("+12"), a shortcut ("Alt"). */
  detail?: string | undefined;
  /** A line under the label that says what choosing it will do ("depois deste: MAP −10"). */
  hint?: string | undefined;
  /** The item stays on screen, dimmed, skipped by the arrows, and does nothing when clicked. */
  disabled?: boolean | undefined;
  /** Why it is disabled. Shown under the label and read as the item's description. */
  reason?: string | undefined;
}

/** A titled run of items. Becomes `role="group"` labelled by its title. */
export interface MenuGroup {
  kind: "group";
  label?: string | undefined;
  items: readonly MenuItem[];
}

export interface MenuSeparator {
  kind: "separator";
}

/** A menu is a list of loose items, titled groups and separators between them. */
export type MenuEntry = MenuItem | MenuGroup | MenuSeparator;

function isGroup(entry: MenuEntry): entry is MenuGroup {
  return "kind" in entry && entry.kind === "group";
}

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return "kind" in entry && entry.kind === "separator";
}

/** Every item a keyboard can walk, in the order they are drawn. */
export function flattenMenu(entries: readonly MenuEntry[]): MenuItem[] {
  const flat: MenuItem[] = [];
  for (const entry of entries) {
    if (isSeparator(entry)) continue;
    if (isGroup(entry)) flat.push(...entry.items);
    else flat.push(entry);
  }
  return flat;
}

/** An item and where it sits in the keyboard order (its index in `flattenMenu`). */
export interface IndexedItem {
  item: MenuItem;
  index: number;
}

export type MenuRow =
  | ({ kind: "item" } & IndexedItem)
  | { kind: "separator" }
  | { kind: "group"; label: string | undefined; items: IndexedItem[] };

/** What to draw, with every item numbered by its place in the keyboard order. */
export function layoutMenu(entries: readonly MenuEntry[]): MenuRow[] {
  let next = 0;
  const rows: MenuRow[] = [];
  for (const entry of entries) {
    if (isSeparator(entry)) {
      rows.push({ kind: "separator" });
    } else if (isGroup(entry)) {
      rows.push({
        kind: "group",
        label: entry.label,
        items: entry.items.map((item) => ({ item, index: next++ })),
      });
    } else {
      rows.push({ kind: "item", item: entry, index: next++ });
    }
  }
  return rows;
}

/**
 * The line shown under an item's label, and read as its description: the reason when the
 * item is disabled (falling back to its hint), the hint otherwise. A reason on an item
 * that is not disabled means nothing and is ignored.
 */
export function describeItem(item: MenuItem): string | undefined {
  if (item.disabled === true) return item.reason ?? item.hint;
  return item.hint;
}

export type MenuNavKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

interface Disableable {
  disabled?: boolean | undefined;
}

/**
 * Where an arrow, Home or End lands. Disabled items are skipped; the arrows wrap around;
 * with nothing active yet, ArrowDown starts at the first enabled item and ArrowUp at the
 * last. Null when no item can be reached.
 */
export function nextEnabledIndex(
  items: readonly Disableable[],
  current: number | null,
  key: MenuNavKey,
): number | null {
  const enabled: number[] = [];
  items.forEach((item, index) => {
    if (item.disabled !== true) enabled.push(index);
  });
  const first = enabled[0];
  const last = enabled[enabled.length - 1];
  if (first === undefined || last === undefined) return null;

  switch (key) {
    case "Home":
      return first;
    case "End":
      return last;
    case "ArrowDown":
      if (current === null) return first;
      return enabled.find((index) => index > current) ?? first;
    case "ArrowUp":
      if (current === null) return last;
      return [...enabled].reverse().find((index) => index < current) ?? last;
  }
}

/**
 * Where the highlight starts when the menu opens. From the keyboard the first enabled item
 * is active at once (the user is already on the keys); by the pointer nothing is, like a
 * native menu, and the first arrow press picks one.
 */
export function initialActiveIndex(
  items: readonly Disableable[],
  via: "keyboard" | "pointer",
): number | null {
  if (via === "pointer") return null;
  return nextEnabledIndex(items, null, "ArrowDown");
}

/** The part of a `KeyboardEvent` the menu looks at — so tests can pass a plain object. */
export interface MenuKeyEvent {
  key: string;
  shiftKey?: boolean | undefined;
  altKey?: boolean | undefined;
  ctrlKey?: boolean | undefined;
  metaKey?: boolean | undefined;
  isComposing?: boolean | undefined;
}

export interface MenuKeyHandling {
  /** The new active item when the key moves the highlight; null when it does not. */
  move: number | null;
  /** A navigation key the menu acted on: keep the browser from scrolling the page with it. */
  preventDefault: boolean;
  /**
   * An open menu owns the keyboard. The canvas listens on `window` and moves the selected
   * token on the arrow keys, duplicates it on D, and so on; none of that may react to a key
   * pressed inside a menu. Tab alone is let through — the layer turns it into "close" and
   * hands the focus back to the trigger, and the browser's Tab then carries on from there.
   */
  stopPropagation: boolean;
}

const NAV_KEYS: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * What a key does inside an open menu: where the highlight goes, and whether the event is
 * kept from the rest of the app. Escape and Tab are not decided here — they close the menu
 * and return the focus, which is the dismissable layer's job (`dismissableLayer.ts`), the
 * same for the menu and for the popover. A key with Alt, Ctrl or Meta held is a browser or OS
 * shortcut and is not navigation, and a key pressed during IME composition is the IME's.
 */
export function menuKeyHandling(
  event: MenuKeyEvent,
  state: { items: readonly Disableable[]; active: number | null },
): MenuKeyHandling {
  if (event.isComposing === true) {
    return { move: null, preventDefault: false, stopPropagation: false };
  }

  const modified = event.altKey === true || event.ctrlKey === true || event.metaKey === true;
  const navigation = !modified && NAV_KEYS.has(event.key);
  const move = navigation
    ? nextEnabledIndex(state.items, state.active, event.key as MenuNavKey)
    : null;

  return {
    move,
    preventDefault: navigation,
    stopPropagation: layerOwnsKey(event),
  };
}
