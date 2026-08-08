/**
 * ownedActors.ts — resolve which Actors the local user owns.
 *
 * Spec: 05-usuarios-e-permissoes.md §REQ-USR-005 (role ladder), §REQ-USR-006
 * (GM has implicit OWNER on all documents).
 *
 * TokenInteractionManager needs this set to answer "can this user drag this
 * token?" (canMoveToken). It lives in a .ts module, not inline in the Svelte
 * component, so the permission rule is testable without mounting a canvas.
 *
 * The client-side answer is a CONVENIENCE, not the gate: the server revalidates
 * every token move in doc-handlers. A wrong set here shows a rollback, not a
 * security hole.
 */

import { getUserLevel, OwnershipLevel } from "@fusion/shared";
import type { Ownership } from "@fusion/shared";
import { ROLE_ASSISTANT } from "./token-interaction.js";

/** The slice of DocumentMirror this module needs — keeps the unit test tiny. */
export interface ActorSource {
  getByType<T>(type: string): T[];
}

interface OwnableActor {
  _id: string;
  ownership?: Ownership;
}

/**
 * Return the set of Actor IDs the given user owns.
 *
 * GM and Assistant (role >= 3) own everything, matching the blanket move
 * permission canMoveToken() grants them.
 *
 * @param mirror   Document source (the world DocumentMirror).
 * @param userId   Local user id; null/empty yields an empty set.
 * @param userRole Numeric role: 1=PLAYER, 2=TRUSTED, 3=ASSISTANT, 4=GAMEMASTER.
 */
export function resolveOwnedActorIds(
  mirror: ActorSource,
  userId: string | null | undefined,
  userRole: number,
): ReadonlySet<string> {
  const owned = new Set<string>();
  if (!userId) return owned;

  const actors = mirror.getByType<OwnableActor>("Actor");

  for (const actor of actors) {
    if (userRole >= ROLE_ASSISTANT) {
      // REQ-USR-006: GM/Assistant hold implicit OWNER on every document.
      owned.add(actor._id);
      continue;
    }
    // An actor persisted without an ownership map is nobody's but the GM's.
    if (!actor.ownership) continue;
    if (getUserLevel(actor.ownership, userId) >= OwnershipLevel.OWNER) {
      owned.add(actor._id);
    }
  }

  return owned;
}
