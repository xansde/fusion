/**
 * Presence types — shared between the store and canvas layer.
 *
 * M1-E: REQ-NET-040..044
 */

// ---------------------------------------------------------------------------
// Remote cursor
// ---------------------------------------------------------------------------

export interface RemoteCursor {
  /** User ID of the remote participant. */
  userId: string;
  /** Display name (may be undefined if server didn't include it). */
  userName?: string;
  /** Current interpolated world X position. */
  x: number;
  /** Current interpolated world Y position. */
  y: number;
  /** Target world X (position received from server, interpolation target). */
  targetX: number;
  /** Target world Y. */
  targetY: number;
  /** User display color in CSS hex (e.g. "#ff4444"). */
  color: string;
  /** Timestamp of the last update (performance.now() or Date.now()). */
  lastUpdatedMs: number;
}

// ---------------------------------------------------------------------------
// Map ping
// ---------------------------------------------------------------------------

export interface MapPing {
  id: string;
  userId: string;
  userName?: string;
  x: number;
  y: number;
  color: string;
  /** When the ping was created (Date.now()). */
  startedAtMs: number;
  /** Duration of the ping animation in ms. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Ruler
// ---------------------------------------------------------------------------

export interface RulerState {
  /** User ID whose ruler is shown. */
  userId: string;
  /** User name. */
  userName?: string;
  /** Ordered waypoints in scene coordinates. */
  waypoints: ReadonlyArray<{ x: number; y: number }>;
}

// ---------------------------------------------------------------------------
// Token drag preview (REQ-NET-044)
// ---------------------------------------------------------------------------

/**
 * The most recent `token:preview` broadcast for a token being dragged by
 * ANOTHER user — REQ-NET-044. Keyed by `tokenId` in the store (one preview
 * per token, not per user, since only one user may hold OWNER-gated drag
 * control of a given token at a time — REQ-TOK-032).
 */
export interface RemoteTokenPreview {
  tokenId: string;
  sceneId: string;
  userId: string;
  x: number;
  y: number;
  /** When this preview was received (Date.now()) — used to prune stale ones. */
  receivedAtMs: number;
}

// ---------------------------------------------------------------------------
// Online user
// ---------------------------------------------------------------------------

export interface OnlineUser {
  userId: string;
  userName: string;
  color: string;
  online: boolean;
}
