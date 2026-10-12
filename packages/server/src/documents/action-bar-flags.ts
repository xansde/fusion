/**
 * `flags.fusion.actionBar` on the write paths (tasks.md §2.5; BAR-F3-05 for `icons`, BAR-F3-01 for
 * `favorites`/`seeded`).
 *
 * WHO may write is not decided here: `doc:update` already requires OWNER of the actor or a
 * privileged role before any of this runs (REQ-BAR-072/073, REQ-USR-014), and `doc:create` has its
 * own role gate. This module closes WHAT may be written — the shape and the cap of
 * `ActionBarFlagsSchema` — for every role, on both doors:
 *
 *   update  the RESULTING object (stored value + the expanded diff, merged exactly the way the
 *           store merges it) is validated, so a valid map cannot be grown past the cap by a later
 *           partial diff, and a dotted key, a nested object or a replaced `flags` all land on the
 *           same check. A diff that leaves the bar untouched is never judged: an actor whose stored
 *           bar predates the schema keeps accepting unrelated writes instead of freezing.
 *   create  a create payload IS the whole document, so it is validated as-is (the
 *           `stripGmExceptionsOnCreate` lesson: the create path must not be the door left open
 *           beside the update path — a GM can open Actor creation to players, REQ-USR-008).
 *   import  a compendium Actor whose bar is invalid comes into the world without the bar
 *           (`stripInvalidActionBarFlags`, called by `CompendiumService.importToWorld`).
 *
 * The "result" of an update is only the result if the batch names each document once: the
 * pre-flight judges every entry against the same stored snapshot, so `doc-handlers.ts` refuses a
 * primary batch that repeats an `_id` (three 64-icon entries for one actor would otherwise each
 * pass alone and store 192 — adversarial review of BAR-F3-05).
 */

import { isDeepStrictEqual } from "node:util";
import { ActionBarFlagsSchema, readActionBarFlags, ACTION_BAR_FLAG_PATH } from "@fusion/shared";

/** Why `value` is not a valid bar, or `null` when it is one (absent counts as valid). */
function actionBarFlagsProblem(value: unknown): string | null {
  if (value === undefined) return null;
  const parsed = ActionBarFlagsSchema.safeParse(value);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
  return `${ACTION_BAR_FLAG_PATH}${where}: ${issue?.message ?? "invalid"}`;
}

/**
 * The refusal for a `doc:update` of an Actor, or `null` to let it through.
 *
 * @param existing the stored document, as the pre-flight loaded it
 * @param merged   `deepMerge(existing, expandedDiff)` — the same merge the store applies
 */
export function actionBarFlagsWriteProblem(
  existing: Record<string, unknown>,
  merged: Record<string, unknown>,
): string | null {
  const before = readActionBarFlags(existing);
  const after = readActionBarFlags(merged);
  if (isDeepStrictEqual(before, after)) return null;
  return actionBarFlagsProblem(after);
}

/** The refusal for one Actor of a `doc:create` payload, or `null` to let it through. */
export function actionBarFlagsCreateProblem(item: Record<string, unknown>): string | null {
  return actionBarFlagsProblem(readActionBarFlags(item));
}

/**
 * The import door (compendium → world): an Actor whose bar the schema refuses comes in WITHOUT the
 * bar, the rest of `flags.fusion` untouched, and the reason is returned for the log. Refusing the
 * whole document would lose a GM's creature over a field that only ever held icon choices.
 * `doc` is mutated in place — the importer owns this freshly parsed copy.
 */
export function stripInvalidActionBarFlags(doc: Record<string, unknown>): string | null {
  const problem = actionBarFlagsCreateProblem(doc);
  if (problem === null) return null;
  const flags = doc["flags"] as Record<string, unknown>;
  const fusion = flags["fusion"] as Record<string, unknown>;
  const { actionBar: _dropped, ...rest } = fusion;
  void _dropped;
  flags["fusion"] = rest;
  return problem;
}
