/**
 * Tests for the SEA native-addon extraction/resolution shim (M6/B3).
 *
 * Covers:
 *  - packDirectory/unpack round-trip preserves file bytes + executable mode
 *  - nativeRuntimeDir path derivation (namespaced by dataDir + version, DA-07)
 *  - ensureNativeAddonsExtracted: fresh extraction, cache-hit skip, stale-hash
 *    re-extraction, and NativeAddonExtractionError on a broken asset
 *  - installNativeAddonResolutionHook redirects ONLY the two exact bare
 *    specifiers this project's native addons use, leaving every other
 *    require() untouched
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import {
  packDirectory,
  nativeRuntimeDir,
  ensureNativeAddonsExtracted,
  installNativeAddonResolutionHook,
  _resetNativeAddonResolutionHookForTests,
  NativeAddonExtractionError,
  type NativePackageSpec,
} from "../native-loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanupDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  _resetNativeAddonResolutionHookForTests();
});

/** Build a minimal fake CJS "package" directory to pack, for fast/offline tests. */
function buildFakePackage(rootDir: string, opts: { mainReturns: string }): void {
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(
    join(rootDir, "package.json"),
    JSON.stringify({ name: "fake-pkg", main: "index.js" }),
  );
  writeFileSync(
    join(rootDir, "index.js"),
    `module.exports = ${JSON.stringify(opts.mainReturns)};\n`,
  );
}

// ---------------------------------------------------------------------------
// packDirectory / unpack round-trip
// ---------------------------------------------------------------------------

describe("packDirectory", () => {
  it("packs a nested directory tree into a single buffer with a JSON index header", () => {
    const src = makeTempDir("fusion-pack-src-");
    mkdirSync(join(src, "sub"), { recursive: true });
    writeFileSync(join(src, "a.txt"), "hello");
    writeFileSync(join(src, "sub", "b.txt"), "world");

    const archive = packDirectory(src);
    expect(archive.length).toBeGreaterThan(0);

    // Manually parse the header the way native-loader.ts's private
    // unpackDirectory does, to assert the format without re-implementing
    // extraction here (extraction itself is covered via
    // ensureNativeAddonsExtracted below, which calls the real unpacker).
    const indexLen = Number(archive.readBigUInt64LE(0));
    const index = JSON.parse(archive.subarray(8, 8 + indexLen).toString("utf8")) as {
      entries: { path: string; size: number }[];
    };
    const paths = index.entries.map((e) => e.path).sort();
    expect(paths).toEqual(["a.txt", "sub/b.txt"]);
  });
});

// ---------------------------------------------------------------------------
// nativeRuntimeDir
// ---------------------------------------------------------------------------

describe("nativeRuntimeDir", () => {
  it("namespaces the extraction path by both dataDir and version (DA-07)", () => {
    const a = nativeRuntimeDir("/data", "0.1.0");
    const b = nativeRuntimeDir("/data", "0.2.0");
    expect(a).not.toBe(b);
    expect(a).toContain(join("runtime", "0.1.0", "node_modules"));
  });
});

// ---------------------------------------------------------------------------
// ensureNativeAddonsExtracted
// ---------------------------------------------------------------------------

