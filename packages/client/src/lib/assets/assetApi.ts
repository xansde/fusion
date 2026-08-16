/**
 * assetApi.ts — typed HTTP client for the asset storage API.
 *
 * Wraps the server routes from packages/server/src/assets/routes.ts:
 *   GET    /api/assets           — list assets
 *   POST   /api/assets/upload    — multipart upload (with XHR for progress)
 *   DELETE /api/assets/:name     — delete asset (GM only)
 *   GET    /assets/*             — static serving (used directly by <img> / PIXI)
 *
 * Spec refs: 20-assets-e-midia.md REQ-AST-006..011, REQ-AST-019
 * Security:  21-seguranca.md — Bearer token in Authorization header
 */

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
 * Fetch a short-lived query-token from the server for asset serving.
 *
 * PIXI Assets.load() and <img> tags cannot set Authorization headers, so
 * this token is appended to asset URLs as query parameters instead.
 * Tokens expire after 5 minutes (server-side ASSET_TOKEN_TTL_MS).
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
 * Resolve a stored asset path (or external URL) into a URL that PIXI
 * Assets.load()/<img> can actually fetch.
 *
 * BUG A FIX: SceneDocument.background / TokenDocument.texture are persisted
 * as clean paths (no query token — a token would expire long before the
 * document is read back, since ASSET_TOKEN_TTL_MS is only 5 minutes). Every
 * render-time consumer must therefore mint a FRESH short-lived query-token
 * right before loading the asset, rather than reusing whatever was in the
 * document. This helper is the single place that does that minting so no
 * caller re-implements (or forgets) the fetchAssetToken() + assetUrl() dance.
 *
 * Only paths served by our own /assets/<name> route need a token — external
 * URLs (http/https, or already-absolute) and data URIs are returned as-is.
 *
 * @param rawPath      The raw path/URL from the document (e.g. scene.background).
 * @param accessToken  Bearer access token for the current session.
 * @param userId       The current user's ID.
 * @returns            A URL safe to pass to PIXI Assets.load() or <img src>.
 */
export async function resolveAssetUrl(
  rawPath: string,
  accessToken: string,
  userId: string,
): Promise<string> {
  if (!_isLocalAssetPath(rawPath)) return rawPath;

  // rawPath is "/assets/<name...>" (possibly already percent-encoded) — strip
  // the prefix and decode each segment so assetUrl() can safely re-encode it.
  const name = rawPath
    .replace(/^\/assets\//, "")
    .split("/")
    .map((seg) => decodeURIComponent(seg))
    .join("/");

  const queryToken = await fetchAssetToken(accessToken, userId);
  return assetUrl(name, queryToken);
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
