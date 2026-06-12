/**
 * Configuration loader for @fusion/server.
 *
 * Layers (highest → lowest precedence):
 *   1. CLI flags (passed as partial overrides)
 *   2. Environment variables  FUSION_*
 *   3. fusion.json  in the data directory
 *   4. Built-in defaults
 *
 * REQ-ARQ-022, REQ-ARQ-023
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const ServerConfigSchema = z.object({
  /** TCP port to listen on. Default: 33000 (REQ-ARQ-007, D7). Port 0 = OS-assigned (useful in tests). */
  port: z.number().int().min(0).max(65535).default(33000),

  /** Bind host. Default: "0.0.0.0" (accept LAN connections). */
  host: z.string().default("0.0.0.0"),

  /**
   * Root directory for all user data (worlds, assets, fusion.json).
   * Must be separated from the app install directory (REQ-ARQ-027).
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
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// ---------------------------------------------------------------------------
// Raw (unvalidated) partial shape accepted from each layer
// ---------------------------------------------------------------------------

type RawConfig = z.input<typeof ServerConfigSchema>;

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
 * Reads and parses `fusion.json` from the given directory.
 * Returns an empty object if the file does not exist or cannot be parsed.
 * Never throws — errors are surfaced as warnings at call site.
 */
function readFusionJson(dataDir: string): Partial<RawConfig> {
  const filePath = join(dataDir, "fusion.json");
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
 * Loads and validates the server configuration by merging four layers.
 *
 * Precedence (1 = highest):
 *   1. cliOverrides (caller-supplied CLI flags)
 *   2. FUSION_* environment variables
 *   3. fusion.json  in the resolved data directory
 *   4. Schema defaults
 *
 * Throws a {@link z.ZodError} if the merged result fails schema validation.
 */
export function loadConfig(options: LoadConfigOptions = {}): ServerConfig {
  const { cliOverrides = {}, dataDirOverride } = options;

  // Determine which data directory to use when locating fusion.json.
  // The CLI override for dataDir (if present) wins here too.
  const dataDirForJson =
    dataDirOverride ??
    cliOverrides.dataDir ??
    process.env["FUSION_DATA_DIR"] ??
    join(homedir(), ".fusion");

  // Layer 3: fusion.json
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

  const merged: Partial<RawConfig> = {
    ...fileLayer, // layer 3
    ...envLayer, // layer 2
    ...cliDefined, // layer 1
  };

  return ServerConfigSchema.parse(merged);
}
