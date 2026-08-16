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

import { EnvelopeSchema, PROTOCOL_VERSION, FUSION_VERSION, type Envelope } from "@fusion/shared";

import { verifyAccessToken } from "../auth/crypto.js";
import { SeqStore } from "./seq-store.js";
import { OpBuffer } from "./op-buffer.js";
import { HandlerRegistry } from "./handler-registry.js";
import {
  systemPingHandler,
  buildWhoAmIHandler,
  buildSystemConditionsHandler,
} from "./handlers/system.js";
import {
  buildDocCreateHandler,
  buildDocUpdateHandler,
  buildDocDeleteHandler,
} from "./handlers/doc-handlers.js";
import { buildActorSetKnowledgeHandler } from "./handlers/knowledge-handlers.js";
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
  buildFogUpdateHandler,
  buildFogGetHandler,
  buildFogResetHandler,
} from "./handlers/fog-handlers.js";
import { FogStore } from "../fog/index.js";
import {
  buildCombatCreateHandler,
  buildCombatStartHandler,
  buildCombatAddCombatantHandler,
  buildCombatRemoveCombatantHandler,
  buildCombatRollInitiativeHandler,
  buildCombatSetInitiativeHandler,
  buildCombatResetInitiativeHandler,
  buildCombatNextHandler,
  buildCombatPreviousHandler,
  buildCombatToggleDefeatedHandler,
  buildCombatSetHiddenHandler,
  buildCombatReorderHandler,
  buildCombatEndHandler,
} from "../combat/combat-handlers.js";
import { InitiativeFormulaRegistry } from "../combat/initiative-registry.js";
import { registerSystemFormulas } from "../combat/system-formula-adapter.js";
import { CombatEventBus } from "../combat/combat-event-bus.js";
import { TargetingStore } from "../combat/targeting-store.js";
import { buildCombatTargetHandler, registerTargetingCleanup } from "../combat/target-handler.js";
import {
  buildResyncRequestHandler,
  buildActiveSceneHandler,
  sendJoinSnapshot,
} from "./handlers/sync-handlers.js";
import {
  buildChatSendHandler,
  buildChatHistoryHandler,
  buildChatSearchHandler,
  buildChatContextHandler,
  buildChatInvalidateHandler,
  getRecentChatForUser,
} from "../chat/index.js";
import {
  buildConjuracaoProporHandler,
  buildConjuracaoArbitrarHandler,
  buildConjuracaoRolarHandler,
  buildConjuracaoResolverHandler,
  buildConjuracaoCancelarHandler,
  buildContestadoHandler,
  buildReacaoUsarHandler,
  registerReacaoResetOnTurnStart,
  buildProgressaoConfirmarHandler,
} from "../etmos/index.js";
import {
  redactAckResultForNonPrivileged,
  registerContactKnowledgeSource,
  getContactKnowledgeSource,
  contactKnowledgeSourceFromStore,
} from "./redaction.js";
import { DocumentStore, WriteMetricsCollector } from "../documents/index.js";
import type { AuthService } from "../auth/service.js";
import type { Database as Db } from "better-sqlite3";
import type { SystemModule } from "@fusion/system-api";

import { isRolePrivileged } from "../documents/ownership.js";
import { EphemeralRateLimiter, handleEphemeralEnvelope } from "./ephemeral-handlers.js";
import { RollService } from "../chat/roll-service.js";
import {
  CompendiumService,
  buildCompendiumListHandler,
  buildCompendiumIndexHandler,
  buildCompendiumSearchHandler,
  buildCompendiumSearchAllHandler,
  buildCompendiumGetHandler,
  buildCompendiumI18nBySourceRefHandler,
  buildCompendiumImportHandler,
  buildCompendiumImportToActorHandler,
} from "../compendium/index.js";

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
  /**
   * CompendiumService with packs already discovered.
   * If not provided, a new empty service is created (no packs available).
   * REQ-CMP-010.
   */
  compendiumService?: CompendiumService;
  /**
   * The world's game system id (e.g. "pf2e", "sf2e"). Forwarded to doc
   * handlers for system-specific server-side validation that can't go
   * through the system-api hook bus (e.g. SF2e augmentation slot limit,
   * REQ-SF2-024). Optional — undefined disables all such checks.
   */
  systemId?: string;
  /**
   * The world's resolved SystemModule (from SystemRegistry.tryGet(systemId)),
   * when the system package is available. Used to wire the system's
   * InitiativeFormulaFn entries (SystemModule.combat.initiativeFormulas) into
   * the per-world InitiativeFormulaRegistry — see system-formula-adapter.ts.
   * Optional — undefined leaves the registry with only the generic-1d20
   * fallback (e.g. stub system, or system package not loaded).
   */
  systemModule?: SystemModule;
}

