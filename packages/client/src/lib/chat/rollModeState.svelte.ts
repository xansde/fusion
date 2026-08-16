/**
 * rollModeState.svelte.ts — the selector's current value, readable from anywhere.
 *
 * Spec 38 (`specs/38-aba-chat.md`), DEC-ACH-04 / REQ-ACH-042: the chosen roll mode applies
 * to **every** roll started by this user — the chat box, the favorites row, the roll
 * builder window, a sheet button, a card button. Those origins live far from the chat
 * panel, and the panel unmounts whenever the drawer switches tabs, so the value cannot be
 * local component state: it is one session-scoped store that every origin reads.
 *
 * This module holds the value and nothing else:
 *  - WHERE it is persisted is `rollModePreference.ts` (per world + user, REQ-ACH-041);
 *  - WHO wins between a command, a locked favorite and the selector is
 *    `resolveRollMode.ts` (REQ-ACH-043/044) — and every origin should build its payload
 *    with `buildChatSendPayload`, never by setting `rollMode` by hand.
 */

import { DEFAULT_ROLL_MODE, loadRollMode, saveRollMode } from "./rollModePreference.js";

import type { RollMode } from "@fusion/shared";

/** The mode the selector is showing right now. Read it; write through `setRollMode`. */
export const rollModeState: { mode: RollMode } = $state({ mode: DEFAULT_ROLL_MODE });

/**
 * Restore this user's mode in this world (REQ-ACH-041). Idempotent — safe to call on
 * every mount of the chat panel.
 */
export function initRollMode(worldId: string, userId: string): RollMode {
  rollModeState.mode = loadRollMode(worldId, userId);
  return rollModeState.mode;
}

/** Record the user's choice and persist it on this device (REQ-ACH-041). */
export function setRollMode(worldId: string, userId: string, mode: RollMode): void {
  rollModeState.mode = mode;
  saveRollMode(worldId, userId, mode);
}

/** Current mode, for callers that only need the value (non-reactive read). */
export function currentRollMode(): RollMode {
  return rollModeState.mode;
}
