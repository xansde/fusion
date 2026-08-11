#!/usr/bin/env node
/**
 * `pnpm build:release` — the M6/B3 release pipeline (design doc §5 B3,
 * REQ-DST-001/002/003/004/027/042/043/044/046).
 *
 * Phases (bail on the first failure, exit 1):
 *   0. Clean stale dist-release/ artifacts + manifests from a PREVIOUS
 *      version (B3-FIXES BAIXA (a)) — a bump-and-rebuild without a fresh
 *      checkout would otherwise leave the OLD version's fusion-server-*
 *      binary and latest-<channel>.json sitting next to the new ones;
 *      smoke-release.mjs's auto-discovery ("exactly one fusion-server-*
 *      under dist-release/") fails loudly in that scenario, and a stale
 *      manifest could get picked up by mistake. Only dist-release/ itself is
 *      touched — never anything under systems/, packages/, node_modules/.
 *   1. Version-drift check (check-version-drift.mjs) — REQ-DST-038's single
 *      source of truth must agree with package.json before anything else.
 *   2. `pnpm -r build` — topological build of shared -> server -> client
 *      (root package.json's own `build` script already gets this ordering
 *      right via pnpm workspaces; reused here rather than re-implemented).
 *   3. `pnpm rebuild better-sqlite3 @node-rs/argon2` against the CURRENT
 *      Node — DA-07's ABI pin: this MUST be run with the exact Node version
 *      that will also be copied as the SEA host binary in step 6, or the
 *      extracted .node files silently fail to load at runtime. This script
 *      compares `process.version` against the copied node.exe's own
 *      `--version` output (step 6) and fails loudly on any mismatch.
 *   4. esbuild bundle of runtime/sea-entry.ts to a single CJS file, with
 *      better-sqlite3 and @node-rs/argon2 marked external (SEA cannot embed
 *      .node files — see native-loader.ts's doc comment) and an
 *      import.meta.url shim (esbuild's CJS output empties import.meta;
 *      several modules in this codebase — native-loader.ts,
 *      compendium/service.ts, spa/routes.ts — need a real file URL to
 *      locate themselves).
 *   5. Pack the two native addon packages (+ their transitive runtime deps),
 *      packages/client/dist, AND every game system's systems/<id>/packs/
 *      directory (B3-FIXES MÉDIA B — REQ-CMP-006 in the packaged exe) into
 *      the custom archive format (pack-native.mjs / native-loader.ts's
 *      packDirectory). The client dist is packed with `--exclude avatar`:
 *      the avatar acervo is 22 MB and ships as a SIDECAR directory next to the
 *      artifact instead (spec 33, REQ-AVT-041), because embedding it would blow
 *      the 150 MB budget of step 7.
 *   6. Assemble the SEA: generate sea-config.json (make-sea-config.mjs),
 *      run `node --experimental-sea-config`, copy the CURRENT node.exe,
 *      inject the blob via postject, name the result
 *      `fusion-server-<version>-<platform>-<arch>[.exe]` (REQ-DST-004).
 *   7. Compute SHA-256 + size; fail if size > 150 MB (REQ-DST-046, DA-04).
 *   8. Write `latest-<channel>.json` (UpdateManifest shape, spec 22) into
 *      dist-release/ alongside the artefact.
 *
 * `updateRepo`/owner is the DA-01 placeholder ("REPLACE_ME/fusion", same
 * default as config.ts's ServerConfigSchema) — documented, not fabricated.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
  cpSync,
  statSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeManifest } from "./manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const distReleaseDir = join(repoRoot, "dist-release");
const workDir = join(distReleaseDir, ".work");

const MAX_ARTIFACT_BYTES = 150 * 1024 * 1024; // REQ-DST-046

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function log(msg) {
  process.stdout.write(`[build:release] ${msg}\n`);
}

/**
 * Windows cannot spawn a `.cmd`/`.bat` shim without going through a shell —
 * Node's own child_process throws EINVAL/ENOENT otherwise (a well-known
 * cross-platform gotcha, not specific to this repo). This bites in TWO
 * shapes here: (a) an explicit `.cmd`/`.bat` path
 * (node_modules/.bin/esbuild.cmd — worked around instead by invoking
 * esbuild's own .js bin script directly via `node <path>`, see
 * phaseBundle), and (b) a bare PATH-resolved command name like `"pnpm"`,
 * which on Windows is itself installed as `pnpm.cmd` — `execFileSync`
 * cannot find/spawn it without a shell (ENOENT, not even EINVAL, since
 * Windows' CreateProcess never even tries the .cmd extension on its own).
 * Real `.exe` binaries (node.exe, our own artifact, postject invoked via
 * `node <cli.js>`) never need this.
 */
