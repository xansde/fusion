import { shownFromPayload } from "./showPlayers.js";
import type { AreaTemplate } from "@fusion/shared";
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
import type { OnlineUser } from "./types.js";
import {
  applyRemoteCursor,
  addPing,
  applyRemoteRuler,
  clearRemoteRuler,
  applyRemoteTemplate,
  clearRemoteTemplate,
  applyPinnedTemplate,
  removePinnedTemplate,
  replacePinnedTemplates,
  applyRemoteTokenPreview,
  updateOnlineUsers,
  presenceState,
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
        const pingFull = { ...pingUpdate, ...(payload["pull"] === true ? { pull: true } : {}) };
        addPing(pingFull);
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

      case "presence:show": {
        const item = shownFromPayload(payload);
        if (item) presenceState.shown = item;
        break;
      }

      case "presence:template": {
        const tu: { userId: string; userName?: string; template: unknown } = {
          userId: asStr(payload["userId"]),
          template: payload["template"],
        };
        const tn = asOptStr(payload["userName"]);
        if (tn !== undefined) tu.userName = tn;
        applyRemoteTemplate(tu);
        break;
      }

      case "presence:template:clear": {
        clearRemoteTemplate(asStr(payload["userId"]));
        break;
      }

      case "presence:template:pin": {
        const pin: {
          id: string;
          sceneId: string;
          userId: string;
          userName?: string;
          template: unknown;
        } = {
          id: asStr(payload["id"]),
          sceneId: asStr(payload["sceneId"]),
          userId: asStr(payload["userId"]),
          template: payload["template"],
        };
        const pn = asOptStr(payload["userName"]);
        if (pn !== undefined) pin.userName = pn;
        applyPinnedTemplate(pin);
        break;
      }

      case "presence:template:unpin": {
        removePinnedTemplate(asStr(payload["id"]));
        break;
      }

      case "presence:template:pinned": {
        const list = Array.isArray(payload["templates"]) ? payload["templates"] : [];
        replacePinnedTemplates(
          asStr(payload["sceneId"]),
          (list as Array<Record<string, unknown>>).map((t) => {
            const item: { id: string; userId: string; userName?: string; template: unknown } = {
              id: asStr(t["id"]),
              userId: asStr(t["userId"]),
              template: t["template"],
            };
            const un = asOptStr(t["userName"]);
            if (un !== undefined) item.userName = un;
            return item;
          }),
        );
        break;
      }

      case "token:preview": {
        // REQ-NET-044: another user's token drag, in progress.
        const tokenId = asStr(payload["tokenId"]);
        const sceneId = asStr(payload["sceneId"]);
        if (tokenId === "" || sceneId === "") break;
        applyRemoteTokenPreview({
          tokenId,
          sceneId,
          userId: asStr(payload["userId"]),
          x: typeof payload["x"] === "number" ? payload["x"] : 0,
          y: typeof payload["y"] === "number" ? payload["y"] : 0,
        });
        break;
      }

      case "presence:online": {
        // REQ-NET-043: server-pushed roster (id/name/color/online) on every
        // connect/disconnect — feeds resolveSpeakerColor (A022) and
        // resolveInvalidatorLabel (A024) via presenceState.onlineUsers.
        const rawUsers = Array.isArray(payload["users"]) ? payload["users"] : [];
        const users: OnlineUser[] = [];
        for (const raw of rawUsers as unknown[]) {
          if (typeof raw !== "object" || raw === null) continue;
          const row = raw as Record<string, unknown>;
          const userId = asStr(row["userId"]);
          if (userId === "") continue;
          users.push({
            userId,
            userName: asStr(row["userName"]),
            color: asStr(row["color"]),
            online: row["online"] === true,
          });
        }
        updateOnlineUsers(users);
        break;
      }

      default:
        // Other ephemeral types (e.g. presence:pan) handled elsewhere
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
export function emitPing(
  socket: Socket | null,
  x: number,
  y: number,
  color?: string,
  pull?: boolean,
): void {
  if (!socket?.connected) return;

  socket.emit("ephemeral", {
    type: "presence:ping",
    ts: Date.now(),
    payload: { x, y, ...(color != null ? { color } : {}), ...(pull ? { pull: true } : {}) },
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

// ---------------------------------------------------------------------------
// Area template emitters
// ---------------------------------------------------------------------------

/** Broadcast the template being aimed. */
export function emitTemplateUpdate(socket: Socket | null, template: AreaTemplate): void {
  if (!socket?.connected) return;
  socket.emit("ephemeral", { type: "presence:template", ts: Date.now(), payload: { template } });
}

/** Tell the table this user stopped aiming. */
export function emitTemplateClear(socket: Socket | null): void {
  if (!socket?.connected) return;
  socket.emit("ephemeral", { type: "presence:template:clear", ts: Date.now(), payload: {} });
}

/** Pin a template on a scene until someone removes it. */
export function emitTemplatePin(
  socket: Socket | null,
  id: string,
  sceneId: string,
  template: AreaTemplate,
): void {
  if (!socket?.connected) return;
  socket.emit("ephemeral", {
    type: "presence:template:pin",
    ts: Date.now(),
    payload: { id, sceneId, template },
  });
}

export function emitTemplateUnpin(socket: Socket | null, id: string, sceneId: string): void {
  if (!socket?.connected) return;
  socket.emit("ephemeral", {
    type: "presence:template:unpin",
    ts: Date.now(),
    payload: { id, sceneId },
  });
}

/** Ask the server for the templates pinned on a scene (answered with presence:template:pinned). */
export function emitTemplateSync(socket: Socket | null, sceneId: string): void {
  if (!socket?.connected) return;
  socket.emit("ephemeral", {
    type: "presence:template:sync",
    ts: Date.now(),
    payload: { sceneId },
  });
}

// ---------------------------------------------------------------------------
// Token preview emitter — client → server (REQ-NET-044)
// ---------------------------------------------------------------------------

/** Minimum interval between token:preview emissions to the server (ms) — same target rate as cursors. */
const TOKEN_PREVIEW_EMIT_INTERVAL_MS = 50;

const _tokenPreviewThrottleState = createThrottleState();

/**
 * Emit a token drag's target position to the server, subject to throttle
 * (REQ-NET-044). Call this from TokenInteractionManager's pointermove drag
 * handler, alongside the local optimistic ghost move — never as a
 * replacement for it (the dragger's OWN screen never depends on this
 * round-trip).
 *
 * @param socket   Connected socket
 * @param sceneId  Scene the token belongs to
 * @param tokenId  The token being dragged
 * @param x        World X (already grid-snapped by the caller)
 * @param y        World Y (already grid-snapped by the caller)
 * @param nowMs    Current timestamp (injectable for testing)
 */
export function emitTokenPreview(
  socket: Socket | null,
  sceneId: string,
  tokenId: string,
  x: number,
  y: number,
  nowMs: number = Date.now(),
): void {
  if (!socket?.connected) return;
  if (shouldThrottle(_tokenPreviewThrottleState, TOKEN_PREVIEW_EMIT_INTERVAL_MS, nowMs)) return;

  socket.emit("ephemeral", {
    type: "token:preview",
    ts: nowMs,
    payload: { sceneId, tokenId, x, y },
  });
}
