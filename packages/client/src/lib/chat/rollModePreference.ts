/**
 * rollModePreference.ts — persist user roll mode selection across sessions.
 *
 * Stores the user's preferred roll mode in localStorage so it survives
 * page reloads. Falls back to "public" if localStorage is unavailable.
 *
 * REQ-ROL-020: default roll mode configurable per user.
 */

import type { RollMode } from "@fusion/shared";

const STORAGE_KEY = "fusion:rollMode";
const VALID_MODES: ReadonlySet<string> = new Set(["public", "gmroll", "blindroll", "selfroll"]);

export function loadRollMode(): RollMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_MODES.has(stored)) {
      return stored as RollMode;
    }
  } catch {
    // localStorage unavailable (e.g., in tests)
  }
  return "public";
}

export function saveRollMode(mode: RollMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}
