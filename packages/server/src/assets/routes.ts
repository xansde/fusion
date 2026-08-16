/**
 * Asset HTTP routes for @fusion/server.
 *
 * Implements the storage API described in spec 20-assets-e-midia.md and the
 * security controls from spec 21-seguranca.md (DEC-SEC-06, REQ-SEC-040..045).
 *
 * Routes mounted by this module:
 *
 *   POST   /api/assets/upload     — multipart upload (REQ-AST-006/007/008/011)
 *   POST   /api/assets/token      — issue short-lived BROWSE-scope grant
 *   POST   /api/assets/grant      — issue DOC-scope grants for one document (T025)
 *   GET    /api/assets            — list assets in world scope (REQ-AST-029)
 *   DELETE /api/assets/:name      — delete asset by filename (GM only)
 *   GET    /assets/*              — static serving with path-traversal guard
 *
 * Permissions:
 *   upload  → role >= TRUSTED  (REQ-AST-011 / REQ-AST-029)
 *   token   → role >= PLAYER   (any authenticated user)
 *   grant   → role >= PLAYER, then per-document visibility (see below)
 *   list    → role >= TRUSTED  (STORAGE_BROWSE)
 *   delete  → role == GAMEMASTER only (STORAGE_DELETE)
 *   serve   → a DOC grant for this exact name, OR role >= TRUSTED
 *
 * ---------------------------------------------------------------------------
 * T025 — WHAT `GET /assets/*` USED TO BE, AND WHY IT CHANGED
 * ---------------------------------------------------------------------------
 *
 * Until T025 this route authenticated and stopped there: any valid Bearer with
 * role >= PLAYER received the bytes of ANY file under the world's assets
 * directory, without ever naming a document. Reproduced with `curl` and an
 * ordinary player's access token: the background of a scene that was not on air
 * came back 200 with its bytes. The `<img>`/PIXI query-token path was the same
 * hole with a different credential.
 *
 * The rule now is: bytes are served only when the request carries a credential
 * THIS SERVER SIGNED for exactly this canonical name and this user — and it
 * signs one only after reading the document itself, confirming the user sees it
 * by the same computation that builds the join snapshot, and taking the name
 * out of a known asset-bearing FIELD of the already-redacted body. Everything
 * else is a 404 identical to the one a missing file produces.
 *
 * Two carve-outs, both narrow and both stated: a role that may already LIST
 * every filename (`BROWSE_MIN_ROLE`) keeps the name-less browse credential, and
 * `grantEnforce` can put the whole gate in shadow mode (log, do not refuse) for
 * one rollout session.
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
 *   PARTIALLY ADDRESSED (T020/T021, migration 009): a lightweight `assets`
 *   table now records name/digest/bytes/mime/uploader for every accepted
 *   upload, via `assets/asset-store.ts`. The *dedup lookup* above still scans
 *   the directory, unchanged — the table is a registry, not (yet) the source
 *   the upload route consults to decide whether a file already exists.
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
import type { Database } from "better-sqlite3";
import multipart from "@fastify/multipart";
import { Role } from "../auth/user-store.js";
import type { UserPublic } from "../auth/user-store.js";
import type { AuthService } from "../auth/service.js";
import { detectType, ALLOWED_TYPES } from "./magic-bytes.js";
import { sanitizeSvg } from "./svg-sanitize.js";
import { buildSafeFilename, sha256Hex } from "./slug.js";
import { guardPath, guardFilename, PathTraversalError } from "./path-guard.js";
import { recordAsset, deleteAssetRecord, getAssetRecord } from "./asset-store.js";
import { canonicalizeAssetName } from "./asset-name.js";
import { ASSET_GRANT_TTL_MS, issueBrowseGrant, signDocGrant, verifyGrant } from "./asset-grant.js";
import { projectAssetFields, projectedAssetRefs } from "./asset-fields.js";
import { assetRefToStorageName } from "./reconcile.js";
import {
  redactSceneDocsForNonPrivileged,
  stripHiddenCombatantsFromCombat,
  redactActorDocsForViewer,
  buildContactViewer,
} from "../net/redaction.js";
import type { ContactKnowledgeSource, CharacterOwnershipRow } from "../net/redaction.js";
import { PLAYER_CHARACTER_SUBTYPES } from "../documents/knowledge.js";
import { getOwnershipFromDoc } from "../net/handlers/sync-handlers.js";
import { OwnershipLevel, isRolePrivileged, resolveOwnership } from "../documents/ownership.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default upload size limit: 20 MB (spec 20 default for images). */
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Tables `POST /api/assets/grant` will read a document from.
 *
 * An allowlist of its OWN — never `DOCUMENT_TABLES` (which contains `users`,
 * `settings` and `chat_messages`) and never the generic table discovery
 * `reconcile.ts` does. Anything not in here is a 400, with no default branch to
 * fall through: "a table I do not recognise" must be a refusal, not a guess.
 *
 * Excluded on purpose, each for a stated reason:
 *   users          — `users.avatar` IS a real bearer, but it lives in a COLUMN
 *                    rather than in `data` (002_users_sessions.ts:34) and no UI
 *                    reads it today. No policy here until someone decides one.
 *   settings       — no bearer, no use case.
 *   chat_messages  — `chat_messages.sound` is a real bearer (spec 38), and
 *                    those files are being edited by another front. Out of
 *                    scope, declared, not forgotten.
 *
 * `region_maps` IS here even though it is absent from `DOCUMENT_TABLES`: it is
 * the only surface in the real world whose ownership reaches a player
 * (`{"default":2}`), so leaving it out would blank the map on the table.
 */
