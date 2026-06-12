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

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

// Each test spawns the real CLI as a cold Node child process (several per
// test for roundtrips); under concurrent suite load these legitimately take
// far longer than the package default of 30s.
vi.setConfig({ testTimeout: 120_000 });
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Path to the built CLI entry point
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// Walk up: __tests__/cli → __tests__ → src → packages/server
const SERVER_ROOT = resolve(__dirname, "..", "..", "..");
const CLI_ENTRY = join(SERVER_ROOT, "dist", "cli", "index.js");

// ---------------------------------------------------------------------------
// Helper: run the CLI synchronously
// ---------------------------------------------------------------------------

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], dataDir: string): RunResult {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args, "--data-dir", dataDir], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      // Suppress pino pretty-print / colour codes in CI
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });

  // A null status means the child was killed (timeout) or failed to spawn.
  // Surface that loudly instead of masking it as a logic failure (exit 1).
  if (result.error || result.status === null) {
    throw new Error(
      `CLI process did not exit cleanly: signal=${result.signal ?? "none"} error=${
        result.error ? result.error.message : "none"
      }`,
    );
  }

  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

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

afterEach(() => {
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

describe("CLI — world commands", () => {
  // -------------------------------------------------------------------------
  // world list — empty data directory
  // -------------------------------------------------------------------------

  it("world list on empty data dir exits 0 and prints 'No worlds found'", () => {
    const dataDir = makeTempDir();
    const res = runCli(["world", "list"], dataDir);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("No worlds found");
  });

  // -------------------------------------------------------------------------
  // world create — success
  // -------------------------------------------------------------------------

  it("world create exits 0 and prints the world slug", () => {
    const dataDir = makeTempDir();
    const res = runCli(
      ["world", "create", "test_world", "--system", "stub", "--title", "Test World"],
      dataDir,
    );

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("World created successfully");
    expect(res.stdout).toContain("test_world");
    expect(res.stdout).toContain("Test World");
  });

  // -------------------------------------------------------------------------
  // create → list → backup roundtrip
  // -------------------------------------------------------------------------

  it("create → list → backup roundtrip succeeds with exit code 0", () => {
    const dataDir = makeTempDir();

    // 1. Create
    const createRes = runCli(
      ["world", "create", "my_campaign", "--system", "stub", "--title", "My Campaign"],
      dataDir,
    );
    expect(createRes.exitCode).toBe(0);

    // 2. List — world should appear
    const listRes = runCli(["world", "list"], dataDir);
    expect(listRes.exitCode).toBe(0);
    expect(listRes.stdout).toContain("my_campaign");
    expect(listRes.stdout).toContain("My Campaign");
    expect(listRes.stdout).toContain("stub");

    // 3. Backup
    const backupRes = runCli(["world", "backup", "my_campaign"], dataDir);
    expect(backupRes.exitCode).toBe(0);
    expect(backupRes.stdout).toContain("Backup created successfully");
    expect(backupRes.stdout).toContain("manual-");
  });

  // -------------------------------------------------------------------------
  // Error: invalid slug
  // -------------------------------------------------------------------------

  it("world create with invalid slug exits 1 and prints error to stderr", () => {
    const dataDir = makeTempDir();
    const res = runCli(["world", "create", "INVALID SLUG!", "--system", "stub"], dataDir);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Error: unknown system ID
  // -------------------------------------------------------------------------

  it("world create with unknown system exits 1 and reports the error", () => {
    const dataDir = makeTempDir();
    const res = runCli(
      ["world", "create", "valid_slug", "--system", "nonexistent_system_xyz"],
      dataDir,
    );

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Error: duplicate slug
  // -------------------------------------------------------------------------

  it("creating a world with a duplicate slug exits 1 with a meaningful error", () => {
    const dataDir = makeTempDir();

    const firstRes = runCli(["world", "create", "dupe", "--system", "stub"], dataDir);
    expect(firstRes.exitCode).toBe(0);

    const secondRes = runCli(["world", "create", "dupe", "--system", "stub"], dataDir);
    expect(secondRes.exitCode).toBe(1);
    expect(secondRes.stderr).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Error: backup of non-existent world
  // -------------------------------------------------------------------------

  it("world backup on non-existent slug exits 1", () => {
    const dataDir = makeTempDir();
    const res = runCli(["world", "backup", "ghost_world"], dataDir);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Multiple worlds — list shows all
  // -------------------------------------------------------------------------

  it("world list shows all worlds when multiple exist", () => {
    const dataDir = makeTempDir();

    runCli(["world", "create", "alpha", "--system", "stub", "--title", "Alpha"], dataDir);
    runCli(["world", "create", "beta", "--system", "stub", "--title", "Beta"], dataDir);

    const listRes = runCli(["world", "list"], dataDir);
    expect(listRes.exitCode).toBe(0);
    expect(listRes.stdout).toContain("alpha");
    expect(listRes.stdout).toContain("beta");
    expect(listRes.stdout).toContain("2 world(s)");
  });

  // -------------------------------------------------------------------------
  // Help flags
  // -------------------------------------------------------------------------

  it("fusion --help exits 0 and prints usage", () => {
    const dataDir = makeTempDir();
    const res = runCli(["--help"], dataDir);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("USAGE");
  });

  it("fusion world create --help exits 0 and prints usage", () => {
    const dataDir = makeTempDir();
    const res = runCli(["world", "create", "--help"], dataDir);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("USAGE");
  });

  // -------------------------------------------------------------------------
  // Missing required flags
  // -------------------------------------------------------------------------

  it("world create without --system exits 1 with parse error in stderr", () => {
    const dataDir = makeTempDir();
    const res = runCli(["world", "create", "my_world"], dataDir);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("--system");
  });

  it("unknown top-level command exits 1", () => {
    const dataDir = makeTempDir();
    const res = runCli(["banana"], dataDir);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBeTruthy();
  });
});
