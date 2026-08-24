/**
 * Ephemeral event handlers — presence and canvas interactions.
 *
 * These handlers deal with the 'ephemeral' socket.io event channel.
 * Key properties (REQ-NET-040..044, D7):
 *   - NOT persisted to the database
 *   - NOT added to the OpBuffer
 *   - NOT assigned a seq number
 *   - Rebroadcast directly to room sockets
 *   - Rate limited per socket (drops silently on excess)
 *
 * Supported event types:
 *   presence:cursor  — cursor position; rebroadcast to room EXCEPT sender (~20/s server limit)
 *   presence:ping    — map ping; rebroadcast to room INCLUDING sender; rate-limited
 *   presence:ruler   — ruler:update / ruler:clear; rebroadcast to room INCLUDING sender
 *   token:preview    — token drag target position; rebroadcast to room EXCEPT sender
 *                       (same shape as presence:cursor — the dragger already renders its
 *                       own optimistic ghost locally); rate-limited (REQ-NET-044)
 *   presence:online  — connected-user roster; server-initiated (connect/disconnect), not
 *                       client-triggered, so it is built by `buildPresenceOnlineBroadcast`
 *                       below and emitted directly by socket-manager.ts rather than routed
 *                       through `handleEphemeralEnvelope`
 *
 * REQ-NET-040: cursors throttled ≤ 30 msg/s per user (server enforces ~20/s = 50 ms min gap)
 * REQ-NET-041: ping to room with rate limit
 * REQ-NET-043: presence:online roster (active/color) updated on connect/disconnect
 * REQ-NET-044: token:preview — throttled, ephemeral, scene-room-scoped drag preview
 * REQ-NET-071: ephemeral rate limiting, silent drop
 */

import type { Namespace, Socket } from "socket.io";
import type { Logger } from "pino";
import type { Envelope } from "@fusion/shared";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

export const CursorMovePayloadSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  sceneId: z.string().optional(),
});
export type CursorMovePayload = z.infer<typeof CursorMovePayloadSchema>;

export const MapPingPayloadSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  /** User color in CSS hex format (e.g. "#ff4444"). */
  color: z.string().optional(),
});
export type MapPingPayload = z.infer<typeof MapPingPayloadSchema>;

export const RulerUpdatePayloadSchema = z.object({
  /** Ordered waypoints in scene coordinates. */
  waypoints: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })),
});
export type RulerUpdatePayload = z.infer<typeof RulerUpdatePayloadSchema>;

export const RulerClearPayloadSchema = z.object({}).optional();
export type RulerClearPayload = z.infer<typeof RulerClearPayloadSchema>;

/**
 * token:preview payload — REQ-NET-044. Declared here, not in
 * `@fusion/shared`'s `protocol.ts`, matching this module's existing pattern:
 * every other ephemeral payload schema is local to this file too
 * (`CursorMovePayloadSchema`, `MapPingPayloadSchema`, ...) — `@fusion/shared`
 * only needs the `token:preview` string in `EnvelopeTypeSchema`'s literal
 * union, not this validation.
 */
export const TokenPreviewPayloadSchema = z.object({
  sceneId: z.string(),
  tokenId: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
});
export type TokenPreviewPayload = z.infer<typeof TokenPreviewPayloadSchema>;

// ---------------------------------------------------------------------------
// Rate limiter (token bucket per socket per event type)
// ---------------------------------------------------------------------------

interface BucketState {
  lastAllowedMs: number;
}

/**
 * Per-socket per-type rate limiter.
 * Returns true if the message is allowed, false if it should be dropped.
 *
 * Implementation: minimum interval between allowed messages (simple leaky bucket).
 */
export class EphemeralRateLimiter {
  /** socketId → eventType → last-allowed timestamp */
  private readonly buckets = new Map<string, Map<string, BucketState>>();

  constructor(
    /** Minimum milliseconds between allowed messages per socket per event type. */
    private readonly minIntervalMs: number,
  ) {}

  /**
   * Check if the event from the given socket is within rate limits.
   * Returns true if allowed; false if rate-limited (caller drops silently).
   */
  allow(socketId: string, eventType: string, nowMs: number = Date.now()): boolean {
    let perSocket = this.buckets.get(socketId);
    if (!perSocket) {
      perSocket = new Map<string, BucketState>();
      this.buckets.set(socketId, perSocket);
    }

    const existing = perSocket.get(eventType);
    if (!existing) {
      perSocket.set(eventType, { lastAllowedMs: nowMs });
      return true;
    }

    if (nowMs - existing.lastAllowedMs >= this.minIntervalMs) {
      existing.lastAllowedMs = nowMs;
      return true;
    }

    return false;
  }

  /** Remove all state for a disconnected socket (call on socket disconnect). */
  evict(socketId: string): void {
    this.buckets.delete(socketId);
  }
}

// ---------------------------------------------------------------------------
// EphemeralHandler — processes one 'ephemeral' socket event
// ---------------------------------------------------------------------------

