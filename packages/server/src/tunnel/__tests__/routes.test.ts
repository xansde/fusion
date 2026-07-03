/**
 * Integration tests for POST /admin/network/tunnel (M6/B4), via a real
 * boot() + fastify.inject.
 *
 * Covers the M6 security-audit follow-ups:
 *  - FIX-4 (defense in depth): {action:"start"} refuses with 403 when
 *    setupCompleted=false, even with a valid Bearer.
 *  - FIX-5: a request with no body / no Content-Type returns a typed 400
 *    instead of a raw 500 (request.body?.action, not request.body.action).
 *  - Baseline: {action:"start"} succeeds post-setup with a valid Bearer;
 *    {action:"stop"} and an unknown action are unaffected.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../config.js";
import { createLogger } from "../../logger.js";
import { boot } from "../../boot.js";
import type { BootResult } from "../../boot.js";
import { ensureDataDirLayout } from "../../data-dir.js";
import { TunnelManager } from "../tunnel-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const openServers: BootResult[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-tunnel-routes-"));
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
  vi.restoreAllMocks();
});

async function bootWithTunnel(
  dataDir: string,
  port = 0,
): Promise<{ server: BootResult; tunnelManager: TunnelManager }> {
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port, dataDir, logLevel: "silent" },
  });
  ensureDataDirLayout(config.dataDir, { logger: createLogger("silent") });

  const logger = createLogger("silent");
  const tunnelManager = new TunnelManager({ dataDir: config.dataDir, port: config.port, logger });
  // Never actually spawn cloudflared in these tests — only the auth/guard
  // behaviour of the ROUTE is under test here (TunnelManager's own
  // lifecycle is covered by tunnel-manager.test.ts). getState() is also
  // stubbed since the route handler reads it right after start()/stop() to
  // build the response envelope, and the real implementation only updates
  // it from inside the (bypassed) child-process event handlers.
  vi.spyOn(tunnelManager, "start").mockImplementation(async () => {
    vi.spyOn(tunnelManager, "getState").mockReturnValue({
      status: "running",
      tunnelUrl: "https://fake.trycloudflare.com",
      error: undefined,
    });
    return "https://fake.trycloudflare.com";
  });
  vi.spyOn(tunnelManager, "stop").mockImplementation(async () => {
    vi.spyOn(tunnelManager, "getState").mockReturnValue({
      status: "stopped",
      tunnelUrl: undefined,
      error: undefined,
    });
  });

  const server = await boot({
    config,
    logger,
    skipSignalHandlers: true,
    tunnelContext: { tunnelManager, dataDir: config.dataDir, logger },
  });
  openServers.push(server);
  return { server, tunnelManager };
}

async function completeSetup(server: BootResult, dataDir: string, port: number): Promise<string> {
  const res = await server.fastify.inject({
    method: "POST",
    url: "/admin/setup/apply",
    payload: { dataDir, port, adminKey: "tunnel-route-test-key" },
  });
  return res.json<{ adminToken: string }>().adminToken;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /admin/network/tunnel — FIX-4 defense in depth (setupCompleted guard)", () => {
  it('refuses {action:"start"} with 403 when setupCompleted=false, even with a Bearer from a PRIOR completed setup', async () => {
    // Simulate the edge case the fix targets: a Bearer that is cryptographically
    // valid (signed with the CURRENT jwtHmacSecret) but setupCompleted has
    // since been flipped back to false (e.g. an in-progress data-dir move).
    // We approximate this by completing setup, then writing setupCompleted
    // back to false directly to Config/fusion.json while keeping the same
    // jwtHmacSecret, without going through a second apply().
    const dataDir = makeTempDataDir();
    const port = 33801;
    const { server, tunnelManager } = await bootWithTunnel(dataDir, port);
    const adminToken = await completeSetup(server, dataDir, port);

    const { writeFusionConfig } = await import("../../data-dir.js");
    writeFusionConfig(dataDir, { setupCompleted: false });

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/network/tunnel",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { action: "start" },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ ok: boolean; code: string }>();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("SETUP_NOT_COMPLETED");
    expect(tunnelManager.start).not.toHaveBeenCalled();
  });

  it('allows {action:"start"} post-setup with a valid Bearer', async () => {
    const dataDir = makeTempDataDir();
    const port = 33802;
    const { server, tunnelManager } = await bootWithTunnel(dataDir, port);
    const adminToken = await completeSetup(server, dataDir, port);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/network/tunnel",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { action: "start" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; enabled: boolean; url: string | null }>();
    expect(body.ok).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.url).toBe("https://fake.trycloudflare.com");
    expect(tunnelManager.start).toHaveBeenCalledTimes(1);
  });

  it('{action:"stop"} is unaffected by the setupCompleted guard', async () => {
    const dataDir = makeTempDataDir();
    const port = 33803;
    const { server, tunnelManager } = await bootWithTunnel(dataDir, port);
    const adminToken = await completeSetup(server, dataDir, port);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/network/tunnel",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { action: "stop" },
    });

    expect(res.statusCode).toBe(200);
    expect(tunnelManager.stop).toHaveBeenCalledTimes(1);
  });

  it("still requires a Bearer regardless of setupCompleted (401, not 403, without one)", async () => {
    const dataDir = makeTempDataDir();
    const port = 33804;
    const { server } = await bootWithTunnel(dataDir, port);
    await completeSetup(server, dataDir, port);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/network/tunnel",
      payload: { action: "start" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /admin/network/tunnel — FIX-5 (typed 400 on missing body)", () => {
  it("returns 400 (not 500) when the request has no body at all", async () => {
    const dataDir = makeTempDataDir();
    const port = 33805;
    const { server } = await bootWithTunnel(dataDir, port);
    const adminToken = await completeSetup(server, dataDir, port);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/network/tunnel",
      headers: { authorization: `Bearer ${adminToken}` },
      // No payload, no Content-Type — request.body is undefined at the handler.
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ ok: boolean; code: string }>();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for an empty JSON object body", async () => {
    const dataDir = makeTempDataDir();
    const port = 33806;
    const { server } = await bootWithTunnel(dataDir, port);
    const adminToken = await completeSetup(server, dataDir, port);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/network/tunnel",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for an unrecognized action value", async () => {
    const dataDir = makeTempDataDir();
    const port = 33807;
    const { server } = await bootWithTunnel(dataDir, port);
    const adminToken = await completeSetup(server, dataDir, port);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/network/tunnel",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { action: "not-a-real-action" },
    });

    expect(res.statusCode).toBe(400);
  });
});
