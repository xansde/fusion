/**
 * Windows-safe binary swap helper (M6/B5 — REQ-DST-023 items 3-4, REQ-DST-024,
 * DA-06, design doc §2.1 point 4).
 *
 * PROBLEM. On Windows, a running .exe cannot overwrite (or usually even
 * rename away) its own file while it is still the process image in use —
 * the OS keeps the file locked. `apply()` therefore CANNOT do the swap
 * itself from inside the process that is about to be replaced. The standard
 * pattern (used by most self-updating Windows tools) is a short-lived
 * RELAUNCHER helper process:
 *
 *   1. The main server process (still running the OLD binary) finishes
 *      downloading + verifying the new binary into a tmp path and writes a
 *      small JSON "swap plan" describing what to do.
 *   2. The main process spawns the helper DETACHED (survives the parent's
 *      exit) and then shuts down gracefully itself (closes Fastify/sockets,
 *      exits). This is required because Windows can only rename/delete a
 *      file once every process holding it open has released it.
 *   3. The helper polls until the main process's PID is gone, then performs
 *      the actual swap: rename current exe -> `<name>.bak`, move the
 *      verified new binary into the current exe's path.
 *   4. The helper relaunches the (now-new) exe with the same argv the main
 *      process was started with, and watches it briefly
 *      ({@link POST_SWAP_WATCH_MS}): if the relaunched process exits within
 *      that window (crash-on-boot), the helper treats the update as FAILED
 *      — restores the `.bak` back over the broken new binary and relaunches
 *      the ORIGINAL (working) exe instead (REQ-DST-024 rollback). If the
 *      relaunched process survives past the watch window, the helper
 *      deletes the `.bak` (successful update) and exits.
 *
 * WHO RUNS THE HELPER SCRIPT. The GM's machine is not guaranteed to have a
 * standalone `node` binary on PATH (the whole point of the SEA headless
 * distribution is "no Node install required" — REQ-DST-001). So the helper
 * script is never invoked via a bare `node helper.mjs`. Instead:
 *   - In production (SEA), `scheduleSwap` re-invokes the CURRENT exe itself
 *     with a hidden `--fusion-swap-helper <scriptPath>` flag.
 *     `runtime/sea-entry.ts` recognizes that flag as literally its first
 *     check (before any of the normal boot machinery) and, when present,
 *     dynamically imports and runs THIS module's script directly instead of
 *     booting the server — the exe is reused as its own script host, which
 *     works because SEA embeds a full Node runtime capable of running
 *     arbitrary ESM once control is hand-tunnelled to it this way.
 *   - In dev/tests (plain `node dist/index.js`), the real `node` executable
 *     IS available (it is what is currently running the process), so
 *     `scheduleSwap` defaults `nodeExecPath` to `process.execPath`, which in
 *     a non-SEA process is genuinely the `node` binary.
 *
 * This module owns BOTH ends: `buildSwapHelperScript` renders the actual
 * relauncher as a self-contained script string (written to
 * `<dataDir>/runtime/swap-helper.mjs` at apply-time and spawned detached —
 * a plain file, not a new SEA asset), and `scheduleSwap` spawns it via
 * whichever of the two invocation shapes above applies. Keeping the
 * generation + spawn logic in one typed module (rather than a
 * hand-maintained loose .mjs fixture) means the relauncher's behaviour is
 * unit-testable the same way the rest of this codebase is.
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/** How long the helper waits for the OLD main process's PID to disappear before giving up. */
export const MAIN_EXIT_TIMEOUT_MS = 15_000;
/**
 * How long the helper watches the newly relaunched process before declaring
 * the update successful and removing the `.bak`.
 *
 * KNOWN LIMITATION: this is a fixed, unconditional window — it only catches
 * a crash-on-boot that happens to occur in the first 3s (e.g. immediate
 * exceptions, missing native modules). A new binary that starts cleanly but
 * then crashes LATER (e.g. a data-dir migration that fails a few seconds
 * into boot, or a slow-starting Fastify listener) is declared a success and
 * the rollback safety net (REQ-DST-024) does not apply to it. A more robust
 * design would replace/extend this fixed sleep with an active `/health`
 * probe loop (poll until 200 OK or a longer deadline), but that requires the
 * helper to know the server's bind address/port, which the current
 * SwapPlan does not carry. Tracked as a follow-up rather than blocking B5.
 */
export const POST_SWAP_WATCH_MS = 3_000;

