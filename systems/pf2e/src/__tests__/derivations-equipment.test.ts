/**
 * @fusion/system-pf2e — Equipment collector + spellcasting derivation tests.
 *
 * TDD coverage for:
 *   - stepCharCollectEquipment: populates doc._equippedWeapons / _equippedArmor
 *     from doc.items, fixing the bug where stepCharAc/stepCharStrikes read
 *     fields that nothing in production ever wrote.
 *   - isEquippedFlag: the shared "is this item equipped" predicate.
 *   - stepCharSpellcasting: derives system.derived.spellcasting from
 *     spellcastingEntry items.
 *   - damageRoll / critDamageRoll: rollable formula strings on DerivedStrike.
 *
 * REQ-PF2-020, REQ-PF2-030..034, REQ-PF2-080..083.
 */

import { describe, it, expect } from "vitest";
import { emptySynthetics } from "@fusion/system-api";
import type { DeriveContext } from "@fusion/system-api";
import { stepCharCollectEquipment, isEquippedFlag } from "../derivations/equipment.js";
import { stepCharSpellcasting } from "../derivations/spellcasting.js";
import { stepCharAbilityMods, stepCharAc, stepCharStrikes } from "../derivations/character.js";
import { pf2eSystem } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyCtx(): DeriveContext {
  return {
    system: pf2eSystem,
    synthetics: emptySynthetics(),
    rollOptions: new Set<string>(),
  };
}

function getDerived(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
}

/** Minimal character doc builder — enough for the collector + AC/strikes/spellcasting steps. */
function makeCharDoc(
  overrides: Partial<{
    level: number;
    abilities: Record<string, { value: number; mod?: number }>;
    proficiencies: Record<string, unknown>;
    items: Record<string, unknown>[];
  }> = {},
): Record<string, unknown> {
  const level = overrides.level ?? 3;
  const abilities = overrides.abilities ?? {
    str: { value: 10 },
    dex: { value: 10 },
    con: { value: 10 },
    int: { value: 10 },
    wis: { value: 10 },
    cha: { value: 10 },
  };
  return {
    system: {
      systemVersion: "0.1.0",
      level: { value: level },
      abilities: {
        str: { value: abilities.str?.value ?? 10, mod: 0 },
        dex: { value: abilities.dex?.value ?? 10, mod: 0 },
        con: { value: abilities.con?.value ?? 10, mod: 0 },
        int: { value: abilities.int?.value ?? 10, mod: 0 },
        wis: { value: abilities.wis?.value ?? 10, mod: 0 },
        cha: { value: abilities.cha?.value ?? 10, mod: 0 },
      },
      attributes: {
        hp: { value: 10, max: 10, temp: 0 },
        ac: { value: 10 },
        speed: { value: 25, otherSpeeds: [] },
        dying: { value: 0, max: 4 },
        wounded: { value: 0 },
        doomed: { value: 0 },
        iwr: { immunities: [], weaknesses: [], resistances: [] },
      },
      saves: {
        fortitude: { rank: 0 },
        reflex: { rank: 0 },
        will: { rank: 0 },
      },
      perception: { rank: 0, senses: [] },
      skills: {},
      proficiencies: overrides.proficiencies ?? {
        classDC: { rank: 0 },
        weapons: { unarmed: 0, simple: 0, martial: 0, advanced: 0 },
        armor: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
      },
      resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
      details: { keyAbility: "str", level },
      traits: { rarity: "common", value: [], size: "med" },
    } as Record<string, unknown>,
    items: overrides.items ?? [],
  };
}

// ---------------------------------------------------------------------------
// isEquippedFlag
// ---------------------------------------------------------------------------

