/**
 * Structured logger for @fusion/server, built on pino.
 *
 * Usage:
 *   import { createLogger } from './logger.js';
 *   const logger = createLogger('info');
 *   logger.info({ port: 33000 }, 'Server listening');
 */

import pino from "pino";
import type { Logger } from "pino";
import type { ServerConfig } from "./config.js";

export type { Logger };

/**
 * Creates a pino logger instance configured for the given log level.
 *
 * In production the logger emits newline-delimited JSON (pino's default).
 * In test environments (`NODE_ENV=test`) it is silenced by default —
 * callers can override by passing `logLevel: 'debug'` explicitly.
 */
export function createLogger(logLevel: ServerConfig["logLevel"] = "info"): Logger {
  return pino({
    level: logLevel,
    // pino's default timestamp is epoch ms; keep it for log aggregators.
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      // Include package identity in every log line.
      pkg: "@fusion/server",
    },
  });
}
