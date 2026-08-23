/**
 * SEA asset keys and client-dist/system-packs extraction (M6/B3 —
 * REQ-DST-002/046; system-packs added in B3-FIXES MÉDIA B — REQ-CMP-006).
 *
 * The SEA build embeds three kinds of assets (see tools/release/make-sea-config.mjs):
 *   1. The two native addon package archives (native-loader.ts owns those —
 *      "native-better-sqlite3" / "native-node-rs-argon2").
 *   2. A single packed archive of `packages/client/dist` under the asset key
 *      {@link CLIENT_DIST_ASSET_KEY}, reusing the exact same pack/unpack
 *      format as native-loader.ts's `packDirectory`/unpack (see that module's
 *      doc comment — "Archive format" section — for why this project has its
 *      own minimal format instead of a `tar` dependency).
 *   3. A single packed archive of every game system's `systems/<id>/packs/`
 *      directory under the asset key {@link SYSTEM_PACKS_ASSET_KEY} — see
 *      {@link ensureSystemPacksExtracted}'s doc comment for why this exists
 *      (compendium:list returning [] in the packaged exe on a clean machine).
 *
 * All three are extracted once per version into `<dataDir>/runtime/<version>/`,
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

// ---------------------------------------------------------------------------
// System compendium packs (B3-FIXES MÉDIA B)
// ---------------------------------------------------------------------------

/**
 * SEA asset key for the packed archive of every game system's
 * `systems/<systemId>/packs/` directory (see tools/release/build-release.mjs
 * phase 5 and pack-native.mjs's `--multi-dir` mode).
 *
 * PROBLEM this closes: `resolveSystemPacksDir` (compendium/service.ts)
 * discovers packs by walking up from ITS OWN on-disk location to find the
 * monorepo root (`pnpm-workspace.yaml`) and then reading
 * `<root>/systems/<systemId>/packs`. Inside a SEA executable on a clean
 * machine there is no monorepo checkout next to the exe — that walk always
 * returns null, so `compendium:list` silently returns `[]` even though the
 * committed pf2e/sf2e packs exist and are small (well under the
 * REQ-DST-046 150 MB budget; the whole systems tree of packs directories is
 * ~850 KB as of this batch).
 *
 * FIX shape: identical pattern to {@link CLIENT_DIST_ASSET_KEY} — pack all
 * systems' packs directories into ONE archive at build time (each nested
 * under `<systemId>/packs/...` so the extracted tree is a valid
 * `resolveSystemPacksDir` "packsRoot" — i.e. a directory containing
 * `<systemId>/packs/<slug>/pack.json`), extract it once per version to
 * `<dataDir>/runtime/<version>/system-packs/`, and record that directory in
 * an env var (`FUSION_SEA_SYSTEM_PACKS_DIR`, set by sea-entry.ts) that
 * `resolveSystemPacksDir` checks BEFORE its monorepo walk-up — see that
 * function's updated resolution-order doc comment in compendium/service.ts.
 */
export const SYSTEM_PACKS_ASSET_KEY = "system-packs";

export interface EnsureSystemPacksOptions {
  dataDir: string;
  version: string;
  getRawAsset?: (key: string) => ArrayBuffer;
  logger?: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
  };
}

/**
 * Directory {@link ensureSystemPacksExtracted} extracts into. This directory
 * itself IS a valid `resolveSystemPacksDir` "packsRoot" — it contains one
 * subdirectory per system id (`pf2e/`, `sf2e/`), each holding that
 * system's `packs/` tree exactly as `systems/<id>/packs/` does in the
 * monorepo checkout.
 */
export function systemPacksRuntimeDir(dataDir: string, version: string): string {
  return join(dataDir, "runtime", version, "system-packs");
}

/**
 * Idempotently extract the embedded system-packs SEA asset to
 * `<dataDir>/runtime/<version>/system-packs/`, verified by a SHA-256
 * sidecar — same cache/atomic-rename semantics as
 * {@link ensureClientDistExtracted} and native-loader.ts's
 * `ensureNativeAddonsExtracted`.
 */
export async function ensureSystemPacksExtracted(
  options: EnsureSystemPacksOptions,
): Promise<string> {
  const { dataDir, version, logger } = options;

  let getRawAsset = options.getRawAsset;
  if (getRawAsset === undefined) {
    const sea = await import("node:sea");
    getRawAsset = (key: string) => sea.getRawAsset(key);
  }

  const destDir = systemPacksRuntimeDir(dataDir, version);
  const hashSidecar = `${destDir}.sha256`;

  const archiveBuf = Buffer.from(getRawAsset(SYSTEM_PACKS_ASSET_KEY));
  const archiveHash = createHash("sha256").update(archiveBuf).digest("hex");

  if (existsSync(destDir) && existsSync(hashSidecar)) {
    const cachedHash = readFileSync(hashSidecar, "utf8").trim();
    if (cachedHash === archiveHash) {
      logger?.info({ destDir }, "System packs already extracted (cache hit)");
      return destDir;
    }
    logger?.warn({ destDir }, "System packs cache stale or corrupted — re-extracting");
  }

  const tmpDir = `${destDir}.tmp-${String(process.pid)}`;
  mkdirSync(dirname(tmpDir), { recursive: true });
  unpackArchive(archiveBuf, tmpDir);

  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }
  renameSync(tmpDir, destDir);
  writeFileSync(hashSidecar, archiveHash, "utf8");

  logger?.info({ destDir }, "System packs extracted and verified");
  return destDir;
}
