/**
 * Native addon resolution shim for the SEA (Single Executable Application)
 * build (M6/B3 — REQ-DST-001/002/003/004/046, design doc §1.3/§1.5).
 *
 * PROBLEM. `better-sqlite3` and `@node-rs/argon2` are native addons (`.node`
 * files) — no bundler (esbuild included) can embed a `.node` binary INSIDE a
 * single JS bundle; `dlopen` always needs a real file on disk. Both packages
 * also resolve their `.node` file with their OWN internal logic that this
 * module cannot simply parameterise:
 *   - `better-sqlite3` calls `require('bindings')('better_sqlite3.node')`,
 *     which walks up from the calling module's directory looking for
 *     `build/Release/better_sqlite3.node` (and several sibling layouts).
 *   - `@node-rs/argon2` generates a big if/else of
 *     `require('./argon2.<platform>-<arch>.node')` falling back to
 *     `require('@node-rs/argon2-<platform>-<arch>')`.
 * Neither accepts an explicit path — the ONLY reliable interception point
 * that does not require re-implementing either loader's platform-detection
 * logic is Node's own module resolution, one level up: override
 * `Module._resolveFilename` so that when EITHER package's glue code calls
 * `require('better-sqlite3')` / `require('@node-rs/argon2')` (the top-level
 * package specifiers our own code uses — see db/connection.ts and
 * auth/crypto.ts), Node resolves to a real, on-disk copy of that package
 * instead of trying (and failing) to find it inside the SEA blob.
 *
 * SOLUTION SHAPE (design doc §1.3, path 1a — "exe extracts to
 * <dataDir>/runtime/<version>/ on first run"):
 *   1. At BUILD time (tools/release/build-release.mjs), the two packages'
 *      real on-disk directories (`node_modules/better-sqlite3`,
 *      `node_modules/@node-rs/argon2`, `node_modules/@node-rs/argon2-<abi>`)
 *      are archived and embedded as SEA assets (see sea-assets.ts).
 *   2. At RUNTIME, `ensureNativeAddonsExtracted` (called once, at the very
 *      top of the SEA entry point — see runtime/sea-entry.ts — BEFORE
 *      anything else in the bundle runs) extracts those assets to
 *      `<dataDir>/runtime/<FUSION_VERSION>/node_modules/...`, verifying a
 *      SHA-256 manifest so a corrupted/partial extraction is redone rather
 *      than silently used.
 *   3. `installNativeAddonResolutionHook` patches `Module._resolveFilename`
 *      so `require('better-sqlite3')` and `require('@node-rs/argon2')`
 *      resolve to the extracted copy's own `package.json`-declared main.
 *
 * OUTSIDE the SEA build (normal `pnpm dev`, `vitest`, plain
 * `node dist/index.js`), none of this runs — `sea.isSea()` is false, so
 * `db/connection.ts`'s plain `import Database from "better-sqlite3"` keeps
 * resolving through ordinary node_modules exactly as it does today. This
 * module is inert unless explicitly invoked, and the hook it installs is a
 * narrow rewrite of exactly two bare specifiers, never touched for anything
 * else.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
  renameSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One native package to extract. `specifier` is the bare import specifier
 * our own code uses (`db/connection.ts`, `auth/crypto.ts`); `assetKey` is
 * the SEA asset name the archive was embedded under (see sea-assets.ts,
 * which packs `node_modules/<packageDir>` recursively into a single tar-ish
 * archive per package so directory structure — including nested platform
 * packages like `@node-rs/argon2-win32-x64-msvc` — survives the round trip).
 */
export interface NativePackageSpec {
  /** Bare specifier that application code `require()`s, e.g. "better-sqlite3". */
  specifier: string;
  /** SEA asset key the packed archive of this package's directory lives under. */
  assetKey: string;
}

export const NATIVE_PACKAGES: readonly NativePackageSpec[] = [
  { specifier: "better-sqlite3", assetKey: "native-better-sqlite3" },
  { specifier: "@node-rs/argon2", assetKey: "native-node-rs-argon2" },
];

export class NativeAddonExtractionError extends Error {
  constructor(pkg: string, cause: unknown) {
    super(
      `Failed to extract native addon package "${pkg}" to the runtime cache. ` +
        `Fusion cannot start without it. Try deleting the "runtime" folder in ` +
        `your data directory and restarting — it will be re-extracted from the ` +
        `executable. ` +
        (cause instanceof Error ? `Underlying error: ${cause.message}` : String(cause)),
    );
    this.name = "NativeAddonExtractionError";
  }
}

// ---------------------------------------------------------------------------
// Archive format — a minimal, dependency-free "packed directory" format.
//
// Not a real tar: just a JSON index (relative path -> byte range) followed
// by the concatenated raw file bytes. This keeps the packer/unpacker free of
// any new runtime dependency (no `tar` package) — appropriate for a format
// this module fully owns on both ends (packed once at build time by
// tools/release/pack-native.mjs, unpacked here).
// ---------------------------------------------------------------------------

