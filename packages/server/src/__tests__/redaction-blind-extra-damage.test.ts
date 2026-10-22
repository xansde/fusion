/**
 * A blind roll's body, for a viewer who may not see the result, carries nothing that gives the result away
 * (BHR-F2-05 / BHR-F4-09, wave 9 review M-4): the notes, the conditional modifiers AND the extra damage dice the
 * server added to the damage roll (`flags.fusion.extraDamage`: their dice are part of the hidden total).
 */
import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@fusion/shared";
import { redactBlindRollForNonPrivileged } from "../net/redaction.js";

function blindDamage(): ChatMessage {
  return {
    _id: "m1",
    content: "Dano",
    rolls: [{ formula: "1d4+2 + 1d8", total: 9 }],
    flags: {
      fusion: {
        rollNotes: [{ title: "n" }],
        conditionalModifiers: [{ slug: "c", value: 2 }],
        extraDamage: [
          { slug: "support-bear", dice: "1d8", summary: "Apoio do urso: +1d8 de dano cortante" },
        ],
        parentMessageId: "card-1",
      },
    },
  } as unknown as ChatMessage;
}

describe("redactBlindRollForNonPrivileged", () => {
  it("drops the extra damage with the notes and the modifiers, and keeps the rest of the fusion flags", () => {
    const out = redactBlindRollForNonPrivileged(blindDamage());
    const fusion = (out.flags as Record<string, Record<string, unknown>>)["fusion"];
    expect(fusion).toEqual({ parentMessageId: "card-1" });
    expect(out.rolls).toBeUndefined();
  });
});
