/**
 * ownershipEdit.ts — pure logic for OwnershipDialog.svelte (REQ-USR-015).
 *
 * REQ-USR-015 [MVP]: "GM alters ownership of any Document via a dedicated
 * interface." This module implements the pure state transforms; the
 * component only wires them to selects + sendOp().
 *
 * This module is a pure TS module (no DOM/Svelte) for Vitest testability,
 * mirroring actorDirectory.ts's split.
 *
 * MERGE ENGINE DECISION (verified against packages/server/src/documents/merge.ts
 * deepMerge): `ownership` is NOT in DELETE_KEY_NAMESPACES (only "flags" and
 * "system" get null-deletes-key semantics there) — deepMerge applies a patch
 * object's keys on top of the existing target object and does NOT drop keys
 * that are simply absent from the patch. Consequently, "revoking" a user who
 * previously had an explicit ownership entry can NEVER be done by omitting
 * their key from the diff — the server would keep their old level untouched.
 * buildOwnershipDiff() therefore always emits one explicit numeric entry
 * (OwnershipLevel, including INHERIT = -1) per user shown in the dialog, plus
 * "default" — every row's current selection is written verbatim, so the
 * server-side merge always fully replaces the map for those keys.
 */

import { OwnershipLevel } from "@fusion/shared";
import type { Ownership } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Levels selectable for the "default" (all other players) row. No INHERIT — "default" IS the fallback target, it can't inherit from itself. */
export type DefaultOwnershipLevel =
  | OwnershipLevel.NONE
  | OwnershipLevel.LIMITED
  | OwnershipLevel.OBSERVER
  | OwnershipLevel.OWNER;

/** Levels selectable for a per-user row — includes INHERIT ("follow default"). */
export type PerUserOwnershipLevel =
  | OwnershipLevel.INHERIT
  | OwnershipLevel.NONE
  | OwnershipLevel.LIMITED
  | OwnershipLevel.OBSERVER
  | OwnershipLevel.OWNER;

/** Editable state backing the dialog's <select> elements. */
export interface OwnershipFormState {
  default: DefaultOwnershipLevel;
  /** userId -> selected level. One entry per world user shown in the dialog. */
  perUser: Record<string, PerUserOwnershipLevel>;
}

// ---------------------------------------------------------------------------
// deriveOwnershipFormState
// ---------------------------------------------------------------------------

/**
 * Derive the dialog's initial form state from a document's current
 * `ownership` map and the list of world user ids to show a row for.
 *
 * A user with no explicit entry in `ownership` is treated as INHERIT (shown
 * as "Herdar do padrão" in the UI), matching getUserLevel()'s own fallback
 * semantics (packages/shared/src/document.ts) — this is a read-only display
 * decision, distinct from the write-side rule above.
 */
export function deriveOwnershipFormState(
  ownership: Ownership,
  userIds: readonly string[],
): OwnershipFormState {
  const def = (ownership["default"] ?? OwnershipLevel.NONE) as DefaultOwnershipLevel;
  const perUser: Record<string, PerUserOwnershipLevel> = {};
  for (const userId of userIds) {
    const explicit = ownership[userId];
    perUser[userId] = explicit === undefined ? OwnershipLevel.INHERIT : explicit;
  }
  return { default: def, perUser };
}

// ---------------------------------------------------------------------------
// buildOwnershipDiff
// ---------------------------------------------------------------------------

/**
 * Build the full `ownership` map to send as the `doc:update` diff.
 *
 * Always includes "default" and one explicit entry per user in
 * `form.perUser` — see the MERGE ENGINE DECISION note at the top of this
 * file for why omission can never be used to "clear" a user's access.
 */
export function buildOwnershipDiff(form: OwnershipFormState): Ownership {
  const result: Ownership = { default: form.default };
  for (const [userId, level] of Object.entries(form.perUser)) {
    result[userId] = level;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Select option lists
// ---------------------------------------------------------------------------

/** Ordered levels for the "default" row's <select> (no INHERIT). */
export const DEFAULT_LEVEL_OPTIONS: readonly DefaultOwnershipLevel[] = [
  OwnershipLevel.NONE,
  OwnershipLevel.LIMITED,
  OwnershipLevel.OBSERVER,
  OwnershipLevel.OWNER,
];

/** Ordered levels for a per-user row's <select> (INHERIT first). */
export const PER_USER_LEVEL_OPTIONS: readonly PerUserOwnershipLevel[] = [
  OwnershipLevel.INHERIT,
  OwnershipLevel.NONE,
  OwnershipLevel.LIMITED,
  OwnershipLevel.OBSERVER,
  OwnershipLevel.OWNER,
];

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * i18n key suffix for a given ownership level.
 * The component resolves the full key as "FUSION.Ownership.Level.<suffix>".
 */
export function ownershipLevelI18nKey(level: OwnershipLevel): string {
  switch (level) {
    case OwnershipLevel.INHERIT:
      return "Inherit";
    case OwnershipLevel.NONE:
      return "None";
    case OwnershipLevel.LIMITED:
      return "Limited";
    case OwnershipLevel.OBSERVER:
      return "Observer";
    case OwnershipLevel.OWNER:
      return "Owner";
    default:
      return "None";
  }
}
