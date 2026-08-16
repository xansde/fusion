/**
 * preferences.ts — local persistence of the drawer's `open` / `activeTab`.
 *
 * Spec 36 (`specs/36-gaveta-lateral.md`), DEC-GAV-02 and REQ-GAV-014..016: the drawer's
 * layout state is a `ClientUIPreferences` value (DEC-UIF-10 of spec 11) — it belongs to
 * one user on one device, is kept in `localStorage`, and is NEVER sent to the server.
 *
 * Three rules live here, and nothing else:
 *  - persistence per world + user (REQ-GAV-014), so a shared browser does not hand one
 *    user's drawer to the next one;
 *  - first access without a saved preference: privileged role opens on Scenes
 *    (REQ-GAV-015, REQ-CEN-002), everyone else on Chat;
 *  - a saved `activeTab` the user can no longer see — an unregistered id, or a "gm" tab
 *    read by a player — falls back to Chat, silently (REQ-GAV-016).
 *
 * `resolveInitialTab` is pure on purpose: it takes the visible tab ids as data instead of
 * asking the registry, so the drawer (G012) owns the wiring and this rule stays testable
 * without a registry, a socket or a DOM.
 */

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/** The drawer's local layout state (DEC-UIF-10, `ClientUIPreferences`). */
export interface SidebarPreferences {
  /** Whether the drawer is expanded. */
  readonly open: boolean;
  /** Id of the tab the drawer is showing. */
  readonly activeTab: string;
}

/** What was actually found in storage — either half may be missing or corrupt. */
export interface StoredSidebarPreferences {
  readonly open?: boolean;
  readonly activeTab?: string;
}

/** Fallback tab for every ambiguous case (REQ-GAV-015, REQ-GAV-016). */
export const CHAT_TAB_ID = "chat";

/** First-access tab of a privileged role (REQ-GAV-015, REQ-CEN-002). */
export const SCENES_TAB_ID = "scenes";

/** The drawer starts expanded on first access (REQ-GAV-015). */
export const DEFAULT_SIDEBAR_OPEN = true;

/** Key prefix, following the `fusion:<thing>` convention used across the client. */
export const SIDEBAR_PREFERENCES_KEY_PREFIX = "fusion:sidebar";

/**
 * Storage key of one user's drawer preferences in one world (REQ-GAV-014).
 *
 * Both ids are part of the key — a device shared by the GM and a player keeps two
 * independent entries, and moving to another world does not carry the tab over.
 */
export function sidebarPreferencesKey(worldId: string, userId: string): string {
  return `${SIDEBAR_PREFERENCES_KEY_PREFIX}:${worldId}:${userId}`;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function hasIdentity(worldId: string, userId: string): boolean {
  return worldId.length > 0 && userId.length > 0;
}

/**
 * Read the saved preferences of this user in this world, or `null` when there is
 * nothing usable (never saved, storage unavailable, corrupt JSON).
 *
 * Without a world and a user there is no owner for the value, so nothing is read —
 * an anonymous key would leak one user's drawer into the next session.
 */
export function loadSidebarPreferences(
  worldId: string,
  userId: string,
): StoredSidebarPreferences | null {
  if (!hasIdentity(worldId, userId)) return null;
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(sidebarPreferencesKey(worldId, userId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const result: { open?: boolean; activeTab?: string } = {};
    if (typeof record["open"] === "boolean") result.open = record["open"];
    if (typeof record["activeTab"] === "string" && record["activeTab"].length > 0) {
      result.activeTab = record["activeTab"];
    }
    return result;
  } catch {
    /* localStorage unavailable or unparseable — treat as "no preference". */
    return null;
  }
}

/**
 * Persist the drawer state of this user in this world (REQ-GAV-014).
 *
 * Client-only: this value never travels to the server, and no other user's entry is
 * touched. Failures are swallowed (private mode, quota, storage disabled).
 */
export function saveSidebarPreferences(
  worldId: string,
  userId: string,
  preferences: SidebarPreferences,
): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      sidebarPreferencesKey(worldId, userId),
      JSON.stringify({ open: preferences.open, activeTab: preferences.activeTab }),
    );
  } catch {
    /* ignore */
  }
}

/** Drop this user's saved drawer state in this world. */
export function clearSidebarPreferences(worldId: string, userId: string): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(sidebarPreferencesKey(worldId, userId));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Input of `resolveInitialTab` — plain data, no registry and no storage. */
export interface ResolveInitialTabInput {
  /** The `activeTab` read from storage, if any. */
  readonly saved?: string | undefined;
  /** Whether the local user's role is privileged (mirrors `isRolePrivileged`). */
  readonly isGm: boolean;
  /** Ids the rail is drawing for this user, in rail order (registry, G010). */
  readonly visibleTabIds: readonly string[];
}

function firstAvailable(visibleTabIds: readonly string[], preferred: string): string {
  if (visibleTabIds.includes(preferred)) return preferred;
  if (visibleTabIds.includes(CHAT_TAB_ID)) return CHAT_TAB_ID;
  return visibleTabIds[0] ?? CHAT_TAB_ID;
}

/**
 * Which tab the drawer opens on (REQ-GAV-015, REQ-GAV-016, REQ-CEN-002).
 *
 *  - a saved tab the user can still see wins;
 *  - a saved tab the user cannot see (unregistered, or "gm" for a player) falls back
 *    to Chat, with no warning — this is also the shared-device case;
 *  - with nothing saved, a privileged role opens on Scenes and everyone else on Chat.
 *
 * Pure: same input, same answer. The drawer passes the rail's visible ids in.
 */
export function resolveInitialTab(input: ResolveInitialTabInput): string {
  const { saved, isGm, visibleTabIds } = input;

  if (saved !== undefined && saved.length > 0 && visibleTabIds.includes(saved)) {
    return saved;
  }

  if (saved === undefined || saved.length === 0) {
    return firstAvailable(visibleTabIds, isGm ? SCENES_TAB_ID : CHAT_TAB_ID);
  }

  // Saved, but not visible any more (REQ-GAV-016).
  return firstAvailable(visibleTabIds, CHAT_TAB_ID);
}

/** Input of `resolveInitialSidebarState`. */
export interface ResolveInitialSidebarStateInput {
  readonly worldId: string;
  readonly userId: string;
  readonly isGm: boolean;
  readonly visibleTabIds: readonly string[];
}

/**
 * The drawer's whole starting state: read what this user left on this device and apply
 * the first-access and fallback rules (REQ-GAV-014, REQ-GAV-015, REQ-GAV-016).
 *
 * Single entry point for the drawer (G012), so the reload path and the first-access
 * path are the same code.
 */
export function resolveInitialSidebarState(
  input: ResolveInitialSidebarStateInput,
): SidebarPreferences {
  const stored = loadSidebarPreferences(input.worldId, input.userId);
  return {
    open: stored?.open ?? DEFAULT_SIDEBAR_OPEN,
    activeTab: resolveInitialTab({
      saved: stored?.activeTab,
      isGm: input.isGm,
      visibleTabIds: input.visibleTabIds,
    }),
  };
}
