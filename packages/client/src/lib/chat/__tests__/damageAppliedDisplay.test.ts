/**
 * damageAppliedDisplay.test.ts — ALQ-F1-10 (plan §2.1, REQ-CHT-053, D-04).
 *
 * `recognizeDamageApplied` is the `flags.fusion.damageApplied` counterpart of
 * `registerPf2eSheets.ts`'s `abilityCardExtension.recognize` — CORE-level
 * (DF-02: ApplyDamage is a core op), so it lives here instead of a system.
 *
 * The display formatters never branch on role/isGm: the SERVER already
 * decided what a non-privileged viewer's payload carries
 * (`net/redaction.ts::redactChatDamageAppliedForNonPrivileged`, D-04) —
 * `hpBefore`/`hpAfter` are simply ABSENT for that viewer. This module renders
 * whatever fields are present; it never re-derives who may see what.
 */

import { describe, it, expect } from "vitest";
import type { ChatMessage, ActorDamageAppliedPayload, DamageAppliedTarget } from "@fusion/shared";
import {
  recognizeDamageApplied,
  formatDamageAppliedPlayerLine,
  formatDamageAppliedGmSummary,
} from "../damageAppliedDisplay.js";

function baseMessage(flags: Record<string, Record<string, unknown>>): ChatMessage {
  return {
    _id: "msg0000000000001",
    _stats: { createdAt: 0, modifiedAt: 0, createdBy: "gm", modifiedBy: "gm" },
    type: "system",
    worldId: "w1",
    content: "",
    speaker: { userId: "gm", alias: "Sistema" },
    timestamp: 0,
    whisper: [],
    blind: false,
    sort: 0,
    ownership: { default: 0 },
    flags,
  } as unknown as ChatMessage;
}

const FIRE_TARGET: DamageAppliedTarget = {
  tokenId: "tok-goblin",
  actorId: "actor-goblin",
  name: "Goblin",
  byType: [{ type: "fire", amount: 7, resistanceApplied: 5 }],
  total: 7,
  hpBefore: 18,
  hpAfter: 11,
};

const ACID_TARGET_NO_RESISTANCE: DamageAppliedTarget = {
  tokenId: "tok-orc",
  actorId: "actor-orc",
  name: "Orc",
  byType: [{ type: "acid", amount: 16 }],
  total: 16,
  hpBefore: 32,
  hpAfter: 16,
};

const HEAL_TARGET: DamageAppliedTarget = {
  tokenId: "tok-finn",
  actorId: "actor-finn",
  name: "Finn",
  byType: [{ type: "healing", amount: 12 }],
  total: 12,
};

const TEMP_HP_TARGET: DamageAppliedTarget = {
  tokenId: "tok-finn",
  actorId: "actor-finn",
  name: "Finn",
  byType: [{ type: "temp-hp", amount: 5 }],
  total: 5,
  tempHpAfter: 5,
};

describe("recognizeDamageApplied", () => {
  const payload: ActorDamageAppliedPayload = {
    sourceMessageId: "msg0000000000000",
    targets: [FIRE_TARGET],
  };

  it("recognizes a message carrying flags.fusion.damageApplied", () => {
    const msg = baseMessage({ fusion: { damageApplied: payload } });
    expect(recognizeDamageApplied(msg)).toEqual(payload);
  });

  it("returns null for a message with no fusion flags at all", () => {
    const msg = baseMessage({});
    expect(recognizeDamageApplied(msg)).toBeNull();
  });

  it("returns null for a message with other fusion flags but no damageApplied", () => {
    const msg = baseMessage({ fusion: { targetSnapshot: [] } });
    expect(recognizeDamageApplied(msg)).toBeNull();
  });

  it("returns null when the flag value doesn't match the schema (malformed)", () => {
    const msg = baseMessage({ fusion: { damageApplied: { targets: "not-an-array" } } });
    expect(recognizeDamageApplied(msg)).toBeNull();
  });
});

describe("formatDamageAppliedPlayerLine (D-04: damage caused, never PV)", () => {
  it("damage with a resistance applied", () => {
    expect(formatDamageAppliedPlayerLine(FIRE_TARGET)).toBe(
      "Goblin sofreu 7 de fire (resistência 5)",
    );
  });

  it("damage with no resistance/weakness", () => {
    expect(formatDamageAppliedPlayerLine(ACID_TARGET_NO_RESISTANCE)).toBe("Orc sofreu 16 de acid");
  });

  it("healing reads as recovery, not 'damage'", () => {
    expect(formatDamageAppliedPlayerLine(HEAL_TARGET)).toBe("Finn recuperou 12 de PV");
  });

  it("temp-hp reads as a gain", () => {
    expect(formatDamageAppliedPlayerLine(TEMP_HP_TARGET)).toBe("Finn ganhou 5 de PV temporário");
  });
});

describe("formatDamageAppliedGmSummary (privileged: hp + resistance)", () => {
  it("full hp transition + resistance breakdown when hpBefore/hpAfter are present", () => {
    expect(formatDamageAppliedGmSummary(FIRE_TARGET)).toEqual({
      hpLine: "PV 18 → 11",
      amountLine: "sofreu 7 de fire (resistência 5)",
      tempHpNote: null,
      deathNote: null,
    });
  });

  it("hpLine is null when hp fields were redacted away (non-privileged payload)", () => {
    expect(formatDamageAppliedGmSummary(HEAL_TARGET).hpLine).toBeNull();
  });

  it("tempHpNote is present when tempHpAfter is on the target", () => {
    expect(formatDamageAppliedGmSummary(TEMP_HP_TARGET).tempHpNote).toBe("PV temp.: 5");
  });

  it("deathNote reflects a 'dead' deathCondition", () => {
    const dead: DamageAppliedTarget = { ...FIRE_TARGET, hpAfter: 0, deathCondition: "dead" };
    expect(formatDamageAppliedGmSummary(dead).deathNote).toBe("Morto");
  });

  it("deathNote is null when deathCondition is absent", () => {
    expect(formatDamageAppliedGmSummary(FIRE_TARGET).deathNote).toBeNull();
  });
});
