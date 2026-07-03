#!/usr/bin/env node
/**
 * Generate the Node SEA config JSON (`node --experimental-sea-config`) for
 * the Fusion server (M6/B3 — REQ-DST-001/002/003/004, design doc §1.3).
 *
 * Node's SEA tooling only accepts a CJS main script (verified manually
 * during this batch's implementation: an ESM `.mjs` main throws
 * "Cannot use import statement outside a module" at injected-binary
 * runtime, even though blob GENERATION does not reject it — the failure
 * only surfaces when you actually run the exe). `tools/release/build-release.mjs`
 * bundles `packages/server/src/runtime/sea-entry.ts` to CJS via esbuild
 * BEFORE this script runs; this script's only job is to emit the JSON Node's
 * `--experimental-sea-config` flag reads, pointing `main` at that bundle and
 * `assets` at the packed native-addon + client-dist archives.
 *
 * Usage:
 *   node make-sea-config.mjs <bundlePath> <outConfigPath> <outBlobPath> \
 *     --asset native-better-sqlite3=<path> \
 *     --asset native-node-rs-argon2=<path> \
 *     --asset client-dist=<path> \
 *     --asset system-packs=<path>
 *
 * Asset keys here MUST match native-loader.ts's `NATIVE_PACKAGES[].assetKey`
 * and sea-assets.ts's `CLIENT_DIST_ASSET_KEY` / `SYSTEM_PACKS_ASSET_KEY`
 * exactly — this script itself does not hardcode them (it treats `--asset`
 * as an opaque `key=path` pair). The caller is the one obligated to keep
 * them in sync: `build-release.mjs`'s `loadAssetKeyConstants()` dynamically
 * `import()`s the COMPILED `packages/server/dist/runtime/{native-loader,
 * sea-assets}.js` (built by phase 2, before phase 5 packs assets) and reads
 * the real exported constants — never re-declares the string literals — so
 * the `--asset` flags this script receives are always generated FROM the
 * single source of truth those two modules own, not typed out by hand here
 * or in build-release.mjs.
 */

import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";

function parseArgs(argv) {
  const [bundlePath, outConfigPath, outBlobPath, ...rest] = argv;
  const assets = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--asset" && rest[i + 1] !== undefined) {
      const [key, ...valueParts] = rest[i + 1].split("=");
      const value = valueParts.join("=");
      if (key === undefined || key.length === 0 || value.length === 0) {
        throw new Error(`Invalid --asset entry: "${rest[i + 1]}". Expected "key=path".`);
      }
      assets[key] = value;
      i++;
    }
  }
  return { bundlePath, outConfigPath, outBlobPath, assets };
}

function main() {
  const { bundlePath, outConfigPath, outBlobPath, assets } = parseArgs(process.argv.slice(2));

  if (bundlePath === undefined || outConfigPath === undefined || outBlobPath === undefined) {
    process.stderr.write(
      "Usage: node make-sea-config.mjs <bundlePath> <outConfigPath> <outBlobPath> [--asset key=path]...\n",
    );
    process.exit(1);
  }

  if (!existsSync(bundlePath) || !statSync(bundlePath).isFile()) {
    throw new Error(`Bundle not found: ${bundlePath}`);
  }
  for (const [key, assetPath] of Object.entries(assets)) {
    if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
      throw new Error(`Asset "${key}" not found at: ${assetPath}`);
    }
  }

  const config = {
    main: bundlePath,
    output: outBlobPath,
    disableExperimentalSEAWarning: true,
    // useSnapshot/useCodeCache default to false — the server opens sockets,
    // spawns child processes (cloudflared) and does other things the V8
    // startup-snapshot builder does not support; leaving both off is the
    // documented-safe default for a server-shaped SEA.
    assets,
  };

  mkdirSync(dirname(outConfigPath), { recursive: true });
  writeFileSync(outConfigPath, JSON.stringify(config, null, 2));

  process.stdout.write(
    `[make-sea-config] wrote ${outConfigPath} (main=${bundlePath}, ${String(Object.keys(assets).length)} assets)\n`,
  );
}

main();
