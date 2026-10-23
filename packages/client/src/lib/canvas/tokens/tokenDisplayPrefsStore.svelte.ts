/**
 * tokenDisplayPrefsStore.svelte.ts — the live, in-memory mirror of the two
 * token display toggles (spec 41-token.md REQ-TOK-074, TK080, DEC-TOK-11).
 *
 * `lib/settings/clientPrefs.ts` owns the actual storage (localStorage,
 * world+user scoped, never touches a socket — see that module's docstring).
 * This module exists ONLY so the canvas can read the CURRENT value without
 * re-parsing `localStorage` on every frame, and so a toggle in the
 * Configurações drawer takes effect immediately on the already-rendered
 * scene, not on the next reload — `TokenLayer.tick()` compares
 * `tokenDisplayPrefs.current` by reference every frame (cheap) and
 * re-applies `TokenSprite.updateLod` for every sprite when it changes,
 * exactly the same mechanism it already uses for a zoom change.
 *
 * REQ-TOK-075/076: this store is read-only from the canvas's side. Nothing
 * here can ever cause a token to be drawn that the server did not already
 * emit — `TokenSprite.updateLod` only ANDs this preference with the
 * zoom-based LOD, it never adds visibility the LOD or the mirror lacked.
 */

import {
  loadClientPreferences,
  setTokenDisplayPreference,
  DEFAULT_TOKEN_DISPLAY,
  type ClientPreferences,
  type TokenDisplayPreferences,
} from "../../settings/clientPrefs.js";

const state = $state<{ prefs: TokenDisplayPreferences }>({ prefs: DEFAULT_TOKEN_DISPLAY });

/** The token display preferences as of the last load/set — read-only. */
export const tokenDisplayPrefs = {
  get current(): TokenDisplayPreferences {
    return state.prefs;
  },
};

/** Load this user's saved preference into the live store (call once per world join). */
export function initTokenDisplayPrefs(worldId: string, userId: string): void {
  state.prefs = loadClientPreferences(worldId, userId).tokenDisplay;
}

/**
 * Toggle one preference, persist it, and update the live store the canvas
 * reads. Returns the full persisted `ClientPreferences`, mirroring
 * `clientPrefs.ts`'s own setters, so a caller (the Settings UI) can update
 * its own local `$state` copy from the same call instead of re-reading
 * storage.
 */
export function setTokenDisplayPref(
  worldId: string,
  userId: string,
  key: keyof TokenDisplayPreferences,
  value: boolean,
): ClientPreferences {
  const result = setTokenDisplayPreference(worldId, userId, key, value);
  state.prefs = result.tokenDisplay;
  return result;
}

/** Test-only: reset the live store to defaults without touching localStorage. */
export function resetTokenDisplayPrefsForTest(): void {
  state.prefs = DEFAULT_TOKEN_DISPLAY;
}
