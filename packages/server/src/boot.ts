/**
 * Boot sequence for @fusion/server.
 *
 * Phases (REQ-ARQ-008):
 *   1. config  — load and validate configuration
 *   2. logger  — create structured pino logger
 *   3. http    — create and configure Fastify instance + routes
 *   3b. net   — create socket.io server on same HTTP instance (M0-C)
 *   4. ready   — listen on port, log "ready for connections"
 *
 * Graceful shutdown on SIGINT / SIGTERM (REQ-ARQ-012).
 * Friendly error on port-in-use instead of raw EADDRINUSE (REQ-ARQ-026).
 */

import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import type { ServerConfig } from "./config.js";
import type { SocketManager as SocketManagerType, WorldNamespaceOptions } from "./net/index.js";
import type { AuthService } from "./auth/index.js";
import type { RegisterAssetRoutesOptions } from "./assets/routes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BootResult {
  /** Fastify instance; logger is typed as FastifyBaseLogger for compatibility. */
  fastify: FastifyInstance;
  config: ServerConfig;
  logger: Logger;
  /** SocketManager instance (present when netContext was provided). */
  socketManager?: SocketManagerType;
  /** Resolves when the server has fully shut down. */
  shutdown: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Auth context (injected per-world)
// ---------------------------------------------------------------------------

export interface BootAuthContext {
  worldId: string;
  worldTitle: string;
  worldSystemId: string;
  /** Open better-sqlite3 Db instance for the world. */
  db: BetterSqlite3Database;
  /** Loaded HMAC secret for JWT signing. */
  secret: Uint8Array;
}

// ---------------------------------------------------------------------------
// Asset context (injected to register asset HTTP routes)
// ---------------------------------------------------------------------------

/**
 * When provided, registers the asset upload/serving routes (REQ-AST-006..029).
 * Mirrors RegisterAssetRoutesOptions from assets/routes.ts — imported as a type
 * alias so boot.ts remains the single place callers configure the boot.
 */
export type BootAssetContext = RegisterAssetRoutesOptions;

// ---------------------------------------------------------------------------
// Net context (injected when the socket layer should be activated)
// ---------------------------------------------------------------------------