export interface SwapPlan {
  /** PID of the main server process that must exit before the swap proceeds. */
  mainPid: number;
  /** Absolute path of the currently-running exe (the swap target). */
  currentExePath: string;
  /** Absolute path of the downloaded-and-verified new binary (tmp location). */
  newExePath: string;
  /** Absolute path the current exe is renamed to before the new one takes its place. */
  backupExePath: string;
  /** argv (excluding node/exe itself) to relaunch with — mirrors how the main process was started. */
  relaunchArgs: string[];
  /** Working directory to relaunch in. */
  cwd: string;
  /** Log file the helper appends its own progress to, for post-mortem debugging outside of pino (the main process is gone by the time most of this runs). */
  logPath: string;
  /**
   * The command used to relaunch the (now-swapped-into-place) binary at
   * `currentExePath`. Defaults to `currentExePath` itself — correct in
   * production, where `currentExePath` IS a real, directly-executable SEA
   * `.exe`. Tests exercising the relaunch step with a plain `.mjs` fixture
   * standing in for the "binary" (Windows cannot directly execute a `.mjs`
   * file — `spawn(mjsPath, ...)` fails with `EFTYPE`) override this to
   * `process.execPath` (the test's own `node` binary) so the relaunch spawns
   * `node <currentExePath> ...relaunchArgs` instead.
   */
  relaunchCommand?: string;
}

/**
 * Render the relauncher as a self-contained ESM script. Pure string
 * templating (no bundler) — the script only uses Node built-ins
 * (`node:fs`, `node:child_process`, `node:process`), matching this
 * codebase's "no new runtime dependency" rule and keeping it trivially
 * inspectable/debuggable as a plain file on the GM's disk if something goes
 * wrong.
 *
 * `JSON.stringify(plan)` is embedded directly into the script source rather
 * than read from a side file at helper-startup, so the helper has zero
 * dependency on any other file surviving on disk except the two binaries it
 * explicitly swaps.
 */
