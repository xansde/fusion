/**
 * SEA (Single Executable Application) main entry point (M6/B3 — REQ-DST-001/002).
 *
 * This is NOT the normal `dist/index.js` entry — it is a SEPARATE, dedicated
 * entry point that `tools/release/build-release.mjs` bundles (via esbuild)
 * into the single CJS file that `node --experimental-sea-config` turns into
 * a blob and injects into the copied `node.exe`.
 *
 * ORDER IS LOAD-BEARING. Node evaluates a CJS module top-to-bottom, so the
 * native-addon resolution hook (native-loader.ts) MUST be installed and its
 * packages MUST already be extracted to disk BEFORE this file's own `import`
 * of the rest of the server (`../cli/index.js`) executes — because THAT
 * import transitively reaches `db/connection.ts`'s
 * `import Database from "better-sqlite3"` and `auth/crypto.ts`'s
 * `import { hash } from "@node-rs/argon2"`, both of which resolve at
 * MODULE-EVALUATION time, not lazily. Static `import` statements in ESM (and
 * esbuild's CJS output for them) are hoisted, so this file structures the
 * dependency purely through dynamic `await import(...)` after the hook is
 * installed, to guarantee the ordering the static form cannot express.
 *
 * DATA DIR RESOLUTION NOTE: extracting native addons requires knowing
 * `dataDir` — but `dataDir` itself is normally resolved by
 * `config.ts`/`resolveEffectiveDataDir`, which is part of the very code this
 * file has not imported yet. To break that circularity, this entry point
 * re-derives JUST the dataDir (not the full config) using the same
 * CLI-flag/env/default precedence config.ts uses, via a tiny inline helper —
 * duplicating ~5 lines rather than restructuring config.ts's module graph
 * for one caller. `cli/commands/serve.ts` (imported afterwards) re-resolves
 * the FULL config normally; both calls agree because they use the identical
 * precedence rule and, critically, the identical result for `dataDir`
 * specifically (config.ts's own resolution is idempotent and side-effect
 * free on the filesystem until `ensureDataDirLayout` runs).
 */

import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

function resolveDataDirForBootstrap(): string {
  const argv = process.argv.slice(2);
  const flagIdx = argv.indexOf("--data-dir");
  if (flagIdx !== -1 && argv[flagIdx + 1] !== undefined) {
    return argv[flagIdx + 1] as string;
  }
  if (process.env["FUSION_DATA_DIR"] !== undefined && process.env["FUSION_DATA_DIR"] !== "") {
    return process.env["FUSION_DATA_DIR"];
  }

  const os = platform();
  let perOsDefault: string;
  if (os === "win32") {
    const base = process.env["USERPROFILE"] ?? homedir();
    perOsDefault = join(base, "Documents", "FusionVTT");
  } else if (os === "darwin") {
    perOsDefault = join(homedir(), "Documents", "FusionVTT");
  } else {
    const xdg = process.env["XDG_DATA_HOME"];
    perOsDefault =
      xdg !== undefined && xdg.length > 0 ? join(xdg, "FusionVTT") : join(homedir(), "FusionVTT");
  }
  if (existsSync(perOsDefault)) return perOsDefault;

  const legacy = join(homedir(), ".fusion");
  if (existsSync(legacy)) return legacy;

  return perOsDefault;
}

async function main(): Promise<void> {
  const sea = await import("node:sea");
  if (!sea.isSea()) {
    // Defensive — this entry point should only ever run inside a SEA blob.
    // Falling through to the normal CLI keeps `node dist-release-tmp/sea-entry.js`
    // runnable directly for local debugging of this file without a real SEA build.
    await import("../cli/index.js");
    return;
  }

  const { FUSION_VERSION } = await import("@fusion/shared");
  const dataDir = resolveDataDirForBootstrap();

  const { ensureNativeAddonsExtracted, installNativeAddonResolutionHook } =
    await import("./native-loader.js");
  const { ensureClientDistExtracted, clientDistRuntimeDir } = await import("./sea-assets.js");

  // 1. Extract both native addon packages (better-sqlite3, @node-rs/argon2)
  //    to <dataDir>/runtime/<version>/node_modules/... — verified by hash,
  //    idempotent across restarts.
  await ensureNativeAddonsExtracted({ dataDir, version: FUSION_VERSION });

  // 2. Install the resolution hook so the imports below (transitively, via
  //    cli/index.js -> ... -> db/connection.ts / auth/crypto.ts) find the
  //    extracted copies instead of trying — and failing — to resolve inside
  //    the SEA blob's nonexistent node_modules.
  installNativeAddonResolutionHook(dataDir, FUSION_VERSION);

  // 3. Extract the embedded client dist so spa/routes.ts has a real
  //    directory to serve from (REQ-DST-002) — SEA assets are not
  //    individually addressable as a filesystem tree, only as named blobs,
  //    so this is unpacked once up front rather than served asset-by-asset
  //    from memory (keeping spa/routes.ts's existing disk-based logic
  //    unchanged for both SEA and non-SEA boots).
  await ensureClientDistExtracted({ dataDir, version: FUSION_VERSION });
  process.env["FUSION_SEA_CLIENT_DIST"] = clientDistRuntimeDir(dataDir, FUSION_VERSION);

  // 4. NOW it is safe to load the rest of the server. cli/index.js parses
  //    argv itself (this process's real argv — unaffected by anything
  //    above) and dispatches to `serve` exactly as the non-SEA binary does.
  await import("../cli/index.js");
}

main().catch((err: unknown) => {
  process.stderr.write(`fusion (sea): fatal error during startup: ${String(err)}\n`);
  process.exit(1);
});