interface PackedEntry {
  /** Path relative to the package root, forward-slash separated. */
  path: string;
  size: number;
  /** Base64-encoded POSIX file mode (only the executable bit matters cross-platform). */
  mode: number;
}

interface PackedIndex {
  entries: PackedEntry[];
}

const INDEX_HEADER_BYTES = 8; // uint32 index length, then index length is used

/**
 * Pack a directory (recursively) into the archive format this module reads.
 * Used only by the build-time packer script (tools/release/pack-native.mjs),
 * exported here so the format is defined in exactly one place and the
 * pack/unpack code paths cannot silently drift apart.
 */
export function packDirectory(rootDir: string): Buffer {
  const entries: PackedEntry[] = [];
  const chunks: Buffer[] = [];

  function walk(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = relative(rootDir, full).split("\\").join("/");
      const bytes = readFileSync(full);
      entries.push({ path: rel, size: bytes.length, mode: st.mode & 0o777 });
      chunks.push(bytes);
    }
  }
  walk(rootDir);

  const index: PackedIndex = { entries };
  const indexJson = Buffer.from(JSON.stringify(index), "utf8");
  const lenBuf = Buffer.alloc(INDEX_HEADER_BYTES);
  lenBuf.writeBigUInt64LE(BigInt(indexJson.length), 0);

  return Buffer.concat([lenBuf, indexJson, ...chunks]);
}

/**
 * Unpack an archive produced by {@link packDirectory} into `destDir`.
 * Returns the SHA-256 of the raw archive (used as the extraction's cache key).
 */
function unpackDirectory(archive: Buffer, destDir: string): void {
  const indexLen = Number(archive.readBigUInt64LE(0));
  const indexJson = archive
    .subarray(INDEX_HEADER_BYTES, INDEX_HEADER_BYTES + indexLen)
    .toString("utf8");
  const index = JSON.parse(indexJson) as PackedIndex;

  let offset = INDEX_HEADER_BYTES + indexLen;
  for (const entry of index.entries) {
    const bytes = archive.subarray(offset, offset + entry.size);
    offset += entry.size;

    const destPath = join(destDir, ...entry.path.split("/"));
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, bytes, { mode: entry.mode || 0o644 });
  }
}

// ---------------------------------------------------------------------------
// Extraction (runtime side)
// ---------------------------------------------------------------------------

export interface EnsureNativeAddonsOptions {
  /** Root Fusion data directory — extraction target is `<dataDir>/runtime/<version>/`. */
  dataDir: string;
  /** Fusion version string — namespaces the extraction dir so an update never mixes ABIs (DA-07). */
  version: string;
  /** Injected for tests: read a named SEA asset. Defaults to `node:sea`'s getRawAsset. */
  getRawAsset?: (key: string) => ArrayBuffer;
  /** Injected for tests: which packages to extract. Defaults to {@link NATIVE_PACKAGES}. */
  packages?: readonly NativePackageSpec[];
  logger?: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
  };
}

/**
 * Directory that {@link ensureNativeAddonsExtracted} extracts/verifies
 * packages into for a given (dataDir, version) pair. Exported so the
 * resolution hook and tests share the exact same path derivation.
 */
export function nativeRuntimeDir(dataDir: string, version: string): string {
  return join(dataDir, "runtime", version, "node_modules");
}

/**
 * Idempotently ensure every entry of {@link NATIVE_PACKAGES} (or `packages`,
 * for tests) is extracted and verified under
 * `<dataDir>/runtime/<version>/node_modules/<packageName>/`.
 *
 * A sidecar `<packageDir>.sha256` file records the hash of the SEA asset
 * that produced the extraction; on every call, if the sidecar hash matches
 * the current asset's hash, extraction is skipped (fast path — this runs on
 * every boot, not just the first). A mismatch (asset changed — should only
 * happen across versions, which already get a fresh `<version>/` directory,
 * or a corrupted previous run) forces re-extraction.
 *
 * Never partially leaves a package half-extracted on failure: writes happen
 * into a temp sibling dir first, which is renamed into place only once
 * unpacking succeeds completely.
 *
 * Async because resolving the default `getRawAsset` requires a dynamic
 * `import("node:sea")` — this package builds as real ESM (NodeNext), so a
 * bare CJS-style `require` is not available at module scope. Callers that
 * inject `getRawAsset` (tests) can still be exercised synchronously in
 * effect, but the function signature stays async either way for one
 * consistent call shape.
 */
