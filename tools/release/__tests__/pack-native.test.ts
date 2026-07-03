/**
 * Tests for tools/release/pack-native.mjs against the REAL installed native
 * addon packages in this repo (better-sqlite3, @node-rs/argon2 +
 * platform-specific optionalDependency) — this is the exact scenario
 * `build-release.mjs` runs for real. Verifies that:
 *   1. Both packages pack without error.
 *   2. The resulting archive, unpacked into a flat (pnpm-store-free)
 *      node_modules tree, actually LOADS and FUNCTIONS when required by its
 *      bare specifier — proving the archive-format path convention (no
 *      specifier-name prefix — see native-loader.ts's doc comment) matches
 *      what native-loader.ts's real `ensureNativeAddonsExtracted` produces.
 *
 * This test is intentionally slower (packs the real ~12MB better-sqlite3
 * tree) — it is the one true end-to-end proof that the packer and the
 * runtime extractor agree on the archive format, which is exactly the kind
 * of contract a unit test on either side alone cannot catch (both sides
 * independently "worked" during development while producing a
 * double-nested directory bug — see this batch's implementation notes).
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "..", "pack-native.mjs");

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    // On Windows, a child process that just require()'d a .node file from
    // this tree can hold the DLL mapped for a brief moment after exiting;
    // retry a few times instead of failing the whole suite on a transient
    // EPERM/EBUSY unlink (native-loader.ts's own extraction code has the
    // same class of Windows-locking concern, hence the retry pattern here
    // rather than a `sleep`).
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        if (attempt === 4) throw new Error(`Could not clean up ${dir} after 5 attempts`);
      }
    }
  }
  cleanupDirs.length = 0;
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-pack-native-test-"));
  cleanupDirs.push(dir);
  return dir;
}

/**
 * Unpack + require() + exercise a packed native addon in a SEPARATE child
 * process (not in-process) — Windows keeps a .node file's DLL mapped for the
 * lifetime of the process that loaded it, so unpacking/loading in the test
 * runner's own process would make the temp dir undeletable in `afterEach`
 * until the whole vitest worker exits (the same reason this project's
 * server vitest config uses `pool: forks` for better-sqlite3 — see
 * vitest.config.ts's comment there). A short-lived child process loads the
 * addon, prints a result line, and exits — releasing the file lock
 * immediately, exactly like a real (transient) SEA process boot/extract
 * cycle would.
 */
function runInChildProcess(dir: string, unpackAndVerifyScript: string): string {
  const scriptFile = join(dir, "verify.mjs");
  writeFileSync(scriptFile, unpackAndVerifyScript);
  return execFileSync(process.execPath, [scriptFile], { encoding: "utf8" });
}

const UNPACK_HELPER = `
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export function unpackDirectory(archive, destDir) {
  const indexLen = Number(archive.readBigUInt64LE(0));
  const indexJson = archive.subarray(8, 8 + indexLen).toString("utf8");
  const index = JSON.parse(indexJson);
  let offset = 8 + indexLen;
  for (const entry of index.entries) {
    const bytes = archive.subarray(offset, offset + entry.size);
    offset += entry.size;
    const destPath = join(destDir, ...entry.path.split("/"));
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, bytes, { mode: entry.mode || 0o644 });
  }
}
`;

const platformArgonPackage =
  process.platform === "win32"
    ? "@node-rs/argon2-win32-x64-msvc"
    : process.platform === "darwin"
      ? process.arch === "arm64"
        ? "@node-rs/argon2-darwin-arm64"
        : "@node-rs/argon2-darwin-x64"
      : "@node-rs/argon2-linux-x64-gnu";

describe("pack-native.mjs (real packages, end-to-end with the runtime unpacker)", () => {
  it("packs better-sqlite3 + bindings + file-uri-to-path and it loads after flat extraction", () => {
    const dir = makeTempDir();
    const archivePath = join(dir, "better-sqlite3.bin");

    execFileSync(
      process.execPath,
      [
        scriptPath,
        "better-sqlite3",
        archivePath,
        "--nest",
        "bindings",
        "--nest",
        "bindings>file-uri-to-path",
      ],
      { encoding: "utf8" },
    );

    const output = runInChildProcess(
      dir,
      `${UNPACK_HELPER}
import { createRequire } from "node:module";

const extractedRoot = join(${JSON.stringify(dir)}, "extracted", "node_modules");
unpackDirectory(readFileSync(${JSON.stringify(archivePath)}), join(extractedRoot, "better-sqlite3"));

const req = createRequire(join(extractedRoot, "..", "noop.js"));
const Database = req("better-sqlite3");
const db = new Database(":memory:");
db.exec("CREATE TABLE t (id INTEGER)");
db.prepare("INSERT INTO t (id) VALUES (7)").run();
console.log(JSON.stringify(db.prepare("SELECT * FROM t").all()));
db.close();
`,
    );

    expect(JSON.parse(output.trim())).toEqual([{ id: 7 }]);
  }, 60_000);

  it("packs @node-rs/argon2 + its platform package and it loads after flat extraction", () => {
    const dir = makeTempDir();
    const archivePath = join(dir, "argon2.bin");

    execFileSync(
      process.execPath,
      [scriptPath, "@node-rs/argon2", archivePath, "--nest", platformArgonPackage],
      { encoding: "utf8" },
    );

    const output = runInChildProcess(
      dir,
      `${UNPACK_HELPER}
import { createRequire } from "node:module";

const extractedRoot = join(${JSON.stringify(dir)}, "extracted", "node_modules");
unpackDirectory(readFileSync(${JSON.stringify(archivePath)}), join(extractedRoot, "@node-rs", "argon2"));

const req = createRequire(join(extractedRoot, "..", "noop.js"));
const argon2 = req("@node-rs/argon2");
const hash = await argon2.hash("correct horse battery staple");
const okCorrect = await argon2.verify(hash, "correct horse battery staple");
const okWrong = await argon2.verify(hash, "wrong password");
console.log(JSON.stringify({ okCorrect, okWrong }));
`,
    );

    expect(JSON.parse(output.trim())).toEqual({ okCorrect: true, okWrong: false });
  }, 60_000);

  it("fails loudly for an unresolvable package specifier", () => {
    const dir = makeTempDir();
    expect(() =>
      execFileSync(
        process.execPath,
        [scriptPath, "this-package-does-not-exist-anywhere", join(dir, "out.bin")],
        { encoding: "utf8" },
      ),
    ).toThrow();
  });
});