function needsShellOnWindows(cmd) {
  if (process.platform !== "win32") return false;
  if (/\.(cmd|bat)$/i.test(cmd)) return true;
  // A bare name with no path separator and no extension is PATH-resolved —
  // on Windows that resolution (and therefore whether it's really a .cmd
  // shim underneath) is the shell's job, not child_process's.
  return !cmd.includes("/") && !cmd.includes("\\") && !/\.[a-z0-9]+$/i.test(cmd);
}

function run(cmd, args, options = {}) {
  log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    stdio: "inherit",
    cwd: repoRoot,
    shell: needsShellOnWindows(cmd),
    ...options,
  });
}

function runCapture(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    cwd: repoRoot,
    shell: needsShellOnWindows(cmd),
    ...options,
  }).trim();
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** REQ-DST-004 platform/arch naming — matches config.ts / cloudflared-releases.ts conventions. */
function platformArchLabel() {
  const platform = process.platform;
  const arch = process.arch;

  const platformLabel =
    platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported build arch: "${arch}". Expected x64 or arm64.`);
  }
  return { platformLabel, archLabel: arch, isWindows: platform === "win32" };
}

// ---------------------------------------------------------------------------
// Phase 0 — clean stale artifacts from a previous version (BAIXA (a))
// ---------------------------------------------------------------------------

function phaseCleanStaleArtifacts() {
  log("Phase 0/8 — cleaning stale dist-release/ artifacts from a previous version");
  if (!existsSync(distReleaseDir)) return;

  let entries;
  try {
    entries = readdirSync(distReleaseDir, { withFileTypes: true });
  } catch (err) {
    log(`Could not read ${distReleaseDir} to clean it — continuing (${String(err)})`);
    return;
  }

  for (const entry of entries) {
    // Remove every previously-built artifact (fusion-server-*, including
    // .exe/.AppImage/.dmg variants) and manifest (latest-*.json) — but
    // NEVER the .work/ scratch dir mid-cleanup of a concurrent run, and
    // nothing outside dist-release/ is ever touched.
    const isArtifact = entry.name.startsWith("fusion-server-");
    const isManifest = /^latest-.*\.json$/.test(entry.name);
    if (!isArtifact && !isManifest) continue;

    const fullPath = join(distReleaseDir, entry.name);
    rmSync(fullPath, { recursive: true, force: true });
    log(`Removed stale ${fullPath}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 1 — version drift
// ---------------------------------------------------------------------------

function phaseVersionDrift() {
  log("Phase 1/8 — checking FUSION_VERSION vs package.json drift");
  run(process.execPath, [join(__dirname, "check-version-drift.mjs")]);
}

function readFusionVersion() {
  const versionTs = readFileSync(join(repoRoot, "packages", "shared", "src", "version.ts"), "utf8");
  const match = /export const FUSION_VERSION = "([^"]+)";/.exec(versionTs);
  if (match === null) throw new Error("Could not read FUSION_VERSION from version.ts");
  return match[1];
}

// ---------------------------------------------------------------------------
// Phase 2 — workspace build
// ---------------------------------------------------------------------------

