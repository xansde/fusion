/**
 * invalidateButton.test.ts — which invalidate/revalidate control the viewer
 * sees, by (role, author, invalidation state). Pure VM test: no socket, no
 * component, no DOM — resolveInvalidateAction is the exact seam
 * ChatMessage.svelte reads to decide whether to render the button (A024).
 *
 * REQ-ACH-080 — the resolver never returns anything but "invalidate",
 *   "revalidate" or null: there is no deletion path.
 * REQ-ACH-082 — invalidate is offered to the GAMEMASTER and to the AUTHOR of
 *   the message; nobody else.
 * REQ-ACH-083 — revalidate is offered to the GM always; to the author ONLY
 *   when the standing invalidation is his own — a GM's invalidation is the
 *   last word and the author never even sees a button for it.
 * REQ-ACH-084 — the decision reads `invalidatedBy`, the field the server
 *   stamps and preserves through revalidation.
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

describe("REQ-ACH-080 — no third action exists", () => {
  it("only ever resolves to invalidate, revalidate, or null", () => {
    const cases: [InvalidateButtonMessage, boolean, string][] = [
      [msg(), true, GM],
      [msg(), false, AUTHOR],
      [msg(), false, OTHER],
      [msg({ invalid: true, invalidatedBy: AUTHOR }), true, GM],
      [msg({ invalid: true, invalidatedBy: AUTHOR }), false, AUTHOR],
      [msg({ invalid: true, invalidatedBy: GM }), false, AUTHOR],
    ];
    for (const [m, isGm, userId] of cases) {
      expect(["invalidate", "revalidate", null]).toContain(
        resolveInvalidateAction(m, isGm, userId),
      );
    }
  });
});
