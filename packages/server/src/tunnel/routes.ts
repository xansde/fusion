/**
 * HTTP routes for the tunnel control surface (M6/B4 — REQ-DST-034).
 *
 * Route:
 *   POST /admin/network/tunnel   — { action: "start" | "stop" }
 *
 * `GET /admin/network` itself is owned by M6/B2 (packages/server/src/admin/routes.ts)
 * — it already returns the agreed `AdminNetworkResponse` envelope with a
 * `tunnel: { enabled, url, provider } | null` field. This module does NOT
 * re-register that GET route (that would collide); instead, `boot.ts` wires
 * `TunnelManager.getPublicState` into `registerAdminRoutes`'s
 * `getTunnelState` option so the B2 route reflects live tunnel state. See
 * `tunnelStateToAdminNetwork` below for the exact mapping.
 *
 * Auth: reuses the real installation-admin Bearer guard from
 * `admin/routes.ts` (`requireAdminAuth`) — the same Argon2id Admin Key +
 * jwtHmacSecret-signed session token B2 implemented for REQ-DST-012/015A.
 * No placeholder guard here; B2 landed before this route was wired into
 * boot.ts, so there is no "swap me later" debt for this route.
 *
 * SECURITY (M6 audit FIX-4, defense in depth): {action:"start"} additionally
 * refuses with 403 while setupCompleted=false, mirroring the CLI-level
 * refusal of `fusion serve --tunnel` itself (cli/commands/serve.ts). This
 * route already requires a valid Bearer, which is impossible to obtain
 * before setup ever completes (no Admin Key exists yet) — so in practice
 * this path is unreachable via the HTTP API alone. It exists purely as
 * defense in depth in case some future caller (or a race during a
 * multi-step reconfiguration) ever reaches this handler with a stale/valid
 * token from a PRIOR completed setup while a NEW setupCompleted=false state
 * is in flight (e.g. an in-progress data-dir move re-bootstrap).
 */

import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { requireAdminAuth } from "../admin/routes.js";
import { loadConfig } from "../config.js";
import type { TunnelManager, TunnelState } from "./tunnel-manager.js";

export interface RegisterTunnelRoutesOptions {
  tunnelManager: TunnelManager;
  /** Data directory this boot is running from — passed straight to requireAdminAuth. */
  dataDir: string;
  logger?: Logger;
  /**
   * Called whenever the tunnel state changes, so the caller can forward a WS
   * event to the GM (e.g. `server.tunnel_status`). Optional — routes work
   * standalone without it.
   */
  onStateChange?: (state: TunnelState) => void;
}

/** Maps internal TunnelState to the `tunnel` field of B2's AdminNetworkResponse. */
export function tunnelStateToAdminNetwork(state: TunnelState): {
  enabled: boolean;
  url: string | null;
  provider: "cloudflared";
} {
  return {
    enabled: state.status === "running" || state.status === "starting",
    url: state.tunnelUrl ?? null,
    provider: "cloudflared",
  };
}

export function registerTunnelRoutes(
  fastify: FastifyInstance,
  options: RegisterTunnelRoutesOptions,
): void {
  const { tunnelManager, dataDir, logger, onStateChange } = options;
  const authGuard = requireAdminAuth(dataDir);

  if (onStateChange !== undefined) {
    tunnelManager.onStateChange(onStateChange);
  }

  fastify.post<{ Body: { action?: string } | undefined }>(
    "/admin/network/tunnel",
    { preHandler: authGuard },
    async (request, reply) => {
      // FIX-5: a request with no body at all (e.g. no Content-Type, or an
      // empty POST) leaves request.body as `undefined` — reading `.action`
      // off it directly threw a TypeError that surfaced as a raw 500
      // instead of a typed 400. Optional chaining makes "no body" collapse
      // into the same "missing action" validation path as `{}`.
      const action = request.body?.action;

      if (action === "start") {
        // FIX-4 (defense in depth): see module doc comment above for why
        // this is normally unreachable (the Bearer guard above already
        // implies setupCompleted=true in the common case) but is still
        // checked explicitly rather than assumed.
        const config = loadConfig({ dataDirOverride: dataDir });
        if (!config.setupCompleted) {
          await reply.code(403).send({
            ok: false,
            code: "SETUP_NOT_COMPLETED",
            message: "Cannot start the tunnel before setup has been completed.",
          });
          return;
        }

        try {
          await tunnelManager.start();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger?.error({ err }, "Failed to start tunnel");
          await reply.code(502).send({ ok: false, code: "TUNNEL_START_FAILED", message });
          return;
        }
        await reply.send({ ok: true, ...tunnelStateToAdminNetwork(tunnelManager.getState()) });
        return;
      }

      if (action === "stop") {
        await tunnelManager.stop();
        await reply.send({ ok: true, ...tunnelStateToAdminNetwork(tunnelManager.getState()) });
        return;
      }

      await reply.code(400).send({
        ok: false,
        code: "VALIDATION_ERROR",
        message: 'Body must be {"action":"start"} or {"action":"stop"}.',
      });
    },
  );
}
