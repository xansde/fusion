/**
 * Structured logger for @fusion/server, built on pino.
 *
 * Usage:
 *   import { createLogger } from './logger.js';
 *   const logger = createLogger('info');
 *   logger.info({ port: 33000 }, 'Server listening');
 *
 *   // With file logging (REQ-DST layout: Logs/fusion-<local-date>.log,
 *   // rotating at local midnight):
 *   const logger = createLogger('info', dataDir);
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import type { Logger } from "pino";
import type { ServerConfig } from "./config.js";

export type { Logger };

/**
 * Builds the path for a given day's log file:
 * `<dataDir>/Logs/fusion-<YYYY-MM-DD>.log`.
 *
 * Uses the process's LOCAL calendar date, not UTC. A machine in UTC-3 hits
 * UTC midnight at 21:00 local, so an evening session dated by UTC would
 * split across two files right when the session is happening. Exported for
 * tests that need to assert on the exact filename.
 */
export function dailyLogFilePath(dataDir: string, date: Date = new Date()): string {
  return join(dataDir, "Logs", `fusion-${localDateKey(date)}.log`);
}

/** `YYYY-MM-DD` in the process's local timezone — see `dailyLogFilePath`. */
function localDateKey(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** A pino file destination, narrowed to the synchronous-close method we need for rotation. */
type FileDestination = pino.DestinationStream & { destroy(): void };

/**
 * Opens (creating parent dirs as needed) a synchronous pino file destination
 * for the given day. Throws if the directory/file cannot be created —
 * callers are expected to catch and degrade to stdout-only logging.
 */
function openDailyDestination(dataDir: string, date: Date): FileDestination {
  const logPath = dailyLogFilePath(dataDir, date);
  mkdirSync(join(dataDir, "Logs"), { recursive: true });
  return pino.destination({ dest: logPath, sync: true, mkdir: true });
}

/**
 * Wraps a synchronous daily file destination so it rotates to the next
 * day's file the moment the LOCAL calendar date changes, even mid-process —
 * a GM's server left running through an evening session is exactly the case
 * that crosses midnight.
 *
 * The date check runs on every `write()` call instead of on a timer: the
 * destination already sits on the hot path (`sync: true`, one write per log
 * line), so rotation piggybacks on writes that are happening anyway rather
 * than adding a second timer to the process. The check itself is one
 * `Date` allocation plus a string compare — negligible next to the
 * `fs.writeSync` the line was going to do regardless.
 *
 * No line is ever lost across a swap: with `sync: true`, every write already
 * reached the destination's file descriptor via a synchronous `fs.writeSync`
 * before `write()` returns (see sonic-boom's `write`/`actualWrite`), so by
 * the time a new day's file is opened, the previous file has nothing
 * pending — closing it (`destroy()`) discards no buffered data. `destroy()`
 * itself finishes its fsync/close asynchronously, but that's fine to not
 * await: the bytes are already written, only the close bookkeeping is left.
 *
 * If the new day's file cannot be opened OR cannot be written to (disk full,
 * a directory in the way), logging stays on the previous day's file —
 * degrading, like `tryCreateFileDestination`, rather than throwing — and
 * retries at most once per calendar day so a standing failure doesn't spam
 * stderr on every subsequent line. The first line of the new day is what
 * proves the new file writable, which is why the swap only commits after it
 * lands: an open that succeeds is not evidence that a write will.
 */
function wrapWithDailyRotation(
  dataDir: string,
  initialDate: Date,
  initialDest: FileDestination,
): pino.DestinationStream {
  let currentDateKey = localDateKey(initialDate);
  let currentDest = initialDest;
  let failedRotationDateKey: string | undefined;

  return {
    write(chunk: string): void {
      const now = new Date();
      const dateKey = localDateKey(now);
      if (dateKey !== currentDateKey && dateKey !== failedRotationDateKey) {
        try {
          const nextDest = openDailyDestination(dataDir, now);
          // Prove the new file is writable BEFORE closing the old one. Opening
          // succeeds on targets that only fail at write time — a full disk, or
          // a directory sitting where the file should be. Closing first and
          // discovering that afterwards would leave the process with no open
          // destination at all, and every later log line throwing, in the
          // middle of a session.
          try {
            nextDest.write(chunk);
          } catch (err) {
            try {
              nextDest.destroy();
            } catch {
              /* the destination is already unusable; nothing to salvage */
            }
            throw err;
          }
          const previous = currentDest;
          currentDest = nextDest;
          currentDateKey = dateKey;
          failedRotationDateKey = undefined;
          previous.destroy();
          return; // chunk already went to the new day's file
        } catch (err) {
          failedRotationDateKey = dateKey;
          process.stderr.write(
            `fusion: warning — could not rotate the log file to "${dailyLogFilePath(dataDir, now)}" ` +
              `(continuing to write to the previous day's file). ${String(err)}\n`,
          );
        }
      }
      currentDest.write(chunk);
    },
  };
}

/**
 * Best-effort file destination for today's log file, rotating daily. Returns
 * `undefined` (never throws) when the directory/file cannot be created or
 * opened — callers fall back to stdout-only logging in that case. A single
 * line is written to stdout via `process.stderr` (not the logger itself,
 * which may not exist yet) to surface the failure without ever being fatal.
 *
 * `sync: true` is used deliberately: boot-time log lines must survive even
 * if the process crashes immediately after — this is a low-volume log
 * (server lifecycle events), not a hot request-logging path, so the small
 * sync-write overhead is an acceptable trade for durability.
 */
function tryCreateFileDestination(dataDir: string): pino.DestinationStream | undefined {
  try {
    const now = new Date();
    const initialDest = openDailyDestination(dataDir, now);
    return wrapWithDailyRotation(dataDir, now, initialDest);
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
 * `<dataDir>/Logs/fusion-<YYYY-MM-DD>.log` (append, one file per LOCAL
 * calendar day — no size-based rotation) so the boot log survives if the
 * console window is closed or the process crashes. The file rotates mid-
 * process when local midnight passes, so a long-running session always logs
 * into the file matching the wall-clock date it happened on. Failure to open
 * the file never aborts boot: it degrades to stdout-only logging with a
 * one-line warning on stderr.
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
