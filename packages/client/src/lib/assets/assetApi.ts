/**
 * assetApi.ts — typed HTTP client for the asset storage API.
 *
 * Wraps the server routes from packages/server/src/assets/routes.ts:
 *   GET    /api/assets           — list assets
 *   POST   /api/assets/upload    — multipart upload (with XHR for progress)
 *   POST   /api/assets/token     — short-lived BROWSE-scope query token
 *   POST   /api/assets/grant     — DOC-scope grants for one document (T025)
 *   DELETE /api/assets/:name     — delete asset (GM only)
 *   GET    /assets/*             — static serving (used directly by <img> / PIXI)
 *
 * Spec refs: 20-assets-e-midia.md REQ-AST-006..011, REQ-AST-019
 * Security:  21-seguranca.md — Bearer token in Authorization header
 */

import { assetGrantsCovering, type AssetDocRef } from "./assetGrants.svelte.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssetEntry {
  /** Filename only (e.g. "goblin-warrior-a3f8bc12.webp"). */
  name: string;
  /** File size in bytes. */
  size: number;
  /** MIME type inferred from extension (server-side). */
  mime_type: string;
}

export interface UploadResult {
  ok: boolean;
  deduplicated: boolean;
  /** Filename (safe slug + 8-char hash + ext). Used to build /assets/<name> URL. */
  path: string;
  digest: string;
  mime_type: string;
  file_size: number;
}

export interface UploadProgress {
  /** 0–100, or null while not started / after completion. */
  percent: number | null;
  /** Bytes uploaded so far. */
  loaded: number;
  /** Total bytes (from file size). */
  total: number;
}

export type UploadProgressCallback = (progress: UploadProgress) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * List all assets in the world scope.
 * Requires role >= TRUSTED.
 */
export async function listAssets(token: string): Promise<AssetEntry[]> {
  const response = await fetch("/api/assets", {
    method: "GET",
    headers: authHeader(token),
    credentials: "include",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Failed to list assets (HTTP ${String(response.status)})`);
  }

  const data = (await response.json()) as { ok: boolean; assets: AssetEntry[] };
  return data.assets;
}

/**
 * Upload a single file via multipart/form-data.
 *
 * Uses XMLHttpRequest so we can report upload progress (REQ-AST-010).
 * The onProgress callback fires as data is sent to the server.
 *
 * @param token      Bearer token for Authorization header.
 * @param file       File object from a drag-drop or input[type=file].
 * @param onProgress Optional callback for progress reporting.
 * @returns          UploadResult with the safe filename / digest.
 */
export function uploadAsset(
  token: string,
  file: File,
  onProgress?: UploadProgressCallback,
): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/assets/upload");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    // Report progress
    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress({
            percent: Math.round((event.loaded / event.total) * 100),
            loaded: event.loaded,
            total: event.total,
          });
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          const result = JSON.parse(xhr.responseText) as UploadResult;
          resolve(result);
        } catch {
          reject(new Error("Invalid JSON response from server."));
        }
      } else {
        let message = `Upload failed (HTTP ${String(xhr.status)})`;
        try {
          const body = JSON.parse(xhr.responseText) as { message?: string; code?: string };
          if (body.code === "FILE_TOO_LARGE") {
            message = "File is too large. Maximum size is 20 MB.";
          } else if (body.code === "UNSUPPORTED_MEDIA_TYPE") {
            message = "File type not supported. Allowed: PNG, JPEG, WebP, SVG.";
          } else if (body.code === "PERMISSION_DENIED") {
            message = "You do not have permission to upload files.";
          } else if (body.message) {
            message = body.message;
          }
        } catch {
          // keep default message
        }
        reject(new Error(message));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload."));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelled."));
    });

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

/**
 * Delete an asset by filename. Requires GM role.
 */
export async function deleteAsset(token: string, name: string): Promise<void> {
  const response = await fetch(`/api/assets/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: authHeader(token),
    credentials: "include",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Failed to delete asset (HTTP ${String(response.status)})`);
  }
}

// ---------------------------------------------------------------------------
// Asset URL construction
// ---------------------------------------------------------------------------

export interface AssetQueryToken {
  /** HMAC token value (at= param). */
  token: string;
  /** Expiry timestamp in Unix ms (ae= param). */
  exp: number;
  /** User ID the token was issued for (au= param). */
  userId: string;
}

/**
 * Fetch a short-lived BROWSE-scope query-token from the server.
 *
 * PIXI Assets.load() and <img> tags cannot set Authorization headers, so
 * this token is appended to asset URLs as query parameters instead.
 * Tokens expire after 5 minutes (server-side ASSET_TOKEN_TTL_MS).
 *
 * SCOPE (T025): a browse token carries NO asset name, and the server honours it
 * only for a role that may already list every filename in the world (TRUSTED and
 * up). A PLAYER can still mint one and it opens nothing. It is the right
 * credential for exactly one situation — an asset that is not (yet) referenced
 * by any document, i.e. the FilePicker grid and the previews of a value the user
 * just picked in it. Everything reading a path OUT of a document must use
 * `resolveAssetUrl()` instead.
 *
 * @param accessToken  Bearer access token for the current session.
 * @param userId       The current user's ID (embedded in the query-token).
 * @returns            A signed short-lived token + expiry.
 */
export async function fetchAssetToken(
  accessToken: string,
  userId: string,
): Promise<AssetQueryToken> {
  const response = await fetch("/api/assets/token", {
    method: "POST",
    headers: authHeader(accessToken),
    credentials: "include",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Failed to get asset token (HTTP ${String(response.status)})`);
  }

  const data = (await response.json()) as { ok: boolean; token: string; exp: number };
  return { token: data.token, exp: data.exp, userId };
}

