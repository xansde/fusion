/**
 * Presence store — Svelte 5 runes.
 *
 * Manages:
 *   - Remote cursors (interpolated, pruned after CURSOR_STALE_MS)
 *   - Map pings (ephemeral, auto-removed after durationMs)
 *   - Remote rulers (one per remote user)
 *   - Online user list
 *
 * M1-E: REQ-NET-040..044
 */

import type { RemoteCursor, MapPing, RulerState, OnlineUser, RemoteTokenPreview } from "./types.js";
import {
  applyCursorUpdate,
  pruneStale,
  interpolateCursor,
  CURSOR_STALE_MS,
} from "./cursorInterpolation.js";

// ---------------------------------------------------------------------------
// Map ping duration
// ---------------------------------------------------------------------------

const PING_DURATION_MS = 2000;
const CURSOR_PRUNE_INTERVAL_MS = 1000;

/**
 * A token:preview is considered stale (dragger went silent — connection
 * drop, or the drop's doc:update simply superseded it) after this many ms
 * with no fresh preview. Generous relative to the ~50ms emit throttle: this
 * only needs to catch "dragger disappeared", not measure normal jitter.
 */
const TOKEN_PREVIEW_STALE_MS = 3000;

// ---------------------------------------------------------------------------
// State (Svelte 5 runes)
// ---------------------------------------------------------------------------

export const presenceState: {
  remoteCursors: Map<string, RemoteCursor>;
  pings: MapPing[];
  remoteRulers: Map<string, RulerState>;
  onlineUsers: OnlineUser[];
  /** REQ-NET-044: token:preview broadcasts from OTHER users, keyed by tokenId. */
  remoteTokenPreviews: Map<string, RemoteTokenPreview>;
} = $state({
  remoteCursors: new Map<string, RemoteCursor>(),
  pings: [] as MapPing[],
  remoteRulers: new Map<string, RulerState>(),
  onlineUsers: [] as OnlineUser[],
  remoteTokenPreviews: new Map<string, RemoteTokenPreview>(),
});

// ---------------------------------------------------------------------------
// Cursor updates
// ---------------------------------------------------------------------------

/**
 * Apply a received cursor update from another user.
 * This is called from the socket 'ephemeral' handler.
 */
export function applyRemoteCursor(update: {
  userId: string;
  userName?: string;
  x: number;
  y: number;
  color?: string;
}): void {
  const existing = presenceState.remoteCursors.get(update.userId);
  const nowMs = Date.now();
  const updated = applyCursorUpdate(existing, update, nowMs);
  presenceState.remoteCursors.set(update.userId, updated);
}

/**
 * Advance all cursor interpolations by `deltaMs`.
 * Called from the PIXI ticker.
 */
export function tickCursors(deltaMs: number): void {
  for (const [userId, cursor] of presenceState.remoteCursors) {
    presenceState.remoteCursors.set(userId, interpolateCursor(cursor, deltaMs));
  }
}

/**
 * Remove cursors that have not been updated within CURSOR_STALE_MS.
 * Called periodically (e.g. every second) from a setInterval.
 */
export function pruneStaleCursors(): void {
  presenceState.remoteCursors = pruneStale(presenceState.remoteCursors, Date.now());
}

/**
 * Remove a specific user's cursor (e.g. when they disconnect).
 */
export function removeCursor(userId: string): void {
  presenceState.remoteCursors.delete(userId);
}

// ---------------------------------------------------------------------------
// Map pings
// ---------------------------------------------------------------------------

let _pingCounter = 0;

/**
 * Add a map ping. The ping auto-removes itself after PING_DURATION_MS.
 */
export function addPing(data: {
  userId: string;
  userName?: string;
  x: number;
  y: number;
  color?: string;
}): void {
  const id = `ping-${String(++_pingCounter)}-${String(Date.now())}`;
  const ping: MapPing = {
    id,
    userId: data.userId,
    x: data.x,
    y: data.y,
    color: data.color ?? "#ffaa00",
    startedAtMs: Date.now(),
    durationMs: PING_DURATION_MS,
  };
  if (data.userName !== undefined) ping.userName = data.userName;

  presenceState.pings = [...presenceState.pings, ping];

  // Auto-remove after animation duration
  setTimeout(() => {
    presenceState.pings = presenceState.pings.filter((p) => p.id !== id);
  }, PING_DURATION_MS + 100);
}

