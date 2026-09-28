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
  compressArchive,
  decodeArchive,
  unpackArchive,
  nativeRuntimeDir,
  ensureNativeAddonsExtracted,
  installNativeAddonResolutionHook,
  _resetNativeAddonResolutionHookForTests,
  NativeAddonExtractionError,
  UnknownArchiveCodecError,
  ARCHIVE_CODEC_NONE,
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
  it("packs a nested directory tree into a compressed archive, round-tripping via unpackArchive", () => {
    const src = makeTempDir("fusion-pack-src-");
    mkdirSync(join(src, "sub"), { recursive: true });
    writeFileSync(join(src, "a.txt"), "hello");
    writeFileSync(join(src, "sub", "b.txt"), "world");

    const archive = packDirectory(src);
    expect(archive.length).toBeGreaterThan(0);
    // Compressed archive must not start with the classic 8-byte length
    // header this test used to parse directly (pre-0.9) — it now carries
    // the "FPK1" envelope magic instead.
    expect(archive.subarray(0, 4).toString("ascii")).toBe("FPK1");

    const destDir = makeTempDir("fusion-pack-dest-");
    unpackArchive(archive, destDir);
    expect(readFileSync(join(destDir, "a.txt"), "utf8")).toBe("hello");
    expect(readFileSync(join(destDir, "sub", "b.txt"), "utf8")).toBe("world");
  });

  it("compresses repetitive text content meaningfully (the actual point of catálogo 0.9)", () => {
    const src = makeTempDir("fusion-pack-compressible-");
    // Simulate pack JSON: long, repetitive text compresses hard with brotli.
    const repetitive = JSON.stringify({ name: "Feat" }).repeat(500);
    writeFileSync(join(src, "documents.json"), repetitive);

    const archive = packDirectory(src);
    expect(archive.length).toBeLessThan(repetitive.length / 2);
  });
});

// ---------------------------------------------------------------------------
// Compression envelope / backward compatibility (catálogo 0.9)
// ---------------------------------------------------------------------------

describe("compressArchive / decodeArchive", () => {
  it("round-trips an arbitrary classic-layout buffer byte-identical through compress -> decode", () => {
    const fileBytes = Buffer.from("some content here", "utf8");
    const index = { entries: [{ path: "a.txt", size: fileBytes.length, mode: 0o644 }] };
    const indexJson = Buffer.from(JSON.stringify(index), "utf8");
    const lenBuf = Buffer.alloc(8);
    lenBuf.writeBigUInt64LE(BigInt(indexJson.length), 0);
    const classic = Buffer.concat([lenBuf, indexJson, fileBytes]);

    const compressed = compressArchive(classic);
    expect(compressed.subarray(0, 4).toString("ascii")).toBe("FPK1");
    expect(decodeArchive(compressed).equals(classic)).toBe(true);
  });

  it("still reads a pre-0.9 archive with NO compression envelope (backward compatibility)", () => {
    // Build the classic (pre-0.9) layout by hand: 8-byte index length +
    // index JSON + concatenated file bytes — no "FPK1" magic prefix at all.
    const fileBytes = Buffer.from("legacy content", "utf8");
    const index = { entries: [{ path: "legacy.txt", size: fileBytes.length, mode: 0o644 }] };
    const indexJson = Buffer.from(JSON.stringify(index), "utf8");
    const lenBuf = Buffer.alloc(8);
    lenBuf.writeBigUInt64LE(BigInt(indexJson.length), 0);
    const legacyArchive = Buffer.concat([lenBuf, indexJson, fileBytes]);

    expect(legacyArchive.subarray(0, 4).toString("ascii")).not.toBe("FPK1");

    const destDir = makeTempDir("fusion-legacy-dest-");
    unpackArchive(legacyArchive, destDir);
    expect(readFileSync(join(destDir, "legacy.txt"), "utf8")).toBe("legacy content");
  });

  it("decodeArchive is a no-op passthrough for an explicit codec-NONE envelope", () => {
    const fileBytes = Buffer.from("stored, not compressed", "utf8");
    const index = { entries: [{ path: "f.txt", size: fileBytes.length, mode: 0o644 }] };
    const indexJson = Buffer.from(JSON.stringify(index), "utf8");
    const lenBuf = Buffer.alloc(8);
    lenBuf.writeBigUInt64LE(BigInt(indexJson.length), 0);
    const classic = Buffer.concat([lenBuf, indexJson, fileBytes]);

    const header = Buffer.alloc(21);
    Buffer.from("FPK1", "ascii").copy(header, 0);
    header.writeUInt8(ARCHIVE_CODEC_NONE, 4);
    header.writeBigUInt64LE(BigInt(classic.length), 5);
    header.writeBigUInt64LE(BigInt(classic.length), 13);
    const enveloped = Buffer.concat([header, classic]);

    const decoded = decodeArchive(enveloped);
    expect(decoded.equals(classic)).toBe(true);
  });

  it("throws a clear UnknownArchiveCodecError for an envelope naming an unrecognized codec", () => {
    const classic = Buffer.from("irrelevant payload for this test");
    const header = Buffer.alloc(21);
    Buffer.from("FPK1", "ascii").copy(header, 0);
    header.writeUInt8(99, 4); // codec this build has never heard of
    header.writeBigUInt64LE(BigInt(classic.length), 5);
    header.writeBigUInt64LE(BigInt(classic.length), 13);
    const enveloped = Buffer.concat([header, classic]);

    expect(() => decodeArchive(enveloped)).toThrow(UnknownArchiveCodecError);
    expect(() => decodeArchive(enveloped)).toThrow(/codec 99/);
  });

  it("throws a clear error when the decompressed length does not match the envelope header (corruption)", () => {
    const src = makeTempDir("fusion-corrupt-src-");
    writeFileSync(join(src, "a.txt"), "hello world");
    const archive = packDirectory(src);
    // Corrupt the recorded original length (bytes 13..21) so the
    // post-decompression length check fails.
    const tampered = Buffer.from(archive);
    tampered.writeBigUInt64LE(999999n, 13);

    expect(() => decodeArchive(tampered)).toThrow(/Corrupted pack archive/);
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
