/**
 * Deep merge utilities for Document CRUD.
 *
 * Implements the canonical merge semantics from REQ-DOC-037 / REQ-PER-019:
 *   - Objects: deep merge (recursive)
 *   - Arrays: replacement (the patch array completely replaces the target)
 *   - Null values INSIDE flags/system sub-objects: key deletion (deleteKey semantics)
 *   - Null at top-level or in other fields: set the key to null (valid nullable value)
 *   - All other primitives: replacement
 *
 * Design decision: null-deletes-key semantics are scoped to flags/system paths only
 * (REQ-DOC-037). At the document top level, null is a valid value (e.g., folder=null
 * means "move to root") and must be preserved, not deleted.
 *
 * Because deep merge never removes a key the patch omits, a writer that rebuilds a
 * whole subtree (e.g. the derivation pipeline rewriting `system.derived`) must build
 * its patch with `prunedPatch` so vanished keys are expressed as explicit nulls.
 */

/** A JSON-serializable value. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * The set of top-level document keys for which null patch values mean
 * "delete this nested key" rather than "set to null".
 * Scoped to REQ-DOC-037: only flags and system sub-objects use deleteKey semantics.
 */
const DELETE_KEY_NAMESPACES = new Set<string>(["flags", "system"]);

/** Deep merge a patch into a target.
 *
 * Rules:
 *  - If target and patch are both plain objects → merge recursively.
 *  - If patch value is null AND we are inside a flags/system namespace → delete the key.
 *  - If patch value is null at top-level or outside flags/system → set key to null.
 *  - If patch is an array → replace entirely.
 *  - Otherwise → replace.
 *
 * Returns a new object; never mutates target or patch.
 *
 * @param target        The current document (or sub-object).
 * @param patch         The incoming update patch.
 * @param inDeleteScope When true, null values delete the key (we are inside flags/system).
 */
export function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
  inDeleteScope = false,
): Record<string, unknown> {
  // Build output: start with target keys, then apply patch.
  // We accumulate into an entries array to avoid `delete` (no-dynamic-delete rule).
  const output: Record<string, unknown> = {};

  // Copy all target keys first.
  for (const key of Object.keys(target)) {
    output[key] = target[key];
  }

  // Apply patch semantics.
  for (const key of Object.keys(patch)) {
    const patchVal = patch[key];
    const targetVal = output[key];

    if (patchVal === null) {
      if (inDeleteScope) {
        // null inside flags/system: deleteKey semantics (REQ-DOC-037).
        // Use Reflect.deleteProperty instead of the `delete` operator to satisfy
        // the @typescript-eslint/no-dynamic-delete rule.
        Reflect.deleteProperty(output, key);
      } else {
        // null at top-level or outside delete-scope: preserve as null (e.g., folder=null)
        output[key] = null;
      }
    } else if (isPlainObject(patchVal) && isPlainObject(targetVal)) {
      // Both are plain objects → recurse, propagating delete-scope.
      const childDeleteScope = inDeleteScope || DELETE_KEY_NAMESPACES.has(key);
      output[key] = deepMerge(targetVal, patchVal, childDeleteScope);
    } else {
      // Arrays (replaced), primitives, and mixed types.
      output[key] = patchVal;
    }
  }

  return output;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

/**
 * Turn a "here is the new value" patch into a COMPLETE patch that also
 * expresses which keys disappeared.
 *
 * Why this exists: `deepMerge` only adds/overwrites — a key present in the
 * target but absent from the patch is PRESERVED (see the recursion above).
 * A writer that recomputes a whole subtree from scratch and patches it back
 * (the derivation pipeline does exactly that for `system.derived`) therefore
 * gets purely ADDITIVE semantics: the subtree grows and never prunes. A Lore
 * skill dropped from `system.skills` survived in `system.derived.skills`
 * forever, and the sheet kept rendering it.
 *
 * The fix keeps merge semantics untouched and makes the PATCH honest
 * instead: every key that existed in `oldValue` and is gone from `newValue`
 * comes back as an explicit `null`, which inside a flags/system namespace is
 * already deleteKey (REQ-DOC-037). One patch, one store.update(), one
 * broadcast — no replace-mode store and no intermediate state where the
 * subtree is missing.
 *
 * Recursion is generic over plain objects, so it prunes any category of a
 * recomputed subtree (`derived.skills`, `derived.saves`, `derived.strikes`,
 * anything added later) at any depth.
 *
 * Cases that are NOT pruned, deliberately:
 *  - either side is not a plain object → the new value replaces wholesale
 *    (that is what deepMerge does for primitives and mixed types anyway);
 *  - arrays → deepMerge replaces an array entirely, so recursing into
 *    indices would emit nulls for a shrunk array and corrupt it;
 *  - no old value → nothing can be stale, so the new value goes as-is.
 *
 * When `newValue` is absent but an old one existed, the whole subtree is
 * stale and the helper returns `null` (delete it); when neither side has a
 * value it returns `undefined` so the patch stays silent about the key.
 *
 * @param oldValue The subtree currently persisted on the document.
 * @param newValue The freshly recomputed subtree.
 * @returns A patch value for `deepMerge` that both updates and prunes.
 */
export function prunedPatch(oldValue: unknown, newValue: unknown): unknown {
  if (newValue === undefined) {
    return oldValue === undefined ? undefined : null;
  }
  if (!isPlainObject(oldValue) || !isPlainObject(newValue)) {
    return newValue;
  }

  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(newValue)) {
    patch[key] = prunedPatch(oldValue[key], newValue[key]);
  }
  // Keys the recompute no longer produces: null == deleteKey under flags/system.
  for (const key of Object.keys(oldValue)) {
    if (!(key in newValue)) {
      patch[key] = null;
    }
  }
  return patch;
}

/**
 * Compute the minimal diff between two JSON-serializable objects.
 * Returns a patch object containing only keys whose values changed.
 * Arrays are compared by reference equality (no diff inside arrays).
 *
 * Also detects deletions: keys present in current but absent in proposed.
 *
 * REQ-DOC-038: no-op updates must not generate change events.
 */
export function computeDiff(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
): Record<string, unknown> | null {
  const diff: Record<string, unknown> = {};
  let changed = false;

  // Check for changed/added keys in proposed
  for (const key of Object.keys(proposed)) {
    const cur = current[key];
    const next = proposed[key];

    if (isPlainObject(cur) && isPlainObject(next)) {
      const sub = computeDiff(cur, next);
      if (sub !== null) {
        diff[key] = sub;
        changed = true;
      }
    } else if (!deepEqual(cur, next)) {
      diff[key] = next;
      changed = true;
    }
  }

  // Check for deleted keys (present in current, absent in proposed)
  for (const key of Object.keys(current)) {
    if (!(key in proposed)) {
      diff[key] = undefined; // mark as deleted
      changed = true;
    }
  }

  return changed ? diff : null;
}

/**
 * Simple deep equality check (JSON-safe values only).
 *
 * Exported because `write-metrics.ts` needs exactly this predicate to tell
 * which ELEMENTS of a resent embedded collection actually changed; a second
 * implementation of the same rule would be free to drift from this one.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}
