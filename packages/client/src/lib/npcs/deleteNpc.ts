/**
 * deleteNpc.ts — the client side of deleting a non-playable (spec 42 §5.7, G075).
 *
 * Deleting is the only irreversible gesture of this tab, and REQ-NPC-051 says the
 * confirmation has to SHOW what falls with the actor before it falls: how many
 * presences are on the table and in which scenes, the knowledge the world holds
 * about it, and the sheet with its embedded items. This module owns the two calls
 * that make that possible and the two predicates the window reads:
 *
 *  - **The reading is `actor:deletePreview`** (G075, server lane) and not a count
 *    made here. Two of the three answers are not in this client's mirror to count:
 *    a scene this seat never received is not in `worldMirror`, and knowledge is
 *    stripped from every non-privileged payload (REQ-CTT-084). Re-deriving the
 *    numbers locally would also let the confirmation drift from the rule the
 *    server actually applies on delete — which is exactly what a confirmation
 *    dialog must never do.
 *  - **The deleting is the ordinary `doc:delete`** (REQ-NPC-050). There is no
 *    second op: the presences (REQ-NPC-053) and the knowledge (REQ-NPC-054) fall
 *    server-side as a consequence of that one call, so this module has no sweep of
 *    its own to forget to run.
 *
 * **The tab does not delete a player character** (REQ-NPC-055, DEC-NPC-02), and the
 * guard is not a second list: {@link isDeletableNpcSubtype} asks the very list that
 * decides which actors this tab LISTS (`NON_PLAYABLE_SUBTYPES`). A subtype the tab
 * never draws is a subtype it can never offer to delete, and the two cannot drift
 * apart into a tab that shows one set and deletes another.
 *
 * Hiding the control is not the protection either — the server refuses the same
 * write (REQ-NPC-080), and this module surfaces the refusal instead of swallowing
 * it, which is why REQ-NPC-052's refusal can arrive at confirm time (an encounter
 * started between reading and confirming) and still be shown.
 */

import type { Socket } from "socket.io-client";
import type { ActorDeleteKnowledgeSummary, ActorDeletePreviewResult } from "@fusion/shared";
import { KnowledgeState } from "@fusion/shared";

import { sendOp } from "../docs/sendOp.js";
import { NON_PLAYABLE_SUBTYPES } from "./folderTree.js";

/**
 * True for a subtype this tab may delete (REQ-NPC-050, REQ-NPC-055).
 *
 * The list is the tab's own listing list, borrowed rather than repeated: a
 * `character` is not a row of this tab, so it is not a deletion of this tab
 * either — in any role, including the Mestre's.
 */
export function isDeletableNpcSubtype(subtype: string | null | undefined): boolean {
  return typeof subtype === "string" && NON_PLAYABLE_SUBTYPES.includes(subtype);
}

/**
 * REQ-NPC-051: read what the delete would take with it.
 *
 * Read-only on the server: it advances no `seq` and persists nothing, so opening
 * the confirmation and closing it again changes nothing on the table.
 */
export async function loadActorDeletePreview(
  socket: Socket,
  actorId: string,
): Promise<ActorDeletePreviewResult> {
  return sendOp<ActorDeletePreviewResult>(socket, {
    type: "actor:deletePreview",
    payload: { actorId },
  });
}

export interface DeleteNpcOp {
  readonly type: "doc:delete";
  readonly payload: {
    readonly documentType: "Actor";
    readonly ids: readonly string[];
  };
}

/**
 * The `doc:delete` for one non-playable, or null when the tab must not send it —
 * an empty id, or a subtype this tab does not delete (REQ-NPC-055).
 */
export function buildDeleteNpcOp(
  actorId: string,
  subtype: string | null | undefined,
): DeleteNpcOp | null {
  if (actorId.length === 0) return null;
  if (!isDeletableNpcSubtype(subtype)) return null;
  return { type: "doc:delete", payload: { documentType: "Actor", ids: [actorId] } };
}

/**
 * REQ-NPC-050: delete the non-playable. Resolves false when the tab refused to
 * even ask (nothing is emitted); throws the server's refusal otherwise, so
 * REQ-NPC-052 reaches the reader instead of being swallowed.
 */
export async function deleteNpc(
  socket: Socket,
  actorId: string,
  subtype: string | null | undefined,
): Promise<boolean> {
  const op = buildDeleteNpcOp(actorId, subtype);
  if (op === null) return false;
  await sendOp(socket, op);
  return true;
}

/**
 * REQ-NPC-052: whether an unfinished encounter blocks this delete.
 *
 * Read from the encounters themselves and not only from the server's `deletable`
 * flag, so a preview built by an older server that omitted the flag still blocks
 * rather than silently offering a delete the server will refuse.
 */
export function isDeleteBlocked(preview: ActorDeletePreviewResult | null): boolean {
  if (preview === null) return false;
  return !preview.deletable || preview.blockingCombats.length > 0;
}

/**
 * REQ-NPC-054: whether anything of the knowledge about this actor actually falls.
 *
 * A general rule of `hidden` with no exception and nobody who knows or glimpsed is
 * the world having recorded nothing — and a confirmation that announces the loss
 * of nothing teaches the reader to stop reading confirmations.
 */
export function knowledgeFalls(knowledge: ActorDeleteKnowledgeSummary): boolean {
  return (
    knowledge.general !== KnowledgeState.Hidden ||
    knowledge.exceptionCount > 0 ||
    knowledge.knownBy > 0 ||
    knowledge.glimpsedBy > 0
  );
}
