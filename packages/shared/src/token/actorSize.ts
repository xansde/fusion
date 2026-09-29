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
 * The shape check is what lets the server forward the value blindly: a category is a short token
 * (letters, digits, `_`, `-`), never free text — so what a player receives from a redacted payload
 * can never be a name, whatever a document holds in that field. The game system, not this module,
 * decides which categories exist; an unknown one simply finds no footprint.
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

/**
 * The actor's size category — `system.derived.size`, else `system.traits.size` (a string, or
 * `{ value }`) — or `undefined` when the actor names none. `system` is the actor's `system` blob.
 */
export function readActorSizeCategory(system: unknown): string | undefined {
  if (!isRecord(system)) return undefined;

  const derived = isRecord(system["derived"]) ? category(system["derived"]["size"]) : undefined;
  if (derived !== undefined) return derived;

  const traits = system["traits"];
  if (!isRecord(traits)) return undefined;
  const size = traits["size"];
  return isRecord(size) ? category(size["value"]) : category(size);
}
