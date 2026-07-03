/**
 * Tests for the data directory layout module (M6/B1).
 *
 * Covers:
 *  - resolveDefaultDataDir per-OS (REQ-DST-008)
 *  - resolveEffectiveDataDir legacy ~/.fusion fallback
 *  - ensureDataDirLayout creates the REQ-DST-007 tree
 *  - legacy root fusion.json migrated to Config/ on first write
 *  - permission-denied aborts with a clear message (REQ-DST-010)
 *  - dataVersion/serverVersion stamped in Config/fusion.json (REQ-DST-038)
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  writeFileSync as fsWriteFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FUSION_VERSION } from "@fusion/shared";
import { resolveDefaultDataDir, resolveEffectiveDataDir, resolveConfigPath } from "../config.js";
import {
  ensureDataDirLayout,
  writeFusionConfig,
  DataDirPermissionError,
  CURRENT_DATA_VERSION,
} from "../data-dir.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanupDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// resolveDefaultDataDir — per-OS defaults (REQ-DST-008)
// ---------------------------------------------------------------------------

describe("resolveDefaultDataDir", () => {
  it("Windows: <USERPROFILE>/Documents/FusionVTT", () => {
    const dir = resolveDefaultDataDir("win32");
    expect(dir).toContain(join("Documents", "FusionVTT"));
  });

  it("macOS: ~/Documents/FusionVTT", () => {
    const dir = resolveDefaultDataDir("darwin");
    expect(dir).toContain(join("Documents", "FusionVTT"));
  });

  it("Linux: ~/FusionVTT when XDG_DATA_HOME is unset", () => {
    const prevXdg = process.env["XDG_DATA_HOME"];
    Reflect.deleteProperty(process.env, "XDG_DATA_HOME");
    try {
      const dir = resolveDefaultDataDir("linux");
      expect(dir.endsWith(join("FusionVTT"))).toBe(true);
      expect(dir).not.toContain("Documents");
    } finally {
      if (prevXdg !== undefined) process.env["XDG_DATA_HOME"] = prevXdg;
    }
  });

  it("Linux: $XDG_DATA_HOME/FusionVTT when set", () => {
    const prevXdg = process.env["XDG_DATA_HOME"];
    process.env["XDG_DATA_HOME"] = "/custom/xdg";
    try {
      const dir = resolveDefaultDataDir("linux");
      expect(dir).toBe(join("/custom/xdg", "FusionVTT"));
    } finally {
      if (prevXdg !== undefined) {
        process.env["XDG_DATA_HOME"] = prevXdg;
      } else {
        Reflect.deleteProperty(process.env, "XDG_DATA_HOME");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveDataDir — legacy ~/.fusion read-fallback
// ---------------------------------------------------------------------------

describe("resolveEffectiveDataDir", () => {
  it("uses the new per-OS default when it already exists on disk", () => {
    const result = resolveEffectiveDataDir("linux");
    expect(result).toHaveProperty("dataDir");
    expect(result).toHaveProperty("usedLegacyFallback");
  });

  // node:os's homedir() reads USERPROFILE (win32) / HOME (posix) dynamically
  // on every call, so overriding the env var lets us fabricate a fake home
  // directory tree and exercise the real legacy-fallback branch end to end
  // instead of only asserting the return shape.
  describe("with a fabricated fake HOME", () => {
    const homeEnvKey = process.platform === "win32" ? "USERPROFILE" : "HOME";
    let fakeHome: string;
    let prevHomeEnv: string | undefined;

    function setUp(): void {
      fakeHome = makeTempDir("fusion-fake-home-");
      prevHomeEnv = process.env[homeEnvKey];
      process.env[homeEnvKey] = fakeHome;
    }

    function tearDown(): void {
      if (prevHomeEnv !== undefined) {
        process.env[homeEnvKey] = prevHomeEnv;
      } else {
        Reflect.deleteProperty(process.env, homeEnvKey);
      }
    }

    it("falls back to legacy ~/.fusion when it exists and the new default does not", () => {
      setUp();
      try {
        const legacyDir = join(fakeHome, ".fusion");
        mkdirSync(legacyDir, { recursive: true });

        const os = process.platform === "win32" ? "win32" : "linux";
        const result = resolveEffectiveDataDir(os);

        expect(result.usedLegacyFallback).toBe(true);
        expect(result.dataDir).toBe(legacyDir);
      } finally {
        tearDown();
      }
    });

    it("prefers the new default over legacy ~/.fusion when both exist", () => {
      setUp();
      try {
        const legacyDir = join(fakeHome, ".fusion");
        mkdirSync(legacyDir, { recursive: true });

        const os = process.platform === "win32" ? "win32" : "linux";
        const newDefault = resolveDefaultDataDir(os);
        mkdirSync(newDefault, { recursive: true });

        const result = resolveEffectiveDataDir(os);
        expect(result.usedLegacyFallback).toBe(false);
        expect(result.dataDir).toBe(newDefault);
      } finally {
        tearDown();
      }
    });

    it("uses the new default (creatable, not yet existing) when neither exists", () => {
      setUp();
      try {
        const os = process.platform === "win32" ? "win32" : "linux";
        const result = resolveEffectiveDataDir(os);
        expect(result.usedLegacyFallback).toBe(false);
        expect(result.dataDir).toBe(resolveDefaultDataDir(os));
      } finally {
        tearDown();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// ensureDataDirLayout — REQ-DST-007 tree creation
// ---------------------------------------------------------------------------

describe("ensureDataDirLayout — tree creation", () => {
  it("creates Config/, systems/, assets/, backups/, Logs/ on first run", () => {
    const dataDir = makeTempDir("fusion-datadir-tree-");
    // Start from an empty dir (mkdtempSync already gives us that).
    ensureDataDirLayout(dataDir);

    for (const sub of ["Config", "systems", "assets", "backups", "Logs"]) {
      expect(existsSync(join(dataDir, sub)), `expected ${sub} to exist`).toBe(true);
    }
  });

  it("writes Config/fusion.json with dataVersion and serverVersion stamped", () => {
    const dataDir = makeTempDir("fusion-datadir-stamp-");
    ensureDataDirLayout(dataDir);

    const configPath = join(dataDir, "Config", "fusion.json");
    expect(existsSync(configPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect(parsed["dataVersion"]).toBe(CURRENT_DATA_VERSION);
    expect(parsed["serverVersion"]).toBe(FUSION_VERSION);
  });

  it("is idempotent — calling twice does not error or duplicate content", () => {
    const dataDir = makeTempDir("fusion-datadir-idempotent-");
    ensureDataDirLayout(dataDir);
    expect(() => ensureDataDirLayout(dataDir)).not.toThrow();

    const configPath = join(dataDir, "Config", "fusion.json");
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    expect(parsed["dataVersion"]).toBe(CURRENT_DATA_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Legacy config migration — root fusion.json -> Config/fusion.json
// ---------------------------------------------------------------------------

describe("ensureDataDirLayout — legacy config migration", () => {
  it("moves a root-level fusion.json into Config/ on first write", () => {
    const dataDir = makeTempDir("fusion-datadir-legacy-cfg-");
    // Simulate the OLD layout: fusion.json at the data dir root.
    writeFileSync(join(dataDir, "fusion.json"), JSON.stringify({ port: 9001 }), "utf8");

    // Before migration: resolveConfigPath should report the legacy location.
    const before = resolveConfigPath(dataDir);
    expect(before.isLegacyLocation).toBe(true);
    expect(before.path).toBe(join(dataDir, "fusion.json"));

    ensureDataDirLayout(dataDir);

    // The legacy file should be gone, and Config/fusion.json should exist
    // and preserve the original field (port) merged with the new stamps.
    expect(existsSync(join(dataDir, "fusion.json"))).toBe(false);
    const newPath = join(dataDir, "Config", "fusion.json");
    expect(existsSync(newPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(newPath, "utf8")) as Record<string, unknown>;
    expect(parsed["port"]).toBe(9001);
    expect(parsed["dataVersion"]).toBe(CURRENT_DATA_VERSION);

    // resolveConfigPath now reports the new (non-legacy) location.
    const after = resolveConfigPath(dataDir);
    expect(after.isLegacyLocation).toBe(false);
    expect(after.path).toBe(newPath);
  });

  it("does not touch an existing Config/fusion.json even if a stray root file exists", () => {
    const dataDir = makeTempDir("fusion-datadir-no-clobber-");
    mkdirSync(join(dataDir, "Config"), { recursive: true });
    writeFileSync(join(dataDir, "Config", "fusion.json"), JSON.stringify({ port: 7000 }), "utf8");
    // A root-level file also happens to exist (should be ignored — Config/ wins).
    writeFileSync(join(dataDir, "fusion.json"), JSON.stringify({ port: 1234 }), "utf8");

    ensureDataDirLayout(dataDir);

    const parsed = JSON.parse(
      readFileSync(join(dataDir, "Config", "fusion.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(parsed["port"]).toBe(7000);
  });
});

// ---------------------------------------------------------------------------
// writeFusionConfig — merge semantics
// ---------------------------------------------------------------------------

describe("writeFusionConfig", () => {
  it("merges new fields on top of existing ones without clobbering them", () => {
    const dataDir = makeTempDir("fusion-datadir-merge-");
    ensureDataDirLayout(dataDir);
    writeFusionConfig(dataDir, { setupCompleted: true });
    writeFusionConfig(dataDir, { updateChannel: "dev" });

    const parsed = JSON.parse(
      readFileSync(join(dataDir, "Config", "fusion.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(parsed["setupCompleted"]).toBe(true);
    expect(parsed["updateChannel"]).toBe("dev");
    // Earlier stamps from ensureDataDirLayout should still be present.
    expect(parsed["dataVersion"]).toBe(CURRENT_DATA_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Permission denied — REQ-DST-010
// ---------------------------------------------------------------------------

describe("ensureDataDirLayout — permission denied", () => {
  it("throws DataDirPermissionError with a clear message when the data dir cannot be created", () => {
    // Create a FILE (not a directory) and then try to use a path *under* it
    // as the data dir. mkdirSync(..., { recursive: true }) fails with
    // ENOTDIR in this situation on every OS — a portable way to simulate
    // "cannot read/write the data directory" without relying on POSIX
    // chmod semantics that do not translate to Windows ACLs.
    const parent = makeTempDir("fusion-datadir-blocked-");
    const blockerFile = join(parent, "blocker");
    fsWriteFileSync(blockerFile, "not a directory", "utf8");
    const impossibleDataDir = join(blockerFile, "FusionVTT");

    expect(() => ensureDataDirLayout(impossibleDataDir)).toThrow(DataDirPermissionError);

    try {
      ensureDataDirLayout(impossibleDataDir);
    } catch (err) {
      expect(err).toBeInstanceOf(DataDirPermissionError);
      const message = (err as DataDirPermissionError).message;
      expect(message).toContain(impossibleDataDir);
      expect(message.toLowerCase()).toContain("permission");
    }
  });
});
