/**
 * SEA asset keys and client-dist extraction (M6/B3 — REQ-DST-002/046).
 *
 * The SEA build embeds two kinds of assets (see tools/release/make-sea-config.mjs):
 *   1. The two native addon package archives (native-loader.ts owns those —
 *      "native-better-sqlite3" / "native-node-rs-argon2").
 *   2. A single packed archive of `packages/client/dist` under the asset key
 *      {@link CLIENT_DIST_ASSET_KEY}, reusing the exact same pack/unpack
 *      format as native-loader.ts's `packDirectory`/unpack (see that module's
 *      doc comment — "Archive format" section — for why this project has its
 *      own minimal format instead of a `tar` dependency).
 *
 * Both are extracted once per version into `<dataDir>/runtime/<version>/`,
 * mirroring the native-addon cache: recreable, versioned, never
 * hand-maintained by the GM.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { packDirectory, type NativePackageSpec } from "./native-loader.js";

export const CLIENT_DIST_ASSET_KEY = "client-dist";

/** Re-export for the packer script — keeps the archive format defined once. */
export { packDirectory };
export type { NativePackageSpec };

/**
 * Unpack an archive produced by {@link packDirectory} into `destDir`. Split
 * out from native-loader.ts's private `unpackDirectory` so both native
 * addons AND the client dist can share one extraction routine without a
 * circular import (native-loader.ts is imported BY this module, not the
 * other way around, to keep the SEA entry point's very-first-line import
 * graph — see sea-entry.ts — as small as possible).
 */
function unpackArchive(archive: Buffer, destDir: string): void {
  const INDEX_HEADER_BYTES = 8;
  const indexLen = Number(archive.readBigUInt64LE(0));
  const indexJson = archive
    .subarray(INDEX_HEADER_BYTES, INDEX_HEADER_BYTES + indexLen)
    .toString("utf8");
  const index = JSON.parse(indexJson) as {
    entries: { path: string; size: number; mode: number }[];
  };

  let offset = INDEX_HEADER_BYTES + indexLen;
  for (const entry of index.entries) {
    const bytes = archive.subarray(offset, offset + entry.size);
    offset += entry.size;
    const destPath = join(destDir, ...entry.path.split("/"));
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, bytes, { mode: entry.mode || 0o644 });
  }
}

export interface EnsureClientDistOptions {
  dataDir: string;
  version: string;
  getRawAsset?: (key: string) => ArrayBuffer;
  logger?: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
  };
}

/**
 * Directory {@link ensureClientDistExtracted} extracts into. Exported so
 * boot/CLI wiring can pass it straight through as `spaContext.distDir`.
 */
export function clientDistRuntimeDir(dataDir: string, version: string): string {
  return join(dataDir, "runtime", version, "client-dist");
}

/**
 * Idempotently extract the embedded `packages/client/dist` SEA asset to
 * `<dataDir>/runtime/<version>/client-dist/`, verifying a SHA-256 sidecar
 * the same way native-loader.ts does for the native addons. Returns the
 * extraction directory (always — whether freshly extracted or cache-hit).
 *
 * Async for the same reason as native-loader.ts's `ensureNativeAddonsExtracted`
 * — resolving the default `getRawAsset` needs a dynamic `import("node:sea")`
 * (this package is real ESM; no bare `require` exists at module scope).
 */
export async function ensureClientDistExtracted(options: EnsureClientDistOptions): Promise<string> {
  const { dataDir, version, logger } = options;

  let getRawAsset = options.getRawAsset;
  if (getRawAsset === undefined) {
    const sea = await import("node:sea");
    getRawAsset = (key: string) => sea.getRawAsset(key);
  }

  const destDir = clientDistRuntimeDir(dataDir, version);
  const hashSidecar = `${destDir}.sha256`;

  const archiveBuf = Buffer.from(getRawAsset(CLIENT_DIST_ASSET_KEY));
  const archiveHash = createHash("sha256").update(archiveBuf).digest("hex");

  if (existsSync(destDir) && existsSync(hashSidecar)) {
    const cachedHash = readFileSync(hashSidecar, "utf8").trim();
    if (cachedHash === archiveHash) {
      logger?.info({ destDir }, "Client dist already extracted (cache hit)");
      return destDir;
    }
    logger?.warn({ destDir }, "Client dist cache stale or corrupted — re-extracting");
  }

  const tmpDir = `${destDir}.tmp-${String(process.pid)}`;
  mkdirSync(dirname(tmpDir), { recursive: true });
  unpackArchive(archiveBuf, tmpDir);

  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }
  renameSync(tmpDir, destDir);
  writeFileSync(hashSidecar, archiveHash, "utf8");

  logger?.info({ destDir }, "Client dist extracted and verified");
  return destDir;
}
