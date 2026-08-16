/**
 * pack-audience.mjs — the ONE rule that decides a published pack's audience.
 *
 * REQ-CMP-004a, REQ-CPD-072, REQ-PF2-140, REQ-PF2-141, REQ-PF2-142, REQ-PF2-143.
 *
 * The audience is derived from what the pack CONTAINS, never from a
 * hand-maintained list of slugs. A slug list only ever covers the packs someone
 * remembered to add to it: the next creature pack (`bestiary-2`, a monster pack
 * for a new adventure, the first hazard pack) would be born published to the
 * players, and no tripwire would notice — which is exactly the failure
 * REQ-PF2-141 forbids when it binds "qualquer pack de criaturas que o sistema
 * venha a publicar depois" and REQ-PF2-142 when it forbids deciding a hazard
 * pack's audience "caso a caso na geração".
 *
 * Declaring the audience is not enforcing it: the server-side read API is what
 * keeps a `gm` pack out of listings, searches and document reads
 * (REQ-CMP-010a, REQ-CPD-071, REQ-CPD-074). And the audience never touches the
 * documents themselves (REQ-PF2-144) — it is manifest metadata, editable
 * without regenerating a single document.
 *
 * This module is deliberately import-safe (no side effects, no CLI main) so the
 * rule can be unit-tested against packs that do not exist yet.
 */

/**
 * Document `type`s whose presence makes the whole pack GM-only.
 *
 * - `npc`   — creatures: a creature pack read by a player is the monster manual
 *             open on the table (REQ-CPD-072, REQ-PF2-141).
 * - `hazard` — hazards (REQ-PF2-142); no pack carries one yet, and that is
 *             precisely why the rule must be by content and not by slug.
 *
 * @type {ReadonlySet<string>}
 */
export const GM_ONLY_DOCUMENT_TYPES = new Set(["npc", "hazard"]);

/**
 * Escape hatch for a pack whose GM-only nature is NOT visible in its document
 * types. Empty by design: every pack published today is classified by content.
 * Adding a slug here is an explicit, documented exception — never the normal
 * way to publish a creature or hazard pack.
 *
 * @type {ReadonlySet<string>}
 */
export const GM_ONLY_PACK_SLUGS = new Set();

/**
 * Resolve the audience a pack must be published with.
 *
 * @param {string} slug — the pack's directory slug (e.g. "bestiary-core").
 * @param {ReadonlyArray<{ type?: unknown }>} docs — the documents being written.
 * @returns {"gm" | "all"}
 */
export function resolvePackAudience(slug, docs) {
  if (GM_ONLY_PACK_SLUGS.has(slug)) return "gm";
  for (const doc of docs ?? []) {
    if (doc && typeof doc.type === "string" && GM_ONLY_DOCUMENT_TYPES.has(doc.type)) {
      return "gm";
    }
  }
  return "all";
}
