/**
 * actionBarIcons.ts — the custom image of a bar entry, as pure functions (BAR-F3-05, D-BA02/D-BA03).
 *
 * What the slot draws, who is offered the change, what the change writes. Pure and structural
 * (tasks.md §2.10): the `.svelte` files only call these. The menu ITEMS themselves are the slot
 * menu's (`slotMenu.ts`), next to "Abrir na ficha".
 *
 *  - READ: `flags.fusion.actionBar.icons[entryId]`, and only a value that is one icon-area path
 *    (`isActionBarIconPath`, the same rule the server validates and signs) — anything else is the
 *    generic icon. The client never puts an arbitrary stored string into an `<img src>`.
 *  - PAINT: `/assets/*` answers only to a grant (T025), so the slot never uses the path as a `src`:
 *    it asks the read grant of the ACTOR the image belongs to (`resolveSlotIconUrl`), exactly as the
 *    portrait does, and draws the generic icon until it arrives or if it fails.
 *  - OFFER: "Trocar ícone…" and "Restaurar ícone padrão" (REQ-BAR-074) only to whoever may write
 *    the actor: an owner, or a privileged role (REQ-BAR-072/073). Hiding them is courtesy, not the
 *    gate — the server refuses a write on someone else's actor whatever the menu showed.
 *  - WRITE: one flat `doc:update` (the sheets' shape) with `actionBarIconPatch` — the map as a
 *    nested object under the dot-path key, so the entry id keeps its dots and every sibling entry
 *    survives; `null` restores the generic icon. `makeSendOpFn` fills `expectedVersion` and redoes a
 *    stale write on the fresh document (REQ-BAR-063 semantics).
 */

import {
  actionBarIconPatch,
  getUserLevel,
  isActionBarIconPath,
  OwnershipLevel,
  readActionBarFlags,
  type Ownership,
} from "@fusion/shared";

import { resolveAssetUrl } from "../assets/assetApi.js";

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

/** The flat op that sets (path) or restores (null) the icon of one entry of one actor. */
export function iconWriteOp(
  actorId: string,
  entryId: string,
  path: string | null,
): { type: "doc:update"; documentType: "Actor"; id: string; diff: Record<string, unknown> } {
  return {
    type: "doc:update",
    documentType: "Actor",
    id: actorId,
    diff: actionBarIconPatch(entryId, path),
  };
}

/**
 * The op for what the picker chose, or `null` when the choice is not an icon of the gallery — the
 * icon-mode picker only ever hands back one, and anything else would be refused by the server.
 */
export function iconChoiceOp(
  actorId: string,
  entryId: string,
  path: string,
): ReturnType<typeof iconWriteOp> | null {
  return isActionBarIconPath(path) ? iconWriteOp(actorId, entryId, path) : null;
}

/** Which entry of which actor the open picker is choosing an image for. */
export interface IconPickTarget {
  actorId: string;
  entryId: string;
}

/** What "Trocar ícone…" and "Restaurar ícone padrão" do, for one entry of one actor. */
export function iconMenuActions(input: {
  actorId: string;
  entryId: string;
  openPicker: (target: IconPickTarget) => void;
  sendOp: (op: unknown) => void;
}): { pick: () => void; restore: () => void } {
  return {
    pick: () => {
      input.openPicker({ actorId: input.actorId, entryId: input.entryId });
    },
    restore: () => {
      input.sendOp(iconWriteOp(input.actorId, input.entryId, null));
    },
  };
}

// ---------------------------------------------------------------------------
// What each slot reads from its bar
// ---------------------------------------------------------------------------

/** The context key the bar hands its slots the icon source under (`setContext` / `getContext`). */
export const SLOT_ICON_SOURCE = Symbol("fusion.actionbar.slotIcon");

/** What a slot asks its bar to draw its entry's custom image. */
export interface SlotIconSource {
  /** The bar's actor — the document the image's read grant is asked for; `null` without one. */
  readonly actorId: string | null;
  /** The entry's custom image, or `null` for the generic icon. */
  iconOf(entryId: string): string | null;
}

/**
 * The icon source of a bar, reading the actor through `actor()` on every access — inside a slot's
 * `$derived` that read is reactive, so the slot redraws when the map changes.
 */
export function createSlotIconSource(
  actor: () => Record<string, unknown> | undefined,
): SlotIconSource {
  return {
    get actorId(): string | null {
      const id = actor()?.["_id"];
      return typeof id === "string" ? id : null;
    },
    iconOf(entryId: string): string | null {
      return customIconOf(actor(), entryId);
    },
  };
}

/**
 * The URL that paints an entry's image: the actor's read grant for it (`POST /api/assets/grant`
 * with `{ table: "actors", id }`), the same road the portrait takes. `null` when there is nothing to
 * ask with (no session) or the value is not an icon path — the slot then keeps the generic icon.
 */
export async function resolveSlotIconUrl(
  path: string,
  actorId: string,
  session: { token: string | null; userId: string | null | undefined },
): Promise<string | null> {
  if (!isActionBarIconPath(path)) return null;
  const { token, userId } = session;
  if (token === null || token === "" || userId === null || userId === undefined || userId === "") {
    return null;
  }
  return resolveAssetUrl(path, token, userId, { table: "actors", id: actorId });
}
