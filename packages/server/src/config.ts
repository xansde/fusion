/**
 * Configuration loader for @fusion/server.
 *
 * Layers (highest → lowest precedence):
 *   1. CLI flags (passed as partial overrides)
 *   2. Environment variables  FUSION_*
 *   3. Config/fusion.json  in the data directory
 *   4. Built-in defaults
 *
 * REQ-ARQ-022, REQ-ARQ-023
 *
 * Data directory layout & migration (REQ-DST-007/008/009/010/038, M6/B1):
 *
 *   The default data directory moved from `~/.fusion` to a per-OS
 *   `Documents/FusionVTT` location, and `fusion.json` moved from the data
 *   dir root into a `Config/` subdirectory. Both moves are read-compatible
 *   with the old layout for one version:
 *     - {@link resolveDefaultDataDir} falls back to the legacy `~/.fusion`
 *       directory when it exists and the new default does not (see
 *       {@link resolveEffectiveDataDir}).
 *     - {@link readFusionJson} falls back to a legacy `fusion.json` at the
 *       data dir root when `Config/fusion.json` is absent, and callers that
 *       write config (see `ensureDataDirLayout`) relocate it to `Config/` on
 *       first write.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { z } from "zod";

// ---------------------------------------------------------------------------
// GC defaults (T017, D5) — exported so `worlds/world-manager.ts` can fall
// back to the exact same numbers when it is constructed without an explicit
// override, instead of duplicating the literals 30/12 in a second file.
// ---------------------------------------------------------------------------

export const DEFAULT_GC_SESSION_RETENTION_DAYS = 30;
export const DEFAULT_GC_AUDIT_RETENTION_MONTHS = 12;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const ServerConfigSchema = z.object({
  /** TCP port to listen on. Default: 33000 (REQ-ARQ-007, D7). Port 0 = OS-assigned (useful in tests). */
  port: z.number().int().min(0).max(65535).default(33000),

  /** Bind host. Default: "0.0.0.0" (accept LAN connections). */
  host: z.string().default("0.0.0.0"),

  /**
   * Root directory for all user data (worlds, assets, Config/fusion.json).
   * Must be separated from the app install directory (REQ-ARQ-027).
   *
   * NOTE: the schema default here is only used when `loadConfig` is called
   * with no dataDir information at all (should not happen in practice —
   * `loadConfig` always resolves a concrete dataDir before parsing). See
   * {@link resolveDefaultDataDir} for the real default-resolution logic
   * (per-OS + legacy-fallback), which callers should use directly.
   */
  dataDir: z.string().default(join(homedir(), ".fusion")),

  /**
   * Custom hostname for invite links (optional).
   * When absent, the server detects the LAN IP automatically.
   */
  hostname: z.string().optional(),

  /** Attempt UPnP port forwarding on the router. Default: true. */
  upnp: z.boolean().default(true),

  /** Slug of a world to open automatically at boot (optional). */
  autoOpenWorld: z.string().optional(),

  /** Log level (pino). Default: "info". */
  logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),

  /**
   * Whether to set the Secure flag on the refresh-token cookie.
   *
   * REQ-SEC-056 / DEC-SEC-04: Set to true when the server runs behind a
   * TLS-terminating reverse proxy (nginx, Caddy, etc.).  Must be false
   * (default) for plain HTTP LAN deployments — browsers silently drop
   * Secure cookies served over HTTP.
   *
   * Env: FUSION_SECURE_COOKIES=true
   * Default: false (safe for direct desktop use without HTTPS).
   */
  secureCookies: z.boolean().default(false),

  /**
   * Whether the server runs behind a trusted reverse proxy.
   *
   * When true, Fastify reads the real client IP from the X-Forwarded-For
   * header (set by the proxy). Must only be enabled when you control the
   * proxy and it strips/overwrites XFF before forwarding — otherwise an
   * attacker can spoof the header to bypass lockout by IP.
   *
   * Env: FUSION_TRUST_PROXY=true
   * Default: false.
   */
  trustProxy: z.boolean().default(false),

  // -------------------------------------------------------------------------
  // REQ-DST schema extension (M6/B1) — superset of the fields above.
  // All new fields are optional/defaulted so existing Config/fusion.json (or
  // legacy fusion.json) files remain valid without edits.
  // -------------------------------------------------------------------------

  /**
   * Version of the Fusion server that last wrote this config file.
   * REQ-DST-038. Written by `ensureDataDirLayout`/setup, not user-editable
   * in practice, but accepted here so round-tripping the file is safe.
   */
  serverVersion: z.string().optional(),

  /**
   * Data-directory layout/migration version (distinct from the world.db
   * schemaVersion). REQ-DST-038. Used by `ensureDataDirLayout` to decide
   * whether inline data-dir migrations need to run (Q-DST-04: simple
   * numeric index in code, no formal migration-script system for MVP).
   */
  dataVersion: z.number().int().min(0).default(0),

  /**
   * Argon2id hash of the installation-level Admin Key (REQ-DST-012,
   * REQ-DST-015A). Set by the first-run wizard (`/setup`, M6/B2). Absent
   * until the wizard runs.
   */
  adminPasswordHash: z.string().optional(),

  /**
   * HMAC secret (hex-encoded) used to sign the short-lived admin session
   * JWT (REQ-DST-015A) — distinct from the per-world auth secret in
   * auth/crypto.ts (`loadOrCreateSecret`), which signs world-user tokens.
   * Set by the first-run wizard; generated once and persisted.
   */
  jwtHmacSecret: z.string().optional(),

  /** Auto-update channel (REQ-DST-025). Default: "stable". */
  updateChannel: z.enum(["stable", "dev"]).default("stable"),

  /**
   * Whether the first-run wizard has completed (REQ-DST-011/013/014).
   * Absence/false means the server should serve `/setup` before any game
   * functionality.
   */
  setupCompleted: z.boolean().default(false),

  /**
   * Origins allowed for CORS / socket.io (REQ-SEC / REQ-DST-032). When
   * empty, callers fall back to same-origin-only defaults.
   */
  allowedOrigins: z.array(z.string()).default([]),

  /**
   * GitHub `owner/repo` slug used to resolve update-check and release
   * URLs (REQ-DST-019, DA-01). Placeholder until the repo owner is
   * decided — auto-update (M6/B5) must treat an unset/placeholder value
   * as "update checking disabled", never crash on it.
   */
  updateRepo: z.string().default("REPLACE_ME/fusion"),

  /**
   * Days after a session's `expires_at` before the boot-time GC removes it
   * (T017, D5). `0` disables session collection entirely — it does NOT mean
   * "collect everything". See `db/gc.ts` for the exact boundary rule.
   *
   * Env: FUSION_GC_SESSION_RETENTION_DAYS
   * Default: 30.
   */
  gcSessionRetentionDays: z.number().int().min(0).default(DEFAULT_GC_SESSION_RETENTION_DAYS),

  /**
   * Calendar months after a roll's `created_at` before the boot-time GC
   * removes it from `roll_audit_log` (T017, D5). `0` disables audit-log
   * collection entirely. See `db/gc.ts`.
   *
   * Env: FUSION_GC_AUDIT_RETENTION_MONTHS
   * Default: 12.
   */
  gcAuditRetentionMonths: z.number().int().min(0).default(DEFAULT_GC_AUDIT_RETENTION_MONTHS),

  /** Reverse-proxy configuration (REQ-DST-032). */
  proxy: z
    .object({
      /** Whether the server is fronted by a TLS-terminating reverse proxy. */
      ssl: z.boolean().default(false),
      /** External port the proxy exposes (may differ from the internal `port`). */
      port: z.number().int().min(0).max(65535).optional(),
      /** Path prefix when hosted under a subpath (e.g. "/fusion"). */
      routePrefix: z.string().optional(),
    })
    .default({ ssl: false }),

  /**
   * Attempt automatic router port-forwarding via UPnP (REQ-DST-033, [V2]).
   * Distinct from `upnp` above (legacy field, kept for back-compat); new
   * code should prefer this name. Default: false — UPnP is [V2] and must
   * not be silently enabled for existing configs.
   */
  upnpEnabled: z.boolean().default(false),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// ---------------------------------------------------------------------------