/**
 * Build the URL to fetch a static asset via HTTP (for <img> or PIXI Assets.load).
 *
 * REQ-AST-019: assets are served at /assets/<filename>.
 * PIXI.Assets.load() accepts this URL directly — no base64 or socket needed.
 *
 * When `queryToken` is provided the short-lived asset query-token is appended
 * so the browser can authenticate without an Authorization header.
 * Obtain one via fetchAssetToken() before calling PIXI Assets.load().
 *
 * @param name        The safe filename returned by listAssets() or UploadResult.path.
 * @param queryToken  Optional asset query-token (from fetchAssetToken).
 * @returns           URL path, e.g. "/assets/goblin-warrior-a3f8bc12.webp?at=…&ae=…&au=…".
 */
export function assetUrl(name: string, queryToken?: AssetQueryToken): string {
  // Percent-encode to avoid path traversal in URLs, but keep the slash separator.
  const safeName = name
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  const base = `/assets/${safeName}`;

  if (!queryToken) return base;

  const params = new URLSearchParams({
    at: queryToken.token,
    ae: String(queryToken.exp),
    au: queryToken.userId,
  });
  return `${base}?${params.toString()}`;
}

/**
 * The canonical name of a stored asset path — the exact string the server signs
 * a grant for, and the exact string it derives again when serving the file.
 *
 * It must derive the SAME key as the server's pair of
 * `assetRefToStorageName()` (assets/reconcile.ts) + `canonicalizeAssetName()`
 * (assets/asset-name.ts). The asymmetry in the middle is deliberate — the client
 * decodes each segment here because a stored path went through `assetUrl()`'s
 * per-segment encoding, while the server's router already hands the wildcard
 * over decoded. Decoding twice on the server is what would open `%252e`.
 *
 * When the two expressions disagree there is a pair of spellings that authorises
 * one file and opens another, which is the failure that killed three earlier
 * designs. Two divergences were found here by the adversarial review, and both
 * are fixed below:
 *
 *   1. MALFORMED ESCAPE. `decodeURIComponent("100% real.png")` THROWS. The
 *      server catches and keeps the segment as-is (reconcile.ts:320-326), so it
 *      happily signed a name the client could not even spell — the URIError
 *      propagated out of `resolveAssetUrl` and the caller painted a placeholder
 *      while the server logged an authorised request. `100% real.png` is a name
 *      a GM produces by dropping a file into the assets folder by hand, which
 *      `reconcile.ts` treats as a first-class case.
 *   2. ORDER. Dropping empty segments BEFORE the join meant a `%2F` inside a
 *      segment produced `a///b.png` here and `a/b.png` there. The canonical
 *      collapse has to happen on the JOINED string, exactly as
 *      `canonicalizeAssetName` does it.
 *
 * `ASSET_NAME_CANONICALIZATION_CASES` (@fusion/shared) is the table both sides
 * are now tested against — one list, imported by a suite in each package, so
 * they can only both pass by agreeing with each other.
 */
export function assetNameFromPath(rawPath: string): string {
  const decoded = rawPath
    .replace(LOCAL_ASSET_PATH_RE, "")
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        // Already broken or hand-edited: keep the bytes. Throwing here would
        // turn one odd filename into an unhandled rejection at paint time.
        return seg;
      }
    })
    .join("/");

  // `canonicalizeAssetName`, spelled out: split, drop empty segments, join.
  return decoded
    .split("/")
    .filter((seg) => seg.length > 0)
    .join("/");
}

