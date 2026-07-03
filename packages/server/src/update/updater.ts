/**
 * Update apply orchestration (M6/B5 — REQ-DST-022/023/024).
 *
 * `applyUpdate` runs the full sequence described in the design doc §2.1
 * point 4:
 *   (a) pre-update backup of every open world (REQ-DST-022) — via
 *       WorldManager.backupPreUpdate, reusing the SQLite online backup API.
 *   (b) download the platform binary to a tmp path.
 *   (c) verify SHA-256 against the manifest (CA-DST-07) — abort on mismatch,
 *       current binary untouched.
 *   (d) schedule the swap via the detached helper process (swap-helper.ts)
 *       and report back to the caller that a restart is imminent — the
 *       ACTUAL swap/restart happens after this process exits (see
 *       swap-helper.ts's module doc comment).
 *
 * Gate (design doc §2.1 point 3): only meaningful when running as a Node SEA
 * build (`sea-detect.ts`). In dev (`node dist/index.js`), `applyUpdate`
 * returns a typed "not supported" result instead of attempting anything —
 * there is no single exe file to swap in a dev checkout.
 *
 * Second gate (MEDIA fix, platform): the swap-and-relaunch strategy
 * swap-helper.ts implements is Windows-specific (single-file rename swap of
 * `process.execPath`). On Linux/macOS the equivalent single-file swap is
 * either wrong (AppImage's `process.execPath` is the mounted inner binary,
 * not the outer `.AppImage`) or does not apply at all (macOS artifacts are
 * `.dmg` disk images, not directly-swappable binaries) — so `applyUpdate`
 * returns `PLATFORM_UNSUPPORTED` for any non-`win32` platform before ever
 * resolving a platform manifest entry, regardless of whether one exists.
 */

import { platform as osPlatform, arch as osArch } from "node:os";
import { join, dirname } from "node:path";
import type { Logger } from "pino";
import type { WorldManager } from "../worlds/world-manager.js";
import type { BackupEntry } from "@fusion/shared";
import { fetchUpdateManifest, currentPlatformKey, type UpdateChannel } from "./manifest-client.js";
import { isNewerVersion } from "./semver.js";
import {
  downloadAndVerify,
  UpdateHashMismatchError,
  UpdateDownloadError,
  cleanupTmpFile,
} from "./downloader.js";
import { isRunningAsSea } from "./sea-detect.js";
import { scheduleSwap, cleanupOrphanedBackup, type SwapPlan } from "./swap-helper.js";

export type ApplyUpdateFailureCode =
  | "NOT_SEA"
  | "NO_UPDATE_AVAILABLE"
  | "MANIFEST_UNAVAILABLE"
  | "PLATFORM_UNSUPPORTED"
  | "HASH_MISMATCH"
  | "DOWNLOAD_FAILED"
  | "BACKUP_FAILED";

export interface ApplyUpdateSuccess {
  ok: true;
  fromVersion: string;
  toVersion: string;
  backups: BackupEntry[];
  /** Absolute path of the generated swap-helper script (for diagnostics/tests). */
  swapScriptPath: string;
}

export interface ApplyUpdateFailure {
  ok: false;
  code: ApplyUpdateFailureCode;
  message: string;
}

export type ApplyUpdateResult = ApplyUpdateSuccess | ApplyUpdateFailure;

