/**
 * slotMenu.ts — what the right-click menu of a slot offers, and what choosing an item does
 * (BAR-F1-04; spec 53 REQ-BAR-045; tasks.md BAR-F1-04).
 *
 * "Abrir na ficha", and the custom icon's "Trocar ícone…" and "Restaurar ícone padrão" (BAR-F3-05) at
 * the end. The variants (1º, 2º or 3º ataque; 1, 2 or 3 actions; rank; element), pin and unpin and
 * "Ver detalhes" belong to other tasks — BAR-F3-01 adds the pin and unpin, the variants menu
 * (BAR-F3-02) is outside this delivery (D-BA16). Keeping the list and the choice here, away from the
 * component, is what lets those tasks add an item by editing this file and its test only.
 *
 * Pure (§2.10): the items are data for the generic `ContextMenu` (`lib/ui/menu.ts`), the choice is a
 * function of the item id.
 */

import { ACTION_BAR_ICON_CAP } from "@fusion/shared";

import { t } from "../i18n/i18n.js";
import type { MenuEntry } from "../ui/menu.js";
import type { ActionBarEntry, ActionBarServices } from "./types.js";

/** The id of "Abrir na ficha". */
export const OPEN_SHEET_ITEM = "open-sheet";

/** BAR-F3-05: the ids of "Trocar ícone…" and "Restaurar ícone padrão". */
export const CHANGE_ICON_ITEM = "change-icon";
export const RESTORE_ICON_ITEM = "restore-icon";

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
 * What the menu of one entry may add to "Abrir na ficha", one optional field per task, so each task
 * adds its own field and its own items without touching the others' (BAR-F3-01 adds its own).
 */
export interface SlotMenuOptions {
  /** BAR-F3-05: the entry's custom icon; absent, no icon items. */
  icon?: SlotMenuIconState | undefined;
}

/**
 * The items of the menu of one entry. BAR-F3-05 adds the icon items at the END, after a separator:
 * "Trocar ícone…" always (disabled with the reason when the actor is at the cap and this entry has
 * no image yet) and "Restaurar ícone padrão" only when it has one — none of them for whoever may not
 * write the actor.
 */
export function slotMenuItems(entry: ActionBarEntry, options: SlotMenuOptions = {}): MenuEntry[] {
  void entry;
  const { icon } = options;
  const items: MenuEntry[] = [{ id: OPEN_SHEET_ITEM, label: t("FUSION.ActionBar.Menu.OpenSheet") }];
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

/** Does what the chosen item says. An id this menu does not offer does nothing. */
export function runSlotMenuItem(
  itemId: string,
  context: {
    actorId: string;
    services: Pick<ActionBarServices, "openActorSheet">;
    /** BAR-F3-05: the icon actions of the entry (`iconMenuActions`); absent, the icon items do nothing. */
    icon?: { pick: () => void; restore: () => void } | undefined;
  },
): void {
  if (itemId === OPEN_SHEET_ITEM) context.services.openActorSheet(context.actorId);
  else if (itemId === CHANGE_ICON_ITEM) context.icon?.pick();
  else if (itemId === RESTORE_ICON_ITEM) context.icon?.restore();
}