// Raw (unvalidated) partial shape accepted from each layer
// ---------------------------------------------------------------------------

type RawConfig = z.input<typeof ServerConfigSchema>;

// ---------------------------------------------------------------------------
// Default data directory resolution (REQ-DST-008, REQ-DST-009)
// ---------------------------------------------------------------------------

/** Legacy default data directory (pre-M6). Kept for read-fallback only. */
export function legacyDataDir(): string {
  return join(homedir(), ".fusion");
}

/**
 * Resolve the per-OS default data directory (REQ-DST-008), ignoring any
 * legacy-fallback concerns — this is the "if I were installing fresh"
 * default.
 *
 * - Windows: %USERPROFILE%\Documents\FusionVTT
 * - macOS:   ~/Documents/FusionVTT
 * - Linux:   ~/FusionVTT (or $XDG_DATA_HOME/FusionVTT if set)
 */
export function resolveDefaultDataDir(os: NodeJS.Platform = platform()): string {
  if (os === "win32") {
    // USERPROFILE is the canonical Windows home-dir env var; fall back to
    // node's homedir() (which itself reads USERPROFILE on win32) if unset.
    const base = process.env["USERPROFILE"] ?? homedir();
    return join(base, "Documents", "FusionVTT");
  }

  if (os === "darwin") {
    return join(homedir(), "Documents", "FusionVTT");
  }

  // Linux and everything else: prefer XDG_DATA_HOME when set (comfort
  // recommendation from the design doc), else ~/FusionVTT.
  const xdgDataHome = process.env["XDG_DATA_HOME"];
  if (xdgDataHome !== undefined && xdgDataHome.length > 0) {
    return join(xdgDataHome, "FusionVTT");
  }
  return join(homedir(), "FusionVTT");
}