// ---------------------------------------------------------------------------
// Remote rulers
// ---------------------------------------------------------------------------

/**
 * Apply a remote ruler update (presence:ruler event).
 */
export function applyRemoteRuler(data: {
  userId: string;
  userName?: string;
  waypoints: Array<{ x: number; y: number }>;
}): void {
  const rulerEntry: RulerState = {
    userId: data.userId,
    waypoints: data.waypoints,
  };
  if (data.userName !== undefined) rulerEntry.userName = data.userName;
  presenceState.remoteRulers.set(data.userId, rulerEntry);
}

/**
 * Remove a remote ruler (presence:ruler:clear event).
 */
export function clearRemoteRuler(userId: string): void {
  presenceState.remoteRulers.delete(userId);
}

// ---------------------------------------------------------------------------
// Token drag preview (REQ-NET-044)
// ---------------------------------------------------------------------------

/**
 * Apply a received token:preview from another user (REQ-NET-044).
 * Called from the socket 'ephemeral' handler.
 */
export function applyRemoteTokenPreview(update: {
  tokenId: string;
  sceneId: string;
  userId: string;
  x: number;
  y: number;
}): void {
  presenceState.remoteTokenPreviews.set(update.tokenId, {
    ...update,
    receivedAtMs: Date.now(),
  });
}

/** Remove a specific token's preview (e.g. once its authoritative move lands). */
export function clearRemoteTokenPreview(tokenId: string): void {
  presenceState.remoteTokenPreviews.delete(tokenId);
}

/**
 * Remove token previews that have not been refreshed within
 * TOKEN_PREVIEW_STALE_MS — mirrors pruneStaleCursors, called from the same
 * background interval.
 */
export function pruneStaleTokenPreviews(): void {
  const now = Date.now();
  for (const [tokenId, preview] of presenceState.remoteTokenPreviews) {
    if (now - preview.receivedAtMs > TOKEN_PREVIEW_STALE_MS) {
      presenceState.remoteTokenPreviews.delete(tokenId);
    }
  }
}

// ---------------------------------------------------------------------------
// Online users
// ---------------------------------------------------------------------------

/**
 * Update the online user list from a presence:online event.
 */
export function updateOnlineUsers(users: OnlineUser[]): void {
  presenceState.onlineUsers = users;
}

/**
 * Mark a user as offline (called on disconnect event).
 */
export function markUserOffline(userId: string): void {
  presenceState.onlineUsers = presenceState.onlineUsers.map((u) =>
    u.userId === userId ? { ...u, online: false } : u,
  );
  // Remove their cursor and ruler
  removeCursor(userId);
  clearRemoteRuler(userId);
  // Remove any token preview they were mid-drag on (REQ-NET-044) — a
  // disconnected user's ghost should not linger on other clients' screens.
  for (const [tokenId, preview] of presenceState.remoteTokenPreviews) {
    if (preview.userId === userId) presenceState.remoteTokenPreviews.delete(tokenId);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle — start/stop background prune
// ---------------------------------------------------------------------------

let _pruneInterval: ReturnType<typeof setInterval> | null = null;

export function startPresenceBackground(): () => void {
  if (_pruneInterval !== null)
    return () => {
      stopPresenceBackground();
    };

  _pruneInterval = setInterval(() => {
    pruneStaleCursors();
    pruneStaleTokenPreviews();
  }, CURSOR_PRUNE_INTERVAL_MS);

  return stopPresenceBackground;
}

export function stopPresenceBackground(): void {
  if (_pruneInterval !== null) {
    clearInterval(_pruneInterval);
    _pruneInterval = null;
  }
}

// Export for testing
export { CURSOR_STALE_MS, PING_DURATION_MS, TOKEN_PREVIEW_STALE_MS };
