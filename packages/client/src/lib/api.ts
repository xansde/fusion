/**
 * Fusion API client — typed fetch wrapper with auto-refresh on 401.
 *
 * Rules enforced here:
 * - Access token is kept ONLY in memory (never localStorage/sessionStorage).
 *   REQ-SEC-014 / spec 21 DEC-SEC-03.
 * - Refresh is attempted automatically on 401 using the httpOnly cookie
 *   (browser sends it automatically via credentials: "include").
 * - If refresh also fails, the session is cleared and callers receive an
 *   ApiError with code "SESSION_EXPIRED".
 *
 * Public surface consumed by stores and components:
 *   fusionApi.fetchWorldInfo()
 *   fusionApi.login(userId, password?)
 *   fusionApi.logout()
 *   fusionApi.setAccessToken(token)
 *   fusionApi.clearSession()
 */

// ---------------------------------------------------------------------------
// Types mirrored from the server (spec 05)
// ---------------------------------------------------------------------------

export interface UserJoinInfo {
  id: string;
  name: string;
  color: string;
  hasPassword: boolean;
}

export interface WorldInfo {
  id: string;
  title: string;
  systemId: string;
  users: UserJoinInfo[];
}

export interface UserPublic {
  id: string;
  name: string;
  role: number;
  color: string;
  avatar: string | null;
  active: boolean;
}

export interface LoginResult {
  accessToken: string;
  user: UserPublic;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
    /** Seconds until the client may retry (from Retry-After header). */
    public readonly retryAfterSecs?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------------------
// Internal state (module-level singleton — one app per tab)
// ---------------------------------------------------------------------------

/** In-memory access token. NEVER persisted to storage. */
let _accessToken: string | null = null;

/** Called when the session is definitively expired/invalid. */
let _onSessionExpired: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Low-level fetch with:
 * - Authorization header from the in-memory token (if any).
 * - credentials: "include" so the httpOnly cookie travels with refresh requests.
 * - JSON parsing with a typed error on non-ok responses.
 *
 * Does NOT perform auto-refresh — that is done by `apiFetch` below.
 */
async function rawFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (_accessToken) {
    headers.set("Authorization", `Bearer ${_accessToken}`);
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    let code = "UNKNOWN_ERROR";
    let message = response.statusText;
    let retryAfterSecs: number | undefined;

    try {
      // Server always returns { ok: false, code, message }
      const body = (await response.json()) as { code?: string; message?: string };
      if (body.code) code = body.code;
      if (body.message) message = body.message;
    } catch {
      // Non-JSON error body — keep defaults
    }

    const retryAfterHeader = response.headers.get("Retry-After");
    if (retryAfterHeader) {
      const parsed = Number(retryAfterHeader);
      if (!Number.isNaN(parsed)) retryAfterSecs = parsed;
    }

    throw new ApiError(code, response.status, message, retryAfterSecs);
  }

  return response.json() as Promise<T>;
}

/**
 * Attempt to refresh the access token using the httpOnly cookie.
 * On success, updates the in-memory token.
 * On failure, throws so the caller can treat the session as expired.
 */
async function refreshAccessToken(): Promise<void> {
  const result = await rawFetch<{ ok: true; accessToken: string; user: UserPublic }>(
    "/api/auth/refresh",
    { method: "POST" },
  );
  _accessToken = result.accessToken;
}

/**
 * Fetch wrapper with automatic single-retry on 401 via refresh token.
 *
 * Flow:
 *   1. Try the request with the current access token.
 *   2. On 401, call /api/auth/refresh (uses httpOnly cookie automatically).
 *   3. Retry the original request once with the new token.
 *   4. If refresh itself fails, clear session and throw ApiError("SESSION_EXPIRED").
 */
async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await rawFetch<T>(path, init);
  } catch (err) {
    if (err instanceof ApiError && err.httpStatus === 401) {
      // Try refresh
      try {
        await refreshAccessToken();
      } catch {
        _accessToken = null;
        _onSessionExpired?.();
        throw new ApiError("SESSION_EXPIRED", 401, "Session expired. Please log in again.");
      }
      // Retry the original request with the fresh token
      return rawFetch<T>(path, init);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const fusionApi = {
  /** Store the access token received from login/refresh into memory. */
  setAccessToken(token: string): void {
    _accessToken = token;
  },

  /** Wipe the in-memory token (does not revoke server-side). */
  clearSession(): void {
    _accessToken = null;
  },

  /** Whether there is currently an in-memory access token. */
  hasToken(): boolean {
    return _accessToken !== null;
  },

  /**
   * Returns the current in-memory access token.
   * Intended for the SocketManager handshake — do NOT persist this value.
   */
  getToken(): string | null {
    return _accessToken;
  },

  /**
   * Register a callback invoked when automatic refresh fails.
   * Typically used by the session store to transition to the login screen.
   */
  onSessionExpired(cb: () => void): void {
    _onSessionExpired = cb;
  },

  // --------------------------------------------------------------------------
  // World info (public — no auth required)
  // --------------------------------------------------------------------------

  /**
   * GET /api/world
   * Returns public world info including the join-screen user list.
   */
  async fetchWorldInfo(): Promise<WorldInfo> {
    const data = await rawFetch<{ ok: true; world: WorldInfo }>("/api/world");
    return data.world;
  },

  // --------------------------------------------------------------------------
  // Auth
  // --------------------------------------------------------------------------

  /**
   * POST /api/auth/login
   * Stores the returned access token in memory.
   * The httpOnly refresh cookie is set by the server automatically.
   */
  async login(userId: string, password?: string): Promise<LoginResult> {
    const body: { userId: string; password?: string } = { userId };
    if (password !== undefined && password !== "") body.password = password;

    const data = await rawFetch<{ ok: true; accessToken: string; user: UserPublic }>(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    _accessToken = data.accessToken;
    return { accessToken: data.accessToken, user: data.user };
  },

  /**
   * POST /api/auth/logout
   * Revokes the server-side session and clears the local token.
   */
  async logout(): Promise<void> {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      _accessToken = null;
    }
  },

  /**
   * POST /api/auth/refresh
   * Manually trigger a token refresh (e.g., on app start if a cookie exists).
   * Stores the new access token in memory.
   */
  async tryRefresh(): Promise<UserPublic | null> {
    try {
      const data = await rawFetch<{ ok: true; accessToken: string; user: UserPublic }>(
        "/api/auth/refresh",
        { method: "POST" },
      );
      _accessToken = data.accessToken;
      return data.user;
    } catch {
      return null;
    }
  },
} as const;
