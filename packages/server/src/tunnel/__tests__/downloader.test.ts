/**
 * Tests for ensureCloudflared (M6/B4 — download + hash-verify + cache).
 *
 * Mocks cloudflared-releases.ts's resolveCloudflaredAsset so tests control
 * the exact pinned URL/hash/archive-format, rather than depending on the
 * real pinned release constants (which change over time and require real
 * network bytes to produce a matching hash). No real network access happens
 * in this suite — the real-network E2E check is a separate, manually-run
 * step (see the batch notes).
 *
 * Covers:
 *   - happy path: correct hash → binary written + cached (raw asset)
 *   - happy path: correct hash → binary extracted + cached (.tgz asset)
 *   - hash mismatch → rejects AND the bad file is not left on disk
 *   - cache hit: second call does not re-fetch when the cached file still
 *     matches its sidecar hash
 *   - cache invalidation: a corrupted cached file is re-downloaded
 *   - unsupported platform → clear error, no fetch attempted
 *   - HTTP error response → clear error
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const tempDirs: string[] = [];
function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-tunnel-dl-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.doUnmock("../cloudflared-releases.js");
  vi.resetModules();
});

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

const FAKE_BINARY = Buffer.from("#!/bin/sh\necho fake-cloudflared\n");
const FAKE_HASH = sha256Hex(FAKE_BINARY);

function fakeFetch(body: Buffer, status = 200): typeof fetch {
  return vi.fn(async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      arrayBuffer: async () =>
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** Build a minimal single-entry POSIX tar archive containing `cloudflared`. */
function buildTarWithCloudflared(content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write("cloudflared", 0, "utf8");
  header.write(content.length.toString(8).padStart(11, "0"), 124, "utf8");
  header[156] = "0".charCodeAt(0); // regular file typeflag
  const paddedContentLen = Math.ceil(content.length / 512) * 512;
  const paddedContent = Buffer.alloc(paddedContentLen);
  content.copy(paddedContent);
  const endMarker = Buffer.alloc(1024);
  return Buffer.concat([header, paddedContent, endMarker]);
}

/** Import the module fresh with cloudflared-releases mocked to a test asset. */
async function importWithMockedAsset(asset: {
  platform: NodeJS.Platform;
  arch: string;
  url: string;
  sha256: string;
  archive: "tgz" | "raw";
}) {
  vi.doMock("../cloudflared-releases.js", () => ({
    resolveCloudflaredAsset: () => asset,
    cloudflaredBinaryName: (platform: NodeJS.Platform = process.platform) =>
      platform === "win32" ? "cloudflared.exe" : "cloudflared",
  }));
  return import("../downloader.js");
}

