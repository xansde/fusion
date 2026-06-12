/**
 * SocketManager — creates and manages the socket.io Server and per-world namespaces.
 *
 * REQ-NET-001: socket.io v4 on the same HTTP server as Fastify.
 * REQ-NET-002: namespace per world (/world/<worldId>).
 * REQ-NET-003: auth in handshake — AUTH_FAILED on invalid token.
 * REQ-NET-004: socket joined to user:<userId> room; GM/ASSISTANT also joined to gm.
 * REQ-NET-013: low-level events op/query/ephemeral/system.
 * REQ-NET-014: PROTOCOL_MISMATCH on version mismatch.
 * REQ-NET-093: Envelope types from @fusion/shared.
 */

import { Server as SocketIOServer } from "socket.io";
import type { Namespace, Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import type { Logger } from "pino";

import { EnvelopeSchema, PROTOCOL_VERSION, type Envelope } from "@fusion/shared";

import { verifyAccessToken } from "../auth/crypto.js";
import { SeqStore } from "./seq-store.js";
import { OpBuffer } from "./op-buffer.js";
import { HandlerRegistry } from "./handler-registry.js";
import { systemPingHandler, buildWhoAmIHandler } from "./handlers/system.js";
import {
  buildDocCreateHandler,
  buildDocUpdateHandler,
  buildDocDeleteHandler,
} from "./handlers/doc-handlers.js";
import {
  buildWallCreateHandler,
  buildWallUpdateHandler,
  buildWallDeleteHandler,
  buildLightCreateHandler,
  buildLightUpdateHandler,
  buildLightDeleteHandler,
  buildDoorStateHandler,
  buildTokenMoveHandler,
} from "./handlers/vision-handlers.js";
import {
  buildResyncRequestHandler,
  buildActiveSceneHandler,
  sendJoinSnapshot,
} from "./handlers/sync-handlers.js";
import {
  buildChatSendHandler,
  buildChatHistoryHandler,
  getRecentChatForUser,
} from "../chat/index.js";
import { redactAckResultForNonPrivileged } from "./redaction.js";
import { DocumentStore } from "../documents/index.js";
import type { AuthService } from "../auth/service.js";
import type { Database as Db } from "better-sqlite3";

import { isRolePrivileged } from "../documents/ownership.js";
import { EphemeralRateLimiter, handleEphemeralEnvelope } from "./ephemeral-handlers.js";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface WorldNamespaceOptions {
  /** The open world slug (used as namespace id). */
  worldId: string;
  /** Open better-sqlite3 database for the world. */
  db: Db;
  /** HMAC secret for verifying access tokens. */
  secret: Uint8Array;
  /** AuthService used for user lookups (whoami, etc.). */
  authService: AuthService;
  /** Max simultaneous connections (REQ-NET-006). Default: 16. */
  maxConnections?: number;
  /**
   * Op buffer size for resync (REQ-NET-062). Default: 1000.
   * Exposed for test overrides (small values to test buffer overflow).
   */
  opBufferSize?: number;
}

export interface SocketManagerOptions {
  /** Underlying HTTP server (Fastify's server). */
  httpServer: HttpServer;
  /** Pino logger. */
  logger: Logger;
  /** CORS origin (restricts socket.io CORS to the server's own origin). */
  origin: string;
}

// --------------------------------------------------------------------------
// Authenticated socket data
// --------------------------------------------------------------------------

interface SocketData {
  userId: string;
  role: number;
  worldId: string;
}

// --------------------------------------------------------------------------
// SocketManager
// --------------------------------------------------------------------------

export class SocketManager {
  readonly io: SocketIOServer;
  private readonly logger: Logger;
  private readonly namespaces = new Map<string, Namespace>();

  constructor(options: SocketManagerOptions) {
    this.logger = options.logger;

    this.io = new SocketIOServer(options.httpServer, {
      // REQ-NET-001: same HTTP server as Fastify
      path: "/socket.io/",
      // CORS restricted to the server's own origin
      cors: {
        origin: options.origin,
        methods: ["GET", "POST"],
        credentials: true,
      },
      // Disable per-message compression for now (see spec Q3)
      perMessageDeflate: false,
      // Reasonable connection limits
      connectTimeout: 10_000,
      pingTimeout: 25_000,
      pingInterval: 10_000,
    });

    this.logger.info("SocketManager created");
  }

  /**
   * Register a socket.io namespace for the given world.
   *
   * REQ-NET-002: namespace /world/<worldId>
   * REQ-NET-003: auth in handshake
   * REQ-NET-014: protocolVersion check
   */
  registerWorldNamespace(options: WorldNamespaceOptions): void {
    const { worldId, db, secret, authService, maxConnections = 16, opBufferSize } = options;

    const namespacePath = `/world/${worldId}`;
    this.logger.info({ worldId, namespacePath }, "Registering world namespace");

    const ns = this.io.of(namespacePath);

    // Build per-world services
    const seqStore = new SeqStore(db);
    const opBuffer = new OpBuffer(opBufferSize);
    const store = new DocumentStore({ db, coreVersion: "0.1.0" });
    const registry = new HandlerRegistry();

    // REQ-NET-040/071: ephemeral rate limiters shared across all sockets in this namespace
    // cursor: ~20/s max = 50 ms minimum interval
    const cursorRateLimiter = new EphemeralRateLimiter(50);
    // ping: 2/s max = 500 ms minimum interval
    const pingRateLimiter = new EphemeralRateLimiter(500);

    // REQ-NET-005: track current scene room per socket (socketId → sceneId).
    // Updated by ephemeral-handlers when a cursor event carries a new sceneId.
    const sceneRooms = new Map<string, string>();

    const syncDeps = {
      store,
      seqStore,
      opBuffer,
      ns,
      db,
      // REQ-CHT-033: supply recent chat for join snapshot
      getRecentChat: (userId: string, role: number) => getRecentChatForUser(db, userId, role),
    };

    // Register built-in system handlers
    registry.register("system:ping", systemPingHandler);
    registry.register(
      "system:whoami",
      buildWhoAmIHandler((id) => authService.getUser(id)),
    );

    // Register M1-B document CRUD handlers
    registry.register("doc:create", buildDocCreateHandler(syncDeps));
    registry.register("doc:update", buildDocUpdateHandler(syncDeps));
    registry.register("doc:delete", buildDocDeleteHandler(syncDeps));

    // Register M1-B sync handlers
    registry.register("resync:request", buildResyncRequestHandler(syncDeps));
    registry.register("world:activeScene", buildActiveSceneHandler(syncDeps));

    // Register M1-D chat + roll handlers
    const chatDeps = { db, ns, seqStore, worldId };
    registry.register("chat:send", buildChatSendHandler(chatDeps));
    registry.register("chat:history", buildChatHistoryHandler(chatDeps));

    // Register M2-A vision handlers (walls, lights, door state, move collision)
    const visionDeps = { store, seqStore, opBuffer, ns };
    registry.register("wall:create", buildWallCreateHandler(visionDeps));
    registry.register("wall:update", buildWallUpdateHandler(visionDeps));
    registry.register("wall:delete", buildWallDeleteHandler(visionDeps));
    registry.register("light:create", buildLightCreateHandler(visionDeps));
    registry.register("light:update", buildLightUpdateHandler(visionDeps));
    registry.register("light:delete", buildLightDeleteHandler(visionDeps));
    registry.register("scene:doorState", buildDoorStateHandler(visionDeps));
    // Override token:move with collision-aware handler
    registry.register("token:move", buildTokenMoveHandler(visionDeps));

    // REQ-NET-003/014: auth middleware runs before connection is accepted
    ns.use((socket, next) => {
      const auth = socket.handshake.auth as Record<string, unknown>;

      // REQ-NET-014: protocol version check
      const clientVersion = auth["protocolVersion"];
      if (clientVersion !== PROTOCOL_VERSION) {
        const err = Object.assign(new Error("PROTOCOL_MISMATCH"), {
          data: {
            code: "PROTOCOL_MISMATCH",
            message:
              `Protocol version mismatch. Server expects ${String(PROTOCOL_VERSION)}, ` +
              `client sent ${String(clientVersion)}. Please reload the page.`,
          },
        });
        next(err);
        return;
      }

      // REQ-NET-003: JWT verification
      const rawToken = auth["token"];
      if (typeof rawToken !== "string" || rawToken.length === 0) {
        const err = Object.assign(new Error("AUTH_FAILED"), {
          data: {
            code: "AUTH_FAILED",
            message: "Missing or invalid authentication token.",
          },
        });
        next(err);
        return;
      }

      verifyAccessToken(rawToken, secret).then(
        (payload) => {
          if (!payload) {
            const err = Object.assign(new Error("AUTH_FAILED"), {
              data: {
                code: "AUTH_FAILED",
                message: "Invalid or expired authentication token.",
              },
            });
            next(err);
            return;
          }

          // Verify the token belongs to the correct world
          if (payload.worldId !== worldId) {
            const err = Object.assign(new Error("AUTH_FAILED"), {
              data: {
                code: "AUTH_FAILED",
                message: "Token is for a different world.",
              },
            });
            next(err);
            return;
          }

          // Attach authenticated user data to socket
          socket.data = {
            userId: payload.sub,
            role: payload.role,
            worldId,
          } satisfies SocketData;

          next();
        },
        (err: unknown) => {
          this.logger.warn({ err, worldId }, "Socket auth middleware error");
          const authErr = Object.assign(new Error("AUTH_FAILED"), {
            data: { code: "AUTH_FAILED", message: "Authentication error." },
          });
          next(authErr);
        },
      );
    });

    // Connection handler
    ns.on("connection", (socket: Socket) => {
      const data = socket.data as SocketData;
      this.logger.info(
        { userId: data.userId, role: data.role, worldId, socketId: socket.id },
        "Socket connected",
      );

      // REQ-NET-006: check connection limit AFTER auth (count authenticated connections)
      const connectedCount = ns.sockets.size;
      if (connectedCount > maxConnections) {
        this.logger.warn(
          { connectedCount, maxConnections, worldId },
          "World is full — disconnecting socket",
        );
        socket.emit("connect_error", {
          code: "WORLD_FULL",
          message: `World "${worldId}" has reached the maximum number of connections (${String(maxConnections)}).`,
        });
        socket.disconnect(true);
        return;
      }

      // REQ-NET-004: join user room; GM/ASSISTANT also join gm room
      void socket.join(`user:${data.userId}`);
      if (isRolePrivileged(data.role)) {
        void socket.join("gm");
      }

      // REQ-NET-062/063: send snapshot or delta on join
      // Client may send lastSeq in handshake auth for reconnect resync
      const auth = socket.handshake.auth as Record<string, unknown>;
      const lastSeq = typeof auth["lastSeq"] === "number" ? auth["lastSeq"] : undefined;
      sendJoinSnapshot(socket, syncDeps, data.userId, data.role, lastSeq);

      // Register low-level event handlers
      this._registerSocketHandlers(socket, data, registry, seqStore, ns, {
        cursorRateLimiter,
        pingRateLimiter,
        sceneRooms,
      });

      socket.on("disconnect", (reason) => {
        this.logger.info(
          { userId: data.userId, worldId, reason, socketId: socket.id },
          "Socket disconnected",
        );
        // Evict rate limiter state for this socket to free memory
        cursorRateLimiter.evict(socket.id);
        pingRateLimiter.evict(socket.id);
        // Evict scene room tracking for this socket
        sceneRooms.delete(socket.id);
      });
    });

    this.namespaces.set(worldId, ns);
    this.logger.info({ worldId, namespacePath }, "World namespace registered");
  }

  /**
   * Remove a world namespace and disconnect all its sockets.
   * Called on world close.
   */
  async removeWorldNamespace(worldId: string): Promise<void> {
    const ns = this.namespaces.get(worldId);
    if (!ns) return;

    this.logger.info({ worldId }, "Removing world namespace, disconnecting sockets");

    // Disconnect all connected sockets gracefully
    const sockets = await ns.fetchSockets();
    for (const s of sockets) {
      s.disconnect(true);
    }

    // Remove the namespace from the socket.io server
    ns.removeAllListeners();
    this.io._nsps.delete(`/world/${worldId}`);
    this.namespaces.delete(worldId);

    this.logger.info({ worldId }, "World namespace removed");
  }

  /** Close all namespaces and the underlying socket.io server. */
  async close(): Promise<void> {
    const worldIds = [...this.namespaces.keys()];
    for (const id of worldIds) {
      await this.removeWorldNamespace(id);
    }
    await new Promise<void>((resolve) => {
      void this.io.close(() => {
        this.logger.info("SocketManager closed");
        resolve();
      });
    });
  }

  // --------------------------------------------------------------------------
  // Private: per-socket event routing
  // --------------------------------------------------------------------------

  /**
   * Rough byte size of an arbitrary value (JSON serialisation length).
   * Used for size guards — not for exact accounting.
   */
  private static _roughSize(value: unknown): number {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }

  private _registerSocketHandlers(
    socket: Socket,
    data: SocketData,
    registry: HandlerRegistry,
    seqStore: SeqStore,
    ns: Namespace,
    rateLimiters: {
      cursorRateLimiter: EphemeralRateLimiter;
      pingRateLimiter: EphemeralRateLimiter;
      /** REQ-NET-005: shared scene room tracking map for this namespace. */
      sceneRooms: Map<string, string>;
    },
  ): void {
    const logger = this.logger;

    /**
     * Generic envelope dispatcher used by op and query events.
     * Validates the envelope, looks up and invokes the handler,
     * and calls the ack callback with the result.
     *
     * REQ-NET-010: validate envelope; discard malformed.
     * REQ-NET-011: ack callback with requestId correlation.
     * REQ-NET-070 / REQ-SEC-061: message size guard (op ≤ 1 MiB).
     */
    const dispatch = async (
      eventName: "op" | "query",
      rawEnvelope: unknown,
      ack: (response: unknown) => void,
    ): Promise<void> => {
      // REQ-NET-070 / REQ-SEC-061: reject oversized op/query messages (1 MiB limit)
      const MAX_OP_BYTES = 1 * 1024 * 1024; // 1 MiB
      const msgSize = SocketManager._roughSize(rawEnvelope);
      if (msgSize > MAX_OP_BYTES) {
        logger.warn(
          { userId: data.userId, eventName, sizeBytes: msgSize, limitBytes: MAX_OP_BYTES },
          "Oversized envelope — rejecting",
        );
        if (typeof ack === "function") {
          ack({ ok: false, code: "TOO_LARGE", message: "Message exceeds maximum allowed size" });
        }
        return;
      }

      // Validate envelope shape
      const parsed = EnvelopeSchema.safeParse(rawEnvelope);
      if (!parsed.success) {
        logger.warn(
          { userId: data.userId, eventName, error: parsed.error.message },
          "Malformed envelope — discarding",
        );
        if (typeof ack === "function") {
          ack({ ok: false, code: "VALIDATION_FAILED", message: "Malformed envelope" });
        }
        return;
      }

      const envelope = parsed.data;

      // Look up handler by type
      const handler = registry.get(envelope.type);
      if (!handler) {
        logger.debug(
          { userId: data.userId, type: envelope.type },
          "No handler registered for type",
        );
        if (typeof ack === "function") {
          ack({
            ok: false,
            code: "VALIDATION_FAILED",
            message: `No handler for type "${envelope.type}"`,
          });
        }
        return;
      }

      const ctx = {
        userId: data.userId,
        role: data.role,
        worldId: data.worldId,
      };

      try {
        const result = await handler(envelope.payload, ctx);
        if (typeof ack === "function") {
          // SECURITY (M1-C): centralized hidden-token redaction for the ack
          // echoed back to the requester.  Handlers that touch Scene tokens
          // (the embedded create/update/delete paths and primary Scene
          // create/update) return the full Scene in result.documents[] or
          // result.parent.  For NON-privileged sockets (role < ASSISTANT) we
          // strip hidden tokens here — at the single dispatcher choke point —
          // so the hidden token's name/coords/_id can never reach a player via
          // the ack, by ANY handler (present or future).  Privileged sockets
          // (GM / ASSISTANT) receive the unredacted result.  redactAckResult*
          // clones before stripping and never mutates the shared object that
          // the live-broadcast / op-buffer paths also reference.
          const acked = isRolePrivileged(data.role)
            ? result
            : redactAckResultForNonPrivileged(result);

          // REQ-NET-011: echo requestId back in ack (M0-C pendência)
          if (
            typeof acked === "object" &&
            acked !== null &&
            !("requestId" in acked) &&
            envelope.requestId !== undefined
          ) {
            (acked as Record<string, unknown>)["requestId"] = envelope.requestId;
          }
          ack(acked);
        }
      } catch (err) {
        logger.error({ err, userId: data.userId, type: envelope.type }, "Handler threw");
        if (typeof ack === "function") {
          ack({
            ok: false,
            requestId: envelope.requestId,
            code: "INTERNAL_ERROR",
            message: "Internal server error",
          });
        }
      }
    };

    // REQ-NET-013: op — mutations, expected to call ack with {ok, seq?, result}
    socket.on("op", (rawEnvelope: unknown, ack: (r: unknown) => void) => {
      void dispatch("op", rawEnvelope, ack);
    });

    // REQ-NET-013: query — request/response
    socket.on("query", (rawEnvelope: unknown, ack: (r: unknown) => void) => {
      void dispatch("query", rawEnvelope, ack);
    });

    // REQ-NET-013: ephemeral — presence/interaction, no ack, no persistence
    socket.on("ephemeral", (rawEnvelope: unknown) => {
      // REQ-NET-070 / REQ-SEC-061: silently discard oversized ephemeral messages (16 KiB limit)
      const MAX_EPHEMERAL_BYTES = 16 * 1024; // 16 KiB
      const ephSize = SocketManager._roughSize(rawEnvelope);
      if (ephSize > MAX_EPHEMERAL_BYTES) {
        logger.debug(
          { userId: data.userId, sizeBytes: ephSize, limitBytes: MAX_EPHEMERAL_BYTES },
          "Oversized ephemeral envelope — discarding silently",
        );
        return;
      }

      const parsed = EnvelopeSchema.safeParse(rawEnvelope);
      if (!parsed.success) {
        logger.debug({ userId: data.userId }, "Malformed ephemeral envelope — discarding");
        return;
      }

      // M1-E: route ephemeral events to presence handlers
      handleEphemeralEnvelope(
        socket,
        parsed.data as Envelope,
        {
          userId: data.userId,
          role: data.role,
          worldId: data.worldId,
        },
        {
          ns,
          logger,
          cursorRateLimiter: rateLimiters.cursorRateLimiter,
          pingRateLimiter: rateLimiters.pingRateLimiter,
          sceneRooms: rateLimiters.sceneRooms,
        },
      );
    });

    // TODO (M1-B — REQ-NET-071 / REQ-SEC-060): per-socket/per-type rate limiting.
    // Add a token-bucket here (e.g. 60 ops/min per socket) that responds with
    // { ok: false, code: 'RATE_LIMITED' } for ops/queries and discards silently for
    // ephemeral. Track bucket state in a Map<socketId, BucketState> on SocketManager.
    // This note is intentionally left here rather than as a TODO comment scattered
    // across the individual event handlers so it is easy to locate at M1-B start.

    // REQ-NET-013: system — namespaced game-system messages
    socket.on("system", (rawEnvelope: unknown, ack?: (r: unknown) => void) => {
      const parsed = EnvelopeSchema.safeParse(rawEnvelope);
      if (!parsed.success) {
        logger.debug({ userId: data.userId }, "Malformed system envelope — discarding");
        if (typeof ack === "function") {
          ack({ ok: false, code: "VALIDATION_FAILED", message: "Malformed envelope" });
        }
        return;
      }
      // System channel handled by game-system layer (M1+)
      logger.debug({ type: parsed.data.type, userId: data.userId }, "System event received");
      if (typeof ack === "function") {
        ack({ ok: false, code: "VALIDATION_FAILED", message: "System channel not yet active" });
      }
    });

    // seqStore is used by sync/doc handlers via the syncDeps closure above
    void seqStore;
  }
}
