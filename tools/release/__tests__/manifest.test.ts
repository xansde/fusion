/**
 * Tests for tools/release/manifest.mjs — the UpdateManifest builder
 * (M6/B3 §7 "unit do gerador de manifesto (shape spec 22)").
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildManifest, writeManifest, UPDATE_REPO_PLACEHOLDER } from "../manifest.mjs";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-manifest-test-"));
  cleanupDirs.push(dir);
  return dir;
}

const baseOptions = {
  version: "0.2.0",
  channel: "stable",
  platformKey: "windows-x64",
  artifactName: "fusion-server-0.2.0-windows-x64.exe",
  sha256: "a".repeat(64),
  size: 123_456_789,
};

describe("buildManifest", () => {
  it("produces the spec-22 UpdateManifest shape for a fresh manifest", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "latest-stable.json");

    const manifest = buildManifest({ manifestPath, ...baseOptions });

    expect(manifest.version).toBe("0.2.0");
    expect(manifest.channel).toBe("stable");
    expect(typeof manifest.releaseDate).toBe("string");
    expect(new Date(manifest.releaseDate as string).toString()).not.toBe("Invalid Date");
    expect(manifest.releaseNotes).toBe("Fusion 0.2.0");
    expect(manifest.platforms).toEqual({
      "windows-x64": {
        url: `https://github.com/${UPDATE_REPO_PLACEHOLDER}/releases/download/v0.2.0/fusion-server-0.2.0-windows-x64.exe`,
        sha256: baseOptions.sha256,
        size: baseOptions.size,
      },
    });
  });

  it("uses a custom updateRepo when provided (DA-01 resolution path)", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "latest-stable.json");

    const manifest = buildManifest({ manifestPath, ...baseOptions, updateRepo: "acme/fusion" });

    expect((manifest.platforms as Record<string, { url: string }>)["windows-x64"].url).toContain(
      "https://github.com/acme/fusion/releases/download/",
    );
  });

  it("merges a NEW platform into an EXISTING manifest without clobbering prior platforms", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "latest-stable.json");

    writeFileSync(
      manifestPath,
      JSON.stringify({
        version: "0.2.0",
        releaseDate: "2020-01-01T00:00:00.000Z",
        releaseNotes: "Custom notes",
        channel: "stable",
        platforms: {
          "linux-x64": { url: "https://example.com/linux", sha256: "b".repeat(64), size: 111 },
        },
      }),
    );

    const manifest = buildManifest({ manifestPath, ...baseOptions });

    // Existing platform entry survives...
    expect((manifest.platforms as Record<string, unknown>)["linux-x64"]).toEqual({
      url: "https://example.com/linux",
      sha256: "b".repeat(64),
      size: 111,
    });
    // ...and the new one is added alongside it.
    expect((manifest.platforms as Record<string, unknown>)["windows-x64"]).toBeDefined();
    // Custom releaseNotes from the existing file are preserved (not overwritten
    // with the generic "Fusion <version>" default).
    expect(manifest.releaseNotes).toBe("Custom notes");
  });

  it("overwrites the SAME platform's entry on a re-run (idempotent per platform)", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "latest-stable.json");

    buildManifest({ manifestPath, ...baseOptions });
    const rebuilt = buildManifest({
      manifestPath,
      ...baseOptions,
      sha256: "c".repeat(64),
      size: 999,
    });

    // buildManifest is pure (doesn't write) — write once ourselves to
    // simulate a real re-run reading its own prior output.
    writeFileSync(manifestPath, JSON.stringify(rebuilt));
    const final = buildManifest({
      manifestPath,
      ...baseOptions,
      sha256: "d".repeat(64),
      size: 1000,
    });

    expect(
      (final.platforms as Record<string, { sha256: string; size: number }>)["windows-x64"],
    ).toEqual({
      url: `https://github.com/${UPDATE_REPO_PLACEHOLDER}/releases/download/v0.2.0/fusion-server-0.2.0-windows-x64.exe`,
      sha256: "d".repeat(64),
      size: 1000,
    });
  });

  it("recovers gracefully from a corrupted existing manifest file (treats as fresh)", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "latest-stable.json");
    writeFileSync(manifestPath, "{ this is not valid json");

    const manifest = buildManifest({ manifestPath, ...baseOptions });
    expect(manifest.version).toBe("0.2.0");
    expect(Object.keys(manifest.platforms as Record<string, unknown>)).toEqual(["windows-x64"]);
  });
});

describe("writeManifest", () => {
  it("writes the manifest to disk and creates parent directories", () => {
    const dir = makeTempDir();
    const manifestPath = join(dir, "nested", "latest-dev.json");

    const { manifestPath: written } = writeManifest({
      manifestPath,
      ...baseOptions,
      channel: "dev",
    });

    expect(existsSync(written)).toBe(true);
    const onDisk = JSON.parse(readFileSync(written, "utf8"));
    expect(onDisk.channel).toBe("dev");
  });
});
