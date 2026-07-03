/**
 * HTTP routes for the auto-update control surface (M6/B5 — REQ-DST-019..025).
 *
 * Routes:
 *   GET  /admin/update/check   — on-demand check (also runs non-blockingly
 *                                 at boot — see cli/commands/serve.ts).
 *   POST /admin/update/apply   — download, verify, schedule the swap +
 *                                 graceful shutdown (REQ-DST-022..024).
 *
 * Auth: reuses the real installation-admin Bearer guard from
 * `admin/routes.ts` (`requireAdminAuth`) — same pattern as
 * `tunnel/routes.ts`. Both routes require a valid Bearer once setup has
 * completed; unauthenticated requests get 401 (guard rule doc comment in
 * admin/routes.ts).
 */

import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { requireAdminAuth } from "../admin/routes.js";
import { loadConfig } from "../config.js";
import type { WorldManager } from "../worlds/world-manager.js";
import { checkForUpdate, type UpdateCheckResult } from "./update-checker.js";
import { applyUpdate, type ApplyUpdateResult } from "./updater.js";
import type { UpdateChannel } from "./manifest-client.js";

export interface RegisterUpdateRoutesOptions {
  dataDir: string;
  currentVersion: string;
  /** Live accessor so a channel change via /admin/setup/apply reconfiguration is reflected without a restart. */
  getChannel: () => UpdateChannel;
  getUpdateRepo: () => string | undefined;
  worldManager: WorldManager;
  /** Slugs of worlds currently open in THIS process (REQ-DST-022 backs up "cada world aberto"). */
  getOpenWorldSlugs: () => readonly string[];
  /** argv (excluding node/exe) this process was started with — passed straight to applyUpdate's relaunchArgs. */
  relaunchArgs: readonly string[];
  logger?: Logger;
  /** Test-only overrides forwarded to update-checker/updater. */
  manifestUrl?: string;
  fetchImpl?: typeof fetch;
  isSeaOverride?: boolean;
  /**
   * Called once an apply has been successfully scheduled, right before the
   * route responds — the caller (boot.ts / serve.ts) uses this to trigger a
   * graceful shutdown so the detached swap-helper can complete the rename
   * (see swap-helper.ts's module doc comment step 2).
   */
  onApplyScheduled?: (result: Extract<ApplyUpdateResult, { ok: true }>) => void;
  /**
   * Called whenever a boot-time or on-demand check finds a newer version —
   * the caller (boot.ts) uses this to emit the `server.update_available` WS
   * event to GM sockets (REQ-DST-021).
   */
  onUpdateAvailable?: (result: UpdateCheckResult) => void;
}

export function registerUpdateRoutes(
  fastify: FastifyInstance,
  options: RegisterUpdateRoutesOptions,
): void {
  const {
    dataDir,
    currentVersion,
    getChannel,
    getUpdateRepo,
    worldManager,
    getOpenWorldSlugs,
    relaunchArgs,
    logger,
    manifestUrl,
    fetchImpl,
    isSeaOverride,
    onApplyScheduled,
    onUpdateAvailable,
  } = options;

  const authGuard = requireAdminAuth(dataDir);

  // ---------------------------------------------------------------------
  // GET /admin/update/check — REQ-DST-019/020/021, CA-DST-10
  // ---------------------------------------------------------------------
  fastify.get("/admin/update/check", { preHandler: authGuard }, async (_request, reply) => {
    const checkOptions: Parameters<typeof checkForUpdate>[0] = {
      currentVersion,
      channel: getChannel(),
    };
    const updateRepo = getUpdateRepo();
    if (updateRepo !== undefined) checkOptions.updateRepo = updateRepo;
    if (manifestUrl !== undefined) checkOptions.manifestUrl = manifestUrl;
    if (fetchImpl !== undefined) checkOptions.fetchImpl = fetchImpl;
    if (logger !== undefined) checkOptions.logger = logger;

    const result = await checkForUpdate(checkOptions);

    if (result.checked && result.updateAvailable) {
      onUpdateAvailable?.(result);
    }

    return reply.send({ ok: true, ...result });
  });

  // ---------------------------------------------------------------------
  // POST /admin/update/apply — REQ-DST-022/023/024
  // ---------------------------------------------------------------------
  fastify.post("/admin/update/apply", { preHandler: authGuard }, async (_request, reply) => {
    // FIX-3 (defense in depth, mirrors tunnel/routes.ts's FIX-4): refuse to
    // apply an update while setupCompleted=false. Unlike the tunnel's check,
    // this one is REACHABLE in practice: requireAdminAuth deliberately lets
    // first-run requests through without a Bearer (the setup wizard is the
    // bootstrap — no Admin Key exists yet to authenticate with), which would
    // otherwise let ANY unauthenticated caller on a fresh install trigger a
    // download-and-swap of the server binary before the GM ever completed
    // setup. Config is re-read live (same readLiveConfig rationale as
    // admin/routes.ts) so a mid-flight reconfiguration is honored too.
    const config = loadConfig({ dataDirOverride: dataDir });
    if (!config.setupCompleted) {
      return reply.code(403).send({
        ok: false,
        code: "SETUP_NOT_COMPLETED",
        message: "Cannot apply an update before setup has been completed.",
      });
    }

    const applyOptions: Parameters<typeof applyUpdate>[0] = {
      currentVersion,
      channel: getChannel(),
      openWorldSlugs: getOpenWorldSlugs(),
      worldManager,
      dataDir,
      relaunchArgs: [...relaunchArgs],
    };
    const updateRepo = getUpdateRepo();
    if (updateRepo !== undefined) applyOptions.updateRepo = updateRepo;
    if (manifestUrl !== undefined) applyOptions.manifestUrl = manifestUrl;
    if (fetchImpl !== undefined) applyOptions.fetchImpl = fetchImpl;
    if (logger !== undefined) applyOptions.logger = logger;
    if (isSeaOverride !== undefined) applyOptions.isSeaOverride = isSeaOverride;

    const result = await applyUpdate(applyOptions);

    if (!result.ok) {
      const statusByCode: Record<string, number> = {
        NOT_SEA: 400,
        NO_UPDATE_AVAILABLE: 409,
        MANIFEST_UNAVAILABLE: 502,
        PLATFORM_UNSUPPORTED: 400,
        HASH_MISMATCH: 502,
        DOWNLOAD_FAILED: 502,
        BACKUP_FAILED: 500,
      };
      const status = statusByCode[result.code] ?? 500;
      logger?.error({ code: result.code, message: result.message }, "Update apply failed");
      return reply.code(status).send({ ok: false, code: result.code, message: result.message });
    }

    logger?.info(
      { fromVersion: result.fromVersion, toVersion: result.toVersion },
      "Update scheduled — shutting down for swap",
    );

    // Respond to the GM BEFORE triggering shutdown — onApplyScheduled below
    // may close the HTTP server, which must not race the reply being sent.
    await reply.send({
      ok: true,
      fromVersion: result.fromVersion,
      toVersion: result.toVersion,
      backups: result.backups,
      message: "Update downloaded and verified. The server will restart shortly to apply it.",
    });

    onApplyScheduled?.(result);
  });
}
