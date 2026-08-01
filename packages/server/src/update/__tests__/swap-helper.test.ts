/**
 * Tests for the swap-helper relauncher script (M6/B5 — REQ-DST-023/024,
 * DA-06). Exercises the ACTUAL generated script (via `node <script>.mjs`,
 * dev-mode invocation — see swap-helper.ts's module doc comment "WHO RUNS
 * THE HELPER SCRIPT") against two fake "exe" files (node scripts standing
 * in for the old/new binaries), verifying:
 *   - the helper waits for the "main" pid to exit before touching anything
 *   - a successful swap renames current->`.bak`, moves new->current, and
 *     relaunches the new binary
 *   - a crash-on-boot of the relaunched binary triggers rollback: `.bak`
 *     is restored and the ORIGINAL binary is relaunched instead
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { platform as osPlatform } from "node:os";
import { spawn as nodeSpawn, execFileSync, type ChildProcess } from "node:child_process";
import {
  buildSwapHelperScript,
  scheduleSwap,
  cleanupOrphanedBackup,
  type OrphanBackupCleanupResult,
  type SwapPlan,
  POST_SWAP_WATCH_MS,
} from "../swap-helper.js";

/**
 * Windows-only test. The packaged Fusion binary only ships for Windows, and
 * the cases below assert Windows-specific semantics (path separators,
 * synchronous spawn failures, applyUpdate's platform gate), which cannot hold
 * on POSIX — the CI runner is Linux.
 */
const itWin = it.skipIf(process.platform !== "win32");

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_EXE = join(__dirname, "fixtures", "fake-exe.mjs");

const tempDirs: string[] = [];
const spawnedChildren: ChildProcess[] = [];
/** PIDs of RELAUNCHED processes (spawned by the swap-helper script itself, not directly by this test) — see markerPidsToKill's usage below. */
const markerPidsToKill: number[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-swap-helper-"));
  tempDirs.push(dir);
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(intervalMs);
  }
  if (!predicate()) {
    throw new Error("waitFor: timed out");
  }
}

/** Extract every `pid=<n>` recorded by fake-exe.mjs's marker file (one per process start it observed). */
function extractMarkerPids(markerContent: string): number[] {
  const pids: number[] = [];
  for (const match of markerContent.matchAll(/pid=(\d+)/g)) {
    const pid = Number(match[1]);
    if (Number.isFinite(pid)) pids.push(pid);
  }
  return pids;
}

function killPidBestEffort(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already dead — fine.
  }
}

/**
 * Makes `filePath` non-renameable/non-deletable by the current user, so a
 * `renameSync(filePath, ...)` on it fails with EPERM — used by the FIX-1
 * regression test below to force the swap-helper's SECOND rename (new ->
 * current) to fail deterministically, without needing a real cross-device
 * (EXDEV) mount or an actual antivirus lock.
 *
 * Platform-specific because Windows' `chmod` only ever toggles the
 * readonly FILE_ATTRIBUTE (does NOT block rename/delete — verified
 * experimentally), while POSIX chmod on the file's own mode bits does not
 * govern rename/unlink either (that is governed by the PARENT directory's
 * write permission) — so each platform needs its own real access-control
 * mechanism:
 *   - Windows: `icacls` DENY of Delete/Write-Data/Delete-Child directly on
 *     the file (rename requires delete access on the source in the NTFS
 *     model).
 *   - POSIX: strip write permission from the file's PARENT directory
 *     (rename/unlink require write+execute on the containing directory,
 *     not on the file itself).
 */
function denyRenameAccess(filePath: string): void {
  if (osPlatform() === "win32") {
    execFileSync(
      "icacls",
      [filePath, "/deny", `${process.env["USERNAME"] ?? "Everyone"}:(D,WD,DE)`],
      {
        stdio: "pipe",
      },
    );
  } else {
    chmodSync(dirname(filePath), 0o555);
  }
}

/** Undoes {@link denyRenameAccess} so temp-dir cleanup in afterEach can proceed. */
function restoreRenameAccess(filePath: string): void {
  try {
    if (osPlatform() === "win32") {
      execFileSync("icacls", [filePath, "/reset"], { stdio: "pipe" });
    } else {
      chmodSync(dirname(filePath), 0o755);
    }
  } catch {
    // best-effort — a leftover restrictive ACL/mode is only a cleanup nuisance.
  }
}

