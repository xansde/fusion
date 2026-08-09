/**
 * `GET /avatar/*` — serving the avatar acervo (spec 33, REQ-AVT-041/042).
 *
 * The acervo (catalog + atlases + palettes from the pinned `waybuilder-avatar`
 * package) is 58 MB. That is why it gets its own route instead of riding along
 * inside the client build:
 *
 *   the packaged executable is at 134 MB of a 150 MB budget (REQ-DST-046), and
 *   phase 5 of build-release.mjs packs `packages/client/dist` VERBATIM into the
 *   SEA blob. Letting the acervo sit under `dist/avatar/` would produce a ~193 MB
 *   artifact and fail the release build.
 *
 * So the release ships the acervo as a SIDECAR directory next to the executable
 * and this route finds it, in order:
 *
 *   1. `FUSION_AVATAR_DIR` — explicit override (packaging, tests, a shared copy).
 *   2. `<clientDist>/avatar` — a monorepo `pnpm build`, where the Vite plugin
 *      copied it. Nothing to install, dev and prod look the same.
 *   3. `<dir of the executable>/avatar` — the sidecar the release emits.
 *   4. the installed `waybuilder-avatar` package's own `saida/` — a source
 *      checkout serving without a client build.
 *
 * When none exist the route answers 404 with a machine-readable code. That
 * matters: WITHOUT this route the SPA catch-all would answer
 * `/avatar/catalogo.json` with index.html, and the client's JSON parse would
 * fail with a syntax error instead of the honest "acervo indisponível" it knows
 * how to show.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { guardPath, PathTraversalError } from "../assets/path-guard.js";
import { findMonorepoRoot } from "../compendium/service.js";

/** URL prefix. Mirrors AVATAR_BASE in the client's lib/avatar/acervo.ts. */
export const AVATAR_ROUTE_PREFIX = "/avatar";

export interface ResolveAcervoOptions {
  /** Absolute path to packages/client/dist, when the caller already resolved it. */
  clientDistDir?: string | null;
  /** Explicit acervo dir; wins over everything (tests, packaging). */
  override?: string | undefined;
  /** Executable path to look for a sidecar next to. Defaults to process.execPath. */
  execPath?: string;
}

/**
 * The acervo directory, or null when this installation has none.
 *
 * Null is a supported state, not a failure: the avatar is cosmetic, so a server
 * without the acervo serves everything else and the client degrades to "no
 * avatar" (AvatarCorner renders nothing, the creator shows its error).
 */
export function resolveAvatarAcervoDir(options: ResolveAcervoOptions = {}): string | null {
  const explicito = options.override ?? process.env["FUSION_AVATAR_DIR"];
  if (explicito !== undefined && explicito.length > 0) {
    return existsSync(explicito) ? explicito : null;
  }

  if (options.clientDistDir !== undefined && options.clientDistDir !== null) {
    const noDist = joinPath(options.clientDistDir, "avatar");
    if (existsSync(noDist)) return noDist;
  }

  // Sidecar next to the packaged executable. In a dev process execPath is
  // node itself, so this simply does not exist and we fall through.
  const aoLado = joinPath(dirname(options.execPath ?? process.execPath), "avatar");
  if (existsSync(aoLado)) return aoLado;

  // Source checkout: read straight out of the installed package. Resolved from
  // the CLIENT's package.json because `waybuilder-avatar` is the client's
  // dependency — pnpm's strict layout does not expose it to the server.
  const raiz = findMonorepoRoot(dirname(fileURLToPath(import.meta.url)));
  if (raiz !== null) {
    try {
      const require = createRequire(joinPath(raiz, "packages", "client", "package.json"));
      const catalogo = require.resolve("waybuilder-avatar/catalogo.json");
      return dirname(catalogo);
    } catch {
      // not installed — fall through to null
    }
  }

  return null;
}

/** Content types the acervo actually contains. */
function tipoDeConteudo(arquivo: string): string {
  const baixo = arquivo.toLowerCase();
  if (baixo.endsWith(".png")) return "image/png";
  if (baixo.endsWith(".json")) return "application/json; charset=utf-8";
  if (baixo.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

export interface RegisterAvatarRoutesOptions extends ResolveAcervoOptions {
  logger?: Logger;
}

/**
 * Register `GET /avatar/*`.
 *
 * Always registers, even with no acervo on disk: the 404 it then returns is the
 * point (see the module doc). The directory is resolved ONCE at boot — the
 * acervo is immutable per pinned commit, so re-resolving per request would only
 * add syscalls.
 */
export function registerAvatarRoutes(
  fastify: FastifyInstance,
  options: RegisterAvatarRoutesOptions = {},
): void {
  const acervoDir = resolveAvatarAcervoDir(options);

  if (acervoDir === null) {
    options.logger?.warn(
      "avatar acervo not found — /avatar/* will answer 404 and character avatars stay unavailable " +
        "(expected next to the executable as ./avatar, or set FUSION_AVATAR_DIR)",
    );
  } else {
    options.logger?.info({ acervoDir }, "Serving the avatar acervo at /avatar/*");
  }

  fastify.get(`${AVATAR_ROUTE_PREFIX}/*`, (request, reply) => {
    if (acervoDir === null) {
      return reply.code(404).send({ ok: false, code: "AVATAR_ACERVO_MISSING" });
    }

    const wildcard = (request.params as { "*": string })["*"] || "";

    let resolvido: string;
    try {
      resolvido = guardPath(acervoDir, wildcard);
    } catch (err) {
      if (err instanceof PathTraversalError) {
        return reply
          .code(400)
          .send({ ok: false, code: "PATH_TRAVERSAL", message: "Invalid path." });
      }
      throw err;
    }

    if (!existsSync(resolvido) || !statSync(resolvido).isFile()) {
      return reply.code(404).send({ ok: false, code: "NOT_FOUND" });
    }

    void reply.header("X-Content-Type-Options", "nosniff");
    // Immutable per pinned acervo, but the filenames carry no hash — revalidate
    // for a day rather than forever, so bumping the pin cannot serve stale art
    // from a long-lived browser cache.
    void reply.header("Cache-Control", "public, max-age=86400");
    void reply.type(tipoDeConteudo(resolvido));
    return reply.send(readFileSync(resolvido));
  });
}