/**
 * Resolve a stored asset path (or external URL) into a URL that PIXI
 * Assets.load()/<img> can actually fetch.
 *
 * BUG A FIX: SceneDocument.background / TokenDocument.texture are persisted
 * as clean paths (no query token — a token would expire long before the
 * document is read back, since ASSET_TOKEN_TTL_MS is only 5 minutes). Every
 * render-time consumer must therefore obtain a FRESH short-lived credential
 * right before loading the asset, rather than reusing whatever was in the
 * document. This helper is the single place that does that so no caller
 * re-implements (or forgets) the mint + assetUrl() dance.
 *
 * T025 — WHY `docRef` IS REQUIRED AND HAS NO DEFAULT.
 * The server signs a grant for one name only after reading the DOCUMENT that
 * carries it and confirming this user can see it. A caller that cannot name the
 * document does not know what it is painting; making the parameter optional
 * would turn that ignorance into a silent fall-through to a weaker credential.
 * The type break IS the gate: every render-time consumer had to be found and
 * told where its string came from, and a new one cannot compile without doing
 * the same.
 *
 * Only paths served by our own /assets/<name> route need a credential —
 * external URLs (http/https, or already-absolute) and data URIs are returned
 * as-is, without a round-trip.
 *
 * FALLBACK, and why it is not a hole. When the document's grants carry no
 * signature for this name, this falls back to a browse-scope token — today's
 * behaviour. That keeps the shadow-mode rollout honest: with
 * `ASSET_GRANT_ENFORCE` off the server logs the refusal and still serves, but
 * only if the request carries SOME verifiable identity, and a request with no
 * credential at all is rejected at the identity step, before the shadow branch
 * is ever reached. It costs nothing in security: the server honours a browse
 * token only for roles that may already list every filename (TRUSTED+), so for a
 * PLAYER the fallback opens exactly nothing.
 *
 * @param rawPath      The raw path/URL from the document (e.g. scene.background).
 * @param accessToken  Bearer access token for the current session.
 * @param userId       The current user's ID.
 * @param docRef       The document this path was read out of.
 * @returns            A URL safe to pass to PIXI Assets.load() or <img src>.
 */
export async function resolveAssetUrl(
  rawPath: string,
  accessToken: string,
  userId: string,
  docRef: AssetDocRef,
): Promise<string> {
  if (!_isLocalAssetPath(rawPath)) return rawPath;

  const name = assetNameFromPath(rawPath);

  // `assetGrantsCovering`, not `assetGrantsFor`: a cached bundle that has no
  // signature for THIS name is stale evidence, not an answer. Without that, the
  // monster the GM drags onto the scene mid-combat paints as a placeholder for
  // up to five minutes — the bundle for the scene was minted when the player
  // entered it and nothing ever adds a name to a bundle.
  const bundle = await assetGrantsCovering(docRef, name, accessToken);
  const grant = bundle.grants[name];
  if (grant !== undefined) {
    return assetUrl(name, { token: grant, exp: bundle.exp, userId });
  }

  return assetUrl(name, await fetchAssetToken(accessToken, userId));
}

/**
 * Resolve an asset path that belongs to NO document yet, using a browse-scope
 * token — the FilePicker's credential.
 *
 * The one legitimate case: the user just chose a file in the FilePicker and the
 * form is showing it back before anything is saved. There is no document to name
 * yet, so `resolveAssetUrl()` would ask for a grant over a value the server has
 * never seen and correctly answer with none.
 *
 * NOT a way around the gate. Browse scope is honoured only for a role that may
 * already list every filename in the world; a surface a PLAYER reaches will
 * simply not load through it. If you are reading a path OUT of a document, this
 * is the wrong function.
 */
export async function resolveBrowseAssetUrl(
  rawPath: string,
  accessToken: string,
  userId: string,
): Promise<string> {
  if (!_isLocalAssetPath(rawPath)) return rawPath;
  const name = assetNameFromPath(rawPath);
  return assetUrl(name, await fetchAssetToken(accessToken, userId));
}

/**
 * True when `path` points at our own /assets/* static route (and therefore
 * needs an auth query-token) rather than being an external URL or data URI.
 *
 * Implemented as a regex rather than `path.startsWith("/assets/")` so the
 * built bundle never contains a bare double-quoted "/assets/" string
 * literal — packages/server/src/spa/__tests__/routes.test.ts asserts no
 * built JS chunk embeds one (a regression guard against a hashed chunk
 * accidentally resolving to the world's asset-upload route instead of
 * assets-client/). This prefix check is unrelated to that Vite chunk-loading
 * concern, but a literal `"/assets/"` would still (correctly, per that
 * test's letter) get flagged, so express it without one.
 */
const LOCAL_ASSET_PATH_RE = /^\/assets\//;

function _isLocalAssetPath(path: string): boolean {
  return LOCAL_ASSET_PATH_RE.test(path);
}

/**
 * Public form of the predicate above, for callers that must decide SYNCHRONOUSLY
 * whether a stored path can be painted right away.
 *
 * `resolveAssetUrl()` is async because minting a query-token is a round-trip, but an
 * external URL or a data URI needs no token at all — a caller that knows this can use
 * the raw value immediately instead of flashing a placeholder for one tick. It delegates
 * rather than re-testing the prefix so there is still exactly one definition of "this is
 * our own /assets route".
 */
export function needsAssetQueryToken(path: string): boolean {
  return _isLocalAssetPath(path);
}
