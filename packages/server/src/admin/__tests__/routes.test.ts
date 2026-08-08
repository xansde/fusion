/**
 * Integration tests for /admin/* routes (M6/B2), via a real boot() + fastify.inject.
 *
 * Covers the full REQ-DST-011..015/015A flow:
 *  - fresh install → /admin/setup/state reports setupCompleted=false
 *  - /admin/setup/check-port reports availability + suggestion
 *  - /admin/setup/apply (no Bearer, first run) → setupCompleted=true,
 *    Admin Key hash on disk (never plaintext, negative grep), admin token works
 *  - after setup completes, /admin/setup/apply and /admin/network require Bearer
 *  - /admin/login re-authenticates with the Admin Key and mints a fresh token
 *  - a wrong Admin Key is rejected
 *  - /admin/network exposes LAN URLs and a `tunnel: null` placeholder for B4
 *
 * Security-audit follow-ups (post B2+B4 audit):
 *  - resolveCurrentPort always reflects the REAL boot-time port for
 *    lan.urls/QR/self-conflict, never the disk-persisted "next boot" port —
 *    see the disk-vs-boot regression test below.
 *  - /admin/setup/state and /admin/setup/check-port require Bearer once
 *    setupCompleted=true (state degrades to a minimal body instead of a
 *    hard 401, since the client's boot router needs to know setupCompleted
 *    before it has ever obtained a token); both remain open pre-setup.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../config.js";
import { createLogger } from "../../logger.js";
import { boot } from "../../boot.js";
import type { BootResult } from "../../boot.js";
import { ensureDataDirLayout } from "../../data-dir.js";
import { listeningPort, holdPort, reserveFreePort } from "../../__tests__/helpers/ports.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const openServers: BootResult[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-admin-routes-"));
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

async function bootManagementServer(dataDir: string): Promise<BootResult> {
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: await reserveFreePort(), dataDir, logLevel: "silent" },
  });
  ensureDataDirLayout(config.dataDir, { logger: createLogger("silent") });

  const logger = createLogger("silent");
  const result = await boot({ config, logger, skipSignalHandlers: true });
  openServers.push(result);
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/admin/setup/state", () => {
  it("reports setupCompleted=false on a fresh install", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    const res = await server.fastify.inject({ method: "GET", url: "/admin/setup/state" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; state: { setupCompleted: boolean } }>();
    expect(body.ok).toBe(true);
    expect(body.state.setupCompleted).toBe(false);
  });

  it("never leaks adminPasswordHash or jwtHmacSecret", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    const res = await server.fastify.inject({ method: "GET", url: "/admin/setup/state" });
    const raw = res.body;
    expect(raw).not.toContain("adminPasswordHash");
    expect(raw).not.toContain("jwtHmacSecret");
  });
});

describe("/admin/setup/check-port", () => {
  it("reports an ephemeral port as available", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/check-port",
      payload: { port: 41234 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; available: boolean }>();
    expect(body.ok).toBe(true);
    expect(typeof body.available).toBe("boolean");
  });

  it("rejects an out-of-range port with 400", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/check-port",
      payload: { port: 80 }, // below 1024
    });
    expect(res.statusCode).toBe(400);
  });

  it("reports the server's OWN current port as available (never self-conflicts)", async () => {
    // A raw bind-probe against the port this very process is listening on
    // would always report "in use" (itself!) — the wizard must special-case
    // this so re-opening /setup on an already-configured server does not
    // show a false "port in use" for the port it is actively serving from.
    // Here "the port this process is listening on" IS the boot-time port
    // (fastify.listen() already bound it for real — no extra listener needed
    // to simulate occupancy), which is what check-port must compare against
    // post-setup — see the disk-vs-boot regression test below for the case
    // where those diverge.
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);
    const bootPort = listeningPort(server.fastify);

    const applyRes = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: bootPort, adminKey: "self-port-test-key" },
    });
    const { adminToken } = applyRes.json<{ adminToken: string }>();

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/check-port",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { port: bootPort },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; available: boolean }>();
    expect(body.available).toBe(true);
  });

  it("REGRESSION: boot port (not the persisted disk port) drives lan.urls/QR and the check-port self-conflict when they diverge", async () => {
    // Reproduces the exact scenario from the B2+B4 security audit: setup was
    // completed once with one port persisted to disk, but THIS boot was
    // started on a DIFFERENT port from what is on disk (e.g. the GM passed
    // --port on the command line after a prior reconfiguration that has not
    // been restarted into yet). Before the fix, resolveCurrentPort() preferred
    // the disk value for lan.urls/QR/self-conflict — pointing the GM's invite
    // links at a dead port and making check-port fail to recognize the port
    // ACTUALLY bound as this server's own, so a subsequent apply() on it would
    // 409 against itself.
    const dataDir = makeTempDataDir();

    // First boot: complete setup with diskPort persisted to Config/fusion.json.
    const firstServer = await bootManagementServer(dataDir);
    const diskPort = listeningPort(firstServer.fastify);
    const firstApply = await firstServer.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: diskPort, adminKey: "disk-vs-boot-key" },
    });
    expect(firstApply.statusCode).toBe(200);
    await firstServer.shutdown();

    // The whole point of this test is that the two ports DIVERGE, so the
    // second boot must not be handed diskPort back now that it is free.
    const releaseDiskPort = await holdPort(diskPort);

    // Second boot: same dataDir (disk still has diskPort persisted), but
    // this process is actually started bound to bootPort — simulating an
    // operator-supplied --port that diverges from the persisted value.
    const server = await bootManagementServer(dataDir);
    const bootPort = listeningPort(server.fastify);
    await releaseDiskPort();
    expect(bootPort).not.toBe(diskPort);

    // /admin/setup/state must report the REAL boot port for currentPort/
    // lanUrls, with the disk value surfaced separately and explicitly.
    const applyRes = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: bootPort, adminKey: "disk-vs-boot-key" },
    });
    // Re-applying the boot port on top of an already-completed setup
    // requires Bearer from the FIRST apply's token (still valid — same
    // jwtHmacSecret persisted at dataDir).
    expect(applyRes.statusCode).toBe(401);
    const { adminToken } = firstApply.json<{ adminToken: string }>();

    const stateRes = await server.fastify.inject({
      method: "GET",
      url: "/admin/setup/state",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(stateRes.statusCode).toBe(200);
    const stateBody = stateRes.json<{
      state: { currentPort: number; configuredPortNextBoot: number; lanUrls: string[] };
    }>();
    expect(stateBody.state.currentPort).toBe(bootPort);
    expect(stateBody.state.configuredPortNextBoot).toBe(diskPort);
    for (const url of stateBody.state.lanUrls) {
      expect(url).toContain(`:${String(bootPort)}`);
      expect(url).not.toContain(`:${String(diskPort)}`);
    }

    // check-port's self-conflict special-case must recognize bootPort (the
    // REAL bound port) as "this server's own port" — not diskPort.
    const checkBootPort = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/check-port",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { port: bootPort },
    });
    expect(checkBootPort.statusCode).toBe(200);
    expect(checkBootPort.json<{ available: boolean }>().available).toBe(true);

    // /admin/network's lan.port/urls must also reflect the real boot port.
    const networkRes = await server.fastify.inject({
      method: "GET",
      url: "/admin/network",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(networkRes.statusCode).toBe(200);
    const networkBody = networkRes.json<{ lan: { port: number } }>();
    expect(networkBody.lan.port).toBe(bootPort);
  });

  it("reports the server's OWN current port as available BEFORE setup has ever completed (fresh install with explicit --port)", async () => {
    // Regression test: on a truly fresh install, Config/fusion.json has no
    // `port` key at all (applySetup never ran), so a naive
    // readLiveConfig(dataDir).port falls back to the zod schema default
    // (33000) — NOT the port this process was actually booted with via
    // --port. If the operator picks a non-default port for the very first
    // boot (e.g. 33000 is occupied by something else), the wizard's own
    // self-port check must still recognize its own port as "available"
    // instead of reporting it in use to itself.
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);
    const explicitPort = listeningPort(server.fastify);

    // Confirm the fresh-install precondition: nothing persisted yet.
    const stateRes = await server.fastify.inject({ method: "GET", url: "/admin/setup/state" });
    const stateBody = stateRes.json<{ state: { setupCompleted: boolean; currentPort: number } }>();
    expect(stateBody.state.setupCompleted).toBe(false);
    expect(stateBody.state.currentPort).toBe(explicitPort);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/check-port",
      payload: { port: explicitPort },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; available: boolean }>();
    expect(body.available).toBe(true);
  });
});

describe("/admin/setup/state and /admin/setup/check-port — post-setup auth guard", () => {
  /** Applies setup on the port the server is really bound to — see helpers/ports.ts. */
  async function completeSetup(server: BootResult, dataDir: string): Promise<string> {
    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: listeningPort(server.fastify), adminKey: "post-setup-guard-key" },
    });
    return res.json<{ adminToken: string }>().adminToken;
  }

  it("GET /admin/setup/state without a Bearer returns ONLY { setupCompleted: true } post-setup — no dataDir/LAN/version leak", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);
    await completeSetup(server, dataDir);

    const res = await server.fastify.inject({ method: "GET", url: "/admin/setup/state" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; state: Record<string, unknown> }>();
    expect(body.state).toEqual({ setupCompleted: true });
    // Explicitly prove the sensitive fields are absent, not just unchecked.
    expect(body.state["currentDataDir"]).toBeUndefined();
    expect(body.state["lanUrls"]).toBeUndefined();
    expect(body.state["serverVersion"]).toBeUndefined();
    expect(res.body).not.toContain(dataDir);
  });

  it("GET /admin/setup/state WITH a valid Bearer returns the full state post-setup", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);
    const token = await completeSetup(server, dataDir);

    const res = await server.fastify.inject({
      method: "GET",
      url: "/admin/setup/state",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ state: { currentDataDir: string; lanUrls: string[] } }>();
    expect(body.state.currentDataDir).toBe(dataDir);
    expect(Array.isArray(body.state.lanUrls)).toBe(true);
  });

  it("GET /admin/setup/state is still fully open PRE-setup (no Bearer needed for the wizard's own first load)", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    const res = await server.fastify.inject({ method: "GET", url: "/admin/setup/state" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ state: { setupCompleted: boolean; currentDataDir: string } }>();
    expect(body.state.setupCompleted).toBe(false);
    expect(body.state.currentDataDir).toBe(dataDir);
  });

  it("POST /admin/setup/check-port without a Bearer returns 401 post-setup", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);
    await completeSetup(server, dataDir);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/check-port",
      payload: { port: 41234 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /admin/setup/check-port WITH a valid Bearer works normally post-setup", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);
    const token = await completeSetup(server, dataDir);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/check-port",
      headers: { authorization: `Bearer ${token}` },
      payload: { port: 41235 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ available: boolean }>().available).toBeTypeOf("boolean");
  });

  it("POST /admin/setup/check-port is still fully open PRE-setup", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/check-port",
      payload: { port: 41236 },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("/admin/setup/apply — first run (no Bearer required)", () => {
  it("completes setup, hashes the Admin Key (never plaintext on disk), and returns a working token", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: listeningPort(server.fastify), adminKey: "wizard-admin-key-123" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; adminToken: string; lanUrls: string[] }>();
    expect(body.ok).toBe(true);
    expect(typeof body.adminToken).toBe("string");
    expect(Array.isArray(body.lanUrls)).toBe(true);

    // Negative test: the plaintext Admin Key must never appear on disk.
    const raw = readFileSync(join(dataDir, "Config", "fusion.json"), "utf8");
    expect(raw).not.toContain("wizard-admin-key-123");
    expect(raw).toContain("$argon2id$");

    const stateRes = await server.fastify.inject({ method: "GET", url: "/admin/setup/state" });
    const state = stateRes.json<{ state: { setupCompleted: boolean } }>();
    expect(state.state.setupCompleted).toBe(true);
  });

  it("re-validates port availability server-side and returns 409 on conflict", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    // Occupy a port explicitly (0.0.0.0, mirroring real server binds).
    const { createServer } = await import("node:net");
    const occupied = createServer();
    const occupiedPort = await new Promise<number>((resolve) => {
      occupied.listen(0, "0.0.0.0", () => {
        const addr = occupied.address();
        resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
      });
    });

    try {
      const res = await server.fastify.inject({
        method: "POST",
        url: "/admin/setup/apply",
        payload: { dataDir, port: occupiedPort, adminKey: "wizard-admin-key-456" },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json<{ ok: boolean; code: string }>();
      expect(body.ok).toBe(false);
      expect(body.code).toBe("PORT_IN_USE");
    } finally {
      occupied.close();
    }
  });
});

