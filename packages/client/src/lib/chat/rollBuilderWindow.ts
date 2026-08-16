/**
 * rollBuilderWindow.ts — opening the roll builder as a floating window.
 *
 * Spec 38 (`specs/38-aba-chat.md`), REQ-ACH-063: the builder is a window of the window
 * manager (REQ-UIF-009) and MUST NOT change the drawer's width (REQ-GAV-012). Both follow
 * from being a window at all — the drawer is not asked to make room for anything — so the
 * only rule that needs code is the singleton key: the fourth button of the tray can be
 * pressed many times and must focus the window that is already open instead of stacking
 * copies of it (REQ-UIF-014).
 *
 * Kept out of the component so it can be exercised without a DOM: the client project runs
 * Vitest in a node environment.
 */

import { t } from "../i18n/i18n.js";
import { windowManager } from "../windows/window-manager.js";
import FavoriteDiceEditor from "../../components/chat/FavoriteDiceEditor.svelte";
import RollBuilderWindow from "../../components/chat/RollBuilderWindow.svelte";

import type { WindowHandle } from "../windows/window-manager.js";

/** One builder window per table, whoever asks and however often (REQ-UIF-014). */
export const ROLL_BUILDER_WINDOW_KEY = "chat:rollBuilder";

/** One favourites editor, opened from the panel's "⋯" (REQ-ACH-015, REQ-ACH-055). */
export const FAVORITE_DICE_EDITOR_WINDOW_KEY = "chat:favoriteDice";

/** Who the builder rolls and saves favourites for. */
export interface OpenRollBuilderInput {
  readonly worldId: string;
  readonly userId: string;
}

/**
 * Open (or focus) the roll builder (REQ-ACH-060, REQ-ACH-063).
 *
 * The window resolves its own live socket when it rolls: `componentProps` are captured at
 * open time, and a socket captured then would be frozen if the connection were replaced
 * while the window stayed open.
 */
export function openRollBuilderWindow(input: OpenRollBuilderInput): WindowHandle {
  return windowManager.open({
    singletonKey: ROLL_BUILDER_WINDOW_KEY,
    title: t("FUSION.Chat.RollBuilder.Title"),
    resizable: true,
    minimizable: true,
    minWidth: 280,
    minHeight: 320,
    position: { width: 340, height: 460 },
    component: RollBuilderWindow,
    componentProps: { worldId: input.worldId, userId: input.userId },
  });
}

/**
 * Open (or focus) the favourites editor (REQ-ACH-055).
 *
 * Offered to **every** role from the panel's "⋯" (REQ-ACH-015): a favourite has no
 * permission to check, because it is a local shortcut and not a macro (REQ-ACH-057).
 */
export function openFavoriteDiceEditorWindow(input: OpenRollBuilderInput): WindowHandle {
  return windowManager.open({
    singletonKey: FAVORITE_DICE_EDITOR_WINDOW_KEY,
    title: t("FUSION.Chat.Favorites.Editor.Title"),
    resizable: true,
    minimizable: true,
    minWidth: 280,
    minHeight: 320,
    position: { width: 340, height: 480 },
    component: FavoriteDiceEditor,
    componentProps: { worldId: input.worldId, userId: input.userId },
  });
}