describe("isEquippedFlag", () => {
  it("true for equipped: true", () => {
    expect(isEquippedFlag({ equipped: true })).toBe(true);
  });
  it("true for equipped: { value: true }", () => {
    expect(isEquippedFlag({ equipped: { value: true } })).toBe(true);
  });
  it("true for equipped: { inSlot: true }", () => {
    expect(isEquippedFlag({ equipped: { inSlot: true } })).toBe(true);
  });
  it("false when equipped is absent", () => {
    expect(isEquippedFlag({})).toBe(false);
  });
  it("false when equipped: false", () => {
    expect(isEquippedFlag({ equipped: false })).toBe(false);
  });
  it("false when equipped: {}", () => {
    expect(isEquippedFlag({ equipped: {} })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stepCharCollectEquipment — armor + AC integration (Tobias-style)
// ---------------------------------------------------------------------------

describe("stepCharCollectEquipment — armor collection", () => {
  it("Tobias: dex 18, level 3, armor.light=1, equipped light armor {acBonus 1, dexCap 4} → AC 20", () => {
    const doc = makeCharDoc({
      level: 3,
      abilities: {
        str: { value: 10 },
        dex: { value: 18 },
        con: { value: 10 },
        int: { value: 10 },
        wis: { value: 10 },
        cha: { value: 10 },
      },
      proficiencies: {
        classDC: { rank: 0 },
        weapons: { unarmed: 0, simple: 0, martial: 0, advanced: 0 },
        armor: { unarmored: 0, light: 1, medium: 0, heavy: 0 },
      },
      items: [
        {
          _id: "armor-1",
          name: "Studded Leather",
          type: "armor",
          system: {
            category: "light",
            acBonus: 1,
            dexCap: 4,
            equipped: true,
          },
        },
      ],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharCollectEquipment.run(doc, emptyCtx());
    stepCharAc.run(doc, emptyCtx());

    // AC = 10 + min(dex=4, dexCap=4) + profBonus(rank1,lvl3=1*2+3=5) + acBonus(1) + potency(0)
    //    = 10 + 4 + 5 + 1 + 0 = 20
    const derived = getDerived(doc);
    const ac = derived["ac"] as { total: number };
    expect(ac.total).toBe(20);
  });

  it("no armor equipped → AC does not regress (10 + dex + unarmored prof)", () => {
    const doc = makeCharDoc({
      level: 3,
      abilities: {
        str: { value: 10 },
        dex: { value: 18 },
        con: { value: 10 },
        int: { value: 10 },
        wis: { value: 10 },
        cha: { value: 10 },
      },
      proficiencies: {
        classDC: { rank: 0 },
        weapons: { unarmed: 0, simple: 0, martial: 0, advanced: 0 },
        armor: { unarmored: 1, light: 0, medium: 0, heavy: 0 },
      },
      items: [],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharCollectEquipment.run(doc, emptyCtx());
    stepCharAc.run(doc, emptyCtx());

    // unarmored prof rank1 @ lvl3 = 5; dex mod = 4; AC = 10+4+5 = 19
    const derived = getDerived(doc);
    const ac = derived["ac"] as { total: number };
    expect(ac.total).toBe(19);
  });
});

// ---------------------------------------------------------------------------
// stepCharCollectEquipment — weapon collection + strikes
// ---------------------------------------------------------------------------

describe("stepCharCollectEquipment — weapon collection", () => {
  it("Funda (sling): simple, ranged 50, 1d6 bludgeoning, equipped → strike present, attackBonus 9, isRanged true", () => {
    const doc = makeCharDoc({
      level: 3,
      abilities: {
        str: { value: 10 },
        dex: { value: 18 }, // +4
        con: { value: 10 },
        int: { value: 10 },
        wis: { value: 10 },
        cha: { value: 10 },
      },
      proficiencies: {
        classDC: { rank: 0 },
        weapons: { unarmed: 0, simple: 1, martial: 0, advanced: 0 },
        armor: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
      },
      items: [
        {
          _id: "sling-1",
          name: "Funda",
          type: "weapon",
          system: {
            category: "simple",
            range: 50,
            damage: { dice: 1, die: "d6", damageType: "bludgeoning", modifier: 0 },
            traits: { value: [] },
            runes: { potency: 0, striking: 0 },
            equipped: true,
          },
        },
      ],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharCollectEquipment.run(doc, emptyCtx());
    stepCharStrikes.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const strikes = derived["strikes"] as Array<{
      label: string;
      isRanged: boolean;
      attackBonus: number;
      damageRoll?: string;
      variants: Array<{ total: number }>;
    }>;

    // The equipped Funda plus the synthetic Fist (issue #62 — no unarmed
    // weapon exists in doc.items, so the collector always adds one).
    expect(strikes).toHaveLength(2);
    const strike = strikes.find((s) => s.label === "Funda");
    expect(strike).toBeDefined();
    if (!strike) return;
    // dex mod(4) + simple prof rank1@lvl3(5) + potency(0) = 9
    expect(strike.attackBonus).toBe(9);
    expect(strike.isRanged).toBe(true);
    // standard ranged (no thrown/propulsive) → no ability mod on damage
    expect(strike.damageRoll).toBe("1d6");
    expect(strike.variants[0]?.total).toBe(9);
    expect(strike.variants[1]?.total).toBe(4);
    expect(strike.variants[2]?.total).toBe(-1);
  });

  it("Mordida (unarmed, unequipped explicitly) always becomes a strike; finesse uses dex on attack, str on damage", () => {
    const doc = makeCharDoc({
      level: 3,
      abilities: {
        str: { value: 8 }, // -1
        dex: { value: 18 }, // +4
        con: { value: 10 },
        int: { value: 10 },
        wis: { value: 10 },
        cha: { value: 10 },
      },
      proficiencies: {
        classDC: { rank: 0 },
        weapons: { unarmed: 1, simple: 0, martial: 0, advanced: 0 },
        armor: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
      },
      items: [
        {
          _id: "bite-1",
          name: "Mordida",
          type: "weapon",
          system: {
            category: "unarmed",
            range: null,
            damage: { dice: 1, die: "d4", damageType: "piercing", modifier: 0 },
            traits: { value: ["agile", "finesse"] },
            runes: { potency: 0, striking: 0 },
            // NOTE: no `equipped` field at all — unarmed strikes always count.
          },
        },
      ],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharCollectEquipment.run(doc, emptyCtx());
    stepCharStrikes.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const strikes = derived["strikes"] as Array<{
      label: string;
      attackBonus: number;
      damageRoll?: string;
      variants: Array<{ total: number }>;
    }>;

    // A granted Mordida (Bite) does not replace the character's fists (CRB
    // remaster "Unarmed Attacks") — the synthetic Fist is also present.
    expect(strikes).toHaveLength(2);
    expect(strikes.map((s) => s.label)).toEqual(expect.arrayContaining(["Mordida", "Fist"]));
    const strike = strikes.find((s) => s.label === "Mordida");
    expect(strike).toBeDefined();
    if (!strike) return;
    // finesse: dex(4) > str(-1) → attack uses dex. unarmed prof rank1@lvl3 = 5. total = 4+5=9
    expect(strike.attackBonus).toBe(9);
    // damage uses STR (melee, not ranged) → -1
    expect(strike.damageRoll).toBe("1d4-1");
    // agile MAP: 0/-4/-8 → 9/5/1
    expect(strike.variants[0]?.total).toBe(9);
    expect(strike.variants[1]?.total).toBe(5);
    expect(strike.variants[2]?.total).toBe(1);
  });

  it("non-equipped martial weapon does NOT become a strike (but the synthetic Fist does)", () => {
    const doc = makeCharDoc({
      items: [
        {
          _id: "sword-1",
          name: "Longsword",
          type: "weapon",
          system: {
            category: "martial",
            range: null,
            damage: { dice: 1, die: "d8", damageType: "slashing", modifier: 0 },
            traits: { value: [] },
            runes: { potency: 0, striking: 0 },
            // equipped absent
          },
        },
      ],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharCollectEquipment.run(doc, emptyCtx());
    stepCharStrikes.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const strikes = derived["strikes"] as Array<{ label: string; damageRoll?: string }>;
    // The un-equipped Longsword never becomes a strike; the only strike
    // present is the synthetic Fist (issue #62 — see describe block below).
    expect(strikes).toHaveLength(1);
    expect(strikes[0]?.label).toBe("Fist");
    expect(strikes.some((s) => s.label === "Longsword")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stepCharCollectEquipment — synthetic Fist when no unarmed weapon exists
// Issue #62: a Monk (or any character) with no weapon equipped had NO
// unarmed strike at all, because the collector only ever picked up an
// unarmed weapon that already existed in doc.items — it never synthesized
// one. Every PF2e character can strike unarmed per the CRB remaster; this is
// a rule of the book, not something read off any pack.
// ---------------------------------------------------------------------------

describe("stepCharCollectEquipment — synthetic Fist (issue #62)", () => {
  it("empty items (Monk with no weapon equipped) → gets exactly one strike: Fist, 1d4 bludgeoning", () => {
    const doc = makeCharDoc({ items: [] });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharCollectEquipment.run(doc, emptyCtx());
    stepCharStrikes.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const strikes = derived["strikes"] as Array<{
      label: string;
      damageRoll?: string;
      damageType?: string;
      traits: string[];
    }>;

    expect(strikes).toHaveLength(1);
    const strike = strikes[0];
    expect(strike).toBeDefined();
    if (!strike) return;
    expect(strike.label).toBe("Fist");
    // 1d4 bludgeoning, str mod 0 (default ability score 10) → no flat bonus.
    expect(strike.damageRoll).toBe("1d4");
    expect(strike.damageType).toBe("bludgeoning");
    expect(strike.traits).toEqual(expect.arrayContaining(["agile", "finesse", "nonlethal"]));
  });

  it("character already has a granted unarmed weapon (e.g. Claw) → Fist is still synthesized (CRB: claws don't replace your fists)", () => {
    const doc = makeCharDoc({
      items: [
        {
          _id: "claw-1",
          name: "Claw",
          type: "weapon",
          system: {
            category: "unarmed",
            range: null,
            damage: { dice: 1, die: "d4", damageType: "slashing", modifier: 0 },
            traits: { value: ["agile", "finesse"] },
            runes: { potency: 0, striking: 0 },
            // NOTE: no `equipped` field — unarmed strikes always count.
          },
        },
      ],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharCollectEquipment.run(doc, emptyCtx());
    stepCharStrikes.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const strikes = derived["strikes"] as Array<{ label: string; damageType?: string }>;

    // Per CRB remaster "Unarmed Attacks": having claws does not remove your
    // fists — the granted Claw AND the default Fist must both show up.
    expect(strikes).toHaveLength(2);
    expect(strikes.map((s) => s.label)).toEqual(expect.arrayContaining(["Claw", "Fist"]));
    expect(strikes.find((s) => s.label === "Claw")?.damageType).toBe("slashing");
    expect(strikes.find((s) => s.label === "Fist")?.damageType).toBe("bludgeoning");
  });

  it("character already has a granted Fist (e.g. an upgraded unarmed feature) → no duplicate synthetic Fist", () => {
    const doc = makeCharDoc({
      items: [
        {
          _id: "fist-1",
          name: "Fist",
          type: "weapon",
          system: {
            category: "unarmed",
            range: null,
            // Upgraded die (1d6 instead of the synthetic default 1d4) — a
            // stand-in for a feature that improves the fist strike itself.
            damage: { dice: 1, die: "d6", damageType: "bludgeoning", modifier: 0 },
            traits: { value: ["agile", "finesse", "nonlethal"] },
            runes: { potency: 0, striking: 0 },
          },
        },
      ],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharCollectEquipment.run(doc, emptyCtx());
    stepCharStrikes.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const strikes = derived["strikes"] as Array<{ label: string; damageRoll?: string }>;

    // Only the granted Fist shows up — the collector must not ALSO push its
    // own synthetic 1d4 Fist alongside an already-present one named "Fist".
    expect(strikes).toHaveLength(1);
    expect(strikes[0]?.label).toBe("Fist");
    expect(strikes[0]?.damageRoll).toBe("1d6");
  });
});

// ---------------------------------------------------------------------------
// stepCharSpellcasting
// ---------------------------------------------------------------------------

describe("stepCharSpellcasting", () => {
  it("spellcastingEntry {ability int, proficiency 1}, int 16 (+3), level 3 → attack 8, dc 18", () => {
    const doc = makeCharDoc({
      level: 3,
      abilities: {
        str: { value: 10 },
        dex: { value: 10 },
        con: { value: 10 },
        int: { value: 16 },
        wis: { value: 10 },
        cha: { value: 10 },
      },
      items: [
        {
          _id: "entry-1",
          name: "Arcane Spellcasting",
          type: "spellcastingEntry",
          system: {
            ability: { value: "int" },
            proficiency: { value: 1 },
          },
        },
      ],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharSpellcasting.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const spellcasting = derived["spellcasting"] as Record<
      string,
      { dc: number; attack: number; ability: string; rank: number }
    >;
    const entry = spellcasting["entry-1"];
    expect(entry).toBeDefined();
    // base = intMod(3) + profBonus(rank1, lvl3 = 1*2+3=5) = 8; dc = 18
    expect(entry?.attack).toBe(8);
    expect(entry?.dc).toBe(18);
    expect(entry?.ability).toBe("int");
    expect(entry?.rank).toBe(1);
  });

  it("no spellcasting entries → derived.spellcasting = {}", () => {
    const doc = makeCharDoc({ items: [] });
    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharSpellcasting.run(doc, emptyCtx());

    const derived = getDerived(doc);
    expect(derived["spellcasting"]).toEqual({});
  });

  // issue #13: the entry is born `proficiency.value: 1` (trained) by planVM's
  // buildSpellcastingEntryOp and NEVER updated afterward — the item's stored
  // rank is frozen at creation for the entry's whole lifetime. Progression
  // must come from the class's `proficiencyUpgrades` table (the same
  // mechanism stepCharApplyClass already uses for weapons/saves/perception/
  // classDC), not from re-reading the item.
  it("issue #13: Wizard level 20, entry stored at proficiency.value 1 (trained) → rank 4 (legendary), from the class's proficiencyUpgrades", () => {
    const doc = makeCharDoc({
      level: 20,
      abilities: {
        str: { value: 10 },
        dex: { value: 10 },
        con: { value: 10 },
        int: { value: 18 },
        wis: { value: 10 },
        cha: { value: 10 },
      },
      items: [
        {
          _id: "class-wizard",
          name: "Wizard",
          type: "class",
          system: {
            // Real shape from systems/pf2e/packs/classes-core/documents.json
            // (Wizard): rank 2 at 7, rank 3 at 15, rank 4 at 19.
            proficiencyUpgrades: [
              { level: 7, stat: "spellcasting", rank: 2 },
              { level: 15, stat: "spellcasting", rank: 3 },
              { level: 19, stat: "spellcasting", rank: 4 },
            ],
          },
        },
        {
          _id: "entry-1",
          name: "Arcane Spellcasting",
          type: "spellcastingEntry",
          system: {
            ability: { value: "int" },
            // planVM's real, frozen-at-creation value — not a fixture
            // shortcut. See buildSpellcastingEntryOp in planVM.ts.
            proficiency: { value: 1 },
          },
        },
      ],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharSpellcasting.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const spellcasting = derived["spellcasting"] as Record<string, { rank: number }>;
    // RAW (PF2e Remaster class progression, a fact of the rule system, not
    // read from the fixture): a Wizard is Trained at 1, Expert at 7, Master
    // at 15, Legendary at 19 — so a level-20 Wizard's spellcasting MUST be
    // rank 4, no matter what the item itself was stamped with at creation.
    expect(spellcasting["entry-1"]?.rank).toBe(4);
  });

  it("issue #13 (no class item — r9 manual-entry actor): stored proficiency rank is kept as-is, unchanged behavior", () => {
    const doc = makeCharDoc({
      level: 20,
      items: [
        {
          _id: "entry-1",
          name: "Arcane Spellcasting",
          type: "spellcastingEntry",
          system: {
            ability: { value: "int" },
            proficiency: { value: 1 },
          },
        },
      ],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharSpellcasting.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const spellcasting = derived["spellcasting"] as Record<string, { rank: number }>;
    // No embedded class item to attribute the entry to — falls back to the
    // item's own stored rank, exactly like before this fix (no regression
    // for r9 manual-entry actors).
    expect(spellcasting["entry-1"]?.rank).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// critDamageRoll — rollable crit formula
// ---------------------------------------------------------------------------

describe("critDamageRoll", () => {
  it("weapon 1d6+3 (via potency-equivalent flat), no traits → (1d6+3)*2", () => {
    const doc = makeCharDoc({
      level: 1,
      abilities: {
        str: { value: 16 }, // +3
        dex: { value: 10 },
        con: { value: 10 },
        int: { value: 10 },
        wis: { value: 10 },
        cha: { value: 10 },
      },
      items: [
        {
          _id: "club-1",
          name: "Club",
          type: "weapon",
          system: {
            category: "simple",
            range: null,
            damage: { dice: 1, die: "d6", damageType: "bludgeoning", modifier: 0 },
            traits: { value: [] },
            runes: { potency: 0, striking: 0 },
            equipped: true,
          },
        },
      ],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharCollectEquipment.run(doc, emptyCtx());
    stepCharStrikes.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const strikes = derived["strikes"] as Array<{ damageRoll?: string; critDamageRoll?: string }>;
    const strike = strikes[0];
    expect(strike?.damageRoll).toBe("1d6+3");
    expect(strike?.critDamageRoll).toBe("(1d6+3)*2");
  });

  it("weapon with deadly-d8 → (1d6+3)*2+1d8", () => {
    const doc = makeCharDoc({
      level: 1,
      abilities: {
        str: { value: 16 },
        dex: { value: 10 },
        con: { value: 10 },
        int: { value: 10 },
        wis: { value: 10 },
        cha: { value: 10 },
      },
      items: [
        {
          _id: "rapier-1",
          name: "Rapier",
          type: "weapon",
          system: {
            category: "martial",
            range: null,
            damage: { dice: 1, die: "d6", damageType: "piercing", modifier: 0 },
            traits: { value: ["deadly-d8"] },
            runes: { potency: 0, striking: 0 },
            equipped: true,
          },
        },
      ],
    });

    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharCollectEquipment.run(doc, emptyCtx());
    stepCharStrikes.run(doc, emptyCtx());

    const derived = getDerived(doc);
    const strikes = derived["strikes"] as Array<{ critDamageRoll?: string }>;
    expect(strikes[0]?.critDamageRoll).toBe("(1d6+3)*2+1d8");
  });
});
