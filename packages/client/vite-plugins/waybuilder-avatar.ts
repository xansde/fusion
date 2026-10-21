/**
 * Vite plugin that publishes the `waybuilder-avatar` acervo under `/avatar/*`.
 *
 * The acervo (catalog + atlases + palettes, 22 MB across 643 PNGs) ships
 * inside the npm package, pinned to a commit in packages/client/package.json.
 * The client fetches it at RUNTIME (`/avatar/catalogo.json`, `/avatar/atlas/...`)
 * rather than importing it — a 1.7 MB JSON import would land inside a JS chunk,
 * and the atlas paths only become known after the catalog is parsed.
 *
 * Three delivery paths, one source of truth (the package's own `saida/`):
 *
 *   dev / preview → middleware streams files straight out of node_modules.
 *                   No copy, so bumping the pinned commit takes effect on the
 *                   next request instead of after a manual sync step.
 *   build         → `closeBundle` copies `saida/` into `dist/avatar/`.
 *
 * The build copy is what makes the packaged executable work: the release
 * pipeline (tools/release/build-release.mjs, phase 5) packs
 * `packages/client/dist` verbatim into the SEA blob, so anything under
 * `dist/avatar/` is embedded and served by spa/routes.ts with no server-side
 * route and no new dependency.
 *
 * Deliberately NOT `public/`: that would require either vendoring 2.8k binary
 * files into git or a copy step before every `vite dev`.
 */

import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize, resolve, sep } from "node:path";
import type { Connect, Plugin } from "vite";

/** URL prefix the client fetches from. Kept in sync with lib/avatar/acervo.ts. */
export const AVATAR_URL_PREFIX = "/avatar/";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

/**
 * Absolute path to the installed package's `saida/` directory.
 *
 * Resolved through the package's own `exports` map (`./catalogo.json`) instead
 * of a hand-built `node_modules/...` path — pnpm's content-addressed store puts
 * the real directory under `.pnpm/<hash>/`, which no literal path would find.
 */
export function resolveAcervoDir(from: string = import.meta.url): string {
  const require = createRequire(from);
  return dirname(require.resolve("waybuilder-avatar/catalogo.json"));
}

/**
 * Map a request URL to a file inside the acervo, or null if it escapes it.
 *
 * Pure and exported so the traversal guard is testable without a dev server:
 * `/avatar/../../.env` and encoded variants must all come back null.
 */
export function resolveAcervoFile(acervoDir: string, url: string): string | null {
  const [pathOnly] = url.split(/[?#]/, 1);
  if (pathOnly === undefined || !pathOnly.startsWith(AVATAR_URL_PREFIX)) return null;

  let rel: string;
  try {
    rel = decodeURIComponent(pathOnly.slice(AVATAR_URL_PREFIX.length));
  } catch {
    return null; // malformed percent-encoding
  }
  if (rel.length === 0 || rel.includes("\0")) return null;

  const full = resolve(acervoDir, normalize(rel));
  const root = resolve(acervoDir) + sep;
  if (!full.startsWith(root)) return null;
  return full;
}

function contentTypeOf(file: string): string {
  const dot = file.lastIndexOf(".");
  const ext = dot === -1 ? "" : file.slice(dot).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export function waybuilderAvatar(): Plugin {
  let acervoDir: string | null = null;
  let outDir = "dist";

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url;
    if (url === undefined || !url.startsWith(AVATAR_URL_PREFIX) || acervoDir === null) {
      next();
      return;
    }

    const file = resolveAcervoFile(acervoDir, url);
    if (file === null || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end("avatar asset not found");
      return;
    }

    res.setHeader("Content-Type", contentTypeOf(file));
    // The acervo is immutable per pinned commit, but dev bumps the pin without
    // a filename change — so no long-lived cache here. Production gets its
    // caching from the SPA route that serves dist/.
    res.setHeader("Cache-Control", "no-cache");
    createReadStream(file).pipe(res);
  };

  return {
    name: "fusion:waybuilder-avatar",

    configResolved(config) {
      outDir = config.build.outDir;
      try {
        acervoDir = resolveAcervoDir();
      } catch {
        acervoDir = null;
        config.logger.warn(
          "[avatar] waybuilder-avatar não resolvido — o criador de avatar ficará sem acervo. " +
            "Rode `pnpm install --filter @fusion/client`.",
        );
      }
    },

    configureServer(server) {
      server.middlewares.use(middleware);
    },

    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },

    closeBundle() {
      if (acervoDir === null) return;
      const target = join(resolve(outDir), "avatar");
      cpSync(acervoDir, target, { recursive: true });
      this.info(`acervo do avatar copiado para ${target}`);
    },
  };
}
