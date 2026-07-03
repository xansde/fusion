#!/usr/bin/env node
/**
 * Pack a native addon package's real on-disk directory (as installed by
 * `pnpm rebuild`, so the `.node` file's ABI matches the pinned Node version —
 * DA-07) into the archive format `packages/server/src/runtime/native-loader.ts`
 * (`packDirectory`/unpack) and `sea-assets.ts` read.
 *
 * This is a standalone .mjs (not TypeScript) deliberately: it runs BEFORE
 * `pnpm -r build` has necessarily produced `packages/server/dist/`, and it
 * has zero dependency on the rest of the server's compiled output — it only
 * needs `node_modules` to exist, which `pnpm install` already guarantees.
 * The archive FORMAT itself (index header + concatenated file bytes) is
 * duplicated here in plain JS rather than imported from the TS source, to
 * keep this script runnable with a bare `node pack-native.mjs` and no
 * build step of its own; native-loader.ts's own copy is the source of
 * truth for the runtime (unpack) side, and both are covered by
 * native-loader.test.ts's pack/unpack round-trip test.
 *
 * PNPM-STORE DEREFERENCING (the reason this script is not a one-liner):
 * pnpm gives every package its OWN isolated `node_modules/` containing only
 * SYMLINKS to its declared dependencies inside the central `.pnpm` store.
 * `@node-rs/argon2`'s glue code does `require('@node-rs/argon2-<platform>')`
 * for the platform-specific `.node` file (see native-loader.ts's doc
 * comment) — under pnpm this resolves through
 * `node_modules/@node-rs/argon2/node_modules/@node-rs/argon2-<platform>`
 * (a symlink into `.pnpm/@node-rs+argon2-<platform>@.../`). The GM's machine
 * will have NEITHER a pnpm store NOR any node_modules at all next to the
 * exe — only what this script embeds. So packing must (a) follow symlinks
 * (`realpathSync`) to copy real bytes, not dangling links, and (b) preserve
 * the nested `node_modules/@node-rs/<platform-package>/` layout inside the
 * archive so Node's plain (non-pnpm) module resolution — which IS what runs
 * after extraction, since the extracted tree is a normal flat directory —
 * finds the platform package exactly where classic resolution expects it:
 * walking up from `@node-rs/argon2`'s own directory.
 *
 * Usage:
 *   node tools/release/pack-native.mjs better-sqlite3 <outFile> \
 *     --nest bindings --nest bindings>file-uri-to-path
 *   node tools/release/pack-native.mjs @node-rs/argon2 <outFile> \
 *     --nest @node-rs/argon2-win32-x64-msvc
 *   node tools/release/pack-native.mjs --dir <absoluteDirPath> <outFile>
 *     (packs an arbitrary directory verbatim, fixed positional order — no
 *     package resolution, no --nest support. Used by build-release.mjs to
 *     pack packages/client/dist using this exact same archive format/CLI,
 *     instead of a separate ad-hoc script.)
 *   node tools/release/pack-native.mjs --multi-dir <outFile> \
 *     --entry <archiveSubdir>=<absoluteDirPath> [--entry <archiveSubdir>=<absoluteDirPath>]...
 *     (packs MULTIPLE source directories into ONE archive, each nested under
 *     its own `archiveSubdir` prefix — used by build-release.mjs to pack
 *     every game system's `systems/<systemId>/packs/` directory into a
 *     single `system-packs` SEA asset, nested as `<systemId>/packs/...` so
 *     the extracted tree matches resolveSystemPacksDir's expected
 *     `<packsRoot>/<systemId>/packs` layout exactly — see M6/B3-FIXES MÉDIA B.)
 *
 * `--nest <specifier>` (repeatable) embeds a transitive runtime dependency
 * at `node_modules/<specifier>/` relative to the MAIN package's own
 * directory — e.g. `better-sqlite3` needs its `bindings` npm dependency
 * (used by `require('bindings')(...)` in lib/database.js), and
 * `@node-rs/argon2` needs its platform-specific optionalDependency package
 * (`@node-rs/argon2-win32-x64-msvc` et al). `--nest parent>child` embeds a
 * dependency of an ALREADY-NESTED package one level deeper — e.g.
 * `bindings` itself needs `file-uri-to-path`, so
 * `--nest bindings>file-uri-to-path` resolves `file-uri-to-path` from
 * INSIDE the already-resolved `bindings` directory and places it at
 * `node_modules/bindings/node_modules/file-uri-to-path/`. This mirrors
 * exactly how pnpm's isolated node_modules — and, after extraction, Node's
 * own classic (non-pnpm) resolution walking up from each package's own
 * `__dirname` — find these dependencies for real.
 *
 * Package directories are resolved via `require.resolve(...).../package.json`
 * from `packages/server` (the real consumer), not guessed by string-joining
 * paths — this way the script always packs whatever `pnpm rebuild` actually
 * produced for the CURRENT platform/arch/ABI, matching DA-07's pinning rule.
 */

