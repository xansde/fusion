/**
 * invalidateButton.ts — pure decision of what invalidate/revalidate control (if
 * any) ChatMessage.svelte should render for the current viewer.
 *
 * Mirrors `mayChangeInvalidation` in `packages/server/src/chat/chat-handler.ts`
 * (REQ-ACH-082/083) on the client, so the button ChatMessage.svelte shows never
 * promises an action the server is about to refuse. The server is still the
 * ONLY enforcement point (REQ-ACH-090, REQ-ACH-082/083 "o servidor DEVE
 * recusar") — this module decides visibility, not permission.
 *
 * REQ-ACH-080: there is no deletion path; every control this resolves to is
 * either "invalidate" or "revalidate", never a delete.
 * REQ-ACH-082: invalidating (`invalid === false` → wants `true`) is offered to
 * the GAMEMASTER (role === GAMEMASTER, strictly — callers pass the same `isGm`
 * TableScreen computes, `session.user.role === 4`, not `isRolePrivileged`,
 * which also admits ASSISTANT_GM and governs a different question:
 * visibility) and to the AUTHOR of the message.
 * REQ-ACH-083: revalidating (`invalid === true` → wants `false`) is offered to
 * the GM always; to the author ONLY when the standing invalidation carries his
 * own userId — a GM's invalidation is the last word, and the button must not
 * even appear for the author to try taking it back.
 * REQ-ACH-084: the decision reads `invalidatedBy`, the same field the server
 * stamps on invalidate and preserves through revalidation.
 */

export type InvalidateAction = "invalidate" | "revalidate" | null;

export interface InvalidateButtonMessage {
  // Both optional AND explicitly `| undefined`: this project's tsconfig sets
  // exactOptionalPropertyTypes, under which a plain `invalid?: boolean` only
  // accepts an ABSENT key, not an explicit `undefined` value — but
  // ChatMessage's own fields (z.boolean().optional()/z.string().optional())
  // are typed `boolean | undefined`/`string | undefined` and DO get passed
  // through explicitly. The union has to name both shapes to accept either.
  invalid?: boolean | undefined;
  invalidatedBy?: string | undefined;
  speaker: { userId: string };
}

/**
 * Which button (if any) the viewer should see for `message`.
 *
 * @param message  The chat message being rendered.
 * @param isGm     Whether the viewer's role is GAMEMASTER, strictly (matches
 *                 the server's `GAMEMASTER_ROLE` check, not `isRolePrivileged`).
 * @param userId   The viewer's own user id. An empty string never matches an
 *                 author (a message never has an empty `speaker.userId`).
 */
export function resolveInvalidateAction(
  message: InvalidateButtonMessage,
  isGm: boolean,
  userId: string,
): InvalidateAction {
  const isAuthor = userId !== "" && message.speaker.userId === userId;
  const isInvalid = message.invalid === true;

  if (!isInvalid) {
    // REQ-ACH-082: invalidate is the GM's or the AUTHOR's.
    return isGm || isAuthor ? "invalidate" : null;
  }

  // REQ-ACH-083: revalidate is always the GM's; the author's only if the
  // standing invalidation is his own — a GM's invalidation cannot be undone
  // by the author.
  if (isGm) return "revalidate";
  if (isAuthor && message.invalidatedBy === userId) return "revalidate";
  return null;
}
