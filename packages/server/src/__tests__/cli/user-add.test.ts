/**
 * Integration test for `fusion user add`.
 *
 * C2 (o6b fixer, revisão adversarial): `runUserAdd` called `userStore.create`
 * directly, bypassing `AuthService.createUser` — so a PLAYER/TRUSTED user
 * created via the CLI (documented in README.md) never got the blank
 * `character` Actor that REQ-USR-025/025a/025b/025c guarantees for the same
 * roles when created through the HTTP admin route. That user had no way to
 * reach the builder: REQ-CFG-051a forbids a "create character" button in
 * Settings → Users, NPCs never creates a `character` type (DEC-NPC-02), and
 * the player's own `doc:create` was removed (C5/C6).
 *
 * Runs the BUILT CLI (dist/cli/index.js), same pattern as
 * world-commands.test.ts, then opens the resulting world.db directly to
 * assert on the Actor the CLI command should have created alongside the
 * user row — a non-circular assertion: it checks against REQ-USR-025's
 * contract (blank character Actor, ownership.default=none, new user as
 * sole OWNER), not against the CLI's own output.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
// Each test spawns the real CLI as a cold Node child process (two per test:
// world create + user add); under concurrent suite load these legitimately
// take longer than the package default of 30s (see world-commands.test.ts).
vi.setConfig({ testTimeout: 120_000 });
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { openDatabase, applyMigrations } from "../../db/index.js";
import { DocumentStore } from "../../documents/store.js";
import { UserStore } from "../../auth/user-store.js";
import { OwnershipLevel } from "@fusion/shared";

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
    timeout: 30_000,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });

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

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `fusion-cli-user-add-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
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

beforeAll(() => {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(
      `CLI entry not found at ${CLI_ENTRY}. ` +
        `Run 'pnpm --filter @fusion/server build' before running these tests.`,
    );
  }
});

describe("CLI — user add (C2, REQ-USR-025 via CLI)", () => {
  it("fusion user add --role PLAYER creates a blank character Actor owned by the new user", () => {
    const dataDir = makeTempDir();

    const createRes = runCli(
      ["world", "create", "cli_user_add_world", "--system", "stub", "--title", "CLI User Add"],
      dataDir,
    );
    expect(createRes.exitCode).toBe(0);

    const addRes = runCli(
      [
        "user",
        "add",
        "cli_user_add_world",
        "Ana",
        "--role",
        "PLAYER",
        "--password",
        "correct horse battery staple",
      ],
      dataDir,
    );
    expect(addRes.exitCode).toBe(0);

    const dbPath = join(dataDir, "worlds", "cli_user_add_world", "world.db");
    const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);
    try {
      const userStore = new UserStore(fusionDb.raw);
      const ana = userStore.findByName("Ana");
      expect(ana).not.toBeNull();

      const documents = new DocumentStore({ db: fusionDb.raw });
      const actors = documents.getAll("actors", { type: "character" });
      const anaActor = actors.find(
        (a) => (a as { flags?: { fusion?: { playerId?: string } } }).flags?.fusion?.playerId === ana!.id,
      ) as
        | {
            name: string;
            type: string;
            ownership: Record<string, number>;
          }
        | undefined;

      expect(anaActor).toBeDefined();
      expect(anaActor?.name).toBe("Ana");
      // REQ-USR-025a: default=none, the new user is the sole OWNER.
      expect(anaActor?.ownership.default).toBe(OwnershipLevel.NONE);
      expect(anaActor?.ownership[ana!.id]).toBe(OwnershipLevel.OWNER);
    } finally {
      fusionDb.close();
    }
  });

  it("fusion user add --role GAMEMASTER creates no character Actor (DEC-USR-01, privileged role)", () => {
    const dataDir = makeTempDir();

    const createRes = runCli(
      ["world", "create", "cli_user_add_gm_world", "--system", "stub", "--title", "CLI GM Add"],
      dataDir,
    );
    expect(createRes.exitCode).toBe(0);

    const addRes = runCli(
      [
        "user",
        "add",
        "cli_user_add_gm_world",
        "Bruno",
        "--role",
        "GAMEMASTER",
        "--password",
        "correct horse battery staple",
      ],
      dataDir,
    );
    expect(addRes.exitCode).toBe(0);

    const dbPath = join(dataDir, "worlds", "cli_user_add_gm_world", "world.db");
    const fusionDb = openDatabase({ path: dbPath, skipIntegrityCheck: true });
    applyMigrations(fusionDb.raw, dbPath);
    try {
      const userStore = new UserStore(fusionDb.raw);
      const bruno = userStore.findByName("Bruno");
      expect(bruno).not.toBeNull();

      const documents = new DocumentStore({ db: fusionDb.raw });
      const actors = documents.getAll("actors", { type: "character" });
      const brunoActor = actors.find(
        (a) =>
          (a as { flags?: { fusion?: { playerId?: string } } }).flags?.fusion?.playerId ===
          bruno!.id,
      );
      expect(brunoActor).toBeUndefined();
    } finally {
      fusionDb.close();
    }
  });
});
