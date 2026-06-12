/**
 * attachPresenceSync — wires socket.io 'ephemeral' events to the presence store.
 *
 * This module is intentionally thin: it only translates raw socket events
 * into typed calls on the presence store. All state logic lives in
 * presenceStore.svelte.ts.
 *
 * M1-E: REQ-NET-040..044
 */

import type { Socket } from "socket.io-client";
import type { Envelope } from "@fusion/shared";
import {
  applyRemoteCursor,
  addPing,
  applyRemoteRuler,
  clearRemoteRuler,
  startPresenceBackground,
} from "./presenceStore.svelte.js";

// ---------------------------------------------------------------------------
// Cursor emission — throttle state
// ---------------------------------------------------------------------------

import { createThrottleState, shouldThrottle, movedSignificantly } from "./throttle.js";

/** Minimum interval between cursor events sent to the server (ms). */
const CURSOR_EMIT_INTERVAL_MS = 30; // ~33 fps max
const CURSOR_MOVEMENT_THRESHOLD = 2; // px

// ---------------------------------------------------------------------------
// Attach / detach
// ---------------------------------------------------------------------------

/**
 * Attach presence event handlers to the given socket.
 *
 * Returns a cleanup function that removes all listeners.
 * Call the cleanup when the socket disconnects or world changes.
 */
export function attachPresenceSync(socket: Socket): () => void {
  const stopBackground = startPresenceBackground();

  // REQ-NET-040..044: handle ephemeral events
  const onEphemeral = (envelope: Envelope): void => {
    const payload = envelope.payload as Record<string, unknown>;

    // Helpers to safely coerce unknown → string
    const asStr = (v: unknown): string =>
      typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
    const asOptStr = (v: unknown): string | undefined =>
      typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;

    switch (envelope.type) {
      case "presence:cursor": {
        const cursorUpdate: {
          userId: string;
          userName?: string;
          x: number;
          y: number;
          color?: string;
        } = {
          userId: asStr(payload["userId"]),
          x: typeof payload["x"] === "number" ? payload["x"] : 0,
          y: typeof payload["y"] === "number" ? payload["y"] : 0,
        };
        const cn = asOptStr(payload["userName"]);
        if (cn !== undefined) cursorUpdate.userName = cn;
        const cc = asOptStr(payload["color"]);
        if (cc !== undefined) cursorUpdate.color = cc;
        applyRemoteCursor(cursorUpdate);
        break;
      }

      case "presence:ping": {
        const pingUpdate: {
          userId: string;
          userName?: string;
          x: number;
          y: number;
          color?: string;
        } = {
          userId: asStr(payload["userId"]),
          x: typeof payload["x"] === "number" ? payload["x"] : 0,
          y: typeof payload["y"] === "number" ? payload["y"] : 0,
        };
        const pn = asOptStr(payload["userName"]);
        if (pn !== undefined) pingUpdate.userName = pn;
        const pc = asOptStr(payload["color"]);
        if (pc !== undefined) pingUpdate.color = pc;
        addPing(pingUpdate);
        break;
      }

      case "presence:ruler": {
        const waypoints = Array.isArray(payload["waypoints"])
          ? (payload["waypoints"] as Array<{ x: number; y: number }>).filter(
              (w) => typeof w.x === "number" && typeof w.y === "number",
            )
          : [];
        const rulerUpdate: {
          userId: string;
          userName?: string;
          waypoints: Array<{ x: number; y: number }>;
        } = {
          userId: asStr(payload["userId"]),
          waypoints,
        };
        const rn = asOptStr(payload["userName"]);
        if (rn !== undefined) rulerUpdate.userName = rn;
        applyRemoteRuler(rulerUpdate);
        break;
      }

      case "presence:ruler:clear": {
        clearRemoteRuler(asStr(payload["userId"]));
        break;
      }

      default:
        // Other ephemeral types (e.g. presence:online, presence:pan) handled elsewhere
        break;
    }
  };

  socket.on("ephemeral", onEphemeral);

  // Return cleanup
  return () => {
    socket.off("ephemeral", onEphemeral);
    stopBackground();
  };
}

// ---------------------------------------------------------------------------
// Cursor emitter — client → server
// ---------------------------------------------------------------------------

const _throttleState = createThrottleState();
let _lastSentX = -Infinity;
let _lastSentY = -Infinity;

/**
 * Emit a cursor position to the server, subject to throttle.
 *
 * Call this from the canvas pointermove handler.
 * This function is idempotent: it only emits if:
 *   1. Enough time has passed (CURSOR_EMIT_INTERVAL_MS)
 *   2. The position has changed by more than CURSOR_MOVEMENT_THRESHOLD px
 *
 * @param socket     Connected socket
 * @param x          World X coordinate
 * @param y          World Y coordinate
 * @param nowMs      Current timestamp (injectable for testing)
 */
export function emitCursor(
  socket: Socket | null,
  x: number,
  y: number,
  nowMs: number = Date.now(),
): void {
  if (!socket?.connected) return;

  // Throttle check
  if (shouldThrottle(_throttleState, CURSOR_EMIT_INTERVAL_MS, nowMs)) return;

  // Distance check (suppress micro-jitter)
  if (!movedSignificantly(_lastSentX, _lastSentY, x, y, CURSOR_MOVEMENT_THRESHOLD)) return;

  _lastSentX = x;
  _lastSentY = y;

  socket.emit("ephemeral", {
    type: "presence:cursor",
    ts: nowMs,
    payload: { x, y },
  });
}

// ---------------------------------------------------------------------------
// Ping emitter
// ---------------------------------------------------------------------------

/**
 * Emit a map ping to the server.
 *
 * @param socket  Connected socket
 * @param x       World X coordinate
 * @param y       World Y coordinate
 * @param color   User color (optional — server will attach user color if omitted)
 */
export function emitPing(socket: Socket | null, x: number, y: number, color?: string): void {
  if (!socket?.connected) return;

  socket.emit("ephemeral", {
    type: "presence:ping",
    ts: Date.now(),
    payload: { x, y, ...(color != null ? { color } : {}) },
  });
}

// ---------------------------------------------------------------------------
// Ruler emitters
// ---------------------------------------------------------------------------

/**
 * Broadcast ruler waypoints to all clients.
 */
export function emitRulerUpdate(
  socket: Socket | null,
  waypoints: ReadonlyArray<{ x: number; y: number }>,
): void {
  if (!socket?.connected) return;

  socket.emit("ephemeral", {
    type: "presence:ruler",
    ts: Date.now(),
    payload: { waypoints },
  });
}

/**
 * Broadcast ruler clear (user finished measuring).
 */
export function emitRulerClear(socket: Socket | null): void {
  if (!socket?.connected) return;

  socket.emit("ephemeral", {
    type: "presence:ruler:clear",
    ts: Date.now(),
    payload: {},
  });
}
