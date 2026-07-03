/**
 * Structured logger for @fusion/server, built on pino.
 *
 * Usage:
 *   import { createLogger } from './logger.js';
 *   const logger = createLogger('info');
 *   logger.info({ port: 33000 }, 'Server listening');
 *
 *   // With file logging (REQ-DST layout: Logs/fusion-<date>.log):
 *   const logger = createLogger('info', dataDir);
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import type { Logger } from "pino";
import type { ServerConfig } from "./config.js";

export type { Logger };

/**
 * Builds the path for today's log file: `<dataDir>/Logs/fusion-<YYYY-MM-DD>.log`.
 * Exported for tests that need to assert on the exact filename.
 */
export function dailyLogFilePath(dataDir: string, date: Date = new Date()): string {
  const isoDate = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return join(dataDir, "Logs", `fusion-${isoDate}.log`);
}

/**
 * Best-effort file destination for today's log file. Returns `undefined`
 * (never throws) when the directory/file cannot be created or opened —
 * callers fall back to stdout-only logging in that case. A single line is
 * written to stdout via `process.stderr` (not the logger itself, which may
 * not exist yet) to surface the failure without ever being fatal.
 *
 * `sync: true` is used deliberately: boot-time log lines must survive even
 * if the process crashes immediately after — this is a low-volume log
 * (server lifecycle events), not a hot request-logging path, so the small
 * sync-write overhead is an acceptable trade for durability.
 */
function tryCreateFileDestination(dataDir: string): pino.DestinationStream | undefined {
  try {
    const logPath = dailyLogFilePath(dataDir);
    mkdirSync(join(dataDir, "Logs"), { recursive: true });
    return pino.destination({ dest: logPath, sync: true, mkdir: true });
  } catch (err) {
    process.stderr.write(
      `fusion: warning — could not open the log file under "${join(dataDir, "Logs")}" ` +
        `(continuing with console logging only). ${String(err)}\n`,
    );
    return undefined;
  }
}

/**
 * Creates a pino logger instance configured for the given log level.
 *
 * In production the logger emits newline-delimited JSON (pino's default) to
 * stdout. When `dataDir` is provided, it ALSO writes the same JSON lines to
 * `<dataDir>/Logs/fusion-<YYYY-MM-DD>.log` (append, one file per day — no
 * size-based rotation) so the boot log survives if the console window is
 * closed or the process crashes. Failure to open the file never aborts boot:
 * it degrades to stdout-only logging with a one-line warning on stderr.
 *
 * In test environments (`NODE_ENV=test`) it is silenced by default —
 * callers can override by passing `logLevel: 'debug'` explicitly.
 */
export function createLogger(
  logLevel: ServerConfig["logLevel"] = "info",
  dataDir?: string,
): Logger {
  const options: pino.LoggerOptions = {
    level: logLevel,
    // pino's default timestamp is epoch ms; keep it for log aggregators.
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      // Include package identity in every log line.
      pkg: "@fusion/server",
    },
  };

  if (dataDir === undefined) {
    return pino(options);
  }

  const fileDest = tryCreateFileDestination(dataDir);
  if (fileDest === undefined) {
    return pino(options);
  }

  // Per-stream `level` filters what reaches each destination; "trace" (the
  // lowest level) lets everything through so the actual filtering is done
  // once, by the logger's own `options.level` above — including "silent",
  // which is not a valid StreamEntry level but works fine as the logger's
  // top-level `level` (pino short-circuits before any stream is written to).
  const streams: pino.StreamEntry[] = [
    { stream: process.stdout, level: "trace" },
    { stream: fileDest, level: "trace" },
  ];
  return pino(options, pino.multistream(streams));
}
