/**
 * invalidateButton.test.ts — which invalidate/revalidate control the viewer
 * sees, by (role, author, invalidation state). Pure VM test: no socket, no
 * component, no DOM — resolveInvalidateAction is the exact seam
 * ChatMessage.svelte reads to decide whether to render the button (A024).
 *
 * REQ-ACH-082 — invalidate is offered to the GAMEMASTER and to the AUTHOR of
 *   the message; nobody else.
 * REQ-ACH-083 — revalidate is offered to the GM always; to the author ONLY
 *   when the standing invalidation is his own — a GM's invalidation is the
 *   last word and the author never even sees a button for it.
 *
 * REQ-ACH-080 (no deletion path) and REQ-ACH-084 (`invalidatedBy`/
 * `invalidatedAt` are recorded and survive revalidation) are NOT this file's
 * job — the resolver's return type already rules out a third action at
 * compile time, so asserting membership in it proves nothing a mutant
 * couldn't slip past. Those requirements are proven for real by
 * `ChatMessageInvalid.test.ts` and `chat-generic-doc-path.test.ts:257`
 * (server, no wire path deletes a ChatMessage) for REQ-ACH-080, and by
 * `chat-invalidate.test.ts` (server) plus `chatInvalidation.test.ts`
 * (client, the record survives a revalidation) for REQ-ACH-084.
 */

import { describe, it, expect } from "vitest";
import { resolveInvalidateAction, type InvalidateButtonMessage } from "../invalidateButton.js";

const GM = "gm-1";
const AUTHOR = "player-1";
const OTHER = "player-2";

function msg(overrides: Partial<InvalidateButtonMessage> = {}): InvalidateButtonMessage {
  return {
    speaker: { userId: AUTHOR },
    invalid: undefined,
    invalidatedBy: undefined,
    ...overrides,
  };
}

describe("REQ-ACH-082 — invalidating a message not yet invalidated", () => {
  it("offers the GM the invalidate action on anyone's message", () => {
    expect(resolveInvalidateAction(msg(), true, GM)).toBe("invalidate");
  });

  it("offers the author the invalidate action on his own message", () => {
    expect(resolveInvalidateAction(msg(), false, AUTHOR)).toBe("invalidate");
  });

  it("offers nothing to a player who is neither the GM nor the author", () => {
    expect(resolveInvalidateAction(msg(), false, OTHER)).toBeNull();
  });

  it("offers nothing to an unauthenticated/empty viewer", () => {
    expect(resolveInvalidateAction(msg(), false, "")).toBeNull();
  });
});

describe("REQ-ACH-083 — revalidating an invalidated message", () => {
  it("offers the GM revalidate even when the AUTHOR invalidated it", () => {
    const invalidated = msg({ invalid: true, invalidatedBy: AUTHOR });
    expect(resolveInvalidateAction(invalidated, true, GM)).toBe("revalidate");
  });

  it("offers the GM revalidate on his own invalidation", () => {
    const invalidated = msg({ invalid: true, invalidatedBy: GM });
    expect(resolveInvalidateAction(invalidated, true, GM)).toBe("revalidate");
  });

  it("offers the author revalidate ONLY when he himself invalidated it", () => {
    const invalidated = msg({ invalid: true, invalidatedBy: AUTHOR });
    expect(resolveInvalidateAction(invalidated, false, AUTHOR)).toBe("revalidate");
  });

  it("refuses the author revalidate when the GM's invalidation is the standing one — the GM's word is last", () => {
    const invalidated = msg({ invalid: true, invalidatedBy: GM });
    expect(resolveInvalidateAction(invalidated, false, AUTHOR)).toBeNull();
  });

  it("offers nothing to a bystander on an invalidated message", () => {
    const invalidated = msg({ invalid: true, invalidatedBy: GM });
    expect(resolveInvalidateAction(invalidated, false, OTHER)).toBeNull();
  });
});