export const GRANTABLE_TABLES: ReadonlySet<string> = new Set([
  "actors",
  "items",
  "scenes",
  "journal_entries",
  "macros",
  "roll_tables",
  "playlists",
  "folders",
  "combats",
  "region_maps",
]);

/**
 * Minimum role a name-less (`browse`) grant authorises on `GET /assets/*`.
 *
 * TRUSTED, deliberately equal to the threshold `GET /api/assets` already
 * applies to LISTING the world's files: a role that may enumerate every
 * filename is not additionally protected by having to name a document before
 * reading one. Raising the listing threshold is a product decision the design
 * explicitly defers to a later PR — do not silently pre-empt it here by moving
 * this constant.
 */
const BROWSE_MIN_ROLE: Role = Role.TRUSTED;

/**
 * Refusal reason for a name that must never be signed, or `null` when the name
 * is clean. Checked at MINT time, on the storage name (i.e. after
 * `assetRefToStorageName` has undone the percent-encoding).
 *
 * Refused, never sanitised. A sanitiser turns an attacker-chosen string into a
 * different attacker-chosen string and signs THAT — the whole point of this
 * design is that the server signs only names it recognises as well-formed.
 *
 * Reachability of each case is not theoretical: `/assets/a.jpg%00b.jpg` stored
 * in a bearer field survives the projection and comes out of
 * `assetRefToStorageName` with a real 0x00 inside it (measured).
 *
 * The BACKSLASH case is the one the adversarial review found: this used to split
 * on `/` alone, so `..\..\world.db` was a single segment that is neither `.` nor
 * `..`, passed hygiene, and got SIGNED. No bytes escaped — `guardPath` refuses
 * it on the way out (verified) — but this module's own contract says a name that
 * needs repairing is never signed, and the second line of defence was the only
 * line. The GM's server runs on Windows, where `\` IS the separator.
 */
function assetNameRefusalReason(storageName: string): string | null {
  if (storageName.length === 0) return "empty";
  if (/[\u0000-\u001f]/.test(storageName)) return "control_character";
  // Refused outright, exactly like `guardPath` (path-guard.ts:79) — a stored
  // asset name is POSIX-separated, so a `\` inside one is never a directory
  // boundary this server should be reasoning about.
  if (storageName.includes("\\")) return "backslash";
  for (const segment of storageName.split("/")) {
    if (segment.length === 0) return "empty_segment";
    if (segment === "." || segment === "..") return "dot_segment";
  }
  return null;
}

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
   * World database — used to register each accepted upload in the `assets`
   * table (T020/T021, migration 009). Optional: when omitted, uploads and
   * serving work exactly as before, just without a registry row. This keeps
   * the option backward-compatible for callers that do not (yet) pass a
   * database — registry rows for files uploaded that way are backfilled by
   * T022's reconciliation, the same as any other pre-existing file.
   */
  db?: Database;

  /**
   * World HMAC secret — used to sign short-lived asset query-tokens
   * (POST /api/assets/token) so PIXI Assets.load() and <img> tags can
   * authenticate without an Authorization header.
   *
   * If omitted, the /api/assets/token endpoint is not registered and
   * GET /assets/* falls back to Bearer-only authentication.
   */
  secret?: Uint8Array;

  /**
   * Whether the T025 asset-grant gate on `GET /assets/*` actually REFUSES, or
   * only reports what it would have refused.
   *
   * `false` (the default) is the SHADOW mode from the design's rollout section:
   * the gate runs in full, logs every request it would have turned into a 404,
   * and then serves the bytes anyway. `true` makes the refusal real.
   *
   * Default `false`, and the reason is not timidity:
   *
   *   - The gate is only half of the mechanism. Bytes stop flowing to a PLAYER
   *     the moment it enforces, and they start flowing again only once the
   *     CLIENT mints a per-document grant for every image it paints. Those two
   *     halves are being written separately; a `true` default turns any gap
   *     between them — a consumer nobody remembered, a deploy where one side
   *     lags — into a black map on a live table, which is the exact failure the
   *     two rejected designs were rejected for.
   *   - The design's migration plan asks for one real session in shadow mode
   *     with the log read afterwards, precisely because the projection of
   *     asset-bearing fields is the newest and least-exercised piece here
   *     (the whole real world contains TWO populated bearer paths). The log is
   *     how that gets evidence instead of confidence.
   *   - Flipping it later is a one-line change with that evidence in hand; the
   *     hole it closes is one this PR does not widen.
   *
   * When omitted, `ASSET_GRANT_ENFORCE` from the environment decides: `1` or
   * `true` (case-insensitive) enforce, anything else — including unset —
   * shadows. An explicit option always wins over the environment, so tests are
   * deterministic without mutating `process.env`.
   */
  grantEnforce?: boolean;
}

