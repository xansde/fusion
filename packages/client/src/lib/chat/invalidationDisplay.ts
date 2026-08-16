/**
 * invalidationDisplay.ts — who voided a message, in words the log can print.
 *
 * REQ-ACH-081 asks the invalidated message to say WHO invalidated it, and the
 * document only carries a user id (`invalidatedBy`, REQ-ACH-084). Turning that
 * id into a readable name is presentation, not state, so it lives here as a
 * pure function instead of inside the component — the log has no directory of
 * users of its own and must not grow one.
 *
 * The fallback is deliberate: when the id resolves to nobody the id itself is
 * shown. A stamp that says "invalidada por —" would be worse than a raw id: the
 * requirement is that the reader can tell whose call it was.
 */

import type { ChatMessage } from "@fusion/shared";

/** The shape this module needs from whatever user directory the client has. */
export interface NamedUser {
  readonly userId: string;
  readonly userName: string;
}

/**
 * Display name of whoever performed the last invalidation, or `null` when the
 * message carries no such record (never invalidated).
 *
 * Note it does NOT depend on `invalid`: the record survives revalidation
 * (REQ-ACH-084), and it is the caller — the message row — that decides to show
 * the stamp only while the message stands voided.
 */
export function resolveInvalidatorLabel(
  msg: Pick<ChatMessage, "invalidatedBy">,
  users: readonly NamedUser[],
): string | null {
  const id = msg.invalidatedBy;
  if (id === undefined || id === "") return null;
  const known = users.find((u) => u.userId === id);
  return known?.userName ?? id;
}