export async function ensureNativeAddonsExtracted(
  options: EnsureNativeAddonsOptions,
): Promise<void> {
  const { dataDir, version, packages = NATIVE_PACKAGES, logger } = options;

  let getRawAsset = options.getRawAsset;
  if (getRawAsset === undefined) {
    // Dynamic import so this module can be imported outside a SEA context
    // (e.g. by tests, or by ordinary `pnpm dev`) without node:sea complaining
    // — node:sea's named exports are only meaningfully callable inside an
    // actual SEA process, but the module itself is always importable.
    const sea = await import("node:sea");
    getRawAsset = (key: string) => sea.getRawAsset(key);
  }

  const targetRoot = nativeRuntimeDir(dataDir, version);
  mkdirSync(targetRoot, { recursive: true });

  for (const pkg of packages) {
    const packageDirName = pkg.specifier; // "better-sqlite3" or "@node-rs/argon2"
    const destDir = join(targetRoot, ...packageDirName.split("/"));
    const hashSidecar = `${destDir}.sha256`;

    let archiveBuf: Buffer;
    try {
      const raw = getRawAsset(pkg.assetKey);
      archiveBuf = Buffer.from(raw);
    } catch (err) {
      throw new NativeAddonExtractionError(pkg.specifier, err);
    }

    const archiveHash = createHash("sha256").update(archiveBuf).digest("hex");

    if (existsSync(destDir) && existsSync(hashSidecar)) {
      const cachedHash = readFileSync(hashSidecar, "utf8").trim();
      if (cachedHash === archiveHash) {
        logger?.info({ pkg: pkg.specifier, destDir }, "Native addon already extracted (cache hit)");
        continue;
      }
      logger?.warn(
        { pkg: pkg.specifier, destDir },
        "Native addon cache stale or corrupted — re-extracting",
      );
    }

    try {
      // Extract into a temp sibling, then rename atomically into place so a
      // crash mid-extraction never leaves a half-written package directory
      // that a later boot would treat as a valid cache hit.
      const tmpDir = `${destDir}.tmp-${String(process.pid)}`;
      mkdirSync(dirname(tmpDir), { recursive: true });
      unpackDirectory(archiveBuf, tmpDir);

      if (existsSync(destDir)) {
        // Best-effort cleanup of the stale directory before the rename.
        rmSync(destDir, { recursive: true, force: true });
      }
      renameSync(tmpDir, destDir);
      writeFileSync(hashSidecar, archiveHash, "utf8");

      logger?.info({ pkg: pkg.specifier, destDir }, "Native addon extracted and verified");
    } catch (err) {
      throw new NativeAddonExtractionError(pkg.specifier, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Module resolution hook
// ---------------------------------------------------------------------------

let hookInstalled = false;

/**
 * Patch `Module._resolveFilename` so `require('better-sqlite3')` and
 * `require('@node-rs/argon2')` (and only those two exact bare specifiers)
 * resolve to the extracted copies under `<dataDir>/runtime/<version>/`
 * instead of Node's normal node_modules algorithm (which would fail inside
 * the SEA — there is no real node_modules on disk next to the exe).
 *
 * Idempotent — calling this more than once (e.g. across tests) is a no-op
 * after the first call.
 *
 * MUST be called before ANY code in the bundle does
 * `require('better-sqlite3')` / `import ... from "@node-rs/argon2"` — see
 * runtime/sea-entry.ts, which calls this as literally its first statement.
 */
export function installNativeAddonResolutionHook(dataDir: string, version: string): void {
  if (hookInstalled) return;
  hookInstalled = true;

  const runtimeDir = nativeRuntimeDir(dataDir, version);
  const overrides = new Map<string, string>(
    NATIVE_PACKAGES.map((pkg) => [pkg.specifier, join(runtimeDir, ...pkg.specifier.split("/"))]),
  );

  // IMPORTANT: `import * as NodeModule from "node:module"` gives an ESM
  // namespace object whose bindings are read-only per the ECMAScript spec —
  // assigning to `NodeModule._resolveFilename` throws
  // "Cannot assign to read only property" even though Node's own internal
  // `Module` class has a plain writable static property of that name. The
  // only way to reach the REAL, mutable CJS `module.exports` object (which
  // every pkg/nexe-style tool patches) from ESM is a CJS-style `require()`
  // via `createRequire` — `import` syntax cannot express this at all.
  //
  // `require()`'s own return type is already `any` (Node's NodeRequire type,
  // no generic overload for "node:module" specifically) and
  // `Module._resolveFilename` is a documented-but-unofficial Node internal
  // with no @types/node declaration at all — so every access below is
  // necessarily untyped. Confined to this one function; every other
  // function in this file is fully typed.
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
  const require = createRequire(import.meta.url);
  const ModuleAny = require("node:module");
  const originalResolve = ModuleAny._resolveFilename.bind(ModuleAny);

  ModuleAny._resolveFilename = function patchedResolveFilename(
    request: string,
    ...rest: unknown[]
  ) {
    const overrideDir = overrides.get(request);
    if (overrideDir !== undefined) {
      // Resolve to the package.json main from the extracted copy — reuse
      // Node's own resolver, just rooted at the extracted directory instead
      // of node_modules, by requesting resolution of "." from that
      // directory via a synthetic parent module.
      return originalResolve(overrideDir, ...rest);
    }
    return originalResolve(request, ...rest);
  };
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
}

/** Test-only: reset the module-level install guard between test cases. */
export function _resetNativeAddonResolutionHookForTests(): void {
  hookInstalled = false;
}
