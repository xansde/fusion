/**
 * Verifies boot()'s own non-blocking update check (REQ-DST-019/020 — "o
 * servidor inicia normalmente mesmo se a verificação falhar"): a boot with
 * an updateContext pointed at an UNREACHABLE endpoint must still complete
 * promptly and serve requests, and GET /admin/update/check afterwards must
 * report `checked: false` rather than hanging or crashing the process.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../config.js";
import { createLogger } from "../../logger.js";
import { boot } from "../../boot.js";
import type { BootResult, BootUpdateContext } from "../../boot.js";
import { ensureDataDirLayout } from "../../data-dir.js";
import { WorldManager } from "../../worlds/world-manager.js";

const tempDirs: string[] = [];
const openServers: BootResult[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-update-nonblocking-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const result of openServers.splice(0)) {
    await result.shutdown();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("boot() with an unreachable update endpoint", () => {
  it("completes boot promptly (does not block on the update check) and serves /health", async () => {
    const dataDir = makeTempDataDir();
    const config = loadConfig({
      dataDirOverride: dataDir,
      cliOverrides: { port: 33810, dataDir, logLevel: "silent" },
    });
    const logger = createLogger("silent");
    ensureDataDirLayout(config.dataDir, { logger });
    const worldManager = new WorldManager({ dataDir: config.dataDir });

    const updateContext: BootUpdateContext = {
      dataDir: config.dataDir,
      currentVersion: "1.0.0",
      getChannel: () => "stable",
      getUpdateRepo: () => undefined,
      worldManager,
      getOpenWorldSlugs: () => [],
      relaunchArgs: [],
      // Port 1 on localhost: nothing listens there — connection refused
      // fast, but this also exercises the timeout path if the OS is slow to
      // refuse. Either way boot() itself must not await this.
      manifestUrl: "http://127.0.0.1:1/latest-stable.json",
      logger,
    };

    const startedAt = Date.now();
    const result = await boot({ config, logger, skipSignalHandlers: true, updateContext });
    openServers.push(result);
    const bootDurationMs = Date.now() - startedAt;

    // boot() must not have waited for the update check's own (default 5s)
    // timeout — a generous 2s ceiling proves it returned without blocking.
    expect(bootDurationMs).toBeLessThan(2000);

    const health = await result.fastify.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });

  it("GET /admin/update/check reports checked=false for an unreachable endpoint rather than hanging", async () => {
    const dataDir = makeTempDataDir();
    const config = loadConfig({
      dataDirOverride: dataDir,
      cliOverrides: { port: 33811, dataDir, logLevel: "silent" },
    });
    const logger = createLogger("silent");
    ensureDataDirLayout(config.dataDir, { logger });
    const worldManager = new WorldManager({ dataDir: config.dataDir });

    const updateContext: BootUpdateContext = {
      dataDir: config.dataDir,
      currentVersion: "1.0.0",
      getChannel: () => "stable",
      getUpdateRepo: () => undefined,
      worldManager,
      getOpenWorldSlugs: () => [],
      relaunchArgs: [],
      manifestUrl: "http://127.0.0.1:1/latest-stable.json",
      fetchImpl: (async () => {
        throw new Error("simulated network failure");
      }) as unknown as typeof fetch,
      logger,
    };

    const result = await boot({ config, logger, skipSignalHandlers: true, updateContext });
    openServers.push(result);

    const applyRes = await result.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: 33811, adminKey: "nonblocking-test-key" },
    });
    const { adminToken } = applyRes.json<{ adminToken: string }>();

    const res = await result.fastify.inject({
      method: "GET",
      url: "/admin/update/check",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ checked: boolean; reason?: string }>();
    expect(body.checked).toBe(false);
    expect(body.reason).toBeDefined();
  }, 10000);
});
