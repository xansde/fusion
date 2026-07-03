#!/usr/bin/env node
/**
 * `pnpm build:release` — the M6/B3 release pipeline (design doc §5 B3,
 * REQ-DST-001/002/003/004/027/042/043/044/046).
 *
 * Phases (bail on the first failure, exit 1):
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
 *   5. Pack the two native addon packages (+ their transitive runtime deps)
 *      and packages/client/dist into the custom archive format
 *      (pack-native.mjs / native-loader.ts's packDirectory).
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
import { existsSync, mkdirSync, readFileSync, copyFileSync, statSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

  const platformLabel = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported build arch: "${arch}". Expected x64 or arm64.`);
  }
  return { platformLabel, archLabel: arch, isWindows: platform === "win32" };
}

// ---------------------------------------------------------------------------
// Phase 1 — version drift
// ---------------------------------------------------------------------------

function phaseVersionDrift() {
  log("Phase 1/8 — checking FUSION_VERSION vs package.json drift");
  run(process.execPath, [join(__dirname, "check-version-drift.mjs")]);
}

function readFusionVersion() {
  const versionTs = readFileSync(
    join(repoRoot, "packages", "shared", "src", "version.ts"),
    "utf8",
  );
  const match = /export const FUSION_VERSION = "([^"]+)";/.exec(versionTs);
  if (match === null) throw new Error("Could not read FUSION_VERSION from version.ts");
  return match[1];
}

// ---------------------------------------------------------------------------
// Phase 2 — workspace build
// ---------------------------------------------------------------------------

function phaseWorkspaceBuild() {
  log("Phase 2/8 — pnpm -r build (topological: shared -> system-api/engine/systems -> server -> client)");
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
// Phase 5 — pack native addons + client dist
// ---------------------------------------------------------------------------

function phasePackAssets() {
  log("Phase 5/8 — packing native addons + client dist into SEA assets");
  mkdirSync(workDir, { recursive: true });

  const betterSqlite3Archive = join(workDir, "native-better-sqlite3.bin");
  const argon2Archive = join(workDir, "native-node-rs-argon2.bin");
  const clientDistArchive = join(workDir, "client-dist.bin");

  const platformArgonPackageMap = {
    win32: { x64: "@node-rs/argon2-win32-x64-msvc", arm64: "@node-rs/argon2-win32-arm64-msvc" },
    darwin: { x64: "@node-rs/argon2-darwin-x64", arm64: "@node-rs/argon2-darwin-arm64" },
    linux: { x64: "@node-rs/argon2-linux-x64-gnu", arm64: "@node-rs/argon2-linux-arm64-gnu" },
  };
  const platformArgonPackage = platformArgonPackageMap[process.platform]?.[process.arch];
  if (platformArgonPackage === undefined) {
    throw new Error(
      `No known @node-rs/argon2 platform package for ${process.platform}/${process.arch}. ` +
        `Add it to platformArgonPackageMap in build-release.mjs.`,
    );
  }

  run(process.execPath, [
    join(__dirname, "pack-native.mjs"),
    "better-sqlite3",
    betterSqlite3Archive,
    "--nest",
    "bindings",
    "--nest",
    "bindings>file-uri-to-path",
  ]);

  run(process.execPath, [
    join(__dirname, "pack-native.mjs"),
    "@node-rs/argon2",
    argon2Archive,
    "--nest",
    platformArgonPackage,
  ]);

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
  run(process.execPath, [join(__dirname, "pack-native.mjs"), "--dir", clientDistDir, clientDistArchive]);

  return { betterSqlite3Archive, argon2Archive, clientDistArchive };
}

// ---------------------------------------------------------------------------
// Phase 6 — assemble the SEA executable
// ---------------------------------------------------------------------------

function phaseAssembleSea(bundlePath, assets, version) {
  log("Phase 6/8 — assembling the SEA executable");
  const { platformLabel, archLabel, isWindows } = platformArchLabel();

  const seaConfigPath = join(workDir, "sea-config.json");
  const seaBlobPath = join(workDir, "fusion-server.blob");

  run(process.execPath, [
    join(__dirname, "make-sea-config.mjs"),
    bundlePath,
    seaConfigPath,
    seaBlobPath,
    "--asset",
    `native-better-sqlite3=${assets.betterSqlite3Archive}`,
    "--asset",
    `native-node-rs-argon2=${assets.argon2Archive}`,
    "--asset",
    `client-dist=${assets.clientDistArchive}`,
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
  const assets = phasePackAssets();
  const artifactPath = phaseAssembleSea(bundlePath, assets, version);
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
