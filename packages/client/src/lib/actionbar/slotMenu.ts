/**
 * slotMenu.ts — what the right-click menu of a slot offers, and what choosing an item does
 * (BAR-F1-04, BAR-F3-01; spec 53 REQ-BAR-045, REQ-BAR-063, REQ-BAR-066; tasks.md BAR-F1-04).
 *
 * The menu has "Abrir na ficha" (BAR-F1-04) and the minimal pin and unpin (BAR-F3-01): "Fixar nos
 * Favoritos" on an entry that is not in the row, "Desafixar" on one that is — in the Favorites row,
 * in a tab, and on an orphan (REQ-BAR-066). The variants (BAR-F3-02) and drag and drop (BAR-F3-03)
 * were cut (D-BA16). Keeping the list and the choice here, away from the component, is what lets a
 * task add an item by editing this file and its test only; each new item goes at the END of the list
 * and of `runSlotMenuItem`, after the ones before it.
 *
 * Pure (§2.10): the items are data for the generic `ContextMenu` (`lib/ui/menu.ts`), the choice is a
 * function of the item id.
 */

import { t } from "../i18n/i18n.js";
import type { MenuEntry } from "../ui/menu.js";
import { FAVORITE_SLOT_COUNT, type FavoritesSource } from "./favoritesSource.js";
import type { ActionBarEntry, ActionBarServices } from "./types.js";

/** The id of "Abrir na ficha". */
export const OPEN_SHEET_ITEM = "open-sheet";
/** The id of "Fixar nos Favoritos". */
export const PIN_ITEM = "pin";
/** The id of "Desafixar". */
export const UNPIN_ITEM = "unpin";

/**
 * "Fixar nos Favoritos" or "Desafixar" for the entry, by whether it is in the row. With the row full
 * the pin item stays on screen, dimmed, with the reason — and Desafixar of what is already in the
 * row stays free, which is how a full row is made room in.
 */
function favoritesItems(
  entry: ActionBarEntry,
  favorites: Pick<FavoritesSource, "isPinned" | "slots">,
): MenuEntry[] {
  if (favorites.isPinned(entry.id))
    return [{ id: UNPIN_ITEM, label: t("FUSION.ActionBar.Menu.Unpin") }];
  const full = favorites.slots().filter((id) => id !== null).length >= FAVORITE_SLOT_COUNT;
  return [
    full
      ? {
          id: PIN_ITEM,
          label: t("FUSION.ActionBar.Menu.Pin"),
          disabled: true,
          reason: t("FUSION.ActionBar.Favorites.Full"),
        }
      : { id: PIN_ITEM, label: t("FUSION.ActionBar.Menu.Pin") },
  ];
}

/** The items of the menu of one entry. Without a favourites source there is nothing to pin into. */
export function slotMenuItems(
  entry: ActionBarEntry,
  favorites?: Pick<FavoritesSource, "isPinned" | "slots">,
): MenuEntry[] {
  return [
    { id: OPEN_SHEET_ITEM, label: t("FUSION.ActionBar.Menu.OpenSheet") },
    ...(favorites === undefined ? [] : favoritesItems(entry, favorites)),
  ];
}

export interface SlotMenuContext {
  actorId: string;
  services: Pick<ActionBarServices, "openActorSheet"> & Partial<Pick<ActionBarServices, "notify">>;
  /** The entry the menu was opened on (the pin and unpin items act on it). */
  entry?: ActionBarEntry | undefined;
  favorites?: FavoritesSource | undefined;
}

/** Does what the chosen item says. An id this menu does not offer does nothing. */
export function runSlotMenuItem(itemId: string, context: SlotMenuContext): void {
  const { entry, favorites } = context;
  if (itemId === OPEN_SHEET_ITEM) {
    context.services.openActorSheet(context.actorId);
  } else if (itemId === PIN_ITEM) {
    if (entry === undefined || favorites === undefined) return;
    // The item is dimmed when the row is full, so this only refuses after a race (another device
    // took the last slot between the menu opening and the click): say so on the strip.
    if (!favorites.pin(entry.id)) context.services.notify?.(t("FUSION.ActionBar.Favorites.Full"));
  } else if (itemId === UNPIN_ITEM) {
    if (entry === undefined || favorites === undefined) return;
    favorites.unpin(entry.id);
  }
}