export function buildSwapHelperScript(plan: SwapPlan): string {
  const planJson = JSON.stringify(plan);

  return `#!/usr/bin/env node
// AUTO-GENERATED by @fusion/server update/swap-helper.ts — safe to delete once
// the update it was created for has completed (success or rollback).
import { existsSync, renameSync, appendFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

const plan = ${planJson};
const MAIN_EXIT_TIMEOUT_MS = ${String(MAIN_EXIT_TIMEOUT_MS)};
const POST_SWAP_WATCH_MS = ${String(POST_SWAP_WATCH_MS)};

function log(msg) {
  try {
    mkdirSync(dirname(plan.logPath), { recursive: true });
    appendFileSync(plan.logPath, \`[\${new Date().toISOString()}] \${msg}\\n\`);
  } catch {
    // best-effort logging only
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function relaunch(exePath) {
  // See SwapPlan.relaunchCommand's doc comment: production relaunches the
  // real .exe directly; tests may relaunch via a "node <script>" command
  // instead, since a plain .mjs fixture is not directly executable on
  // Windows.
  const command = plan.relaunchCommand ?? exePath;
  const args = plan.relaunchCommand !== undefined ? [exePath, ...plan.relaunchArgs] : plan.relaunchArgs;
  const child = spawn(command, args, {
    cwd: plan.cwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child;
}

async function main() {
  log(\`swap-helper started, watching main pid \${plan.mainPid}\`);

  const deadline = Date.now() + MAIN_EXIT_TIMEOUT_MS;
  while (isAlive(plan.mainPid) && Date.now() < deadline) {
    await sleep(200);
  }
  if (isAlive(plan.mainPid)) {
    log(\`main process \${plan.mainPid} did not exit within \${MAIN_EXIT_TIMEOUT_MS}ms — aborting swap, leaving current binary untouched\`);
    return;
  }
  log("main process exited — proceeding with swap");

  if (!existsSync(plan.newExePath)) {
    log(\`ERROR: new binary missing at \${plan.newExePath} — aborting swap\`);
    return;
  }

  let firstRenameDone = false;
  try {
    renameSync(plan.currentExePath, plan.backupExePath);
    firstRenameDone = true;
    renameSync(plan.newExePath, plan.currentExePath);
    log(\`swapped \${plan.currentExePath} -> backed up to \${plan.backupExePath}, new binary in place\`);
  } catch (err) {
    log(\`ERROR during swap: \${String(err)} — attempting to leave things as they were\`);

    // FIX-1 (MEDIA): if the FIRST rename already happened (currentExePath ->
    // backupExePath) but the SECOND one (newExePath -> currentExePath) then
    // failed — e.g. EXDEV because dataDir's tmp lives on a different volume
    // than the exe's install dir, or an antivirus lock on the destination —
    // the exe is left renamed to \`.bak\` with NOTHING at currentExePath. That
    // is strictly worse than doing nothing: the GM's server binary appears to
    // have vanished. Restore backupExePath back onto currentExePath so the
    // installation is left exactly as it was before this swap attempt.
    if (firstRenameDone) {
      try {
        renameSync(plan.backupExePath, plan.currentExePath);
        log(\`restored \${plan.currentExePath} from \${plan.backupExePath} after failed swap\`);
      } catch (restoreErr) {
        // rename can fail with EXDEV (cross-device) even for this reverse
        // direction — fall back to a copy+delete, which works across
        // volumes at the cost of a slower, non-atomic restore.
        log(
          \`rename-restore failed (\${String(restoreErr)}) — falling back to copy+delete\`,
        );
        try {
          copyFileSync(plan.backupExePath, plan.currentExePath);
          rmSync(plan.backupExePath, { force: true });
          log(\`restored \${plan.currentExePath} via copy+delete fallback\`);
        } catch (copyErr) {
          log(
            \`ERROR: could not restore \${plan.currentExePath} — manual intervention required. \` +
              \`Backup remains at: \${plan.backupExePath}. Copy fallback error: \${String(copyErr)}\`,
          );
        }
      }
    }
    return;
  }

  log("relaunching new binary");

  // relaunch() calls child_process.spawn(), which on Windows THROWS
  // SYNCHRONOUSLY (e.g. "spawn UNKNOWN"/EACCES) when the target binary is
  // invalid/corrupt/blocked — it does NOT always surface as an async
  // "error" event on the returned ChildProcess. Without this try/catch, that
  // synchronous throw propagates out of main() to the top-level
  // \`main().catch\` below, which only logs FATAL and returns — leaving the
  // broken binary swapped into currentExePath and the .bak orphaned
  // (REQ-DST-024 violated). Treat a synchronous spawn failure exactly like
  // an early-exit/async spawn error: roll back to the previous binary.
  let child;
  let exitedEarly = false;
  try {
    child = relaunch(plan.currentExePath);
  } catch (err) {
    log(\`relaunched process failed to spawn synchronously: \${String(err)}\`);
    exitedEarly = true;
  }

  if (child !== undefined) {
    child.once("exit", (code, signal) => {
      exitedEarly = true;
      log(\`relaunched process exited early (code=\${String(code)}, signal=\${String(signal)}) during watch window\`);
    });
    child.once("error", (err) => {
      exitedEarly = true;
      log(\`relaunched process failed to spawn: \${String(err)}\`);
    });
  }

  await sleep(POST_SWAP_WATCH_MS);

  if (exitedEarly) {
    log("update FAILED post-swap — rolling back to previous binary (REQ-DST-024)");
    try {
      renameSync(plan.currentExePath, plan.newExePath + ".failed");
      renameSync(plan.backupExePath, plan.currentExePath);
      log("rollback complete — relaunching previous binary");
      try {
        relaunch(plan.currentExePath);
      } catch (err) {
        // The restored (previously-working) binary failed to spawn
        // synchronously too — this is unexpected (it was running fine
        // moments ago as plan.currentExePath) but must not crash main()
        // before this log line is written, since it is the operator's only
        // signal that manual intervention is needed.
        log(\`ERROR: previous binary failed to relaunch after rollback: \${String(err)} — manual intervention required.\`);
      }
    } catch (err) {
      log(\`ERROR during rollback: \${String(err)} — manual intervention required. Backup at: \${plan.backupExePath}\`);
    }
    return;
  }

  log("update succeeded — new binary is running, removing backup");
  try {
    const { rmSync } = await import("node:fs");
    rmSync(plan.backupExePath, { force: true });
  } catch (err) {
    // Expected to fail on Windows: this helper process is itself running as
    // the OLD exe image (renamed to backupExePath earlier), so the OS still
    // holds the file open and refuses the delete. Non-fatal — a leftover
    // ~118MB .bak file is harmless disk usage, and the NEXT update's rename
    // of current->.bak overwrites it. Logged (not silently swallowed) so
    // it's visible in swap-helper.log rather than a total no-op, and so the
    // next boot can pick it up for cleanup if desired.
    log(\`could not remove backup at \${plan.backupExePath}: \${String(err)} — harmless, will be overwritten by the next update\`);
  }
}

main().catch((err) => {
  log(\`FATAL: \${String(err)}\`);
});
`;
}