/**
 * Dynamic CORS origin validator (socket.io/`cors` package "CustomOrigin"
 * shape). Used instead of a static string when the set of allowed origins
 * can change at runtime — e.g. M6/B4's Cloudflare tunnel, whose public
 * `*.trycloudflare.com` URL only exists once the tunnel has started and
 * must be accepted for the WebSocket handshake without a server restart.
 */
export type DynamicCorsOrigin = (
  requestOrigin: string | undefined,
  callback: (err: Error | null, allow?: boolean | string) => void,
) => void;

export interface SocketManagerOptions {
  /** Underlying HTTP server (Fastify's server). */
  httpServer: HttpServer;
  /** Pino logger. */
  logger: Logger;
  /**
   * CORS origin (restricts socket.io CORS to the server's own origin, plus
   * any additional allowed origins). A plain string covers the static case
   * (REQ-SEC default); a {@link DynamicCorsOrigin} function covers the case
   * where allowed origins change at runtime (M6/B4 tunnel) — see boot.ts's
   * `buildSocketOrigin`.
   */
  origin: string | DynamicCorsOrigin;
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
  /**
   * T016 write-metrics collector per world. Kept beside `namespaces` (rather
   * than only inside `registerWorldNamespace`'s closure) because the collector
   * outlives every individual request: its periodic flush has to be stopped
   * and its last partial window has to be logged when the world closes, and
   * neither is reachable from a closure nobody holds.
   */
  private readonly writeMetrics = new Map<string, WriteMetricsCollector>();

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
    const {
      worldId,
      db,
      secret,
      authService,
      maxConnections = 16,
      opBufferSize,
      compendiumService,
      systemId,
      systemModule,
    } = options;

    const namespacePath = `/world/${worldId}`;
    this.logger.info({ worldId, namespacePath }, "Registering world namespace");

    const ns = this.io.of(namespacePath);

    // Build per-world services
    const seqStore = new SeqStore(db);
    const opBuffer = new OpBuffer(opBufferSize);
    // T016: one collector per world, wired into the store so EVERY writer —
    // doc/vision/combat handlers, batched or not — is accounted for at the
    // single point they all converge on.
    const writeMetrics = new WriteMetricsCollector({ logger: this.logger, worldId });
    this.writeMetrics.set(worldId, writeMetrics);
    const store = new DocumentStore({ db, coreVersion: FUSION_VERSION, metrics: writeMetrics });
    const registry = new HandlerRegistry();

