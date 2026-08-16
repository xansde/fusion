/**
 * Tests for the structured logger (logger.ts).
 *
 * Covers:
 *  - createLogger(logLevel) without dataDir: stdout-only (existing behavior).
 *  - createLogger(logLevel, dataDir): also writes to
 *    <dataDir>/Logs/fusion-<YYYY-MM-DD>.log, containing the logged lines.
 *  - A read-only/unwritable Logs/ directory degrades to stdout-only logging
 *    instead of throwing — boot must never fail because the log file could
 *    not be opened.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { platform } from "node:os";
import { createLogger, dailyLogFilePath } from "../logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanupDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    try {
      // Best-effort: restore write perms in case a permission test left the
      // dir locked down, so rmSync can actually clean it up.
      chmodSync(dir, 0o777);
    } catch {
      // ignore
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// dailyLogFilePath
// ---------------------------------------------------------------------------

describe("dailyLogFilePath", () => {
  // The date in the name is the LOCAL calendar day (T033), so this assertion
  // only states a fact once TZ is pinned — otherwise it silently becomes a
  // claim about whatever machine runs it, and flips at UTC+11 and beyond.
  let originalTz: string | undefined;

  beforeEach(() => {
    originalTz = process.env.TZ;
    process.env.TZ = "America/Sao_Paulo";
  });

  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it("builds <dataDir>/Logs/fusion-<YYYY-MM-DD>.log from the local calendar day", () => {
    const path = dailyLogFilePath("/data", new Date("2026-07-03T12:00:00Z"));
    expect(path).toBe(join("/data", "Logs", "fusion-2026-07-03.log"));
  });

  it("uses the local day, not the UTC day, when the two disagree", () => {
    // 2026-07-03T02:00Z is still 2026-07-02 in America/Sao_Paulo (UTC-3).
    const path = dailyLogFilePath("/data", new Date("2026-07-03T02:00:00Z"));
    expect(path).toBe(join("/data", "Logs", "fusion-2026-07-02.log"));
  });
});

// ---------------------------------------------------------------------------
// createLogger without dataDir — stdout-only (unchanged behavior)
// ---------------------------------------------------------------------------

describe("createLogger without dataDir", () => {
  it("returns a working logger with no file destination", () => {
    const logger = createLogger("silent");
    expect(() => logger.info("hello")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createLogger with dataDir — file logging (the file-log fix)
// ---------------------------------------------------------------------------

describe("createLogger with dataDir", () => {
  it("creates Logs/fusion-<date>.log and writes logged lines to it", () => {
    const dataDir = makeTempDir("fusion-logger-test-");
    const logger = createLogger("info", dataDir);

    logger.info({ phase: "config" }, "Boot phase: config — loaded");
    logger.info("Server listening");

    const logPath = dailyLogFilePath(dataDir);
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf8");
    expect(content).toContain("Boot phase: config — loaded");
    expect(content).toContain("Server listening");
    expect(content).toContain('"pkg":"@fusion/server"');

    // Each line is valid JSON (newline-delimited JSON, same shape as stdout).
    const lines = content.trim().split("\n");
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("creates the Logs/ directory if it does not exist yet", () => {
    const dataDir = makeTempDir("fusion-logger-test-");
    expect(existsSync(join(dataDir, "Logs"))).toBe(false);

    createLogger("info", dataDir);

    expect(existsSync(join(dataDir, "Logs"))).toBe(true);
  });

  it("is idempotent across multiple loggers targeting the same dataDir/day", () => {
    const dataDir = makeTempDir("fusion-logger-test-");
    const loggerA = createLogger("info", dataDir);
    loggerA.info("first line");
    const loggerB = createLogger("info", dataDir);
    loggerB.info("second line");

    const content = readFileSync(dailyLogFilePath(dataDir), "utf8");
    expect(content).toContain("first line");
    expect(content).toContain("second line");
  });

  // chmod-based permission denial is not reliable on Windows (no POSIX
  // write-bit enforcement for the file owner), so this test only runs on
  // platforms where it can actually simulate the failure.
  it.skipIf(platform() === "win32")(
    "falls back to stdout-only logging (never throws) when Logs/ is unwritable",
    () => {
      const dataDir = makeTempDir("fusion-logger-test-");
      mkdirSync(join(dataDir, "Logs"), { recursive: true });
      chmodSync(join(dataDir, "Logs"), 0o444); // read-only

      let logger: ReturnType<typeof createLogger> | undefined;
      expect(() => {
        logger = createLogger("info", dataDir);
      }).not.toThrow();
      expect(() => logger?.info("should not crash")).not.toThrow();
    },
  );
});
