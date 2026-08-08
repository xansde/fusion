/**
 * Integration tests for /admin/update/* routes (M6/B5 — REQ-DST-019..025),
 * via a real boot() + fastify.inject, against the local mock update server
 * (never the real GitHub API).
 *
 * Covers:
 *  - GET /admin/update/check without a Bearer -> 401
 *  - GET /admin/update/check with a valid Bearer -> reports update available
 *    with release notes when the mock manifest is newer (CA-DST-10)
 *  - GET /admin/update/check reports no update when already current (CA-DST-10)
 *  - POST /admin/update/apply without a Bearer -> 401
 *  - POST /admin/update/apply in dev (non-SEA) -> 400 NOT_SEA, clear message
 *  - POST /admin/update/apply pre-setup -> 403 SETUP_NOT_COMPLETED (FIX-3
 *    defense in depth, mirroring tunnel/routes.ts's FIX-4) — both on a
 *    fresh first-run install (where requireAdminAuth lets requests through
 *    Bearer-less) and with a stale-but-valid Bearer after setupCompleted
 *    was flipped back to false.
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
import { listeningPort, reserveFreePort } from "../../__tests__/helpers/ports.js";
import { WorldManager } from "../../worlds/world-manager.js";
import { startMockUpdateServer, type MockUpdateServer } from "./mock-update-server.js";
import type { UpdateManifest } from "../manifest-client.js";

const tempDirs: string[] = [];
const openServers: BootResult[] = [];
let mockServer: MockUpdateServer | undefined;

function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-update-routes-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const result of openServers.splice(0)) {
    await result.shutdown();
  }
  if (mockServer) {
    await mockServer.close();
    mockServer = undefined;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function bootWithUpdateContext(
  dataDir: string,
  manifest: UpdateManifest,
  overrides: Partial<BootUpdateContext> = {},
): Promise<BootResult> {
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: await reserveFreePort(), dataDir, logLevel: "silent" },
  });
  const logger = createLogger("silent");
  ensureDataDirLayout(config.dataDir, { logger });

  mockServer = await startMockUpdateServer({ manifest });
  const worldManager = new WorldManager({ dataDir: config.dataDir });

  const updateContext: BootUpdateContext = {
    dataDir: config.dataDir,
    currentVersion: "1.0.0",
    getChannel: () => "stable",
    getUpdateRepo: () => undefined,
    worldManager,
    getOpenWorldSlugs: () => [],
    relaunchArgs: [],
    manifestUrl: mockServer.manifestUrl,
    logger,
    ...overrides,
  };

  const result = await boot({ config, logger, skipSignalHandlers: true, updateContext });
  openServers.push(result);
  return result;
}

/** Applies setup on the port the server is really bound to — see helpers/ports.ts. */
async function completeSetup(server: BootResult, dataDir: string): Promise<string> {
  const res = await server.fastify.inject({
    method: "POST",
    url: "/admin/setup/apply",
    payload: { dataDir, port: listeningPort(server.fastify), adminKey: "update-routes-test-key" },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ adminToken: string }>().adminToken;
}

describe("GET /admin/update/check", () => {
  it("returns 401 without a Bearer once setup has completed", async () => {
    const dataDir = makeTempDataDir();
    const manifest: UpdateManifest = {
      version: "1.0.0",
      releaseDate: "",
      releaseNotes: "",
      channel: "stable",
      platforms: {},
    };
    const server = await bootWithUpdateContext(dataDir, manifest);
    await completeSetup(server, dataDir);

    const res = await server.fastify.inject({ method: "GET", url: "/admin/update/check" });
    expect(res.statusCode).toBe(401);
  });

  it("reports an available update with release notes when newer (CA-DST-10)", async () => {
    const dataDir = makeTempDataDir();
    const manifest: UpdateManifest = {
      version: "2.5.0",
      releaseDate: "2026-07-01T00:00:00.000Z",
      releaseNotes: "Big new feature",
      channel: "stable",
      platforms: {},
    };
    const server = await bootWithUpdateContext(dataDir, manifest);
    const adminToken = await completeSetup(server, dataDir);

    const res = await server.fastify.inject({
      method: "GET",
      url: "/admin/update/check",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      ok: boolean;
      checked: boolean;
      updateAvailable: boolean;
      latestVersion: string;
      releaseNotes: string;
    }>();
    expect(body.checked).toBe(true);
    expect(body.updateAvailable).toBe(true);
    expect(body.latestVersion).toBe("2.5.0");
    expect(body.releaseNotes).toBe("Big new feature");
  });

  it("reports no update available when current version is already the latest (CA-DST-10)", async () => {
    const dataDir = makeTempDataDir();
    const manifest: UpdateManifest = {
      version: "1.0.0",
      releaseDate: "",
      releaseNotes: "",
      channel: "stable",
      platforms: {},
    };
    const server = await bootWithUpdateContext(dataDir, manifest);
    const adminToken = await completeSetup(server, dataDir);

    const res = await server.fastify.inject({
      method: "GET",
      url: "/admin/update/check",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ checked: boolean; updateAvailable: boolean }>();
    expect(body.checked).toBe(true);
    expect(body.updateAvailable).toBe(false);
  });
});

describe("POST /admin/update/apply", () => {
  it("returns 401 without a Bearer once setup has completed", async () => {
    const dataDir = makeTempDataDir();
    const manifest: UpdateManifest = {
      version: "2.0.0",
      releaseDate: "",
      releaseNotes: "",
      channel: "stable",
      platforms: {},
    };
    const server = await bootWithUpdateContext(dataDir, manifest);
    await completeSetup(server, dataDir);

    const res = await server.fastify.inject({ method: "POST", url: "/admin/update/apply" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 NOT_SEA with a clear message in dev (non-SEA) (design doc §2.1 point 3)", async () => {
    const dataDir = makeTempDataDir();
    const manifest: UpdateManifest = {
      version: "2.0.0",
      releaseDate: "",
      releaseNotes: "",
      channel: "stable",
      platforms: {},
    };
    const server = await bootWithUpdateContext(dataDir, manifest);
    const adminToken = await completeSetup(server, dataDir);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/update/apply",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ ok: boolean; code: string; message: string }>();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("NOT_SEA");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("refuses with 403 SETUP_NOT_COMPLETED on a fresh install where setup never ran (FIX-3)", async () => {
    // The load-bearing scenario for FIX-3: requireAdminAuth deliberately
    // lets first-run requests through WITHOUT a Bearer (no Admin Key exists
    // yet — the wizard is the bootstrap), so before this fix an
    // unauthenticated caller on a fresh install could reach applyUpdate.
    const dataDir = makeTempDataDir();
    const manifest: UpdateManifest = {
      version: "2.0.0",
      releaseDate: "",
      releaseNotes: "",
      channel: "stable",
      platforms: {},
    };
    const server = await bootWithUpdateContext(dataDir, manifest);
    // Deliberately NO completeSetup() here.

    const res = await server.fastify.inject({ method: "POST", url: "/admin/update/apply" });
    expect(res.statusCode).toBe(403);
    const body = res.json<{ ok: boolean; code: string }>();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("SETUP_NOT_COMPLETED");
  });

  it("refuses with 403 even with a Bearer from a PRIOR completed setup when setupCompleted was flipped back (FIX-3)", async () => {
    // Mirrors tunnel/__tests__/routes.test.ts's FIX-4 test: a Bearer that is
    // cryptographically valid (signed with the CURRENT jwtHmacSecret) but
    // setupCompleted has since been flipped back to false (e.g. an
    // in-progress data-dir move re-bootstrap).
    const dataDir = makeTempDataDir();
    const manifest: UpdateManifest = {
      version: "2.0.0",
      releaseDate: "",
      releaseNotes: "",
      channel: "stable",
      platforms: {},
    };
    const server = await bootWithUpdateContext(dataDir, manifest);
    const adminToken = await completeSetup(server, dataDir);

    const { writeFusionConfig } = await import("../../data-dir.js");
    writeFusionConfig(dataDir, { setupCompleted: false });

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/update/apply",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json<{ ok: boolean; code: string }>();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("SETUP_NOT_COMPLETED");
  });
});