    // Spec 39 §5.9 (REQ-CTT-083): bind this namespace to the Actor table its
    // contact redaction reads from. Registered here, once, so EVERY emission
    // path that goes through `broadcastToWorld` — present or future, in any
    // handler module — is covered without having to thread a store handle.
    registerContactKnowledgeSource(ns, contactKnowledgeSourceFromStore(store));

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
      logger: this.logger,
      ...(systemId !== undefined ? { systemId } : {}),
      ...(systemModule !== undefined ? { systemModule } : {}),
      // REQ-CHT-033: supply recent chat for join snapshot
      getRecentChat: (userId: string, role: number) => getRecentChatForUser(db, userId, role),
    };

    // Register built-in system handlers
    registry.register("system:ping", systemPingHandler);
    registry.register(
      "system:whoami",
      buildWhoAmIHandler((id) => authService.getUser(id)),
    );
    // Spec 15 REQ-SYS-043 / spec 39 DEC-CTT-11: the active system's condition
    // dictionary. The chip's colour, emphasis and tooltip are declared data
    // (REQ-CTT-031/032/034) and the client cannot import a game system, so the
    // declaration reaches the drawer through here.
    registry.register("system:conditions", buildSystemConditionsHandler(systemModule));

    // Register M1-B document CRUD handlers
    registry.register("doc:create", buildDocCreateHandler(syncDeps));
    registry.register("doc:update", buildDocUpdateHandler(syncDeps));
    registry.register("doc:delete", buildDocDeleteHandler(syncDeps));

    // Spec 39 §5.8: contact knowledge is a field of the contact's own Actor,
    // but doc:update refuses the flag path — this is the one way in.
    registry.register("actor:setKnowledge", buildActorSetKnowledgeHandler(syncDeps));

    // Register M1-B sync handlers
    registry.register("resync:request", buildResyncRequestHandler(syncDeps));
    registry.register("world:activeScene", buildActiveSceneHandler(syncDeps));

    // Register M1-D chat + roll handlers
    const chatDeps = { db, ns, seqStore, worldId };
    registry.register("chat:send", buildChatSendHandler(chatDeps));
    registry.register("chat:history", buildChatHistoryHandler(chatDeps));
    // REQ-CHT-050 / REQ-ACH-012: search is open to every role; the handler
    // filters with the same visibility predicate chat:history uses.
    registry.register("chat:search", buildChatSearchHandler(chatDeps));
    // REQ-CHT-051 / REQ-ACH-013: ±N VISIBLE messages around one message; the
    // count is per requester, and an invisible neighbour takes no slot.
    registry.register("chat:context", buildChatContextHandler(chatDeps));
    // REQ-CHT-005 / REQ-ACH-080..086: moderation of a single message is
    // invalidation, never deletion — the GM or the author voids it, the log
    // keeps it, and nothing outside the log is undone.
    registry.register("chat:invalidate", buildChatInvalidateHandler(chatDeps));

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

    // Register M2-B fog-of-war handlers
    const fogStore = new FogStore(db);
    const fogDeps = { fogStore, ns };
    registry.register("fog:update", buildFogUpdateHandler(fogDeps));
    registry.register("fog:get", buildFogGetHandler(fogDeps));
    registry.register("fog:reset", buildFogResetHandler(fogDeps));

    // Register M2-C combat handlers
    const combatRollService = new RollService({ db });
    const formulaRegistry = new InitiativeFormulaRegistry(combatRollService, worldId, systemId);
    // REQ-CBT-012: wire the system's initiative formulas (if the system package
    // was loaded — see serve.ts/worlds.ts SystemRegistry) into the registry.
    if (systemModule) {
      registerSystemFormulas(
        formulaRegistry,
        systemModule.manifest.id,
        systemModule.combat.initiativeFormulas,
        combatRollService,
        worldId,
        systemModule.combat.initiativeCompares,
      );
    }
    const eventBus = new CombatEventBus();
    const combatDeps = {
      store,
      seqStore,
      opBuffer,
      ns,
      formulaRegistry,
      eventBus,
      db,
      worldId,
      logger: this.logger,
      ...(systemModule !== undefined ? { systemModule } : {}),
    };
    // Handler names match the EnvelopeTypeSchema literals in packages/shared/src/protocol.ts
    registry.register("combat:create", buildCombatCreateHandler(combatDeps));
    registry.register("combat:beginCombat", buildCombatStartHandler(combatDeps));
    registry.register("combat:addCombatant", buildCombatAddCombatantHandler(combatDeps));
    registry.register("combat:removeCombatant", buildCombatRemoveCombatantHandler(combatDeps));
    registry.register("combat:rollInitiative", buildCombatRollInitiativeHandler(combatDeps));
    registry.register("combat:setInitiative", buildCombatSetInitiativeHandler(combatDeps));
    registry.register("combat:resetInitiative", buildCombatResetInitiativeHandler(combatDeps));
    registry.register("combat:nextTurn", buildCombatNextHandler(combatDeps));
    registry.register("combat:previousTurn", buildCombatPreviousHandler(combatDeps));
    registry.register("combat:setDefeated", buildCombatToggleDefeatedHandler(combatDeps));
    registry.register("combat:setHidden", buildCombatSetHiddenHandler(combatDeps));
    registry.register("combat:reorder", buildCombatReorderHandler(combatDeps));
    registry.register("combat:endCombat", buildCombatEndHandler(combatDeps));

    // REQ-CBT-053..055: token targeting (ephemeral; userId server-authoritative).
    const targetingStore = new TargetingStore();
    const targetDeps = { store, seqStore, ns, targetingStore };
    registry.register("combat:target", buildCombatTargetHandler(targetDeps));
    // REQ-CBT-055: clear a targeter's targets when their combatant's turn ends.
    registerTargetingCleanup(targetDeps, eventBus);

    // REQ-ETM-023: reset each Etmos combatant's Reação counter at the start
    // of their own turn. Registered unconditionally (same rationale as the
    // etmos:conjuracao:* handlers below) — the listener itself no-ops for
    // non-orador/antagonista combatants, so non-Etmos worlds are unaffected.
    registerReacaoResetOnTurnStart(eventBus, { store, seqStore, opBuffer, ns });

    // Register M3-D compendium handlers (REQ-CMP-010..024)
    const compSvc = compendiumService ?? new CompendiumService();
    const compDeps = {
      compendium: compSvc,
      db,
      ns,
      logger: this.logger,
      // Only `compendium:importToActor` writes a document, and it announces it
      // on the ordinary doc:update channel (REQ-CPD-061).
      seqStore,
      opBuffer,
      // Same pair `syncDeps` carries: the sheet door runs the SAME embedded-Item
      // validation `doc:create` runs (documents/embedded-item.ts), and the
      // system-specific half of it needs the world's systemId.
      ...(systemId !== undefined ? { systemId } : {}),
      // T016: `compendium:import` is a live session op — it writes rows of
      // `actors`/`items` through a DocumentStore of its own, holding the very
      // same IMMEDIATE lock. Without this the busiest minute of the evening
      // (a GM pulling a dozen creatures mid-combat) would be missing from the
      // report that exists to find busy minutes.
      metrics: writeMetrics,
      ...(systemModule !== undefined ? { systemModule } : {}),
    };
    registry.register("compendium:list", buildCompendiumListHandler(compDeps));
    registry.register("compendium:index", buildCompendiumIndexHandler(compDeps));
    registry.register("compendium:search", buildCompendiumSearchHandler(compDeps));
    // REQ-CPD-030..032 / REQ-CMP-013a: one search over every pack the caller
    // can see, answered already grouped, counted and truncated by the server.
    registry.register("compendium:searchAll", buildCompendiumSearchAllHandler(compDeps));
    registry.register("compendium:get", buildCompendiumGetHandler(compDeps));
    // Issue #43: a world document has no `uuid` (importToWorld strips it to keep
    // the world copy EN-pure), so `compendium:get` cannot serve its translation.
    // Its `flags.fusion.{packName,sourceId}` do survive, and this handler is the
    // read-side path that turns that origin reference back into the pt-BR overlay.
    registry.register(
      "compendium:i18nBySourceRef",
      buildCompendiumI18nBySourceRefHandler(compDeps),
    );
    registry.register("compendium:import", buildCompendiumImportHandler(compDeps));
    // DEC-CPD-05 / REQ-CPD-061/073: the sheet door. Not gated by role — gated
    // by OWNER of the destination actor, inside the service.
    registry.register("compendium:importToActor", buildCompendiumImportToActorHandler(compDeps));

    // Register M5-C Etmos Compositor de Magias handlers (etmos:conjuracao:*).
    // Only meaningful when the active world system is "etmos" — registered
    // unconditionally like the other system-agnostic handlers; clients of
    // non-Etmos worlds simply never emit these envelope types.
    const conjuracaoDeps = {
      store,
      db,
      ns,
      seqStore,
      opBuffer,
      worldId,
      ...(systemModule !== undefined ? { systemModule } : {}),
    };
    registry.register("etmos:conjuracao:propor", buildConjuracaoProporHandler(conjuracaoDeps));
    registry.register("etmos:conjuracao:arbitrar", buildConjuracaoArbitrarHandler(conjuracaoDeps));
    registry.register("etmos:conjuracao:rolar", buildConjuracaoRolarHandler(conjuracaoDeps));
    registry.register("etmos:conjuracao:resolver", buildConjuracaoResolverHandler(conjuracaoDeps));
    registry.register("etmos:conjuracao:cancelar", buildConjuracaoCancelarHandler(conjuracaoDeps));

    // REQ-ETM-021/CA-6: Teste Contestado — one-shot two-roll action, same deps
    // shape (store/db/ns/seqStore/opBuffer/worldId) as the Compositor handlers.
    registry.register("etmos:teste:contestado", buildContestadoHandler(conjuracaoDeps));

    // REQ-ETM-023: Reação por rodada — spend half (reset half is
    // registerReacaoResetOnTurnStart above, wired directly to the CombatEventBus).
    registry.register(
      "etmos:reacao:usar",
      buildReacaoUsarHandler({ store, db, ns, seqStore, opBuffer, worldId }),
    );

    // REQ-ETM-035..039/CA-11: Marcos de Crescimento level-up confirmation.
    registry.register(
      "etmos:progressao:confirmar",
      buildProgressaoConfirmarHandler({ store, ns, seqStore, opBuffer, worldId }),
    );

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

      // REQ-DST-036/037: greet the client with the server's semantic version
      // and protocol version right after the connection is accepted (auth +
      // capacity checks already passed above). The client already validated
      // protocolVersion compatibility during the handshake auth (REQ-NET-014,
      // the ns.use middleware above) — this "hello" event is purely
      // informational (e.g. UI "server vX.Y.Z" display, update-nudge logic),
      // not a second compatibility gate.
      socket.emit("hello", {
        serverVersion: FUSION_VERSION,
        protocolVersion: PROTOCOL_VERSION,
      });

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
    try {
      const ns = this.namespaces.get(worldId);
      if (ns) {
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
    } finally {
      // T016 final flush — AFTER the sockets are gone, so the tail of the
      // session (anything written while they were being disconnected) is in
      // the report instead of being dropped with the window. It runs even
      // when the namespace is already absent (a registration that failed
      // halfway leaves a collector behind) and even when the teardown above
      // threw: an interval that survives its world keeps the process alive
      // and the last window is lost either way, so the cleanup cannot be
      // hostage to the disconnect path succeeding.
      const metrics = this.writeMetrics.get(worldId);
      if (metrics) {
        metrics.flush();
        metrics.stop();
        this.writeMetrics.delete(worldId);
      }
    }
  }

  /**
   * The write-metrics collector of a registered world, if any (T016).
   *
   * Exposed so the metrics can be read without reaching into the namespace
   * closure — tests assert on `snapshot()`, and it is the hook a diagnostic
   * endpoint would use.
   */
  writeMetricsFor(worldId: string): WriteMetricsCollector | undefined {
    return this.writeMetrics.get(worldId);
  }

  /**
   * Emit an event to the "gm" room of every currently-registered world
   * namespace (M6/B5 — REQ-DST-021, `server.update_available`). The "gm"
   * room is joined by every socket whose role is `isRolePrivileged`
   * (GAMEMASTER/ASSISTANT) on connect — see the `ns.use`/connection handler
   * above. This is a SERVER-wide notification (not scoped to one world),
   * but socket.io has no cross-namespace broadcast primitive, so it fans
   * out to each namespace's own "gm" room individually. In the MVP's
   * single-`--world`-per-process shape this is at most one namespace; the
   * loop future-proofs it for whenever multi-world-per-process (V2) lands.
   */
  broadcastToGm(event: string, payload: unknown): void {
    for (const ns of this.namespaces.values()) {
      ns.to("gm").emit(event, payload);
    }
  }

  /** Close all namespaces and the underlying socket.io server. */
  async close(): Promise<void> {
    // Union of both maps: a world whose namespace is already gone can still
    // hold a live metrics collector (see removeWorldNamespace), and closing
    // the manager must leave no interval behind.
    const worldIds = new Set([...this.namespaces.keys(), ...this.writeMetrics.keys()]);
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
          //
          // Spec 39 §5.9: the same net also carries the contact-knowledge rule
          // (REQ-CTT-081..084) — an ack echoing an Actor back to a player is an
          // emission path like any other, and must not be the one that escapes
          // the module.
          const acked = isRolePrivileged(data.role)
            ? result
            : redactAckResultForNonPrivileged(result, {
                source: getContactKnowledgeSource(ns),
                userId: data.userId,
                role: data.role,
              });

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
