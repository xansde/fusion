/**
 * Integration test for the M6 security-audit FIX-4 guard: `fusion serve
 * --tunnel` must refuse to start (exit 1, clear stderr message) while
 * setupCompleted=false on the target data directory.
 *
 * Runs the BUILT CLI (dist/cli/index.js) via child_process, same pattern as
 * world-commands.test.ts — this test only exercises the REJECTION path
 * (the process exits before ever attempting to boot Fastify or spawn
 * cloudflared), so it stays fast and never needs to kill a long-running
 * server process.
 */

import { describe, it, expect, vi } from "vitest";

// Cold Node child process spawn — same margin as world-commands.test.ts.
vi.setConfig({ testTimeout: 30_000 });

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SERVER_ROOT = resolve(__dirname, "..", "..", "..");
const CLI_ENTRY = join(SERVER_ROOT, "dist", "cli", "index.js");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], dataDir: string): RunResult {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args, "--data-dir", dataDir], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });

  if (result.error || result.status === null) {
    throw new Error(
      `CLI process did not exit cleanly: signal=${result.signal ?? "none"} error=${
        result.error ? result.error.message : "none"
      }\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }

  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-tunnel-guard-"));
  tempDirs.push(dir);
  return dir;
}

function afterEachCleanup(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("fusion serve --tunnel — FIX-4 CLI-level guard (setupCompleted required)", () => {
  it("exits 1 with a clear message when setupCompleted=false (fresh data dir)", () => {
    const dataDir = makeTempDataDir();
    try {
      const result = runCli(["serve", "--tunnel", "--port", "0"], dataDir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--tunnel");
      expect(result.stderr.toLowerCase()).toContain("setup");
      // Must never reach the boot/listen phase.
      expect(result.stdout).not.toContain("ready for connections");
    } finally {
      afterEachCleanup();
    }
  });

  it("exits 1 even when Config/fusion.json exists but setupCompleted is explicitly false", () => {
    const dataDir = makeTempDataDir();
    try {
      mkdirSync(join(dataDir, "Config"), { recursive: true });
      writeFileSync(
        join(dataDir, "Config", "fusion.json"),
        JSON.stringify({ setupCompleted: false, port: 33999 }),
        "utf8",
      );

      const result = runCli(["serve", "--tunnel"], dataDir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toLowerCase()).toContain("setup");
    } finally {
      afterEachCleanup();
    }
  });

  it("does NOT refuse plain `fusion serve` (no --tunnel) on a fresh, incomplete-setup data dir", () => {
    // Regression guard: the fix must only block --tunnel, never local serve.
    // We can't let a real long-running serve process run to completion in a
    // unit test, so this asserts indirectly: run with an invalid flag
    // combination that fails FAST after passing the tunnel guard (an
    // out-of-range --port), proving the tunnel guard itself did not fire
    // (its error text is absent) and the process reached normal CLI
    // validation instead.
    const dataDir = makeTempDataDir();
    try {
      const result = runCli(["serve", "--port", "999999"], dataDir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).not.toContain("--tunnel refused");
    } finally {
      afterEachCleanup();
    }
  });
});
