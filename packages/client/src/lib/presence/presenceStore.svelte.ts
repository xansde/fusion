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

import type { RemoteCursor, MapPing, RulerState, OnlineUser } from "./types.js";
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

// ---------------------------------------------------------------------------
// State (Svelte 5 runes)
// ---------------------------------------------------------------------------

export const presenceState: {
  remoteCursors: Map<string, RemoteCursor>;
  pings: MapPing[];
  remoteRulers: Map<string, RulerState>;
  onlineUsers: OnlineUser[];
} = $state({
  remoteCursors: new Map<string, RemoteCursor>(),
  pings: [] as MapPing[],
  remoteRulers: new Map<string, RulerState>(),
  onlineUsers: [] as OnlineUser[],
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
export { CURSOR_STALE_MS, PING_DURATION_MS };
