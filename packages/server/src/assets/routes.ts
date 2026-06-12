/**
 * Asset HTTP routes for @fusion/server.
 *
 * Implements the storage API described in spec 20-assets-e-midia.md and the
 * security controls from spec 21-seguranca.md (DEC-SEC-06, REQ-SEC-040..045).
 *
 * Routes mounted by this module:
 *
 *   POST   /api/assets/upload     — multipart upload (REQ-AST-006/007/008/011)
 *   POST   /api/assets/token      — issue short-lived asset query-token (serving auth)
 *   GET    /api/assets            — list assets in world scope (REQ-AST-029)
 *   DELETE /api/assets/:name      — delete asset by filename (GM only)
 *   GET    /assets/*              — static serving with path-traversal guard
 *
 * Permissions:
 *   upload  → role >= TRUSTED  (REQ-AST-011 / REQ-AST-029)
 *   token   → role >= PLAYER   (any authenticated user)
 *   list    → role >= TRUSTED  (STORAGE_BROWSE)
 *   delete  → role == GAMEMASTER only (STORAGE_DELETE)
 *   serve   → authenticated (role >= PLAYER), via Bearer or query-token
 *
 * This module does NOT require `sharp` (thumbnail generation is TODO post-MVP).
 *
 * ---------------------------------------------------------------------------
 * TECH DEBT — M1 storage model diverges from spec 20 (to be addressed post-MVP)
 * ---------------------------------------------------------------------------
 *
 * The current M1 implementation is intentionally simplified for a single-world
 * MVP. The following divergences from spec 20 are known and registered here:
 *
 * DEBT-AST-01 (REQ-AST-006): Upload endpoint is at /api/assets/upload instead
 *   of /api/storage/upload; fields `scope` and `path` from the spec are not
 *   accepted. Only world-scope assets are supported.
 *
 * DEBT-AST-02 (REQ-AST-004/005): No `asset_meta` SQLite table with indexed
 *   `digest`/`scope`/`path` columns. Deduplication is done by scanning the
 *   assets directory for the first 8 chars of the SHA-256 hex digest in the
 *   filename (findExistingByDigest). This O(n) scan is acceptable for a world
 *   with ~hundreds of assets but does not scale to thousands or multi-scope.
 *
 * DEBT-AST-03 (REQ-AST-019/DEC-AST-07): Serving URL uses a short 8-char hash
 *   suffix in the filename (`<slug>-<8hex>.<ext>`) rather than a full SHA-256
 *   digest segment in the URL path. Collision probability is negligible for MVP
 *   asset counts but violates the canonical URL scheme in the spec.
 *
 * DEBT-AST-04 (REQ-AST-019): Static serving is handled by a custom Fastify
 *   route instead of @fastify/static. This allows JSON 404s and custom cache
 *   headers, but loses the optimised sendFile / ETag support from the plugin.
 *
 * Resolution path: introduce assets.db (better-sqlite3, separate from world.db)
 *   with an `asset_meta` table, replace directory scan with indexed lookup,
 *   align endpoint paths to spec, and evaluate @fastify/static for serving.
 * ---------------------------------------------------------------------------
 */

import { join as joinPath, resolve as resolvePath, basename } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
  existsSync,
  readFileSync,
} from "node:fs";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import { Role } from "../auth/user-store.js";
import type { UserPublic } from "../auth/user-store.js";
import type { AuthService } from "../auth/service.js";
import { detectType, ALLOWED_TYPES } from "./magic-bytes.js";
import { sanitizeSvg } from "./svg-sanitize.js";
import { buildSafeFilename, sha256Hex } from "./slug.js";
import { guardPath, guardFilename, PathTraversalError } from "./path-guard.js";
import { issueAssetToken, verifyAssetToken } from "./asset-token.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default upload size limit: 20 MB (spec 20 default for images). */
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Fastify request augmentation
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    authUser?: UserPublic;
  }
}

// ---------------------------------------------------------------------------
// RegisterAssetRoutesOptions
// ---------------------------------------------------------------------------

export interface RegisterAssetRoutesOptions {
  /** AuthService for token verification. */
  authService: AuthService;

  /**
   * Absolute path to the world's assets directory.
   * Example: /home/gm/.fusion/worlds/my-world/assets
   */
  assetsDir: string;

  /** Maximum upload size in bytes. Default: 20 MB. */
  maxUploadBytes?: number;