function phaseWorkspaceBuild() {
  log(
    "Phase 2/8 — pnpm -r build (topological: shared -> system-api/engine/systems -> server -> client)",
  );
  run("pnpm", ["-r", "build"]);
}

// ---------------------------------------------------------------------------
// Phase 3 — rebuild native addons against the CURRENT Node (DA-07 pin)
// ---------------------------------------------------------------------------

function phaseRebuildNativeAddons() {
  log("Phase 3/8 — pnpm rebuild better-sqlite3 @node-rs/argon2 (DA-07 ABI pin)");
  run("pnpm", ["rebuild", "better-sqlite3", "@node-rs/argon2"]);
}

// ---------------------------------------------------------------------------
// Phase 4 — esbuild bundle of the SEA entry point
// ---------------------------------------------------------------------------

function phaseBundle() {
  log("Phase 4/8 — esbuild bundle of runtime/sea-entry.ts (CJS, natives external)");
  mkdirSync(workDir, { recursive: true });
  const bundlePath = join(workDir, "fusion-server-sea-bundle.cjs");
  const entryPath = join(repoRoot, "packages", "server", "src", "runtime", "sea-entry.ts");

  // Invoke esbuild's own JS bin script directly via `node <script>` rather
  // than the node_modules/.bin/esbuild(.cmd) shim: on Windows the shim is a
  // .cmd batch file, which Node can only spawn through a shell — and the
  // shell then re-tokenizes this command's `--banner:js=...;` argument on
  // the embedded semicolon, corrupting it (observed directly while building
  // this pipeline). `node <esbuild's real .js file>` is a plain executable
  // invocation with no shell involved, identical on all three platforms.
  const esbuildBin = join(repoRoot, "node_modules", "esbuild", "bin", "esbuild");

  run(process.execPath, [
    esbuildBin,
    "--bundle",
    "--platform=node",
    "--target=node22",
    "--format=cjs",
    "--external:better-sqlite3",
    "--external:@node-rs/argon2",
    // esbuild's CJS output always empties import.meta.url (it warns loudly
    // about this) — several modules resolve their OWN file location via it
    // (native-loader.ts's createRequire(import.meta.url), and, transitively
    // through the CLI import chain, compendium/service.ts + spa/routes.ts's
    // findMonorepoRoot walk, which harmlessly returns null under SEA since
    // FUSION_SEA_CLIENT_DIST/the native hook take over in that mode — see
    // sea-entry.ts and spa/routes.ts's resolveClientDistDir doc comment).
    // The define+banner pair below is esbuild's own documented workaround:
    // synthesize a real file:// URL for the bundle's own on-disk location
    // at runtime via `require('url').pathToFileURL(__filename)`.
    "--define:import.meta.url=import_meta_url",
    "--banner:js=const import_meta_url = require('url').pathToFileURL(__filename).href;",
    `--outfile=${bundlePath}`,
    entryPath,
  ]);

  return bundlePath;
}

// ---------------------------------------------------------------------------
// Asset key constants — imported from the COMPILED server package (not
// re-declared as string literals here) so this script and
// native-loader.ts/sea-assets.ts can never drift silently (BAIXA (b) from
// the B3 audit: the make-sea-config.mjs doc comment previously CLAIMED this
// but the keys were actually hardcoded string literals below it — fixed by
// making the claim true). Phase 2 (`pnpm -r build`) always runs before phase
// 5 in main(), so packages/server/dist/runtime/{native-loader,sea-assets}.js
// are guaranteed to exist by the time this import resolves.
// ---------------------------------------------------------------------------

