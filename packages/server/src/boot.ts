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

import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import type { ServerConfig } from "./config.js";
import type { SocketManager as SocketManagerType, WorldNamespaceOptions } from "./net/index.js";
import type { AuthService } from "./auth/index.js";
import type { RegisterAssetRoutesOptions } from "./assets/routes.js";
import type { RegisterSpaRoutesOptions } from "./spa/routes.js";
import type { SystemModule } from "@fusion/system-api";
// Import for side effect only: augments FastifyRequest with `cspNonce`.
import "./spa/routes.js";

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
// SPA context (injected to register the client static build — REQ-DST-002)
// ---------------------------------------------------------------------------

/**
 * When provided (or by default — SPA serving is opt-out, not opt-in), the
 * server serves packages/client/dist as a SPA: static assets under
 * /assets-client/*, and a catch-all falling back to index.html for
 * client-side routing. Mirrors RegisterSpaRoutesOptions from spa/routes.ts.
 */
export type BootSpaContext = RegisterSpaRoutesOptions;

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
  /**
   * The world's resolved SystemModule (e.g. from a SystemRegistry populated
   * in the CLI boot path — see cli/commands/serve.ts). Forwarded to
   * SocketManager.registerWorldNamespace so the system's initiative formulas
   * get wired into the InitiativeFormulaRegistry (REQ-CBT-012). Optional —
   * undefined leaves the registry with only the generic-1d20 fallback.
   */
  systemModule?: SystemModule;
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
 * Build the CSP `connect-src` directive value.
 *
 * DECISION (M6/B1): the socket.io/WebSocket connection is always same-origin
 * in the current (LAN, no tunnel) deployment shape — the client only ever
 * connects back to the server that served it. `wss:`/`ws:` with no host
 * restriction was wider than necessary (any host, any port, over either
 * scheme) and is a data-exfiltration channel if a script injection ever
 * occurred despite the nonce-gated script-src. This restricts to `'self'`
 * (covers the same-origin case, which is 100% of connections today) plus
 * the explicit `wss://`/`ws://` forms of each entry in `allowedOrigins`
 * (REQ-SEC/REQ-DST-032) — populated once the M6/B4 tunnel batch starts
 * fronting the server behind a different public origin than the one the
 * socket itself binds to. Until allowedOrigins is configured, 'self' alone
 * is correct and sufficient for the LAN-only deployment this batch targets.
 */
function connectSrcDirective(allowedOrigins: readonly string[]): string {
  const wsOrigins = allowedOrigins
    .map((origin) => {
      try {
        const url = new URL(origin);
        const wsScheme = url.protocol === "https:" ? "wss:" : "ws:";
        return `${wsScheme}//${url.host}`;
      } catch {
        // Malformed entries are skipped rather than thrown — config
        // validation (config.ts) is the place to reject bad URLs outright;
        // this directive builder stays defensive so a bad entry never
        // crashes response header generation.
        return null;
      }
    })
    .filter((v): v is string => v !== null);

  return ["'self'", ...wsOrigins].join(" ");
}

/**
 * Registers all HTTP routes on the Fastify instance.
 * At M0-A scope this is only the /health endpoint.
 * Additional routes (REST, static, auth) are M0-B/M0-C scope.
 */
