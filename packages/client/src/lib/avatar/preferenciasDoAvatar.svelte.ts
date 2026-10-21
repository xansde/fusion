/**
 * preferenciasDoAvatar.svelte.ts — the live mirror of THIS viewer's avatar
 * overlay preferences (show/hide, size, corner or dragged spot).
 *
 * `lib/settings/clientPrefs.ts` owns the storage (localStorage, world + user
 * scoped, never leaves the device). This store exists so the three places that
 * edit it — the overlay's own menu, the creator, and Configurações →
 * Preferências — and the overlay that reads it agree at once, without a reload.
 * Same shape as tokenDisplayPrefsStore.svelte.ts.
 */

import {
  DEFAULT_AVATAR_OVERLAY,
  loadClientPreferences,
  setAvatarOverlayPreference,
  type AvatarOverlayPreferences,
} from "../settings/clientPrefs.js";

const estado = $state<{ prefs: AvatarOverlayPreferences; worldId: string; userId: string }>({
  prefs: DEFAULT_AVATAR_OVERLAY,
  worldId: "",
  userId: "",
});

export const preferenciasDoAvatar = {
  get atual(): AvatarOverlayPreferences {
    return estado.prefs;
  },
};

/** Load this viewer's saved preference (call once per world join). */
export function iniciarPreferenciasDoAvatar(worldId: string, userId: string): void {
  estado.worldId = worldId;
  estado.userId = userId;
  estado.prefs = loadClientPreferences(worldId, userId).avatarOverlay;
}

/** Change part of the preference, persist it, and update every reader at once. */
export function mudarPreferenciasDoAvatar(patch: Partial<AvatarOverlayPreferences>): void {
  const proximo = setAvatarOverlayPreference(estado.worldId, estado.userId, patch);
  // Without an identity nothing is persisted, but the screen still follows the choice.
  estado.prefs =
    estado.worldId === "" || estado.userId === ""
      ? { ...estado.prefs, ...patch }
      : proximo.avatarOverlay;
}
