/**
 * Session store — Svelte 5 runes.
 *
 * Central reactive state for:
 * - Authentication (user, accessToken in memory)
 * - WebSocket connection state
 * - World info
 *
 * Coordinates fusionApi (HTTP) and SocketManager (WebSocket) into a single
 * coherent lifecycle.
 *
 * Usage:
 *   import { session, sessionActions } from "$lib/session.svelte";
 *   session.screen        // "loading" | "join" | "table" | "management"
 *   session.user          // UserPublic | null
 *   session.worldInfo     // WorldInfo | null
 *   session.connection    // ConnectionState
 *   session.rttMs         // number | null
 *   sessionActions.load() // call once on app mount
 *   sessionActions.login(userId, password?)
 *   sessionActions.logout()
 */

import { fusionApi, type UserPublic, type WorldInfo, ApiError } from "./api.js";
import { SocketManager, type ConnectionState } from "./socket.js";
import type { Socket } from "socket.io-client";
import { attachWorldSync } from "./docs/worldSync.js";
import { attachSceneListSync } from "./scenes/scenesState.svelte.js";
import { attachContactsKnowledgeBadge } from "./contacts/knowledgeBadge.js";
import { classifyWorldFetchError } from "./worldFetchErrorClassifier.js";

// ---------------------------------------------------------------------------
// Screen type
// ---------------------------------------------------------------------------

export type Screen = "loading" | "join" | "table" | "management";

// ---------------------------------------------------------------------------
// Reactive state (Svelte 5 runes — $state)
// ---------------------------------------------------------------------------

export const session: {
  screen: Screen;
  user: UserPublic | null;
  worldInfo: WorldInfo | null;
  connection: ConnectionState;
  rttMs: number | null;
  error: string | null;
  lockedOut: boolean;
  retryAfterSecs: number;
} = $state({
  screen: "loading",
  user: null,
  worldInfo: null,
  /** Current WebSocket connection state. */
  connection: "disconnected",
  /** Round-trip time in ms, null if not yet measured. */
  rttMs: null,
  /** Error message to surface in the UI. */
  error: null,
  /** If true the login endpoint returned 429 — show countdown. */
  lockedOut: false,
  /** Seconds until the user can retry after lockout. */
  retryAfterSecs: 0,
});

// ---------------------------------------------------------------------------
// Socket manager singleton
// ---------------------------------------------------------------------------

const socketManager = new SocketManager(() => fusionApi.getToken());

// Subscribe to socket state changes and feed them into reactive state
socketManager.subscribe((state: ConnectionState, rttMs?: number) => {
  session.connection = state;
  session.rttMs = rttMs ?? null;
});

