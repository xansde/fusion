/**
 * TokenActor reconstruction — REQ-DOC-032, REQ-DOC-033, DEC-DOC-08.
 *
 * Six skeletons on the map come from ONE Actor. Killing skeleton 3 must not
 * touch the other five, and none of the six may own an Actor row: the
 * per-token difference lives in `Token.actorDelta`, a merge patch over the
 * base Actor, and the "TokenActor" is rebuilt in memory whenever someone needs
 * it.
 *
 * DEC-DOC-08 deliberately rejects Foundry's `EmbeddedCollectionDelta` (item-by-
 * item inheritance): the delta is a plain merge patch over the Actor's fields,
 * and the `items` / `effects` collections are REPLACED wholesale when the delta
 * mentions them, inherited untouched when it does not. REQ-DOC-035 keeps the
 * door open for an item-granular delta in V2 without changing the stored shape.
 *
 * This module is pure and I/O-free ON PURPOSE: the server routes mutations
 * through it (REQ-DOC-034) and the client renders sheets and token bars from
 * it. Two copies of this merge would be two different actors on the same
 * token — the classic defect this codebase already paid for elsewhere.
 */

/**
 * A merge patch over an Actor's fields. Shapeless by design: `system` is
 * system-specific (PF2e, SF2e, Etmos) and the engine must not know its schema.
 */
export type ActorDelta = Record<string, unknown>;

/**
 * Top-level keys whose sub-objects use deleteKey semantics when the patch
 * carries a `null` — the same scoping REQ-DOC-037 defines for document
 * updates, so `system.attributes.ac = null` means "this token has no AC"
 * rather than "this token's AC is null".
 *
 * Outside these namespaces a `null` is a legitimate value (an unlinked token
 * with `img: null` renders the placeholder silhouette).
 */
const DELETE_KEY_NAMESPACES = new Set<string>(["flags", "system"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep merge with the engine's canonical semantics:
 *   - plain objects merge recursively;
 *   - arrays REPLACE (this is what makes `items` an integral substitution);
 *   - primitives replace;
 *   - `null` deletes the key when `inDeleteScope`, otherwise sets it.
 *
 * Mirrors `packages/server/src/documents/merge.ts` — the server cannot import
 * this file's twin (shared may not depend on server, REQ-ARQ-002) and this
 * file may not import the server's, so the two implementations are kept
 * behaviourally identical and cross-checked by tests on both sides.
 */
function deepMergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
  inDeleteScope: boolean,
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...target };

  for (const key of Object.keys(patch)) {
    const patchVal = patch[key];
    const targetVal = output[key];

    if (patchVal === null) {
      if (inDeleteScope) {
        Reflect.deleteProperty(output, key);
      } else {
        output[key] = null;
      }
      continue;
    }

    if (isPlainObject(patchVal) && isPlainObject(targetVal)) {
      output[key] = deepMergeInto(
        targetVal,
        patchVal,
        inDeleteScope || DELETE_KEY_NAMESPACES.has(key),
      );
      continue;
    }

    // Arrays, primitives, and any object landing on a non-object: replacement.
    output[key] = patchVal;
  }

  return output;
}

/**
 * Is this delta carrying nothing at all?
 *
 * A token that is unlinked but has never been touched reads exactly as its
 * base Actor, and callers use this to skip the reconstruction entirely (and,
 * on the server, to skip a redaction pass that would otherwise clone every
 * scene on every broadcast).
 */
export function isActorDeltaEmpty(delta: unknown): boolean {
  if (!isPlainObject(delta)) return true;
  return Object.keys(delta).length === 0;
}

/**
 * Rebuild the TokenActor: the base Actor with the token's delta applied.
 *
 * Never mutates either argument and never returns a reference into them at the
 * top level, so two tokens sharing a base Actor can be reconstructed
 * independently and mutated independently by their callers.
 *
 * A malformed delta (a string where an object was expected) replaces the field
 * rather than throwing — this runs inside the broadcast path and a bad token
 * must not be able to take the world's sync down with it.
 */
