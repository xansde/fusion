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
 * `isGamemasterStrict`), PLUS domain validation of the `value` itself
 * (REQ-CFG-042, `validatePermissionOverrides` below, wired into
 * `buildDocCreateHandler`/`buildDocUpdateHandler`) — this module never
 * writes, it only resolves reads and validates.
 *
 * Coverage (fixed 2026-08-16, code review of the Fase 9 G104 rollout): ALL 19
 * Permission Keys from the REQ-USR-008 table are listed here — REQ-CFG-040 is
 * literal ("a seção DEVE listar **as** permissões configuráveis de
 * REQ-USR-008, uma por linha"), not "the ones that already have a gate". An
 * earlier revision narrowed this to the 6 keys doc-handlers.ts already
 * enforced; that was an unregistered, silent divergence from both REQ-CFG-040
 * and REQ-USR-008 (specs/CONVENCOES.md §2), reverted here.
 *
 * Listing a key here does NOT imply doc-handlers.ts enforces it: only
 * `ACTOR_CREATE`, `ITEM_CREATE`, `TABLE_CREATE`, `PLAYLIST_CREATE`,
 * `JOURNAL_CREATE` and `TOKEN_CREATE` back a real create gate today (the
 * other 13 — `DRAWING_CREATE`, `FILES_BROWSE`, `FILES_UPLOAD`,
 * `MACRO_SCRIPT`, `MANUAL_ROLLS`, `MESSAGE_WHISPER`, `NOTE_CREATE`,
 * `PING_CANVAS`, `SHOW_CURSOR`, `SHOW_RULER`, `TOKEN_CONFIGURE`,
 * `TOKEN_DELETE`, `WALL_DOORS` — have no corresponding operation gate
 * anywhere in the server yet). REQ-CFG-040 only requires the row to exist and
 * be GM-adjustable (REQ-USR-009); wiring a NEW enforcement point for a key
 * whose feature is not itself built is separate feature work, out of scope
 * for G104 (rule: não invente escopo).
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
 * All 19 Permission Keys from the REQ-USR-008 table, in the same order the
 * spec lists them.
 */
export type PermissionKey =
  | "ACTOR_CREATE"
  | "DRAWING_CREATE"
  | "FILES_BROWSE"
  | "FILES_UPLOAD"
  | "ITEM_CREATE"
  | "JOURNAL_CREATE"
  | "MACRO_SCRIPT"
  | "MANUAL_ROLLS"
  | "MESSAGE_WHISPER"
  | "NOTE_CREATE"
  | "PING_CANVAS"
  | "PLAYLIST_CREATE"
  | "SHOW_CURSOR"
  | "SHOW_RULER"
  | "TABLE_CREATE"
  | "TOKEN_CONFIGURE"
  | "TOKEN_CREATE"
  | "TOKEN_DELETE"
  | "WALL_DOORS";

/**
 * Default minimum role per key — REQ-USR-008's own `defaultRole` column,
 * verbatim (specs/05-usuarios-e-permissoes.md). `TOKEN_CREATE` is ASSISTANT
 * here, matching the spec: an earlier revision hardcoded TRUSTED+ to match
 * doc-handlers.ts's pre-existing behaviour instead, which was the divergence
 * — per this repo's rule 11 ("se a spec e o código divergirem, a spec
 * manda"), the code's floor moves to match the spec, not the other way
 * around.
 */
export const DEFAULT_PERMISSION_MIN_ROLE: Readonly<Record<PermissionKey, UserRole>> = Object.freeze(
  {
    ACTOR_CREATE: UserRole.ASSISTANT_GM,
    DRAWING_CREATE: UserRole.TRUSTED,
    FILES_BROWSE: UserRole.TRUSTED,
    FILES_UPLOAD: UserRole.ASSISTANT_GM,
    ITEM_CREATE: UserRole.ASSISTANT_GM,
    JOURNAL_CREATE: UserRole.TRUSTED,
    MACRO_SCRIPT: UserRole.PLAYER,
    MANUAL_ROLLS: UserRole.TRUSTED,
    MESSAGE_WHISPER: UserRole.PLAYER,
    NOTE_CREATE: UserRole.TRUSTED,
    PING_CANVAS: UserRole.PLAYER,
    PLAYLIST_CREATE: UserRole.ASSISTANT_GM,
    SHOW_CURSOR: UserRole.PLAYER,
    SHOW_RULER: UserRole.PLAYER,
    TABLE_CREATE: UserRole.ASSISTANT_GM,
    TOKEN_CONFIGURE: UserRole.TRUSTED,
    TOKEN_CREATE: UserRole.ASSISTANT_GM,
    TOKEN_DELETE: UserRole.ASSISTANT_GM,
    WALL_DOORS: UserRole.PLAYER,
  },
);

/**
 * The keys in table order — what the Permissões section (G104) lists, one row
 * per key, straight from this array (REQ-CFG-040: never a matrix, never a
 * hand-copied list that could drift from `DEFAULT_PERMISSION_MIN_ROLE`).
 */
export const PERMISSION_KEYS: readonly PermissionKey[] = Object.keys(
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
 * Find the `_id` of the single `fusion.permissions` Setting document, if a GM
 * has ever written one (G104: the Permissões section — `settings:permissions`
 * in `net/handlers/settings-handlers.ts` — needs this to know whether the
 * next write is a `doc:create` or a `doc:update`, same shape as
 * `settings:declarations`' per-key `id`, except here every row shares the
 * ONE document).
 */
export function findPermissionsSettingId(store: PermissionsStoreSource): string | null {
  for (const doc of store.getAll("settings")) {
    if (doc["key"] !== PERMISSIONS_SETTING_KEY) continue;
    const id = doc["_id"];
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * Resolve the effective minimum role for a configurable permission
 * (REQ-USR-008/009, REQ-CFG-040..042): the GM's override from the
 * `fusion.permissions` Setting when present and valid, else the default that
 * matches today's hardcoded behaviour (REQ-CFG-073's "recusa mantém o valor
 * anterior" — an invalid/missing override is never treated as "wide open",
 * it just falls back).
 *
 * The floor's legitimate domain is PLAYER..GAMEMASTER, never NONE: the
 * client's own selector never offers it (`PERMISSION_ROLE_OPTIONS`,
 * permissionsSection.ts), REQ-USR-008's table treats NONE as "no access",
 * not as a configurable floor, and a stray `raw === 0` (e.g. a malformed
 * `{"ACTOR_CREATE": 0}` override) would otherwise resolve to a floor every
 * connected role satisfies (`ctx.role >= 0` is always true) — silently
 * disabling the gate instead of narrowing it.
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
    raw >= UserRole.PLAYER &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    raw <= UserRole.GAMEMASTER
  ) {
    return raw;
  }
  return DEFAULT_PERMISSION_MIN_ROLE[key];
}

/**
 * Validate a full (or partial-diff) `{ permissionKey: minRole }` payload
 * before it is allowed to be written to the `fusion.permissions` Setting
 * (REQ-CFG-042). Wired into `buildDocCreateHandler`/`buildDocUpdateHandler`
 * (doc-handlers.ts) for `documentType === "Setting"` writes whose `key` is
 * `PERMISSIONS_SETTING_KEY` — the GAMEMASTER-strict guard those handlers
 * already run (REQ-CFG-070) only proves WHO may write, not WHAT was
 * written. Unknown keys or out-of-range roles are reported by key so a
 * caller can refuse the whole write rather than silently drop bad entries.
 *
 * NONE (0) is out of range here too — same PLAYER..GAMEMASTER domain as
 * `resolvePermissionMinRole` above; see that function's docstring for why.
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
      minRole < UserRole.PLAYER ||
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      minRole > UserRole.GAMEMASTER
    ) {
      errors.push(`invalid minRole for ${key}: ${JSON.stringify(minRole)}`);
    }
  }
  return errors;
}
