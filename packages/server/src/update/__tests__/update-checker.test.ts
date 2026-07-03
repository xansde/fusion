/**
 * Tests for checkForUpdate against a LOCAL mock manifest server (never the
 * real GitHub API — M6/B5 test brief). Covers CA-DST-10 (update available
 * with notes / not available when current is already latest), the dev vs
 * stable channel filter, and the non-blocking "endpoint down" boot path.
 */

import { describe, it, expect, afterEach } from "vitest";
import { checkForUpdate } from "../update-checker.js";
import { startMockUpdateServer, type MockUpdateServer } from "./mock-update-server.js";
import type { UpdateManifest } from "../manifest-client.js";

let server: MockUpdateServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
});

function manifest(overrides: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    version: "2.0.0",
    releaseDate: "2026-07-01T00:00:00.000Z",
    releaseNotes: "New stuff",
    channel: "stable",
    platforms: {},
    ...overrides,
  };
}

describe("checkForUpdate", () => {
  it("reports an available update with release notes (CA-DST-10)", async () => {
    server = await startMockUpdateServer({ manifest: manifest({ version: "2.0.0" }) });

    const result = await checkForUpdate({
      currentVersion: "1.0.0",
      channel: "stable",
      manifestUrl: server.manifestUrl,
    });

    expect(result.checked).toBe(true);
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("2.0.0");
    expect(result.releaseNotes).toBe("New stuff");
  });

  it("reports no update available when current version is already latest (CA-DST-10)", async () => {
    server = await startMockUpdateServer({ manifest: manifest({ version: "1.0.0" }) });

    const result = await checkForUpdate({
      currentVersion: "1.0.0",
      channel: "stable",
      manifestUrl: server.manifestUrl,
    });

    expect(result.checked).toBe(true);
    expect(result.updateAvailable).toBe(false);
  });

  it("reports no update available when current version is NEWER than the manifest (dev ahead of stable)", async () => {
    server = await startMockUpdateServer({ manifest: manifest({ version: "1.0.0" }) });

    const result = await checkForUpdate({
      currentVersion: "1.5.0",
      channel: "stable",
      manifestUrl: server.manifestUrl,
    });

    expect(result.checked).toBe(true);
    expect(result.updateAvailable).toBe(false);
  });

  it("filters by channel — a dev manifest is not fetched under the stable channel URL", async () => {
    server = await startMockUpdateServer({
      manifest: manifest({ version: "3.0.0", channel: "dev" }),
    });

    // manifestUrl here explicitly points at the dev channel — verifies the
    // dev-channel path resolves and reports an update.
    const devResult = await checkForUpdate({
      currentVersion: "1.0.0",
      channel: "dev",
      manifestUrl: server.manifestUrl,
    });
    expect(devResult.checked).toBe(true);
    expect(devResult.updateAvailable).toBe(true);
    expect(devResult.latestVersion).toBe("3.0.0");

    // Requesting the STABLE channel's manifest URL (which was never
    // registered — only /latest-dev.json exists on this mock server)
    // resolves to a 404, and the check must degrade to "not checked"
    // rather than throwing or crashing the boot path.
    const stableUrl = server.manifestUrl.replace("latest-dev.json", "latest-stable.json");
    const stableResult = await checkForUpdate({
      currentVersion: "1.0.0",
      channel: "stable",
      manifestUrl: stableUrl,
    });
    expect(stableResult.checked).toBe(false);
  });

  it("does not throw and reports checked=false when the endpoint is unreachable (REQ-DST-020, non-blocking boot)", async () => {
    const result = await checkForUpdate({
      currentVersion: "1.0.0",
      channel: "stable",
      manifestUrl: "http://127.0.0.1:1/latest-stable.json", // nothing listens on port 1
      timeoutMs: 500,
    });

    expect(result.checked).toBe(false);
    expect(result.updateAvailable).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("does not throw and reports checked=false when updateRepo is the DA-01 placeholder", async () => {
    const result = await checkForUpdate({
      currentVersion: "1.0.0",
      channel: "stable",
      updateRepo: "REPLACE_ME/fusion",
    });

    expect(result.checked).toBe(false);
    expect(result.reason).toContain("not configured");
  });
});
