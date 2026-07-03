/**
 * Data directory layout — creation, permission checks, and config migration.
 *
 * REQ-DST-007 (tree layout), REQ-DST-008/009 (defaults + portable override),
 * REQ-DST-010 (permission check aborts with a clear message), REQ-DST-038
 * (serverVersion/dataVersion in Config/fusion.json).
 *
 * This module owns the *filesystem side* of the data directory: creating
 * the REQ-DST-007 tree on first run, migrating a legacy `~/.fusion` layout
 * (root-level `fusion.json`) into `Config/fusion.json`, and writing
 * `Config/fusion.json` back to disk. `config.ts` owns *reading* the layered
 * config (including the legacy-root fallback read); this module is what
 * makes writes converge on the new layout.
 *
 * `worlds/` is NOT created here — WorldManager already creates it (and
 * `trash/`) in its constructor. `runtime/` (native addon cache) is out of
 * scope for B1 per the design doc (owned by a later release-pipeline batch).
 */

import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  renameSync,
  accessSync,
  constants as fsConstants,
} from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import { FUSION_VERSION } from "@fusion/shared";
import { resolveConfigPath, ServerConfigSchema, type ServerConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Current data-dir layout/migration version (Q-DST-04: simple inline index,
// no formal migration-script system for MVP). Bump this and add a branch in
// `migrateDataDir` when a future batch needs a real migration step.
// ---------------------------------------------------------------------------

export const CURRENT_DATA_VERSION = 1;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the data directory (or its parent, for first creation) is not
 * readable/writable by the current process. REQ-DST-010: callers must
 * surface `message` verbatim and abort boot — never continue with a
 * half-usable data directory.
 */
export class DataDirPermissionError extends Error {
  constructor(
    public readonly dataDir: string,
    cause: unknown,
  ) {
    super(
      `Cannot read/write the Fusion data directory: "${dataDir}". ` +
        `Check that the folder exists and that this user has permission to ` +
        `read and write it, then try again. ` +
        `(You can choose a different location with --data-dir <path>.)` +
        (cause instanceof Error ? ` Underlying error: ${cause.message}` : ""),
    );
    this.name = "DataDirPermissionError";
  }
}

// ---------------------------------------------------------------------------
// Permission check (REQ-DST-010)
// ---------------------------------------------------------------------------

/**
 * Verify read/write access to `dataDir`, creating it first if it does not
 * yet exist (first run). Throws {@link DataDirPermissionError} with a clear
 * message on any failure — callers must let this abort boot rather than
 * catching and continuing.
 */
export function assertDataDirAccessible(dataDir: string): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, fsConstants.R_OK | fsConstants.W_OK);
  } catch (err) {
    throw new DataDirPermissionError(dataDir, err);
  }
}

// ---------------------------------------------------------------------------
// Tree creation (REQ-DST-007)
// ---------------------------------------------------------------------------

/**
 * Create the REQ-DST-007 top-level tree under `dataDir`, idempotently.
 * `worlds/` and `trash/` are owned by WorldManager and intentionally not
 * duplicated here.
 */
function createDataDirTree(dataDir: string): void {
  mkdirSync(join(dataDir, "Config"), { recursive: true });
  mkdirSync(join(dataDir, "systems"), { recursive: true });
  mkdirSync(join(dataDir, "assets"), { recursive: true });
  mkdirSync(join(dataDir, "backups"), { recursive: true });
  mkdirSync(join(dataDir, "Logs"), { recursive: true });
}

// ---------------------------------------------------------------------------
// Legacy config migration (root fusion.json → Config/fusion.json)
// ---------------------------------------------------------------------------

/**
 * If a config file exists only at the legacy root location
 * (`{dataDir}/fusion.json`) and not yet under `Config/`, move it there.
 * No-op if the new location already has a file, or if neither exists.
 * Never throws — a failed migration falls back to leaving the legacy file
 * in place (still readable via config.ts's fallback) and logs a warning.
 */
function migrateLegacyConfigFile(dataDir: string, logger?: Logger): void {
  const { path: resolvedPath, isLegacyLocation } = resolveConfigPath(dataDir);
  if (!isLegacyLocation) return; // already at Config/, or nothing exists yet

  const newPath = join(dataDir, "Config", "fusion.json");
  try {
    mkdirSync(join(dataDir, "Config"), { recursive: true });
    renameSync(resolvedPath, newPath);
    logger?.info(
      { from: resolvedPath, to: newPath },
      "Migrated legacy fusion.json to Config/fusion.json",
    );
  } catch (err) {
    logger?.warn(
      { err, from: resolvedPath, to: newPath },
      "Could not migrate legacy fusion.json to Config/ — continuing to read it in place",
    );
  }
}