async function loadAssetKeyConstants() {
  const nativeLoaderPath = join(
    repoRoot,
    "packages",
    "server",
    "dist",
    "runtime",
    "native-loader.js",
  );
  const seaAssetsPath = join(repoRoot, "packages", "server", "dist", "runtime", "sea-assets.js");
  if (!existsSync(nativeLoaderPath) || !existsSync(seaAssetsPath)) {
    throw new Error(
      `Compiled runtime modules not found at ${nativeLoaderPath} / ${seaAssetsPath} — ` +
        `phase 2 (pnpm -r build) must run before phase 5 packs SEA assets.`,
    );
  }
  const { NATIVE_PACKAGES } = await import(pathToFileURL(nativeLoaderPath).href);
  const { CLIENT_DIST_ASSET_KEY, SYSTEM_PACKS_ASSET_KEY } = await import(
    pathToFileURL(seaAssetsPath).href
  );
  return { NATIVE_PACKAGES, CLIENT_DIST_ASSET_KEY, SYSTEM_PACKS_ASSET_KEY };
}

// ---------------------------------------------------------------------------
// Phase 5 — pack native addons + client dist
// ---------------------------------------------------------------------------

async function phasePackAssets(assetKeys) {
  log("Phase 5/8 — packing native addons + client dist + system packs into SEA assets");
  mkdirSync(workDir, { recursive: true });

  // Per-package archive path + --nest flags, keyed by the specifier — the
  // assetKey each maps to comes from assetKeys.NATIVE_PACKAGES (the REAL
  // NATIVE_PACKAGES constant native-loader.ts exports), not a re-declared
  // string literal (BAIXA (b)).
  const nestFlagsBySpecifier = {
    "better-sqlite3": ["bindings", "bindings>file-uri-to-path"],
    "@node-rs/argon2": [platformArgon2Package()],
  };

  const nativeAssetPaths = {}; // assetKey -> archive path
  for (const pkg of assetKeys.NATIVE_PACKAGES) {
    const archivePath = join(workDir, `${pkg.assetKey}.bin`);
    const nestFlags = nestFlagsBySpecifier[pkg.specifier];
    if (nestFlags === undefined) {
      throw new Error(
        `No --nest flags configured in build-release.mjs for native package "${pkg.specifier}" ` +
          `(declared in native-loader.ts's NATIVE_PACKAGES but unknown here — add an entry to ` +
          `nestFlagsBySpecifier).`,
      );
    }
    const nestArgs = nestFlags.flatMap((n) => ["--nest", n]);
    run(process.execPath, [
      join(__dirname, "pack-native.mjs"),
      pkg.specifier,
      archivePath,
      ...nestArgs,
    ]);
    nativeAssetPaths[pkg.assetKey] = archivePath;
  }

  const clientDistArchive = join(workDir, `${assetKeys.CLIENT_DIST_ASSET_KEY}.bin`);
  const systemPacksArchive = join(workDir, `${assetKeys.SYSTEM_PACKS_ASSET_KEY}.bin`);

  const clientDistDir = join(repoRoot, "packages", "client", "dist");
  if (!existsSync(clientDistDir)) {
    throw new Error(
      `packages/client/dist not found — run "pnpm --filter @fusion/client build" (or the ` +
        `workspace build in phase 2) before packing SEA assets.`,
    );
  }
  // pack-native.mjs's --dir mode reuses the EXACT SAME packDirectory/archive
  // format as the two native-addon packs above — guaranteeing this pipeline
  // can never write a client-dist archive in a format native-loader.ts's
  // extraction code (sea-assets.ts) does not understand.
  // `--exclude avatar` keeps the avatar acervo OUT of the SEA blob. It is 22 MB
  // (spec 33): embedding it would push this artifact from ~134 MB to ~193 MB and
  // blow the REQ-DST-046 150 MB budget. It ships as a sidecar directory next to
  // the executable instead, emitted in phase 8 below and found at runtime by
  // packages/server/src/avatar/routes.ts.
  run(process.execPath, [
    join(__dirname, "pack-native.mjs"),
    "--dir",
    clientDistDir,
    clientDistArchive,
    "--exclude",
    "avatar",
  ]);

  // B3-FIXES MÉDIA B: pack every game system's committed packs/ directory
  // into ONE archive, each nested under "<systemId>/packs/..." — the exact
  // layout resolveSystemPacksDir (compendium/service.ts) expects a
  // "packsRoot" to have. Only systems that actually ship packs are included
  // (engine-2e/stub have none); missing/empty is fine, `--multi-dir` just
  // gets fewer --entry flags.
  const systemsRootDir = join(repoRoot, "systems");
  const systemPackEntries = existsSync(systemsRootDir)
    ? readdirSync(systemsRootDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({ systemId: d.name, packsDir: join(systemsRootDir, d.name, "packs") }))
        .filter(({ packsDir }) => existsSync(packsDir))
    : [];

  if (systemPackEntries.length === 0) {
    log("No systems/<id>/packs directories found — system-packs asset will be empty");
  }

  const multiDirArgs = [join(__dirname, "pack-native.mjs"), "--multi-dir", systemPacksArchive];
  for (const { systemId, packsDir } of systemPackEntries) {
    multiDirArgs.push("--entry", `${systemId}/packs=${packsDir}`);
  }
  if (systemPackEntries.length > 0) {
    run(process.execPath, multiDirArgs);
  } else {
    // --multi-dir requires at least one --entry; write an empty archive
    // directly rather than special-casing the packer script for a scenario
    // that should never happen in this repo (pf2e/sf2e/etmos always ship
    // packs) but must not crash the whole pipeline if it ever did.
    mkdirSync(dirname(systemPacksArchive), { recursive: true });
    const emptyIndex = Buffer.from(JSON.stringify({ entries: [] }), "utf8");
    const lenBuf = Buffer.alloc(8);
    lenBuf.writeBigUInt64LE(BigInt(emptyIndex.length), 0);
    writeFileSync(systemPacksArchive, Buffer.concat([lenBuf, emptyIndex]));
  }

  return {
    // assetKey -> archive path, spread directly into make-sea-config.mjs's
    // --asset flags in phaseAssembleSea — every key here is one of
    // NATIVE_PACKAGES[].assetKey / CLIENT_DIST_ASSET_KEY /
    // SYSTEM_PACKS_ASSET_KEY, never a hand-typed literal.
    ...nativeAssetPaths,
    [assetKeys.CLIENT_DIST_ASSET_KEY]: clientDistArchive,
    [assetKeys.SYSTEM_PACKS_ASSET_KEY]: systemPacksArchive,
  };
}

