/**
 * Integration tests for boot sequence and HTTP routes.
 *
 * Uses Fastify's `inject` method for in-process HTTP testing —
 * no real TCP socket is opened, so port conflicts are impossible.
 *
 * Covers:
 *  - GET /health response shape
 *  - protocolVersion matches @fusion/shared PROTOCOL_VERSION
 *  - Graceful shutdown (fastify.close())
 *  - Boot error on EADDRINUSE produces a user-friendly message
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { PROTOCOL_VERSION, FUSION_VERSION } from "@fusion/shared";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { boot } from "../boot.js";
import type { BootResult } from "../boot.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestConfig(portOverride?: number) {
  return loadConfig({
    dataDirOverride: process.env["TMPDIR"] ?? process.env["TMP"] ?? "/tmp",
    cliOverrides: {
      // Use a dedicated test port (or 0 for OS-assigned) so we do not
      // conflict with a real Fusion server or other test runs.
      port: portOverride ?? 0,
      logLevel: "silent",
    },
  });
}

function silentLogger() {
  return createLogger("silent");
}

/**
 * Builds a minimal fixture that mimics `packages/client/dist`: an
 * `index.html` with a module `<script>` tag plus one hashed asset under
 * `assets-client/`. Used to exercise SPA serving without depending on a real
 * client build being present at test time.
 */
function makeDistFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-spa-dist-"));
  // Mirrors the real client build's layout: packages/client/vite.config.ts
  // sets build.assetsDir: "assets-client", so hashed assets live physically
  // under dist/assets-client/ and index.html references them at that same
  // URL prefix — no serve-time rewrite happens (see spa/routes.ts doc comment).
  mkdirSync(join(dir, "assets-client"), { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html>
<html lang="en">
  <head><title>Fusion VTT</title></head>
  <body>
    <div id="fusion-app"></div>
    <script type="module" crossorigin src="/assets-client/index-abc123.js"></script>
  </body>
</html>`,
    "utf8",
  );
  writeFileSync(join(dir, "assets-client", "index-abc123.js"), "console.log('fixture');", "utf8");
  writeFileSync(join(dir, "favicon.svg"), "<svg></svg>", "utf8");
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("boot", () => {
  const openServers: BootResult[] = [];

  afterEach(async () => {
    // Clean up any servers that were not shut down inside the test.
    for (const result of openServers.splice(0)) {
      await result.shutdown();
    }
  });

  // -------------------------------------------------------------------------
  // GET /health
  // -------------------------------------------------------------------------

  it("GET /health returns { ok: true } with correct fields", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    openServers.push(result);

    const response = await result.fastify.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["version"]).toBe(FUSION_VERSION);
    expect(body["protocolVersion"]).toBe(PROTOCOL_VERSION);
  });

  it("GET /health returns the correct protocolVersion from @fusion/shared", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    openServers.push(result);

    const response = await result.fastify.inject({ method: "GET", url: "/health" });
    const body = JSON.parse(response.body) as { protocolVersion: unknown };

    // PROTOCOL_VERSION is a const — any drift from shared would fail here.
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  it("shutdown() closes the Fastify instance cleanly", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });

    // Should not throw.
    await expect(result.shutdown()).resolves.toBeUndefined();

    // Calling shutdown a second time is a no-op.
    await expect(result.shutdown()).resolves.toBeUndefined();
  });

  it("after shutdown, the server no longer responds", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    await result.shutdown();

    // Fastify.inject on a closed server throws or the server is closed.
    // We verify the server socket is closed by checking the underlying handle.
    const server = result.fastify.server;
    expect(server.listening).toBe(false);
  });

  // -------------------------------------------------------------------------
  // EADDRINUSE — friendly error message
  // -------------------------------------------------------------------------

  it("boot throws a friendly error when the port is already in use", async () => {
    const logger = silentLogger();

    // Boot a first server on port 0 so the OS assigns a free port.
    // This eliminates any chance of EADDRINUSE during setup, which would
    // previously cause a silent `catch { return; }` that masked the assertion.
    const config1 = makeTestConfig(0);
    const firstResult = await boot({ config: config1, logger, skipSignalHandlers: true });

    // Retrieve the actual OS-assigned port so we can attempt to reuse it.
    const address = firstResult.fastify.server.address();
    const assignedPort = typeof address === "object" && address !== null ? address.port : null;

    if (assignedPort === null) {
      await firstResult.shutdown();
      throw new Error("Could not determine the OS-assigned port from the first server");
    }

    try {
      // Attempt to boot a second server on the same (now occupied) port.
      const config2 = makeTestConfig(assignedPort);
      await expect(boot({ config: config2, logger, skipSignalHandlers: true })).rejects.toThrow(
        /is already in use/,
      );
    } finally {
      await firstResult.shutdown();
    }
  });

  // -------------------------------------------------------------------------
  // BootResult shape
  // -------------------------------------------------------------------------

  it("boot returns a result with config, logger, fastify, and shutdown", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    openServers.push(result);

    expect(result.config).toBeDefined();
    expect(result.logger).toBeDefined();
    expect(result.fastify).toBeDefined();
    expect(typeof result.shutdown).toBe("function");
  });

  it("returned config matches the config passed to boot", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    openServers.push(result);

    expect(result.config.logLevel).toBe("silent");
  });
});

// ---------------------------------------------------------------------------
// Fastify inject helper type safety check
// ---------------------------------------------------------------------------

describe("GET /health — response body types", () => {
  let fastify: FastifyInstance | undefined;

  afterEach(async () => {
    if (fastify !== undefined) {
      await fastify.close();
      fastify = undefined;
    }
  });

  it("ok field is boolean true", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    fastify = result.fastify;

    const res = await fastify.inject("/health");
    const body = res.json<{ ok: boolean }>();
    expect(typeof body.ok).toBe("boolean");
    expect(body.ok).toBe(true);
  });

  it("version field is a non-empty string", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    fastify = result.fastify;

    const res = await fastify.inject("/health");
    const body = res.json<{ version: string }>();
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });

  it("protocolVersion field is a positive integer", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    fastify = result.fastify;

    const res = await fastify.inject("/health");
    const body = res.json<{ protocolVersion: number }>();
    expect(typeof body.protocolVersion).toBe("number");
    expect(Number.isInteger(body.protocolVersion)).toBe(true);
    expect(body.protocolVersion).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SPA static serving (REQ-DST-002)
// ---------------------------------------------------------------------------

describe("SPA static serving", () => {
  let distDir: string | undefined;
  let fastify: FastifyInstance | undefined;

  afterEach(async () => {
    if (fastify !== undefined) {
      await fastify.close();
      fastify = undefined;
    }
    if (distDir !== undefined) {
      rmSync(distDir, { recursive: true, force: true });
      distDir = undefined;
    }
  });

  it("GET / returns index.html when dist exists", async () => {
    distDir = makeDistFixture();
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({
      config,
      logger,
      skipSignalHandlers: true,
      spaContext: { distDir, isSetupIncomplete: () => false },
    });
    fastify = result.fastify;

    const res = await fastify.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('<div id="fusion-app">');
  });

  it("serves the built index.html's own /assets-client/ references verbatim and injects a CSP nonce on <script>", async () => {
    distDir = makeDistFixture();
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({
      config,
      logger,
      skipSignalHandlers: true,
      spaContext: { distDir, isSetupIncomplete: () => false },
    });
    fastify = result.fastify;

    const res = await fastify.inject({ method: "GET", url: "/" });
    expect(res.body).toContain('src="/assets-client/index-abc123.js"');
    expect(res.body).toMatch(/<script nonce="[A-Za-z0-9+/=]+"/);
  });

  it("serves hashed assets under /assets-client/* with immutable cache headers", async () => {
    distDir = makeDistFixture();
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({
      config,
      logger,
      skipSignalHandlers: true,
      spaContext: { distDir, isSetupIncomplete: () => false },
    });
    fastify = result.fastify;

    const res = await fastify.inject({ method: "GET", url: "/assets-client/index-abc123.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("console.log('fixture')");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("falls back to index.html for unknown client-side routes (SPA routing)", async () => {
    distDir = makeDistFixture();
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({
      config,
      logger,
      skipSignalHandlers: true,
      spaContext: { distDir, isSetupIncomplete: () => false },
    });
    fastify = result.fastify;

    const res = await fastify.inject({ method: "GET", url: "/scene/abc/some/deep/route" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('<div id="fusion-app">');
  });

  it("does NOT swallow /health under the SPA catch-all", async () => {
    distDir = makeDistFixture();
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({
      config,
      logger,
      skipSignalHandlers: true,
      spaContext: { distDir, isSetupIncomplete: () => false },
    });
    fastify = result.fastify;

    const res = await fastify.inject({ method: "GET", url: "/health" });
    const body = res.json<{ ok: boolean; version: string }>();
    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.version).toBe(FUSION_VERSION);
  });

  it("does NOT swallow unknown /api/* routes under the SPA catch-all (returns 404, not the SPA shell)", async () => {
    distDir = makeDistFixture();
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({
      config,
      logger,
      skipSignalHandlers: true,
      spaContext: { distDir, isSetupIncomplete: () => false },
    });
    fastify = result.fastify;

    const res = await fastify.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).not.toContain("text/html");
  });

  it("boots successfully without crashing when packages/client/dist does not exist", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    // Point spaContext at a directory that does not exist — mirrors a test
    // environment with no client build, per the B0 requirement.
    const missingDir = join(tmpdir(), `fusion-spa-missing-${String(Date.now())}`);
    const result = await boot({
      config,
      logger,
      skipSignalHandlers: true,
      spaContext: { distDir: missingDir },
    });
    fastify = result.fastify;

    // The server is still up and /health still works.
    const health = await fastify.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Security response headers (REQ-SEC-053/054/055)
// ---------------------------------------------------------------------------

describe("security response headers", () => {
  let fastify: FastifyInstance | undefined;

  afterEach(async () => {
    if (fastify !== undefined) {
      await fastify.close();
      fastify = undefined;
    }
  });

  it("GET /health includes X-Content-Type-Options, X-Frame-Options, Referrer-Policy", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    fastify = result.fastify;

    const res = await fastify.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("does NOT send Strict-Transport-Security when secureCookies (TLS) is off (default)", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    fastify = result.fastify;

    const res = await fastify.inject({ method: "GET", url: "/health" });
    expect(res.headers["strict-transport-security"]).toBeUndefined();
  });

  it("sends Strict-Transport-Security when secureCookies (TLS) is on", async () => {
    const config = loadConfig({
      dataDirOverride: process.env["TMPDIR"] ?? process.env["TMP"] ?? "/tmp",
      cliOverrides: { port: 0, logLevel: "silent", secureCookies: true },
    });
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    fastify = result.fastify;

    const res = await fastify.inject({ method: "GET", url: "/health" });
    expect(res.headers["strict-transport-security"]).toContain("max-age=");
  });

  it("HTML responses (the SPA shell) include a strict CSP with a per-request script-src nonce, 'wasm-unsafe-eval' for the 3D dice engine, and no generic unsafe-eval anywhere", async () => {
    const distDir = makeDistFixture();
    try {
      const config = makeTestConfig();
      const logger = silentLogger();

      const result = await boot({
        config,
        logger,
        skipSignalHandlers: true,
        spaContext: { distDir, isSetupIncomplete: () => false },
      });
      fastify = result.fastify;

      const res = await fastify.inject({ method: "GET", url: "/" });
      const csp = res.headers["content-security-policy"];
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'wasm-unsafe-eval'/);
      // The 3D dice library (@3d-dice/dice-box) compiles/instantiates a WASM
      // physics engine (ammo.wasm) at runtime, which requires
      // 'wasm-unsafe-eval' in script-src. REQ-SEC-054/DEC-SEC-05 still bans
      // generic 'unsafe-eval' (arbitrary JS eval/Function) everywhere — the
      // token match below is exact (surrounded by quotes) so it does not
      // false-positive on the 'wasm-unsafe-eval' substring.
      expect(csp).not.toContain("'unsafe-eval'");
      // Matching the whole script-src directive (up to the next `;`)
      // confirms nothing beyond the nonce + wasm-unsafe-eval tokens is
      // appended to it.
      expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'wasm-unsafe-eval';/);
      // PIXI/3D-dice spawn blob: Web Workers — worker-src must allow blob:
      // (falls back to default-src 'self' otherwise, breaking texture/dice
      // workers). This is not unsafe-eval; script-src stays strict.
      expect(csp).toContain("worker-src 'self' blob:");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("style-src intentionally allows 'unsafe-inline' — documented spec×client trade-off (M6/B1)", async () => {
    // DECISION (see boot.ts inline comment for full rationale): REQ-SEC-054's
    // minimum required CSP directive list does not include style-src; it is
    // an addition made by this server. A strict `style-src 'self'` breaks
    // ~4 inline `style="..."` usages across 3 client components verified
    // against a real served build (upload-progress bar width, per-user
    // arbitrary background-color in JoinScreen/TableScreen) — two of which
    // are per-user ARBITRARY values that CSP hashes cannot allow-list. The
    // client is out of scope for this batch (see project CLAUDE.md), so
    // 'unsafe-inline' is accepted on style-src only (materially smaller XSS
    // surface than script-src, since CSS alone cannot execute JS) until a
    // future client batch refactors these to CSSOM and this test is updated
    // to assert the stricter policy.
    const distDir = makeDistFixture();
    try {
      const config = makeTestConfig();
      const logger = silentLogger();

      const result = await boot({
        config,
        logger,
        skipSignalHandlers: true,
        spaContext: { distDir, isSetupIncomplete: () => false },
      });
      fastify = result.fastify;

      const res = await fastify.inject({ method: "GET", url: "/" });
      const csp = res.headers["content-security-policy"];
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("connect-src is restricted to 'self' only when allowedOrigins is empty (default LAN deployment)", async () => {
    // DECISION (see boot.ts connectSrcDirective doc comment): connect-src
    // used to be the unrestricted 'self' wss: ws: (any host, any port, any
    // scheme) — a data-exfiltration channel wider than the same-origin
    // connection the client actually ever makes. With no allowedOrigins
    // configured (today's LAN-only deployment shape), 'self' alone is
    // correct and sufficient.
    const distDir = makeDistFixture();
    try {
      const config = makeTestConfig();
      const logger = silentLogger();

      const result = await boot({
        config,
        logger,
        skipSignalHandlers: true,
        spaContext: { distDir, isSetupIncomplete: () => false },
      });
      fastify = result.fastify;

      const res = await fastify.inject({ method: "GET", url: "/" });
      const csp = res.headers["content-security-policy"];
      expect(csp).toContain("connect-src 'self'");
      // No bare wss:/ws: (unrestricted host) directive value.
      expect(csp).not.toMatch(/connect-src 'self' wss:/);
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("connect-src adds the wss:// form of each configured allowedOrigin (M6/B4 tunnel scenario)", async () => {
    const distDir = makeDistFixture();
    const dataDir = mkdtempSync(join(tmpdir(), "fusion-csp-origins-"));
    try {
      writeFileSync(
        join(dataDir, "fusion.json"),
        JSON.stringify({
          allowedOrigins: ["https://my-tunnel.example.com", "http://192.168.1.50:33000"],
        }),
        "utf8",
      );
      const config = loadConfig({
        dataDirOverride: dataDir,
        cliOverrides: { port: 0, logLevel: "silent" },
      });
      const logger = silentLogger();

      const result = await boot({
        config,
        logger,
        skipSignalHandlers: true,
        spaContext: { distDir, isSetupIncomplete: () => false },
      });
      fastify = result.fastify;

      const res = await fastify.inject({ method: "GET", url: "/" });
      const csp = res.headers["content-security-policy"];
      expect(csp).toContain(
        "connect-src 'self' data: blob: wss://my-tunnel.example.com ws://192.168.1.50:33000",
      );
    } finally {
      // Close BEFORE removing dataDir: boot() now also opens a dedicated
      // admin-plane lockout SQLite handle (admin/lockout-db.ts, REQ-SEC-011
      // fix) under <dataDir>/Config/ — on Windows an open file handle blocks
      // rmSync's unlink (EBUSY) unless it is released first. The describe
      // block's own afterEach also calls fastify.close(), but that runs
      // AFTER this finally block, too late for the rmSync below.
      if (fastify !== undefined) {
        await fastify.close();
        fastify = undefined;
      }
      rmSync(distDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("JSON responses (e.g. /health) do NOT include a Content-Security-Policy header", async () => {
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    fastify = result.fastify;

    const res = await fastify.inject({ method: "GET", url: "/health" });
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });

  it("NEGATIVE: a response missing X-Content-Type-Options would fail this assertion", async () => {
    // This test documents the CI invariant explicitly requested by the task:
    // if the onSend security-headers hook in boot.ts were ever removed or
    // broken, this assertion (not merely presence-checking, but an exact
    // equality against the required value) fails loudly instead of the
    // suite silently passing without the header.
    const config = makeTestConfig();
    const logger = silentLogger();

    const result = await boot({ config, logger, skipSignalHandlers: true });
    fastify = result.fastify;

    const res = await fastify.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    // Sanity check that this is a real assertion, not a vacuous pass:
    expect(res.headers["x-content-type-options"]).not.toBeUndefined();
  });
});
