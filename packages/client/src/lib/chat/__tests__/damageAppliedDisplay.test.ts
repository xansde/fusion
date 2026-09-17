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

import { describe, it, expect, afterEach } from "vitest";
import type { ChatMessage, ActorDamageAppliedPayload, DamageAppliedTarget } from "@fusion/shared";
import {
  recognizeDamageApplied,
  formatDamageAppliedPlayerLine,
  formatDamageAppliedGmSummary,
} from "../damageAppliedDisplay.js";
// Side effect: registers the real pt-BR/en bundles into the shared `i18n`
// singleton `t()` resolves against — without this, `t()` returns raw keys
// ("FUSION.Chat.DamageApplied.Suffered") instead of translated text (the
// exact class of bug `packages/client/src/main.ts`'s own i18n bootstrap
// comment documents). I3 fix (onda-5 adversarial review): these formatters
// now go through `t()`, so this suite needs the bundles loaded — same
// convention `ChatMessage.test.ts`/`RollBuilderWindow.test.ts` already use.
import "../../i18n/index.js";
import { i18n } from "../../i18n/i18n.js";

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

// I2 fix fixture (onda-5 adversarial review): a flaming weapon hit — two
// damage types in one target, one of them (fire) resisted. No pre-existing
// fixture had more than one `byType` entry.
const MULTI_TYPE_TARGET: DamageAppliedTarget = {
  tokenId: "tok-ogre",
  actorId: "actor-ogre",
  name: "Ogre",
  byType: [
    { type: "slashing", amount: 5 },
    { type: "fire", amount: 7, resistanceApplied: 3 },
  ],
  total: 12,
  hpBefore: 40,
  hpAfter: 28,
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
  afterEach(() => {
    i18n.setLocale("pt-BR");
  });

  it("damage with a resistance applied (I3: damage type goes through FUSION.Damage.*, 'fire' -> 'fogo')", () => {
    expect(formatDamageAppliedPlayerLine(FIRE_TARGET)).toBe(
      "Goblin sofreu 7 de fogo (resistência 5)",
    );
  });

  it("damage with no resistance/weakness (I3: 'acid' has no curated FUSION.Damage.* entry -> falls back to the raw slug, not a raw i18n key)", () => {
    expect(formatDamageAppliedPlayerLine(ACID_TARGET_NO_RESISTANCE)).toBe("Orc sofreu 16 de acid");
  });

  it("healing reads as recovery, not 'damage'", () => {
    expect(formatDamageAppliedPlayerLine(HEAL_TARGET)).toBe("Finn recuperou 12 de PV");
  });

  it("temp-hp reads as a gain", () => {
    expect(formatDamageAppliedPlayerLine(TEMP_HP_TARGET)).toBe("Finn ganhou 5 de PV temporário");
  });

  // I2 fix: a multi-type hit used to print `target.total` next to only
  // `byType[0]`'s type -- "Ogre sofreu 12 de slashing", discarding the
  // second type and its own resistance. Every entry now keeps its own
  // amount and resistance note.
  it("multi-type damage keeps EACH type's own amount and resistance, never collapses into byType[0]'s type with the grand total", () => {
    expect(formatDamageAppliedPlayerLine(MULTI_TYPE_TARGET)).toBe(
      "Ogre sofreu 5 de cortante e 7 de fogo (resistência 3)",
    );
  });

  // I3 fix: the card used to be hardcoded pt-BR regardless of locale --
  // an English client read pt-BR. Every piece of text (verb, "and",
  // resistance note, damage type) now goes through t().
  it("switches to English when the locale is 'en' (I3: nothing left hardcoded pt-BR)", () => {
    i18n.setLocale("en");
    expect(formatDamageAppliedPlayerLine(MULTI_TYPE_TARGET)).toBe(
      "Ogre suffered 5 slashing and 7 fire (resistance 3)",
    );
    expect(formatDamageAppliedPlayerLine(HEAL_TARGET)).toBe("Finn recovered 12 HP");
    expect(formatDamageAppliedPlayerLine(TEMP_HP_TARGET)).toBe("Finn gained 5 temp HP");
  });
});

describe("formatDamageAppliedGmSummary (privileged: hp + resistance)", () => {
  it("full hp transition + resistance breakdown when hpBefore/hpAfter are present", () => {
    expect(formatDamageAppliedGmSummary(FIRE_TARGET)).toEqual({
      hpLine: "PV 18 → 11",
      amountLine: "sofreu 7 de fogo (resistência 5)",
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
