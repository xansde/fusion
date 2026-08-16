/**
 * Tests for daily log-file rotation (logger.ts — T033).
 *
 * The bug: `dailyLogFilePath` used UTC (`toISOString().slice(0, 10)`) instead
 * of the local calendar day, and the destination it feeds was opened exactly
 * once per `createLogger()` call — so a server that stays up past local
 * midnight kept writing to the file it opened at boot, forever. Proven
 * against the real machine log at `C:/Users/xansd/.fusion/Logs/
 * fusion-2026-08-15.log`, which has `time` entries for both 2026-08-15 and
 * 2026-08-16 in the same file.
 *
 * These tests never touch the real clock or `~/.fusion` — the system time is
 * faked with vitest, `TZ` is pinned to `America/Sao_Paulo` (UTC-3, the
 * environment this bug was found in) for the duration of each test, and the
 * log directory is a fresh temp dir per test. The oracle is always the
 * actual file(s) on disk, read back with `readFileSync`/`readdirSync` —
 * never a call to `dailyLogFilePath` used as its own check.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";
import { createLogger } from "../logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanupDirs: string[] = [];
let originalTz: string | undefined;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-logger-rotation-"));
  cleanupDirs.push(dir);
  return dir;
}

/** Local-time instant, expressed by hand so the test reads as calendar time, not epoch math. */
function localInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // TZ is pinned to America/Sao_Paulo (UTC-3) in beforeEach, so the Date
  // constructor's local-time overload resolves against that fixed offset
  // regardless of the host machine actually running this test.
  return new Date(year, month - 1, day, hour, minute, 0);
}

beforeEach(() => {
  originalTz = process.env.TZ;
  process.env.TZ = "America/Sao_Paulo";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Mid-process rotation across local midnight
// ---------------------------------------------------------------------------

describe("daily rotation across local midnight", () => {
  it("splits lines written before and after local midnight into two local-dated files", () => {
    const dataDir = makeTempDir();

    vi.setSystemTime(localInstant(2026, 8, 15, 23, 0)); // 2026-08-15 23:00 local
    const logger = createLogger("info", dataDir);
    logger.info("before midnight");

    vi.setSystemTime(localInstant(2026, 8, 16, 0, 30)); // 2026-08-16 00:30 local, same process
    logger.info("after midnight");

    const logsDir = join(dataDir, "Logs");
    const files = readdirSync(logsDir).sort();
    expect(files).toEqual(["fusion-2026-08-15.log", "fusion-2026-08-16.log"]);

    const day15 = readFileSync(join(logsDir, "fusion-2026-08-15.log"), "utf8");
    expect(day15).toContain("before midnight");
    expect(day15).not.toContain("after midnight");

    const day16 = readFileSync(join(logsDir, "fusion-2026-08-16.log"), "utf8");
    expect(day16).toContain("after midnight");
    expect(day16).not.toContain("before midnight");
  });

  it("keeps writing to the same file for lines within the same local day", () => {
    const dataDir = makeTempDir();

    vi.setSystemTime(localInstant(2026, 8, 15, 10, 0));
    const logger = createLogger("info", dataDir);
    logger.info("morning");

    vi.setSystemTime(localInstant(2026, 8, 15, 22, 59));
    logger.info("night, same day");

    const logsDir = join(dataDir, "Logs");
    expect(readdirSync(logsDir)).toEqual(["fusion-2026-08-15.log"]);
    const content = readFileSync(join(logsDir, "fusion-2026-08-15.log"), "utf8");
    expect(content).toContain("morning");
    expect(content).toContain("night, same day");
  });
});

// ---------------------------------------------------------------------------
// UTC-3 boundary: local day D, UTC day D+1
// ---------------------------------------------------------------------------

describe("local date, not UTC date", () => {
  it("files an instant that is local-day-D-but-UTC-day-D+1 under D, not D+1", () => {
    const dataDir = makeTempDir();

    // 2026-08-15T23:30 local (America/Sao_Paulo, UTC-3) == 2026-08-16T02:30Z.
    // Naive UTC-based naming (the pre-fix bug) would file this under Aug 16.
    const instant = localInstant(2026, 8, 15, 23, 30);
    expect(instant.toISOString().slice(0, 10)).toBe("2026-08-16"); // sanity: really crosses the UTC boundary

    vi.setSystemTime(instant);
    const logger = createLogger("info", dataDir);
    logger.info("late local-Aug-15 line");

    const logsDir = join(dataDir, "Logs");
    expect(readdirSync(logsDir)).toEqual(["fusion-2026-08-15.log"]);
    const content = readFileSync(join(logsDir, "fusion-2026-08-15.log"), "utf8");
    expect(content).toContain("late local-Aug-15 line");
  });
});

// ---------------------------------------------------------------------------
// Restart safety: never touch what's already on disk
// ---------------------------------------------------------------------------

describe("restart safety", () => {
  it("appends to an existing local-dated file instead of truncating it, and never touches an old UTC-named file", () => {
    const dataDir = makeTempDir();
    const logsDir = join(dataDir, "Logs");
    mkdirSync(logsDir, { recursive: true });

    // A stray file the OLD (UTC-based) naming logic could have produced —
    // must survive untouched: rotation logic must never delete or rename it.
    writeFileSync(join(logsDir, "fusion-2026-08-16.log"), "stale utc-named line\n");
    // Today's local file, as if the process had already logged earlier and
    // then restarted — restart must append, not overwrite.
    writeFileSync(join(logsDir, "fusion-2026-08-15.log"), "line from before restart\n");

    vi.setSystemTime(localInstant(2026, 8, 15, 20, 0));
    const logger = createLogger("info", dataDir);
    logger.info("line after restart");

    const day15 = readFileSync(join(logsDir, "fusion-2026-08-15.log"), "utf8");
    expect(day15).toContain("line from before restart");
    expect(day15).toContain("line after restart");

    const day16 = readFileSync(join(logsDir, "fusion-2026-08-16.log"), "utf8");
    expect(day16).toBe("stale utc-named line\n");
  });
});

// ---------------------------------------------------------------------------
// Failed rotation: degrade, never take logging down mid-session
// ---------------------------------------------------------------------------

describe("failed rotation", () => {
  it("keeps logging to the previous day's file when the new day's file cannot be written", () => {
    const dataDir = makeTempDir();
    const logsDir = join(dataDir, "Logs");
    mkdirSync(logsDir, { recursive: true });

    // A DIRECTORY where tomorrow's log file should go. Opening it succeeds on
    // this platform; the failure only shows up on write (EISDIR) — which is
    // exactly the shape of a full disk, and the reason the swap cannot commit
    // on a successful open alone.
    mkdirSync(join(logsDir, "fusion-2026-08-16.log"));

    vi.setSystemTime(localInstant(2026, 8, 15, 23, 0));
    const logger = createLogger("info", dataDir);
    logger.info("before midnight");

    vi.setSystemTime(localInstant(2026, 8, 16, 0, 30));
    // The whole point: this must not throw. A GM mid-session does not lose the
    // server because tomorrow's log file could not be opened.
    expect(() => {
      logger.info("after midnight, degraded");
      logger.info("still alive");
    }).not.toThrow();

    const day15 = readFileSync(join(logsDir, "fusion-2026-08-15.log"), "utf8");
    expect(day15).toContain("before midnight");
    expect(day15).toContain("after midnight, degraded");
    expect(day15).toContain("still alive");
  });
});