describe("/admin/* after setup is completed — Bearer required", () => {
  async function completeSetup(
    server: BootResult,
    dataDir: string,
    adminKey = "reconfig-admin-key",
  ): Promise<string> {
    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: listeningPort(server.fastify), adminKey },
    });
    const body = res.json<{ adminToken: string }>();
    return body.adminToken;
  }

  it("rejects /admin/setup/apply re-run without a Bearer token (401)", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);
    await completeSetup(server, dataDir);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: listeningPort(server.fastify), adminKey: "new-key-attempt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts /admin/setup/apply re-run WITH a valid Bearer token", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);
    const token = await completeSetup(server, dataDir);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      headers: { authorization: `Bearer ${token}` },
      payload: { dataDir, port: listeningPort(server.fastify), adminKey: "reconfig-admin-key" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects /admin/network without a Bearer token (401)", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);
    await completeSetup(server, dataDir);

    const res = await server.fastify.inject({ method: "GET", url: "/admin/network" });
    expect(res.statusCode).toBe(401);
  });

  it("returns LAN URLs and a tunnel:null placeholder from /admin/network with a valid Bearer", async () => {
    const dataDir = makeTempDataDir();
    // completeSetup() applies the port the server is really bound to, so
    // lan.port (which always reflects the real boot-time bind — see the
    // disk-vs-boot regression test above for the divergent case) matches it.
    const server = await bootManagementServer(dataDir);
    const token = await completeSetup(server, dataDir);

    const res = await server.fastify.inject({
      method: "GET",
      url: "/admin/network",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      ok: boolean;
      lan: { port: number; urls: string[] };
      tunnel: unknown;
    }>();
    expect(body.ok).toBe(true);
    expect(body.lan.port).toBe(listeningPort(server.fastify));
    expect(Array.isArray(body.lan.urls)).toBe(true);
    expect(body.tunnel).toBeNull();
  });

  it("rejects a malformed Authorization header", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);
    await completeSetup(server, dataDir);

    const res = await server.fastify.inject({
      method: "GET",
      url: "/admin/network",
      headers: { authorization: "not-a-bearer-token" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("/admin/login", () => {
  it("returns 409 when setup has not been completed yet", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/login",
      payload: { adminKey: "whatever" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("mints a fresh token given the correct Admin Key", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: listeningPort(server.fastify), adminKey: "login-test-key" },
    });

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/login",
      payload: { adminKey: "login-test-key" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; adminToken: string }>();
    expect(body.ok).toBe(true);
    expect(typeof body.adminToken).toBe("string");

    // The fresh token must actually authorize a guarded route.
    const networkRes = await server.fastify.inject({
      method: "GET",
      url: "/admin/network",
      headers: { authorization: `Bearer ${body.adminToken}` },
    });
    expect(networkRes.statusCode).toBe(200);
  });

  it("rejects a wrong Admin Key with 401", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: listeningPort(server.fastify), adminKey: "correct-key" },
    });

    const res = await server.fastify.inject({
      method: "POST",
      url: "/admin/login",
      payload: { adminKey: "wrong-key" },
    });
    expect(res.statusCode).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // REQ-SEC-011 — brute-force lockout (FIX-3): max 5 failed attempts per IP
  // in 15 minutes, then 429 with Retry-After. Reuses auth/lockout.ts's
  // LockoutStore against a dedicated admin-plane SQLite file.
  // ---------------------------------------------------------------------------

  it("returns 429 with Retry-After after 5 failed /admin/login attempts", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: listeningPort(server.fastify), adminKey: "lockout-test-key" },
    });

    for (let i = 0; i < 5; i++) {
      const res = await server.fastify.inject({
        method: "POST",
        url: "/admin/login",
        payload: { adminKey: "wrong-key" },
      });
      expect(res.statusCode).toBe(401);
    }

    // 6th attempt — even with the CORRECT key — must be locked out.
    const lockedRes = await server.fastify.inject({
      method: "POST",
      url: "/admin/login",
      payload: { adminKey: "lockout-test-key" },
    });
    expect(lockedRes.statusCode).toBe(429);
    expect(lockedRes.headers["retry-after"]).toBeDefined();
    expect(lockedRes.json<{ code: string }>().code).toBe("LOCKED_OUT");
  });

  it("clears the lockout counter and allows login again after a successful attempt", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: listeningPort(server.fastify), adminKey: "lockout-recover-key" },
    });

    // A few failures, but below the threshold.
    for (let i = 0; i < 3; i++) {
      await server.fastify.inject({
        method: "POST",
        url: "/admin/login",
        payload: { adminKey: "wrong-key" },
      });
    }

    // Successful login still works and clears failures.
    const successRes = await server.fastify.inject({
      method: "POST",
      url: "/admin/login",
      payload: { adminKey: "lockout-recover-key" },
    });
    expect(successRes.statusCode).toBe(200);

    // Further wrong attempts start counting from zero again.
    for (let i = 0; i < 4; i++) {
      const res = await server.fastify.inject({
        method: "POST",
        url: "/admin/login",
        payload: { adminKey: "wrong-key" },
      });
      expect(res.statusCode).toBe(401);
    }
    const stillOpenRes = await server.fastify.inject({
      method: "POST",
      url: "/admin/login",
      payload: { adminKey: "lockout-recover-key" },
    });
    expect(stillOpenRes.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: REQ-DST-011 redirect through a real boot() with the SPA
// mounted (not just /admin/* in isolation) — proves the whole "fresh install
// → wizard → normal app" journey works when the client build is present.
// Skips gracefully if this checkout has no packages/client/dist (mirrors
// spa/__tests__/routes.test.ts's own describe.runIf pattern).
// ---------------------------------------------------------------------------

describe("end-to-end: fresh install redirects to /setup, completing it unlocks /", () => {
  it("GET / redirects to /setup before setup, and serves the app after apply", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    const before = await server.fastify.inject({ method: "GET", url: "/" });
    // 302 (redirected to /setup) when a client build is present, or the SPA's
    // own graceful "no dist" 404 in a server-only checkout — either way this
    // must NEVER be 200 (the app shell) before setup completes.
    expect(before.statusCode).not.toBe(200);
    if (before.statusCode === 302) {
      expect(before.headers.location).toBe("/setup");
    }

    await server.fastify.inject({
      method: "POST",
      url: "/admin/setup/apply",
      payload: { dataDir, port: listeningPort(server.fastify), adminKey: "e2e-admin-key-12345" },
    });

    const after = await server.fastify.inject({ method: "GET", url: "/" });
    // Once setupCompleted flips to true, / must never redirect again — either
    // 200 (client build present) or the SPA's graceful "no dist" 404, but
    // NEVER a 302 to /setup.
    expect(after.statusCode).not.toBe(302);
  });

  // -------------------------------------------------------------------------
  // Real TCP/HTTP boot (not fastify.inject) — proves the wizard is reachable
  // over an actual socket, the same way a browser would hit it, not just
  // through Fastify's in-process request-injection shortcut.
  // -------------------------------------------------------------------------
  it("is reachable over a REAL HTTP socket end-to-end: fetch(/admin/setup/state) -> apply -> fetch(/admin/network)", async () => {
    const dataDir = makeTempDataDir();
    const server = await bootManagementServer(dataDir);

    const port = listeningPort(server.fastify);
    const baseUrl = `http://127.0.0.1:${String(port)}`;

    const stateRes = await fetch(`${baseUrl}/admin/setup/state`);
    expect(stateRes.status).toBe(200);
    const stateBody = (await stateRes.json()) as { state: { setupCompleted: boolean } };
    expect(stateBody.state.setupCompleted).toBe(false);

    const applyRes = await fetch(`${baseUrl}/admin/setup/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataDir, port, adminKey: "real-http-e2e-key" }),
    });
    expect(applyRes.status).toBe(200);
    const applyBody = (await applyRes.json()) as { adminToken: string };
    expect(typeof applyBody.adminToken).toBe("string");

    const networkRes = await fetch(`${baseUrl}/admin/network`, {
      headers: { Authorization: `Bearer ${applyBody.adminToken}` },
    });
    expect(networkRes.status).toBe(200);
    const networkBody = (await networkRes.json()) as { lan: { urls: string[] } };
    expect(Array.isArray(networkBody.lan.urls)).toBe(true);
  });
});
