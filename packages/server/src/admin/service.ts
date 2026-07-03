/**
 * AdminService — domain logic for the installation-level admin plane.
 *
 * REQ-DST-011..015, REQ-DST-015A, REQ-DST-028/029 (M6/B2).
 *
 * This is deliberately SEPARATE from auth/service.ts (AuthService), which is
 * scoped to a world's GAMEMASTER users (REQ-DST-015A plan 2). AdminService
 * has no world/db dependency at all — it operates purely on Config/fusion.json
 * (via data-dir.ts's writeFusionConfig) plus in-memory port/network probing.
 * The two planes intentionally share only the low-level crypto primitives
 * (hashPassword/verifyPassword/Argon2id, signAccessToken-style JWT via jose)
 * already implemented in auth/crypto.ts — reused here via a dedicated
 * "admin token" signer so the token payload/claims never get confused with a
 * world-user access token (different secret field: jwtHmacSecret vs the
 * per-world auth_secret file; different payload shape; different verify path).
 */

import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { SignJWT, jwtVerify } from "jose";
import { hashPassword, verifyPassword } from "../auth/crypto.js";
import { writeFusionConfig, ensureDataDirLayout } from "../data-dir.js";
import type { ServerConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Admin session JWT (REQ-DST-015A plan 1 — distinct from world-user tokens)
// ---------------------------------------------------------------------------

const ADMIN_JWT_ALG = "HS256" as const;
/** Admin session token validity: 60 minutes — enough for a setup/reconfig session. */
const ADMIN_TOKEN_TTL_S = 60 * 60;
/** Marks the JWT as belonging to the installation admin plane, never a world-user token. */
const ADMIN_TOKEN_SUBJECT = "fusion-admin";

export interface AdminTokenPayload {
  sub: typeof ADMIN_TOKEN_SUBJECT;
  plane: "admin";
}

/** Sign a short-lived admin session token from the given jwtHmacSecret (hex). */
export async function signAdminToken(jwtHmacSecretHex: string): Promise<string> {
  const secret = Buffer.from(jwtHmacSecretHex, "hex");
  return new SignJWT({ plane: "admin" })
    .setProtectedHeader({ alg: ADMIN_JWT_ALG })
    .setSubject(ADMIN_TOKEN_SUBJECT)
    .setIssuedAt()
    .setExpirationTime(`${String(ADMIN_TOKEN_TTL_S)}s`)
    .sign(secret);
}

/**
 * Verify an admin session Bearer token. Returns true iff the token was
 * signed with `jwtHmacSecretHex` and carries the admin-plane subject/claim.
 * Never throws — any error (bad signature, expired, malformed) → false.
 */
export async function verifyAdminToken(token: string, jwtHmacSecretHex: string): Promise<boolean> {
  try {
    const secret = Buffer.from(jwtHmacSecretHex, "hex");
    const { payload } = await jwtVerify(token, secret, { algorithms: [ADMIN_JWT_ALG] });
    return payload.sub === ADMIN_TOKEN_SUBJECT && payload["plane"] === "admin";
  } catch {
    return false;
  }
}

/** Generate a new 32-byte HMAC secret (hex-encoded) for jwtHmacSecret. */
export function generateJwtHmacSecret(): string {
  return randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Admin Key (Argon2id) — REQ-DST-012 item 3, REQ-SEC-010
// ---------------------------------------------------------------------------

/** Hash a plaintext Admin Key for storage in Config/fusion.json (adminPasswordHash). */
export async function hashAdminKey(plaintext: string): Promise<string> {
  return hashPassword(plaintext);
}

/** Verify a plaintext Admin Key against the stored Argon2id hash. */
export async function verifyAdminKey(plaintext: string, hash: string): Promise<boolean> {
  return verifyPassword(plaintext, hash);
}

// ---------------------------------------------------------------------------
// Port availability (REQ-DST-015)
// ---------------------------------------------------------------------------

/**
 * Check whether `port` is free to bind on all interfaces, resolving `true`
 * (available) or `false` (in use) — never rejects.
 */
export function isPortAvailable(port: number, host = "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once("error", () => {
      resolve(false);
    });
    tester.once("listening", () => {
      tester.close(() => {
        resolve(true);
      });
    });
    try {
      tester.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Find the first available port at or after `startPort` (inclusive), up to
 * `maxAttempts` ports scanned. Returns null if none found in range — callers
 * should fall back to a generic "try a different port" message.
 */
export async function findAvailablePort(
  startPort: number,
  maxAttempts = 20,
): Promise<number | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = startPort + i;
    if (candidate > 65535) break;
    // Sequential probing is intentional (avoid hammering the OS with parallel binds).
    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// LAN IP detection (REQ-DST-028)
// ---------------------------------------------------------------------------

/**
 * Return non-internal IPv4 addresses of this machine, suitable for building
 * a LAN invite URL. Excludes loopback/link-local. Order is not guaranteed
 * across platforms — callers display all of them, not just the first.
 */
export function detectLanIpv4Addresses(): string[] {
  const interfaces = networkInterfaces();
  const addresses: string[] = [];

  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return addresses;
}

/** Build the LAN invite URL(s) for the given port, one per detected IPv4 address. */
export function buildLanInviteUrls(port: number): string[] {
  return detectLanIpv4Addresses().map((ip) => `http://${ip}:${String(port)}`);
}

// ---------------------------------------------------------------------------
// Portable data dir suggestion (REQ-DST-009)
// ---------------------------------------------------------------------------

/**
 * Resolve `<exeDir>/FusionVTT-Data` from the actual running process.
 *
 * `process.execPath` is the real answer for a packaged Node SEA executable
 * (M6/B3) — it points at the `.exe` itself, so `dirname()` is the install
 * folder. In dev (`pnpm exec node dist/index.js` / `ts-node`), execPath
 * points at the `node` binary somewhere in a toolchain directory, which is
 * NOT a sensible "portable" location — `execPathOverride` lets callers (and
 * tests) supply a more meaningful path; the CLI wires this to its own entry
 * point resolution once B3 packages a real executable. Until then this is a
 * best-effort suggestion the GM can freely edit in the wizard field.
 */
export function resolvePortableDataDir(execPathOverride?: string): string {
  const execPath = execPathOverride ?? process.execPath;
  return join(dirname(execPath), "FusionVTT-Data");
}

// ---------------------------------------------------------------------------
// Setup state (what the wizard needs to render)
// ---------------------------------------------------------------------------

export interface SetupState {
  setupCompleted: boolean;
  defaultDataDir: string;
  /**
   * REQ-DST-009 "portable install" suggestion: `<exeDir>/FusionVTT-Data`,
   * resolved server-side from the ACTUAL running location (a Node SEA exe's
   * `process.execPath`, or the CLI's cwd-relative entry point in dev). The
   * wizard cannot know this from the browser sandbox — resolving it here and
   * sending an absolute path avoids the client ever guessing a bare relative
   * string like "./FusionVTT-Data", which would resolve against the SERVER
   * PROCESS's cwd (not the exe's own directory) if sent back verbatim.
   */
  portableDataDir: string;
  currentDataDir: string;
  /** The port THIS boot is actually bound to (see admin/routes.ts's resolveCurrentPort). */
  currentPort: number;
  /**
   * The port persisted in Config/fusion.json, which will be used starting
   * the NEXT boot (REQ-DST-013) — may differ from `currentPort` when the GM
   * reconfigured the port but has not restarted yet, or when this boot used
   * an explicit --port different from what was previously persisted. See
   * admin/routes.ts's resolveConfiguredPortNextBoot for the exact semantics.
   */
  configuredPortNextBoot: number;
  lanUrls: string[];
  serverVersion: string;
}

// ---------------------------------------------------------------------------
// Apply setup (REQ-DST-012/013)
// ---------------------------------------------------------------------------

export interface ApplySetupParams {
  dataDir: string;
  port: number;
  adminKey: string;
}

export interface ApplySetupResult {
  adminToken: string;
  lanUrls: string[];
  /** True when params.dataDir differs from the dir the server is currently running from. */
  dataDirChanged: boolean;
}

/**
 * Persist the wizard's choices to Config/fusion.json and mint the first
 * admin session token. Does NOT restart the HTTP listener itself — the
 * caller (routes.ts) decides whether the new port requires a documented
 * restart (REQ-DST-013 allows "restart automatically OR redirect"; MVP
 * chooses "apply what can be applied live, tell the GM to restart for the
 * port change" — see admin/routes.ts applySetup handler for the exact
 * behaviour and rationale).
 *
 * `runningDataDir` is the data directory THIS process actually booted from
 * (config.dataDir) — writes always target that directory, NEVER a `dataDir`
 * field inside the JSON itself: config.ts's loadConfig deliberately ignores
 * (and warns on) a `dataDir` key inside fusion.json that diverges from the
 * directory it was loaded from (see config.ts loadConfig's dataDir-mismatch
 * warning), so writing it here would just produce a silently-ignored field.
 *
 * When `params.dataDir` (the wizard's chosen path) differs from
 * `runningDataDir`, this is a *data directory move* request: the full config
 * is ALSO bootstrapped at the new location (REQ-DST-007 tree + this same
 * Config/fusion.json content), so a restart with `--data-dir <new path>` (or
 * no flag, if the new path is now the per-OS default) picks it up cleanly.
 * The OLD location's config is left untouched — the GM restarts into the new
 * dir explicitly, nothing is deleted automatically.
 */
export async function applySetup(
  runningDataDir: string,
  params: ApplySetupParams,
): Promise<ApplySetupResult> {
  const adminPasswordHash = await hashAdminKey(params.adminKey);
  const jwtHmacSecret = generateJwtHmacSecret();

  const configFields = {
    port: params.port,
    adminPasswordHash,
    jwtHmacSecret,
    setupCompleted: true,
  };

  writeFusionConfig(runningDataDir, configFields);

  const dataDirChanged = params.dataDir !== runningDataDir;
  if (dataDirChanged) {
    // Bootstrap the REQ-DST-007 tree at the new location and mirror the same
    // config fields there, so `fusion serve --data-dir <new>` boots
    // pre-configured on the very next launch.
    ensureDataDirLayout(params.dataDir);
    writeFusionConfig(params.dataDir, configFields);
  }

  const adminToken = await signAdminToken(jwtHmacSecret);
  const lanUrls = buildLanInviteUrls(params.port);

  return { adminToken, lanUrls, dataDirChanged };
}

// ---------------------------------------------------------------------------
// Reconfiguration guard helper
// ---------------------------------------------------------------------------

/**
 * True when the config has no adminPasswordHash yet — i.e. the wizard has
 * never completed, so /admin/setup/apply must be reachable WITHOUT a Bearer
 * token (there is nothing to bear yet). Once setupCompleted is true, every
 * /admin/* route (including a re-run of the wizard, REQ-DST-014) requires a
 * valid admin Bearer token verified against the stored jwtHmacSecret.
 */
export function isFirstRun(config: Pick<ServerConfig, "setupCompleted">): boolean {
  return !config.setupCompleted;
}
