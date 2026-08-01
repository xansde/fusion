/**
 * Unit tests for admin/service.ts (M6/B2 — installation admin plane).
 *
 * Covers:
 *  - Admin Key hashing is Argon2id (never plaintext) and round-trips
 *  - admin session JWT sign/verify, including rejecting tokens signed with
 *    a different secret (proves the two auth planes — admin vs world-user —
 *    cannot be confused)
 *  - port availability probing + suggestion scan
 *  - LAN IPv4 detection returns only non-internal addresses
 *  - applySetup persists Config/fusion.json with a hashed Admin Key (never
 *    plaintext) and mints a working admin token
 *  - applySetup bootstraps a NEW data dir when the wizard picks a different
 *    path than the one the server is currently running from
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import {
  hashAdminKey,
  verifyAdminKey,
  signAdminToken,
  verifyAdminToken,
  generateJwtHmacSecret,
  isPortAvailable,
  findAvailablePort,
  resolvePortableDataDir,
  detectLanIpv4Addresses,
  buildLanInviteUrls,
  applySetup,
  isFirstRun,
} from "../service.js";

/**
 * Windows-only test. The packaged Fusion binary only ships for Windows, and
 * the cases below assert Windows-specific semantics (path separators,
 * synchronous spawn failures, applyUpdate's platform gate), which cannot hold
 * on POSIX — the CI runner is Linux.
 */
const itWin = it.skipIf(process.platform !== "win32");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-admin-service-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Admin Key hashing (REQ-DST-012 item 3, REQ-SEC-010)
// ---------------------------------------------------------------------------

