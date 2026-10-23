/**
 * npcCreateWindow.ts — the creation window of the NPCs tab (spec 42 §5.6, G074).
 *
 * The drawer is 300px wide and never widens (REQ-GAV-012), so a form with two
 * doors in it opens OUTSIDE the drawer, as a window of the ONE window manager
 * (REQ-UIF-009) — never as a private modal of the panel.
 *
 * One window at a time (REQ-UIF-014): the singleton key is the world's, not a
 * folder's, because "create a non-playable" is one intention no matter which
 * folder header it was asked from. The folder is a SEED of that window, and
 * REQ-NPC-047 wants the seed to follow the gesture — so asking again from a
 * different folder replaces the window instead of focusing a form still pointing
 * at the old folder. Asking again from the same folder just focuses it, which is
 * what keeps a half-typed name alive.
 */

import type { Socket } from "socket.io-client";

import { windowManager } from "../windows/window-manager.js";
import { t } from "../i18n/i18n.js";
import NpcCreateDialog from "../../components/npcs/NpcCreateDialog.svelte";
import type { MoveTargetOption } from "./moveActor.js";
import { normalizeFolderId } from "./moveActor.js";

/** i18n key of the window title. */
export const NPC_CREATE_WINDOW_TITLE_KEY = "FUSION.Npcs.Create.Title";

/** REQ-UIF-014: one creation window per world. */
export const NPC_CREATE_WINDOW_KEY = "npcs:create";

const SIZE = { width: 460, height: 560 } as const;

function openEntry(): { id: string; componentProps?: Record<string, unknown> } | null {
  for (const entry of windowManager.windows.values()) {
    if (entry.singletonKey === NPC_CREATE_WINDOW_KEY) return entry;
  }
  return null;
}

/** True while the creation window is open — used by the tests and by the panel. */
export function isNpcCreateWindowOpen(): boolean {
  return openEntry() !== null;
}

/** Close the creation window, if it is open. */
export function closeNpcCreateWindow(): void {
  const entry = openEntry();
  if (entry !== null) windowManager.close(entry.id);
}

export interface OpenNpcCreateWindowOptions {
  readonly socket: Socket;
  /** REQ-NPC-047: the folder the gesture came from, pre-selected in the form. */
  readonly folderId?: string | null;
  /** Every folder of the tree plus "Sem pasta", in tree order. */
  readonly folderOptions: readonly MoveTargetOption[];
}

/**
 * REQ-NPC-040/REQ-NPC-041: open the window that offers the two doors, seeded with
 * the folder the gesture came from (REQ-NPC-047).
 */
export function openNpcCreateWindow(options: OpenNpcCreateWindowOptions): void {
  const folderId = normalizeFolderId(options.folderId);

  const open = openEntry();
  if (open !== null && (open.componentProps?.["initialFolderId"] ?? null) !== folderId) {
    // The seed changed, so the form has to be rebuilt: focusing a window whose
    // folder select still points at the previous folder would quietly break
    // REQ-NPC-047 for the second gesture.
    windowManager.close(open.id);
  }

  windowManager.open({
    singletonKey: NPC_CREATE_WINDOW_KEY,
    title: t(NPC_CREATE_WINDOW_TITLE_KEY),
    position: SIZE,
    component: NpcCreateDialog,
    componentProps: {
      socket: options.socket,
      initialFolderId: folderId,
      folderOptions: options.folderOptions,
      onClose: closeNpcCreateWindow,
    },
  });
}
