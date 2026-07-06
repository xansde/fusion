/**
 * spell-cast-card.test.ts — SpellCastCard schema + chat:send flags (r17-P2).
 *
 * The interactive spell-cast chat card carries a structured payload under
 * `flags.pf2e.spellCast`. The server re-validates this shape on chat:send; a
 * forged/malformed card must be rejected. These tests pin the accept/reject
 * boundary of the schema and its embedding in ChatSendFlagsSchema /
 * ChatSendPayloadSchema.
 */

import { describe, it, expect } from "vitest";
import {
  SpellCastCardSchema,
  SpellSaveTypeSchema,
  ChatSendFlagsSchema,
} from "../chat/types.js";
import { ChatSendPayloadSchema } from "../chat/protocol.js";

const FULL = {
  casterActorId: "tobias",
  spellName: "Arco Elétrico",
  spellNameEn: "Electric Arc",
  rank: 2,
  actionCost: "◆◆",
  dcValue: 19,
  saveType: "reflex" as const,
  basicSave: true,
  damageFormula: "3d4",
  damageType: "electricity",
  traits: ["cantrip", "electricity"],
};

describe("SpellSaveTypeSchema", () => {
  for (const s of ["fortitude", "reflex", "will"]) {
    it(`accepts "${s}"`, () => {
      expect(SpellSaveTypeSchema.parse(s)).toBe(s);
    });
  }
  it("rejects an unknown save", () => {
    expect(SpellSaveTypeSchema.safeParse("dodge").success).toBe(false);
  });
});

describe("SpellCastCardSchema — accepts", () => {
  it("accepts a full save+damage card", () => {
    const r = SpellCastCardSchema.safeParse(FULL);
    expect(r.success).toBe(true);
  });

  it("accepts a minimal card (only caster + name + rank)", () => {
    const r = SpellCastCardSchema.safeParse({
      casterActorId: "a",
      spellName: "Escudo",
      rank: 0,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a save-only card (no damage)", () => {
    const { damageFormula: _d, damageType: _dt, ...saveOnly } = FULL;
    expect(SpellCastCardSchema.safeParse(saveOnly).success).toBe(true);
  });

  it("accepts a damage-only card (no save)", () => {
    const { dcValue: _dc, saveType: _s, basicSave: _b, ...dmgOnly } = FULL;
    expect(SpellCastCardSchema.safeParse(dmgOnly).success).toBe(true);
  });
});

describe("SpellCastCardSchema — rejects", () => {
  it("rejects a missing casterActorId", () => {
    const { casterActorId: _c, ...bad } = FULL;
    expect(SpellCastCardSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty casterActorId", () => {
    expect(SpellCastCardSchema.safeParse({ ...FULL, casterActorId: "" }).success).toBe(false);
  });

  it("rejects an empty spellName", () => {
    expect(SpellCastCardSchema.safeParse({ ...FULL, spellName: "" }).success).toBe(false);
  });

  it("rejects a non-integer rank", () => {
    expect(SpellCastCardSchema.safeParse({ ...FULL, rank: 2.5 }).success).toBe(false);
  });

  it("rejects a rank out of range", () => {
    expect(SpellCastCardSchema.safeParse({ ...FULL, rank: 11 }).success).toBe(false);
  });

  it("rejects an unknown saveType", () => {
    expect(SpellCastCardSchema.safeParse({ ...FULL, saveType: "dodge" }).success).toBe(false);
  });

  it("rejects a dcValue below the sane floor", () => {
    expect(SpellCastCardSchema.safeParse({ ...FULL, dcValue: 0 }).success).toBe(false);
  });

  it("rejects a dcValue above the sane ceiling", () => {
    expect(SpellCastCardSchema.safeParse({ ...FULL, dcValue: 999 }).success).toBe(false);
  });

  it("rejects an over-long damage formula (injection guard)", () => {
    expect(
      SpellCastCardSchema.safeParse({ ...FULL, damageFormula: "1".repeat(500) }).success,
    ).toBe(false);
  });
});

describe("ChatSendFlagsSchema", () => {
  it("accepts { pf2e: { spellCast } }", () => {
    expect(ChatSendFlagsSchema.safeParse({ pf2e: { spellCast: FULL } }).success).toBe(true);
  });

  it("accepts an empty flags object", () => {
    expect(ChatSendFlagsSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a malformed spellCast inside the whitelist", () => {
    expect(
      ChatSendFlagsSchema.safeParse({ pf2e: { spellCast: { rank: 2 } } }).success,
    ).toBe(false);
  });

  it("ignores foreign namespaces (stripped, not stored)", () => {
    // A foreign namespace is not part of the schema shape — parse strips it,
    // leaving only the whitelisted pf2e path (undefined here).
    const parsed = ChatSendFlagsSchema.parse({ evil: { hack: true } } as Record<string, unknown>);
    expect(parsed).not.toHaveProperty("evil");
  });

  // parentMessageId — r18-N1 (nested rolls under a spell-cast card)
  it("accepts a plain parentMessageId", () => {
    const r = ChatSendFlagsSchema.safeParse({ parentMessageId: "msg-abc123" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.parentMessageId).toBe("msg-abc123");
  });

  it("accepts parentMessageId alongside a checkContext (save nesting)", () => {
    const r = ChatSendFlagsSchema.safeParse({
      parentMessageId: "msg-abc123",
      checkContext: { kind: "save", dcValue: 19, saveType: "reflex", basicSave: true },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty parentMessageId", () => {
    expect(ChatSendFlagsSchema.safeParse({ parentMessageId: "" }).success).toBe(false);
  });

  it("rejects an over-long parentMessageId (bound guard)", () => {
    expect(
      ChatSendFlagsSchema.safeParse({ parentMessageId: "x".repeat(200) }).success,
    ).toBe(false);
  });

  it("rejects a non-string parentMessageId", () => {
    expect(
      ChatSendFlagsSchema.safeParse({ parentMessageId: 123 } as Record<string, unknown>).success,
    ).toBe(false);
  });
});

describe("ChatSendPayloadSchema with flags", () => {
  it("accepts a chat:send payload carrying a spellCast flag", () => {
    const r = ChatSendPayloadSchema.safeParse({
      content: "lança Arco Elétrico",
      worldId: "world-1",
      rollMode: "public",
      speakerActorId: "tobias",
      flags: { pf2e: { spellCast: FULL } },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a chat:send payload with a malformed spellCast flag", () => {
    const r = ChatSendPayloadSchema.safeParse({
      content: "lança Arco Elétrico",
      worldId: "world-1",
      flags: { pf2e: { spellCast: { casterActorId: "" } } },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a chat:send payload without any flags (compat)", () => {
    const r = ChatSendPayloadSchema.safeParse({
      content: "hello",
      worldId: "world-1",
    });
    expect(r.success).toBe(true);
  });
});