export function applyActorDelta(
  baseActor: Record<string, unknown> | null | undefined,
  delta: ActorDelta | null | undefined,
): Record<string, unknown> {
  const base = isPlainObject(baseActor) ? baseActor : {};
  if (isActorDeltaEmpty(delta)) return { ...base };
  return deepMergeInto(base, delta as Record<string, unknown>, false);
}

/**
 * Fold an incoming patch into the delta already stored on the token.
 *
 * Unlike {@link applyActorDelta}, `null` is STORED rather than deleting the
 * key: the delta is what remembers "this token has no AC", and dropping the
 * key here would silently restore the base Actor's value on the next read.
 * The deletion is honoured later, when the delta is applied.
 */
export function mergeActorDelta(
  current: ActorDelta | null | undefined,
  patch: ActorDelta,
): ActorDelta {
  const base = isPlainObject(current) ? current : {};
  return deepMergeInto(base, patch, false);
}

// ---------------------------------------------------------------------------
// What a client may author into a delta (REQ-CNV-094, DEC-CNV-16)
// ---------------------------------------------------------------------------

/**
 * Top-level actor fields a delta may carry — DEC-DOC-08 describes the delta as
 * a merge patch over the Actor's own fields, with `items`/`effects` REPLACED
 * wholesale when present rather than patched item by item.
 *
 * `items` and `effects` are absent from this list on purpose, and so is
 * `ownership` (privileged even for an owner, REQ-USR-015) and `_id`/`type`
 * (identity, never authored).
 */
const DELTA_SAFE_ROOTS: ReadonlySet<string> = new Set(["name", "img", "system", "flags"]);

/**
 * Does every key of this diff land somewhere a merge patch can hold it?
 *
 * The dangerous shape is the collection mutation the sheets use for conditions
 * and inventory — `items.+`, `items.-<itemId>`. Those are instructions to an
 * ARRAY, and the delta path expands dotted keys into plain objects before
 * merging: `items.-x` becomes `{ items: { "-x": true } }`, and the merge
 * (arrays replace) then substitutes the actor's whole item list with that
 * object. Refusing is the only honest answer until REQ-DOC-035 delivers an
 * item-granular delta.
 *
 * Lives in `@fusion/shared` because BOTH sides need it and neither may own it
 * alone: the client refuses early so the GM sees a warning instead of a silent
 * no-op, and the server refuses because it is the authority — a guard that only
 * the client enforces is not a guard, it is a convention.
 */
export function isDeltaSafeDiff(diff: Record<string, unknown>): boolean {
  const keys = Object.keys(diff);
  if (keys.length === 0) return false;
  return keys.every((key) => {
    const parts = key.split(".");
    const root = parts[0] ?? "";
    if (!DELTA_SAFE_ROOTS.has(root)) return false;
    // A `+` / `-<id>` segment anywhere is an array instruction, whatever it is
    // nested under.
    return !parts.some((p) => p === "+" || p.startsWith("-"));
  });
}

/** The token fields this module reads. Structural so both sides can pass their own type. */
export interface TokenActorSource {
  /** REQ-DOC-031. Absent reads as `true` — tokens persisted before the field existed are linked. */
  actorLink?: boolean | undefined;
  /** REQ-DOC-033. */
  actorDelta?: ActorDelta | null | undefined;
}

/**
 * The actor this token actually plays with (REQ-DOC-032 / REQ-DOC-033).
 *
 * Linked → the world Actor itself, returned BY REFERENCE: a linked token is
 * not a copy of the actor, it is the actor, and copying it here would hide
 * mutations from callers that hold the original.
 *
 * Unlinked → a freshly reconstructed TokenActor.
 *
 * Returns `null` when there is no base Actor: a token without an actor has no
 * sheet, no hit points and no bars, and callers must render it as scenery.
 */
export function effectiveTokenActor(
  token: TokenActorSource | null | undefined,
  baseActor: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!token || !isPlainObject(baseActor)) return null;
  if (token.actorLink !== false) return baseActor;
  return applyActorDelta(baseActor, token.actorDelta);
}
