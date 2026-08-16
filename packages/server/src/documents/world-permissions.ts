/**
 * Configurable Permissions table (REQ-USR-008/009) — the door the Configurações
 * tab's Permissões section (spec 37 §5.5, REQ-CFG-040..042) writes through and
 * the doc-handlers.ts creation gates read from.
 *
 * Storage: a single `Setting` document (REQ-CFG-071) with `key ===
 * PERMISSIONS_SETTING_KEY` ("fusion.permissions") and `value` a JSON object
 * `{ [permissionKey]: minRole }`. No dedicated table, no migration — Setting
 * already is a generic document (REQ-DOC-018), and writes to it already go
 * through the GAMEMASTER-strict guard in doc-handlers.ts (REQ-CFG-070,
 * `isGamemasterStrict`) — this module never writes, it only resolves reads.
 *
 * Scope (deliberately narrow — "sem inventar novos" per the Fase 9 plan's
 * G104): only the permission keys from the REQ-USR-008 table that ALREADY
 * have a concrete role-floor check in doc-handlers.ts today become
 * configurable here. Two of them (`JOURNAL_CREATE`, `TOKEN_CREATE`) were
 * literally hardcoded to "TRUSTED+" with a comment naming the simplification;
 * the other four (`ACTOR_CREATE`, `ITEM_CREATE`, `TABLE_CREATE`,
 * `PLAYLIST_CREATE`) were hardcoded to the generic `isPrivileged`
 * (ASSISTANT+) threshold via `GM_ONLY_CREATE_DELETE`, which happens to equal
 * REQ-USR-008's own default for all four — so wiring them through this table
 * changes no default behaviour, only makes the floor GM-adjustable.
 * Permission keys with no existing gate (SHOW_CURSOR, PING_CANVAS, ...) are
 * NOT represented here — inventing enforcement for them is out of scope.
 */

import { UserRole } from "./ownership.js";

// ---------------------------------------------------------------------------
// Setting key
// ---------------------------------------------------------------------------

/** `Setting.key` under which the permission override table is persisted. */
export const PERMISSIONS_SETTING_KEY = "fusion.permissions";

// ---------------------------------------------------------------------------
// Permission keys and defaults
// ---------------------------------------------------------------------------

/**
 * The subset of REQ-USR-008's Permission Keys that map to a real,
 * already-enforced gate in `doc-handlers.ts` today.
 */
export type PermissionKey =
  | "ACTOR_CREATE"
  | "ITEM_CREATE"
  | "TABLE_CREATE"
  | "PLAYLIST_CREATE"
  | "JOURNAL_CREATE"
  | "TOKEN_CREATE";

/**
 * Default minimum role per key — identical to the role threshold each gate
 * enforces today (REQ-USR-008's own `defaultRole` column, except
 * `TOKEN_CREATE`: the table names ASSISTANT there, but the code has always
 * enforced TRUSTED+ — "defaults iguais ao comportamento atual" wins per the
 * G104 task order; see openQuestions in the task report).
 */
export const DEFAULT_PERMISSION_MIN_ROLE: Readonly<Record<PermissionKey, UserRole>> = Object.freeze(
  {
    ACTOR_CREATE: UserRole.ASSISTANT_GM,
    ITEM_CREATE: UserRole.ASSISTANT_GM,
    TABLE_CREATE: UserRole.ASSISTANT_GM,
    PLAYLIST_CREATE: UserRole.ASSISTANT_GM,
    JOURNAL_CREATE: UserRole.TRUSTED,
    TOKEN_CREATE: UserRole.TRUSTED,
  },
);

const PERMISSION_KEYS: readonly PermissionKey[] = Object.keys(
  DEFAULT_PERMISSION_MIN_ROLE,
) as PermissionKey[];

function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Store access (narrowed interface — same shape as settings-handlers.ts'
// SettingsStoreSource, kept independently importable/testable without a real
// DocumentStore).
// ---------------------------------------------------------------------------

/** Just enough of `DocumentStore` to read the persisted permissions Setting. */
export interface PermissionsStoreSource {
  getAll(table: "settings"): Record<string, unknown>[];
}

/**
 * Read the raw override map from the `fusion.permissions` Setting, if one
 * exists and its `value` is a plain object. Anything else (no Setting yet,
 * malformed value) resolves to "no overrides" — callers fall back to
 * defaults, never to a looser floor than today's hardcoded behaviour.
 */
function loadOverrides(store: PermissionsStoreSource): Record<string, unknown> {
  for (const doc of store.getAll("settings")) {
    if (doc["key"] !== PERMISSIONS_SETTING_KEY) continue;
    const value = doc["value"];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }
  return {};
}

/**
 * Resolve the effective minimum role for a configurable permission
 * (REQ-USR-008/009, REQ-CFG-040..042): the GM's override from the
 * `fusion.permissions` Setting when present and valid, else the default that
 * matches today's hardcoded behaviour (REQ-CFG-073's "recusa mantém o valor
 * anterior" — an invalid/missing override is never treated as "wide open",
 * it just falls back).
 */
export function resolvePermissionMinRole(
  store: PermissionsStoreSource,
  key: PermissionKey,
): UserRole {
  const overrides = loadOverrides(store);
  const raw = overrides[key];
  if (
    typeof raw === "number" &&
    Number.isInteger(raw) &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    raw >= UserRole.NONE &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    raw <= UserRole.GAMEMASTER
  ) {
    return raw;
  }
  return DEFAULT_PERMISSION_MIN_ROLE[key];
}

/**
 * Validate a full `{ permissionKey: minRole }` payload before it is allowed
 * to be written to the `fusion.permissions` Setting (used by tests and,
 * should a dedicated write path ever be added, by that path too). Unknown
 * keys or out-of-range roles are reported by key so a caller can refuse the
 * whole write rather than silently drop bad entries.
 */
export function validatePermissionOverrides(value: unknown): string[] {
  const errors: string[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ["value must be a plain object of { permissionKey: minRole }"];
  }
  for (const [key, minRole] of Object.entries(value as Record<string, unknown>)) {
    if (!isPermissionKey(key)) {
      errors.push(`unknown permission key: ${key}`);
      continue;
    }
    if (
      typeof minRole !== "number" ||
      !Number.isInteger(minRole) ||
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      minRole < UserRole.NONE ||
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      minRole > UserRole.GAMEMASTER
    ) {
      errors.push(`invalid minRole for ${key}: ${JSON.stringify(minRole)}`);
    }
  }
  return errors;
}