export interface ApplyUpdateOptions {
  currentVersion: string;
  channel: UpdateChannel;
  updateRepo?: string;
  /** Test/self-hosted override — see manifest-client.ts's FetchManifestOptions. */
  manifestUrl?: string;
  fetchImpl?: typeof fetch;
  /** Worlds to back up before applying (REQ-DST-022) — normally the single world this `serve` process has open, if any. */
  openWorldSlugs: readonly string[];
  worldManager: WorldManager;
  /** Absolute path of the currently-running exe. Defaults to process.execPath. */
  currentExePath?: string;
  /** Root data directory — the swap-helper script + its log live under `<dataDir>/runtime/`. */
  dataDir: string;
  /** argv (excluding node/exe) to relaunch the server with after the swap. Typically the same argv this process was started with. */
  relaunchArgs: readonly string[];
  logger?: Logger;
  /** Injected for tests — see swap-helper.ts's ScheduleSwapOptions. */
  spawnImpl?: Parameters<typeof scheduleSwap>[0]["spawnImpl"];
  /** Injected for tests — bypasses isRunningAsSea()'s real node:sea check. */
  isSeaOverride?: boolean;
  /**
   * Injected for tests: override how the swap-helper is invoked. Production
   * always uses `{ execPath: currentExePath, seaFlag: true }` (re-invoke the
   * real SEA exe with the hidden flag — see swap-helper.ts's module doc
   * comment). Tests standing in `currentExePath` with a plain `.mjs` fixture
   * (not directly executable on Windows — `spawn` EFTYPE) override this to
   * `{ execPath: process.execPath, seaFlag: false }` so the helper is
   * launched via a real `node <script>` invocation instead.
   */
  swapInvocationOverride?: Parameters<typeof scheduleSwap>[0]["invocation"];
  /**
   * Injected for tests: forwarded to SwapPlan.relaunchCommand (see that
   * field's doc comment) — needed alongside swapInvocationOverride whenever
   * `currentExePath` is a test fixture rather than a real executable.
   */
  relaunchCommandOverride?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

/**
 * Run the full apply-update sequence. NEVER throws — every failure mode is
 * surfaced as a typed `{ ok: false, code, message }` result so the HTTP
 * route (routes.ts) can map it to a clear error response (CA-DST-07 requires
 * "mensagem de erro clara").
 */
export async function applyUpdate(options: ApplyUpdateOptions): Promise<ApplyUpdateResult> {
  const {
    currentVersion,
    channel,
    updateRepo,
    manifestUrl,
    fetchImpl,
    openWorldSlugs,
    worldManager,
    currentExePath = process.execPath,
    dataDir,
    relaunchArgs,
    logger,
    spawnImpl,
    isSeaOverride,
    swapInvocationOverride,
    relaunchCommandOverride,
    platform = osPlatform(),
    arch = osArch(),
  } = options;

  // Gate: only meaningful inside a SEA build (design doc §2.1 point 3).
  const runningAsSea = isSeaOverride ?? (await isRunningAsSea());
  if (!runningAsSea) {
    return {
      ok: false,
      code: "NOT_SEA",
      message:
        "Update apply is only available in the distributed executable (SEA build). " +
        "In development (`node dist/index.js`), update the source and rebuild instead.",
    };
  }

  // FIX-4: opportunistically clear the orphaned `<exe>.bak` a previous
  // successful update could not delete itself (its helper was still running
  // as that very .bak image — see swap-helper.ts's success branch). This is
  // the one provably-safe moment to do it: an apply is only just starting,
  // so no swap-helper is in flight and no rollback can still need the file.
  // Best-effort by contract (cleanupOrphanedBackup never throws).
  cleanupOrphanedBackup(currentExePath, (message) => logger?.info(message));

  // Re-fetch the manifest (do not trust a possibly-stale client-supplied
  // version) — mirrors update-checker.ts's non-blocking fetch shape, but a
  // failure HERE is a hard abort (the GM explicitly asked to apply).
  const fetchOptions: Parameters<typeof fetchUpdateManifest>[0] = { channel };
  if (updateRepo !== undefined) fetchOptions.updateRepo = updateRepo;
  if (manifestUrl !== undefined) fetchOptions.manifestUrl = manifestUrl;
  if (fetchImpl !== undefined) fetchOptions.fetchImpl = fetchImpl;

  const manifestResult = await fetchUpdateManifest(fetchOptions);
  if (!manifestResult.ok) {
    return { ok: false, code: "MANIFEST_UNAVAILABLE", message: manifestResult.reason };
  }
  const manifest = manifestResult.manifest;

  if (!isNewerVersion(manifest.version, currentVersion)) {
    return {
      ok: false,
      code: "NO_UPDATE_AVAILABLE",
      message: `Current version ${currentVersion} is already up to date (latest: ${manifest.version}).`,
    };
  }

  // MEDIA fix: now that manifest-client.ts's GitHub path resolves REAL
  // per-platform download entries (asset-matching via latest-<channel>.json
  // — see manifest-client.ts's parseGithubReleases doc comment), the
  // in-process swap-and-relaunch flow implemented by swap-helper.ts is only
  // correct for Windows:
  //   - Linux: `process.execPath` inside a mounted AppImage points at the
  //     internal squashfs-mounted binary, NOT the external `.AppImage` file
  //     the manifest publishes and that the user actually launched — swapping
  //     `process.execPath` would silently corrupt the mount, not the
  //     installation the user runs. The correct outer path is `$APPIMAGE`
  //     (an env var AppImage's runtime sets), which swap-helper.ts does not
  //     yet consult.
  //   - macOS: the downloaded artifact is a `.dmg` disk image, which cannot
  //     directly replace the Mach-O binary at `Contents/MacOS/` the way a
  //     single-file swap does on Windows — mounting + copying out the new
  //     binary is a different procedure entirely, not yet implemented.
  // Gate explicitly rather than let either of these reach swap-helper.ts and
  // silently corrupt the installation now that real platform entries exist
  // to trigger it.
  if (platform !== "win32") {
    return {
      ok: false,
      code: "PLATFORM_UNSUPPORTED",
      message:
        `Auto-update apply is only supported on Windows today. Platform "${platform}" ` +
        "requires a manual download/reinstall — see release notes for the download link.",
    };
  }

  const platformKey = currentPlatformKey(platform, arch);
  const platformEntry = manifest.platforms[platformKey];
  if (platformEntry === undefined) {
    return {
      ok: false,
      code: "PLATFORM_UNSUPPORTED",
      message: `No release artifact published for platform "${platformKey}" in version ${manifest.version}.`,
    };
  }

  // (a) Pre-update backup of every open world (REQ-DST-022).
  const backups: BackupEntry[] = [];
  for (const slug of openWorldSlugs) {
    try {
      const entry = await worldManager.backupPreUpdate(slug, manifest.version);
      backups.push(entry);
      logger?.info({ slug, filename: entry.filename }, "Pre-update backup created");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger?.error({ slug, err }, "Pre-update backup failed — aborting update");
      return {
        ok: false,
        code: "BACKUP_FAILED",
        message: `Failed to back up world "${slug}" before updating: ${message}. Update aborted — current binary untouched.`,
      };
    }
  }

  // (b) + (c) Download + verify SHA-256 (CA-DST-07).
  const runtimeDir = join(dataDir, "runtime");
  const tmpExePath = join(runtimeDir, `fusion-update-${manifest.version}.tmp`);
  cleanupTmpFile(tmpExePath); // best-effort: clear any stale tmp from a previous aborted attempt

  try {
    const downloadOptions: Parameters<typeof downloadAndVerify>[0] = {
      url: platformEntry.url,
      expectedSha256: platformEntry.sha256,
      destPath: tmpExePath,
    };
    if (fetchImpl !== undefined) downloadOptions.fetchImpl = fetchImpl;
    await downloadAndVerify(downloadOptions);
  } catch (err) {
    cleanupTmpFile(tmpExePath);
    if (err instanceof UpdateHashMismatchError) {
      logger?.error({ err }, "Update download failed hash verification — keeping current binary");
      return { ok: false, code: "HASH_MISMATCH", message: err.message };
    }
    const message = err instanceof UpdateDownloadError ? err.message : String(err);
    logger?.error({ err }, "Update download failed");
    return { ok: false, code: "DOWNLOAD_FAILED", message };
  }

  logger?.info(
    { toVersion: manifest.version, tmpExePath },
    "Update downloaded and verified — scheduling swap",
  );

  // (d) Schedule the swap via the detached helper (design doc §2.1 point 4 /
  // swap-helper.ts). This process is expected to shut down gracefully right
  // after this returns — see routes.ts's apply handler.
  const plan: SwapPlan = {
    mainPid: process.pid,
    currentExePath,
    newExePath: tmpExePath,
    backupExePath: `${currentExePath}.bak`,
    relaunchArgs: [...relaunchArgs],
    cwd: dirname(currentExePath),
    logPath: join(runtimeDir, "swap-helper.log"),
    ...(relaunchCommandOverride !== undefined ? { relaunchCommand: relaunchCommandOverride } : {}),
  };

  const scheduleOptions: Parameters<typeof scheduleSwap>[0] = {
    plan,
    runtimeDir,
    invocation: swapInvocationOverride ?? { execPath: currentExePath, seaFlag: true },
  };
  if (spawnImpl !== undefined) scheduleOptions.spawnImpl = spawnImpl;

  const { scriptPath } = scheduleSwap(scheduleOptions);

  return {
    ok: true,
    fromVersion: currentVersion,
    toVersion: manifest.version,
    backups,
    swapScriptPath: scriptPath,
  };
}
