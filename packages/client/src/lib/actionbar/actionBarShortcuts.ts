/**
 * actionBarShortcuts.ts — the keys of the action bar (BAR-F1-05; spec 53 REQ-BAR-048..051;
 * tasks.md BAR-F1-05).
 *
 * **1–9, 0, − and =** run the twelve favourites, in the order of the slots (D-BA07); **Esc**
 * cancels an open menu (and, once aim mode exists, the aim — outside this delivery, D-BA16). They are
 * thirteen NAMED actions in the central registry (`shortcutRegistry.ts`, REQ-BAR-050), not a second
 * listener, so the registry's guard applies to all of them: never from a text field, a dialog or a
 * focused button (REQ-BAR-049), never with Ctrl, Alt or Meta, and a held key runs once.
 *
 * Two rules keep a key from being swallowed for nothing:
 *  - A number key is only CONSUMED when there is something to run (`canRunFavorite`): a bar is drawn
 *    and that favourite is on the sheet. An empty slot, or no bar at all (the Mestre with nothing
 *    selected), leaves the key alone.
 *  - Esc is only consumed when the bar has something to close (`canCancel`). Otherwise it goes on to
 *    the canvas, where it deselects the token: one Escape closes one thing, and an idle bar is not a
 *    thing. (A menu that is open is also closed by its own layer before this runs; this is the
 *    registry's half, and the one the aim mode will use.)
 *
 * **The click of the mouse must not kill the keys (Q-BAR-07).** A click on a slot leaves the focus on
 * its `<button>`, and the guard suspends the keys with a button focused. The slot gives the focus
 * back to the canvas after a pointer click (`releaseFocusAfterPointer`, `slotFocus.ts`), and THIS
 * task owns the result: the test walks click → key for every one of the twelve keys. A keyboard
 * activation (Tab to the slot, Enter) keeps the focus on the button and the keys suspended — that
 * user is inside the bar (REQ-BAR-049).
 */

import {
  registerShortcut as registerInAppRegistry,
  type ShortcutRegistry,
} from "../shortcuts/shortcutRegistry.js";
import type { ActionBarController } from "./actionBarController.svelte.js";
import { FAVORITE_KEYS } from "./favoriteKeys.js";

/** What this module needs from the controller (a structural subset of {@link ActionBarController}). */
export type ShortcutController = Pick<
  ActionBarController,
  "runFavorite" | "canRunFavorite" | "cancel" | "canCancel"
>;

/**
 * Registers the keys of the bar. Returns the function that takes them out again.
 *
 * @param registry  The registry to register in; the app's, unless a test brings its own.
 */
export function registerActionBarShortcuts(
  controller: ShortcutController,
  registry?: ShortcutRegistry,
): () => void {
  const register =
    registry === undefined
      ? registerInAppRegistry
      : (definition: Parameters<ShortcutRegistry["register"]>[0]) => registry.register(definition);

  const unregister: Array<() => void> = FAVORITE_KEYS.map((favorite, index) =>
    register({
      id: `actionbar.favorite.${String(index + 1)}`,
      codes: [favorite.code],
      run: () => {
        if (!controller.canRunFavorite(index)) return false;
        void controller.runFavorite(index);
        return true;
      },
    }),
  );

  unregister.push(
    register({
      id: "actionbar.cancel",
      codes: ["Escape"],
      run: () => {
        if (!controller.canCancel) return false;
        controller.cancel();
        return true;
      },
    }),
  );

  return () => {
    for (const off of unregister) off();
  };
}
