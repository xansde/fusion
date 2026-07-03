/**
 * Tests for the configuration loader.
 *
 * Verifies that the four-layer precedence is correct:
 *   1. CLI overrides  (highest)
 *   2. FUSION_* env vars
 *   3. fusion.json
 *   4. Defaults       (lowest)
 *
 * REQ-ARQ-022, REQ-ARQ-023
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a temporary directory and writes fusion.json into it. */
function makeTempDataDir(content: Record<string, unknown>): string {
  const dir = join(
    tmpdir(),
    `fusion-config-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fusion.json"), JSON.stringify(content), "utf8");
  return dir;
}

// ---------------------------------------------------------------------------
// Environment variable isolation
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "FUSION_PORT",
  "FUSION_HOST",
  "FUSION_DATA_DIR",
  "FUSION_HOSTNAME",
  "FUSION_AUTO_OPEN_WORLD",
  "FUSION_UPNP",
  "FUSION_LOG_LEVEL",
] as const;

type EnvSnapshot = Partial<Record<(typeof ENV_KEYS)[number], string>>;

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const key of ENV_KEYS) {
    if (process.env[key] !== undefined) {
      snap[key] = process.env[key];
    }
  }
  return snap;
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    if (snap[key] !== undefined) {
      process.env[key] = snap[key];
    } else {
      Reflect.deleteProperty(process.env, key);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    // Start clean — no FUSION_* vars in the environment.
    for (const key of ENV_KEYS) {
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  // -------------------------------------------------------------------------
  // Layer 4: defaults
  // -------------------------------------------------------------------------

  it("uses default port 33000 when nothing is set", () => {
    const config = loadConfig({ dataDirOverride: tmpdir() });
    expect(config.port).toBe(33000);
  });

  it("uses default host 0.0.0.0 when nothing is set", () => {
    const config = loadConfig({ dataDirOverride: tmpdir() });
    expect(config.host).toBe("0.0.0.0");
  });

  it("uses default logLevel 'info' when nothing is set", () => {
    const config = loadConfig({ dataDirOverride: tmpdir() });
    expect(config.logLevel).toBe("info");
  });

  it("sets upnp to true by default", () => {
    const config = loadConfig({ dataDirOverride: tmpdir() });
    expect(config.upnp).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Layer 3: fusion.json
  // -------------------------------------------------------------------------

  it("reads port from fusion.json", () => {
    const dir = makeTempDataDir({ port: 9999 });
    try {
      const config = loadConfig({ dataDirOverride: dir });
      expect(config.port).toBe(9999);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads logLevel from fusion.json", () => {
    const dir = makeTempDataDir({ logLevel: "debug" });
    try {
      const config = loadConfig({ dataDirOverride: dir });
      expect(config.logLevel).toBe("debug");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a malformed fusion.json gracefully", () => {
    const dir = join(
      tmpdir(),
      `fusion-bad-json-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fusion.json"), "NOT VALID JSON", "utf8");
    try {
      const config = loadConfig({ dataDirOverride: dir });
      // Should fall back to defaults.
      expect(config.port).toBe(33000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns defaults when fusion.json does not exist", () => {
    // Use a temp dir that has no fusion.json.
    const dir = join(
      tmpdir(),
      `fusion-no-json-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    try {
      const config = loadConfig({ dataDirOverride: dir });
      expect(config.port).toBe(33000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Layer 2: environment variables
  // -------------------------------------------------------------------------

  it("env FUSION_PORT overrides fusion.json port", () => {
    const dir = makeTempDataDir({ port: 9999 });
    process.env["FUSION_PORT"] = "8888";
    try {
      const config = loadConfig({ dataDirOverride: dir });
      expect(config.port).toBe(8888);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("env FUSION_HOST overrides default host", () => {
    process.env["FUSION_HOST"] = "127.0.0.1";
    const config = loadConfig({ dataDirOverride: tmpdir() });
    expect(config.host).toBe("127.0.0.1");
  });

  it("env FUSION_LOG_LEVEL overrides fusion.json logLevel", () => {
    const dir = makeTempDataDir({ logLevel: "warn" });
    process.env["FUSION_LOG_LEVEL"] = "error";
    try {
      const config = loadConfig({ dataDirOverride: dir });
      expect(config.logLevel).toBe("error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("env FUSION_UPNP=false overrides default upnp=true", () => {
    process.env["FUSION_UPNP"] = "false";
    const config = loadConfig({ dataDirOverride: tmpdir() });
    expect(config.upnp).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Layer 1: CLI overrides
  // -------------------------------------------------------------------------

  it("CLI port overrides env FUSION_PORT", () => {
    process.env["FUSION_PORT"] = "8888";
    const config = loadConfig({
      dataDirOverride: tmpdir(),
      cliOverrides: { port: 7777 },
    });
    expect(config.port).toBe(7777);
  });

  it("CLI port overrides fusion.json port", () => {
    const dir = makeTempDataDir({ port: 9999 });
    try {
      const config = loadConfig({
        dataDirOverride: dir,
        cliOverrides: { port: 4321 },
      });
      expect(config.port).toBe(4321);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CLI logLevel overrides env and fusion.json", () => {
    const dir = makeTempDataDir({ logLevel: "warn" });
    process.env["FUSION_LOG_LEVEL"] = "error";
    try {
      const config = loadConfig({
        dataDirOverride: dir,
        cliOverrides: { logLevel: "trace" },
      });
      expect(config.logLevel).toBe("trace");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Full precedence chain
  // -------------------------------------------------------------------------

  it("full precedence: CLI > env > file > default for the same key (port)", () => {
    const dir = makeTempDataDir({ port: 1111 }); // layer 3
    process.env["FUSION_PORT"] = "2222"; // layer 2

    try {
      // With only file + env, env wins.
      const config1 = loadConfig({ dataDirOverride: dir });
      expect(config1.port).toBe(2222);

      // With CLI added, CLI wins.
      const config2 = loadConfig({
        dataDirOverride: dir,
        cliOverrides: { port: 3333 },
      });
      expect(config2.port).toBe(3333);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it("throws ZodError for invalid port values", () => {
    expect(() =>
      loadConfig({
        dataDirOverride: tmpdir(),
        cliOverrides: { port: 99999 },
      }),
    ).toThrow();
  });

  it("throws ZodError for invalid logLevel values", () => {
    process.env["FUSION_LOG_LEVEL"] = "INVALID";
    expect(() => loadConfig({ dataDirOverride: tmpdir() })).toThrow();
  });

  // -------------------------------------------------------------------------
  // Self-referential dataDir field inside fusion.json (ignored, but warned)
  // -------------------------------------------------------------------------

  it("ignores a divergent 'dataDir' field written inside fusion.json but warns about it", () => {
    const dir = makeTempDataDir({ dataDir: "D:/elsewhere", port: 1234 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const config = loadConfig({ dataDirOverride: dir });
      // The resolved directory always wins — never the value written inside
      // the file itself (see config.ts loadConfig for the rationale).
      expect(config.dataDir).toBe(dir);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain("D:/elsewhere");
    } finally {
      warnSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not warn when fusion.json has no 'dataDir' field", () => {
    const dir = makeTempDataDir({ port: 1234 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      loadConfig({ dataDirOverride: dir });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not warn when fusion.json's 'dataDir' field already matches the resolved directory", () => {
    const dir = makeTempDataDir({ port: 1234 });
    // Self-consistent: file's own dataDir field matches where it actually lives.
    writeFileSync(join(dir, "fusion.json"), JSON.stringify({ dataDir: dir, port: 1234 }), "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      loadConfig({ dataDirOverride: dir });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
