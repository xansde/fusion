/**
 * Download + hash-verify + cache the `cloudflared` binary (M6/B4 — REQ-DST-034).
 *
 * `cloudflared` is not an npm dependency (see cloudflared-releases.ts) — it is
 * fetched on demand into `<dataDir>/runtime/cloudflared[.exe]` the first time
 * a tunnel is requested, and reused (by hash) on every subsequent boot. This
 * mirrors the "runtime/ cache, interne, recriável" pattern the M6 design doc
 * already establishes for the native `.node` addons (§1.5).
 */

import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Logger } from "pino";
import {
  resolveCloudflaredAsset,
  cloudflaredBinaryName,
  type CloudflaredAsset,
} from "./cloudflared-releases.js";

export class UnsupportedPlatformError extends Error {
  constructor(platform: string, arch: string) {
    super(
      `No pinned cloudflared release for platform "${platform}"/"${arch}". ` +
        `The tunnel feature is unavailable on this platform — see ` +
        `packages/server/src/tunnel/cloudflared-releases.ts for supported combinations.`,
    );
    this.name = "UnsupportedPlatformError";
  }
}

export class HashMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(
      `Downloaded cloudflared binary failed SHA-256 verification. ` +
        `Expected ${expected}, got ${actual}. The download was discarded — this may ` +
        `indicate a corrupted download, a network MITM, or the pinned release moved. ` +
        `Refusing to run an unverified binary.`,
    );
    this.name = "HashMismatchError";
  }
}

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Extract the `cloudflared` executable from a gzip-compressed tarball
 * (macOS releases ship as .tgz). Implemented as a minimal tar reader rather
 * than pulling in a tar dependency — the cloudflared macOS tarball has a
 * single regular-file entry, so a full tar implementation is unnecessary.
 */
function extractSingleFileFromTar(tarBytes: Buffer): Buffer {
  // TAR format: 512-byte header blocks. Header layout (subset used here):
  //   name: bytes 0..100 (null-terminated)
  //   size: bytes 124..136 (octal ASCII, null/space padded)
  //   typeflag: byte 156 ('0' or '\0' = regular file)
  let offset = 0;
  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512);
    // Two consecutive zero blocks mark end-of-archive.
    if (header.every((b) => b === 0)) break;

    const nameRaw = header.subarray(0, 100).toString("utf8");
    const nullIdx = nameRaw.indexOf("\0");
    const name = nullIdx === -1 ? nameRaw : nameRaw.slice(0, nullIdx);

    const sizeOctal = header.subarray(124, 136).toString("utf8").replace(/\0/g, "").trim();
    const size = sizeOctal.length > 0 ? parseInt(sizeOctal, 8) : 0;
    const typeflag = String.fromCharCode(header[156] ?? 0);

    const dataStart = offset + 512;
    const isRegularFile = typeflag === "0" || typeflag === "\0" || typeflag === "";

    if (isRegularFile && name.length > 0 && !name.endsWith("/") && Number.isFinite(size)) {
      const baseName = name.split("/").pop() ?? name;
      if (baseName === "cloudflared") {
        return Buffer.from(tarBytes.subarray(dataStart, dataStart + size));
      }
    }

    // Advance past this entry's data, rounded up to the next 512-byte block.
    const blocks = Math.ceil(size / 512);
    offset = dataStart + blocks * 512;
  }

  throw new Error("cloudflared tarball did not contain a 'cloudflared' entry");
}

export interface EnsureCloudflaredOptions {
  /** Root data directory (`<dataDir>/runtime/` is where the binary is cached). */
  dataDir: string;
  logger?: Logger;
  /** Override for tests: which platform/arch to resolve the pinned asset for. */
  platform?: NodeJS.Platform;
  arch?: string;
  /** Override for tests: injectable fetch (defaults to the global fetch). */
  fetchImpl?: typeof fetch;
}

/**
 * Ensure a verified `cloudflared` binary is present at
 * `<dataDir>/runtime/cloudflared[.exe]`, downloading it if absent or if the
 * cached file's hash does not match the pinned hash (e.g. a partial/corrupt
 * previous download). Returns the absolute path to the ready-to-run binary.
 *
 * On hash mismatch of a freshly downloaded file, the bad file is deleted
 * (never left on disk) and {@link HashMismatchError} is thrown.
 */
export async function ensureCloudflared(options: EnsureCloudflaredOptions): Promise<string> {
  const {
    dataDir,
    logger,
    platform = process.platform,
    arch = process.arch,
    fetchImpl = fetch,
  } = options;

  const asset = resolveCloudflaredAsset(platform, arch);
  if (asset === undefined) {
    throw new UnsupportedPlatformError(platform, arch);
  }

  const runtimeDir = join(dataDir, "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const binPath = join(runtimeDir, cloudflaredBinaryName(platform));

  // Cache hit: file exists and matches the pinned hash for the *extracted*
  // binary. We store the hash of the extracted binary in a sidecar file
  // (`<bin>.sha256`) because the on-disk binary is not byte-identical to the
  // downloaded asset for .tgz platforms (it's the extracted member) — so we
  // cannot re-verify against `asset.sha256` (that hash is of the .tgz, not
  // the raw binary) without re-downloading. Comparing the sidecar avoids a
  // false-negative cache miss on every boot for macOS.
  const sidecarPath = `${binPath}.sha256`;
  if (existsSync(binPath) && existsSync(sidecarPath)) {
    const cachedHash = readFileSync(sidecarPath, "utf8").trim();
    const actualHash = sha256Hex(readFileSync(binPath));
    if (cachedHash === actualHash) {
      logger?.debug({ binPath }, "cloudflared binary already cached and verified");
      return binPath;
    }
    logger?.warn({ binPath }, "Cached cloudflared binary failed re-verification — re-downloading");
    rmSync(binPath, { force: true });
    rmSync(sidecarPath, { force: true });
  }

  logger?.info({ url: asset.url, platform, arch }, "Downloading cloudflared");

  const downloaded = await downloadAsset(asset, fetchImpl);

  // Verify the RAW download against the pinned hash before touching the
  // filesystem further — this is the actual integrity gate (REQ-DST-034
  // "verificação de hash SHA-256 pinada").
  const downloadedHash = sha256Hex(downloaded);
  if (downloadedHash !== asset.sha256) {
    throw new HashMismatchError(asset.sha256, downloadedHash);
  }

  // Extract if needed (macOS .tgz), else use the raw download as-is.
  const binaryBytes =
    asset.archive === "tgz" ? extractSingleFileFromTar(gunzipSync(downloaded)) : downloaded;

  writeFileSync(binPath, binaryBytes);
  if (platform !== "win32") {
    chmodSync(binPath, 0o755);
  }
  writeFileSync(sidecarPath, sha256Hex(binaryBytes), "utf8");

  logger?.info({ binPath }, "cloudflared downloaded and verified");
  return binPath;
}

async function downloadAsset(asset: CloudflaredAsset, fetchImpl: typeof fetch): Promise<Buffer> {
  const res = await fetchImpl(asset.url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `Failed to download cloudflared from ${asset.url}: HTTP ${String(res.status)} ${res.statusText}`,
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