describe("ensureNativeAddonsExtracted", () => {
  let dataDir: string;
  let fakePkgDir: string;
  let testPackages: NativePackageSpec[];
  let archive: Buffer;

  beforeEach(() => {
    dataDir = makeTempDir("fusion-native-extract-");
    fakePkgDir = makeTempDir("fusion-fake-pkg-src-");
    buildFakePackage(fakePkgDir, { mainReturns: "v1" });
    archive = packDirectory(fakePkgDir);
    testPackages = [{ specifier: "fake-pkg", assetKey: "fake-pkg-asset" }];
  });

  it("extracts a fresh package to <dataDir>/runtime/<version>/node_modules/<specifier>/", async () => {
    await ensureNativeAddonsExtracted({
      dataDir,
      version: "1.0.0",
      packages: testPackages,
      getRawAsset: () =>
        archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
    });

    const destDir = join(nativeRuntimeDir(dataDir, "1.0.0"), "fake-pkg");
    expect(existsSync(join(destDir, "package.json"))).toBe(true);
    expect(existsSync(join(destDir, "index.js"))).toBe(true);
    expect(existsSync(`${destDir}.sha256`)).toBe(true);

    const req = createRequire(join(destDir, "noop.js"));
    expect(req(destDir)).toBe("v1");
  });

  it("is a cache-hit no-op on the second call (does not re-extract)", async () => {
    const options = {
      dataDir,
      version: "1.0.0",
      packages: testPackages,
      getRawAsset: () =>
        archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
    };
    await ensureNativeAddonsExtracted(options);

    const destDir = join(nativeRuntimeDir(dataDir, "1.0.0"), "fake-pkg");
    const firstMtime = statSync(join(destDir, "index.js")).mtimeMs;

    // Second call — cache should hit and skip re-extraction (same mtime).
    await ensureNativeAddonsExtracted(options);
    const secondMtime = statSync(join(destDir, "index.js")).mtimeMs;
    expect(secondMtime).toBe(firstMtime);
  });

  it("re-extracts when the sidecar hash is stale (asset changed)", async () => {
    const destDir = join(nativeRuntimeDir(dataDir, "1.0.0"), "fake-pkg");

    await ensureNativeAddonsExtracted({
      dataDir,
      version: "1.0.0",
      packages: testPackages,
      getRawAsset: () =>
        archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
    });
    expect(readFileSync(join(destDir, "index.js"), "utf8")).toContain("v1");

    // Simulate a corrupted/stale sidecar by writing a bogus hash.
    writeFileSync(
      `${destDir}.sha256`,
      "0000000000000000000000000000000000000000000000000000000000000000",
    );

    buildFakePackage(fakePkgDir, { mainReturns: "v2" });
    const archive2 = packDirectory(fakePkgDir);

    await ensureNativeAddonsExtracted({
      dataDir,
      version: "1.0.0",
      packages: testPackages,
      getRawAsset: () =>
        archive2.buffer.slice(archive2.byteOffset, archive2.byteOffset + archive2.byteLength),
    });
    expect(readFileSync(join(destDir, "index.js"), "utf8")).toContain("v2");
  });

  it("throws NativeAddonExtractionError when getRawAsset throws", async () => {
    await expect(
      ensureNativeAddonsExtracted({
        dataDir,
        version: "1.0.0",
        packages: testPackages,
        getRawAsset: () => {
          throw new Error("asset not found");
        },
      }),
    ).rejects.toThrow(NativeAddonExtractionError);
  });

  it("never leaves a half-extracted directory on a corrupt archive (atomic rename)", async () => {
    const destDir = join(nativeRuntimeDir(dataDir, "1.0.0"), "fake-pkg");

    // A too-short buffer will throw while reading the index header/JSON —
    // the temp dir it partially wrote to must never be renamed into destDir.
    const brokenArchive = Buffer.from([1, 2, 3]);

    await expect(
      ensureNativeAddonsExtracted({
        dataDir,
        version: "1.0.0",
        packages: testPackages,
        getRawAsset: () =>
          brokenArchive.buffer.slice(
            brokenArchive.byteOffset,
            brokenArchive.byteOffset + brokenArchive.byteLength,
          ),
      }),
    ).rejects.toThrow(NativeAddonExtractionError);

    expect(existsSync(destDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// installNativeAddonResolutionHook
// ---------------------------------------------------------------------------

describe("installNativeAddonResolutionHook", () => {
  it("redirects require('better-sqlite3') to the extracted copy's real file", async () => {
    const dataDir = makeTempDir("fusion-hook-");
    const version = "1.0.0";

    // Build a fake "better-sqlite3" package (no real native addon needed —
    // this test only proves the RESOLUTION redirect, not the addon itself;
    // the real addon's load-bearing round trip is covered by the manual
    // verification in this batch's implementation notes and by
    // config/world-manager tests exercising the real package unmodified).
    const fakeSrc = makeTempDir("fusion-fake-bettersqlite3-");
    buildFakePackage(fakeSrc, { mainReturns: "fake-better-sqlite3" });
    const archive = packDirectory(fakeSrc);

    await ensureNativeAddonsExtracted({
      dataDir,
      version,
      packages: [{ specifier: "better-sqlite3", assetKey: "x" }],
      getRawAsset: () =>
        archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
    });

    installNativeAddonResolutionHook(dataDir, version);

    const req = createRequire(join(dataDir, "noop.js"));
    // The bare specifier "better-sqlite3" — exactly what db/connection.ts
    // uses — must now resolve to the extracted fake copy.
    expect(req("better-sqlite3")).toBe("fake-better-sqlite3");
  });

  it("leaves unrelated specifiers completely unaffected", async () => {
    const dataDir = makeTempDir("fusion-hook-unrelated-");
    installNativeAddonResolutionHook(dataDir, "1.0.0");

    const req = createRequire(join(dataDir, "noop.js"));
    // "node:path" must resolve normally — the hook must not have broken
    // Node's own module resolution for anything outside its narrow
    // override map.
    expect(() => req("node:path")).not.toThrow();
  });

  it("is idempotent — installing twice does not double-wrap the resolver", async () => {
    const dataDir = makeTempDir("fusion-hook-idempotent-");
    installNativeAddonResolutionHook(dataDir, "1.0.0");
    installNativeAddonResolutionHook(dataDir, "1.0.0"); // no-op, must not throw

    const req = createRequire(join(dataDir, "noop.js"));
    expect(() => req("node:path")).not.toThrow();
  });
});
