/**
 * setupApi.ts — typed fetch wrapper for the /admin/* installation routes.
 *
 * Deliberately SEPARATE from lib/api.ts (which talks to /api/* — the
 * world-user GAMEMASTER plane, REQ-DST-015A plan 2). This module only ever
 * touches /admin/* (the installation Admin Key plane, plan 1) and never
 * shares the access-token state with the game session — the admin Bearer
 * token here is kept in its own module-local variable and, unlike the game
 * session, may be persisted to sessionStorage (tab-scoped, cleared on tab
 * close) so a GM reloading the setup/reconfigure page mid-flow is not
 * forced to re-enter the Admin Key. It is NEVER written to localStorage.
 */

// ---------------------------------------------------------------------------
// Types (mirrored from server admin/service.ts + admin/routes.ts)
// ---------------------------------------------------------------------------

/**
 * Full shape returned by GET /admin/setup/state WITH a valid Bearer, or
 * pre-setup (always open). Post-setup WITHOUT a Bearer, the server degrades
 * the response to just `{ setupCompleted: true }` (see MinimalSetupState) —
 * every other field is withheld to avoid leaking installation topology
 * (filesystem paths, LAN IPs, version) to an unauthenticated caller reaching
 * this endpoint over a public tunnel URL.
 */
export interface SetupState {
  setupCompleted: boolean;
  defaultDataDir: string;
  /** REQ-DST-009: server-resolved `<exeDir>/FusionVTT-Data` suggestion. */
  portableDataDir: string;
  currentDataDir: string;
  /** The port THIS boot is actually bound to. */
  currentPort: number;
  /**
   * The port persisted to disk, effective starting the NEXT boot
   * (REQ-DST-013) — may differ from `currentPort` right after a
   * reconfiguration that has not been restarted into yet.
   */
  configuredPortNextBoot: number;
  lanUrls: string[];
  serverVersion: string;
}

/** The minimal body returned post-setup when no valid Bearer is presented. */
export interface MinimalSetupState {
  setupCompleted: true;
}

export function isFullSetupState(state: SetupState | MinimalSetupState): state is SetupState {
  return "currentDataDir" in state;
}

export interface CheckPortResult {
  available: boolean;
  suggestion?: number | null;
}

export interface ApplySetupResult {
  adminToken: string;
  lanUrls: string[];
  restartRequired: boolean;
}

export interface AdminNetworkInfo {
  lan: { port: number; urls: string[] };
  tunnel: { enabled: boolean; url: string | null; provider: "cloudflared" } | null;
}

export class SetupApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
    public readonly suggestion?: number | null,
  ) {
    super(message);
    this.name = "SetupApiError";
  }
}

// ---------------------------------------------------------------------------
// Admin token storage (sessionStorage — tab-scoped, cleared on tab close)
// ---------------------------------------------------------------------------

const ADMIN_TOKEN_STORAGE_KEY = "fusion_admin_token";

function getStoredAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredAdminToken(token: string): void {
  try {
    sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  } catch {
    // sessionStorage may be unavailable (private browsing edge cases) —
    // the wizard still works within the same page load without persistence.
  }
}

function clearStoredAdminToken(): void {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  useAuth = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (useAuth) {
    const token = getStoredAdminToken();
    if (token !== null) headers["Authorization"] = `Bearer ${token}`;
  }

  // exactOptionalPropertyTypes: RequestInit's `body` is `BodyInit | null`
  // (no `undefined`), so the init object is built incrementally rather than
  // assigning `body: undefined` when there is nothing to send.
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const errBody = parsed as {
      code?: string;
      message?: string;
      suggestion?: number | null;
    } | null;
    throw new SetupApiError(
      errBody?.code ?? "UNKNOWN_ERROR",
      res.status,
      errBody?.message ?? `Request failed (${String(res.status)})`,
      errBody?.suggestion,
    );
  }

  return parsed as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const setupApi = {
  /**
   * GET /admin/setup/state. Always sends the stored Bearer when present
   * (harmless pre-setup — the server ignores auth entirely until
   * setupCompleted) — required post-setup to get the FULL state back
   * instead of the minimal `{ setupCompleted: true }` degraded body.
   */
  async fetchState(): Promise<SetupState | MinimalSetupState> {
    const body = await request<{ ok: boolean; state: SetupState | MinimalSetupState }>(
      "GET",
      "/admin/setup/state",
      undefined,
      true,
    );
    return body.state;
  },

  async checkPort(port: number): Promise<CheckPortResult> {
    const body = await request<{ ok: boolean; available: boolean; suggestion?: number | null }>(
      "POST",
      "/admin/setup/check-port",
      { port },
      true,
    );
    // exactOptionalPropertyTypes: only assign `suggestion` when it was
    // actually present in the response, rather than assigning `undefined`.
    const result: CheckPortResult = { available: body.available };
    if (body.suggestion !== undefined) {
      result.suggestion = body.suggestion;
    }
    return result;
  },

  async apply(params: {
    dataDir: string;
    port: number;
    adminKey: string;
  }): Promise<ApplySetupResult> {
    const body = await request<{
      ok: boolean;
      adminToken: string;
      lanUrls: string[];
      restartRequired: boolean;
    }>("POST", "/admin/setup/apply", params, true);
    setStoredAdminToken(body.adminToken);
    return body;
  },

  async login(adminKey: string): Promise<string> {
    const body = await request<{ ok: boolean; adminToken: string }>("POST", "/admin/login", {
      adminKey,
    });
    setStoredAdminToken(body.adminToken);
    return body.adminToken;
  },

  async fetchNetwork(): Promise<AdminNetworkInfo> {
    const body = await request<{ ok: boolean } & AdminNetworkInfo>(
      "GET",
      "/admin/network",
      undefined,
      true,
    );
    return { lan: body.lan, tunnel: body.tunnel };
  },

  hasStoredToken(): boolean {
    return getStoredAdminToken() !== null;
  },

  clearToken(): void {
    clearStoredAdminToken();
  },
};
