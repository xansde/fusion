/**
 * Tests for tools/release/make-sea-config.mjs — the sea-config.json
 * generator (M6/B3 §7 "parser do sea-config"). Spawns the script as a real
 * child process (it is a standalone CLI, no exports) against temp fixture
 * files and asserts the emitted JSON shape Node's
 * `--experimental-sea-config` flag expects.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "..", "make-sea-config.mjs");

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-sea-config-test-"));
  cleanupDirs.push(dir);
  return dir;
}

describe("make-sea-config.mjs", () => {
  it("writes a sea-config.json with main/output/assets and disableExperimentalSEAWarning", () => {
    const dir = makeTempDir();
    const bundlePath = join(dir, "bundle.cjs");
    writeFileSync(bundlePath, "// fake bundle\n");
    const assetPath = join(dir, "asset.bin");
    writeFileSync(assetPath, "fake asset bytes");

    const outConfigPath = join(dir, "sea-config.json");
    const outBlobPath = join(dir, "out.blob");

    execFileSync(
      process.execPath,
      [scriptPath, bundlePath, outConfigPath, outBlobPath, "--asset", `native-x=${assetPath}`],
      { encoding: "utf8" },
    );

    expect(existsSync(outConfigPath)).toBe(true);
    const config = JSON.parse(readFileSync(outConfigPath, "utf8")) as Record<string, unknown>;
    expect(config["main"]).toBe(bundlePath);
    expect(config["output"]).toBe(outBlobPath);
    expect(config["disableExperimentalSEAWarning"]).toBe(true);
    expect(config["assets"]).toEqual({ "native-x": assetPath });
  });

  it("supports multiple --asset entries", () => {
    const dir = makeTempDir();
    const bundlePath = join(dir, "bundle.cjs");
    writeFileSync(bundlePath, "// fake bundle\n");
    const asset1 = join(dir, "a.bin");
    const asset2 = join(dir, "b.bin");
    writeFileSync(asset1, "a");
    writeFileSync(asset2, "b");

    const outConfigPath = join(dir, "sea-config.json");
    execFileSync(
      process.execPath,
      [
        scriptPath,
        bundlePath,
        outConfigPath,
        join(dir, "out.blob"),
        "--asset",
        `alpha=${asset1}`,
        "--asset",
        `beta=${asset2}`,
      ],
      { encoding: "utf8" },
    );

    const config = JSON.parse(readFileSync(outConfigPath, "utf8")) as {
      assets: Record<string, string>;
    };
    expect(Object.keys(config.assets).sort()).toEqual(["alpha", "beta"]);
  });

  it("fails loudly when the bundle path does not exist", () => {
    const dir = makeTempDir();
    expect(() =>
      execFileSync(
        process.execPath,
        [
          scriptPath,
          join(dir, "does-not-exist.cjs"),
          join(dir, "sea-config.json"),
          join(dir, "out.blob"),
        ],
        { encoding: "utf8" },
      ),
    ).toThrow();
  });

  it("fails loudly when a referenced asset path does not exist", () => {
    const dir = makeTempDir();
    const bundlePath = join(dir, "bundle.cjs");
    writeFileSync(bundlePath, "// fake\n");
    expect(() =>
      execFileSync(
        process.execPath,
        [
          scriptPath,
          bundlePath,
          join(dir, "sea-config.json"),
          join(dir, "out.blob"),
          "--asset",
          `missing=${join(dir, "nope.bin")}`,
        ],
        { encoding: "utf8" },
      ),
    ).toThrow();
  });

  it("creates parent directories for the output config path", () => {
    const dir = makeTempDir();
    const bundlePath = join(dir, "bundle.cjs");
    writeFileSync(bundlePath, "// fake\n");
    const outConfigPath = join(dir, "nested", "deeper", "sea-config.json");

    execFileSync(process.execPath, [scriptPath, bundlePath, outConfigPath, join(dir, "out.blob")], {
      encoding: "utf8",
    });

    expect(existsSync(outConfigPath)).toBe(true);
  });
});