/** Flag `sea-entry.ts` recognizes to divert into swap-helper mode instead of the normal boot. See module doc comment "WHO RUNS THE HELPER SCRIPT". */
export const SWAP_HELPER_FLAG = "--fusion-swap-helper";

export interface ScheduleSwapOptions {
  plan: SwapPlan;
  /** Directory the generated helper script + its log are written to. */
  runtimeDir: string;
  /** Injectable for tests — defaults to node:child_process spawn. */
  spawnImpl?: typeof spawn;
  /**
   * The executable to run the helper script with, and how to invoke it:
   *   - `{ execPath, seaFlag: true }` — production SEA: re-invoke the
   *     current exe itself with `SWAP_HELPER_FLAG <scriptPath>` (see module
   *     doc comment). `execPath` should be `process.execPath` of the
   *     CURRENT (about-to-be-replaced) exe — it still works after the
   *     rename-to-`.bak` step because the OS resolves the already-open exe
   *     by inode/handle, not by re-reading the path (POSIX) or because we
   *     spawn it BEFORE the rename ever happens (this call happens first).
   *   - `{ execPath, seaFlag: false }` (default) — dev/tests: run the
   *     script with a real `node <script>` invocation, `execPath` being the
   *     node binary (defaults to `process.execPath`, which in a non-SEA
   *     process genuinely is `node`).
   */
  invocation?: { execPath: string; seaFlag: boolean };
}

/**
 * Write the swap-helper script to disk and spawn it DETACHED so it survives
 * this process's own shutdown. Returns immediately after the spawn — does
 * NOT wait for the swap to complete (the caller is expected to shut down
 * gracefully right after this returns, per the module doc comment's step 2).
 */
export function scheduleSwap(options: ScheduleSwapOptions): { scriptPath: string } {
  const {
    plan,
    runtimeDir,
    spawnImpl = spawn,
    invocation = { execPath: process.execPath, seaFlag: false },
  } = options;

  mkdirSync(runtimeDir, { recursive: true });
  const scriptPath = join(runtimeDir, "swap-helper.mjs");
  writeFileSync(scriptPath, buildSwapHelperScript(plan), "utf8");

  const args = invocation.seaFlag ? [SWAP_HELPER_FLAG, scriptPath] : [scriptPath];

  const child = spawnImpl(invocation.execPath, args, {
    detached: true,
    stdio: "ignore",
    cwd: plan.cwd,
  });
  child.unref();

  return { scriptPath };
}

/** Result of {@link cleanupOrphanedBackup} — returned (never thrown) so callers can log/inspect it. */
export interface OrphanBackupCleanupResult {
  /** The `<exe>.bak` path that was checked. */
  bakPath: string;
  /** Whether a leftover `.bak` existed at all. */
  found: boolean;
  /** Whether it was successfully removed (always false when `found` is false). */
  removed: boolean;
  /** Present when removal was attempted and failed — the reason, for the caller's log. */
  error?: string;
}

/**
 * FIX-4: best-effort removal of the orphaned `<exe>.bak` a PREVIOUS
 * successful update leaves behind. The generated helper script's success
 * branch tries to delete it, but on Windows that delete reliably fails: the
 * helper process is itself still running as the old exe IMAGE (the very
 * file renamed to `.bak`), so the OS refuses — see the script's own
 * "could not remove backup" comment. The orphan (~118MB) then sits on disk
 * until the next update happens to overwrite it.
 *
 * Called at the START of the next apply (updater.ts), which is the one
 * moment this is provably safe: an apply is only just beginning, so no
 * swap-helper is in flight and the `.bak` cannot be needed for any rollback.
 * Deliberately NOT called at boot: a freshly relaunched (post-swap) binary
 * is still inside the helper's POST_SWAP_WATCH_MS crash-watch window during
 * its first seconds, and deleting the `.bak` there would destroy the very
 * file the helper's crash-on-boot rollback (REQ-DST-024) needs to restore.
 *
 * NEVER throws — a leftover `.bak` is harmless disk usage, so any failure
 * here must not block the update that is about to start.
 */
export function cleanupOrphanedBackup(
  currentExePath: string,
  log?: (message: string) => void,
): OrphanBackupCleanupResult {
  const bakPath = `${currentExePath}.bak`;
  try {
    if (!existsSync(bakPath)) {
      return { bakPath, found: false, removed: false };
    }
    rmSync(bakPath, { force: true });
    log?.(`removed orphaned update backup at ${bakPath}`);
    return { bakPath, found: true, removed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.(
      `could not remove orphaned update backup at ${bakPath}: ${message} — harmless, continuing with the update`,
    );
    return { bakPath, found: true, removed: false, error: message };
  }
}