  /**
   * World HMAC secret — used to sign short-lived asset query-tokens
   * (POST /api/assets/token) so PIXI Assets.load() and <img> tags can
   * authenticate without an Authorization header.
   *
   * If omitted, the /api/assets/token endpoint is not registered and
   * GET /assets/* falls back to Bearer-only authentication.
   */
  secret?: Uint8Array;
}

// ---------------------------------------------------------------------------
// Auth helpers (same pattern as auth/routes.ts)
// ---------------------------------------------------------------------------

function buildAuthHelpers(authService: AuthService) {
  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers["authorization"];
    if (!header?.startsWith("Bearer ")) {
      void reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Missing token." });
      return;
    }
    const token = header.slice(7);
    const user = await authService.verifyAccessToken(token);
    if (!user) {
      void reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Invalid token." });
      return;
    }
    request.authUser = user;
  }

  function requireRole(minRole: Role, request: FastifyRequest, reply: FastifyReply): boolean {
    if (!request.authUser || request.authUser.role < minRole) {
      void reply.code(403).send({
        ok: false,
        code: "PERMISSION_DENIED",
        message: `Minimum role required: ${Role[minRole]}.`,
      });
      return false;
    }
    return true;
  }

  return { requireAuth, requireRole };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Inner plugin function (not wrapped in fastify-plugin so it is encapsulated).
 * Registers multipart + all asset routes in its own encapsulated scope.
 *
 * REQ-AST-006: POST /api/assets/upload
 * REQ-AST-019: GET  /assets/* static serving
 * REQ-AST-029: GET  /api/assets  list
 * DELETE /api/assets/:name (GM only)
 */
