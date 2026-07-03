/**
 * Tests for tools/release/check-version-drift.mjs — spawns the script as a
 * real child process against a temp fake repo tree (root package.json +
 * packages/shared/src/version.ts), the same shape the real repo has, so the
 * test exercises the exact code path CI runs rather than an imported
 * function (the script is a standalone CLI with no exports).
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "..", "check-version-drift.mjs");

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeFakeRepo(fusionVersion: string, packageVersion: string): string {
  const root = mkdtempSync(join(tmpdir(), "fusion-drift-check-"));
  cleanupDirs.push(root);

  writeFileSync(join(root, "package.json"), JSON.stringify({ version: packageVersion }));
  mkdirSync(join(root, "packages", "shared", "src"), { recursive: true });
  writeFileSync(
    join(root, "packages", "shared", "src", "version.ts"),
    `export const FUSION_VERSION = "${fusionVersion}";\n`,
  );
  return root;
}

/**
 * The real script hardcodes its repo-root walk as `../../` from its own
 * file location (two levels up from tools/release/). To test it against a
 * FAKE repo tree without touching the real one, we copy the script next to
 * a fake `tools/release/` inside the fake root and invoke that copy — this
 * exercises the exact same relative-path logic the real script uses.
 */
function copyScriptIntoFakeRepo(fakeRoot: string): string {
  const src = readFileSync(scriptPath, "utf8");
  const destDir = join(fakeRoot, "tools", "release");
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, "check-version-drift.mjs");
  writeFileSync(dest, src);
  return dest;
}

describe("check-version-drift.mjs", () => {
  it("exits 0 when FUSION_VERSION matches package.json version", () => {
    const root = makeFakeRepo("1.2.3", "1.2.3");
    const script = copyScriptIntoFakeRepo(root);
    const output = execFileSync(process.execPath, [script], { encoding: "utf8" });
    expect(output).toContain("OK");
  });

  it("exits non-zero with a clear message when versions drift", () => {
    const root = makeFakeRepo("1.2.3", "1.2.4");
    const script = copyScriptIntoFakeRepo(root);
    expect(() => execFileSync(process.execPath, [script], { encoding: "utf8" })).toThrowError(
      /Command failed|drift/i,
    );
  });

  it("throws a clear error when the FUSION_VERSION literal cannot be found", () => {
    const root = makeFakeRepo("1.2.3", "1.2.3");
    const script = copyScriptIntoFakeRepo(root);
    writeFileSync(
      join(root, "packages", "shared", "src", "version.ts"),
      "export const NOT_THE_RIGHT_NAME = '1.2.3';\n",
    );
    expect(() => execFileSync(process.execPath, [script], { encoding: "utf8" })).toThrow();
  });
});