describe("ensureCloudflared", () => {
  it("downloads and verifies a fresh raw binary (happy path)", async () => {
    const dataDir = makeTempDataDir();
    const { ensureCloudflared } = await importWithMockedAsset({
      platform: "linux",
      arch: "x64",
      url: "https://example.test/cloudflared-linux-amd64",
      sha256: FAKE_HASH,
      archive: "raw",
    });
    const fetchImpl = fakeFetch(FAKE_BINARY);

    const result = await ensureCloudflared({ dataDir, platform: "linux", arch: "x64", fetchImpl });

    const binPath = join(dataDir, "runtime", "cloudflared");
    expect(result).toBe(binPath);
    expect(existsSync(binPath)).toBe(true);
    expect(readFileSync(binPath)).toEqual(FAKE_BINARY);
    expect(existsSync(`${binPath}.sha256`)).toBe(true);
    expect(readFileSync(`${binPath}.sha256`, "utf8")).toBe(FAKE_HASH);
  });

  it("downloads, verifies, and extracts a .tgz asset (macOS-style archive)", async () => {
    const dataDir = makeTempDataDir();
    const tar = buildTarWithCloudflared(FAKE_BINARY);
    const tgz = gzipSync(tar);
    const tgzHash = sha256Hex(tgz);

    const { ensureCloudflared } = await importWithMockedAsset({
      platform: "darwin",
      arch: "arm64",
      url: "https://example.test/cloudflared-darwin-arm64.tgz",
      sha256: tgzHash,
      archive: "tgz",
    });
    const fetchImpl = fakeFetch(tgz);

    const result = await ensureCloudflared({
      dataDir,
      platform: "darwin",
      arch: "arm64",
      fetchImpl,
    });

    const binPath = join(dataDir, "runtime", "cloudflared");
    expect(result).toBe(binPath);
    // The extracted binary content matches the original (pre-tar) bytes —
    // proves the raw .tgz hash gate ran against the ARCHIVE, and extraction
    // happened only after verification succeeded.
    expect(readFileSync(binPath)).toEqual(FAKE_BINARY);
  });

  it("hash mismatch: rejects with HashMismatchError and does not leave the bad file on disk", async () => {
    const dataDir = makeTempDataDir();
    const { ensureCloudflared, HashMismatchError } = await importWithMockedAsset({
      platform: "linux",
      arch: "x64",
      url: "https://example.test/cloudflared-linux-amd64",
      sha256: "0".repeat(64), // deliberately wrong
      archive: "raw",
    });
    const fetchImpl = fakeFetch(FAKE_BINARY);

    await expect(
      ensureCloudflared({ dataDir, platform: "linux", arch: "x64", fetchImpl }),
    ).rejects.toThrow(HashMismatchError);

    const binPath = join(dataDir, "runtime", "cloudflared");
    expect(existsSync(binPath)).toBe(false);
    expect(existsSync(`${binPath}.sha256`)).toBe(false);
  });

  it("unsupported platform: throws UnsupportedPlatformError without calling fetch", async () => {
    const dataDir = makeTempDataDir();
    vi.doMock("../cloudflared-releases.js", () => ({
      resolveCloudflaredAsset: () => undefined,
      cloudflaredBinaryName: () => "cloudflared",
    }));
    const { ensureCloudflared, UnsupportedPlatformError } = await import("../downloader.js");
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      ensureCloudflared({ dataDir, platform: "win32", arch: "ia32", fetchImpl }),
    ).rejects.toThrow(UnsupportedPlatformError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cache hit: a valid cached binary + matching sidecar hash is reused without calling fetch", async () => {
    const dataDir = makeTempDataDir();
    const runtimeDir = join(dataDir, "runtime");
    const binPath = join(runtimeDir, "cloudflared");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(binPath, FAKE_BINARY);
    writeFileSync(`${binPath}.sha256`, FAKE_HASH, "utf8");

    const { ensureCloudflared } = await importWithMockedAsset({
      platform: "linux",
      arch: "x64",
      url: "https://example.test/cloudflared-linux-amd64",
      sha256: FAKE_HASH,
      archive: "raw",
    });
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await ensureCloudflared({ dataDir, platform: "linux", arch: "x64", fetchImpl });

    expect(result).toBe(binPath);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cache invalidation: a corrupted cached binary (sidecar mismatch) triggers a re-download", async () => {
    const dataDir = makeTempDataDir();
    const runtimeDir = join(dataDir, "runtime");
    const binPath = join(runtimeDir, "cloudflared");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(binPath, Buffer.from("corrupted-partial-download"));
    writeFileSync(`${binPath}.sha256`, "0".repeat(64), "utf8"); // sidecar does not match actual bytes

    const { ensureCloudflared } = await importWithMockedAsset({
      platform: "linux",
      arch: "x64",
      url: "https://example.test/cloudflared-linux-amd64",
      sha256: FAKE_HASH,
      archive: "raw",
    });
    const fetchImpl = fakeFetch(FAKE_BINARY);

    const result = await ensureCloudflared({ dataDir, platform: "linux", arch: "x64", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1); // proves the stale cache was discarded, not silently trusted
    expect(readFileSync(binPath)).toEqual(FAKE_BINARY);
    expect(result).toBe(binPath);
  });

  it("HTTP error response surfaces a clear error rather than silently succeeding", async () => {
    const dataDir = makeTempDataDir();
    const { ensureCloudflared } = await importWithMockedAsset({
      platform: "linux",
      arch: "x64",
      url: "https://example.test/cloudflared-linux-amd64",
      sha256: FAKE_HASH,
      archive: "raw",
    });
    const fetchImpl = fakeFetch(Buffer.from(""), 404);

    await expect(
      ensureCloudflared({ dataDir, platform: "linux", arch: "x64", fetchImpl }),
    ).rejects.toThrow(/404/);
  });
});
