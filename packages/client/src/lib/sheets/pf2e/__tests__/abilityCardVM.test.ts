/**
 * abilityCardVM.test.ts — pure resolution logic for the generalized interactive
 * ability chat card (r20-X1): button visibility, ownership gate, and roll-op
 * building across the three kinds (spell / impulse / strike).
 */

import { describe, it, expect } from "vitest";
import type { AbilityCard } from "@fusion/shared";
import { AbilityCardSchema } from "@fusion/shared";
import {
  showSaveButton,
  hasDamage,
  hasCritDamage,
  canRollDamage,
  buildSaveRollOp,
  buildDamageRollOp,
  resolveAbilityUuid,
  type ActorDocLike,
} from "../abilityCardVM.js";

// Real wire shapes (each validated against the schema below so the tests use
// exactly what travels over chat:send).
const SPELL_CARD: AbilityCard = {
  kind: "spell",
  casterActorId: "finn",
  name: "Arco Elétrico",
  nameEn: "Electric Arc",
  rank: 2,
  saveType: "reflex",
  dcValue: 19,
  basicSave: true,
  damageFormula: "2d4+1d4",
  damageType: "electricity",
};

const IMPULSE_CARD: AbilityCard = {
  kind: "impulse",
  casterActorId: "finn",
  name: "Quatro Ventos",
  actionCost: "◆◆",
  saveType: "reflex",
  dcValue: 21,
  basicSave: true,
  damageFormula: "2d6",
  damageType: "bludgeoning",
  traits: ["impulse", "air"],
};

const STRIKE_CARD: AbilityCard = {
  kind: "strike",
  casterActorId: "tobias",
  name: "Funda",
  damageFormula: "1d6+2",
  critDamageFormula: "(1d6+2)*2",
  damageType: "bludgeoning",
  traits: ["propulsive"],
};

function actor(
  id: string,
  name: string,
  ownership: Record<string, number>,
  saves?: Record<string, number>,
): ActorDocLike {
  return {
    _id: id,
    name,
    type: "character",
    ownership,
    system: saves
      ? {
          derived: {
            saves: {
              fortitude: { total: saves["fortitude"] ?? 0 },
              reflex: { total: saves["reflex"] ?? 0 },
              will: { total: saves["will"] ?? 0 },
            },
          },
        }
      : {},
  };
}

describe("wire shapes are schema-valid", () => {
  it("all three fixture cards parse", () => {
    expect(AbilityCardSchema.safeParse(SPELL_CARD).success).toBe(true);
    expect(AbilityCardSchema.safeParse(IMPULSE_CARD).success).toBe(true);
    expect(AbilityCardSchema.safeParse(STRIKE_CARD).success).toBe(true);
  });
});

describe("showSaveButton", () => {
  it("true when saveType + dcValue present (spell, impulse)", () => {
    expect(showSaveButton(SPELL_CARD)).toBe(true);
    expect(showSaveButton(IMPULSE_CARD)).toBe(true);
  });
  it("false for a strike (no save)", () => {
    expect(showSaveButton(STRIKE_CARD)).toBe(false);
  });
  it("false when the DC was dropped server-side (save display-only)", () => {
    const { dcValue: _d, ...noDc } = SPELL_CARD;
    expect(showSaveButton(noDc as AbilityCard)).toBe(false);
  });
});

describe("hasDamage / hasCritDamage", () => {
  it("hasDamage true for all three fixtures", () => {
    expect(hasDamage(SPELL_CARD)).toBe(true);
    expect(hasDamage(IMPULSE_CARD)).toBe(true);
    expect(hasDamage(STRIKE_CARD)).toBe(true);
  });
  it("hasCritDamage only for the strike (crit formula)", () => {
    expect(hasCritDamage(SPELL_CARD)).toBe(false);
    expect(hasCritDamage(IMPULSE_CARD)).toBe(false);
    expect(hasCritDamage(STRIKE_CARD)).toBe(true);
  });
});

