/**
 * Tests for TunnelManager lifecycle (M6/B4 — REQ-DST-034).
 *
 * Uses a real child process (Node running fixtures/fake-cloudflared.mjs) in
 * place of the real cloudflared binary — this exercises the actual
 * spawn/parse/kill machinery (not a mocked child_process), matching how the
 * class is used in production, while staying fully offline and fast.
 *
 * ensureCloudflared itself is bypassed here by injecting spawnImpl directly
 * and pre-seeding a valid cached binary + sidecar hash so start() skips the
 * download step entirely and goes straight to spawning — download/hash
 * behaviour is covered separately in downloader.test.ts.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, platform as osPlatform, arch as osArch } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { TunnelManager, TunnelStartError } from "../tunnel-manager.js";
import { cloudflaredBinaryName } from "../cloudflared-releases.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "fake-cloudflared.mjs");

const tempDirs: string[] = [];
function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-tunnel-mgr-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Pre-seed <dataDir>/runtime/<binaryName> + its sidecar hash so
 * ensureCloudflared's cache-hit path is taken (no real download attempted)
 * regardless of platform. The "binary" content is irrelevant — spawnImpl is
 * overridden below to always launch Node on the fixture script instead of
 * actually executing this file.
 */
function seedFakeCachedBinary(dataDir: string): void {
  const runtimeDir = join(dataDir, "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const binPath = join(runtimeDir, cloudflaredBinaryName());
  const content = Buffer.from("not a real binary — spawnImpl is overridden in tests");
  writeFileSync(binPath, content);
  writeFileSync(`${binPath}.sha256`, createHash("sha256").update(content).digest("hex"), "utf8");
}

/**
 * spawnImpl override: ignores the real binPath/args cloudflared would get
 * and instead runs `node fixtures/fake-cloudflared.mjs <mode>`, forwarding
 * stdout/stderr exactly like a real spawned cloudflared would provide them
 * to TunnelManager.
 */
function fakeSpawnImpl(mode: string): typeof nodeSpawn {
  return ((_command: string, _args?: readonly string[]) => {
    return nodeSpawn(process.execPath, [FIXTURE, mode], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }) as unknown as typeof nodeSpawn;
}

const spawnedChildren: ChildProcess[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
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
  vi.restoreAllMocks();
});

describe("TunnelManager lifecycle", () => {
  it("start() resolves with the parsed public URL once the child prints it", async () => {
    const dataDir = makeTempDataDir();
    seedFakeCachedBinary(dataDir);

    const manager = new TunnelManager({
      dataDir,
      port: 33000,
      platform: osPlatform(),
      arch: osArch(),
      spawnImpl: fakeSpawnImpl("success"),
    });

    const url = await manager.start();
    expect(url).toBe("https://fake-tunnel-test.trycloudflare.com");
    expect(manager.isRunning()).toBe(true);
    expect(manager.getState()).toEqual({
      status: "running",
      tunnelUrl: "https://fake-tunnel-test.trycloudflare.com",
      error: undefined,
    });

    await manager.stop();
  });

  it("stop() kills the child process and resets state to stopped", async () => {
    const dataDir = makeTempDataDir();
    seedFakeCachedBinary(dataDir);

    const manager = new TunnelManager({
      dataDir,
      port: 33000,
      platform: osPlatform(),
      arch: osArch(),
      spawnImpl: fakeSpawnImpl("success"),
    });

    await manager.start();
    expect(manager.isRunning()).toBe(true);

    await manager.stop();
    expect(manager.isRunning()).toBe(false);
    expect(manager.getState().status).toBe("stopped");
    expect(manager.getState().tunnelUrl).toBeUndefined();
  });

  it("stop() force-kills (SIGKILL) a child that ignores SIGTERM", async () => {
    const dataDir = makeTempDataDir();
    seedFakeCachedBinary(dataDir);

    const manager = new TunnelManager({
      dataDir,
      port: 33000,
      platform: osPlatform(),
      arch: osArch(),
      spawnImpl: fakeSpawnImpl("ignore-sigterm"),
    });

    await manager.start();
    expect(manager.isRunning()).toBe(true);

    // stop() has an internal 3s SIGKILL fallback timer — this proves the
    // process is guaranteed to end up terminated even when the child is
    // stubborn, so the server never leaves an orphaned cloudflared process.
    await manager.stop();
    expect(manager.isRunning()).toBe(false);
  }, 10_000);

  it("start() rejects with TunnelStartError when the child exits before printing a URL", async () => {
    const dataDir = makeTempDataDir();
    seedFakeCachedBinary(dataDir);

    const manager = new TunnelManager({
      dataDir,
      port: 33000,
      platform: osPlatform(),
      arch: osArch(),
      spawnImpl: fakeSpawnImpl("crash"),
    });

    await expect(manager.start()).rejects.toThrow(TunnelStartError);
    expect(manager.getState().status).toBe("error");
  });

  it("start() rejects with TunnelStartError on timeout when no URL is ever printed", async () => {
    const dataDir = makeTempDataDir();
    seedFakeCachedBinary(dataDir);

    const manager = new TunnelManager({
      dataDir,
      port: 33000,
      platform: osPlatform(),
      arch: osArch(),
      spawnImpl: fakeSpawnImpl("never-prints"),
      urlTimeoutMs: 300,
    });

    await expect(manager.start()).rejects.toThrow(TunnelStartError);
    expect(manager.getState().status).toBe("error");

    // The timed-out child must still be killed, not left running.
    await manager.stop();
  });

  it("onStateChange fires for each transition (starting -> running -> stopped)", async () => {
    const dataDir = makeTempDataDir();
    seedFakeCachedBinary(dataDir);

    const manager = new TunnelManager({
      dataDir,
      port: 33000,
      platform: osPlatform(),
      arch: osArch(),
      spawnImpl: fakeSpawnImpl("success"),
    });

    const statuses: string[] = [];
    const unsubscribe = manager.onStateChange((state) => statuses.push(state.status));

    await manager.start();
    await manager.stop();
    unsubscribe();

    expect(statuses).toEqual(["starting", "running", "stopped"]);
  });

  it("start() is idempotent while already running (returns the same URL without re-spawning)", async () => {
    const dataDir = makeTempDataDir();
    seedFakeCachedBinary(dataDir);

    const spawnImpl = vi.fn(fakeSpawnImpl("success"));
    const manager = new TunnelManager({
      dataDir,
      port: 33000,
      platform: osPlatform(),
      arch: osArch(),
      spawnImpl: spawnImpl as unknown as typeof nodeSpawn,
    });

    const first = await manager.start();
    const second = await manager.start();

    expect(second).toBe(first);
    expect(spawnImpl).toHaveBeenCalledTimes(1);

    await manager.stop();
  });
});
