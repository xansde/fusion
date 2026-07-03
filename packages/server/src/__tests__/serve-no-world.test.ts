/**
 * Tests for "serve without --world" (M6/B1 — management server mode).
 *
 * `fusion serve` (no --world) must:
 *   - prepare the data directory (REQ-DST-007/010) via ensureDataDirLayout,
 *     the same step runServe() runs before boot();
 *   - boot successfully without an authContext/netContext;
 *   - respond on /health;
 *   - respond on /setup (served by the SPA catch-all — the wizard UI itself
 *     is M6/B2 scope, this batch only needs "does not crash, serves the
 *     shell").
 *
 * This exercises the same two-step pipeline runServe() performs
 * (ensureDataDirLayout then boot()) without spawning a child process, so it
 * stays fast and Windows-friendly (see world-commands.test.ts for the
 * child-process CLI pattern used elsewhere, deliberately not reused here
 * for a long-running `serve` — no existing test spawns a long-lived serve
 * process, and this in-process approach covers the same contract).
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { boot } from "../boot.js";
import type { BootResult } from "../boot.js";
import { ensureDataDirLayout } from "../data-dir.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const openServers: BootResult[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-serve-no-world-"));
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

/**
 * Boots the server exactly like `runServe()` does when no --world flag is
 * passed: load config for a fresh data dir, run ensureDataDirLayout, then
 * boot() with no authContext/netContext/assetContext. SPA serving is ON by
 * default (spaContext is omitted here, not disabled) — the /setup test
 * below relies on exactly that: /setup is answered by the SPA catch-all
 * (200 with a client build present, or a graceful 404 without one), not by
 * a dedicated route, so this suite exercises the real default management-
 * server surface: /health plus whatever the SPA layer serves.
 */
async function bootManagementServer(dataDir: string): Promise<BootResult> {
  const config = loadConfig({
    dataDirOverride: dataDir,
    cliOverrides: { port: 0, dataDir, logLevel: "silent" },
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

describe("serve without --world (management server mode)", () => {
  it("does not crash and prepares the REQ-DST-007 tree before boot", async () => {
    const dataDir = makeTempDataDir();
    await bootManagementServer(dataDir);

    for (const sub of ["Config", "systems", "assets", "backups", "Logs"]) {
      expect(existsSync(join(dataDir, sub)), `expected ${sub} to exist`).toBe(true);
    }
    expect(existsSync(join(dataDir, "Config", "fusion.json"))).toBe(true);
  });

  it("GET /health responds ok:true with no world open", async () => {
    const dataDir = makeTempDataDir();
    const result = await bootManagementServer(dataDir);

    const res = await result.fastify.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });

  it("GET /setup does not crash the server (served by the SPA shell / catch-all)", async () => {
    const dataDir = makeTempDataDir();
    const result = await bootManagementServer(dataDir);

    const res = await result.fastify.inject({ method: "GET", url: "/setup" });
    // The wizard UI itself is M6/B2 scope — here we only assert the server
    // stays up and answers (200 from SPA shell, or a graceful 404 if no
    // client dist is present in this checkout) rather than crashing/erroring.
    expect([200, 404]).toContain(res.statusCode);

    // The server must still be responsive afterwards (proves no crash).
    const health = await result.fastify.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });

  it("boots with no socketManager when netContext is absent (no world opened)", async () => {
    const dataDir = makeTempDataDir();
    const result = await bootManagementServer(dataDir);
    expect(result.socketManager).toBeUndefined();
  });

  it("GET /api/world responds 404 NOT_FOUND with no world open (client management-mode signal)", async () => {
    // registerAuthRoutes (and therefore GET /api/world) is only mounted
    // when authContext is passed to boot() — see boot.ts, conditional on
    // --world. With no world open, the request falls through to the SPA
    // catch-all's /api/* guard (spa/routes.ts), which answers a clean
    // 404 {ok:false, code:"NOT_FOUND"}. The client (session.svelte.ts's
    // classifyWorldFetchError, packages/client/src/lib/worldFetchErrorClassifier.ts)
    // relies on exactly this shape to distinguish "server up, no world
    // open" (show ManagementScreen.svelte) from "server unreachable" (fetch
    // itself throws, never reaching this assertion) — manual validation
    // round 2 finding. This test pins the server-side half of that contract.
    const dataDir = makeTempDataDir();
    const result = await bootManagementServer(dataDir);

    const res = await result.fastify.inject({ method: "GET", url: "/api/world" });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ ok: boolean; code: string }>();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("stamps Config/fusion.json with dataVersion/serverVersion even with no world", async () => {
    const dataDir = makeTempDataDir();
    await bootManagementServer(dataDir);

    const parsed = JSON.parse(
      readFileSync(join(dataDir, "Config", "fusion.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(parsed["dataVersion"]).toBeGreaterThanOrEqual(1);
    expect(typeof parsed["serverVersion"]).toBe("string");
  });
});
