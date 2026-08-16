/**
 * usersApi.ts — typed HTTP client for the GM-only user-administration API
 * (spec 37 §5.6, G105; spec 05 REQ-USR-025..030).
 *
 * Wraps the routes registered in packages/server/src/auth/routes.ts:
 *   GET    /api/users                    — list (REQ-CFG-050)
 *   POST   /api/users                    — create (REQ-USR-025)
 *   PATCH  /api/users/:id                — edit name/role/color/avatar/active (REQ-USR-026)
 *   POST   /api/users/:id/reset-password — reset, password returned once (REQ-USR-027)
 *   DELETE /api/users/:id                — soft-delete / deactivate (REQ-USR-028)
 *   POST   /api/users/:id/kick           — disconnect (REQ-USR-029)
 *
 * Every one of these routes enforces `role === GAMEMASTER` server-side
 * (`requireGm`, REQ-USR-030, REQ-CFG-070) — the bearer token is what decides
 * who actually succeeds; this module never re-implements that check, it only
 * carries the token (same `authHeader`/`credentials: "include"` shape as
 * `lib/assets/assetApi.ts`, this package's established HTTP-API pattern).
 */

// ---------------------------------------------------------------------------
// Wire shapes (mirror UserPublic from packages/server/src/auth/user-store.ts —
// the client owns its own copy, same discipline as worldSettingsSection.ts /
// permissionsSection.ts already established for this section's siblings)
// ---------------------------------------------------------------------------

export interface AdminUser {
  id: string;
  name: string;
  role: number;
  color: string;
  avatar: string | null;
  active: boolean;
}

export interface CreateUserInput {
  name: string;
  role: number;
  color?: string;
  password?: string;
}

export interface UpdateUserInput {
  name?: string;
  role?: number;
  color?: string;
  avatar?: string | null;
  active?: boolean;
}

export interface ResetPasswordInput {
  newPassword?: string;
  removePassword?: boolean;
}

export interface ResetPasswordResult {
  /** REQ-CFG-053: the plaintext, shown once by the caller. `null` means passwordless. */
  password: string | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class UsersApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UsersApiError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function throwForResponse(response: Response, fallback: string): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
  throw new UsersApiError(body.code ?? "UNKNOWN_ERROR", body.message ?? fallback);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** GET /api/users — REQ-CFG-050's list, before REQ-USR-031's connection state is merged in. */
export async function listUsers(token: string): Promise<AdminUser[]> {
  const response = await fetch("/api/users", {
    method: "GET",
    headers: authHeader(token),
    credentials: "include",
  });
  if (!response.ok) {
    return throwForResponse(response, `Failed to list users (HTTP ${String(response.status)})`);
  }
  const data = (await response.json()) as { ok: boolean; users: AdminUser[] };
  return data.users;
}

/** POST /api/users — REQ-USR-025 (server creates the blank character atomically). */
export async function createUser(token: string, input: CreateUserInput): Promise<AdminUser> {
  const response = await fetch("/api/users", {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    return throwForResponse(response, `Failed to create user (HTTP ${String(response.status)})`);
  }
  const data = (await response.json()) as { ok: boolean; user: AdminUser };
  return data.user;
}

/** PATCH /api/users/:id — REQ-USR-026 / REQ-CFG-052. */
export async function updateUser(
  token: string,
  id: string,
  input: UpdateUserInput,
): Promise<AdminUser> {
  const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    return throwForResponse(response, `Failed to update user (HTTP ${String(response.status)})`);
  }
  const data = (await response.json()) as { ok: boolean; user: AdminUser };
  return data.user;
}

/** POST /api/users/:id/reset-password — REQ-USR-027 / REQ-CFG-053. */
export async function resetPassword(
  token: string,
  id: string,
  input: ResetPasswordInput = {},
): Promise<ResetPasswordResult> {
  const response = await fetch(`/api/users/${encodeURIComponent(id)}/reset-password`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    return throwForResponse(response, `Failed to reset password (HTTP ${String(response.status)})`);
  }
  const data = (await response.json()) as { ok: boolean; password: string | null };
  return { password: data.password };
}

/** DELETE /api/users/:id — REQ-USR-028, soft-delete (active=false). */
export async function deactivateUser(token: string, id: string): Promise<void> {
  const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeader(token),
    credentials: "include",
  });
  if (!response.ok) {
    await throwForResponse(response, `Failed to deactivate user (HTTP ${String(response.status)})`);
  }
}

/** POST /api/users/:id/kick — REQ-USR-029. */
export async function kickUser(token: string, id: string): Promise<void> {
  const response = await fetch(`/api/users/${encodeURIComponent(id)}/kick`, {
    method: "POST",
    headers: authHeader(token),
    credentials: "include",
  });
  if (!response.ok) {
    await throwForResponse(response, `Failed to disconnect user (HTTP ${String(response.status)})`);
  }
}
