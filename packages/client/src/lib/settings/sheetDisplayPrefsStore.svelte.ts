/**
 * sheetDisplayPrefsStore.svelte.ts — the live, in-memory mirror of the character-sheet display
 * toggles (today: the "i" that explains a derived number).
 *
 * `clientPrefs.ts` owns the storage (localStorage, world + user scoped, never a socket). This
 * module only exists so a sheet that is ALREADY open reads the current value reactively and
 * follows a toggle in Configurações at once, instead of re-parsing `localStorage` or waiting for a
 * reload — the same split `tokenDisplayPrefsStore.svelte.ts` makes for the canvas. A game-system
 * sheet reaches it through the `$lib` alias.
 */

import {
  DEFAULT_SHEET_DISPLAY,
  loadClientPreferences,
  setSheetDisplayPreference,
  type ClientPreferences,
  type SheetDisplayPreferences,
} from "./clientPrefs.js";

const state = $state<{ prefs: SheetDisplayPreferences }>({ prefs: DEFAULT_SHEET_DISPLAY });

/** The sheet display preferences as of the last load/set — read-only. */
export const sheetDisplayPrefs = {
  get current(): SheetDisplayPreferences {
    return state.prefs;
  },
};

/** Load this user's saved preference into the live store (call once per world join). */
export function initSheetDisplayPrefs(worldId: string, userId: string): void {
  state.prefs = loadClientPreferences(worldId, userId).sheetDisplay;
}

/**
 * Toggle one preference, persist it and update the live store. Returns the full persisted
 * `ClientPreferences`, like the setters in `clientPrefs.ts`, so the Settings UI can refresh its own
 * local copy from the same call.
 */
export function setSheetDisplayPref(
  worldId: string,
  userId: string,
  key: keyof SheetDisplayPreferences,
  value: boolean,
): ClientPreferences {
  const result = setSheetDisplayPreference(worldId, userId, key, value);
  state.prefs = result.sheetDisplay;
  return result;
}

/** Test-only: reset the live store to defaults without touching localStorage. */
export function resetSheetDisplayPrefsForTest(): void {
  state.prefs = DEFAULT_SHEET_DISPLAY;
}
