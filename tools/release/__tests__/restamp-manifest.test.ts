/**
 * Tests for tools/release/restamp-manifest.mjs (B3-FIXES MÉDIA A) — the
 * post-packaging manifest re-stamper. Spawns the REAL script as a child
 * process (same pattern as check-version-drift.test.ts: it is a standalone
 * CLI with no exports) against temp manifest/artifact files. Unlike
 * check-version-drift, the script takes every path it touches as an explicit
 * argv argument (no repo-root walk), so it can run in place — its relative
 * `./manifest.mjs` import resolves against the real tools/release/ dir.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { UPDATE_REPO_PLACEHOLDER } from "../manifest.mjs";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "..", "restamp-manifest.mjs");

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-restamp-test-"));
  cleanupDirs.push(dir);
  return dir;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Runs the real script; returns stdout on success, or the caught error on failure. */
function runScript(args: string[]): {
  stdout?: string;
  error?: { status: number | null; stderr: string };
} {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });
    return { stdout };
  } catch (err) {
    const e = err as { status: number | null; stderr?: string };
    return { error: { status: e.status, stderr: String(e.stderr ?? "") } };
  }
}

interface ManifestPlatformEntry {
  url: string;
  sha256: string;
  size: number;
}

interface ManifestShape {
  version: string;
  releaseDate: string;
  releaseNotes: string;
  channel: string;
  platforms: Record<string, ManifestPlatformEntry>;
}

const RAW_LINUX_ENTRY: ManifestPlatformEntry = {
  // The stale entry build-release.mjs wrote for the RAW artifact that
  // release.yml's packaging step subsequently deleted.
  url: "https://example.com/raw-linux-artifact",
  sha256: "b".repeat(64),
  size: 222,
};

const WINDOWS_ENTRY: ManifestPlatformEntry = {
  url: "https://example.com/windows-exe",
  sha256: "a".repeat(64),
  size: 111,
};

function writeBaseManifest(manifestPath: string): void {
  const manifest: ManifestShape = {
    version: "0.3.0",
    releaseDate: "2026-01-01T00:00:00.000Z",
    releaseNotes: "Custom release notes",
    channel: "stable",
    platforms: {
      "windows-x64": WINDOWS_ENTRY,
      "linux-x64": RAW_LINUX_ENTRY,
    },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

describe("restamp-manifest.mjs", () => {
  it("re-stamps ONLY the given platform's entry from the final artifact on disk", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "latest-stable.json");
    writeBaseManifest(manifestPath);

    const artifactBytes = Buffer.from("fake-appimage-bytes-after-packaging");
    const artifactPath = join(dir, "fusion-server-0.3.0-linux-x64.AppImage");
    writeFileSync(artifactPath, artifactBytes);

    const { stdout, error } = runScript([manifestPath, "linux-x64", artifactPath]);
    expect(error).toBeUndefined();
    expect(stdout).toContain("[restamp-manifest] linux-x64");
    expect(stdout).toContain("fusion-server-0.3.0-linux-x64.AppImage");

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestShape;

    // The restamped platform now reflects the FINAL artifact: fresh sha256 +
    // size hashed from disk, and a URL pointing at the final artifact name.
    expect(manifest.platforms["linux-x64"]).toEqual({
      url: `https://github.com/${UPDATE_REPO_PLACEHOLDER}/releases/download/v0.3.0/fusion-server-0.3.0-linux-x64.AppImage`,
      sha256: sha256Hex(artifactBytes),
      size: artifactBytes.length,
    });

    // The OTHER platform's already-published entry survives untouched
    // (writeManifest's merge-without-clobbering semantics the multi-leg
    // publish job depends on).
    expect(manifest.platforms["windows-x64"]).toEqual(WINDOWS_ENTRY);

    // version/channel/releaseNotes are read from the existing manifest, not
    // fabricated.
    expect(manifest.version).toBe("0.3.0");
    expect(manifest.channel).toBe("stable");
    expect(manifest.releaseNotes).toBe("Custom release notes");
  });

  it("is idempotent per platform: a re-run against the same artifact converges to the same entry", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "latest-stable.json");
    writeBaseManifest(manifestPath);

    const artifactBytes = Buffer.from("dmg-bytes");
    const artifactPath = join(dir, "fusion-server-0.3.0-macos-arm64.dmg");
    writeFileSync(artifactPath, artifactBytes);

    expect(runScript([manifestPath, "macos-arm64", artifactPath]).error).toBeUndefined();
    const first = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestShape;
    expect(runScript([manifestPath, "macos-arm64", artifactPath]).error).toBeUndefined();
    const second = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestShape;

    expect(second.platforms["macos-arm64"]).toEqual(first.platforms["macos-arm64"]);
    expect(second.platforms["macos-arm64"]?.sha256).toBe(sha256Hex(artifactBytes));
  });

  it("fails with a clear error when the manifest does not exist (packaging-order guard)", () => {
    const dir = makeTempDir();
    const artifactPath = join(dir, "fusion.AppImage");
    writeFileSync(artifactPath, "bytes");

    const { error } = runScript([join(dir, "missing.json"), "linux-x64", artifactPath]);
    expect(error).toBeDefined();
    expect(error?.status).not.toBe(0);
    expect(error?.stderr).toContain("Manifest not found");
  });

  it("fails with a clear error when the final artifact does not exist (packaging must run first)", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "latest-stable.json");
    writeBaseManifest(manifestPath);

    const { error } = runScript([manifestPath, "linux-x64", join(dir, "missing.AppImage")]);
    expect(error).toBeDefined();
    expect(error?.stderr).toContain("Final artifact not found");
  });

  it("fails when the existing manifest is missing version/channel (refuses to fabricate them)", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "latest-stable.json");
    writeFileSync(manifestPath, JSON.stringify({ platforms: {} }));
    const artifactPath = join(dir, "fusion.AppImage");
    writeFileSync(artifactPath, "bytes");

    const { error } = runScript([manifestPath, "linux-x64", artifactPath]);
    expect(error).toBeDefined();
    expect(error?.stderr).toContain("missing version/channel");
  });

  it("exits 1 with usage when called with missing arguments", () => {
    const { error } = runScript([]);
    expect(error).toBeDefined();
    expect(error?.status).toBe(1);
    expect(error?.stderr).toContain("Usage: node restamp-manifest.mjs");
  });
});
