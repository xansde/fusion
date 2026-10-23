/**
 * permissionsSection.ts — pure render/write logic for the Permissões section
 * (spec 37 §5.5, G104, REQ-USR-008/009, REQ-CFG-040..042/073).
 *
 * REQ-CFG-040: one row per configurable Permission (`settings:permissions`'s
 * `PermissionRow[]`), each with the papel mínimo in a SELECTOR — this file
 * never renders (or is asked to render) a bidimensional matrix; `SETTINGS`
 * that would make one possible simply do not exist in the shape below.
 * REQ-CFG-041: `isPermissionChanged` is the one predicate the "alterado" mark
 * reads — comparing the EFFECTIVE floor to the shipped default, never to
 * anything client-local.
 *
 * `PermissionRow`/`SettingsPermissionsResult` mirror the server's
 * `settings:permissions` wire payload (`net/handlers/settings-handlers.ts`) —
 * the client owns its own copy of the shape, same pattern
 * `WorldSettingRow`/`WorldSettingsDeclarationsResult` already established for
 * the Mundo section (G102).
 */

// ---------------------------------------------------------------------------
// Wire shape (client's own copy — see module docstring)
// ---------------------------------------------------------------------------

export interface PermissionRow {
  readonly key: string;
  /** The floor actually enforced right now: a GM override, or the default. */
  readonly minRole: number;
  /** The product's shipped default (REQ-CFG-041's "difere do default"). */
  readonly defaultMinRole: number;
}

export interface SettingsPermissionsResult {
  readonly settingId?: string | null;
  readonly permissions?: readonly PermissionRow[];
}

// ---------------------------------------------------------------------------
// Role selector (REQ-CFG-040, REQ-USR-005) — the ONLY control this section
// ever draws for a row. `NONE` (0) is never offered: every configurable
// Permission's floor is meant to be one of the four real roles.
// ---------------------------------------------------------------------------

export const PERMISSION_ROLE_OPTIONS: readonly number[] = [1, 2, 3, 4];

// ---------------------------------------------------------------------------
// Row → i18n label key
// ---------------------------------------------------------------------------

/** i18n key of a permission row's human-readable name (REQ-USR-008's own column). */
export function permissionLabelKey(key: string): string {
  return `FUSION.Settings.Permissions.Keys.${key}`;
}

// ---------------------------------------------------------------------------
// "Alterado" mark (REQ-CFG-041)
// ---------------------------------------------------------------------------

/**
 * REQ-CFG-041: a row carries the "alterado" mark exactly when its effective
 * floor differs from the product's default — reads only `row.minRole`/
 * `row.defaultMinRole`, never anything the client tracked locally, so the
 * mark always agrees with what the server actually resolved.
 */
export function isPermissionChanged(row: PermissionRow): boolean {
  return row.minRole !== row.defaultMinRole;
}

// ---------------------------------------------------------------------------
// row change → doc:create/doc:update op (REQ-CFG-042, REQ-CFG-071)
// ---------------------------------------------------------------------------

/**
 * `Setting.key` under which the permission override table is persisted.
 * MUST match `PERMISSIONS_SETTING_KEY` in the server's
 * `documents/world-permissions.ts` — the client package cannot import server
 * code (`lint:boundaries`), so this is its own copy of the same literal, not
 * a re-export.
 */
const PERMISSIONS_SETTING_KEY = "fusion.permissions";

export interface SettingWriteOp {
  readonly type: "doc:create" | "doc:update";
  readonly payload: Record<string, unknown>;
}

/**
 * The op a single row's role change produces. Unlike the Mundo section
 * (where every row is its OWN `Setting` document), every Permissões row
 * shares the SAME `fusion.permissions` document — so this diff/create
 * payload only ever carries the ONE key that changed.
 * `DocumentStore.update` deep-merges (`documents/store.ts`), so the other
 * rows' overrides already persisted are never clobbered by this write
 * (REQ-CFG-042).
 */
export function buildPermissionWriteOp(
  settingId: string | null,
  key: string,
  nextMinRole: number,
): SettingWriteOp {
  if (settingId === null) {
    return {
      type: "doc:create",
      payload: {
        documentType: "Setting",
        data: [{ key: PERMISSIONS_SETTING_KEY, value: { [key]: nextMinRole } }],
      },
    };
  }
  return {
    type: "doc:update",
    payload: {
      documentType: "Setting",
      updates: [{ _id: settingId, diff: { value: { [key]: nextMinRole } } }],
    },
  };
}