/** @node-rs/argon2's platform-specific optionalDependency package name for the CURRENT (build) platform/arch. */
function platformArgon2Package() {
  const platformArgonPackageMap = {
    win32: { x64: "@node-rs/argon2-win32-x64-msvc", arm64: "@node-rs/argon2-win32-arm64-msvc" },
    darwin: { x64: "@node-rs/argon2-darwin-x64", arm64: "@node-rs/argon2-darwin-arm64" },
    linux: { x64: "@node-rs/argon2-linux-x64-gnu", arm64: "@node-rs/argon2-linux-arm64-gnu" },
  };
  const pkg = platformArgonPackageMap[process.platform]?.[process.arch];
  if (pkg === undefined) {
    throw new Error(
      `No known @node-rs/argon2 platform package for ${process.platform}/${process.arch}. ` +
        `Add it to platformArgonPackageMap in build-release.mjs.`,
    );
  }
  return pkg;
}

// ---------------------------------------------------------------------------
// Phase 6 — assemble the SEA executable
// ---------------------------------------------------------------------------

function phaseAssembleSea(bundlePath, assets, version) {
  log("Phase 6/8 — assembling the SEA executable");
  const { platformLabel, archLabel, isWindows } = platformArchLabel();

  const seaConfigPath = join(workDir, "sea-config.json");
  const seaBlobPath = join(workDir, "fusion-server.blob");

  // `assets` is keyed by the REAL assetKey constants (see
  // loadAssetKeyConstants/phasePackAssets) — iterating it generically here
  // (rather than hardcoding each `--asset <literal>=<path>` flag) is what
  // actually makes good on make-sea-config.mjs's doc-comment claim that
  // these keys cannot drift from native-loader.ts/sea-assets.ts (BAIXA (b)).
  const assetArgs = Object.entries(assets).flatMap(([key, path]) => ["--asset", `${key}=${path}`]);

  run(process.execPath, [
    join(__dirname, "make-sea-config.mjs"),
    bundlePath,
    seaConfigPath,
    seaBlobPath,
    ...assetArgs,
  ]);

  run(process.execPath, ["--experimental-sea-config", seaConfigPath]);
  if (!existsSync(seaBlobPath)) {
    throw new Error(`SEA blob was not produced at ${seaBlobPath}`);
  }

  // DA-07: the Node copied here as the exe host MUST be the exact same
  // version that phase 3 used to `pnpm rebuild` the native addons — a
  // mismatched ABI fails to load .node files silently at runtime, only
  // caught (if at all) by the smoke test. Fail loudly here instead.
  const hostNodeVersion = runCapture(process.execPath, ["--version"]);
  if (hostNodeVersion !== process.version) {
    throw new Error(
      `DA-07 ABI pin violation: the Node running this build script ` +
        `(${process.version}) differs from "node --version" (${hostNodeVersion}). ` +
        `These must be identical — re-run under a single consistent Node 22 install.`,
    );
  }

  const artifactName = `fusion-server-${version}-${platformLabel}-${archLabel}${isWindows ? ".exe" : ""}`;
  const artifactPath = join(distReleaseDir, artifactName);
  mkdirSync(distReleaseDir, { recursive: true });

  copyFileSync(process.execPath, artifactPath);
  if (!isWindows) {
    chmodSync(artifactPath, 0o755);
  }

  // Windows code-signing note (DA-02): postject warns "signature seems
  // corrupted" on Windows because copying+patching node.exe invalidates its
  // Authenticode signature — expected and harmless for the MVP headless
  // (unsigned) distribution; SmartScreen will show "unknown publisher" per
  // DA-02's documented trade-off, not a build failure.
  const postjectBin = join(repoRoot, "node_modules", "postject", "dist", "cli.js");
  run(process.execPath, [
    postjectBin,
    artifactPath,
    "NODE_SEA_BLOB",
    seaBlobPath,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ...(isWindows ? [] : ["--macho-segment-name", "NODE_SEA"]),
  ]);

  return artifactPath;
}