afterEach(async () => {
  for (const child of spawnedChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
    }
  }
  // Kill any RELAUNCHED (grandchild, detached) processes the swap-helper
  // itself spawned — these hold a Windows file-lock on their own .mjs
  // "binary" and the tmp dir it lives in, which would otherwise make the
  // rmSync below intermittently fail with EBUSY.
  for (const pid of markerPidsToKill.splice(0)) {
    killPidBestEffort(pid);
  }
  // Give Windows a brief moment to release file handles after the kill
  // signal above before attempting to remove the directory tree.
  await sleep(200);
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort — a leftover temp dir from a stubborn file lock is
      // harmless (OS temp cleanup eventually reclaims it) and must not fail
      // an otherwise-passing test.
    }
  }
});

/**
 * Spawn a "main process" placeholder we fully control the lifetime of
 * (a trivial long-running node -e), standing in for the real Fusion server
 * process whose PID the helper polls for exit.
 */
function spawnFakeMainProcess(): ChildProcess {
  const child = nodeSpawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    stdio: "ignore",
  });
  spawnedChildren.push(child);
  return child;
}

describe("buildSwapHelperScript + scheduleSwap (dev-mode invocation)", () => {
  it("waits for the main pid to exit, then swaps and relaunches the new binary", async () => {
    const dir = makeTempDir();
    const currentExePath = join(dir, "current-exe.mjs");
    const newExePath = join(dir, "new-exe.mjs");
    const backupExePath = join(dir, "current-exe.mjs.bak");
    const markerPath = join(dir, "marker.log");

    copyFileSync(FAKE_EXE, currentExePath);
    copyFileSync(FAKE_EXE, newExePath);

    const mainProcess = spawnFakeMainProcess();

    const plan: SwapPlan = {
      mainPid: mainProcess.pid ?? -1,
      currentExePath,
      newExePath,
      backupExePath,
      relaunchArgs: [markerPath, "stay-alive"],
      cwd: dir,
      logPath: join(dir, "swap-helper.log"),
      // Windows cannot directly execute a .mjs "binary" (spawn EFTYPE) —
      // relaunch via `node <currentExePath> ...args` instead. See
      // SwapPlan.relaunchCommand's doc comment; production omits this
      // entirely (the real currentExePath is a directly-executable .exe).
      relaunchCommand: process.execPath,
    };

    const { scriptPath } = scheduleSwap({
      plan,
      runtimeDir: dir,
      spawnImpl: ((cmd: string, args: readonly string[], opts: unknown) => {
        const child = nodeSpawn(cmd, args as string[], opts as never);
        spawnedChildren.push(child);
        return child;
      }) as typeof nodeSpawn,
      invocation: { execPath: process.execPath, seaFlag: false },
    });

    expect(existsSync(scriptPath)).toBe(true);

    // Kill the "main process" so the helper proceeds with the swap.
    mainProcess.kill();

    // Wait for the swap to complete: current-exe.mjs.bak should appear
    // (old binary renamed away) and the marker should record a start from
    // the (now-relocated) currentExePath.
    await waitFor(() => existsSync(backupExePath), 8000);
    await waitFor(() => existsSync(markerPath), 8000);

    // Give the post-swap watch window time to elapse so the helper reaches
    // its "update succeeded, remove backup" branch.
    await sleep(POST_SWAP_WATCH_MS + 1000);

    const markerContent = readFileSync(markerPath, "utf8");
    markerPidsToKill.push(...extractMarkerPids(markerContent));
    expect(markerContent).toContain("started");
    expect(markerContent).toContain("mode=stay-alive");

    // The relaunched process's own argv[1] (process.argv[1] as observed
    // inside fake-exe.mjs) must be the CURRENT exe path post-swap — i.e.
    // the NEW binary's content is now running from the OLD path.
    expect(markerContent).toContain(currentExePath);

    // Successful update watch window elapsed without a crash -> backup removed.
    expect(existsSync(backupExePath)).toBe(false);
  }, 20000);

  it("rolls back to the original binary when the relaunched (new) binary crashes on boot (REQ-DST-024)", async () => {
    const dir = makeTempDir();
    const currentExePath = join(dir, "current-exe.mjs");
    const newExePath = join(dir, "new-exe-broken.mjs");
    const backupExePath = join(dir, "current-exe.mjs.bak");
    const markerPath = join(dir, "marker.log");

    copyFileSync(FAKE_EXE, currentExePath);
    copyFileSync(FAKE_EXE, newExePath);

    const mainProcess = spawnFakeMainProcess();

    const plan: SwapPlan = {
      mainPid: mainProcess.pid ?? -1,
      currentExePath,
      newExePath,
      backupExePath,
      // "crash" mode makes the relaunched process exit(1) immediately,
      // simulating a broken update build.
      relaunchArgs: [markerPath, "crash"],
      cwd: dir,
      logPath: join(dir, "swap-helper.log"),
      relaunchCommand: process.execPath,
    };

    const { scriptPath } = scheduleSwap({
      plan,
      runtimeDir: dir,
      spawnImpl: ((cmd: string, args: readonly string[], opts: unknown) => {
        const child = nodeSpawn(cmd, args as string[], opts as never);
        spawnedChildren.push(child);
        return child;
      }) as typeof nodeSpawn,
      invocation: { execPath: process.execPath, seaFlag: false },
    });

    expect(existsSync(scriptPath)).toBe(true);

    mainProcess.kill();

    // Wait for the log to report the rollback branch.
    const logPath = join(dir, "swap-helper.log");
    await waitFor(
      () => existsSync(logPath) && readFileSync(logPath, "utf8").includes("rolling back"),
      10000,
    );

    // Give the rollback's own relaunch (of the ORIGINAL binary, in
    // stay-alive-equivalent "crash" mode args reused — but rollback
    // relaunches with the SAME relaunchArgs, so it will also crash; what
    // matters here is the file-system end state, not whether it stays up)
    // a moment to happen.
    await sleep(500);

    // After rollback: backupExePath should be gone (renamed back onto
    // currentExePath), and currentExePath must exist (the original binary
    // restored).
    expect(existsSync(backupExePath)).toBe(false);
    expect(existsSync(currentExePath)).toBe(true);

    const logContent = readFileSync(logPath, "utf8");
    expect(logContent).toContain("rollback complete");
  }, 20000);

  itWin(
    "rolls back when the new binary throws SYNCHRONOUSLY on spawn (Windows spawn UNKNOWN/EACCES, REQ-DST-024)",
    async () => {
      // Reproduces the reported bug: on Windows, spawn() of an
      // invalid/non-executable file throws SYNCHRONOUSLY (not just an async
      // "error" event) — e.g. "spawn UNKNOWN" or EACCES. Without a try/catch
      // around the first relaunch() call, that throw propagates out of
      // main(), only main().catch's FATAL log runs, and the helper dies
      // BEFORE reaching the watch-window/rollback logic — leaving the broken
      // binary swapped into currentExePath and the .bak orphaned.
      //
      // We reproduce the synchronous-throw condition by omitting
      // relaunchCommand (so relaunch() spawns currentExePath DIRECTLY, the
      // real production shape) while the "new" binary swapped into place is
      // not something Windows can execute directly (a plain .mjs file with no
      // registered file-type association) — spawn() throws EFTYPE/UNKNOWN
      // synchronously for this on Windows, same failure class as a
      // corrupt/blocked exe.
      const dir = makeTempDir();
      const currentExePath = join(dir, "current-exe.mjs");
      const newExePath = join(dir, "new-exe-unspawnable.mjs");
      const backupExePath = join(dir, "current-exe.mjs.bak");

      copyFileSync(FAKE_EXE, currentExePath);
      copyFileSync(FAKE_EXE, newExePath);

      const mainProcess = spawnFakeMainProcess();

      const plan: SwapPlan = {
        mainPid: mainProcess.pid ?? -1,
        currentExePath,
        newExePath,
        backupExePath,
        relaunchArgs: [],
        cwd: dir,
        logPath: join(dir, "swap-helper.log"),
        // Deliberately NO relaunchCommand override here — this is what makes
        // relaunch() spawn currentExePath directly (production shape) instead
        // of via `node <script>`, reproducing the synchronous-throw path.
      };

      const { scriptPath } = scheduleSwap({
        plan,
        runtimeDir: dir,
        spawnImpl: ((cmd: string, args: readonly string[], opts: unknown) => {
          const child = nodeSpawn(cmd, args as string[], opts as never);
          spawnedChildren.push(child);
          return child;
        }) as typeof nodeSpawn,
        invocation: { execPath: process.execPath, seaFlag: false },
      });

      expect(existsSync(scriptPath)).toBe(true);

      mainProcess.kill();

      const logPath = join(dir, "swap-helper.log");

      // Load-bearing assertion: the helper must reach the rollback branch
      // (not die silently on an uncaught synchronous spawn throw).
      await waitFor(
        () => existsSync(logPath) && readFileSync(logPath, "utf8").includes("rolling back"),
        10000,
      );

      await sleep(500);

      // After rollback: backupExePath must be gone (restored onto
      // currentExePath) and currentExePath must exist again — no orphaned
      // .bak, no broken binary left in place (REQ-DST-024).
      expect(existsSync(backupExePath)).toBe(false);
      expect(existsSync(currentExePath)).toBe(true);

      const logContent = readFileSync(logPath, "utf8");
      expect(logContent).toContain("failed to spawn synchronously");
      expect(logContent).toContain("rollback complete");
    },
    20000,
  );

  it("never swaps if the main pid does not exit (safety: leaves current binary untouched)", async () => {
    const dir = makeTempDir();
    const currentExePath = join(dir, "current-exe.mjs");
    const newExePath = join(dir, "new-exe.mjs");
    const backupExePath = join(dir, "current-exe.mjs.bak");

    copyFileSync(FAKE_EXE, currentExePath);
    copyFileSync(FAKE_EXE, newExePath);

    // Use a PID that is guaranteed to still be "alive" for the whole test:
    // this test process's own pid. The helper's MAIN_EXIT_TIMEOUT_MS is
    // 15s by default — too slow for a unit test, so build a short-timeout
    // variant of the script by hand using buildSwapHelperScript's own
    // template with a monkey-patched timeout via direct script inspection
    // is unnecessary: we just assert that within a SHORT window (well under
    // the real timeout), nothing has happened yet, which is the load-bearing
    // safety property regardless of the exact timeout value.
    const plan: SwapPlan = {
      mainPid: process.pid, // this test process — guaranteed alive
      currentExePath,
      newExePath,
      backupExePath,
      relaunchArgs: [],
      cwd: dir,
      logPath: join(dir, "swap-helper.log"),
    };

    const script = buildSwapHelperScript(plan);
    const scriptPath = join(dir, "swap-helper.mjs");
    writeFileSync(scriptPath, script, "utf8");
    mkdirSync(dir, { recursive: true });

    const child = nodeSpawn(process.execPath, [scriptPath], { stdio: "ignore" });
    spawnedChildren.push(child);

    await sleep(1000);

    // Main pid (this test process) is still alive — the helper must not
    // have touched either file yet.
    expect(existsSync(backupExePath)).toBe(false);
    expect(existsSync(currentExePath)).toBe(true);
  }, 10000);

  it("restores the original exe when the SECOND rename fails (FIX-1, defense in depth)", async () => {
    // Reproduces the bug this fix closes: the FIRST rename (current ->
    // backup) succeeds, but the SECOND (new -> current) fails — e.g. EXDEV
    // because dataDir's tmp lives on a different volume, or an antivirus
    // lock on the destination. Before FIX-1, the catch block only logged
    // the error and returned, leaving the exe permanently renamed to
    // `.bak` with NOTHING at currentExePath (worse than doing nothing: the
    // GM's server binary appears to have vanished). After FIX-1, the
    // helper must detect that the first rename already happened and
    // restore backupExePath back onto currentExePath.
    const dir = makeTempDir();
    const currentExePath = join(dir, "current-exe.mjs");
    // newExePath lives in its OWN subdirectory (mirroring production, where
    // the downloaded tmp binary sits under <dataDir>/runtime/, a different
    // directory — possibly a different volume — from the exe's install dir).
    // This separation is what lets denyRenameAccess make ONLY the second
    // rename fail on POSIX: there it works by stripping write permission
    // from the SOURCE file's parent directory, and if all three paths shared
    // one directory that would break the FIRST rename too (never reaching
    // the restore path under test).
    const stagingDir = join(dir, "staging");
    mkdirSync(stagingDir, { recursive: true });
    const newExePath = join(stagingDir, "new-exe.mjs");
    const backupExePath = join(dir, "current-exe.mjs.bak");

    copyFileSync(FAKE_EXE, currentExePath);
    copyFileSync(FAKE_EXE, newExePath);

    // Force the second rename (newExePath -> currentExePath) to fail with
    // EPERM/EACCES by denying rename/delete access on newExePath — see
    // denyRenameAccess's doc comment. currentExePath's directory is left
    // fully writable, so both the FIRST rename (current -> backup) and the
    // RESTORE rename (backupExePath -> currentExePath) are unaffected.
    denyRenameAccess(newExePath);

    const mainProcess = spawnFakeMainProcess();

    const plan: SwapPlan = {
      mainPid: mainProcess.pid ?? -1,
      currentExePath,
      newExePath,
      backupExePath,
      relaunchArgs: [],
      cwd: dir,
      logPath: join(dir, "swap-helper.log"),
      relaunchCommand: process.execPath,
    };

    const { scriptPath } = scheduleSwap({
      plan,
      runtimeDir: dir,
      spawnImpl: ((cmd: string, args: readonly string[], opts: unknown) => {
        const child = nodeSpawn(cmd, args as string[], opts as never);
        spawnedChildren.push(child);
        return child;
      }) as typeof nodeSpawn,
      invocation: { execPath: process.execPath, seaFlag: false },
    });

    expect(existsSync(scriptPath)).toBe(true);

    mainProcess.kill();

    const logPath = join(dir, "swap-helper.log");
    try {
      await waitFor(
        () =>
          existsSync(logPath) &&
          (readFileSync(logPath, "utf8").includes("restored") ||
            readFileSync(logPath, "utf8").includes("manual intervention required")),
        10000,
      );

      // Load-bearing assertion (FIX-1): the original exe must be restored —
      // currentExePath exists again (not left as an orphaned .bak) and
      // backupExePath is gone (renamed back, not just copied-and-left-behind).
      expect(existsSync(currentExePath)).toBe(true);
      expect(existsSync(backupExePath)).toBe(false);

      const logContent = readFileSync(logPath, "utf8");
      expect(logContent).toContain("ERROR during swap");
      expect(logContent).toContain("restored");
      expect(logContent).not.toContain("manual intervention required");
    } finally {
      restoreRenameAccess(newExePath);
    }
  }, 20000);
});