import { createRequire } from "node:module";
import { readdirSync, statSync, lstatSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, "..", "..", "packages", "server");
const require = createRequire(join(serverDir, "package.json"));

/**
 * Resolve `specifier`'s real package directory. `fromDir`, when given, is a
 * directory to resolve FROM instead of packages/server — required for
 * platform packages like `@node-rs/argon2-win32-x64-msvc`, which pnpm only
 * exposes inside `@node-rs/argon2`'s OWN isolated node_modules (its
 * optionalDependencies are not hoisted to packages/server's node_modules at
 * all under pnpm's default isolation) — see the module doc comment.
 */
function resolvePackageDir(specifier, fromDir) {
  const req = fromDir === undefined ? require : createRequire(join(fromDir, "package.json"));
  const pkgJsonPath = req.resolve(`${specifier}/package.json`);
  return dirname(pkgJsonPath);
}

/**
 * Recursively copy `sourceDir` into the in-memory entry list, following
 * symlinks (pnpm store links) and rewriting their paths to be relative to
 * `archiveRootDir` (which may differ from `sourceDir` when embedding the
 * platform package as a nested node_modules — see `--platform-package`).
 */
function collectEntries(sourceDir, archiveRootDir, entries, chunks) {
  for (const name of readdirSync(sourceDir).sort()) {
    if (name === ".bin") continue; // never needed at runtime
    const full = join(sourceDir, name);
    const lst = lstatSync(full);
    const real = lst.isSymbolicLink() ? realpathSync(full) : full;
    const st = statSync(real);

    if (st.isDirectory()) {
      collectEntries(real, join(archiveRootDir, name), entries, chunks);
      continue;
    }
    if (!st.isFile()) continue;

    const archivePath = join(archiveRootDir, name).split(sep).join("/");
    const bytes = readFileSync(real);
    entries.push({ path: archivePath, size: bytes.length, mode: st.mode & 0o777 });
    chunks.push(bytes);
  }
}

function packToArchive(rootDirLabel, sourceDir, extraDirs) {
  const entries = [];
  const chunks = [];

  collectEntries(sourceDir, rootDirLabel, entries, chunks);
  for (const { archiveSubdir, dir } of extraDirs) {
    collectEntries(dir, archiveSubdir, entries, chunks);
  }

  const index = { entries };
  const indexJson = Buffer.from(JSON.stringify(index), "utf8");
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(indexJson.length), 0);

  return Buffer.concat([lenBuf, indexJson, ...chunks]);
}

