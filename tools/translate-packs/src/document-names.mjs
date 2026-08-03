/**
 * document-names.mjs — pure logic for building the EN→pt-BR document-name
 * index consumed by the client's prerequisite-translation renderer (issue
 * #32). No filesystem access — safe to unit-test and to import from the CLI
 * generator (tools/translate-packs/gen-prerequisite-names.mjs).
 */

/**
 * Merge multiple packs' documents+overlay into a single EN(lowercased)→pt-BR
 * name index.
 *
 * `packsInPriorityOrder` is an array of `{ docs, overlay }`, EARLIEST pack
 * wins a cross-pack collision (see gen-prerequisite-names.mjs for why
 * feats-core goes first: every prerequisite-bearing document lives there, so
 * a same-name sibling feat is the most likely intended match).
 *
 * A name that appears MORE THAN ONCE within the SAME pack with DIFFERING
 * pt-BR translations is dropped for that pack (never guessed) rather than
 * silently picking whichever happened to be seen first.
 *
 * @param {Array<{docs: Array<{_id: string, name: string}>, overlay: {entries: Record<string, {name?: string}>}}>} packsInPriorityOrder
 * @returns {Map<string, string>}
 */
export function buildDocumentNameIndex(packsInPriorityOrder) {
  const index = new Map();

  for (const { docs, overlay } of packsInPriorityOrder) {
    const seenInPack = new Map(); // normalized EN name -> pt name | null (ambiguous)
    for (const doc of docs) {
      const entry = overlay?.entries?.[doc._id];
      if (!entry?.name) continue;
      const key = doc.name.trim().toLowerCase();
      if (seenInPack.has(key)) {
        if (seenInPack.get(key) !== entry.name) seenInPack.set(key, null);
      } else {
        seenInPack.set(key, entry.name);
      }
    }

    for (const [key, pt] of seenInPack.entries()) {
      if (pt === null) continue; // ambiguous within this pack — skip
      if (!index.has(key)) index.set(key, pt); // earlier pack in priority order already won
    }
  }

  return index;
}
