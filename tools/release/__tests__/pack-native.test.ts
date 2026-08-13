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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * `--dir --exclude` — how the avatar acervo stays OUT of the SEA blob.
 *
 * The exclusion is a size decision with a hard consequence: the packaged
 * executable sits at ~134 MB of a 150 MB budget (REQ-DST-046) and the acervo is
 * 22 MB, so if this flag silently stopped working `pnpm build:release` would
 * fail at phase 7 — after ~10 minutes of building. Cheap test, expensive bug.
 */
describe("pack-native.mjs --dir --exclude", () => {
  /** The archive's index: an 8-byte LE length, then that many bytes of JSON. */
  function lerIndice(arquivo: string): string[] {
    const bytes = readFileSync(arquivo);
    const tamanho = Number(bytes.readBigUInt64LE(0));
    const json = bytes.subarray(8, 8 + tamanho).toString("utf8");
    return (JSON.parse(json) as { entries: { path: string }[] }).entries.map((e) => e.path);
  }

  function montarArvore(): string {
    const raiz = makeTempDir();
    mkdirSync(join(raiz, "assets-client"), { recursive: true });
    mkdirSync(join(raiz, "avatar", "atlas", "body"), { recursive: true });
    writeFileSync(join(raiz, "index.html"), "<html></html>");
    writeFileSync(join(raiz, "assets-client", "app.js"), "console.log(1)");
    writeFileSync(join(raiz, "avatar", "catalogo.json"), "{}");
    writeFileSync(join(raiz, "avatar", "atlas", "body", "male.png"), "png");
    return raiz;
  }

  it("drops the excluded top-level directory and keeps everything else", () => {
    const origem = montarArvore();
    const saida = join(makeTempDir(), "client.bin");
    execFileSync(process.execPath, [scriptPath, "--dir", origem, saida, "--exclude", "avatar"]);

    const caminhos = lerIndice(saida);
    expect(caminhos.sort()).toEqual(["assets-client/app.js", "index.html"]);
    expect(caminhos.some((p) => p.includes("avatar"))).toBe(false);
  });

  it("packs the excluded directory when the flag is absent", () => {
    const origem = montarArvore();
    const saida = join(makeTempDir(), "client.bin");
    execFileSync(process.execPath, [scriptPath, "--dir", origem, saida]);

    const caminhos = lerIndice(saida);
    expect(caminhos).toContain("avatar/catalogo.json");
    expect(caminhos).toContain("avatar/atlas/body/male.png");
  });

  it("only excludes at the top level, never a nested directory of the same name", () => {
    const origem = montarArvore();
    mkdirSync(join(origem, "assets-client", "avatar"), { recursive: true });
    writeFileSync(join(origem, "assets-client", "avatar", "icone.png"), "png");
    const saida = join(makeTempDir(), "client.bin");
    execFileSync(process.execPath, [scriptPath, "--dir", origem, saida, "--exclude", "avatar"]);

    const caminhos = lerIndice(saida);
    expect(caminhos).toContain("assets-client/avatar/icone.png");
    expect(caminhos).not.toContain("avatar/catalogo.json");
  });
});
