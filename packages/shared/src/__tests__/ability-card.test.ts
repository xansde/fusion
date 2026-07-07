/**
 * ability-card.test.ts — AbilityCard schema, compat adapter + chat:send flags
 * (r20-X1).
 *
 * The generalized interactive ability card carries a structured payload under
 * `flags.pf2e.abilityCard`. It unifies spells, Kineticist impulses and weapon
 * strikes under one schema. The server re-validates this shape on chat:send; a
 * forged/malformed card must be rejected. These tests pin the accept/reject
 * boundary, the legacy SpellCastCard → AbilityCard read adapter, and the
 * embedding in ChatSendFlagsSchema / ChatSendPayloadSchema.
 */

import { describe, it, expect } from "vitest";
import {
  AbilityCardSchema,
  AbilityKindSchema,
  adaptSpellCastToAbilityCard,
  ChatSendFlagsSchema,
  type SpellCastCard,
} from "../chat/types.js";
import { ChatSendPayloadSchema } from "../chat/protocol.js";

const SPELL: unknown = {
  kind: "spell",
  casterActorId: "finn",
  name: "Arco Elétrico",
  nameEn: "Electric Arc",
  rank: 2,
  actionCost: "◆◆",
  dcValue: 19,
  saveType: "reflex" as const,
  basicSave: true,
  damageFormula: "3d4",
  damageType: "electricity",
  traits: ["cantrip", "electricity"],
};

const IMPULSE: unknown = {
  kind: "impulse",
  casterActorId: "finn",
  name: "Quatro Ventos",
  actionCost: "◆◆",
  dcValue: 21,
  saveType: "reflex" as const,
  basicSave: true,
  damageFormula: "2d6",
  damageType: "bludgeoning",
  traits: ["impulse", "air"],
};

const STRIKE: unknown = {
  kind: "strike",
  casterActorId: "tobias",
  name: "Sling",
  damageFormula: "1d6+2",
  critDamageFormula: "(1d6+2)*2",
  damageType: "bludgeoning",
  traits: ["propulsive"],
};

describe("AbilityKindSchema", () => {
  for (const k of ["spell", "impulse", "strike"]) {
    it(`accepts "${k}"`, () => {
      expect(AbilityKindSchema.parse(k)).toBe(k);
    });
  }
  it("rejects an unknown kind", () => {
    expect(AbilityKindSchema.safeParse("feat").success).toBe(false);
  });
});

describe("AbilityCardSchema — accepts", () => {
  it("accepts a full spell save+damage card", () => {
    expect(AbilityCardSchema.safeParse(SPELL).success).toBe(true);
  });

  it("accepts an impulse card (save + damage, no rank)", () => {
    const r = AbilityCardSchema.safeParse(IMPULSE);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rank).toBeUndefined();
  });

  it("accepts a strike card (attack-based: damage + crit, no save/rank)", () => {
    const r = AbilityCardSchema.safeParse(STRIKE);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.critDamageFormula).toBe("(1d6+2)*2");
      expect(r.data.saveType).toBeUndefined();
    }
  });

  it("accepts a minimal card (only kind + caster + name)", () => {
    expect(
      AbilityCardSchema.safeParse({ kind: "impulse", casterActorId: "a", name: "X" }).success,
    ).toBe(true);
  });
});

