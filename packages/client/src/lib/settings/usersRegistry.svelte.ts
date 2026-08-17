/**
 * usersRegistry.svelte.ts — reactive holder for the Usuários section's rows
 * (spec 37 §5.6, G105).
 *
 * Mirrors `worldSettingsRegistry.svelte.ts`/`permissionsRegistry.svelte.ts`:
 * fail-open (a refusal or timeout leaves the list as it was, never an
 * exception the section has to catch) and single-flight per mount. The one
 * structural difference is the transport — `GET /api/users` is an HTTP route
 * (`auth/routes.ts`, GM-only), not a socket op, because user administration
 * predates `Setting`/`doc:*` and was never moved onto the socket protocol
 * (brief §3.9) — so this module calls `usersApi.ts` instead of `sendOp`.
 *
 * A create/edit/deactivate is folded back into `registry.users` locally, the
 * same "server response, not optimism" discipline `applyWorldSettingWrite`/
 * `applyPermissionWrite` use, because `User` rows are not part of the
 * join/resync `DocumentMirror` snapshot either.
 */

import { listUsers, type AdminUser } from "./usersApi.js";

const registry = $state<{ users: AdminUser[] }>({ users: [] });

/** In-flight (or settled) request, so a second caller never asks again. */
let inFlight: Promise<void> | null = null;

export const usersRegistry = {
  get users(): readonly AdminUser[] {
    return registry.users;
  },
};

/**
 * Ask the server for the user list, once. Never rejects — a failure leaves
 * the section with nothing to draw rather than an uncaught error.
 */
export function ensureUsersRegistry(token: string): Promise<void> {
  inFlight ??= listUsers(token)
    .then((users) => {
      registry.users = users;
    })
    .catch(() => {
      // Fail open: the section simply has nothing to draw yet.
    });
  return inFlight;
}

/** Put users in place without a fetch — used by tests. */
export function seedUsersRegistry(users: readonly AdminUser[]): void {
  registry.users = [...users];
  inFlight = Promise.resolve();
}

/** REQ-USR-025: fold a just-created user into the list (server response, not optimism). */
export function applyCreatedUser(user: AdminUser): void {
  registry.users = [...registry.users, user];
}

/** REQ-USR-026/028: fold a confirmed edit or deactivation (server's own PATCH result) back in. */
export function applyUpdatedUser(user: AdminUser): void {
  registry.users = registry.users.map((existing) => (existing.id === user.id ? user : existing));
}

/**
 * REQ-USR-028: `DELETE /api/users/:id` only ever returns `{ ok: true }`, not
 * the updated record — the caller (`UsersSection.svelte`) knows only that the
 * soft-delete succeeded, so this flips `active` locally instead of waiting
 * for a row the server never sends back.
 */
export function applyDeactivatedUser(userId: string): void {
  registry.users = registry.users.map((existing) =>
    existing.id === userId ? { ...existing, active: false } : existing,
  );
}

/** Forget everything, including the single-flight guard (tests, world switch). */
export function resetUsersRegistry(): void {
  registry.users = [];
  inFlight = null;
}
