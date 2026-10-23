/**
 * rollModePreference.ts — the roll mode selector, kept per world AND per user.
 *
 * Spec 38 (`specs/38-aba-chat.md`), DEC-ACH-04 / REQ-ACH-041: the chosen roll mode is a
 * `ClientUIPreferences` value (DEC-UIF-10 of spec 11) — it belongs to one user on one
 * device, lives in `localStorage`, is restored when the world is reopened, and is NEVER
 * sent to the server as a preference. The audience of each individual roll travels in the
 * message payload; the preference itself never leaves the machine.
 *
 * The key carries the world's identity and the user's id — the same shape the drawer uses
 * (`lib/sidebar/preferences.ts`, REQ-GAV-014). Two consequences that are the whole point:
 * a browser shared by the GM and a player keeps two independent entries, and swapping the
 * LAN address for a tunnel does not lose the setting, because the key is the world's
 * identity and not its address.
 *
 * The pre-scoped key (`fusion:rollMode`) is still READ as a fallback, so a device that
 * already had a mode keeps it on the first load after this change. It is never written
 * again: the first save moves the value to the scoped key, where it belongs.
 */

import type { RollMode } from "@fusion/shared";

/** Key prefix, following the `fusion:<thing>` convention used across the client. */
export const ROLL_MODE_KEY_PREFIX = "fusion:rollMode";

/**
 * The unscoped key written before REQ-ACH-041 — global per browser, shared by every world
 * and every user. Read-only from here on: it exists so nobody loses their setting once.
 */
export const LEGACY_ROLL_MODE_KEY = "fusion:rollMode";

/** The four roll modes (DEC-CHT-02). Anything else in storage is corrupt. */
const VALID_MODES: ReadonlySet<string> = new Set(["public", "gmroll", "blindroll", "selfroll"]);

/** Mode a user starts on, and the answer to every ambiguous case. */
export const DEFAULT_ROLL_MODE: RollMode = "public";

/**
 * Storage key of one user's roll mode in one world (REQ-ACH-041).
 *
 * `worldId` is `session.worldInfo.id` — the world's identity, never `location.host`.
 */
export function rollModeKey(worldId: string, userId: string): string {
  return `${ROLL_MODE_KEY_PREFIX}:${worldId}:${userId}`;
}

function hasIdentity(worldId: string, userId: string): boolean {
  return worldId.length > 0 && userId.length > 0;
}

function readKey(key: string): RollMode | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const stored = localStorage.getItem(key);
    if (stored !== null && VALID_MODES.has(stored)) return stored as RollMode;
  } catch {
    /* localStorage unavailable (private mode, disabled, node tests). */
  }
  return null;
}

/**
 * The roll mode this user last chose in this world, or `public` when there is nothing
 * usable (never saved, storage unavailable, corrupt value).
 *
 * Without a world and a user there is no owner for the value, so only the legacy key is
 * consulted — an anonymous scoped key would leak one user's mode into the next session.
 */
export function loadRollMode(worldId: string, userId: string): RollMode {
  if (hasIdentity(worldId, userId)) {
    const scoped = readKey(rollModeKey(worldId, userId));
    if (scoped !== null) return scoped;
  }
  return readKey(LEGACY_ROLL_MODE_KEY) ?? DEFAULT_ROLL_MODE;
}

/**
 * Persist this user's roll mode in this world (REQ-ACH-041).
 *
 * Client-only: this value never travels to the server, and no other user's entry is
 * touched. Failures are swallowed (private mode, quota, storage disabled).
 */
export function saveRollMode(worldId: string, userId: string, mode: RollMode): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(rollModeKey(worldId, userId), mode);
  } catch {
    /* ignore */
  }
}

/** Drop this user's saved roll mode in this world. */
export function clearRollMode(worldId: string, userId: string): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(rollModeKey(worldId, userId));
  } catch {
    /* ignore */
  }
}