describe("AbilityCardSchema — rejects", () => {
  it("rejects a missing kind", () => {
    const { kind: _k, ...bad } = SPELL as Record<string, unknown>;
    expect(AbilityCardSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty casterActorId", () => {
    expect(AbilityCardSchema.safeParse({ ...(SPELL as object), casterActorId: "" }).success).toBe(
      false,
    );
  });

  it("rejects an empty name", () => {
    expect(AbilityCardSchema.safeParse({ ...(STRIKE as object), name: "" }).success).toBe(false);
  });

  it("rejects an unknown saveType", () => {
    expect(AbilityCardSchema.safeParse({ ...(IMPULSE as object), saveType: "dodge" }).success).toBe(
      false,
    );
  });

  it("rejects a dcValue out of range", () => {
    expect(AbilityCardSchema.safeParse({ ...(IMPULSE as object), dcValue: 0 }).success).toBe(false);
    expect(AbilityCardSchema.safeParse({ ...(IMPULSE as object), dcValue: 999 }).success).toBe(
      false,
    );
  });

  it("rejects an over-long crit formula (injection guard)", () => {
    expect(
      AbilityCardSchema.safeParse({ ...(STRIKE as object), critDamageFormula: "1".repeat(500) })
        .success,
    ).toBe(false);
  });
});

describe("adaptSpellCastToAbilityCard — legacy read compat", () => {
  const legacy: SpellCastCard = {
    casterActorId: "finn",
    spellName: "Arco Elétrico",
    spellNameEn: "Electric Arc",
    rank: 2,
    actionCost: "◆◆",
    dcValue: 19,
    saveType: "reflex",
    basicSave: true,
    damageFormula: "3d4",
    damageType: "electricity",
    traits: ["cantrip", "electricity"],
  };

  it("maps a legacy spellCast card to a spell AbilityCard", () => {
    const adapted = adaptSpellCastToAbilityCard(legacy);
    expect(adapted.kind).toBe("spell");
    expect(adapted.name).toBe("Arco Elétrico");
    expect(adapted.nameEn).toBe("Electric Arc");
    expect(adapted.rank).toBe(2);
    expect(adapted.dcValue).toBe(19);
    expect(adapted.saveType).toBe("reflex");
    expect(adapted.basicSave).toBe(true);
    expect(adapted.damageFormula).toBe("3d4");
    expect(adapted.damageType).toBe("electricity");
    expect(adapted.traits).toEqual(["cantrip", "electricity"]);
  });

  it("produces an AbilityCard that passes the schema", () => {
    expect(AbilityCardSchema.safeParse(adaptSpellCastToAbilityCard(legacy)).success).toBe(true);
  });

  it("omits optional fields absent on the legacy card", () => {
    const minimal: SpellCastCard = { casterActorId: "a", spellName: "Escudo", rank: 0 };
    const adapted = adaptSpellCastToAbilityCard(minimal);
    expect(adapted).toEqual({ kind: "spell", casterActorId: "a", name: "Escudo", rank: 0 });
    expect(AbilityCardSchema.safeParse(adapted).success).toBe(true);
  });
});

describe("ChatSendFlagsSchema — abilityCard", () => {
  it("accepts { pf2e: { abilityCard } } for each kind", () => {
    expect(ChatSendFlagsSchema.safeParse({ pf2e: { abilityCard: SPELL } }).success).toBe(true);
    expect(ChatSendFlagsSchema.safeParse({ pf2e: { abilityCard: IMPULSE } }).success).toBe(true);
    expect(ChatSendFlagsSchema.safeParse({ pf2e: { abilityCard: STRIKE } }).success).toBe(true);
  });

  it("still accepts the legacy { pf2e: { spellCast } } path", () => {
    expect(
      ChatSendFlagsSchema.safeParse({
        pf2e: { spellCast: { casterActorId: "a", spellName: "X", rank: 1 } },
      }).success,
    ).toBe(true);
  });

  it("rejects a malformed abilityCard inside the whitelist", () => {
    expect(
      ChatSendFlagsSchema.safeParse({ pf2e: { abilityCard: { kind: "strike" } } }).success,
    ).toBe(false);
  });
});

describe("ChatSendPayloadSchema with an abilityCard flag", () => {
  it("accepts a chat:send payload carrying an abilityCard flag", () => {
    const r = ChatSendPayloadSchema.safeParse({
      content: "ataca com Funda (MAP 0)",
      worldId: "world-1",
      rollMode: "public",
      speakerActorId: "tobias",
      flags: { pf2e: { abilityCard: STRIKE } },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a chat:send payload with a malformed abilityCard flag", () => {
    const r = ChatSendPayloadSchema.safeParse({
      content: "x",
      worldId: "world-1",
      flags: { pf2e: { abilityCard: { kind: "spell", casterActorId: "" } } },
    });
    expect(r.success).toBe(false);
  });
});