describe("canRollDamage (ownership gate)", () => {
  const caster = actor("tobias", "Tobias", { default: 0, owner: 3 });

  it("GM may always roll damage", () => {
    expect(canRollDamage(STRIKE_CARD, undefined, "someone", true)).toBe(true);
  });
  it("caster owner may roll damage", () => {
    expect(canRollDamage(STRIKE_CARD, caster, "owner", false)).toBe(true);
  });
  it("non-owner player may not", () => {
    expect(canRollDamage(STRIKE_CARD, caster, "intruder", false)).toBe(false);
  });
  it("player who cannot see the caster (undefined actor) may not", () => {
    expect(canRollDamage(STRIKE_CARD, undefined, "owner", false)).toBe(false);
  });
});

describe("buildSaveRollOp", () => {
  const target = actor("target", "Alvo", { default: 0, p: 3 }, { reflex: 7 });

  it("builds a save roll with checkContext + parent nesting (impulse, class DC)", () => {
    const op = buildSaveRollOp(IMPULSE_CARD, target, "Reflexos", "world-1", "parent-1");
    expect(op).not.toBeNull();
    expect(op!.content).toBe("/r 1d20+7 # Salvaguarda de Reflexos (CD 21)");
    expect(op!.speakerActorId).toBe("target"); // the TARGET rolls
    expect(op!.rollMode).toBe("public");
    expect(op!.flags?.checkContext).toEqual({
      kind: "save",
      dcValue: 21,
      saveType: "reflex",
      basicSave: true,
    });
    expect(op!.flags?.parentMessageId).toBe("parent-1");
  });

  it("returns null for a strike (no save)", () => {
    expect(buildSaveRollOp(STRIKE_CARD, target, "Reflexos", "world-1")).toBeNull();
  });

  it("formats a zero save mod with an explicit +0", () => {
    const t0 = actor("t0", "Zero", { default: 3 }, { reflex: 0 });
    const op = buildSaveRollOp(SPELL_CARD, t0, "Reflexos", "world-1");
    expect(op!.content).toContain("1d20+0");
  });
});

describe("buildDamageRollOp", () => {
  it("builds the caster-speaker damage roll nested under the card", () => {
    const op = buildDamageRollOp(
      STRIKE_CARD,
      STRIKE_CARD.damageFormula,
      "world-1",
      "Funda — Dano bludgeoning",
      "parent-1",
    );
    expect(op).not.toBeNull();
    expect(op!.content).toBe("/r 1d6+2 # Funda — Dano bludgeoning");
    expect(op!.speakerActorId).toBe("tobias"); // the CASTER rolls damage
    expect(op!.flags?.parentMessageId).toBe("parent-1");
  });

  it("builds the crit roll from critDamageFormula", () => {
    const op = buildDamageRollOp(
      STRIKE_CARD,
      STRIKE_CARD.critDamageFormula,
      "world-1",
      "Funda — Crítico bludgeoning",
    );
    expect(op!.content).toBe("/r (1d6+2)*2 # Funda — Crítico bludgeoning");
    expect(op!.flags).toBeUndefined(); // no parent → no flags
  });

  it("returns null when the formula is empty/undefined", () => {
    expect(buildDamageRollOp(IMPULSE_CARD, undefined, "world-1", "x")).toBeNull();
    expect(buildDamageRollOp(IMPULSE_CARD, "", "world-1", "x")).toBeNull();
  });
});

describe("resolveAbilityUuid (spell name popup)", () => {
  const resolver = (name: string): string | null =>
    name === "Electric Arc" ? "Compendium.pf2e.spells-core.Item.arc" : null;

  it("prefers nameEn (untranslated join key) over the display name", () => {
    expect(resolveAbilityUuid(SPELL_CARD, resolver)).toBe(
      "Compendium.pf2e.spells-core.Item.arc",
    );
  });

  it("returns null when neither name matches", () => {
    expect(resolveAbilityUuid(IMPULSE_CARD, resolver)).toBeNull();
  });
});
