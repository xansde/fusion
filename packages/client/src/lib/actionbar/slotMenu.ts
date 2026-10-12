/**
 * slotMenu.ts — what the right-click menu of a slot offers, and what choosing an item does
 * (BAR-F1-04; spec 53 REQ-BAR-045; tasks.md BAR-F1-04).
 *
 * For now the menu has ONE item, "Abrir na ficha": the variants (1º, 2º or 3º ataque; 1, 2 or 3
 * actions; rank; element), pin and unpin and "Ver detalhes" belong to later tasks — BAR-F3-01 adds
 * the pin and unpin, the variants menu (BAR-F3-02) is outside this delivery (D-BA16). Keeping the
 * list and the choice here, away from the component, is what lets those tasks add an item by editing
 * this file and its test only.
 *
 * Pure (§2.10): the items are data for the generic `ContextMenu` (`lib/ui/menu.ts`), the choice is a
 * function of the item id.
 */

import { t } from "../i18n/i18n.js";
import type { MenuEntry } from "../ui/menu.js";
import type { ActionBarEntry, ActionBarServices } from "./types.js";

/** The id of "Abrir na ficha". */
export const OPEN_SHEET_ITEM = "open-sheet";

/** The items of the menu of one entry. */
export function slotMenuItems(entry: ActionBarEntry): MenuEntry[] {
  void entry;
  return [{ id: OPEN_SHEET_ITEM, label: t("FUSION.ActionBar.Menu.OpenSheet") }];
}

/** Does what the chosen item says. An id this menu does not offer does nothing. */
export function runSlotMenuItem(
  itemId: string,
  context: { actorId: string; services: Pick<ActionBarServices, "openActorSheet"> },
): void {
  if (itemId === OPEN_SHEET_ITEM) context.services.openActorSheet(context.actorId);
}
