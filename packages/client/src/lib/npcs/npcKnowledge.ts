/**
 * npcKnowledge.ts — what the NPCs tab may say about knowledge (spec 42 §5.9, G077).
 *
 * The whole of this module is READING. It answers one question — "how many
 * characters know this actor, and how many only glimpsed it" (REQ-NPC-070) — and it
 * exports nothing that could change the answer (REQ-NPC-071). Every mutation of
 * knowledge lives behind ONE door, the "Quem conhece quem" window of the Contatos
 * tab (REQ-NPC-072), reached from `lib/contacts/knowledgeWindow.ts`; opening it from
 * the NPCs footer changes nothing about how the edit travels or who hears it
 * (REQ-NPC-073), because it is literally the same window sending the same op.
 *
 * There is no second model here either (REQ-NPC-072). The counting function is the
 * 39's `contactKnowledgeCounts` (REQ-CTT-044), re-exported rather than rewritten, so
 * a row of this tab and a card of that one cannot disagree about the same actor. The
 * state machine behind it is `@fusion/shared/knowledge.ts`, the very one the server
 * applies (REQ-CTT-070/072) — this file never re-derives it.
 *
 * Two consequences worth naming, because they are requirements rather than details:
 *
 *  - **No map, no counts.** The knowledge map is stripped from every non-privileged
 *    payload (REQ-CTT-084, REQ-NPC-083), so a payload without it yields `null` and
 *    the row draws nothing at all. The counts say what OTHER players' characters
 *    know; they cannot be reconstructed where the map must not exist.
 *  - **The denominator is the table's characters**, and only they: an actor of this
 *    tab is never a column of knowledge, so a world with no player character reads
 *    "0 conhecem" rather than borrowing the general rule.
 */

import {
  contactKnowledgeCounts,
  isPlayerCharacter,
  type ContactActorDoc,
  type ContactKnowledgeCounts,
} from "../contacts/contactsVM.js";

/**
 * The counts of one actor. The SAME shape the Contatos tab carries (REQ-CTT-044) —
 * aliased, not redeclared, so the two tabs share one model (REQ-NPC-072).
 */
export type NpcKnowledgeCounts = ContactKnowledgeCounts;

/** Message drawn in the row (`{{known}} conhecem · {{glimpsed}} entreviram`). */
export const NPC_KNOWLEDGE_COUNTS_KEY = "FUSION.Contacts.Knowledge.Counts";

/** The long form the row exposes to assistive technology, same wording as the 39. */
export const NPC_KNOWLEDGE_LABEL_KEY = "FUSION.Contacts.Knowledge.Label";

/**
 * The ids of the table's characters — the only things knowledge is counted over
 * (REQ-CTT-070: the pair is contact × personagem, never contact × usuário).
 */
export function playerCharacterIds(actors: readonly ContactActorDoc[]): string[] {
  return actors.filter(isPlayerCharacter).map((doc) => doc._id);
}

/**
 * How many characters know and how many glimpsed this non-playable (REQ-NPC-070).
 *
 * `null` when the document carries no knowledge map, which is every non-privileged
 * payload: the row then shows nothing rather than a fabricated zero.
 */
export function npcKnowledgeCounts(
  doc: ContactActorDoc,
  characterIds: readonly string[],
): NpcKnowledgeCounts | null {
  return contactKnowledgeCounts(doc, characterIds);
}

/** What the row needs to draw the counts: one i18n key, one label key, one bag. */
export interface NpcKnowledgeLabel {
  readonly textKey: string;
  readonly labelKey: string;
  readonly vars: { readonly known: number; readonly glimpsed: number };
}

/**
 * Turn the counts into the two i18n calls the row makes (REQ-NPC-070).
 *
 * `null` in, `null` out: "no map" and "nobody knows" are different facts, and only
 * the second one is a sentence worth drawing.
 */
export function describeNpcKnowledge(
  counts: NpcKnowledgeCounts | null | undefined,
): NpcKnowledgeLabel | null {
  if (counts === null || counts === undefined) return null;
  return {
    textKey: NPC_KNOWLEDGE_COUNTS_KEY,
    labelKey: NPC_KNOWLEDGE_LABEL_KEY,
    vars: { known: counts.known, glimpsed: counts.glimpsed },
  };
}
