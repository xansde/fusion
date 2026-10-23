/**
 * usersSection.ts — pure render/write logic for the "Usuários" section
 * (spec 37 §5.6, G105, REQ-CFG-050..054; spec 05 REQ-USR-025..030).
 *
 * `usersApi.ts` is the wire client; `usersRegistry.svelte.ts` is where the
 * rows live reactively. This module owns the parts that need no socket, no
 * `$state` and no DOM: the role vocabulary (REQ-USR-005, reused verbatim from
 * `permissionsSection.ts`'s `PERMISSION_ROLE_OPTIONS`), REQ-CFG-050's
 * connection merge (pairs an `AdminUser` with `presenceStore`'s
 * `OnlineUser[]`), and REQ-CFG-080's "only the field that actually changed
 * gets sent" diff for the stacked edit form (REQ-CFG-052).
 */

import type { AdminUser, UpdateUserInput } from "./usersApi.js";
import type { OnlineUser } from "../presence/types.js";

// ---------------------------------------------------------------------------
// Role vocabulary (REQ-USR-005) — the same four real roles the Permissões
// section offers; `NONE` is never a user's own role.
// ---------------------------------------------------------------------------

export const USER_ROLE_OPTIONS: readonly number[] = [1, 2, 3, 4];

/** i18n key of a role's human label — reuses the same `FUSION.Role.*` bundle
 * `PermissionsSection.svelte` already draws from. */
export function userRoleLabelKey(role: number): string {
  switch (role) {
    case 4:
      return "FUSION.Role.GM";
    case 3:
      return "FUSION.Role.Assistant";
    case 2:
      return "FUSION.Role.Trusted";
    default:
      return "FUSION.Role.Player";
  }
}

// ---------------------------------------------------------------------------
// REQ-CFG-050 / REQ-USR-031: connection state, one row per line
// ---------------------------------------------------------------------------

export interface UsersSectionRow extends AdminUser {
  /** REQ-USR-031's online/offline, resolved from `presenceState.onlineUsers`. */
  readonly online: boolean;
}

/**
 * Pairs every admin user with its live connection state. A user absent from
 * `onlineUsers` (never connected this session, or presence hasn't arrived
 * yet) reads as offline — the honest default, never an assumed "online".
 */
export function mergeConnectionStatus(
  users: readonly AdminUser[],
  onlineUsers: readonly OnlineUser[],
): UsersSectionRow[] {
  const onlineIds = new Set(onlineUsers.filter((user) => user.online).map((user) => user.userId));
  return users.map((user) => ({ ...user, online: onlineIds.has(user.id) }));
}

// ---------------------------------------------------------------------------
// REQ-CFG-052/080: stacked edit form, one field applied at a time
// ---------------------------------------------------------------------------

/** The five fields REQ-USR-026 lets a GM edit, as a single editable shape. */
export interface EditableUserFields {
  name: string;
  role: number;
  color: string;
  avatar: string | null;
  active: boolean;
}

/**
 * REQ-CFG-080: "todo controle DEVE aplicar no ato, sem botão de salvar" — the
 * stacked form calls this once per field, on blur/change, never batching
 * several fields into one PATCH. Returns `null` when the field did not
 * actually change (a blur with no edit, or a re-select of the same option),
 * so the caller can skip the round-trip entirely.
 */
export function buildFieldPatch<K extends keyof EditableUserFields>(
  original: AdminUser,
  field: K,
  value: EditableUserFields[K],
): UpdateUserInput | null {
  switch (field) {
    case "name":
      return original.name === value ? null : { name: value as string };
    case "role":
      return original.role === value ? null : { role: value as number };
    case "color":
      return original.color === value ? null : { color: value as string };
    case "avatar":
      return original.avatar === value ? null : { avatar: value as string | null };
    case "active":
      return original.active === value ? null : { active: value as boolean };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// REQ-CFG-054: nominal confirmation for desconectar/desativar
// ---------------------------------------------------------------------------

/**
 * i18n key of the confirmation prompt shared by "desconectar" (kick) and
 * "desativar" — REQ-CFG-054 asks for the SAME nominal wording
 * ("Tirar <nome> da mesa?") for both actions, not two different messages.
 * The template lives in `FUSION.Settings.Users.ConfirmRemove`
 * (`pt-BR.json`/`en.json`); this module only owns the key, the same
 * discipline `WorldSection.svelte` uses for `FUSION.Settings.World.ConfirmDisable`.
 */
export const CONFIRM_REMOVE_KEY = "FUSION.Settings.Users.ConfirmRemove";