// ---------------------------------------------------------------------------
// Config/fusion.json read + write (raw JSON, not the layered loadConfig)
// ---------------------------------------------------------------------------

/**
 * Read the raw JSON object currently on disk at the resolved config path
 * (Config/fusion.json or legacy root fusion.json), or `{}` if absent/invalid.
 * Used internally to merge new fields into the file without clobbering
 * fields this module does not know about (forward-compat for future batches).
 */
function readRawConfigFile(dataDir: string): Record<string, unknown> {
  const { path } = resolveConfigPath(dataDir);
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Write `Config/fusion.json`, merging `updates` on top of whatever is
 * already on disk (raw merge — preserves unknown/future fields). Always
 * writes to the canonical `Config/` location, never the legacy root.
 */
export function writeFusionConfig(dataDir: string, updates: Record<string, unknown>): void {
  const existing = readRawConfigFile(dataDir);
  const merged = { ...existing, ...updates };
  mkdirSync(join(dataDir, "Config"), { recursive: true });
  const newPath = join(dataDir, "Config", "fusion.json");
  writeFileSync(newPath, JSON.stringify(merged, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// dataVersion migration (Q-DST-04: inline numeric index)
// ---------------------------------------------------------------------------

/**
 * Run any pending inline data-dir migrations, then persist
 * `dataVersion: CURRENT_DATA_VERSION` and `serverVersion: FUSION_VERSION`
 * (REQ-DST-038) to Config/fusion.json.
 *
 * MVP has no real migration steps yet (CURRENT_DATA_VERSION starts at 1,
 * covering "the REQ-DST-007 tree + Config/fusion.json exist"). Future
 * batches add `if (fromVersion < N) { ... }` branches here as the layout
 * evolves — Q-DST-04 deliberately rejects a formal migration-script system
 * for the MVP's scale.
 */
function migrateDataVersion(dataDir: string, logger?: Logger): void {
  const raw = readRawConfigFile(dataDir);
  const fromVersion = typeof raw["dataVersion"] === "number" ? raw["dataVersion"] : 0;

  if (fromVersion < CURRENT_DATA_VERSION) {
    logger?.info(
      { fromVersion, toVersion: CURRENT_DATA_VERSION },
      "Migrating Fusion data directory layout",
    );
  }

  writeFusionConfig(dataDir, {
    dataVersion: CURRENT_DATA_VERSION,
    serverVersion: FUSION_VERSION,
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface EnsureDataDirLayoutOptions {
  logger?: Logger;
  /** Set when the caller already knows the legacy `~/.fusion` dir was chosen (config.ts's resolveEffectiveDataDir), purely for logging. */
  usedLegacyDataDir?: boolean;
}

/**
 * Idempotent "first run" setup for the data directory:
 *   1. Verify read/write access (REQ-DST-010) — throws DataDirPermissionError.
 *   2. Create the REQ-DST-007 tree (Config/, systems/, assets/, backups/, Logs/).
 *   3. Migrate a legacy root-level fusion.json into Config/, if present.
 *   4. Run pending dataVersion migrations and stamp serverVersion/dataVersion.
 *
 * Safe to call on every boot — all steps are no-ops when already applied.
 */
export function ensureDataDirLayout(
  dataDir: string,
  options: EnsureDataDirLayoutOptions = {},
): void {
  const { logger, usedLegacyDataDir } = options;

  assertDataDirAccessible(dataDir);

  if (usedLegacyDataDir === true) {
    logger?.warn(
      { dataDir },
      "Using legacy data directory ~/.fusion (fallback). " +
        "Consider migrating to the new default location by moving this folder " +
        "to the platform default (see REQ-DST-008) or passing --data-dir explicitly.",
    );
  }

  createDataDirTree(dataDir);
  migrateLegacyConfigFile(dataDir, logger);
  migrateDataVersion(dataDir, logger);
}

// Re-exported for convenience so callers only need one import for the
// "validated ServerConfig read from the layout this module manages" case.
export type { ServerConfig };
export { ServerConfigSchema };