async function registerRoutes(fastify: FastifyInstance, config: ServerConfig): Promise<void> {
  // Imported lazily to avoid circular dependency with index.ts.
  const { PROTOCOL_VERSION, FUSION_VERSION } = await import("@fusion/shared");

  // ---------------------------------------------------------------------------
  // REQ-SEC-053/054/055: security response headers, on every response.
  //
  // Registered as an onSend hook so it applies uniformly to /health, /api/*,
  // /assets/*, and the SPA static routes registered below by registerSpaRoutes.
  // socket.io traffic is unaffected — it never goes through Fastify's request
  // pipeline (it hooks the raw HTTP server directly at path "/socket.io/").
  //
  //   X-Content-Type-Options: nosniff                 — always
  //   X-Frame-Options: SAMEORIGIN                      — always (REQ-SEC-053)
  //   Referrer-Policy: strict-origin-when-cross-origin — always
  //   Strict-Transport-Security                        — only when the request
  //     arrived over TLS (config.secureCookies signals a TLS-terminating proxy
  //     in front of the server — see config.ts). Sending HSTS over plain HTTP
  //     LAN deployments would be actively harmful (REQ-SEC-053 says "sob TLS").
  //   Content-Security-Policy — only on HTML responses (the SPA shell); a
  //     per-request nonce is generated and also exposed on the reply so
  //     registerSpaRoutes can inject it into index.html's <script> tag
  //     (REQ-SEC-054/055). API/JSON responses do not need a CSP.
  // ---------------------------------------------------------------------------
  fastify.addHook("onRequest", (request, _reply, done) => {
    // crypto.randomBytes is used instead of crypto.randomUUID so the nonce is
    // valid base64 (CSP nonces are base64-encoded per the spec).
    request.cspNonce = randomBytes(16).toString("base64");
    done();
  });

  fastify.addHook("onSend", (request, reply, payload, done) => {
    void reply.header("X-Content-Type-Options", "nosniff");
    void reply.header("X-Frame-Options", "SAMEORIGIN");
    void reply.header("Referrer-Policy", "strict-origin-when-cross-origin");

    if (config.secureCookies) {
      // REQ-SEC-053: HSTS only makes sense when the connection is (or is
      // fronted by a proxy terminating) TLS.
      void reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    const contentType = reply.getHeader("content-type");
    if (typeof contentType === "string" && contentType.includes("text/html")) {
      // REQ-SEC-054: strict CSP for the SPA shell only.
      // request.cspNonce is always set by the onRequest hook above (which
      // runs earlier in the same request lifecycle); the `?? ""` fallback
      // only satisfies the FastifyRequest augmentation's optional type
      // (spa/routes.ts) and mirrors the same guard used there.
      const nonce = request.cspNonce ?? "";
      void reply.header(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          `connect-src ${connectSrcDirective(config.allowedOrigins)}`,
          "img-src 'self' data: blob:",
          "media-src 'self' blob:",
          `script-src 'self' 'nonce-${nonce}'`,
          // DECISION (M6/B1, spec×client tension — see project CLAUDE.md: the
          // client is out of scope for this batch): REQ-SEC-054's MINIMUM
          // required CSP directive set (default-src/object-src/frame-ancestors/
          // base-uri/connect-src/img-src/media-src/script-src) does NOT include
          // style-src — it is an addition made here, and the spec's blanket
          // "'unsafe-inline'/'unsafe-eval' NÃO DEVEM aparecer em produção"
          // clause was written with script-src's XSS risk in mind (DEC-SEC-05).
          // `style-src 'self'` alone (verified against a real served build)
          // breaks ~4 inline `style="..."` usages across 3 components
          // (FilePicker upload-progress bar width, JoinScreen/TableScreen
          // per-user arbitrary `background-color`) via the style-src-attr
          // fallback — degrading the UI, invisible to curl-based smoke tests.
          // Two of those are per-user ARBITRARY colors, which CSP hashes
          // cannot cover (a hash only allow-lists one fixed string) and which
          // would require a nonce-per-style-attribute mechanism that doesn't
          // exist for style-src-attr in any shipping browser yet. Refactoring
          // those components to CSSOM (`element.style.setProperty`) or Svelte
          // 5 `style:` directives (which compile to the same inline-attribute
          // output, so would NOT help) is out of scope for this batch and is
          // tracked for the client batch. 'unsafe-inline' on style-src is a
          // materially smaller attack surface than on script-src (CSS alone
          // cannot execute arbitrary JS in modern browsers), so it is the
          // accepted trade-off until the client refactor lands.
          "style-src 'self' 'unsafe-inline'",
        ].join("; "),
      );
    }

    done(null, payload);
  });

  fastify.get("/health", () => {
    return {
      ok: true,
      version: FUSION_VERSION,
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
  /**
   * SPA static serving is ON by default (REQ-DST-002) — pass `{}` or omit
   * entirely to use the default dist-dir resolution. Pass an explicit
   * `distDir` to override (tests / custom layouts). Pass `disabled: true`
   * to skip SPA registration altogether (e.g. a test asserting its own
   * catch-all behaviour on unmatched routes).
   */
  spaContext?: BootSpaContext & { disabled?: boolean };
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
    spaContext,
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

  // Register the SPA static build (REQ-DST-002) — ON by default. Registered
  // LAST so its catch-all only ever answers requests that no other route
  // (API/health/asset) claimed. If packages/client/dist is missing (test
  // environments, or a checkout without a client build), registerSpaRoutes
  // logs a warning internally and registers nothing — boot never crashes.
  if (spaContext?.disabled !== true) {
    const { registerSpaRoutes } = await import("./spa/routes.js");
    const { disabled: _disabled, ...spaOptions } = spaContext ?? {};
    registerSpaRoutes(fastify, { ...spaOptions, logger: spaOptions.logger ?? logger });
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
    if (netContext.systemId !== undefined) {
      nsOptions.systemId = netContext.systemId;
    }
    if (netContext.systemModule !== undefined) {
      nsOptions.systemModule = netContext.systemModule;
    }
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