export interface BootNetContext {
  /** World slug — used as the socket.io namespace id. */
  worldId: string;
  /** Open better-sqlite3 Db instance for the world (seq persistence). */
  db: BetterSqlite3Database;
  /** HMAC secret for verifying access tokens in the socket handshake. */
  secret: Uint8Array;
  /** AuthService for user lookups (whoami). */
  authService: AuthService;
  /** CORS origin to restrict socket.io. Defaults to "*" if omitted (dev only). */
  origin?: string;
  /** Max simultaneous connections. Default: 16. */
  maxConnections?: number;
  /**
   * Active world system id (e.g. "pf2e"). Used to discover the committed
   * compendium packs under systems/<systemId>/packs (REQ-CMP-006..012).
   * When omitted, no packs are loaded and compendium:list returns [].
   */
  systemId?: string;
  /**
   * Explicit packs directory override (the per-system root that contains
   * <slug>/pack.json). When omitted, the directory is resolved from the
   * monorepo layout via the systemId. Primarily for tests / custom layouts.
   */
  packsDir?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether a Node.js error is an EADDRINUSE system error.
 */
function isAddressInUse(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "EADDRINUSE";
}

/**
 * Registers all HTTP routes on the Fastify instance.
 * At M0-A scope this is only the /health endpoint.
 * Additional routes (REST, static, auth) are M0-B/M0-C scope.
 */
async function registerRoutes(fastify: FastifyInstance, config: ServerConfig): Promise<void> {
  // Imported lazily to avoid circular dependency with index.ts.
  const { PROTOCOL_VERSION } = await import("@fusion/shared");

  // ---------------------------------------------------------------------------
  // TODO (M1 — REQ-SEC-053/054/055): Security response headers.
  //
  // When the server begins serving the SPA (M1-A), register an onSend hook here
  // that injects the following headers on every response:
  //
  //   X-Content-Type-Options: nosniff
  //   X-Frame-Options: DENY
  //   Referrer-Policy: strict-origin-when-cross-origin
  //   Strict-Transport-Security: max-age=31536000; includeSubDomains   (TLS only)
  //   Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<random>'; ...
  //
  // The nonce must be generated per-request (crypto.randomBytes(16).toString('base64'))
  // and threaded through to the HTML template so inline scripts/styles carry it.
  //
  // A CI test must assert that removing any of the above headers causes a failure
  // (REQ-SEC-NF-003). Use fastify.inject() against /health or a dedicated /sec-test
  // route and assert response.headers['x-content-type-options'] === 'nosniff', etc.
  //
  // This hook is intentionally NOT added in M0-C because:
  //   a) The SPA is served by Vite dev server, not Fastify.
  //   b) Adding it now would require the nonce infrastructure that depends on
  //      the HTML template rendering pipeline (M1-A).
  // ---------------------------------------------------------------------------

  fastify.get("/health", () => {
    return {
      ok: true,
      version: "0.1.0",
      protocolVersion: PROTOCOL_VERSION,
      host: config.host,
      port: config.port,
    };
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export interface BootOptions {
  config: ServerConfig;
  logger: Logger;
  /** When true, skip registering SIGINT/SIGTERM handlers (useful in tests). */
  skipSignalHandlers?: boolean;
  /**
   * When provided, auth routes and the @fastify/cookie plugin are registered
   * for the given open world. Omit during tests that do not need auth.
   */
  authContext?: BootAuthContext;
  /**
   * When provided, socket.io is mounted on the same HTTP server and a world
   * namespace is registered. Requires authContext to be set as well.
   */
  netContext?: BootNetContext;
  /**
   * When provided, asset upload / serving routes are registered on the Fastify
   * instance (REQ-AST-006..029, REQ-SEC-040..045).
   */
  assetContext?: BootAssetContext;
}

/**
 * Executes the server boot sequence in named phases.
 *
 * Phase 1 (config) and phase 2 (logger) are assumed to already be done by
 * the caller; this function receives them as parameters and handles phases 3
 * and 4 internally.
 */
export async function boot(options: BootOptions): Promise<BootResult> {
  const {
    config,
    logger,
    skipSignalHandlers = false,
    authContext,
    netContext,
    assetContext,
  } = options;

  // -------------------------------------------------------------------------
  // Phase 3 — HTTP (create Fastify, register routes)
  // -------------------------------------------------------------------------
  logger.info({ phase: "http" }, "Boot phase: http — configuring Fastify");

  // Supply the pre-configured pino logger directly via `loggerInstance`.
  // Fastify infers FastifyInstance<..., Logger> (pino Logger) which is not
  // directly assignable to FastifyInstance<..., FastifyBaseLogger> because
  // pino's Logger requires `msgPrefix` which FastifyBaseLogger lacks. The
  // double-cast via `unknown` is intentional and safe: at runtime pino Logger
  // satisfies the FastifyBaseLogger interface used by downstream callers.
  const fastify = Fastify({
    loggerInstance: logger,
  }) as unknown as FastifyInstance;

  // Register cookie plugin (required for refresh token httpOnly cookie).
  await fastify.register(fastifyCookie);

  await registerRoutes(fastify, config);

  // Register auth routes if a world context is provided.
  let authServiceInstance: AuthService | undefined;
  if (authContext) {
    const { AuthService, registerAuthRoutes } = await import("./auth/index.js");
    authServiceInstance = new AuthService(authContext.db, authContext.secret, authContext.worldId);
    registerAuthRoutes(fastify, {
      authService: authServiceInstance,
      worldInfo: {
        id: authContext.worldId,
        title: authContext.worldTitle,
        systemId: authContext.worldSystemId,
      },
    });
    logger.info({ worldId: authContext.worldId }, "Auth routes registered");
  }

  // Register asset routes if an asset context is provided (REQ-AST-006..029).
  if (assetContext) {
    const { registerAssetRoutes } = await import("./assets/routes.js");
    registerAssetRoutes(fastify, assetContext);
    logger.info({ assetsDir: assetContext.assetsDir }, "Asset routes registered");
  }

  // -------------------------------------------------------------------------
  // Phase 4 — ready (listen)
  // -------------------------------------------------------------------------
  logger.info(
    { phase: "ready", port: config.port, host: config.host },
    "Boot phase: ready — starting HTTP listener",
  );

  try {
    await fastify.listen({ port: config.port, host: config.host });
  } catch (err) {
    if (isAddressInUse(err)) {
      // REQ-ARQ-026: friendly message instead of raw EADDRINUSE.
      logger.fatal(
        { port: config.port },
        `Port ${String(config.port)} is already in use. ` +
          `Start the server on a different port by setting FUSION_PORT=<port>, ` +
          `adding "port": <port> to fusion.json, or passing --port <port>.`,
      );
      throw new Error(
        `Port ${String(config.port)} is already in use. ` +
          `Set a different port via FUSION_PORT, fusion.json, or --port.`,
      );
    }
    throw err;
  }

  // REQ-ARQ-011: log "ready for connections".
  const address = fastify.server.address();
  const addressStr =
    typeof address === "string"
      ? address
      : address !== null
        ? `${address.address}:${String(address.port)}`
        : `${config.host}:${String(config.port)}`;

  logger.info(
    {
      phase: "ready",
      address: addressStr,
      port: config.port,
    },
    `Fusion server ready for connections at http://${addressStr}`,
  );

  // -------------------------------------------------------------------------
  // Phase 3b — net (socket.io — M0-C)
  // -------------------------------------------------------------------------
  let socketManager: SocketManagerType | undefined;

  if (netContext) {
    logger.info(
      { phase: "net", worldId: netContext.worldId },
      "Boot phase: net — mounting socket.io",
    );

    const { SocketManager: SM } = await import("./net/index.js");

    // Derive origin from config or from net context override
    const origin = netContext.origin ?? `http://${config.host}:${String(config.port)}`;

    socketManager = new SM({
      httpServer: fastify.server,
      logger,
      origin,
    });

    // Resolve authService: use the one created in the auth phase, or create a new one
    let resolvedAuthService = authServiceInstance;
    if (!resolvedAuthService) {
      const { AuthService: AS } = await import("./auth/index.js");
      resolvedAuthService = new AS(netContext.db, netContext.secret, netContext.worldId);
    }

    // ----------------------------------------------------------------------
    // Compendium service — discover the committed packs for the world system
    // so compendium:list / index / get / import work over the real boot path
    // (not only when the service is wired manually in tests). REQ-CMP-006..012.
    // ----------------------------------------------------------------------
    const { CompendiumService, resolveSystemPacksDir } = await import("./compendium/index.js");
    const compendiumService = new CompendiumService(logger);
    if (netContext.systemId !== undefined) {
      const packsDir = resolveSystemPacksDir(netContext.systemId, netContext.packsDir);
      if (packsDir !== null) {
        compendiumService.discoverPacks(packsDir, netContext.systemId);
        logger.info(
          { systemId: netContext.systemId, packsDir, packs: compendiumService.listPacks().length },
          "Compendium packs discovered",
        );
      } else {
        logger.warn(
          { systemId: netContext.systemId, packsDirOverride: netContext.packsDir },
          "Compendium packs directory not found — compendium:list will be empty",
        );
      }
    } else {
      logger.warn("No systemId provided to net context — compendium packs not loaded");
    }

    const nsOptions: WorldNamespaceOptions = {
      worldId: netContext.worldId,
      db: netContext.db,
      secret: netContext.secret,
      authService: resolvedAuthService,
      compendiumService,
    };
    if (netContext.maxConnections !== undefined) {
      nsOptions.maxConnections = netContext.maxConnections;
    }
    socketManager.registerWorldNamespace(nsOptions);

    logger.info(
      { worldId: netContext.worldId, path: `/world/${netContext.worldId}` },
      `Socket.io namespace ready — join URL: http://${addressStr}/world/${netContext.worldId}`,
    );
  }

  // -------------------------------------------------------------------------
  // Graceful shutdown helper
  // -------------------------------------------------------------------------
  let shutdownCalled = false;

  const shutdown = async (): Promise<void> => {
    if (shutdownCalled) return;
    shutdownCalled = true;
    logger.info("Shutdown requested — closing Fastify");

    // Close socket.io before HTTP (drains websocket connections)
    if (socketManager) {
      try {
        await socketManager.close();
      } catch (err) {
        logger.error({ err }, "Error while closing SocketManager");
      }
    }

    try {
      await fastify.close();
      logger.info("Fastify closed cleanly");
    } catch (err) {
      logger.error({ err }, "Error while closing Fastify");
    }
  };

  // -------------------------------------------------------------------------
  // Signal handlers — REQ-ARQ-012
  // -------------------------------------------------------------------------
  if (!skipSignalHandlers) {
    const handleSignal = (signal: string) => {
      logger.info({ signal }, `Received ${signal}, initiating graceful shutdown`);
      void shutdown().then(() => {
        process.exit(0);
      });
    };

    process.once("SIGINT", () => {
      handleSignal("SIGINT");
    });
    process.once("SIGTERM", () => {
      handleSignal("SIGTERM");
    });
  }

  const result: BootResult = { fastify, config, logger, shutdown };
  if (socketManager !== undefined) result.socketManager = socketManager;
  return result;
}