// ---------------------------------------------------------------------------
// Avatar acervo — sidecar, not embedded (spec 33, REQ-AVT-041)
// ---------------------------------------------------------------------------

/**
 * Copy the avatar acervo next to the artifact, as `dist-release/avatar/`.
 *
 * It is NOT in the SEA blob on purpose: 22 MB of atlases against a 150 MB
 * artifact budget that a 134 MB executable has already mostly spent
 * (REQ-DST-046). The server finds it here at runtime — see
 * packages/server/src/avatar/routes.ts for the full resolution order.
 *
 * Missing acervo is a warning, never a build failure: the avatar is cosmetic and
 * a release without it still runs (the client degrades to "no avatar").
 */
function emitAvatarSidecar() {
  const acervoDir = join(repoRoot, "packages", "client", "dist", "avatar");
  if (!existsSync(acervoDir)) {
    log(
      "Avatar acervo not found in packages/client/dist/avatar — the release will ship WITHOUT it " +
        "(avatars unavailable). Run `pnpm install` so waybuilder-avatar is present, then rebuild the client.",
    );
    return null;
  }
  const destino = join(distReleaseDir, "avatar");
  rmSync(destino, { recursive: true, force: true });
  cpSync(acervoDir, destino, { recursive: true });
  log(`Avatar acervo copied alongside the artifact: ${destino}`);
  return destino;
}

