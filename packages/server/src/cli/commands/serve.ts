/**
 * CLI command: fusion serve
 *
 * Boots the full Fusion server with optional CLI overrides.
 * Registers the stub system and wires WorldManager into the boot result's shutdown.
 */

import { join as pathJoin } from "node:path";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import type { ServeArgs } from "../args.js";
import { loadConfig } from "../../config.js";
import type { ServerConfig, LoadConfigOptions } from "../../config.js";
import { createLogger } from "../../logger.js";
import { boot } from "../../boot.js";
import type { BootOptions } from "../../boot.js";
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
  } catch (err) {
    logger.warn({ err }, "Could not load @fusion/system-stub — stub system not available");
  }

  try {
    const { pf2eSystem } = await import("@fusion/system-pf2e");
    registry.register(pf2eSystem);
  } catch (err) {
    logger.warn({ err }, "Could not load @fusion/system-pf2e — pf2e system not available");
  }

  try {
    const { sf2eSystem } = await import("@fusion/system-sf2e");
    registry.register(sf2eSystem);
  } catch (err) {
    logger.warn({ err }, "Could not load @fusion/system-sf2e — sf2e system not available");
  }

  logger.info({ systems: registry.list() }, "Systems registered");

  // Phase 2.6 — world manager (validates system IDs on world creation)
  const worldManager = new WorldManager({
    dataDir: config.dataDir,
    validSystemIds: registry,
  });

  // Phase 2.7 — open world if --world flag was passed (M0-C)
  const worldSlug: string | undefined = args.world;
  let openWorldDb: BetterSqlite3Database | undefined;
  let authSecret: Uint8Array | undefined;
  let openWorldSystemId: string | undefined;
  let openWorldTitle: string | undefined;

  if (worldSlug !== undefined) {
    const slug = worldSlug;
    try {
      const { loadOrCreateSecret } = await import("../../auth/crypto.js");
      authSecret = loadOrCreateSecret(config.dataDir);

      const manifest = worldManager.open(slug);
      const fusionDb = worldManager.getDatabase(slug);
      if (!fusionDb) {
        throw new Error(`World "${slug}" opened but no database handle available`);
      }
      openWorldDb = fusionDb.raw;
      openWorldSystemId = manifest.system;
      openWorldTitle = manifest.title;
      logger.info(
        { worldId: slug, title: manifest.title, system: manifest.system },
        "World opened",
      );
    } catch (err) {
      logger.fatal({ err, worldSlug }, "Failed to open world for serve");
      process.exit(1);
    }
  }

  // Phases 3 + 4 + 3b — HTTP + socket boot
  // boot() registers SIGINT/SIGTERM handlers via process.once().
  // We register a synchronous 'exit' hook to close open worlds on any exit path.
  let bootResult;
  try {
    // Build auth + net contexts if we have an open world
    const bootOpts: BootOptions = { config, logger };

    if (openWorldDb !== undefined && authSecret !== undefined && worldSlug !== undefined) {
      const worldSystemId = openWorldSystemId ?? "stub";
      bootOpts.authContext = {
        worldId: worldSlug,
        worldTitle: openWorldTitle ?? worldSlug,
        worldSystemId,
        db: openWorldDb,
        secret: authSecret,
      };

      const { AuthService } = await import("../../auth/index.js");
      const authSvc = new AuthService(openWorldDb, authSecret, worldSlug);
      const origin = `http://${config.host}:${String(config.port)}`;
      bootOpts.netContext = {
        worldId: worldSlug,
        db: openWorldDb,
        secret: authSecret,
        authService: authSvc,
        origin,
        // REQ-CMP-006..012: load committed packs for the world's system over
        // the real boot path so compendium content is available in a live session.
        systemId: worldSystemId,
      };

      // REQ-AST-006..029: register asset routes for the open world.
      // Assets are stored under <dataDir>/worlds/<worldSlug>/assets/.
      // The secret enables short-lived asset query-tokens for PIXI / <img> loading.
      bootOpts.assetContext = {
        authService: authSvc,
        assetsDir: pathJoin(config.dataDir, "worlds", worldSlug, "assets"),
        secret: authSecret,
      };
    }

    bootResult = await boot(bootOpts);
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
