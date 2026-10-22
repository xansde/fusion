/**
 * Integration tests for CLI world commands.
 *
 * Runs the BUILT CLI (dist/cli/index.js) via child_process so we test the
 * real Node.js module resolution and shebang.  Tests require a prior build:
 *   pnpm --filter @fusion/server build
 *
 * Covered scenarios:
 *  - world create → list → backup roundtrip
 *  - error: invalid slug
 *  - error: unknown system ID
 *  - error: duplicate world slug
 *  - world list on empty data dir
 *
 * Each test uses its own isolated temp directory so there are no
 * cross-test interactions.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { CLI_ENTRY, runCli } from "../helpers/run-cli.js";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Path to the built CLI entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Temp dir lifecycle
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-cli-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

// afterAll, not afterEach: the tests run concurrently, and an afterEach would
// delete the data dirs of tests still running.
afterAll(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

// ---------------------------------------------------------------------------
// Guard: skip tests if the CLI has not been built yet
// ---------------------------------------------------------------------------

beforeAll(() => {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(
      `CLI entry not found at ${CLI_ENTRY}. ` +
        `Run 'pnpm --filter @fusion/server build' before running these tests.`,
    );
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Concurrent: every test has its own data dir, and the cost is the CLI's cold
// start (seconds per spawn) — running them side by side divides the wall-clock.
// Each test spawns the real CLI as a cold Node child process (several per
// test for roundtrips); under concurrent suite load these legitimately take
// far longer than the package default of 30s.
describe.concurrent("CLI — world commands", { timeout: 120_000 }, () => {
  // -------------------------------------------------------------------------
  // world list — empty data directory
  // -------------------------------------------------------------------------

  it("world list on empty data dir exits 0 and prints 'No worlds found'", async () => {
    const dataDir = makeTempDir();
    const res = await runCli(["world", "list"], dataDir);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("No worlds found");
  });

  // -------------------------------------------------------------------------
  // create → list → backup roundtrip
  // -------------------------------------------------------------------------

  // world create's own output, a second world, list showing both, and a backup
  // — one data dir, one sequence. (Fused from three tests that each paid the
  // CLI's cold start for the same create: "world create exits 0 and prints the
  // world slug", "world list shows all worlds when multiple exist" and this
  // roundtrip; every assertion of the three is kept.)
  it("create → list → backup roundtrip succeeds with exit code 0, and list shows every world", async () => {
    const dataDir = makeTempDir();

    // 1. Create — prints success, slug and title
    const createRes = await runCli(
      ["world", "create", "my_campaign", "--system", "stub", "--title", "My Campaign"],
      dataDir,
    );
    expect(createRes.exitCode).toBe(0);
    expect(createRes.stdout).toContain("World created successfully");
    expect(createRes.stdout).toContain("my_campaign");
    expect(createRes.stdout).toContain("My Campaign");

    const secondRes = await runCli(
      ["world", "create", "beta", "--system", "stub", "--title", "Beta"],
      dataDir,
    );
    expect(secondRes.exitCode).toBe(0);

    // 2. List — both worlds appear
    const listRes = await runCli(["world", "list"], dataDir);
    expect(listRes.exitCode).toBe(0);
    expect(listRes.stdout).toContain("my_campaign");
    expect(listRes.stdout).toContain("My Campaign");
    expect(listRes.stdout).toContain("stub");
    expect(listRes.stdout).toContain("beta");
    expect(listRes.stdout).toContain("2 world(s)");

    // 3. Backup
    const backupRes = await runCli(["world", "backup", "my_campaign"], dataDir);
    expect(backupRes.exitCode).toBe(0);
    expect(backupRes.stdout).toContain("Backup created successfully");
    expect(backupRes.stdout).toContain("manual-");
  });

  // -------------------------------------------------------------------------
  // Error: invalid slug
  // -------------------------------------------------------------------------

  it("world create with invalid slug exits 1 and prints error to stderr", async () => {
    const dataDir = makeTempDir();
    const res = await runCli(["world", "create", "INVALID SLUG!", "--system", "stub"], dataDir);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Error: unknown system ID
  // -------------------------------------------------------------------------

  it("world create with unknown system exits 1 and reports the error", async () => {
    const dataDir = makeTempDir();
    const res = await runCli(
      ["world", "create", "valid_slug", "--system", "nonexistent_system_xyz"],
      dataDir,
    );

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Error: duplicate slug
  // -------------------------------------------------------------------------

  it("creating a world with a duplicate slug exits 1 with a meaningful error", async () => {
    const dataDir = makeTempDir();

    const firstRes = await runCli(["world", "create", "dupe", "--system", "stub"], dataDir);
    expect(firstRes.exitCode).toBe(0);

    const secondRes = await runCli(["world", "create", "dupe", "--system", "stub"], dataDir);
    expect(secondRes.exitCode).toBe(1);
    expect(secondRes.stderr).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Error: backup of non-existent world
  // -------------------------------------------------------------------------

  it("world backup on non-existent slug exits 1", async () => {
    const dataDir = makeTempDir();
    const res = await runCli(["world", "backup", "ghost_world"], dataDir);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Help flags
  // -------------------------------------------------------------------------

  it("fusion --help exits 0 and prints usage", async () => {
    const dataDir = makeTempDir();
    const res = await runCli(["--help"], dataDir);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("USAGE");
  });

  it("fusion world create --help exits 0 and prints world-create-specific usage (not the generic root usage)", async () => {
    const dataDir = makeTempDir();
    const res = await runCli(["world", "create", "--help"], dataDir);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("fusion world create — Create a new world");
    expect(res.stdout).toContain("--system <id>");
    // Regression guard: a prior bug made every subcommand's --help collapse
    // into the generic root usage, which also contains "USAGE" — so this
    // must assert content that is UNIQUE to the "world create" topic.
    expect(res.stdout).not.toContain("COMMANDS\n");
  });

  // -------------------------------------------------------------------------
  // Missing required flags
  // -------------------------------------------------------------------------

  it("world create without --system exits 1 with parse error in stderr", async () => {
    const dataDir = makeTempDir();
    const res = await runCli(["world", "create", "my_world"], dataDir);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("--system");
  });

  it("unknown top-level command exits 1", async () => {
    const dataDir = makeTempDir();
    const res = await runCli(["banana"], dataDir);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBeTruthy();
  });
});