export interface EphemeralContext {
  userId: string;
  role: number;
  worldId: string;
  /** User's display color (from user record). */
  userColor?: string;
  /** User's display name. */
  userName?: string;
}

export interface EphemeralHandlerOptions {
  ns: Namespace;
  logger: Logger;
  /** Cursor rate limiter (shared across all sockets in the namespace). */
  cursorRateLimiter: EphemeralRateLimiter;
  /** Ping rate limiter. */
  pingRateLimiter: EphemeralRateLimiter;
  /** token:preview rate limiter (REQ-NET-044). */
  previewRateLimiter: EphemeralRateLimiter;
  /**
   * Mutable record tracking the current scene room for each socket.
   * Maps socketId → current sceneId (or undefined if not in a scene).
   * Owned by the namespace handler; ephemeral handlers update it on cursor events
   * so the socket is joined to the correct `scene:<sceneId>` room (REQ-NET-005).
   */
  sceneRooms: Map<string, string>;
}

/**
 * Handle one ephemeral envelope for a given socket.
 *
 * Called from the socket 'ephemeral' event handler after envelope validation
 * and size check have already passed in SocketManager.
 *
 * Returns false if the event was rate-limited or unrecognized (caller can log).
 */
export function handleEphemeralEnvelope(
  socket: Socket,
  envelope: Envelope,
  ctx: EphemeralContext,
  opts: EphemeralHandlerOptions,
): boolean {
  const { ns, logger, cursorRateLimiter, pingRateLimiter, previewRateLimiter, sceneRooms } = opts;
  const now = Date.now();

  /**
   * Determine the scene room the socket is currently in (if any).
   * Used to scope ephemeral broadcasts to the right scene (REQ-NET-005/040/041).
   */
  const currentSceneId = sceneRooms.get(socket.id);
  const sceneRoom = currentSceneId !== undefined ? `scene:${currentSceneId}` : undefined;

  switch (envelope.type) {
    case "presence:cursor": {
      // REQ-NET-040: rate limit ~20/s per socket (50 ms min interval)
      if (!cursorRateLimiter.allow(socket.id, "presence:cursor", now)) {
        // Silently drop — REQ-NET-071
        return false;
      }

      const parsed = CursorMovePayloadSchema.safeParse(envelope.payload);
      if (!parsed.success) {
        logger.debug({ userId: ctx.userId, type: "presence:cursor" }, "Invalid cursor payload");
        return false;
      }

      // REQ-NET-005: auto-join / auto-leave scene rooms based on sceneId in cursor.
      // This is the canonical way clients signal which scene they are viewing.
      const newSceneId = parsed.data.sceneId;
      if (newSceneId !== undefined && newSceneId !== currentSceneId) {
        // Leave old scene room (if any)
        if (currentSceneId !== undefined) {
          void socket.leave(`scene:${currentSceneId}`);
        }
        // Join new scene room
        void socket.join(`scene:${newSceneId}`);
        sceneRooms.set(socket.id, newSceneId);
      }

      // Rebroadcast to scene room EXCEPT the sender (REQ-NET-040)
      const cursorPayload: CursorMovePayload & { userId: string; userName?: string } = {
        ...parsed.data,
        userId: ctx.userId,
        ...(ctx.userName !== undefined ? { userName: ctx.userName } : {}),
      };
      const broadcast: Envelope<CursorMovePayload & { userId: string; userName?: string }> = {
        type: "presence:cursor",
        ts: now,
        payload: cursorPayload,
      };

      // Scope to scene room when available; fall back to full namespace broadcast
      // (covers sockets that have not yet joined a scene, e.g. in tests or lobby).
      const targetSceneId = newSceneId ?? currentSceneId;
      if (targetSceneId !== undefined) {
        socket.broadcast.to(`scene:${targetSceneId}`).emit("ephemeral", broadcast);
      } else {
        socket.broadcast.emit("ephemeral", broadcast);
      }
      return true;
    }

    case "token:preview": {
      // REQ-NET-044: rate-limited drag-preview broadcast, scene-room-scoped,
      // EXCLUDING the sender — the dragging client already renders its own
      // optimistic ghost locally (TokenInteractionManager.applyLocalMove),
      // the same reasoning presence:cursor uses for its own sender exclusion.
      if (!previewRateLimiter.allow(socket.id, "token:preview", now)) {
        return false;
      }

      const parsed = TokenPreviewPayloadSchema.safeParse(envelope.payload);
      if (!parsed.success) {
        logger.debug({ userId: ctx.userId, type: "token:preview" }, "Invalid preview payload");
        return false;
      }

      const previewPayload: TokenPreviewPayload & { userId: string } = {
        ...parsed.data,
        userId: ctx.userId,
      };
      const broadcast: Envelope<TokenPreviewPayload & { userId: string }> = {
        type: "token:preview",
        ts: now,
        payload: previewPayload,
      };

      // Scoped to the DRAGGED TOKEN's scene (parsed.data.sceneId), not the
      // sender's tracked room — a preview always names the scene it belongs
      // to explicitly (unlike presence:cursor, which infers/updates
      // `sceneRooms` from its own payload).
      socket.broadcast.to(`scene:${parsed.data.sceneId}`).emit("ephemeral", broadcast);
      return true;
    }

    case "presence:ping": {
      // REQ-NET-041: rate-limited ping broadcast INCLUDING sender
      if (!pingRateLimiter.allow(socket.id, "presence:ping", now)) {
        return false;
      }

      const parsed = MapPingPayloadSchema.safeParse(envelope.payload);
      if (!parsed.success) {
        logger.debug({ userId: ctx.userId, type: "presence:ping" }, "Invalid ping payload");
        return false;
      }

      const pingPayload: MapPingPayload & { userId: string; userName?: string } = {
        x: parsed.data.x,
        y: parsed.data.y,
        ...(parsed.data.color !== undefined || ctx.userColor !== undefined
          ? { color: parsed.data.color ?? ctx.userColor }
          : {}),
        userId: ctx.userId,
        ...(ctx.userName !== undefined ? { userName: ctx.userName } : {}),
      };
      const broadcast: Envelope<MapPingPayload & { userId: string; userName?: string }> = {
        type: "presence:ping",
        ts: now,
        payload: pingPayload,
      };

      // Broadcast to ALL sockets in scene room (including sender) — REQ-NET-041.
      // Fall back to full namespace when no scene is active.
      if (sceneRoom !== undefined) {
        ns.to(sceneRoom).emit("ephemeral", broadcast);
      } else {
        ns.emit("ephemeral", broadcast);
      }
      return true;
    }

    case "presence:ruler": {
      // ruler:update — broadcast ruler waypoints to scene (including sender for latency feedback)
      const parsed = RulerUpdatePayloadSchema.safeParse(envelope.payload);
      if (!parsed.success) {
        logger.debug({ userId: ctx.userId, type: "presence:ruler" }, "Invalid ruler payload");
        return false;
      }

      const rulerPayload: RulerUpdatePayload & { userId: string; userName?: string } = {
        waypoints: parsed.data.waypoints,
        userId: ctx.userId,
        ...(ctx.userName !== undefined ? { userName: ctx.userName } : {}),
      };
      const broadcast: Envelope<RulerUpdatePayload & { userId: string; userName?: string }> = {
        type: "presence:ruler",
        ts: now,
        payload: rulerPayload,
      };

      if (sceneRoom !== undefined) {
        ns.to(sceneRoom).emit("ephemeral", broadcast);
      } else {
        ns.emit("ephemeral", broadcast);
      }
      return true;
    }

    case "presence:ruler:clear": {
      // ruler:clear — clear this user's ruler for all clients in the scene
      const broadcast: Envelope<{ userId: string }> = {
        type: "presence:ruler:clear",
        ts: now,
        payload: { userId: ctx.userId },
      };

      if (sceneRoom !== undefined) {
        ns.to(sceneRoom).emit("ephemeral", broadcast);
      } else {
        ns.emit("ephemeral", broadcast);
      }
      return true;
    }

    default:
      // Unknown ephemeral type — silently ignore (new types may arrive from newer clients)
      logger.debug({ type: envelope.type, userId: ctx.userId }, "Unknown ephemeral type");
      return false;
  }
}

