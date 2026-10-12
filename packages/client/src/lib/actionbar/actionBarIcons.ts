/**
 * actionBarIcons.ts — the custom image of a bar entry, as pure functions (BAR-F3-05, D-BA02/D-BA03).
 *
 * What the slot draws, what the slot's menu offers and what the change writes. Pure and structural
 * (tasks.md §2.10): the `.svelte` files only call these.
 *
 *  - READ: `flags.fusion.actionBar.icons[entryId]`, and only a value that is one icon-area path
 *    (`isActionBarIconPath`, the same rule the server validates and signs) — anything else is the
 *    generic icon. The client never puts an arbitrary stored string into an `<img src>`.
 *  - OFFER: "Trocar ícone…" and "Restaurar ícone padrão" (REQ-BAR-074) only to whoever may write
 *    the actor: an owner, or a privileged role (REQ-BAR-072/073). Hiding them is courtesy, not the
 *    gate — the server refuses a write on someone else's actor whatever the menu showed.
 *  - WRITE: one `doc:update` with `actionBarIconPatch` — the map as a nested object under the
 *    dot-path key, so the entry id keeps its dots and every sibling entry survives; `null`
 *    restores the generic icon. `makeSendOpFn` fills `expectedVersion` and redoes a stale write
 *    on the fresh document (REQ-BAR-063 semantics).
 */

import {
  ACTION_BAR_ICON_CAP,
  actionBarIconPatch,
  getUserLevel,
  isActionBarIconPath,
  OwnershipLevel,
  readActionBarFlags,
  type Ownership,
} from "@fusion/shared";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The icon map of an actor document, or `{}`. */
function iconMapOf(actor: unknown): Record<string, unknown> {
  const bar = readActionBarFlags(actor);
  if (!isPlainObject(bar)) return {};
  const icons = bar["icons"];
  return isPlainObject(icons) ? icons : {};
}

/** The custom image of one entry, or `null` for the generic icon. */
export function customIconOf(actor: unknown, entryId: string): string | null {
  const value = iconMapOf(actor)[entryId];
  return typeof value === "string" && isActionBarIconPath(value) ? value : null;
}

/** How many entries of this actor carry a custom image. */
export function customIconCount(actor: unknown): number {
  return Object.keys(iconMapOf(actor)).length;
}

/**
 * Whether this user may change the icons of this actor: a privileged role (REQ-BAR-073) or an
 * OWNER of the actor (REQ-BAR-072) — the same two doors the server's `doc:update` opens.
 */
export function canEditActorIcons(
  actor: unknown,
  userId: string | null | undefined,
  privileged: boolean,
): boolean {
  if (privileged) return true;
  if (!isPlainObject(actor)) return false;
  const ownership = actor["ownership"];
  if (!isPlainObject(ownership)) return false;
  return getUserLevel(ownership as Ownership, userId) >= OwnershipLevel.OWNER;
}

export const ICON_MENU_CHANGE = "actionbar:icon:change";
export const ICON_MENU_RESTORE = "actionbar:icon:restore";

/** A menu item, structurally the `MenuItem` of `lib/ui/menu.ts`. */
export interface IconMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  reason?: string;
}

/**
 * The icon items of a slot's menu: nothing for whoever may not write the actor; "Trocar ícone…"
 * always (disabled with the reason when the actor is at the cap and this entry has no image yet);
 * "Restaurar ícone padrão" only when the entry has one.
 */
export function iconMenuItems(state: {
  canEdit: boolean;
  current: string | null;
  count: number;
}): IconMenuItem[] {
  if (!state.canEdit) return [];
  const atCap = state.current === null && state.count >= ACTION_BAR_ICON_CAP;
  const items: IconMenuItem[] = [
    atCap
      ? {
          id: ICON_MENU_CHANGE,
          label: "Trocar ícone…",
          disabled: true,
          reason: `Este personagem já tem ${String(ACTION_BAR_ICON_CAP)} ícones customizados`,
        }
      : { id: ICON_MENU_CHANGE, label: "Trocar ícone…" },
  ];
  if (state.current !== null)
    items.push({ id: ICON_MENU_RESTORE, label: "Restaurar ícone padrão" });
  return items;
}

/** The op that sets (path) or restores (null) the icon of one entry of one actor. */
export function iconWriteOp(
  actorId: string,
  entryId: string,
  path: string | null,
): {
  type: "doc:update";
  documentType: "Actor";
  updates: Array<{ _id: string; diff: Record<string, unknown> }>;
} {
  return {
    type: "doc:update",
    documentType: "Actor",
    updates: [{ _id: actorId, diff: actionBarIconPatch(entryId, path) }],
  };
}
