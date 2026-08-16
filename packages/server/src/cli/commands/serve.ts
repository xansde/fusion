/**
 * CLI command: fusion serve
 *
 * Boots the full Fusion server with optional CLI overrides.
 * Registers the stub system and wires WorldManager into the boot result's shutdown.
 */

import { join as pathJoin } from "node:path";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import type { ServeArgs } from "../args.js";
import { loadConfig, resolveDataDirForLoad } from "../../config.js";
import type { ServerConfig, LoadConfigOptions } from "../../config.js";
import { createLogger } from "../../logger.js";
import { boot } from "../../boot.js";
import type { BootOptions } from "../../boot.js";
import { SystemRegistry } from "@fusion/system-api";
import { WorldManager } from "../../worlds/index.js";
import { ensureDataDirLayout, DataDirPermissionError } from "../../data-dir.js";
import { TunnelManager } from "../../tunnel/index.js";
import { qrAsciiFor, QrTooLargeError } from "../../tunnel/qr-ascii.js";
import { isRunningAsSea } from "../../update/sea-detect.js";
import { decideAutoOpen, openBrowserBestEffort } from "../auto-open.js";

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
  // Build cliOverrides incrementally — only assign defined fields so that
  // lower-priority layers (env, fusion.json, defaults) are not shadowed.
  const overrides: { port?: number; dataDir?: string; logLevel?: LogLevel } = {};
  let config: ServerConfig;
  let usedLegacyDataDir = false;
  try {
    if (args.port !== undefined) overrides.port = args.port;
    if (args.dataDir !== undefined) overrides.dataDir = args.dataDir;
    if (args.logLevel !== undefined) overrides.logLevel = parseLogLevel(args.logLevel);

    const loadOpts: LoadConfigOptions = {};
    if (Object.keys(overrides).length > 0) {
      loadOpts.cliOverrides = overrides;
    }

    // Resolve the effective data directory the SAME way loadConfig will,
    // BEFORE loadConfig runs — this is the only point where we can still
    // observe whether the legacy ~/.fusion fallback was used (loadConfig
    // itself bakes the already-resolved dataDir back into cliOverrides, so
    // asking again afterwards would always look "explicit").
    usedLegacyDataDir = resolveDataDirForLoad(loadOpts).usedLegacyFallback;

    config = loadConfig(loadOpts);
  } catch (err) {
    process.stderr.write(`fusion serve: failed to load configuration: ${String(err)}\n`);
    process.exit(1);
  }

  // Phase 2 — logger
  // Also writes to <dataDir>/Logs/fusion-<date>.log (REQ-DST layout) so the
  // boot log survives console-window closure/crash — see logger.ts. Safe to
  // pass dataDir here even though ensureDataDirLayout (Phase 2.1) has not
  // run yet: createLogger creates Logs/ itself, idempotently, best-effort.
  const logger = createLogger(config.logLevel, config.dataDir);

  if (args.implicitServe === true) {
    logger.info("No command given — starting server (run with --help for CLI usage)");
  }

  logger.info(
    { phase: "config", port: config.port, dataDir: config.dataDir },
    "Boot phase: config — loaded",
  );

  // Phase 2.1 — data directory layout (REQ-DST-007/008/009/010/038)
  //   Creates Config/, systems/, assets/, backups/, Logs/ if missing;
  //   migrates a legacy root-level fusion.json into Config/; verifies
  //   read/write access, aborting with a clear message on failure.
  try {
    ensureDataDirLayout(config.dataDir, { logger, usedLegacyDataDir });
  } catch (err) {
    if (err instanceof DataDirPermissionError) {
      logger.fatal({ err, dataDir: config.dataDir }, err.message);
      process.stderr.write(`fusion serve: ${err.message}\n`);
    } else {
      logger.fatal({ err, dataDir: config.dataDir }, "Failed to prepare the data directory");
    }
    process.exit(1);
  }

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

  try {
    const { etmosSystem } = await import("@fusion/system-etmos");
    registry.register(etmosSystem);
  } catch (err) {
    logger.warn({ err }, "Could not load @fusion/system-etmos — etmos system not available");
  }

  logger.info({ systems: registry.list() }, "Systems registered");

  // Phase 2.6 — world manager (validates system IDs on world creation)
  const worldManager = new WorldManager({
    dataDir: config.dataDir,
    validSystemIds: registry,
    ...(args.forceSchema === true ? { forceSchema: true } : {}),
  });

  if (args.forceSchema === true) {
    logger.warn(
      "--force-schema: schema mismatches will not stop a world from opening. " +
        "Migrations may be skipped or applied to a schema they were not written for.",
    );
  }

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

  // Phase 2.8 — tunnel (REQ-DST-034, --tunnel)
  //
  // SECURITY (M6 audit FIX-4): refuse --tunnel while setupCompleted=false.
  // A fresh install's /setup wizard is OPEN by design (no Admin Key exists
  // yet to gate it — see admin/routes.ts's guard-rule doc comment), and
  // POST /admin/setup/apply accepts an arbitrary, server-writable `dataDir`
  // from that open wizard. Exposing that combination to the internet via a
  // Cloudflare quick tunnel — mitigated only by the tunnel URL being hard to
  // guess — is an unacceptable attack surface: anyone who found the URL
  // before the GM completed setup could apply() their OWN Admin Key and
  // dataDir, taking over the installation. Local `fusion serve` (no
  // --tunnel) is unaffected — this only blocks the internet-facing case.
  if (args.tunnel === true && !config.setupCompleted) {
    const message =
      "fusion serve --tunnel refused: setup has not been completed on this data " +
      "directory yet. Complete the local setup first: run `fusion serve` " +
      "(without --tunnel) and open /setup from a LAN/localhost browser, then " +
      "re-run with --tunnel.";
    logger.fatal({ dataDir: config.dataDir }, message);
    process.stderr.write(`fusion serve: ${message}\n`);
    process.exit(1);
  }

  //   Created here (before boot()) so its child-process lifecycle can be
  //   wired into shutdown/SIGINT ahead of boot()'s own signal handlers (Node
  //   EventEmitters invoke listeners in registration order — registering our
  //   SIGINT/SIGTERM handlers first guarantees cloudflared is asked to exit
  //   before boot()'s handler starts closing Fastify/sockets and calling
  //   process.exit()). The tunnel itself is only *started* after boot()
  //   succeeds (it forwards to http://localhost:<port>, which must be
  //   listening first) — see below.
  let tunnelManager: TunnelManager | undefined;
  if (args.tunnel === true) {
    tunnelManager = new TunnelManager({ dataDir: config.dataDir, port: config.port, logger });

    const stopTunnel = (): void => {
      if (tunnelManager === undefined) return;
      // stop() is async but signal handlers must not block indefinitely —
      // best-effort: fire it and let the process exit naturally afterwards
      // (boot()'s own SIGINT/SIGTERM handler, registered after this one,
      // still runs and calls process.exit()). killChild() inside stop()
      // sends the kill signal synchronously even though stop() itself
      // resolves asynchronously, so cloudflared reliably receives it before
      // the process exits.
      void tunnelManager.stop();
    };
    process.once("SIGINT", stopTunnel);
    process.once("SIGTERM", stopTunnel);
    // Belt-and-suspenders for non-signal exits (e.g. an uncaught crash path
    // that reaches process.exit() directly): synchronous best-effort kill.
    process.on("exit", () => {
      if (tunnelManager?.isRunning() === true) {
        // stop() is async; on the synchronous 'exit' event we can only fire
        // the kill and not await it, but killChild() itself is synchronous
        // (child_process.kill()), so the signal is still sent reliably.
        void tunnelManager.stop();
      }
    });
  }

  // Phases 3 + 4 + 3b — HTTP + socket boot
  // boot() registers SIGINT/SIGTERM handlers via process.once().
  // We register a synchronous 'exit' hook to close open worlds on any exit path.
  let bootResult;
  try {
    // Build auth + net contexts if we have an open world
    const bootOpts: BootOptions = { config, logger };
    if (tunnelManager !== undefined) {
      bootOpts.tunnelContext = { tunnelManager, dataDir: config.dataDir, logger };
    }

    // M6/B5 (REQ-DST-019..025): always wired, independent of --world — the
    // update check/apply endpoints must be reachable even on a management
    // boot with no world open, mirroring the admin routes (M6/B2) and
    // tunnel routes (M6/B4) pattern. getOpenWorldSlugs reflects only the
    // single world this process may have opened via --world (multi-world
    // per process is [V2] — see design doc §1.3/serve.ts's own worldSlug
    // handling); an empty array is valid (REQ-DST-022's "cada world aberto"
    // then backs up nothing, which is correct for a management-only boot).
    bootOpts.updateContext = {
      dataDir: config.dataDir,
      currentVersion: (await import("@fusion/shared")).FUSION_VERSION,
      getChannel: () => loadConfig({ dataDirOverride: config.dataDir }).updateChannel,
      getUpdateRepo: () => {
        const repo = loadConfig({ dataDirOverride: config.dataDir }).updateRepo;
        return repo.startsWith("REPLACE_ME") ? undefined : repo;
      },
      worldManager,
      getOpenWorldSlugs: () => (worldSlug !== undefined ? [worldSlug] : []),
      relaunchArgs: process.argv.slice(2),
      logger,
    };

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
      // REQ-CBT-012: resolve the world's SystemModule (if its package loaded
      // successfully above) so the socket layer can wire initiative formulas.
      const worldSystemModule = registry.tryGet(worldSystemId);
      bootOpts.netContext = {
        worldId: worldSlug,
        db: openWorldDb,
        secret: authSecret,
        authService: authSvc,
        origin,
        // REQ-CMP-006..012: load committed packs for the world's system over
        // the real boot path so compendium content is available in a live session.
        systemId: worldSystemId,
        ...(worldSystemModule !== undefined ? { systemModule: worldSystemModule } : {}),
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

  // Phase 5 — start the tunnel (REQ-DST-034), now that the HTTP listener is
  // actually up (the tunnel forwards to http://localhost:<port>). Failures
  // here are logged but never fatal — the LAN/local server is fully
  // functional without the tunnel, so a cloudflared download/network hiccup
  // must not take down an otherwise-successful `fusion serve`.
  if (tunnelManager !== undefined) {
    try {
      const tunnelUrl = await tunnelManager.start();
      logger.info(
        { tunnelUrl },
        "Cloudflare quick tunnel is up — server reachable over the internet",
      );
      process.stdout.write(
        `\nShare this server over the internet:\n  ${tunnelUrl}\n\n` +
          "SECURITY WARNING: this server is now reachable by anyone with the link above.\n" +
          "Make sure you set a strong GM Admin Key and review allowedOrigins before sharing it widely.\n\n",
      );
      try {
        process.stdout.write(`${qrAsciiFor(tunnelUrl)}\n\n`);
      } catch (err) {
        if (err instanceof QrTooLargeError) {
          logger.debug({ err }, "Tunnel URL too long to render as an ASCII QR code — URL only");
        } else {
          throw err;
        }
      }
    } catch (err) {
      logger.error(
        { err },
        "Failed to start the Cloudflare tunnel — the server is still reachable on LAN, " +
          "but --tunnel could not expose it to the internet",
      );
    }
  }

  // Phase 6 — first-run auto-open (M6 UX fix, see cli/auto-open.ts doc
  // comment for the full 4-condition gate). Runs after boot succeeds so the
  // HTTP listener is actually up before we try to point a browser at it.
  {
    const autoOpen = decideAutoOpen({
      isSea: await isRunningAsSea(),
      hasWorldFlag: worldSlug !== undefined,
      setupCompleted: config.setupCompleted,
      noOpen: args.noOpen === true,
      isCi: process.env["CI"] !== undefined && process.env["CI"] !== "",
    });

    if (autoOpen) {
      const setupUrl = `http://localhost:${String(config.port)}/setup`;
      logger.info({ setupUrl }, "First run detected — opening the setup wizard in your browser");
      openBrowserBestEffort(setupUrl, (err) => {
        logger.warn(
          { err, setupUrl },
          "Could not auto-open the browser — open the setup wizard URL manually",
        );
      });
    }
  }

  // Prevent GC of manager and bootResult for the process lifetime.
  void worldManager;
  void bootResult;
}
