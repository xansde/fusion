/**
 * CLI command: fusion serve
 *
 * Boots the full Fusion server with optional CLI overrides.
 * Registers the stub system and wires WorldManager into the boot result's shutdown.
 */

import type { ServeArgs } from "../args.js";
import { loadConfig } from "../../config.js";
import type { ServerConfig, LoadConfigOptions } from "../../config.js";
import { createLogger } from "../../logger.js";
import { boot } from "../../boot.js";
import { SystemRegistry } from "@fusion/system-api";
import { WorldManager } from "../../worlds/index.js";

type LogLevel = ServerConfig["logLevel"];

const VALID_LOG_LEVELS: ReadonlySet<string> = new Set<LogLevel>([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
]);

function parseLogLevel(raw: string): LogLevel {
  if (!VALID_LOG_LEVELS.has(raw)) {
    throw new Error(
      `Invalid log level: "${raw}". Valid values: trace, debug, info, warn, error, fatal, silent`,
    );
  }
  return raw as LogLevel;
}

export async function runServe(args: ServeArgs): Promise<void> {
  // Phase 1 — config (CLI flags → env → fusion.json → defaults)
  let config: ServerConfig;
  try {
    // Build cliOverrides incrementally — only assign defined fields so that
    // lower-priority layers (env, fusion.json, defaults) are not shadowed.
    // Using Object.assign avoids exactOptionalPropertyTypes issues with spread.
    const overrides: { port?: number; dataDir?: string; logLevel?: LogLevel } = {};
    if (args.port !== undefined) overrides.port = args.port;
    if (args.dataDir !== undefined) overrides.dataDir = args.dataDir;
    if (args.logLevel !== undefined) overrides.logLevel = parseLogLevel(args.logLevel);

    const loadOpts: LoadConfigOptions = {};
    if (Object.keys(overrides).length > 0) {
      loadOpts.cliOverrides = overrides;
    }
    config = loadConfig(loadOpts);
  } catch (err) {
    process.stderr.write(`fusion serve: failed to load configuration: ${String(err)}\n`);
    process.exit(1);
  }

  // Phase 2 — logger
  const logger = createLogger(config.logLevel);

  logger.info(
    { phase: "config", port: config.port, dataDir: config.dataDir },
    "Boot phase: config — loaded",
  );

  // Phase 2.5 — system registry
  //   Register the stub system so that 'fusion world create --system stub' works
  //   during a live server session (e.g. via the REST API in future milestones).
  const registry = new SystemRegistry();

  try {
    const { stubSystem } = await import("@fusion/system-stub");
    registry.register(stubSystem);
    logger.info({ systems: registry.list() }, "Systems registered");
  } catch (err) {
    logger.warn({ err }, "Could not load @fusion/system-stub — stub system not available");
  }

  // Phase 2.6 — world manager (validates system IDs on world creation)
  const worldManager = new WorldManager({
    dataDir: config.dataDir,
    validSystemIds: registry,
  });

  // Phases 3 + 4 — HTTP boot
  // boot() registers SIGINT/SIGTERM handlers via process.once().
  // We register a synchronous 'exit' hook to close open worlds on any exit path.
  let bootResult;
  try {
    bootResult = await boot({ config, logger });
  } catch (err) {
    logger.fatal({ err }, "Boot failed");
    process.exit(1);
  }

  process.on("exit", () => {
    worldManager.closeAll();
  });

  // Prevent GC of manager and bootResult for the process lifetime.
  void worldManager;
  void bootResult;
}