// When the API's auto-refresh fails, redirect to join screen
fusionApi.onSessionExpired(() => {
  session.user = null;
  session.screen = "join";
  session.connection = "disconnected";
  socketManager.disconnect();
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const sessionActions = {
  /**
   * Called once on app mount.
   * Tries to rehydrate the session via the refresh cookie.
   * Then fetches world info regardless (needed for the join screen).
   */
  async load(): Promise<void> {
    session.screen = "loading";
    session.error = null;

    // Attempt silent token refresh (user may have a valid session from a
    // previous page load; the httpOnly cookie carries the refresh token)
    const existingUser = await fusionApi.tryRefresh();

    // Fetch world info — always needed (join screen uses user list)
    let fetchedWorldInfo;
    try {
      fetchedWorldInfo = await fusionApi.fetchWorldInfo();
      session.worldInfo = fetchedWorldInfo;
    } catch (err) {
      session.worldInfo = null;

      // Previously ANY failure here (network error vs. a clean 404 meaning
      // "no world open") showed the same raw "Cannot reach the server"
      // error on the join screen, even when the server was very much up
      // in management mode — manual validation round 2 finding. See
      // classifyWorldFetchError()'s doc comment for the distinction.
      if (classifyWorldFetchError(err) === "management") {
        session.screen = "management";
        return;
      }

      session.screen = "join";
      session.error = "Cannot reach the server. Is it running?";
      return;
    }

    if (existingUser) {
      session.user = existingUser;
      session.screen = "table";
      _connectSocket(fetchedWorldInfo.id);
    } else {
      session.screen = "join";
    }
  },

  /**
   * POST /api/auth/login then connect the WebSocket.
   */
  async login(userId: string, password?: string): Promise<void> {
    session.error = null;
    session.lockedOut = false;

    try {
      const result = await fusionApi.login(userId, password);
      session.user = result.user;

      // Refresh world info to get the latest user list (optional but clean)
      try {
        session.worldInfo = await fusionApi.fetchWorldInfo();
      } catch {
        // Non-fatal — keep old worldInfo
      }

      session.screen = "table";
      _connectSocket(session.worldInfo?.id ?? userId);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.httpStatus === 429) {
          session.lockedOut = true;
          session.retryAfterSecs = err.retryAfterSecs ?? 900;
          session.error = `Too many failed attempts. Try again in ${String(session.retryAfterSecs)} seconds.`;
        } else if (err.httpStatus === 401) {
          session.error = "Invalid credentials. Please try again.";
        } else if (err.httpStatus === 403) {
          session.error = "This account is inactive.";
        } else {
          session.error = err.message || "Login failed.";
        }
      } else {
        session.error = "An unexpected error occurred.";
      }
    }
  },

  /**
   * POST /api/auth/logout, disconnect socket, return to join screen.
   */
  async logout(): Promise<void> {
    _disconnectSync();
    socketManager.disconnect();
    await fusionApi.logout();
    session.user = null;
    session.screen = "join";
    session.error = null;
    session.lockedOut = false;
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the current socket instance (may be null before connection).
 * Used by UI components (e.g. the drawer's Cenas tab) that need to send ops.
 */
export function getSocket(): Socket | null {
  return socketManager.socket;
}

/** Active world-sync cleanup function, called on disconnect/logout. */
let _detachWorldSync: (() => void) | null = null;
/** Active scene-list sync cleanup, called on disconnect/logout. */
let _detachSceneSync: (() => void) | null = null;
/** Active Contatos state-dot tracking cleanup (REQ-CTT-003). */
let _detachContactsBadge: (() => void) | null = null;

/**
 * Lowest role the server treats as privileged (`isRolePrivileged`, spec 05). Mirrored
 * here only to decide ergonomics — who gets the Contatos dot (REQ-CTT-004) — never
 * to decide access: what a seat may see is redacted server-side (REQ-CTT-080).
 */
const PRIVILEGED_ROLE = 3;

function _connectSocket(worldId: string): void {
  // The socket namespace is /world/<worldSlug> — use worldId as slug
  socketManager.connect(worldId);

  // Attach world document sync once the socket manager has a socket instance.
  // The socket is created synchronously by connect(), so we can grab it now.
  const socket = socketManager.socket;
  if (socket) {
    _detachWorldSync?.();
    _detachWorldSync = attachWorldSync(socket);
    // Attach scene list mirror subscription
    _detachSceneSync?.();
    _detachSceneSync = attachSceneListSync();
    // The Contatos state dot has to work with the tab CLOSED (REQ-CTT-003), and the
    // drawer mounts a panel only while its tab is open (REQ-GAV-017) — so the badge
    // follows the mirror from here, beside the other world-level subscriptions.
    _detachContactsBadge?.();
    _detachContactsBadge = attachContactsKnowledgeBadge({
      worldId,
      userId: session.user?.id ?? "",
      isPrivileged: (session.user?.role ?? 0) >= PRIVILEGED_ROLE,
    });
  }
}

function _disconnectSync(): void {
  _detachWorldSync?.();
  _detachWorldSync = null;
  _detachSceneSync?.();
  _detachSceneSync = null;
  _detachContactsBadge?.();
  _detachContactsBadge = null;
}