function main() {
  const args = process.argv.slice(2);

  // --multi-dir mode: pack N source directories into ONE archive, each
  // nested under its own archive-relative subdir prefix. Fixed positional
  // order: `--multi-dir <outFile> --entry <subdir>=<dirPath> [--entry ...]`.
  if (args[0] === "--multi-dir") {
    const outFile = args[1];
    if (outFile === undefined) {
      process.stderr.write("Usage: node pack-native.mjs --multi-dir <outFile> --entry <subdir>=<dirPath>...\n");
      process.exit(1);
    }

    const entries = [];
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--entry" && args[i + 1] !== undefined) {
        const raw = args[i + 1];
        const eqIdx = raw.indexOf("=");
        if (eqIdx === -1) {
          throw new Error(`Invalid --entry "${raw}". Expected "<archiveSubdir>=<dirPath>".`);
        }
        const archiveSubdir = raw.slice(0, eqIdx);
        const dirPath = raw.slice(eqIdx + 1);
        entries.push({ archiveSubdir, dir: dirPath });
        i++;
      }
    }
    if (entries.length === 0) {
      throw new Error("--multi-dir requires at least one --entry <archiveSubdir>=<dirPath>.");
    }

    const allEntries = [];
    const allChunks = [];
    for (const { archiveSubdir, dir } of entries) {
      collectEntries(dir, archiveSubdir, allEntries, allChunks);
    }
    const index = { entries: allEntries };
    const indexJson = Buffer.from(JSON.stringify(index), "utf8");
    const lenBuf = Buffer.alloc(8);
    lenBuf.writeBigUInt64LE(BigInt(indexJson.length), 0);
    const archive = Buffer.concat([lenBuf, indexJson, ...allChunks]);

    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, archive);
    process.stdout.write(
      `[pack-native] packed ${String(entries.length)} dir(s) -> ${outFile} (${String(archive.length)} bytes)\n`,
    );
    return;
  }

  // --dir mode: pack an arbitrary directory verbatim, no package resolution.
  // Fixed positional order: `--dir <dirPath> <outFile>`.
  if (args[0] === "--dir") {
    const dirPath = args[1];
    const outFile = args[2];
    if (dirPath === undefined || outFile === undefined) {
      process.stderr.write("Usage: node pack-native.mjs --dir <path> <outFile>\n");
      process.exit(1);
    }
    const archive = packToArchive("", dirPath, []);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, archive);
    process.stdout.write(`[pack-native] packed dir ${dirPath} -> ${outFile} (${String(archive.length)} bytes)\n`);
    return;
  }

  const specifier = args[0];
  const outFile = args[1];

  const nestSpecifiers = [];
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--nest" && args[i + 1] !== undefined) {
      nestSpecifiers.push(args[i + 1]);
      i++;
    }
  }

  if (specifier === undefined || outFile === undefined) {
    process.stderr.write("Usage: node pack-native.mjs <specifier> <outFile> [--nest <pkg>]...\n");
    process.exit(1);
  }

  const packageDir = resolvePackageDir(specifier);
  // Archive-internal paths are relative to the PACKAGE ROOT itself (no
  // specifier prefix) — native-loader.ts's `ensureNativeAddonsExtracted`
  // unpacks straight into `<nativeRuntimeDir>/<specifier>/`, so the archive
  // must NOT re-include "<specifier>/" as a path prefix (that would produce
  // a nested `<specifier>/<specifier>/...` directory and break resolution).
  const rootLabel = "";

  // Resolve each --nest entry. "parent>child" chains resolve `child` from
  // INSIDE the already-resolved `parent` directory (one level of transitive
  // dependency) and place it at node_modules/parent/node_modules/child/; a
  // bare "child" resolves from the main package and lands at
  // node_modules/child/ directly.
  const resolvedNestDirs = new Map(); // specifier -> absolute dir (for chain lookups)
  const extraDirs = [];
  for (const raw of nestSpecifiers) {
    const chainIdx = raw.indexOf(">");
    if (chainIdx === -1) {
      const dir = resolvePackageDir(raw, packageDir);
      resolvedNestDirs.set(raw, dir);
      extraDirs.push({ archiveSubdir: join(rootLabel, "node_modules", raw), dir });
      continue;
    }
    const parentSpecifier = raw.slice(0, chainIdx);
    const childSpecifier = raw.slice(chainIdx + 1);
    const parentDir = resolvedNestDirs.get(parentSpecifier);
    if (parentDir === undefined) {
      throw new Error(
        `--nest ${raw}: parent "${parentSpecifier}" must be packed with an earlier ` +
          `--nest ${parentSpecifier} before it can be used as a chain parent.`,
      );
    }
    const childDir = resolvePackageDir(childSpecifier, parentDir);
    extraDirs.push({
      archiveSubdir: join(rootLabel, "node_modules", parentSpecifier, "node_modules", childSpecifier),
      dir: childDir,
    });
  }

  const archive = packToArchive(rootLabel, packageDir, extraDirs);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, archive);

  process.stdout.write(
    `[pack-native] packed ${specifier}${nestSpecifiers.length > 0 ? ` (+ ${nestSpecifiers.join(", ")})` : ""} -> ${outFile} (${String(archive.length)} bytes)\n`,
  );
}

main();