describe("hashAdminKey / verifyAdminKey", () => {
  it("hashes to an Argon2id PHC string, never the plaintext", async () => {
    const hash = await hashAdminKey("correct-horse-battery-staple");
    expect(hash).not.toBe("correct-horse-battery-staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("verifies the correct plaintext and rejects a wrong one", async () => {
    const hash = await hashAdminKey("correct-horse-battery-staple");
    expect(await verifyAdminKey("correct-horse-battery-staple", hash)).toBe(true);
    expect(await verifyAdminKey("wrong-password", hash)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Admin session JWT (REQ-DST-015A plan 1)
// ---------------------------------------------------------------------------

describe("signAdminToken / verifyAdminToken", () => {
  it("signs and verifies a token against the same secret", async () => {
    const secret = generateJwtHmacSecret();
    const token = await signAdminToken(secret);
    expect(await verifyAdminToken(token, secret)).toBe(true);
  });

  it("rejects a token verified against a DIFFERENT secret", async () => {
    const secretA = generateJwtHmacSecret();
    const secretB = generateJwtHmacSecret();
    const token = await signAdminToken(secretA);
    expect(await verifyAdminToken(token, secretB)).toBe(false);
  });

  it("rejects a garbage token", async () => {
    const secret = generateJwtHmacSecret();
    expect(await verifyAdminToken("not-a-jwt", secret)).toBe(false);
  });

  it("generates a fresh 32-byte hex secret each call", () => {
    const a = generateJwtHmacSecret();
    const b = generateJwtHmacSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Port availability (REQ-DST-015)
// ---------------------------------------------------------------------------

describe("isPortAvailable / findAvailablePort", () => {
  it("reports a free port as available", async () => {
    // Port 0 = OS-assigned; bind then close to get a very-likely-free port.
    const probe = createServer();
    const port = await new Promise<number>((resolve) => {
      probe.listen(0, () => {
        const addr = probe.address();
        const p = typeof addr === "object" && addr !== null ? addr.port : 0;
        probe.close(() => resolve(p));
      });
    });

    expect(await isPortAvailable(port)).toBe(true);
  });

  it("reports an occupied port as unavailable and suggests the next free one", async () => {
    // Bind with an EXPLICIT "0.0.0.0" host, mirroring exactly how the real
    // server binds (boot.ts always passes config.host, defaulting to
    // "0.0.0.0" — see config.ts). Binding with no host at all makes Node
    // listen on the IPv6 dual-stack wildcard ("::") instead, which does NOT
    // collide with a later IPv4-only bind attempt on the same port number —
    // that would test a scenario that never happens with this server.
    const occupied = createServer();
    const port = await new Promise<number>((resolve) => {
      occupied.listen(0, "0.0.0.0", () => {
        const addr = occupied.address();
        resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
      });
    });

    try {
      expect(await isPortAvailable(port)).toBe(false);

      const suggestion = await findAvailablePort(port);
      expect(suggestion).not.toBeNull();
      expect(suggestion).not.toBe(port);
    } finally {
      occupied.close();
    }
  });

  it("findAvailablePort returns null when the whole scanned range is exhausted", async () => {
    // Port 65535 + maxAttempts=1 means only 65535 is scanned; if it happens
    // to be free the test would be flaky, so instead verify the boundary
    // logic directly: starting past 65535 always yields null immediately.
    const result = await findAvailablePort(65536, 5);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LAN IP detection (REQ-DST-028)
// ---------------------------------------------------------------------------

describe("detectLanIpv4Addresses / buildLanInviteUrls", () => {
  it("returns only IPv4 addresses, never internal/loopback", () => {
    const addresses = detectLanIpv4Addresses();
    for (const addr of addresses) {
      expect(addr).not.toBe("127.0.0.1");
      expect(addr.split(".").length).toBe(4);
    }
  });

  it("builds http:// URLs with the given port for each detected address", () => {
    const urls = buildLanInviteUrls(33000);
    const addresses = detectLanIpv4Addresses();
    expect(urls.length).toBe(addresses.length);
    for (const url of urls) {
      expect(url).toMatch(/^http:\/\/[\d.]+:33000$/);
    }
  });
});

// ---------------------------------------------------------------------------
// resolvePortableDataDir (REQ-DST-009)
// ---------------------------------------------------------------------------

describe("resolvePortableDataDir", () => {
  itWin("joins the exe's own directory with FusionVTT-Data", () => {
    const result = resolvePortableDataDir("C:\\Program Files\\Fusion\\fusion-server.exe");
    expect(result).toBe(join("C:\\Program Files\\Fusion", "FusionVTT-Data"));
  });

  it("defaults to process.execPath when no override is given", () => {
    const result = resolvePortableDataDir();
    expect(result).toBe(join(dirname(process.execPath), "FusionVTT-Data"));
  });
});

// ---------------------------------------------------------------------------
// applySetup (REQ-DST-012/013)
// ---------------------------------------------------------------------------

describe("applySetup", () => {
  it("persists a hashed Admin Key (never plaintext) and setupCompleted=true", async () => {
    const dataDir = makeTempDataDir();

    await applySetup(dataDir, {
      dataDir,
      port: 33001,
      adminKey: "super-secret-admin-key",
    });

    const raw = readFileSync(join(dataDir, "Config", "fusion.json"), "utf8");
    expect(raw).not.toContain("super-secret-admin-key");
    expect(raw).toContain("$argon2id$");

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["setupCompleted"]).toBe(true);
    expect(parsed["port"]).toBe(33001);
    expect(typeof parsed["jwtHmacSecret"]).toBe("string");
    // dataDir must NEVER be written into fusion.json itself (config.ts
    // deliberately ignores/warns on a self-referential dataDir field).
    expect(parsed["dataDir"]).toBeUndefined();
  });

  it("mints an admin token that verifies against the persisted secret", async () => {
    const dataDir = makeTempDataDir();

    const result = await applySetup(dataDir, {
      dataDir,
      port: 33002,
      adminKey: "another-admin-key",
    });

    const parsed = JSON.parse(
      readFileSync(join(dataDir, "Config", "fusion.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(await verifyAdminToken(result.adminToken, parsed["jwtHmacSecret"] as string)).toBe(true);
    expect(result.dataDirChanged).toBe(false);
  });

  it("bootstraps the REQ-DST-007 tree at a NEW data dir when the wizard picks a different path", async () => {
    const runningDataDir = makeTempDataDir();
    const newDataDir = join(tmpdir(), `fusion-admin-newdir-${String(Date.now())}`);
    tempDirs.push(newDataDir);

    const result = await applySetup(runningDataDir, {
      dataDir: newDataDir,
      port: 33003,
      adminKey: "moved-admin-key",
    });

    expect(result.dataDirChanged).toBe(true);
    expect(existsSync(join(newDataDir, "Config", "fusion.json"))).toBe(true);
    expect(existsSync(join(runningDataDir, "Config", "fusion.json"))).toBe(true);

    const newConfig = JSON.parse(
      readFileSync(join(newDataDir, "Config", "fusion.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(newConfig["setupCompleted"]).toBe(true);
    expect(newConfig["dataDir"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isFirstRun
// ---------------------------------------------------------------------------

describe("isFirstRun", () => {
  it("is true when setupCompleted is false", () => {
    expect(isFirstRun({ setupCompleted: false })).toBe(true);
  });

  it("is false when setupCompleted is true", () => {
    expect(isFirstRun({ setupCompleted: true })).toBe(false);
  });
});
