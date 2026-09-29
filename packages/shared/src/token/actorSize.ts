/**
 * The size category of an actor, read off its `system` — ONE reader, shared by server and client.
 *
 * Spec 17 DEC-PF2-13 / REQ-PF2-154: what the sheet DERIVED (`system.derived.size` — a character
 * with an ancestry: its heritage, the size it chose at creation and the feats that enlarge it
 * included) is what counts, and `system.traits.size` is the fallback — the NPC's own statblock
 * size, or the manual entry of a character that has no ancestry. `traits.size` is a bare string
 * or, on some raw/imported rows, `{ value }` (`NpcSizeSchema` documents both). A character's
 * `traits.size` is never written by anything (it sits at the schema default), which is why the
 * derived size has to be read first.
 *
 * Two consumers, one definition of "the actor's size":
 *   - the client turns it into the token's footprint (`sizeToFootprint`, spec 15 REQ-SYS-009;
 *     spec 41 REQ-TOK-012, REQ-TOK-017);
 *   - the server keeps it in the payload of a contact the user only GLIMPSED — the one piece of
 *     `system` data that travels (spec 39 REQ-CTT-081, amended by spec 17 DEC-PF2-13), because a
 *     token that shows on the map must occupy the same squares for everybody.
 *
 * The shape check is a BOUND, not a name filter: a category is a short token (letters, digits, `_`,
 * `-`, up to 24 characters), so a sentence, a value with spaces or a long string is never forwarded
 * as a size. A single word IS the shape of a category, though — what a document holds in that field is
 * the GM's statblock or the pack (a client cannot write `system.derived`, and does not write an NPC's),
 * and that is where the exposure is bounded, not in this regex. The game system, not this module,
 * decides which categories exist; an unknown one simply finds no footprint (spec 15, REQ-SYS-009).
 *
 * Pure: no I/O, no dependency on any system (REQ-ARQ-002, REQ-ARQ-005).
 */

/** A size category is a short token: `sm`, `lg`, `huge`, `extra-large` — never a sentence. */
const SIZE_CATEGORY = /^[A-Za-z0-9_-]{1,24}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function category(value: unknown): string | undefined {
  return typeof value === "string" && SIZE_CATEGORY.test(value) ? value : undefined;
}

/** A size category and the slot of `system` it was found in. */
export interface ActorSize {
  readonly category: string;
  /** `derived` — `system.derived.size`; `traits` — `system.traits.size`. */
  readonly source: "derived" | "traits";
}

/**
 * The actor's size — `system.derived.size`, else `system.traits.size` (a string, or `{ value }`) —
 * with the slot it was found in, or `undefined` when the actor names none. `system` is the actor's
 * `system` blob. The slot matters to the server: a glimpsed contact keeps the size in the slot it lives
 * in, so an unlinked token override of `traits.size` still merges over it (REQ-DOC-034).
 */
export function readActorSize(system: unknown): ActorSize | undefined {
  if (!isRecord(system)) return undefined;

  const derived = isRecord(system["derived"]) ? category(system["derived"]["size"]) : undefined;
  if (derived !== undefined) return { category: derived, source: "derived" };

  const traits = system["traits"];
  if (!isRecord(traits)) return undefined;
  const size = traits["size"];
  const fromTraits = isRecord(size) ? category(size["value"]) : category(size);
  return fromTraits === undefined ? undefined : { category: fromTraits, source: "traits" };
}

/** The actor's size category alone — see {@link readActorSize}. */
export function readActorSizeCategory(system: unknown): string | undefined {
  return readActorSize(system)?.category;
}
