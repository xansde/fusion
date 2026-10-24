/**
 * targetModeStore.svelte.ts — the chosen aim mode ("Um alvo" / "Vários"), per user, remembered in this browser.
 * Read by TokenInteractionManager on every right-click; set by TargetToolButton.
 */

import { loadTargetMode, saveTargetMode, type TargetMode } from "./targetMode.js";

export const targetModeState: { mode: TargetMode } = $state({ mode: loadTargetMode() });

export function setTargetMode(mode: TargetMode): void {
  targetModeState.mode = mode;
  saveTargetMode(mode);
}
