/**
 * SPA static serving for @fusion/server.
 *
 * REQ-DST-002: the executable must embed/serve the client's static build
 * (`packages/client/dist`). This module registers:
 *
 *   GET /                 → index.html (with the per-request CSP nonce
 *                           injected into the entrypoint <script> tag)
 *   GET /assets-client/*  → hashed build assets (JS/CSS/etc — long-lived
 *                           immutable cache, since Vite content-hashes the
 *                           filenames)
 *   GET /<anything else>  → falls back to index.html for client-side
 *                           routing (SPA deep links), EXCEPT paths that
 *                           belong to the API/asset/health surface, which
 *                           this module deliberately never touches.
 *
 * Route-ordering note: `/assets-client/*` is a distinct prefix from the
 * world's own `/assets/*` route (assets/routes.ts, uploaded GM content) —
 * they must never collide. The client build itself emits ALL of its own
 * asset references (index.html AND the in-bundle Vite dynamic-import
 * preload helper / `__vite__mapDeps`) as `/assets-client/...` because
 * `packages/client/vite.config.ts` sets `build.assetsDir: "assets-client"`.
 * A serve-time HTML rewrite was tried first and rejected: it only touches
 * index.html's markup, but Vite's preload helper resolves lazy-loaded chunk
 * deps (e.g. every game system's character sheet) independently at runtime
 * as `"/" + assetsDir + "/" + filename` — a markup-only rewrite left those
 * requests hitting the world's `/assets/*` route (401) and the dynamic
 * import throwing "Unable to preload CSS". Fixing it at the source
 * (assetsDir) keeps 100% of the build's self-references correct without a
 * serve-time transform, so this module now serves the dist build verbatim.
 *
 * This module intentionally does NOT depend on @fastify/static (no new
 * dependency — see assets/routes.ts DEBT-AST-04 for the same call already
 * made in this codebase) and reuses the existing path-traversal guard.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join as joinPath, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import { guardPath, PathTraversalError } from "../assets/path-guard.js";
import { findMonorepoRoot } from "../compendium/service.js";

// ---------------------------------------------------------------------------
// Fastify request augmentation — per-request CSP nonce (set in boot.ts)
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    /** Per-request base64 nonce for CSP script-src (REQ-SEC-055). */
    cspNonce?: string;
  }
}

// ---------------------------------------------------------------------------
// Dist directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to `packages/client/dist`.
 *
 * Same walk-up strategy as {@link findMonorepoRoot} /
 * `resolveSystemPacksDir` (compendium/service.ts): works whether this module
 * runs from TypeScript source (tests, ts-node) or from compiled `dist/`,
 * because it walks up from *this file's own location* looking for the
 * monorepo marker (`pnpm-workspace.yaml`) rather than assuming a fixed
 * relative depth.
 *
 * @param overrideDir Explicit override (tests / custom layouts). Used
 *   verbatim if provided, existence is NOT checked here (callers check).
 */
