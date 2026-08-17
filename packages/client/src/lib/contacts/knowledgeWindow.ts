/**
 * knowledgeWindow.ts — the ONE door to the "Quem conhece quem" window.
 *
 * The window itself is spec 39's (`components/contacts/KnowledgeGridWindow.svelte`,
 * REQ-CTT-061). Two tabs now open it — the Contatos footer and the NPCs footer
 * (REQ-NPC-062, REQ-NPC-072) — and REQ-NPC-072 is explicit that the second door
 * must not bring a second window or a second knowledge model with it. So the open
 * call lives here, once: both footers call this function, neither of them owns a
 * `windowManager.open` of its own, and the singleton key makes the second click
 * focus the grid the first one opened (REQ-UIF-014).
 *
 * Because the component and the op are the same in both paths, editing knowledge
 * from either tab travels the same `actor:setKnowledge` and reaches every affected
 * user the same way (REQ-NPC-073, REQ-CTT-075).
 *
 * Kept out of the components so it can be exercised without a DOM: the client
 * project runs Vitest in a node environment.
 */

import type { Socket } from "socket.io-client";

import { t } from "../i18n/i18n.js";
import { windowManager } from "../windows/window-manager.js";
import KnowledgeGridWindow from "../../components/contacts/KnowledgeGridWindow.svelte";

import type { WindowHandle, WindowOpenOptions } from "../windows/window-manager.js";

/** One grid per table, whichever tab asked for it and however often. */
export const KNOWLEDGE_WINDOW_KEY = "contacts:knowledge";

/** Title of the window, in both tabs — the name of the thing does not change per door. */
export const KNOWLEDGE_WINDOW_TITLE_KEY = "FUSION.Contacts.Knowledge.Window";

/**
 * The options both doors pass. Exported so a test can prove the two callers open
 * the same component under the same key without rendering a window host.
 */
export function knowledgeWindowOptions(socket: Socket): WindowOpenOptions {
  return {
    singletonKey: KNOWLEDGE_WINDOW_KEY,
    title: t(KNOWLEDGE_WINDOW_TITLE_KEY),
    resizable: true,
    minimizable: true,
    // Close to the prototype's dense 600px matrix (npcs-tab.prototype.html,
    // `.win { width: 600px }`) now that cells hold a one-character symbol
    // instead of a full-word label.
    position: { width: 600, height: 420 },
    minWidth: 360,
    minHeight: 220,
    component: KnowledgeGridWindow,
    componentProps: { socket },
  };
}

/** Open (or focus) "Quem conhece quem" outside the drawer (REQ-CTT-061). */
export function openKnowledgeWindow(socket: Socket): WindowHandle {
  return windowManager.open(knowledgeWindowOptions(socket));
}