async function assetPlugin(
  fastify: FastifyInstance,
  options: RegisterAssetRoutesOptions,
): Promise<void> {
  const { authService, assetsDir, maxUploadBytes = DEFAULT_MAX_BYTES, secret } = options;

  // Ensure assets directory exists (REQ-AST-001)
  mkdirSync(assetsDir, { recursive: true });

  const { requireAuth, requireRole } = buildAuthHelpers(authService);

  // Register multipart support scoped to this plugin (limits apply per-request)
  await fastify.register(multipart, {
    limits: {
      fileSize: maxUploadBytes,
      files: 1, // one file per request
    },
  });

  // --------------------------------------------------------------------------
  // POST /api/assets/upload
  // REQ-AST-006 / REQ-AST-007 / REQ-AST-008 / REQ-AST-011
  // --------------------------------------------------------------------------

  fastify.post("/api/assets/upload", { preHandler: requireAuth }, async (request, reply) => {
    // REQ-AST-011: role >= TRUSTED can upload (STORAGE_UPLOAD perm)
    if (!requireRole(Role.TRUSTED, request, reply)) return;

    let data: multipart.MultipartFile | undefined;
    let buf: Buffer;

    try {
      data = await request.file();
      if (!data) {
        return await reply.code(400).send({
          ok: false,
          code: "VALIDATION_FAILED",
          message: "No file attached.",
        });
      }
      // Read the entire buffer — @fastify/multipart throws FST_REQ_FILE_TOO_LARGE
      // when the stream exceeds the fileSize limit configured above.
      buf = await data.toBuffer();
    } catch (err: unknown) {
      // Normalise the multipart size-exceeded error to our API code.
      const code = (err as Record<string, unknown>)["code"];
      if (
        code === "FST_REQ_FILE_TOO_LARGE" ||
        code === "FST_MULTIPART_FILE_SIZE_LIMIT" ||
        (err instanceof Error && err.message.toLowerCase().includes("file too large"))
      ) {
        return reply.code(413).send({
          ok: false,
          code: "FILE_TOO_LARGE",
          message: `Upload exceeds the ${String(maxUploadBytes)} byte limit.`,
        });
      }
      throw err;
    }

    // REQ-AST-008 / REQ-SEC-044: secondary hard size check on the materialised buffer
    if (buf.length > maxUploadBytes) {
      return reply.code(413).send({
        ok: false,
        code: "FILE_TOO_LARGE",
        message: `Upload exceeds the ${String(maxUploadBytes)} byte limit.`,
      });
    }

    // REQ-AST-007 / REQ-SEC-041: validate by magic bytes
    const detected = detectType(buf);
    if (!detected) {
      return reply.code(415).send({
        ok: false,
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: `File type not supported. Allowed types: ${Object.keys(ALLOWED_TYPES).join(", ")}.`,
      });
    }

    // SVG sanitization (REQ-AST-016 / REQ-SEC-035)
    let finalBuf = buf;
    if (detected.mime === "image/svg+xml") {
      const rawSvg = buf.toString("utf8");
      const sanitized = sanitizeSvg(rawSvg);
      finalBuf = Buffer.from(sanitized, "utf8");
    }

    // Compute content hash for deduplication and safe filename
    const digest = sha256Hex(finalBuf);
    const originalName = data.filename || "upload";
    const safeFilename = buildSafeFilename(originalName, detected.ext, digest);

    // REQ-SEC-042 / REQ-AST-003: guard the target path
    let targetPath: string;
    try {
      targetPath = guardPath(assetsDir, safeFilename);
    } catch (err) {
      if (err instanceof PathTraversalError) {
        return reply.code(400).send({
          ok: false,
          code: "PATH_TRAVERSAL",
          message: err.message,
        });
      }
      throw err;
    }

    // REQ-AST-009: deduplication by digest — check if a file with this
    // digest already exists by scanning the directory.
    // For MVP we scan by digest suffix in filename (first 8 chars of hash).
    const existing = findExistingByDigest(assetsDir, digest);
    if (existing) {
      return reply.code(200).send({
        ok: true,
        deduplicated: true,
        path: existing,
        digest,
        mime_type: detected.mime,
        file_size: finalBuf.length,
      });
    }

    // Write file (REQ-SEC-040: new safe name, never original)
    writeFileSync(targetPath, finalBuf);

    return reply.code(201).send({
      ok: true,
      deduplicated: false,
      path: safeFilename,
      digest,
      mime_type: detected.mime,
      file_size: finalBuf.length,
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/assets/token
  // Issue a short-lived query-token for asset serving.
  //
  // PIXI Assets.load() and <img> tags make native GET requests without an
  // Authorization header (the access token lives in JS memory, not cookies).
  // This endpoint allows authenticated clients to obtain a signed token that
  // can be appended as a query parameter to asset URLs:
  //   GET /assets/<name>?at=<token>&ae=<exp>&au=<userId>
  //
  // Token lifetime: ASSET_TOKEN_TTL_MS (5 minutes, see asset-token.ts).
  // Only registered when `secret` is provided in RegisterAssetRoutesOptions.
  // --------------------------------------------------------------------------

  if (secret) {
    fastify.post("/api/assets/token", { preHandler: requireAuth }, async (request, reply) => {
      if (!requireRole(Role.PLAYER, request, reply)) return;

      const userId = request.authUser?.id ?? "";
      const { token, exp } = issueAssetToken(userId, secret);

      return reply.code(200).send({ ok: true, token, exp });
    });
  }

  // --------------------------------------------------------------------------
  // GET /api/assets
  // List assets in the world scope (REQ-AST-029 STORAGE_BROWSE = role >= TRUSTED)
  // --------------------------------------------------------------------------

  fastify.get("/api/assets", { preHandler: requireAuth }, async (request, reply) => {
    if (!requireRole(Role.TRUSTED, request, reply)) return;

    const files = listAssets(assetsDir);
    return reply.send({ ok: true, assets: files });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/assets/:name
  // GM only (STORAGE_DELETE, REQ-AST-029)
  // TODO: verify usage in documents before deletion (REQ-AST-038)
  // --------------------------------------------------------------------------

  fastify.delete("/api/assets/:name", { preHandler: requireAuth }, async (request, reply) => {
    if (!requireRole(Role.GAMEMASTER, request, reply)) return;

    const { name } = request.params as { name: string };

    // Guard filename against traversal (REQ-SEC-042)
    try {
      guardFilename(name);
    } catch (err) {
      if (err instanceof PathTraversalError) {
        return reply.code(400).send({
          ok: false,
          code: "PATH_TRAVERSAL",
          message: err.message,
        });
      }
      throw err;
    }

    let targetPath: string;
    try {
      targetPath = guardPath(assetsDir, name);
    } catch (err) {
      if (err instanceof PathTraversalError) {
        return reply.code(400).send({
          ok: false,
          code: "PATH_TRAVERSAL",
          message: err.message,
        });
      }
      throw err;
    }

    if (!existsSync(targetPath)) {
      return reply.code(404).send({
        ok: false,
        code: "ASSET_NOT_FOUND",
        message: `Asset not found: ${name}`,
      });
    }

    // TODO (REQ-AST-038): check document usage before deletion
    unlinkSync(targetPath);

    return reply.send({ ok: true });
  });

  // --------------------------------------------------------------------------
  // GET /assets/*
  // Static serving with path-traversal guard and cache headers.
  // REQ-AST-019 / REQ-AST-024 / REQ-SEC-042
  //
  // Authentication: Bearer token in Authorization header (used by fetch/XHR)
  // OR short-lived query-token issued by POST /api/assets/token (used by
  // PIXI Assets.load() and <img> tags which cannot set custom headers).
  //
  // Note: we do NOT use @fastify/static here because we want to handle 404 as
  // JSON (REQ-AST-023) and apply custom cache headers based on whether the
  // filename contains a hash.  We stream the file manually.
  // --------------------------------------------------------------------------

  fastify.get("/assets/*", async (request, reply) => {
    // --- Auth: Bearer header (fetch/XHR) OR query-token (PIXI / <img>) ---
    const header = request.headers["authorization"];
    if (header?.startsWith("Bearer ")) {
      // Standard Bearer path — used by fetch/XHR that can set headers
      const token = header.slice(7);
      const user = await authService.verifyAccessToken(token);
      if (!user) {
        return reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Invalid token." });
      }
      request.authUser = user;
    } else if (secret) {
      // Query-token path: ?at=<hmac>&ae=<exp>&au=<userId>
      // Used by PIXI Assets.load() and <img> which cannot set Authorization headers.
      // Token is issued by POST /api/assets/token (ASSET_TOKEN_TTL_MS = 5 min).
      const query = request.query as Record<string, string | undefined>;
      const qt = query["at"];
      const qe = query["ae"];
      const qu = query["au"];

      if (!qt || !qe || !qu) {
        return reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Missing token." });
      }

      const exp = parseInt(qe, 10);
      if (isNaN(exp)) {
        return reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Invalid token." });
      }

      const verifiedUserId = verifyAssetToken(qt, qu, exp, secret);
      if (!verifiedUserId) {
        return reply
          .code(401)
          .send({ ok: false, code: "UNAUTHORIZED", message: "Invalid or expired token." });
      }

      // Token verified — look up user record directly (no access token needed)
      const pub = authService.getUser(verifiedUserId);
      if (!pub || !pub.active) {
        return reply
          .code(401)
          .send({ ok: false, code: "UNAUTHORIZED", message: "User not found or inactive." });
      }
      request.authUser = pub;
    } else {
      return reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Missing token." });
    }

    if (!requireRole(Role.PLAYER, request, reply)) return;

    const wildcard = (request.params as { "*": string })["*"] || "";

    // REQ-SEC-042: guard the requested path
    let resolvedPath: string;
    try {
      resolvedPath = guardPath(assetsDir, wildcard);
    } catch (err) {
      if (err instanceof PathTraversalError) {
        return reply.code(400).send({
          ok: false,
          code: "PATH_TRAVERSAL",
          message: "Invalid asset path.",
        });
      }
      throw err;
    }

    // Block access to dotfiles (.thumbs, .meta, etc.) — REQ-AST-022
    // Use sep-agnostic split so this works on Windows (backslash) and POSIX (slash).
    const rel = resolvedPath.slice(resolvePath(assetsDir).length);
    if (rel.split(/[/\\]/).some((seg) => seg.startsWith("."))) {
      return reply.code(403).send({ ok: false, code: "FORBIDDEN", message: "Access denied." });
    }

    if (!existsSync(resolvedPath)) {
      // REQ-AST-023: 404 as JSON
      return reply.code(404).send({
        ok: false,
        code: "ASSET_NOT_FOUND",
        error: "asset_not_found",
        path: wildcard,
      });
    }

    const stat = statSync(resolvedPath);
    if (!stat.isFile()) {
      return reply.code(404).send({
        ok: false,
        code: "ASSET_NOT_FOUND",
        error: "asset_not_found",
        path: wildcard,
      });
    }

    const filename = basename(resolvedPath);
    const mime = guessMime(filename);

    // REQ-AST-024: X-Content-Type-Options: nosniff
    void reply.header("X-Content-Type-Options", "nosniff");

    // REQ-AST-019 / DEC-AST-06: aggressive cache when hash is in filename
    // The filename format is <slug>-<8hexchars>.<ext> — if the 8-char
    // hex suffix is present we treat the URL as content-addressed.
    if (isContentAddressed(filename)) {
      void reply.header("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      void reply.header("Cache-Control", "public, max-age=3600");
    }

    // Handle Range requests (REQ-AST-020)
    const rangeHeader = request.headers["range"];
    const fileSize = stat.size;

    if (rangeHeader) {
      const parsed = parseRange(rangeHeader, fileSize);
      if (!parsed) {
        void reply.header("Content-Range", `bytes */${String(fileSize)}`);
        return reply.code(416).send({ ok: false, code: "RANGE_NOT_SATISFIABLE" });
      }
      const { start, end } = parsed;
      const chunkSize = end - start + 1;
      const fileContent = readFileSync(resolvedPath);
      const chunk = fileContent.subarray(start, end + 1);

      void reply.header(
        "Content-Range",
        `bytes ${String(start)}-${String(end)}/${String(fileSize)}`,
      );
      void reply.header("Accept-Ranges", "bytes");
      void reply.header("Content-Length", String(chunkSize));
      void reply.header("Content-Type", mime);
      return reply.code(206).send(chunk);
    }

    // Full response
    void reply.header("Accept-Ranges", "bytes");
    void reply.header("Content-Length", String(fileSize));
    void reply.header("Content-Type", mime);
    const fileContent = readFileSync(resolvedPath);
    return reply.code(200).send(fileContent);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scan `dir` for a file whose name contains `digest` as the 8-char hash suffix
 * (format: `<slug>-<8hexchars>.<ext>`).
 *
 * Returns the filename (not full path) on match, or null.
 */
function findExistingByDigest(dir: string, digest: string): string | null {
  const hashPrefix = digest.slice(0, 8);
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      // Match pattern: ends with -<8hex>.<ext>
      if (entry.includes(`-${hashPrefix}`)) return entry;
    }
  } catch {
    // Dir may not exist yet
  }
  return null;
}

/**
 * List all files in `dir` with basic metadata.
 * Returns an array of `{ name, size, mime_type }`.
 */
function listAssets(dir: string): Array<{ name: string; size: number; mime_type: string }> {
  try {
    return readdirSync(dir)
      .filter((f) => !f.startsWith(".")) // skip dotfiles / hidden dirs
      .map((name) => {
        try {
          const s = statSync(joinPath(dir, name));
          return s.isFile() ? { name, size: s.size, mime_type: guessMime(name) } : null;
        } catch {
          return null;
        }
      })
      .filter((x): x is { name: string; size: number; mime_type: string } => x !== null);
  } catch {
    return [];
  }
}

/** Guess MIME type from extension for common asset types. */
function guessMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

/**
 * Check whether a filename follows the content-addressed format:
 * `<slug>-<8hexchars>.<ext>`
 */
function isContentAddressed(filename: string): boolean {
  return /^.+-[0-9a-f]{8}\.[a-z0-9]+$/i.test(filename);
}

/**
 * Parse a `Range: bytes=N-M` header value.
 * Returns `null` on invalid range, or `{ start, end }` on success.
 */
function parseRange(header: string, fileSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const startStr = match[1] ?? "";
  const endStr = match[2] ?? "";

  let start: number;
  let end: number;

  if (startStr === "" && endStr !== "") {
    // Suffix range: bytes=-N (last N bytes)
    const suffixLen = parseInt(endStr, 10);
    start = Math.max(0, fileSize - suffixLen);
    end = fileSize - 1;
  } else if (startStr !== "" && endStr === "") {
    // Open range: bytes=N-
    start = parseInt(startStr, 10);
    end = fileSize - 1;
  } else if (startStr !== "" && endStr !== "") {
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
  } else {
    return null;
  }

  if (isNaN(start) || isNaN(end) || start > end || end >= fileSize || start < 0) {
    return null;
  }

  return { start, end };
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

/**
 * Register asset routes on a Fastify instance.
 *
 * MUST be called BEFORE `fastify.ready()` / `fastify.listen()`.
 * Uses Fastify's plugin encapsulation: `@fastify/multipart` is registered in
 * the scoped sub-context so it never conflicts with other plugins.
 *
 * Usage:
 *   // Option A — via fastify.register (preferred, encapsulated scope)
 *   fastify.register(registerAssetRoutes, options);
 *
 *   // Option B — direct call (also works, defers to plugin queue)
 *   registerAssetRoutes(fastify, options);
 */
export function registerAssetRoutes(
  fastify: FastifyInstance,
  options: RegisterAssetRoutesOptions,
): void {
  // Use Fastify's plugin system so multipart is scoped properly.
  // Do NOT await — Fastify queues plugins and initialises them at ready().
  fastify.register(assetPlugin, options);
}
