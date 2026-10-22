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

import { describe, it, expect } from "vitest";

import { runCli as runCliAsync } from "../helpers/run-cli.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const runCli = (args: string[], dataDir: string) => runCliAsync(args, dataDir, 60_000);

function makeTempDataDir(): string {
  return mkdtempSync(join(tmpdir(), "fusion-tunnel-guard-"));
}

// Each test removes only its own data dir: they run concurrently.
function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// Cold Node child process spawn — same margin as world-commands.test.ts.
describe.concurrent(
  "fusion serve --tunnel — FIX-4 CLI-level guard (setupCompleted required)",
  { timeout: 90_000 },
  () => {
    it("exits 1 with a clear message when setupCompleted=false (fresh data dir)", async () => {
      const dataDir = makeTempDataDir();
      try {
        const result = await runCli(["serve", "--tunnel", "--port", "0"], dataDir);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("--tunnel");
        expect(result.stderr.toLowerCase()).toContain("setup");
        // Must never reach the boot/listen phase.
        expect(result.stdout).not.toContain("ready for connections");
      } finally {
        cleanup(dataDir);
      }
    });

    it("exits 1 even when Config/fusion.json exists but setupCompleted is explicitly false", async () => {
      const dataDir = makeTempDataDir();
      try {
        mkdirSync(join(dataDir, "Config"), { recursive: true });
        writeFileSync(
          join(dataDir, "Config", "fusion.json"),
          JSON.stringify({ setupCompleted: false, port: 33999 }),
          "utf8",
        );

        const result = await runCli(["serve", "--tunnel"], dataDir);
        expect(result.exitCode).toBe(1);
        expect(result.stderr.toLowerCase()).toContain("setup");
      } finally {
        cleanup(dataDir);
      }
    });

    it("does NOT refuse plain `fusion serve` (no --tunnel) on a fresh, incomplete-setup data dir", async () => {
      // Regression guard: the fix must only block --tunnel, never local serve.
      // We can't let a real long-running serve process run to completion in a
      // unit test, so this asserts indirectly: run with an invalid flag
      // combination that fails FAST after passing the tunnel guard (an
      // out-of-range --port), proving the tunnel guard itself did not fire
      // (its error text is absent) and the process reached normal CLI
      // validation instead.
      const dataDir = makeTempDataDir();
      try {
        const result = await runCli(["serve", "--port", "999999"], dataDir);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).not.toContain("--tunnel refused");
      } finally {
        cleanup(dataDir);
      }
    });
  },
);