/**
 * Resolve the *effective* default data directory, applying the one-version
 * legacy-read fallback: if the new per-OS default does not exist on disk
 * but the legacy `~/.fusion` directory does, use the legacy directory (and
 * let the caller log a migration notice). Otherwise use the new default
 * (whether or not it exists yet — first run creates it).
 *
 * This is ONLY consulted when no explicit dataDir was supplied by CLI/env —
 * an explicit `--data-dir`/`FUSION_DATA_DIR` always wins outright and never
 * triggers this fallback.
 */
export function resolveEffectiveDataDir(os: NodeJS.Platform = platform()): {
  dataDir: string;
  usedLegacyFallback: boolean;
} {
  const newDefault = resolveDefaultDataDir(os);
  if (existsSync(newDefault)) {
    return { dataDir: newDefault, usedLegacyFallback: false };
  }

  const legacy = legacyDataDir();
  if (existsSync(legacy)) {
    return { dataDir: legacy, usedLegacyFallback: true };
  }

  return { dataDir: newDefault, usedLegacyFallback: false };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEnvInt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseEnvBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  return value.toLowerCase() !== "false" && value !== "0";
}

/**
 * Resolve the path to the config file for a given data directory, applying
 * the Config/fusion.json-with-legacy-root-fallback rule (REQ-DST-007):
 *   1. `{dataDir}/Config/fusion.json` if it exists.
 *   2. Else `{dataDir}/fusion.json` (legacy root location) if it exists.
 *   3. Else the new `Config/fusion.json` path (used for read-defaults and
 *      as the target the first write should create).
 */
export function resolveConfigPath(dataDir: string): { path: string; isLegacyLocation: boolean } {
  const newPath = join(dataDir, "Config", "fusion.json");
  if (existsSync(newPath)) {
    return { path: newPath, isLegacyLocation: false };
  }

  const legacyPath = join(dataDir, "fusion.json");
  if (existsSync(legacyPath)) {
    return { path: legacyPath, isLegacyLocation: true };
  }

  return { path: newPath, isLegacyLocation: false };
}

/**
 * Reads and parses the config file (`Config/fusion.json`, with legacy
 * root-level `fusion.json` fallback) from the given data directory.
 * Returns an empty object if the file does not exist or cannot be parsed.
 * Never throws — errors are surfaced as warnings at call site.
 */
