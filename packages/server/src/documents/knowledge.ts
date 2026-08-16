/**
 * Contact knowledge, server side — reading, patching and sweeping the map
 * that lives on the contact's OWN Actor document (spec 39 §5.8 and §7).
 *
 * There is no knowledge table and no migration: `39-contatos.md` §7 says the
 * general rule and the exceptions are stored "no próprio contato, no
 * `world.db`", and `42-aba-npcs.md` §7 repeats it for non-playables. A
 * document is JSON in the store, so the map is simply
 * `flags.fusion.knowledge` (`KNOWLEDGE_FLAG_PATH` in `@fusion/shared`).
 *
 * This module owns exactly two jobs the pure helpers cannot do, because both
 * need the store:
 *
 *   1. turning an edit into a PATCH that also PRUNES. `deepMerge` is additive
 *      inside `flags`, so handing it the new exception map would merge the new
 *      keys over the old ones and a removed exception would survive forever —
 *      the same trap `system.derived` fell into (see documents/merge.ts).
 *      `prunedPatch` re-expresses every vanished key as an explicit `null`,
 *      which inside `flags` is deleteKey (REQ-DOC-037).
 *
 *   2. sweeping a deleted character out of every contact's exceptions
 *      (REQ-CTT-076), leaving each general rule exactly as it was.
 *
 * REQ-CTT-074: nothing here consults or writes `ownership`. Knowledge only
 * restricts what a user is shown; it never grants access the document denies.
 */

import {
  readKnowledgeMap,
  applyKnowledgeEdit,
  dropCharacterFromKnowledge,
  knowledgeMapsEqual,
  normalizeKnowledge,
  KNOWLEDGE_FLAG_NAMESPACE,
  KNOWLEDGE_FLAG_KEY,
} from "@fusion/shared";
import type { ActorKnowledgeEdit, KnowledgeMap } from "@fusion/shared";
import { prunedPatch } from "./merge.js";
import type { DocumentStore, AuthorContext } from "./store.js";

/**
 * The Actor subtypes whose ids may appear as exception keys (spec 39 §5.8).
 *
 * Spec 39 says "personagem", not "um subtipo chamado `character`": each system
 * names its playable Actor itself, and the manifests disagree — pf2e and sf2e
 * call it `character`, etmos calls it `orador`
 * (`documentTypes.Actor` in `systems/etmos/src/index.ts`). Reading a single
 * literal would leave an Etmos world with no characters at all: no exception
 * would ever apply (REQ-CTT-071), every other player's character would be
 * filtered out of the payload (REQ-CTT-014) and the grid could not be edited
 * (REQ-CTT-064).
 *
 * The server package does not import a system package (arch boundary), so the
 * playable subtypes are mirrored by hand here — the same mirror
 * `packages/client/src/lib/contacts/contactsVM.ts` keeps for the panel.
 */
export const PLAYER_CHARACTER_SUBTYPES: ReadonlySet<string> = new Set(["character", "orador"]);

/** True for an Actor document that is a player character, in any system. */
export function isCharacterActor(doc: Record<string, unknown>): boolean {
  const type = doc["type"];
  return typeof type === "string" && PLAYER_CHARACTER_SUBTYPES.has(type);
}

/**
 * The Actor subtypes knowledge is ABOUT — the contacts of spec 39 §5.5.
 *
 * Same hand-mirror discipline as {@link PLAYER_CHARACTER_SUBTYPES}, and an
 * allow-list for the same reason the client keeps one: the complement of "is a
 * character" is a different, larger set. pf2e also declares `loot` (the chest,
 * DEC-NPC-08) and `familiar` (a companion, DEC-CTT-06); spec 42 §3 names the
 * non-playable vocabulary as `npc`/`hazard`, and etmos calls it `antagonista`.
 *
 * Subjecting `loot` to the knowledge filter would take an actor a player already
 * reaches through `ownership` — a party stash shared at OBSERVER — away from him
 * until the Mestre wrote knowledge on it, which is knowledge RESTRICTING what
 * ownership granted for a document knowledge was never about (REQ-CTT-074).
 */
export const NON_PLAYABLE_SUBTYPES: ReadonlySet<string> = new Set(["npc", "hazard", "antagonista"]);

/** True for an Actor document that is a non-playable character, in any system. */
export function isNonPlayableActor(doc: Record<string, unknown>): boolean {
  const type = doc["type"];
  return typeof type === "string" && NON_PLAYABLE_SUBTYPES.has(type);
}

