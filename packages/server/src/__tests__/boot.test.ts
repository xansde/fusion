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
import type { FastifyInstance } from "fastify";
import { PROTOCOL_VERSION } from "@fusion/shared";
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
    expect(body["version"]).toBe("0.1.0");
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
