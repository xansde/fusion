/**
 * Boot sequence for @fusion/server.
 *
 * Phases (REQ-ARQ-008):
 *   1. config  — load and validate configuration
 *   2. logger  — create structured pino logger
 *   3. http    — create and configure Fastify instance + routes
 *   4. ready   — listen on port, log "ready for connections"
 *
 * Graceful shutdown on SIGINT / SIGTERM (REQ-ARQ-012).
 * Friendly error on port-in-use instead of raw EADDRINUSE (REQ-ARQ-026).
 */

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { ServerConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BootResult {
  /** Fastify instance; logger is typed as FastifyBaseLogger for compatibility. */
  fastify: FastifyInstance;
  config: ServerConfig;
  logger: Logger;
  /** Resolves when the server has fully shut down. */
  shutdown: () => Promise<void>;
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
}

/**
 * Executes the server boot sequence in named phases.
 *
 * Phase 1 (config) and phase 2 (logger) are assumed to already be done by
 * the caller; this function receives them as parameters and handles phases 3
 * and 4 internally.
 */
export async function boot(options: BootOptions): Promise<BootResult> {
  const { config, logger, skipSignalHandlers = false } = options;

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

  await registerRoutes(fastify, config);

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
  // Graceful shutdown helper
  // -------------------------------------------------------------------------
  let shutdownCalled = false;

  const shutdown = async (): Promise<void> => {
    if (shutdownCalled) return;
    shutdownCalled = true;
    logger.info("Shutdown requested — closing Fastify");
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

  return { fastify, config, logger, shutdown };
}