// ---------------------------------------------------------------------------
// presence:online — connected-user roster (REQ-NET-043)
// ---------------------------------------------------------------------------

/** One row of the presence:online roster sent to every client. */
export interface PresenceOnlineUser {
  userId: string;
  userName: string;
  color: string;
  online: boolean;
}

export interface PresenceOnlinePayload {
  users: PresenceOnlineUser[];
}

/**
 * Build the presence:online envelope broadcast to the whole world namespace
 * on every connect/disconnect (REQ-NET-043): the full roster of active
 * accounts, each flagged `online` by whether it currently owns at least one
 * live socket. Unlike the other ephemeral types above, this one is not a
 * reaction to a client-sent envelope — socket-manager.ts calls this directly
 * from its connection/disconnect handlers — so it is kept as a pure function
 * here (DB read + `ns.emit` stay in the caller) rather than routed through
 * `handleEphemeralEnvelope`.
 *
 * `accounts` is every active `User` row (color, name — REQ-USR-002); this
 * function itself never touches the database, so it is testable without a
 * socket or a DB fixture.
 */
export function buildPresenceOnlineBroadcast(
  accounts: ReadonlyArray<{ id: string; name: string; color: string }>,
  connectedUserIds: ReadonlySet<string>,
  now: number = Date.now(),
): Envelope<PresenceOnlinePayload> {
  return {
    type: "presence:online",
    ts: now,
    payload: {
      users: accounts.map((account) => ({
        userId: account.id,
        userName: account.name,
        color: account.color,
        online: connectedUserIds.has(account.id),
      })),
    },
  };
}
