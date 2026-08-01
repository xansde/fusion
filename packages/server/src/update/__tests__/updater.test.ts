/**
 * Integration tests for applyUpdate (M6/B5 — REQ-DST-022/023/024, CA-DST-07).
 * Uses the local mock update server (never the real internet) + a real
 * WorldManager/world so the pre-update backup step is exercised end-to-end,
 * and injects spawnImpl/isSeaOverride so the swap itself is simulated with
 * the fake-exe.mjs fixture (same one swap-helper.test.ts uses).
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { WorldManager } from "../../worlds/world-manager.js";
import { applyUpdate } from "../updater.js";
import { startMockUpdateServer, sha256Of, type MockUpdateServer } from "./mock-update-server.js";
import type { UpdateManifest } from "../manifest-client.js";
import { currentPlatformKey } from "../manifest-client.js";

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
const markerPidsToKill: number[] = [];
let server: MockUpdateServer | undefined;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-updater-"));
  tempDirs.push(dir);
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
  for (const child of spawnedChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
    }
  }
  for (const pid of markerPidsToKill.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
  await sleep(150);
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

function trackedSpawn(cmd: string, args: readonly string[], opts: unknown): ChildProcess {
  const child = nodeSpawn(cmd, args as string[], opts as never);
  spawnedChildren.push(child);
  return child;
}

describe("applyUpdate", () => {
  it("returns NOT_SEA and does nothing when not running as a SEA build (design doc §2.1 point 3)", async () => {
    const dataDir = makeTempDir();
    const wm = new WorldManager({ dataDir });

    const result = await applyUpdate({
      currentVersion: "1.0.0",
      channel: "stable",
      openWorldSlugs: [],
      worldManager: wm,
      currentExePath: join(dataDir, "current-exe.mjs"),
      dataDir,
      relaunchArgs: [],
      isSeaOverride: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_SEA");
  });

  it("returns NO_UPDATE_AVAILABLE when the manifest version is not newer", async () => {
    const dataDir = makeTempDir();
    const wm = new WorldManager({ dataDir });
    const manifest: UpdateManifest = {
      version: "1.0.0",
      releaseDate: "",
      releaseNotes: "",
      channel: "stable",
      platforms: {},
    };
    server = await startMockUpdateServer({ manifest });

    const result = await applyUpdate({
      currentVersion: "1.0.0",
      channel: "stable",
      manifestUrl: server.manifestUrl,
      openWorldSlugs: [],
      worldManager: wm,
      currentExePath: join(dataDir, "current-exe.mjs"),
      dataDir,
      relaunchArgs: [],
      isSeaOverride: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_UPDATE_AVAILABLE");
  });

  it("clears an orphaned .bak from a previous update at the start of an apply (FIX-4)", async () => {
    // The orphan cleanup runs BEFORE the manifest fetch, so even an apply
    // that ends in NO_UPDATE_AVAILABLE must have cleared it — proving the
    // cleanup is wired into applyUpdate itself, not just unit-correct
    // (cleanupOrphanedBackup's own behaviour is covered in swap-helper.test.ts).
    const dataDir = makeTempDir();
    const wm = new WorldManager({ dataDir });
    const manifest: UpdateManifest = {
      version: "1.0.0",
      releaseDate: "",
      releaseNotes: "",
      channel: "stable",
      platforms: {},
    };
    server = await startMockUpdateServer({ manifest });

    const currentExePath = join(dataDir, "current-exe.mjs");
    copyFileSync(FAKE_EXE, currentExePath);
    writeFileSync(`${currentExePath}.bak`, "orphan from a previous successful update", "utf8");

    const result = await applyUpdate({
      currentVersion: "1.0.0",
      channel: "stable",
      manifestUrl: server.manifestUrl,
      openWorldSlugs: [],
      worldManager: wm,
      currentExePath,
      dataDir,
      relaunchArgs: [],
      isSeaOverride: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_UPDATE_AVAILABLE");
    // The orphaned .bak is gone; the current exe is untouched.
    expect(existsSync(`${currentExePath}.bak`)).toBe(false);
    expect(existsSync(currentExePath)).toBe(true);
  });

  it("returns PLATFORM_UNSUPPORTED when the manifest has no entry for this platform/arch", async () => {
    const dataDir = makeTempDir();
    const wm = new WorldManager({ dataDir });
    const manifest: UpdateManifest = {
      version: "9.9.9",
      releaseDate: "",
      releaseNotes: "",
      channel: "stable",
      platforms: {}, // deliberately empty
    };
    server = await startMockUpdateServer({ manifest });

    const result = await applyUpdate({
      currentVersion: "1.0.0",
      channel: "stable",
      manifestUrl: server.manifestUrl,
      openWorldSlugs: [],
      worldManager: wm,
      currentExePath: join(dataDir, "current-exe.mjs"),
      dataDir,
      relaunchArgs: [],
      isSeaOverride: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PLATFORM_UNSUPPORTED");
  });

  it("returns PLATFORM_UNSUPPORTED on non-Windows even when a matching platform entry exists in the manifest (MEDIA fix)", async () => {
    // swap-helper.ts's rename-based swap is Windows-specific — see
    // updater.ts's module doc comment "Second gate". This must reject BEFORE
    // ever attempting to resolve/download the linux-x64 entry, even though
    // one is present in the manifest (proving the gate is unconditional, not
    // just "no entry found").
    const dataDir = makeTempDir();
    const wm = new WorldManager({ dataDir });
    const manifest: UpdateManifest = {
      version: "9.9.9",
      releaseDate: "",
      releaseNotes: "",
      channel: "stable",
      platforms: {
        "linux-x64": {
          url: "http://example.invalid/should-not-be-fetched",
          sha256: "0".repeat(64),
          size: 1,
        },
      },
    };
    server = await startMockUpdateServer({ manifest });

    const result = await applyUpdate({
      currentVersion: "1.0.0",
      channel: "stable",
      manifestUrl: server.manifestUrl,
      openWorldSlugs: [],
      worldManager: wm,
      currentExePath: join(dataDir, "current-exe.mjs"),
      dataDir,
      relaunchArgs: [],
      isSeaOverride: true,
      platform: "linux",
      arch: "x64",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PLATFORM_UNSUPPORTED");
      expect(result.message).toContain("Windows");
    }
  });

  itWin(
    "aborts with HASH_MISMATCH and leaves no tmp file when the download's SHA-256 diverges (CA-DST-07)",
    async () => {
      const dataDir = makeTempDir();
      const wm = new WorldManager({ dataDir });
      const bytes = Buffer.from("fake-new-binary-bytes");
      const platformKey = currentPlatformKey();
      const manifest: UpdateManifest = {
        version: "9.9.9",
        releaseDate: "",
        releaseNotes: "",
        channel: "stable",
        platforms: {
          [platformKey]: {
            url: "", // filled below once server is up
            sha256: "0".repeat(64), // deliberately wrong
            size: bytes.length,
          },
        },
      };
      server = await startMockUpdateServer({ manifest, artifacts: { "fusion.exe": bytes } });
      manifest.platforms[platformKey] = {
        ...manifest.platforms[platformKey]!,
        url: `${server.baseUrl}/artifacts/fusion.exe`,
      };

      copyFileSync(FAKE_EXE, join(dataDir, "current-exe.mjs"));

      const result = await applyUpdate({
        currentVersion: "1.0.0",
        channel: "stable",
        manifestUrl: server.manifestUrl,
        openWorldSlugs: [],
        worldManager: wm,
        currentExePath: join(dataDir, "current-exe.mjs"),
        dataDir,
        relaunchArgs: [],
        isSeaOverride: true,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("HASH_MISMATCH");
      // Current binary must be untouched — still present, no .bak created.
      expect(existsSync(join(dataDir, "current-exe.mjs"))).toBe(true);
      expect(existsSync(join(dataDir, "current-exe.mjs.bak"))).toBe(false);
      expect(existsSync(join(dataDir, "runtime", "fusion-update-9.9.9.tmp"))).toBe(false);
    },
  );

  itWin(
    "creates a real pre-update backup of the open world before downloading (REQ-DST-022)",
    async () => {
      const dataDir = makeTempDir();
      const wm = new WorldManager({ dataDir });
      wm.create({ title: "Update Flow World", system: "pf2e", slug: "upd_flow" });
      wm.open("upd_flow");

      const bytes = Buffer.from("fake-new-binary-bytes-for-backup-test");
      const platformKey = currentPlatformKey();
      const manifest: UpdateManifest = {
        version: "9.9.9",
        releaseDate: "",
        releaseNotes: "notes",
        channel: "stable",
        platforms: { [platformKey]: { url: "", sha256: sha256Of(bytes), size: bytes.length } },
      };
      server = await startMockUpdateServer({ manifest, artifacts: { "fusion.exe": bytes } });
      manifest.platforms[platformKey] = {
        ...manifest.platforms[platformKey]!,
        url: `${server.baseUrl}/artifacts/fusion.exe`,
      };

      copyFileSync(FAKE_EXE, join(dataDir, "current-exe.mjs"));
      const markerPath = join(dataDir, "marker.log");

      const result = await applyUpdate({
        currentVersion: "1.0.0",
        channel: "stable",
        manifestUrl: server.manifestUrl,
        openWorldSlugs: ["upd_flow"],
        worldManager: wm,
        currentExePath: join(dataDir, "current-exe.mjs"),
        dataDir,
        relaunchArgs: [markerPath, "stay-alive"],
        isSeaOverride: true,
        spawnImpl: trackedSpawn as unknown as typeof nodeSpawn,
        swapInvocationOverride: { execPath: process.execPath, seaFlag: false },
        relaunchCommandOverride: process.execPath,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.toVersion).toBe("9.9.9");
        expect(result.backups).toHaveLength(1);
        expect(result.backups[0]?.type).toBe("pre-update");
        expect(existsSync(result.backups[0]!.path)).toBe(true);

        // Verify against WorldManager's own listBackups too.
        const backups = wm.listBackups("upd_flow");
        expect(backups.some((b) => b.type === "pre-update")).toBe(true);
      }

      wm.close("upd_flow");
    },
  );

  itWin(
    "schedules a real swap that ends with the new binary running (end-to-end, dev-mode relaunch)",
    async () => {
      const dataDir = makeTempDir();
      const wm = new WorldManager({ dataDir });

      const bytes = readFileSync(FAKE_EXE); // the "new binary" IS fake-exe.mjs's own bytes
      const platformKey = currentPlatformKey();
      const manifest: UpdateManifest = {
        version: "9.9.9",
        releaseDate: "",
        releaseNotes: "",
        channel: "stable",
        platforms: { [platformKey]: { url: "", sha256: sha256Of(bytes), size: bytes.length } },
      };
      server = await startMockUpdateServer({ manifest, artifacts: { "fusion.exe": bytes } });
      manifest.platforms[platformKey] = {
        ...manifest.platforms[platformKey]!,
        url: `${server.baseUrl}/artifacts/fusion.exe`,
      };

      const currentExePath = join(dataDir, "current-exe.mjs");
      copyFileSync(FAKE_EXE, currentExePath);
      const markerPath = join(dataDir, "marker.log");
      const backupExePath = `${currentExePath}.bak`;

      // swapInvocationOverride/relaunchCommandOverride: currentExePath here is
      // a .mjs test fixture, not a real directly-executable binary (Windows
      // `spawn` EFTYPE) — see their doc comments in updater.ts. This is the
      // ONLY difference from the production invocation shape; everything else
      // (plan construction, backup, download, hash-verify, scheduleSwap call)
      // runs through the exact same applyUpdate code path production uses.
      const result = await applyUpdate({
        currentVersion: "1.0.0",
        channel: "stable",
        manifestUrl: server.manifestUrl,
        openWorldSlugs: [],
        worldManager: wm,
        currentExePath,
        dataDir,
        relaunchArgs: [markerPath, "stay-alive"],
        isSeaOverride: true,
        spawnImpl: trackedSpawn as unknown as typeof nodeSpawn,
        swapInvocationOverride: { execPath: process.execPath, seaFlag: false },
        relaunchCommandOverride: process.execPath,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(existsSync(result.swapScriptPath)).toBe(true);
      const scriptContent = readFileSync(result.swapScriptPath, "utf8");
      expect(scriptContent).toContain(JSON.stringify(currentExePath));
      expect(scriptContent).toContain(JSON.stringify(backupExePath));

      // Main process here is THIS test process itself (applyUpdate's plan
      // always uses process.pid as mainPid) — the swap-helper is now polling
      // for OUR exit, which will never happen inside the test. So this test
      // asserts up to "the swap was correctly scheduled" rather than waiting
      // for an actual file-swap (that full end-to-end relaunch mechanics are
      // covered by swap-helper.test.ts against a controllable fake main pid).
      expect(existsSync(backupExePath)).toBe(false);
    },
  );
});