// ---------------------------------------------------------------------------
// Phase 7 — size + hash
// ---------------------------------------------------------------------------

function phaseSizeAndHash(artifactPath) {
  log("Phase 7/8 — computing SHA-256 + verifying size budget (REQ-DST-046)");
  const size = statSync(artifactPath).size;
  const sizeMb = (size / 1024 / 1024).toFixed(1);

  if (size > MAX_ARTIFACT_BYTES) {
    throw new Error(
      `Artifact ${artifactPath} is ${sizeMb} MB, exceeding the REQ-DST-046 150 MB budget. ` +
        `See design doc DA-04 — consider compressing client assets or the 1b zip-portable fallback.`,
    );
  }

  const sha256 = sha256File(artifactPath);
  log(`Artifact size: ${sizeMb} MB, SHA-256: ${sha256}`);
  return { size, sha256 };
}

// ---------------------------------------------------------------------------
// Phase 8 — manifest
// ---------------------------------------------------------------------------

function phaseManifest(version, artifactPath, sizeAndHash, channel) {
  log("Phase 8/8 — writing UpdateManifest (latest-<channel>.json)");
  const { platformLabel, archLabel } = platformArchLabel();
  const platformKey = `${platformLabel}-${archLabel}`;
  const artifactName = artifactPath.split(/[\\/]/).pop();
  const manifestPath = join(distReleaseDir, `latest-${channel}.json`);

  // manifest.mjs owns the actual shape/merge logic (REQ-DST-027) and has
  // its own dedicated unit test (manifest.test.ts) — this phase is just
  // wiring the pipeline's own values into it.
  const { manifestPath: writtenPath } = writeManifest({
    manifestPath,
    version,
    channel,
    platformKey,
    artifactName,
    sha256: sizeAndHash.sha256,
    size: sizeAndHash.size,
  });

  log(`Wrote ${writtenPath}`);
  return writtenPath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const channelIdx = args.indexOf("--channel");
  const channel = channelIdx !== -1 ? args[channelIdx + 1] : "stable";
  const skipWorkspaceBuild = args.includes("--skip-workspace-build");
  const skipRebuild = args.includes("--skip-rebuild");

  const startedAt = Date.now();

  phaseCleanStaleArtifacts();
  phaseVersionDrift();
  const version = readFusionVersion();
  log(`Building release for FUSION_VERSION=${version}, channel=${channel}`);

  if (!skipWorkspaceBuild) {
    phaseWorkspaceBuild();
  } else {
    log("Phase 2/8 — SKIPPED (--skip-workspace-build)");
  }

  if (!skipRebuild) {
    phaseRebuildNativeAddons();
  } else {
    log("Phase 3/8 — SKIPPED (--skip-rebuild)");
  }

  const bundlePath = phaseBundle();
  const assetKeys = await loadAssetKeyConstants();
  const assets = await phasePackAssets(assetKeys);
  const artifactPath = phaseAssembleSea(bundlePath, assets, version);
  emitAvatarSidecar();
  const sizeAndHash = phaseSizeAndHash(artifactPath);
  const manifestPath = phaseManifest(version, artifactPath, sizeAndHash, channel);

  // Clean up the scratch working directory — the archives/bundle/blob are
  // intermediate build products, not release deliverables.
  rmSync(workDir, { recursive: true, force: true });

  const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
  log(
    `Done in ${elapsedS}s. Artifact: ${artifactPath} ` +
      `(${(sizeAndHash.size / 1024 / 1024).toFixed(1)} MB, sha256=${sizeAndHash.sha256}). ` +
      `Manifest: ${manifestPath}`,
  );
}

main().catch((err) => {
  process.stderr.write(`[build:release] FAILED: ${err.stack ?? String(err)}\n`);
  process.exit(1);
});