/** The raw flag value as stored, before any interpretation. */
function rawKnowledgeValue(doc: Record<string, unknown>): unknown {
  const flags = doc["flags"];
  if (typeof flags !== "object" || flags === null || Array.isArray(flags)) return undefined;
  const namespace = (flags as Record<string, unknown>)[KNOWLEDGE_FLAG_NAMESPACE];
  if (typeof namespace !== "object" || namespace === null || Array.isArray(namespace)) {
    return undefined;
  }
  return (namespace as Record<string, unknown>)[KNOWLEDGE_FLAG_KEY];
}

/**
 * A document patch that writes `next` over whatever the document currently
 * holds, deleting the exception keys that `next` no longer has.
 */
export function knowledgePatchFor(
  doc: Record<string, unknown>,
  next: KnowledgeMap,
): Record<string, unknown> {
  return {
    flags: {
      [KNOWLEDGE_FLAG_NAMESPACE]: {
        [KNOWLEDGE_FLAG_KEY]: prunedPatch(rawKnowledgeValue(doc), next),
      },
    },
  };
}

/**
 * Apply one edit to a contact document.
 *
 * Returns the patch to persist and the resulting canonical map, or `null`
 * when the edit changes nothing — a no-op must not advance `seq` or wake
 * every client (REQ-DOC-038).
 */
export function planKnowledgeEdit(
  doc: Record<string, unknown>,
  edit: ActorKnowledgeEdit,
): { patch: Record<string, unknown>; next: KnowledgeMap } | null {
  const current = readKnowledgeMap(doc);
  const next = applyKnowledgeEdit(current, edit);
  if (knowledgeMapsEqual(current, next)) return null;
  return { patch: knowledgePatchFor(doc, next), next };
}

/**
 * Sanitize a knowledge map arriving on a `doc:create` payload.
 *
 * A non-privileged creator gets the flag dropped entirely: the only Actor a
 * player may create is their own companion (r17-P1), and knowledge is a
 * privileged write everywhere else (REQ-CTT-080) — accepting it here would be
 * the door left open next to the one `doc:update` just locked. A privileged
 * creator keeps the map, normalized, so a contact cannot be born with an
 * exception that merely repeats its general rule (REQ-CTT-072).
 */
export function sanitizeKnowledgeOnCreate(
  item: Record<string, unknown>,
  privileged: boolean,
): Record<string, unknown> {
  const raw = rawKnowledgeValue(item);
  if (raw === undefined) return item;

  const flags = item["flags"] as Record<string, unknown>;
  const namespace = flags[KNOWLEDGE_FLAG_NAMESPACE] as Record<string, unknown>;
  const nextNamespace: Record<string, unknown> = { ...namespace };
  if (privileged) {
    nextNamespace[KNOWLEDGE_FLAG_KEY] = normalizeKnowledge(readKnowledgeMap(item));
  } else {
    Reflect.deleteProperty(nextNamespace, KNOWLEDGE_FLAG_KEY);
  }
  return { ...item, flags: { ...flags, [KNOWLEDGE_FLAG_NAMESPACE]: nextNamespace } };
}

/**
 * Remove every exception naming any of `characterIds` from every Actor in the
 * world, and persist the ones that changed (REQ-CTT-076).
 *
 * No general rule is touched: only the exception keys go. Returns the updated
 * documents so the caller can broadcast a single delta — the clients must not
 * need a reload to stop showing a rule about a character that no longer
 * exists (REQ-CTT-075).
 */
export function sweepCharactersFromKnowledge(
  store: DocumentStore,
  characterIds: readonly string[],
  author?: AuthorContext,
): Record<string, unknown>[] {
  if (characterIds.length === 0) return [];

  const updated: Record<string, unknown>[] = [];
  for (const doc of store.getAll("actors")) {
    const current = readKnowledgeMap(doc);
    let next = current;
    for (const characterId of characterIds) {
      next = dropCharacterFromKnowledge(next, characterId);
    }
    if (knowledgeMapsEqual(current, next)) continue;

    const id = doc["_id"];
    if (typeof id !== "string") continue;
    const result = store.update("actors", id, knowledgePatchFor(doc, next), author);
    if (result !== null) updated.push(result);
  }
  return updated;
}
