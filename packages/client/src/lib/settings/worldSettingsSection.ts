/**
 * worldSettingsSection.ts — pure render logic for the Mundo section (spec 37
 * §5.4, G102).
 *
 * REQ-CFG-030/031, RNF-CFG-02: this file has no branch keyed on any one
 * setting's `key` or on any system id — `controlForRow` derives what to draw
 * from `row.kind` alone, and `buildSettingWriteOp` derives what to send from
 * `row.id` alone. A brand-new setting a system declares tomorrow renders and
 * writes correctly through the exact same two functions, with zero lines
 * touched here — which is what the "sem uma linha alterada" acceptance bar
 * means in practice and what `__tests__/worldSettingsSection.test.ts` proves
 * with a setting from a system this file has never heard of.
 *
 * `WorldSettingRow`/`WorldSettingsDeclarationsResult` mirror the server's
 * `settings:declarations` wire payload (`net/handlers/settings-handlers.ts`'s
 * `WorldSettingDeclaration`/`SettingsDeclarationsResult`) — the client owns
 * its own copy of the shape rather than importing server code, same pattern
 * as `ConditionDisplayContract` in `lib/conditions/conditionView.ts`.
 */

// ---------------------------------------------------------------------------
// Wire shape (client's own copy — see module docstring)
// ---------------------------------------------------------------------------

export type WorldSettingKind = "boolean" | "enum" | "number";

export interface WorldSettingRow {
  /** `Setting` document `_id`, or `null` when nothing has been written yet. */
  readonly id: string | null;
  /** Namespaced by the declaring system (REQ-CFG-071), e.g. `"pf2e:freeArchetype"`. */
  readonly key: string;
  readonly kind: WorldSettingKind;
  /** Present only when `kind === "enum"`. */
  readonly options?: readonly string[];
  readonly label: string;
  readonly hint?: string;
  readonly requiresReload?: boolean;
  /**
   * REQ-CFG-082/DEC-CFG-09: when true, turning this row OFF must be confirmed
   * (showing how many actors are affected) before the write is sent; turning
   * it ON never confirms. See `needsDisableConfirm` below.
   */
  readonly requiresConfirmOnDisable?: boolean;
  /** The stored value, or the declared default when nothing was written yet. */
  readonly value: unknown;
}

export interface WorldSettingsDeclarationsResult {
  readonly systemId?: string | null;
  readonly settings?: readonly WorldSettingRow[];
}

// ---------------------------------------------------------------------------
// row → control (REQ-CFG-030: boolean → alternador, enum → seleção, número → campo)
// ---------------------------------------------------------------------------

export type WorldSettingControl =
  | { readonly kind: "boolean"; readonly checked: boolean }
  | { readonly kind: "enum"; readonly value: string; readonly options: readonly string[] }
  | { readonly kind: "number"; readonly value: number };

/**
 * Turn a declared row into what the tab draws. The ONLY thing read is
 * `row.kind` (plus `row.value`/`row.options` for the chosen kind) — never
 * `row.key`, so this holds for a setting no one has written yet (RNF-CFG-02).
 */
export function controlForRow(row: WorldSettingRow): WorldSettingControl {
  switch (row.kind) {
    case "boolean":
      return { kind: "boolean", checked: row.value === true };
    case "enum":
      return {
        kind: "enum",
        value: typeof row.value === "string" ? row.value : "",
        options: row.options ?? [],
      };
    case "number":
      return { kind: "number", value: typeof row.value === "number" ? row.value : 0 };
  }
}

// ---------------------------------------------------------------------------
// row + new value → doc:create/doc:update op (REQ-CFG-071)
// ---------------------------------------------------------------------------

export interface SettingWriteOp {
  readonly type: "doc:create" | "doc:update";
  readonly payload: Record<string, unknown>;
}

/**
 * The op a change to `row` produces: `doc:create` the first time this key is
 * ever written (`row.id === null`), `doc:update` in place afterward. Persists
 * as a `Setting` document either way (REQ-CFG-071) — this file never opens a
 * different write path for "world settings" than the generic document one.
 */
export function buildSettingWriteOp(row: WorldSettingRow, nextValue: unknown): SettingWriteOp {
  if (row.id === null) {
    return {
      type: "doc:create",
      payload: { documentType: "Setting", data: [{ key: row.key, value: nextValue }] },
    };
  }
  return {
    type: "doc:update",
    payload: {
      documentType: "Setting",
      updates: [{ _id: row.id, diff: { value: nextValue } }],
    },
  };
}

// ---------------------------------------------------------------------------
// Disable confirmation (REQ-CFG-082, DEC-CFG-09) — generic, no system knowledge
// ---------------------------------------------------------------------------

/**
 * Whether committing `nextValue` to `row` is the ONE gesture this tab ever
 * confirms outside REQ-CFG-054's nominal actions (REQ-CFG-083): turning a
 * `requiresConfirmOnDisable` boolean row from `true` to `false`.
 *
 * Reads only `row.kind`/`row.requiresConfirmOnDisable`/`row.value` and the
 * candidate `nextValue` — never `row.key`, so this holds for any system's
 * setting, pf2e included, with zero branches naming one (REQ-CFG-031).
 * Turning a row ON, or writing a non-boolean row, never needs confirmation —
 * "ligar nunca confirma" is structural here, not a caller's discipline.
 */
export function needsDisableConfirm(row: WorldSettingRow, nextValue: unknown): boolean {
  return (
    row.kind === "boolean" &&
    row.requiresConfirmOnDisable === true &&
    row.value === true &&
    nextValue === false
  );
}