export function resolveClientDistDir(overrideDir?: string): string | null {
  if (overrideDir !== undefined && overrideDir.length > 0) {
    return overrideDir;
  }

  // M6/B3 (SEA build): there is no monorepo checkout on disk next to a SEA
  // executable — findMonorepoRoot below would always return null. Inside a
  // SEA process, runtime/sea-entry.ts extracts the embedded client dist to
  // <dataDir>/runtime/<version>/client-dist/ BEFORE boot() runs and records
  // the resulting path in this env var (process-local, never read from
  // outside this process — not a persisted/user-facing config knob).
  const seaClientDist = process.env["FUSION_SEA_CLIENT_DIST"];
  if (seaClientDist !== undefined && seaClientDist.length > 0) {
    return existsSync(seaClientDist) ? seaClientDist : null;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const root = findMonorepoRoot(here);
  if (root === null) return null;

  const distDir = joinPath(root, "packages", "client", "dist");
  return existsSync(distDir) ? distDir : null;
}

// ---------------------------------------------------------------------------
// index.html rendering
// ---------------------------------------------------------------------------

/**
 * Inject the CSP nonce into every entrypoint `<script type="module" ...>`
 * tag emitted by the Vite build (REQ-SEC-055). Vite's build output only
 * ever emits `<script type="module" ...>` (no inline script bodies), so a
 * simple attribute injection is sufficient — this is not parsing/executing
 * untrusted HTML, just tagging our own build output. No asset-path
 * rewriting happens here: the build itself already emits `/assets-client/`
 * references (see the module-level doc comment above) since
 * `build.assetsDir` is set in `packages/client/vite.config.ts`.
 *
 * `rawTemplate` is the UNMODIFIED file content — callers read it once at
 * registration time (see `registerSpaRoutes`) and pass it in on every
 * request, so this function never re-reads the file from disk. Deploying a
 * new build requires a server restart to pick up (the shell's own
 * `Cache-Control: no-cache` header only controls the BROWSER's cache, not
 * this in-process one).
 */
function renderIndexHtml(rawTemplate: string, nonce: string): string {
  return rawTemplate.replace(/<script /g, `<script nonce="${nonce}" `);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface RegisterSpaRoutesOptions {
  /**
   * Absolute path to packages/client/dist. When omitted, resolved via
   * {@link resolveClientDistDir}.
   */
  distDir?: string;
  logger?: Logger;
  /**
   * REQ-DST-011: when provided, called on every request for `/` (root only)
   * to decide whether to redirect to `/setup` instead of serving the app
   * shell. Returns `true` when the first-run wizard has NOT completed yet.
   * A function (not a boolean) so the check is re-evaluated live on every
   * request — setupCompleted can flip to `true` mid-process once the wizard
   * (admin/routes.ts) calls applySetup, without requiring a server restart
   * for `/` to start serving the normal app again. Omitted entirely in
   * contexts that don't have a data dir to check (most existing tests),
   * which preserves the pre-M6/B2 behaviour of always serving the shell.
   */
  isSetupIncomplete?: () => boolean;
}

/**
 * Register SPA static serving + catch-all client-routing fallback.
 *
 * MUST be registered AFTER all API/health/asset routes so Fastify's
 * more-specific routes win; the catch-all here only matches GET requests
 * that were not claimed by any other route. Fastify's find-my-way router
 * matches by specificity regardless of registration order, but registering
 * last keeps route-precedence obvious to future readers.
 *
 * If `packages/client/dist` does not exist (test environments, or a server
 * checkout without a client build), this function logs a warning and
 * registers nothing — the server keeps booting without a SPA (never
 * crashes on a missing build, per the M6/B0 requirement).
 */
export function registerSpaRoutes(
  fastify: FastifyInstance,
  options: RegisterSpaRoutesOptions = {},
): void {
  const resolvedDistDir = resolveClientDistDir(options.distDir);

  if (resolvedDistDir === null) {
    options.logger?.warn(
      "packages/client/dist not found — SPA will not be served (API/health/asset routes remain active)",
    );
    return;
  }

  const indexPath = joinPath(resolvedDistDir, "index.html");
  if (!existsSync(indexPath)) {
    options.logger?.warn(
      { distDir: resolvedDistDir },
      "packages/client/dist exists but has no index.html — SPA will not be served",
    );
    return;
  }

  // Re-bind as a non-null const so closures below (sendIndex, route handlers)
  // capture a `string`, not the `string | null` type of the outer binding —
  // TypeScript's null-narrowing above does not persist into nested function
  // bodies declared later in this scope.
  const distDir: string = resolvedDistDir;

  // Read the raw index.html template ONCE at registration time and keep it
  // in memory for the lifetime of this boot — every request only needs to
  // inject its own per-request nonce (cheap string replace), not re-read
  // and re-parse the file from disk. A new client build requires a server
  // restart to be picked up, which is already true of the process as a
  // whole (registerSpaRoutes runs once during boot).
  const rawIndexTemplate = readFileSync(indexPath, "utf8");

  options.logger?.info({ distDir }, "Serving SPA from packages/client/dist");

  function sendIndex(request: FastifyRequest, reply: FastifyReply): FastifyReply {
    const nonce = request.cspNonce ?? "";
    const html = renderIndexHtml(rawIndexTemplate, nonce);
    void reply.header("Content-Type", "text/html; charset=utf-8");
    // The shell itself must always be revalidated so a new deploy is picked
    // up — only the hashed assets below get long-lived caching.
    void reply.header("Cache-Control", "no-cache");
    return reply.send(html);
  }

  // -------------------------------------------------------------------------
  // GET /assets-client/* — hashed build assets (JS/CSS/images/etc)
  // -------------------------------------------------------------------------
  fastify.get("/assets-client/*", (request, reply) => {
    const wildcard = (request.params as { "*": string })["*"] || "";

    let resolved: string;
    try {
      // Physical dir matches the URL prefix 1:1 — packages/client/vite.config.ts
      // sets build.assetsDir: "assets-client", so the build emits its hashed
      // files directly under dist/assets-client/, not dist/assets/.
      resolved = guardPath(joinPath(distDir, "assets-client"), wildcard);
    } catch (err) {
      if (err instanceof PathTraversalError) {
        return reply
          .code(400)
          .send({ ok: false, code: "PATH_TRAVERSAL", message: "Invalid path." });
      }
      throw err;
    }

    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      return reply.code(404).send({ ok: false, code: "NOT_FOUND" });
    }

    void reply.header("X-Content-Type-Options", "nosniff");
    // Vite content-hashes these filenames — safe to cache forever.
    void reply.header("Cache-Control", "public, max-age=31536000, immutable");
    void reply.type(guessMime(resolved));
    return reply.send(readFileSync(resolved));
  });

  // -------------------------------------------------------------------------
  // GET / — the app shell, UNLESS the first-run wizard has not completed yet
  // (REQ-DST-011), in which case redirect to /setup. Checked live via
  // `isSetupIncomplete()` on every request (see the option's doc comment) —
  // not just once at boot — so completing the wizard immediately unlocks the
  // normal root without a server restart.
  // -------------------------------------------------------------------------
  fastify.get("/", (request, reply) => {
    if (options.isSetupIncomplete?.() === true) {
      return reply.redirect("/setup", 302);
    }
    return sendIndex(request, reply);
  });

  // -------------------------------------------------------------------------
  // Catch-all — SPA client-side routing fallback.
  //
  // Only registered for GET; only reached when no other route matched
  // (Fastify tries all registered routes before this wildcard because
  // find-my-way prioritises static/parametric segments over the generic
  // wildcard). Never intercepts /api/*, /health, /assets/*, or
  // /assets-client/* because those are already registered as their own
  // routes elsewhere and take precedence; this handler additionally
  // double-checks the prefix defensively so route-registration order can
  // never silently break this invariant.
  // -------------------------------------------------------------------------
  fastify.get("/*", (request, reply) => {
    const url = request.raw.url ?? "";
    if (
      url.startsWith("/api/") ||
      url === "/health" ||
      url.startsWith("/assets/") ||
      url.startsWith("/assets-client/") ||
      url.startsWith("/socket.io/")
    ) {
      return reply.code(404).send({ ok: false, code: "NOT_FOUND" });
    }

    // Serve a real static file if the path matches one under dist/ directly
    // (e.g. /favicon.svg) — otherwise fall back to index.html for SPA routing.
    const cleanPath = url.split("?")[0] ?? "/";
    if (cleanPath !== "/") {
      try {
        const resolved = guardPath(distDir, cleanPath.slice(1));
        if (existsSync(resolved) && statSync(resolved).isFile()) {
          void reply.header("X-Content-Type-Options", "nosniff");
          void reply.header("Cache-Control", "public, max-age=3600");
          void reply.type(guessMime(resolved));
          return reply.send(readFileSync(resolved));
        }
      } catch (err) {
        if (!(err instanceof PathTraversalError)) throw err;
        // fall through to SPA index — traversal attempts just get the shell
      }
    }

    return sendIndex(request, reply);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessMime(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".map")) return "application/json; charset=utf-8";
  return resolvePath(filePath).endsWith(".ico") ? "image/x-icon" : "application/octet-stream";
}
