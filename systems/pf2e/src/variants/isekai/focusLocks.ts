/**
 * @fusion/system-pf2e — Isekai variant: the Focus locks.
 *
 * WHY THIS FILE IS SO SMALL, when the layer has eight archetypes worth of
 * content: the SERVER only ever needs to answer one question about Isekai —
 * "how much of this character's Focus maximum is locked away?". Blessing text,
 * action costs, tracker widgets and colours are things the SHEET renders, and
 * the client owns them (`packages/client/src/lib/sheets/pf2e/isekai/`), which
 * is also the only way to respect the arch boundary the Plan VM declares (the
 * client must not import from systems/pf2e).
 *
 * So the split is by NEED, not by theme:
 *   - here: the mechanical fact the derivation consumes.
 *   - client: the content the player reads.
 *
 * Adding a NEW archetype that buys power with permanent pool means adding a
 * row to `ISEKAI_FOCUS_LOCK_SOURCES` here as well as the content on the client
 * side. The client's `isekai-data.test.ts` asserts the two lists agree, so a
 * half-registered archetype fails a test instead of silently never locking.
 */

import { ISEKAI_FOCUS_FLOOR } from "./params.js";

/**
 * Persisted tracker state, as it sits on `system.isekai.trackers`: archetype
 * id → tracker id → whatever that tracker keeps.
 *
 * Deliberately `unknown` at the leaf. Seven tracker kinds write seven shapes,
 * documents are edited by older clients and by hand, and a strict union here
 * would reject data instead of carrying it. Every consumer narrows.
 */
export type IsekaiTrackerState = Record<string, Record<string, unknown>>;

/**
 * Every place in the layer where a player choice permanently locks a point of
 * the Focus maximum.
 *
 * Two archetypes do this, and both trade the same way — power now, pool
 * forever:
 *   - Carismático "Dar um Nome": each ★ Named companion locks 1 point.
 *   - Especialista "Ensinar a Técnica": each ★ taught Signature locks 1 point.
 *
 * `flag` is the boolean field on each entry of the tracker's array that marks
 * it as locking.
 */
export const ISEKAI_FOCUS_LOCK_SOURCES: readonly {
  readonly archetypeId: string;
  readonly trackerId: string;
  readonly flag: string;
}[] = [
  { archetypeId: "carismatico", trackerId: "retinue", flag: "named" },
  { archetypeId: "especialista", trackerId: "signatures", flag: "flag" },
];

/** Count entries of `value` (an array) whose `flag` field is truthy. */
function truthyFlagCount(value: unknown, flag: string): number {
  if (!Array.isArray(value)) return 0;
  let count = 0;
  for (const entry of value) {
    if (entry !== null && typeof entry === "object" && (entry as Record<string, unknown>)[flag]) {
      count++;
    }
  }
  return count;
}

/**
 * How many points of the Focus MAXIMUM the layer has locked away.
 *
 * Capped at `ISEKAI_FOCUS_FLOOR`: a character who names six companions still
 * needs a pool to spend from. Locking more than the pool holds is not a
 * meaningful state, and letting the number run past the maximum would zero
 * the pips with no explanation on screen.
 *
 * Total by construction — unknown archetype ids and malformed state count as
 * zero rather than throwing. A document can outlive a content edit.
 */
export function isekaiLockedFocus(
  archetypeIds: readonly string[],
  trackers: IsekaiTrackerState | undefined,
): number {
  if (!trackers) return 0;
  const picked = new Set(archetypeIds);
  let locked = 0;
  for (const source of ISEKAI_FOCUS_LOCK_SOURCES) {
    if (!picked.has(source.archetypeId)) continue;
    // Read through `unknown`: the declared type says "record of records", but
    // this value came off a document, where it can be anything at all.
    const state: unknown = trackers[source.archetypeId];
    if (state === null || typeof state !== "object") continue;
    locked += truthyFlagCount((state as Record<string, unknown>)[source.trackerId], source.flag);
  }
  return Math.min(locked, ISEKAI_FOCUS_FLOOR);
}