describe("cleanupOrphanedBackup (FIX-4)", () => {
  it("removes an orphaned .bak and logs the removal", () => {
    const dir = makeTempDir();
    const exePath = join(dir, "fusion-server.exe");
    writeFileSync(exePath, "current binary", "utf8");
    writeFileSync(`${exePath}.bak`, "stale backup from a previous update", "utf8");

    const logs: string[] = [];
    const result = cleanupOrphanedBackup(exePath, (message) => logs.push(message));

    expect(result).toMatchObject({ found: true, removed: true, bakPath: `${exePath}.bak` });
    expect(existsSync(`${exePath}.bak`)).toBe(false);
    // The exe itself must never be touched.
    expect(readFileSync(exePath, "utf8")).toBe("current binary");
    expect(logs.some((message) => message.includes("removed orphaned update backup"))).toBe(true);
  });

  it("is a silent no-op when no .bak exists", () => {
    const dir = makeTempDir();
    const exePath = join(dir, "fusion-server.exe");
    writeFileSync(exePath, "current binary", "utf8");

    const logs: string[] = [];
    const result = cleanupOrphanedBackup(exePath, (message) => logs.push(message));

    expect(result).toMatchObject({ found: false, removed: false });
    expect(logs).toEqual([]);
  });

  it("never throws when removal fails — reports the error instead (best-effort contract)", () => {
    const dir = makeTempDir();
    const exePath = join(dir, "fusion-server.exe");
    writeFileSync(exePath, "current binary", "utf8");
    // A NON-EMPTY DIRECTORY at the .bak path: rmSync without `recursive`
    // refuses to delete it (EISDIR/EPERM), standing in for any removal
    // failure (antivirus lock, permissions) — the helper must swallow it.
    mkdirSync(`${exePath}.bak`);
    writeFileSync(join(`${exePath}.bak`, "child.txt"), "x", "utf8");

    const logs: string[] = [];
    let result: OrphanBackupCleanupResult | undefined;
    expect(() => {
      result = cleanupOrphanedBackup(exePath, (message) => logs.push(message));
    }).not.toThrow();

    expect(result).toMatchObject({ found: true, removed: false });
    expect(result?.error).toBeDefined();
    expect(
      logs.some((message) => message.includes("could not remove orphaned update backup")),
    ).toBe(true);
  });
});
