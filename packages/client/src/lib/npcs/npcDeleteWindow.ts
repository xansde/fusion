/**
 * npcDeleteWindow.ts — the confirmation of the delete (spec 42 §5.7, §8 item 5).
 *
 * The confirmation opens OUTSIDE the drawer, as a window of the ONE window manager
 * (REQ-UIF-009), for the same reason the creation window does: the drawer is 300px
 * wide and never widens (REQ-GAV-012), and what REQ-NPC-051 has to show — presences
 * per scene, the knowledge that ceases to exist, the sheet's items, and possibly a
 * refusal that explains itself — does not fit in a one-line confirm.
 *
 * One window at a time (REQ-UIF-014), and it is keyed by the tab rather than by the
 * actor: "am I deleting this?" is one question, and asking it about a second actor
 * has to REPLACE the first question, never stack a second confirmation whose button
 * says the same word about a different row.
 */

import type { Socket } from "socket.io-client";

import { windowManager } from "../windows/window-manager.js";
import { t } from "../i18n/i18n.js";
import NpcDeleteDialog from "../../components/npcs/NpcDeleteDialog.svelte";

/** i18n key of the window title. */
export const NPC_DELETE_WINDOW_TITLE_KEY = "FUSION.Npcs.Delete.Title";

/** REQ-UIF-014: one delete confirmation per world. */
export const NPC_DELETE_WINDOW_KEY = "npcs:delete";

const SIZE = { width: 420, height: 420 } as const;

function openEntry(): { id: string; componentProps?: Record<string, unknown> } | null {
  for (const entry of windowManager.windows.values()) {
    if (entry.singletonKey === NPC_DELETE_WINDOW_KEY) return entry;
  }
  return null;
}

/** True while a delete confirmation is open. */
export function isNpcDeleteWindowOpen(): boolean {
  return openEntry() !== null;
}

/** Close the delete confirmation, if it is open. */
export function closeNpcDeleteWindow(): void {
  const entry = openEntry();
  if (entry !== null) windowManager.close(entry.id);
}

export interface OpenNpcDeleteWindowOptions {
  readonly socket: Socket;
  readonly actorId: string;
  readonly name: string;
  /** The Actor subtype — REQ-NPC-055 is re-checked inside the window as well. */
  readonly subtype: string;
}

/**
 * REQ-NPC-050/051: open the confirmation for one non-playable, replacing any
 * confirmation still open for a different one.
 */
export function openNpcDeleteWindow(options: OpenNpcDeleteWindowOptions): void {
  const open = openEntry();
  if (open !== null && open.componentProps?.["actorId"] !== options.actorId) {
    // Focusing a window that still names the previous actor would put the
    // Mestre's confirmation on the wrong row — the one irreversible gesture of
    // this tab is the last place to reuse a stale form.
    windowManager.close(open.id);
  }

  windowManager.open({
    singletonKey: NPC_DELETE_WINDOW_KEY,
    title: t(NPC_DELETE_WINDOW_TITLE_KEY),
    position: SIZE,
    component: NpcDeleteDialog,
    componentProps: {
      socket: options.socket,
      actorId: options.actorId,
      name: options.name,
      subtype: options.subtype,
      onClose: closeNpcDeleteWindow,
    },
  });
}
