/**
 * chatReveal.ts — client-side logic for "Revelar" (REQ-CHT-045..049).
 *
 * The narrator turns an already-sent private message (a `/gmroll`,
 * `/blindroll`, `/selfroll` or a plain whisper) into a public one. The server
 * owns the whole operation — permission check, mutation and rebroadcast (see
 * buildChatRevealHandler in chat-handler.ts); the client only decides whether
 * to OFFER the action and builds the op that names the message.
 *
 * Plain TS, no Svelte runes: the client's vitest project runs in a `node`
 * environment with no jsdom, so `.svelte` components are never mounted in
 * tests. A decision that lives inside the template is a decision nothing can
 * assert — so the display rule lives here and ChatMessage.svelte just reads it.
 */

import type { ChatMessage } from "@fusion/shared";
import { LOCAL_ID_PREFIX } from "./chatOptimistic.js";

// ---------------------------------------------------------------------------
// Visibility of the message itself
// ---------------------------------------------------------------------------

/**
 * True when the message is private — i.e. there is something to reveal.
 *
 * DEC-CHT-10: privacy is derived from `whisper`/`blind` and NOTHING else. The
 * server derives it from exactly these two fields in all four emission paths,
 * so any extra client-side condition here would put the button out of step with
 * what the server would actually do.
 */
export function isPrivateMessage(message: ChatMessage): boolean {
  return message.whisper.length > 0 || message.blind;
}

/**
 * True when the message carries the reveal audit stamp (REQ-CHT-047).
 *
 * Display only — never a visibility input. `revealedAt` is OPTIONAL rather than
 * nullable precisely so that "never revealed" has ONE spelling: absent. Every
 * message persisted before the field existed reads as not revealed here,
 * without a migration.
 */
export function isRevealedMessage(message: ChatMessage): boolean {
  return message.revealedAt !== undefined;
}

// ---------------------------------------------------------------------------
// Should the "Revelar" button be shown?
// ---------------------------------------------------------------------------

/** Lowest role the server treats as privileged — ASSISTANT (3), see spec 05 REQ-USR-005. */
export const ROLE_PRIVILEGED_MIN = 3;

/**
 * True when this numeric role may reveal (REQ-CHT-045: GM **or Assistant GM**).
 *
 * Mirrors `isRolePrivileged` on the server. It is deliberately NOT the `isGm`
 * flag the chat components pass around: that one is `role === 4`, so using it
 * here would hide the trigger from an Assistant GM the server would gladly
 * obey — a permission that exists with no way to exercise it.
 */
export function canViewerReveal(role: number): boolean {
  return role >= ROLE_PRIVILEGED_MIN;
}

export interface RevealDisplayContext {
  /** Whether the viewer holds a privileged role (GM / Assistant GM). */
  privileged: boolean;
  message: ChatMessage;
}

/**
 * Whether to render the "Revelar" button for this viewer and message.
 *
 * REQ-CHT-045: only a privileged role may reveal — a player must not even see
 * the affordance (the server refuses anyway, REQ-CHT-048; this keeps the UI
 * from advertising a door that is locked).
 * REQ-CHT-048: revealing an already-public message is a server-side no-op, so
 * the button is not offered for one. An already-revealed message is public by
 * construction (the reveal set `whisper: []` / `blind: false`), so it falls out
 * of the same check rather than needing a rule of its own.
 *
 * An optimistic local echo is excluded explicitly: its `_id` is a client-made
 * placeholder the server has never seen, so `chat:reveal` on it could only ever
 * come back NOT_FOUND.
 */
export function canRevealMessage({ privileged, message }: RevealDisplayContext): boolean {
  if (!privileged) return false;
  if (message._id.startsWith(LOCAL_ID_PREFIX)) return false;
  return isPrivateMessage(message);
}

// ---------------------------------------------------------------------------
// Op construction
// ---------------------------------------------------------------------------

export interface RevealOp {
  readonly type: "chat:reveal";
  readonly payload: { readonly worldId: string; readonly messageId: string };
}

/**
 * Build the `chat:reveal` op (REQ-CHT-045).
 *
 * It carries only WHICH message: nothing about the roll travels up, so the
 * client cannot influence what gets published and the seed stays where it was
 * (REQ-CHT-049 — the server re-emits the persisted result verbatim).
 */
export function buildRevealOp(worldId: string, messageId: string): RevealOp {
  return { type: "chat:reveal", payload: { worldId, messageId } };
}