/** Resolve the enforcement mode: explicit option, else env, else shadow. */
function resolveGrantEnforce(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  const raw = process.env["ASSET_GRANT_ENFORCE"]?.trim().toLowerCase();
  return raw === "1" || raw === "true";
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
  const { authService, assetsDir, maxUploadBytes = DEFAULT_MAX_BYTES, secret, db } = options;
  const grantEnforce = resolveGrantEnforce(options.grantEnforce);

  // Ensure assets directory exists (REQ-AST-001)
  mkdirSync(assetsDir, { recursive: true });

  // ONE line at boot, not one per request. The per-request `warn` in the serve
  // route is unreadable during a session and invisible before one starts, so
  // the state the server is actually running in has to be stated where a human
  // looks: at startup. `boot.ts` does not pass `grantEnforce`, so unless the
  // operator exports ASSET_GRANT_ENFORCE this is the line that will be printed,
  // and the hole T025 exists to close is still open behind it.
  if (!grantEnforce) {
    fastify.log.warn(
      { enforce: false, env: "ASSET_GRANT_ENFORCE" },
      "ASSET GRANT GATE IS IN SHADOW MODE: GET /assets/* still serves any file to any " +
        "role >= PLAYER, exactly as before T025. Refusals are only logged. " +
        "Set ASSET_GRANT_ENFORCE=1 to make the gate real.",
    );
  }

  /**
   * Register `name` in the `assets` table (T020/T021), best-effort.
   *
   * Never lets a registry failure turn into an error response: the file is
   * already written to disk (the source of truth for serving) by the time
   * this runs, so failing the request here would report an upload failure
   * for a file that in fact exists and is servable — a worse, harder to
   * debug state than "the file exists but T022's reconciliation has to pick
   * up its registry row later", which is the same gap every pre-existing
   * asset already starts in.
   */
  function registerUpload(
    request: FastifyRequest,
    name: string,
    digest: string,
    bytes: number,
    mimeType: string,
  ): void {
    if (!db) return;
    try {
      recordAsset(db, {
        name,
        digest,
        bytes,
        mimeType,
        uploadedBy: request.authUser?.id ?? null,
      });
    } catch (err) {
      request.log.warn(
        { err, name },
        "Failed to register asset in the assets table; file is on disk and servable, " +
          "registry row will be backfilled by reconciliation.",
      );
    }
  }

  /**
   * Register a file that is already on disk, reading its metadata from the
   * file itself. Used by the dedup branch of the upload route, where the
   * request body is NOT evidence about the stored file (see the call site).
   *
   * Does nothing when the row already exists: the stored file has not changed,
   * so there is nothing to learn, and re-reading it on every duplicate upload
   * would spend I/O to confirm what is already recorded.
   */
  function registerExistingIfUnknown(request: FastifyRequest, name: string): void {
    if (!db) return;
    try {
      if (getAssetRecord(db, name) !== undefined) return;
      const filePath = joinPath(assetsDir, name);
      const buf = readFileSync(filePath);
      recordAsset(db, {
        name,
        digest: sha256Hex(buf),
        bytes: buf.length,
        mimeType: guessMime(name),
        uploadedBy: null, // unknown: whoever wrote this file did not register it
      });
    } catch (err) {
      request.log.warn(
        { err, name },
        "Failed to backfill the registry row for an already-stored asset; the file is " +
          "servable and reconciliation will pick it up.",
      );
    }
  }

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
      // Backfill a row for the matched file if it has none — a previous upload
      // whose registration failed, or a file that predates the registry.
      //
      // The metadata comes from the file ON DISK, never from the upload that
      // matched it. `findExistingByDigest` matches on an 8-hex substring of
      // the name: 32 bits, and a substring rather than a suffix. A match is
      // evidence of a likely duplicate, not proof the bytes are identical —
      // so describing the stored file with the incoming file's digest, size
      // and mime would be writing a plausible lie into the registry, and the
      // upsert would overwrite a row that was right.
      registerExistingIfUnknown(request, existing);
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

    // T020/T021: register the row after the file is safely on disk — never
    // before (see registerUpload's doc comment for why a registry failure
    // must not turn into a reported upload failure).
    registerUpload(request, safeFilename, digest, finalBuf.length, detected.mime);

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
  // Issue a short-lived BROWSE-scope grant for asset serving.
  //
  // PIXI Assets.load() and <img> tags make native GET requests without an
  // Authorization header (the access token lives in JS memory, not cookies).
  // This endpoint allows authenticated clients to obtain a signed token that
  // can be appended as a query parameter to asset URLs:
  //   GET /assets/<name>?at=<token>&ae=<exp>&au=<userId>
  //
  // T025: the token this issues carries no asset name, so on GET /assets/* it
  // only authorises `BROWSE_MIN_ROLE` and above — the file picker's grid, where
  // one token has to serve N thumbnails the user is choosing BETWEEN and no
  // document references any of them yet. A PLAYER may still mint one (the
  // endpoint's threshold is unchanged); it simply will not open anything, and
  // the client is expected to use POST /api/assets/grant instead.
  //
  // Token lifetime: ASSET_GRANT_TTL_MS (5 minutes).
  // Only registered when `secret` is provided in RegisterAssetRoutesOptions.
  // --------------------------------------------------------------------------

  if (secret) {
    fastify.post("/api/assets/token", { preHandler: requireAuth }, async (request, reply) => {
      if (!requireRole(Role.PLAYER, request, reply)) return;

      const userId = request.authUser?.id ?? "";
      const { token, exp } = issueBrowseGrant(userId, secret);

      return reply.code(200).send({ ok: true, token, exp, scope: "browse" });
    });
  }

  // --------------------------------------------------------------------------
  // POST /api/assets/grant                                              (T025)
  //
  // Issue one short-lived DOC-scope grant per asset name a document legitimately
  // carries, for the calling user.
  //
  // Request body: { table, id } — a LOOKUP KEY. The client never sends content:
  // every string that ends up signed is one this handler read out of the
  // database itself, out of a field it recognises, from a body already put
  // through the same redaction the join snapshot applies.
  //
  // Order of operations, and none of them is optional:
  //   1. requireAuth
  //   2. this endpoint's own table allowlist                     -> 400
  //   3. read the row (raw SQL, see readGrantableDocument)       -> 404
  //   4. visibility for THIS user, by table                      -> 404
  //   5. project the asset-bearing fields of the REDACTED body
  //   6. name hygiene on every extracted name  -> the BAD NAME is skipped and
  //      logged; the document is still answered with the names that passed
  //   7. canonicalise, then sign one HMAC per name
  //
  // A missing document and a document this user may not see answer with the
  // SAME 404. A 403 here would be an oracle: it confirms the id exists.
  // --------------------------------------------------------------------------

  if (secret && db) {
    const grantDb = db;
    const grantSecret = secret;

    fastify.post("/api/assets/grant", { preHandler: requireAuth }, async (request, reply) => {
      const user = request.authUser;
      if (!user) return; // requireAuth already answered

      // The single 404 body. Built once so "not found" and "not visible" cannot
      // drift apart into two distinguishable answers.
      const notFound = (): FastifyReply =>
        reply.code(404).send({
          ok: false,
          code: "NOT_FOUND",
          message: "Document not found.",
        });

      const body: unknown = request.body;
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return reply.code(400).send({
          ok: false,
          code: "VALIDATION_FAILED",
          message: "Body must be an object: { table, id }.",
        });
      }

      const table = (body as Record<string, unknown>)["table"];
      const id = (body as Record<string, unknown>)["id"];

      if (typeof table !== "string" || typeof id !== "string" || id.length === 0) {
        return reply.code(400).send({
          ok: false,
          code: "VALIDATION_FAILED",
          message: "Both `table` and `id` are required and must be non-empty strings.",
        });
      }

      // Steps 2..7 live in `grantableAssetNames` so that the pre-merge dry-run
      // (`scripts/asset-grant-dryrun.ts`) can ask "what would this user be able
      // to load?" by calling THIS function rather than by re-enacting its
      // sequence. A dry-run that re-implements the gate measures the re-
      // implementation, and the whole point of the dry-run is to be believed.
      // Built per request, not per process: it caches ONE read of the Actor
      // table for the duration of this mint, and a long-lived cache would go
      // stale exactly when it matters (a character created or re-owned mid
      // session decides who is a stranger to which contact).
      const outcome = grantableAssetNames(
        grantDb,
        table,
        id,
        user.id,
        user.role,
        contactKnowledgeSourceFromDb(grantDb),
      );

      // No default branch: a table this endpoint does not name is refused, not
      // guessed at. (Refused BEFORE the read, inside `grantableAssetNames`, so
      // an unknown table never reaches an interpolated SQL identifier.)
      if (outcome.status === "unknown_table") {
        return reply.code(400).send({
          ok: false,
          code: "VALIDATION_FAILED",
          message: "Unknown or non-grantable table.",
        });
      }

      if (outcome.status === "not_found") return notFound();

      if (outcome.skipped.length > 0) {
        // Reported, never signed, and never fatal to the document: see the
        // denial-of-service note on `grantableAssetNames`.
        request.log.warn(
          { table, id, skipped: outcome.skipped },
          "Skipped asset names that failed hygiene; the rest of the document was still signed.",
        );
      }

      const exp = Date.now() + ASSET_GRANT_TTL_MS;
      const grants: Record<string, string> = {};
      for (const name of outcome.names) {
        grants[name] = signDocGrant(user.id, exp, name, grantSecret);
      }

      // A document with no bearer field populated is not an error: `grants` is
      // simply empty, and the client paints nothing. Folders always land here.
      return reply.code(200).send({ ok: true, exp, grants });
    });
  } else {
    fastify.log.warn(
      "POST /api/assets/grant is NOT registered (no world secret and/or no database handle). " +
        "Every non-privileged client will be unable to load images once ASSET_GRANT_ENFORCE is on.",
    );
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

    // T020/T021: drop the registry row along with the file. Best-effort, same
    // reasoning as registerUpload — the file is already gone from disk by the
    // time this runs, so a registry error here must not turn a successful
    // deletion into a reported failure (that would tell the caller a file
    // still exists when it does not).
    if (db) {
      try {
        deleteAssetRecord(db, name);
      } catch (err) {
        request.log.warn(
          { err, name },
          "Failed to remove asset registry row after deleting the file from disk.",
        );
      }
    }

    return reply.send({ ok: true });
  });

  // --------------------------------------------------------------------------
  // GET /assets/*
  // Static serving with authorisation, path-traversal guard and cache headers.
  // REQ-AST-019 / REQ-AST-024 / REQ-SEC-042 / T025
  //
  // IDENTITY: Bearer token in the Authorization header (fetch/XHR) OR the
  //   `au`/`at`/`ae` query trio (PIXI Assets.load() and <img>, which cannot set
  //   headers). The trio only establishes identity when one of the two grant
  //   HMACs verifies — `au` is attacker-supplied text until a signature vouches
  //   for it. Nothing verifiable at all is a 401, exactly as before.
  //
  // AUTHORISATION (this is what T025 added): a DOC grant for THIS canonical
  //   name and THIS user, or a role at/above BROWSE_MIN_ROLE. Anything else is
  //   the uniform 404 — the same status, body and headers a missing file
  //   produces, emitted BEFORE `existsSync` so the pair cannot be told apart.
  //
  // Note: we do NOT use @fastify/static here because we want to handle 404 as
  // JSON (REQ-AST-023) and apply custom cache headers based on whether the
  // filename contains a hash.  We stream the file manually.
  // --------------------------------------------------------------------------

  fastify.get("/assets/*", async (request, reply) => {
    const wildcard = (request.params as { "*": string })["*"] || "";

    // The canonical key, computed ONCE and by the SAME function the mint used
    // (asset-name.ts). Everything below decides about this string.
    const canonicalName = canonicalizeAssetName(wildcard);

    /**
     * The one 404 body of this route.
     *
     * "You may not read this" and "this does not exist" must be the same answer
     * down to the byte — same status, same JSON, same (absence of) headers —
     * and it must be produced BEFORE `existsSync`, or the timing and the header
     * set become an existence oracle for any name the caller can guess. This is
     * the same body the missing-file branch further down sends (REQ-AST-023).
     */
    const notFound = (): FastifyReply =>
      reply.code(404).send({
        ok: false,
        code: "ASSET_NOT_FOUND",
        error: "asset_not_found",
        path: wildcard,
      });

    // --- Identity: Bearer header (fetch/XHR) OR the query trio (PIXI / <img>) ---
    //
    // A query trio only establishes identity if one of the two HMACs verifies:
    // `au` is attacker-controlled text until a signature vouches for it.
    const query = request.query as Record<string, string | undefined>;
    const qToken = query["at"];
    const qExp = query["ae"];
    const qUser = query["au"];
    const parsedExp = qExp === undefined ? Number.NaN : Number.parseInt(qExp, 10);

    let user: UserPublic;
    /** True when a DOC-scope grant for exactly `canonicalName` was presented. */
    let docGrantValid = false;

    const header = request.headers["authorization"];
    if (header?.startsWith("Bearer ")) {
      // Standard Bearer path — used by fetch/XHR that can set headers.
      const verified = await authService.verifyAccessToken(header.slice(7));
      if (!verified) {
        return reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Invalid token." });
      }
      user = verified;

      // A Bearer request MAY still carry a grant (the client can pass both).
      // The grant is honoured only for the user it was issued to: serving A the
      // file B was entitled to would be exactly the confusion this replaces.
      if (secret && qToken !== undefined && qUser === user.id && !Number.isNaN(parsedExp)) {
        docGrantValid = verifyGrant({
          scope: "doc",
          token: qToken,
          userId: qUser,
          exp: parsedExp,
          name: canonicalName,
          secret,
        });
      }
    } else if (secret) {
      // Query-token path: ?at=<hmac>&ae=<exp>&au=<userId>
      // Used by PIXI Assets.load() and <img>, which cannot set headers.
      if (qToken === undefined || qExp === undefined || qUser === undefined) {
        return reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Missing token." });
      }
      if (Number.isNaN(parsedExp)) {
        return reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Invalid token." });
      }

      docGrantValid = verifyGrant({
        scope: "doc",
        token: qToken,
        userId: qUser,
        exp: parsedExp,
        name: canonicalName,
        secret,
      });
      const browseGrantValid =
        docGrantValid ||
        verifyGrant({ scope: "browse", token: qToken, userId: qUser, exp: parsedExp, secret });

      if (!docGrantValid && !browseGrantValid) {
        // Nothing vouches for `au`, so there is no identity to speak of — the
        // same 401 an expired or forged token has always produced, and it says
        // nothing about the requested name.
        return reply
          .code(401)
          .send({ ok: false, code: "UNAUTHORIZED", message: "Invalid or expired token." });
      }

      const pub = authService.getUser(qUser);
      if (!pub || !pub.active) {
        return reply
          .code(401)
          .send({ ok: false, code: "UNAUTHORIZED", message: "User not found or inactive." });
      }
      user = pub;
    } else {
      return reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Missing token." });
    }

    request.authUser = user;

    // --- Authorisation (T025) -------------------------------------------------
    //
    // Before this, a valid Bearer of ANY role >= PLAYER opened ANY file on the
    // GM's disk, without naming a document — the reproduced hole this closes.
    //
    // Two ways through, and no third:
    //   1. a DOC grant this server signed for this user AND this exact
    //      canonical name (POST /api/assets/grant);
    //   2. a role that may already LIST every filename in the world
    //      (BROWSE_MIN_ROLE), for which per-name gating protects nothing.
    //
    // NOTE the two things this block does NOT do: it never touches a document
    // table (the mint already decided; this is one HMAC recomputation), and it
    // never compares the request against a LIST supplied by the requester.
    const authorised = docGrantValid || user.role >= BROWSE_MIN_ROLE;
    if (!authorised) {
      request.log.warn(
        {
          userId: user.id,
          role: user.role,
          name: canonicalName,
          enforce: grantEnforce,
          hadGrant: qToken !== undefined,
        },
        grantEnforce
          ? "Refused an asset request with no grant for this name."
          : "SHADOW MODE: would refuse this asset request (no grant for this name); serving it anyway.",
      );
      if (grantEnforce) return notFound();
    }

    // REQ-SEC-042: guard the requested path.
    //
    // The CANONICAL name is what gets opened, not the raw wildcard: the file
    // served has to be the file that was authorised, and `canonicalName` is the
    // string the grant was checked against. (`guardPath` normalises anyway, so
    // this changes no outcome today — it removes the possibility of a future
    // divergence between "what I checked" and "what I opened".)
    let resolvedPath: string;
    try {
      resolvedPath = guardPath(assetsDir, canonicalName);
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

    // REQ-AST-023: 404 as JSON — and byte-identical to the refusal above, by
    // construction: both go through `notFound()`.
    if (!existsSync(resolvedPath)) return notFound();

    const stat = statSync(resolvedPath);
    if (!stat.isFile()) return notFound();

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
 * Read one row's `data` blob out of a GRANTABLE table and parse it (T025).
 *
 * Raw SQL rather than `DocumentStore.get()`, deliberately, and this is the
 * single place the choice is made:
 *
 *   - `DocumentStore.get()` IS this query. Its body is
 *     `SELECT data FROM <table> WHERE id = ?` + `JSON.parse` (documents/
 *     store.ts) — there is no validation, derivation or normalisation to lose
 *     by not going through it.
 *   - `region_maps` is NOT in `DOCUMENT_TABLES`, so the store would THROW for
 *     the one table in the real world whose ownership actually reaches a
 *     player. Having a "normal" path plus a special case for it means two
 *     readers, and the special case is where a future edit forgets the gate.
 *   - Nothing here needs a `DocumentStore` handle otherwise, and asking the
 *     asset routes to hold one so they can re-run a SELECT is a dependency
 *     bought for nothing.
 *
 * `table` is interpolated into the SQL because SQLite does not bind
 * identifiers. That is safe here and ONLY here because the caller has already
 * matched it against {@link GRANTABLE_TABLES} — a closed set of literals. Do
 * not call this with a table name that has not been through that gate.
 *
 * Returns `null` for a missing row, an unreadable/absent table, or a `data`
 * blob that does not parse into an object: all of them are answered as "not
 * found", which is also the answer for "not visible".
 */
function readGrantableDocument(
  db: Database,
  table: string,
  id: string,
): Record<string, unknown> | null {
  let row: { data: unknown } | undefined;
  try {
    row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
      | { data: unknown }
      | undefined;
  } catch {
    // Table absent on this world's schema version (region_maps predates some
    // migrations) — indistinguishable from "no such document", on purpose.
    return null;
  }
  if (row === undefined) return null;

  const raw = row.data;
  const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : null;
  if (text === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * The body of `doc` this user is entitled to see, or `null` when they are not
 * entitled to see it at all (T025).
 *
 * Every branch here reuses a decision that ALREADY exists elsewhere in the
 * server. That is the whole point: the grant must not invent a second notion of
 * visibility, because two notions drift and the one that drifts open serves a
 * file the snapshot would never have shown the document for.
 *
 *   scenes      `redactSceneDocsForNonPrivileged` (net/redaction.ts) — it
 *               already composes `sceneIsOnAir` + `stripHiddenTokens` +
 *               `redactSecretDoors`. Called as the function, never recomposed
 *               from its three predicates. An off-air scene comes back as an
 *               empty array, i.e. `null` here (REQ-CEN-071/072/073).
 *   combats     always visible — the encounter is shared world state
 *               (REQ-CBT-031 carve-out, same as `buildSnapshot`) — but the
 *               hidden combatants come off BEFORE anything is projected, or a
 *               player would sign the portrait of a combatant he must not know
 *               exists.
 *   actors      `redactActorDocsForViewer` (net/redaction.ts, spec 39) — the
 *               SAME funnel every Actor emission goes through, and the only
 *               place the rule is written. See the long note below.
 *   everything  `resolveOwnership(...) >= LIMITED`, the SAME threshold
 *   else        `buildSnapshot` uses (sync-handlers.ts). Not OBSERVER: a
 *               rejected design invented a higher floor than the rest of the
 *               server uses and made shared portraits disappear.
 *
 * ---------------------------------------------------------------------------
 * WHY `actors` IS NOT `resolveOwnership` (both directions were wrong)
 * ---------------------------------------------------------------------------
 *
 * The first cut of this function gated Actors on `ownership >= LIMITED` and
 * registered the contact-knowledge redaction as a KNOWN GAP. The adversarial
 * review proved that gap ran BOTH ways, and one of them was a new leak:
 *
 *   TOO OPEN — a contact the viewer merely GLIMPSED reaches him through
 *     `glimpsedContactView` with no name and no `img` at all (REQ-CTT-081), and
 *     a contact whose state is HIDDEN is dropped outright (REQ-CTT-082). Gating
 *     on ownership alone signed the portrait of both. Proved by execution: a
 *     glimpsed `npc` with `{"default":2}` answered
 *     `200 {"grants":{"retrato-do-vilao.png":"…"}}`, and the file came back 200.
 *     A filename is usually the slug of the NPC, so the MINT ALONE identified
 *     the "unidentified" — and this channel did not exist before T025 (the
 *     snapshot strips `img`; `GET /api/assets` needs TRUSTED). A gate that opens
 *     a channel the thing it replaces did not have is not a gate.
 *
 *   TOO CLOSED — `redactActorDocsForViewer` delivers TWO populations that
 *     ownership says nothing about: every player CHARACTER, unconditionally
 *     (`actorEscapingKnowledgeIsVisible`, REQ-CTT-014/020), and a contact the
 *     viewer has IDENTIFIED, whose gate is knowledge per contact×character
 *     (spec 39), not ownership. Both arrive at the client with `img` in the
 *     body — the live/replay paths (doc-handlers.ts:1871, sync-handlers.ts:205)
 *     apply this funnel and NO ownership filter. Refusing to sign what the
 *     client legitimately received buys nothing (it already has the filename)
 *     and blanks the "Na mesa" and "Conhecidos" rows of the contacts drawer.
 *
 * Both disappear by using the funnel itself, which is also what this repo's
 * CLAUDE.md requires: never duplicate a visibility predicate. The cost is one
 * `listCharacterOwnership()` read per mint, and it is paid only for `actors` and
 * only for a non-privileged caller.
 */
function visibleGrantBody(
  table: string,
  doc: Record<string, unknown>,
  userId: string,
  // Plain `number`, not `Role`: `Role` (auth/user-store.ts) and `UserRole`
  // (documents/ownership.ts) are two separate numeric enums that happen to
  // declare the same members, and TypeScript refuses to assign one to the
  // other. Taking the number is how every other consumer of `resolveOwnership`
  // does it (sync-handlers.ts), and the test suite pins the four values against
  // each other ("Role and UserRole still agree numerically").
  role: number,
  /**
   * Where the Actor branch reads the world's player characters from. Optional
   * so the pure function stays testable, and FAIL-CLOSED when absent: with no
   * source the viewer owns no character, and owning no character resolves every
   * contact to `hidden` (`buildContactViewer`, REQ-CTT-071). A missing source
   * therefore delivers less, never more.
   */
  knowledge?: ContactKnowledgeSource,
): Record<string, unknown> | null {
  const privileged = isRolePrivileged(role);

  if (table === "scenes") {
    if (privileged) return doc;
    const [redacted] = redactSceneDocsForNonPrivileged([doc]);
    return redacted ?? null;
  }

  if (table === "combats") {
    return privileged ? doc : stripHiddenCombatantsFromCombat(doc);
  }

  if (privileged) return doc;

  if (table === "actors") {
    // The whole rule, in one call. `documents[0]` is the body this viewer is
    // owed — the full document, `stripKnowledgeMap`-ed, or the anonymous
    // `glimpsedContactView` (which carries no `img`, so the projection below
    // finds nothing to sign). An empty array is "you are owed nothing", which
    // is the same 404 a missing row produces.
    const viewer = buildContactViewer(knowledge, userId, role);
    return redactActorDocsForViewer([doc], viewer).documents[0] ?? null;
  }

  const level = resolveOwnership(getOwnershipFromDoc(doc), userId, role);
  return level >= OwnershipLevel.LIMITED ? doc : null;
}

/**
 * A {@link ContactKnowledgeSource} backed by the raw `actors` table (T025).
 *
 * The canonical source is `contactKnowledgeSourceFromStore`, which needs a
 * `DocumentStore`; the asset routes hold a `Database` and nothing else, and
 * asking them to carry a store so they can run one SELECT is a dependency
 * bought for nothing (the same argument {@link readGrantableDocument} makes).
 *
 * What it MUST keep identical to the store version is the notion of "a player
 * character", which is the system's word and not the engine's — hence the same
 * `PLAYER_CHARACTER_SUBTYPES` set, imported, never a `type = 'character'`
 * literal in the SQL. An Etmos world answers with its `orador`s here exactly as
 * it does on the socket paths.
 *
 * Read lazily and at most once per mint: the closure caches its own answer, so
 * a document with forty bearer fields still scans the table once, and a mint for
 * a table that is not `actors` never scans it at all.
 */
export function contactKnowledgeSourceFromDb(db: Database): ContactKnowledgeSource {
  let cached: readonly CharacterOwnershipRow[] | undefined;
  return {
    listCharacterOwnership(): readonly CharacterOwnershipRow[] {
      if (cached !== undefined) return cached;
      const rows: CharacterOwnershipRow[] = [];
      try {
        const raw = db.prepare(`SELECT id, data FROM actors`).all() as Array<{
          id: unknown;
          data: unknown;
        }>;
        for (const row of raw) {
          if (typeof row.id !== "string") continue;
          const text =
            typeof row.data === "string"
              ? row.data
              : Buffer.isBuffer(row.data)
                ? row.data.toString("utf8")
                : null;
          if (text === null) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            continue;
          }
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
          const doc = parsed as Record<string, unknown>;
          const type = doc["type"];
          if (typeof type !== "string" || !PLAYER_CHARACTER_SUBTYPES.has(type)) continue;
          rows.push({ id: row.id, ownership: doc["ownership"] });
        }
      } catch {
        // No `actors` table on this world's schema version. Fail closed: an
        // empty list means the viewer owns no character, which resolves every
        // contact to `hidden`.
      }
      cached = rows;
      return cached;
    },
  };
}

/**
 * Outcome of {@link grantableAssetNames}. `unknown_table` and `not_found` are
 * separate members even though the endpoint answers them with different status
 * codes (400 vs 404) — the caller decides how to speak, this function only
 * decides what is true.
 */
export type GrantableAssetNamesOutcome =
  | { status: "ok"; names: string[]; skipped: RefusedAssetRef[] }
  | { status: "unknown_table" }
  | { status: "not_found" };

/** One reference the mint refused to sign, and why. Logged, never signed. */
export interface RefusedAssetRef {
  ref: string;
  refusal: string;
}

/**
 * The exact set of asset names `POST /api/assets/grant` would sign for
 * `userId`/`role` against `table`/`id` — minus the signing itself (T025).
 *
 * This is the mint, factored out of the HTTP handler so that a SECOND caller
 * can ask the same question without re-enacting the sequence:
 * `scripts/asset-grant-dryrun.ts` runs it over every row of a copy of a real
 * `world.db` to produce, before the merge, the literal list of files each
 * player stops being able to fetch. That list is only worth reading if it comes
 * out of the code that will actually run — a dry-run holding its own copy of
 * the pipeline would keep agreeing with itself while the route drifted away
 * from it.
 *
 * Order matters and none of it is optional:
 *   1. the endpoint's own table allowlist  — before any SQL, because `table` is
 *      interpolated into the statement (see {@link readGrantableDocument});
 *   2. read the row;
 *   3. visibility for THIS viewer ({@link visibleGrantBody}) — a missing row
 *      and an invisible one are the same answer, on purpose;
 *   4. project the asset-bearing fields of the REDACTED body, never the raw one,
 *      and read the references out of the projected VALUES rather than out of
 *      its text ({@link projectedAssetRefs}) — that anchoring is what makes
 *      "one bearer field, at most one grant" structural;
 *   5. name hygiene PER NAME: a reference that fails is skipped and reported,
 *      the rest of the document is still signed.
 *
 * Step 5 used to refuse the WHOLE document with a 400, and that was a denial of
 * service with a player's name on it. `scenes.tokens[].texture` is a bearer
 * field a PLAYER can write on a scene he does not own (see `asset-fields.ts`),
 * so ONE poisoned token — `x//y.png` is enough — turned every mint of the scene
 * on air into a 400 for EVERY player, i.e. a black map on the table, until the
 * GM found and deleted the token. Proved by execution with two players, and
 * silent for the GM, whose browse credential keeps working.
 *
 * Refusing the whole document bought nothing in exchange: the poisoned name was
 * never going to be signed either way. Skipping it costs exactly the image that
 * name pointed at — which is the fail-closed direction this module wants — and
 * the warning still names the document, so a legitimately broken reference is
 * still visible in the log.
 *
 * `db` is only ever read from.
 */
export function grantableAssetNames(
  db: Database,
  table: string,
  id: string,
  userId: string,
  role: number,
  knowledge?: ContactKnowledgeSource,
): GrantableAssetNamesOutcome {
  if (!GRANTABLE_TABLES.has(table)) return { status: "unknown_table" };

  const doc = readGrantableDocument(db, table, id);
  if (doc === null) return { status: "not_found" };

  const visible = visibleGrantBody(table, doc, userId, role, knowledge);
  if (visible === null) return { status: "not_found" };

  const projection = projectAssetFields(table, visible);
  const refs = projectedAssetRefs(projection);

  const names: string[] = [];
  const skipped: RefusedAssetRef[] = [];
  for (const ref of refs) {
    const storageName = assetRefToStorageName(ref);
    const refusal = assetNameRefusalReason(storageName);
    if (refusal !== null) {
      skipped.push({ ref, refusal });
      continue;
    }
    names.push(canonicalizeAssetName(storageName));
  }

  return { status: "ok", names, skipped };
}

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