function readFusionJson(dataDir: string): Partial<RawConfig> {
  const { path: filePath } = resolveConfigPath(dataDir);
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    // After the type guards above, parsed is a non-null non-array object.
    // All RawConfig fields are optional, so object is assignable without a cast.
    return parsed;
  } catch {
    // File does not exist or is malformed — silently ignore.
    return {};
  }
}

/**
 * Reads FUSION_* environment variables and returns a partial config object.
 */
function readEnvLayer(): Partial<RawConfig> {
  const env = process.env;
  const partial: Partial<RawConfig> = {};

  const port = parseEnvInt(env["FUSION_PORT"]);
  if (port !== undefined) partial.port = port;

  if (env["FUSION_HOST"] !== undefined && env["FUSION_HOST"] !== "") {
    partial.host = env["FUSION_HOST"];
  }
  if (env["FUSION_DATA_DIR"] !== undefined && env["FUSION_DATA_DIR"] !== "") {
    partial.dataDir = env["FUSION_DATA_DIR"];
  }
  if (env["FUSION_HOSTNAME"] !== undefined && env["FUSION_HOSTNAME"] !== "") {
    partial.hostname = env["FUSION_HOSTNAME"];
  }
  if (env["FUSION_AUTO_OPEN_WORLD"] !== undefined && env["FUSION_AUTO_OPEN_WORLD"] !== "") {
    partial.autoOpenWorld = env["FUSION_AUTO_OPEN_WORLD"];
  }

  const upnp = parseEnvBool(env["FUSION_UPNP"]);
  if (upnp !== undefined) partial.upnp = upnp;

  if (env["FUSION_LOG_LEVEL"] !== undefined && env["FUSION_LOG_LEVEL"] !== "") {
    partial.logLevel = env["FUSION_LOG_LEVEL"] as ServerConfig["logLevel"];
  }

  const secureCookies = parseEnvBool(env["FUSION_SECURE_COOKIES"]);
  if (secureCookies !== undefined) partial.secureCookies = secureCookies;

  const trustProxy = parseEnvBool(env["FUSION_TRUST_PROXY"]);
  if (trustProxy !== undefined) partial.trustProxy = trustProxy;

  if (env["FUSION_UPDATE_CHANNEL"] === "stable" || env["FUSION_UPDATE_CHANNEL"] === "dev") {
    partial.updateChannel = env["FUSION_UPDATE_CHANNEL"];
  }

  const gcSessionRetentionDays = parseEnvInt(env["FUSION_GC_SESSION_RETENTION_DAYS"]);
  if (gcSessionRetentionDays !== undefined) partial.gcSessionRetentionDays = gcSessionRetentionDays;

  const gcAuditRetentionMonths = parseEnvInt(env["FUSION_GC_AUDIT_RETENTION_MONTHS"]);
  if (gcAuditRetentionMonths !== undefined) partial.gcAuditRetentionMonths = gcAuditRetentionMonths;

  return partial;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LoadConfigOptions {
  /**
   * CLI flag overrides. These win over everything else (REQ-ARQ-023).
   * All fields are optional; only defined (non-undefined) fields override.
   */
  cliOverrides?: Partial<RawConfig>;

  /**
   * Override the data directory used to locate fusion.json.
   * Useful for tests to avoid touching the real home directory.
   */
  dataDirOverride?: string;
}

/**
 * Resolve which data directory `loadConfig` should use to locate the config
 * file, applying full precedence (dataDirOverride > cliOverrides.dataDir >
 * FUSION_DATA_DIR env > effective default with legacy fallback).
 *
 * Exposed separately so callers (e.g. `ensureDataDirLayout`, CLI commands)
 * can resolve the *same* data directory `loadConfig` would pick without
 * duplicating the precedence chain.
 */
export function resolveDataDirForLoad(
  options: Pick<LoadConfigOptions, "cliOverrides" | "dataDirOverride"> = {},
): { dataDir: string; usedLegacyFallback: boolean } {
  const { cliOverrides = {}, dataDirOverride } = options;

  const explicit =
    dataDirOverride ?? cliOverrides.dataDir ?? process.env["FUSION_DATA_DIR"] ?? undefined;

  if (explicit !== undefined) {
    return { dataDir: explicit, usedLegacyFallback: false };
  }

  return resolveEffectiveDataDir();
}

/**
 * Loads and validates the server configuration by merging four layers.
 *
 * Precedence (1 = highest):
 *   1. cliOverrides (caller-supplied CLI flags)
 *   2. FUSION_* environment variables
 *   3. Config/fusion.json (or legacy fusion.json) in the resolved data directory
 *   4. Schema defaults
 *
 * Throws a {@link z.ZodError} if the merged result fails schema validation.
 */
export function loadConfig(options: LoadConfigOptions = {}): ServerConfig {
  const { cliOverrides = {} } = options;

  // Determine which data directory to use when locating fusion.json.
  const { dataDir: dataDirForJson } = resolveDataDirForLoad(options);

  // Layer 3: Config/fusion.json (or legacy fusion.json)
  const fileLayer = readFusionJson(dataDirForJson);

  // Layer 2: environment variables
  const envLayer = readEnvLayer();

  // Merge all layers (later entries override earlier ones).
  // We spread all three layers; CLI overrides go last.
  // Undefined values in cliOverrides are stripped so they do not mask
  // lower-priority values — Zod's .default() fills missing fields later.
  const cliDefined: Partial<RawConfig> = {};
  if (cliOverrides.port !== undefined) cliDefined.port = cliOverrides.port;
  if (cliOverrides.host !== undefined) cliDefined.host = cliOverrides.host;
  if (cliOverrides.dataDir !== undefined) cliDefined.dataDir = cliOverrides.dataDir;
  if (cliOverrides.hostname !== undefined) cliDefined.hostname = cliOverrides.hostname;
  if (cliOverrides.upnp !== undefined) cliDefined.upnp = cliOverrides.upnp;
  if (cliOverrides.autoOpenWorld !== undefined)
    cliDefined.autoOpenWorld = cliOverrides.autoOpenWorld;
  if (cliOverrides.logLevel !== undefined) cliDefined.logLevel = cliOverrides.logLevel;
  if (cliOverrides.secureCookies !== undefined)
    cliDefined.secureCookies = cliOverrides.secureCookies;
  if (cliOverrides.trustProxy !== undefined) cliDefined.trustProxy = cliOverrides.trustProxy;

  // dataDir always reflects the resolved value (including the per-OS
  // default / legacy fallback) so downstream consumers of ServerConfig
  // never need to re-derive it. This means a `dataDir` field written INSIDE
  // fusion.json (self-referential — "which dir am I in") is always ignored
  // in favour of the dir it was actually read from: fusion.json is located
  // via dataDirForJson, so by definition dataDirForJson IS the real answer,
  // and honouring a stale/copied-over `dataDir` value from inside the file
  // would let a moved/duplicated fusion.json silently redirect the server
  // at a DIFFERENT data directory than the one it was just read from. This
  // is a deliberate behaviour change from pre-B1 (when fusion.json's own
  // dataDir field, if present, could influence resolution) — warn instead of
  // silently discarding it, since a stale value here usually means the file
  // was copied/moved without updating this field.
  if (
    typeof fileLayer.dataDir === "string" &&
    fileLayer.dataDir.length > 0 &&
    fileLayer.dataDir !== dataDirForJson
  ) {
    console.warn(
      `[fusion] Config/fusion.json contains "dataDir": "${fileLayer.dataDir}", ` +
        `which differs from the directory it was actually loaded from ` +
        `("${dataDirForJson}"). The "dataDir" field inside fusion.json is ` +
        `ignored — the resolved directory always wins. If you moved or copied ` +
        `this fusion.json, remove the stale "dataDir" field to avoid confusion.`,
    );
  }
  cliDefined.dataDir = dataDirForJson;

  const merged: Partial<RawConfig> = {
    ...fileLayer, // layer 3
    ...envLayer, // layer 2
    ...cliDefined, // layer 1
  };

  return ServerConfigSchema.parse(merged);
}
