/**
 * slotMenu.ts — what the right-click menu of a slot offers, and what choosing an item does
 * (BAR-F1-04, BAR-F3-01, BAR-F3-05; spec 53 REQ-BAR-045, REQ-BAR-063, REQ-BAR-066; tasks.md BAR-F1-04).
 *
 * The menu has "Abrir na ficha" (BAR-F1-04), the minimal pin and unpin (BAR-F3-01) — "Fixar nos
 * Favoritos" on an entry that is not in the row, "Desafixar" on one that is, in the Favorites row, in
 * a tab, and on an orphan (REQ-BAR-066) — and, at the end, the custom icon's "Trocar ícone…" and
 * "Restaurar ícone padrão" (BAR-F3-05). The variants (BAR-F3-02) and drag and drop (BAR-F3-03) were
 * cut (D-BA16). Keeping the list and the choice here, away from the component, is what lets a task
 * add an item by editing this file and its test only; each new item goes at the END of the list and
 * of `runSlotMenuItem`, after the ones before it.
 *
 * Pure (§2.10): the items are data for the generic `ContextMenu` (`lib/ui/menu.ts`), the choice is a
 * function of the item id.
 */

import { ACTION_BAR_ICON_CAP } from "@fusion/shared";

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
/** BAR-F3-05: the ids of "Trocar ícone…" and "Restaurar ícone padrão". */
export const CHANGE_ICON_ITEM = "change-icon";
export const RESTORE_ICON_ITEM = "restore-icon";

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

/**
 * BAR-F3-05: what the icon items need to know about the entry — whether this user may write the
 * actor (owner or privileged), the entry's current custom image, and how many the actor has.
 */
export interface SlotMenuIconState {
  canEdit: boolean;
  current: string | null;
  count: number;
}

/**
 * What the menu of one entry may add to "Abrir na ficha": one optional field per task, so each task
 * adds its own field and its own items without touching the others'.
 */
export interface SlotMenuOptions {
  /** BAR-F3-01: the favourites row. Absent, there is nothing to pin into and no pin items. */
  favorites?: Pick<FavoritesSource, "isPinned" | "slots"> | undefined;
  /** BAR-F3-05: the entry's custom icon; absent, no icon items. */
  icon?: SlotMenuIconState | undefined;
}

/**
 * The items of the menu of one entry: "Abrir na ficha"; then, when the favourites row is given,
 * "Fixar nos Favoritos" or "Desafixar" (BAR-F3-01); and at the END, after a separator, the icon items
 * (BAR-F3-05): "Trocar ícone…" always (disabled with the reason when the actor is at the cap and this
 * entry has no image yet) and "Restaurar ícone padrão" only when it has one — none of them for whoever
 * may not write the actor.
 */
export function slotMenuItems(entry: ActionBarEntry, options: SlotMenuOptions = {}): MenuEntry[] {
  const { favorites, icon } = options;
  const items: MenuEntry[] = [
    { id: OPEN_SHEET_ITEM, label: t("FUSION.ActionBar.Menu.OpenSheet") },
    ...(favorites === undefined ? [] : favoritesItems(entry, favorites)),
  ];
  if (icon !== undefined && icon.canEdit) {
    const atCap = icon.current === null && icon.count >= ACTION_BAR_ICON_CAP;
    items.push(
      { kind: "separator" },
      atCap
        ? {
            id: CHANGE_ICON_ITEM,
            label: t("FUSION.ActionBar.Menu.ChangeIcon"),
            disabled: true,
            reason: t("FUSION.ActionBar.Menu.IconCap", { cap: String(ACTION_BAR_ICON_CAP) }),
          }
        : { id: CHANGE_ICON_ITEM, label: t("FUSION.ActionBar.Menu.ChangeIcon") },
    );
    if (icon.current !== null) {
      items.push({ id: RESTORE_ICON_ITEM, label: t("FUSION.ActionBar.Menu.RestoreIcon") });
    }
  }
  return items;
}

export interface SlotMenuContext {
  actorId: string;
  services: Pick<ActionBarServices, "openActorSheet"> & Partial<Pick<ActionBarServices, "notify">>;
  /** The entry the menu was opened on (the pin and unpin items act on it). */
  entry?: ActionBarEntry | undefined;
  favorites?: FavoritesSource | undefined;
  /** BAR-F3-05: the icon actions of the entry (`iconMenuActions`); absent, the icon items do nothing. */
  icon?: { pick: () => void; restore: () => void } | undefined;
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
  } else if (itemId === CHANGE_ICON_ITEM) {
    context.icon?.pick();
  } else if (itemId === RESTORE_ICON_ITEM) {
    context.icon?.restore();
  }
}
