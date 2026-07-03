/**
 * chatOptimistic.ts — pure logic for optimistic local chat echo (BUG E FIX).
 *
 * No Svelte runes here — this module is deliberately plain TS so it can be
 * unit-tested directly with Vitest (the client's vitest.config.ts does not
 * run the Svelte preprocessor, so `.svelte.ts` files with `$state` cannot be
 * imported in tests; see chatStore.svelte.ts, which is the thin rune-holding
 * wrapper around these functions).
 *
 * Responsibilities:
 *   - Decide whether a raw chat input is safe to echo locally before the
 *     server round-trip (isOptimisticallyRenderable).
 *   - Build the provisional ChatMessage shown while the send is in flight
 *     (buildProvisionalMessage).
 *   - Reconcile the provisional entry with the server's canonical message,
 *     or drop it on failure (reconcileProvisional / removeMessageById —
 *     both operate on a plain array in place, mirroring insertMessage's
 *     splice-based mutation style in chatStore.svelte.ts).
 */

import type { ChatMessage } from "@fusion/shared";
import { parseChatCommand, createDocumentId, defaultStats, defaultOwnership } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal speaker identity needed to render a provisional message.
 * The server resolves the REAL speaker (alias, token/actor linkage) —
 * this is only used for the instant local echo before the ack arrives.
 */
export interface ProvisionalSpeaker {
  userId: string;
  /** Display name shown until the ack reconciles with the server's alias. */
  alias: string;
}

/** Prefix marking a message as a local optimistic placeholder, never sent to the server. */
export const LOCAL_ID_PREFIX = "local-";

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * True when `content` is eligible for optimistic local rendering.
 *
 * Only plain text with NO inline `[[roll]]` expressions is safe to echo
 * locally — everything else (slash commands, whisper, emote, rolls) needs
 * server-computed data (RNG results, resolved whisper targets, etc.) that the
 * client cannot fabricate (CLAUDE.md: rolls always execute server-side).
 * Rendering a fake roll total client-side would be an anti-cheat violation,
 * not just a display bug.
 */
export function isOptimisticallyRenderable(content: string): boolean {
  const parsed = parseChatCommand(content);
  return parsed.kind === "text" && parsed.inlineRolls.length === 0;
}

// ---------------------------------------------------------------------------
// Provisional message construction
// ---------------------------------------------------------------------------

/**
 * Build a provisional ChatMessage for instant local echo.
 * Never sent to the server — replaced by reconcileProvisional() once the
 * ack with the canonical message arrives (or removed on failure).
 */
export function buildProvisionalMessage(content: string, speaker: ProvisionalSpeaker): ChatMessage {
  return {
    _id: `${LOCAL_ID_PREFIX}${createDocumentId()}`,
    _stats: {
      ...defaultStats(),
      createdBy: speaker.userId,
      lastModifiedBy: speaker.userId,
    },
    sort: 0,
    ownership: defaultOwnership(),
    flags: {},
    type: "text",
    worldId: "",
    content,
    speaker: { userId: speaker.userId, alias: speaker.alias },
    timestamp: Date.now(),
    whisper: [],
    blind: false,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation (in-place array mutation, mirrors insertMessage's style)
// ---------------------------------------------------------------------------

/**
 * Replace the provisional message (by local id) with the server's canonical
 * message in place, so the row doesn't jump position. If the canonical
 * message somehow already arrived via broadcast first (dedup race), the
 * provisional is simply removed instead of creating a duplicate.
 *
 * Mutates `messages` in place (splice), matching insertMessage()'s style so
 * Svelte 5 `$state` array reactivity picks up the change without a full
 * reassignment.
 */
export function reconcileProvisional(
  messages: ChatMessage[],
  provisionalId: string,
  canonical: ChatMessage,
): void {
  const alreadyPresent = messages.some((m) => m._id === canonical._id);
  const idx = messages.findIndex((m) => m._id === provisionalId);

  if (idx === -1) return; // provisional already gone (e.g. removed by an error path)

  if (alreadyPresent) {
    // The broadcast beat the ack — drop the provisional, keep the canonical.
    messages.splice(idx, 1);
    return;
  }

  messages.splice(idx, 1, canonical);
}

/** Remove a message by id (used to drop a provisional on send failure). */
export function removeMessageById(messages: ChatMessage[], id: string): void {
  const idx = messages.findIndex((m) => m._id === id);
  if (idx !== -1) messages.splice(idx, 1);
}
