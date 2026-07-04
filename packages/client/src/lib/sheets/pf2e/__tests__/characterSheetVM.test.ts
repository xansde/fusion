/**
 * characterSheetVM.test.ts — Unit tests for CharacterSheetVM.
 *
 * Tests are 100% headless (no PIXI, no Svelte, no browser APIs).
 * REQ-PF2-110..114, REQ-UIF-021..025.
 */

import { describe, it, expect } from "vitest";
import {
  CharacterSheetVM,
  fmtMod,
  proficiencyLabel,
  proficiencyLabelFull,
  isEquippedFlag,
} from "../characterSheetVM.js";
import { OwnershipLevel } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCharacter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "actor-001",
    name: "Valeros",
    img: "img/valeros.webp",
    type: "character",
    items: [
      {
        _id: "item-longsword",
        name: "Longsword",
        type: "weapon",
        system: {
          quantity: 1,
          bulk: 1,
          equipped: { inSlot: true },
        },
        img: null,
      },
      {
        _id: "item-frightened",
        name: "Frightened",
        type: "condition",
        system: { slug: "frightened", value: 2 },
      },
      {
        _id: "entry-arcane",
        name: "Arcane Spells",
        type: "spellcastingEntry",
        system: {
          tradition: "arcane",
          prepared: "spontaneous",
          ability: "cha",
          slots: {
            "0": { value: 0, max: 0 },
            "1": { value: 2, max: 3 },
          },
        },
      },
      {
        _id: "spell-shield",
        name: "Shield",
        type: "spell",
        location: "entry-arcane",
        system: { level: 0, defense: { spellAttack: false }, castTime: "1R" },
      },
      {
        _id: "spell-magic-missile",
        name: "Magic Missile",
        type: "spell",
        location: "entry-arcane",
        system: { level: 1, defense: { spellAttack: false }, castTime: "2A" },
      },
      {
        _id: "spell-ray-of-frost",
        name: "Ray of Frost",
        type: "spell",
        location: "entry-arcane",
        system: { level: 0, defense: { spellAttack: true }, castTime: "2A" },
      },
      {
        _id: "feat-toughness",
        name: "Toughness",
        type: "feat",
        system: { level: 1 },
      },
      {
        _id: "ancestry-human",
        name: "Human",
        type: "ancestry",
        system: { level: { value: 0 } },
      },
    ],
    system: {
      level: { value: 5 },
      abilities: {
        str: { value: 18, mod: 4 },
        dex: { value: 14, mod: 2 },
        con: { value: 16, mod: 3 },
        int: { value: 10, mod: 0 },
        wis: { value: 12, mod: 1 },
        cha: { value: 8, mod: -1 },
      },
      attributes: {
        hp: { value: 62, max: 75, temp: 0 },
        ac: { value: 20 },
        speed: { value: 25 },
        dying: { value: 0, max: 4 },
        wounded: { value: 0 },
        doomed: { value: 0 },
        iwr: { immunities: [], weaknesses: [], resistances: [] },
      },
      saves: {
        fortitude: { rank: 3 },
        reflex: { rank: 2 },
        will: { rank: 1 },
      },
      perception: { rank: 2, senses: [] },
      skills: {
        acrobatics: { rank: 2 },
        athletics: { rank: 3 },
        stealth: { rank: 1 },
      },
      proficiencies: {
        classDC: { rank: 1 },
        weapons: { martial: 2, simple: 2, unarmed: 2 },
        armor: { light: 2, medium: 2, unarmored: 2 },
      },
      resources: {
        heroPoints: { value: 1, max: 3 },
        focusPoints: { value: 0, max: 0 },
      },
      details: {
        keyAbility: "str",
        ancestry: "Human",
        class: "Fighter",
        background: "Soldier",
        biography: "A veteran of the border wars.",
      },
      derived: {
        abilityMods: { str: 4, dex: 2, con: 3, int: 0, wis: 1, cha: -1 },
        hp: { value: 62, max: 75, temp: 0, drainedHpReduction: 0 },
        ac: { slug: "ac", base: 19, modifiers: [], total: 20, dc: 30 },
        saves: {
          fortitude: { slug: "fortitude", base: 11, modifiers: [], total: 11, dc: 21 },
          reflex: { slug: "reflex", base: 9, modifiers: [], total: 9, dc: 19 },
          will: { slug: "will", base: 8, modifiers: [], total: 8, dc: 18 },
        },
        perception: { slug: "perception", base: 8, modifiers: [], total: 8, dc: 18 },
        skills: {
          acrobatics: { slug: "acrobatics", base: 9, modifiers: [], total: 9, dc: 19 },
          athletics: { slug: "athletics", base: 11, modifiers: [], total: 11, dc: 21 },
          stealth: { slug: "stealth", base: 6, modifiers: [], total: 6, dc: 16 },
        },
        classDC: { total: 14, dc: 24, modifiers: [] },
        strikes: [
          {
            label: "Longsword",
            sourceId: "item-longsword",
            isRanged: false,
            isAgile: false,
            attackBonus: 13,
            variants: [
              { mapPenalty: 0, total: 13, formula: "1d20 + 13" },
              { mapPenalty: -5, total: 8, formula: "1d20 + 8" },
              { mapPenalty: -10, total: 3, formula: "1d20 + 3" },
            ],
            damageAbilityMod: 4,
            damageFormula: "1d8 +4 slashing",
            critDamageFormula: "(1d8 +4) × 2 slashing",
            damageType: "slashing",
            traits: ["versatile-p"],
            damageRoll: "1d8+4",
            critDamageRoll: "(1d8+4)*2",
          },
        ],
        dyingMax: 4,
        spellcasting: {
          "entry-arcane": { dc: 19, attack: 9, ability: "cha", rank: 1 },
        },
      },
    },
    ...overrides,
  };
}

function makeVM(
  docOverrides: Record<string, unknown> = {},
  opts: { ownership?: number; isGm?: boolean; worldId?: string } = {},
): CharacterSheetVM {
  return new CharacterSheetVM({
    doc: makeCharacter(docOverrides),
    actorId: "actor-001",
    ownership: opts.ownership ?? OwnershipLevel.OWNER,
    userId: "user-gm",
    isGm: opts.isGm ?? true,
    worldId: opts.worldId ?? "world-001",
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("fmtMod", () => {
  it("formats positive as +N", () => {
    expect(fmtMod(5)).toBe("+5");
  });

  it("formats zero as +0", () => {
    expect(fmtMod(0)).toBe("+0");
  });

  it("formats negative as -N", () => {
    expect(fmtMod(-3)).toBe("-3");
  });
});

describe("proficiencyLabel", () => {
  it("returns U for rank 0", () => expect(proficiencyLabel(0)).toBe("U"));
  it("returns T for rank 1", () => expect(proficiencyLabel(1)).toBe("T"));
  it("returns E for rank 2", () => expect(proficiencyLabel(2)).toBe("E"));
  it("returns M for rank 3", () => expect(proficiencyLabel(3)).toBe("M"));
  it("returns L for rank 4", () => expect(proficiencyLabel(4)).toBe("L"));
});

describe("proficiencyLabelFull", () => {
  it("returns Trained for rank 1", () => expect(proficiencyLabelFull(1)).toBe("Trained"));
  it("returns Legendary for rank 4", () => expect(proficiencyLabelFull(4)).toBe("Legendary"));
  it("returns Untrained for rank 0", () => expect(proficiencyLabelFull(0)).toBe("Untrained"));
});

// ---------------------------------------------------------------------------
// CharacterSheetVM — basic fields
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — basic fields", () => {
  it("reads name", () => {
    const vm = makeVM();
    expect(vm.name).toBe("Valeros");
  });

  it("reads level", () => {
    const vm = makeVM();
    expect(vm.level).toBe(5);
  });

  it("reads ancestry and class", () => {
    const vm = makeVM();
    expect(vm.ancestryLabel).toBe("Human");
    expect(vm.classLabel).toBe("Fighter");
  });

  it("reads img", () => {
    const vm = makeVM();
    expect(vm.img).toBe("img/valeros.webp");
  });
});

// ---------------------------------------------------------------------------
// HP
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — HP", () => {
  it("uses derived hp.value when available", () => {
    const vm = makeVM();
    expect(vm.hpCurrent).toBe(62);
    expect(vm.hpMax).toBe(75);
  });

  it("falls back to attributes.hp when no derived", () => {
    const doc = makeCharacter();
    // Remove derived
    (doc["system"] as Record<string, unknown>)["derived"] = undefined;
    const vm = new CharacterSheetVM({
      doc,
      actorId: "a",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.hpCurrent).toBe(62);
    expect(vm.hpMax).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// AC
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — AC", () => {
  it("returns derived ac.total", () => {
    const vm = makeVM();
    expect(vm.ac).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — abilities", () => {
  it("returns 6 ability rows", () => {
    const vm = makeVM();
    expect(vm.abilities).toHaveLength(6);
  });

  it("formats STR modifier correctly", () => {
    const vm = makeVM();
    const str = vm.abilities.find((a) => a.slug === "str")!;
    expect(str.score).toBe(18);
    expect(str.mod).toBe(4);
    expect(str.modFormatted).toBe("+4");
  });

  it("formats negative modifier correctly", () => {
    const vm = makeVM();
    const cha = vm.abilities.find((a) => a.slug === "cha")!;
    expect(cha.mod).toBe(-1);
    expect(cha.modFormatted).toBe("-1");
  });
});

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — saves", () => {
  it("returns 3 save rows", () => {
    const vm = makeVM();
    expect(vm.saves).toHaveLength(3);
  });

  it("formats fortitude save correctly", () => {
    const vm = makeVM();
    const fort = vm.saves.find((s) => s.slug === "fortitude")!;
    expect(fort.total).toBe(11);
    expect(fort.totalFormatted).toBe("+11");
    expect(fort.dc).toBe(21);
    expect(fort.rank).toBe(3);
    expect(fort.rankLabel).toBe("M");
  });
});

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — skills", () => {
  it("returns skill rows from derived", () => {
    const vm = makeVM();
    const skills = vm.skills;
    const athletics = skills.find((s) => s.slug === "athletics")!;
    expect(athletics.total).toBe(11);
    expect(athletics.totalFormatted).toBe("+11");
    expect(athletics.rank).toBe(3);
    expect(athletics.rankLabel).toBe("M");
    expect(athletics.rankLabelFull).toBe("Master");
    expect(athletics.abilityLabel).toBe("STR");
  });

  it("includes stealth skill", () => {
    const vm = makeVM();
    const stealth = vm.skills.find((s) => s.slug === "stealth")!;
    expect(stealth.total).toBe(6);
    expect(stealth.abilityLabel).toBe("DEX");
  });
});

// ---------------------------------------------------------------------------
// Strikes
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — strikes", () => {
  it("returns strikes from derived", () => {
    const vm = makeVM();
    expect(vm.strikes).toHaveLength(1);
    const longsword = vm.strikes[0]!;
    expect(longsword.label).toBe("Longsword");
    expect(longsword.isRanged).toBe(false);
    expect(longsword.isAgile).toBe(false);
  });

  it("formats MAP variants", () => {
    const vm = makeVM();
    const longsword = vm.strikes[0]!;
    expect(longsword.variants[0]!.totalFormatted).toBe("+13");
    expect(longsword.variants[1]!.totalFormatted).toBe("+8");
    expect(longsword.variants[2]!.totalFormatted).toBe("+3");
  });

  it("rollStrike builds correct chat:send op for MAP 0", () => {
    const vm = makeVM();
    const op = vm.rollStrike("item-longsword", 0);
    expect(op.type).toBe("chat:send");
    expect(op.content).toBe("/r 1d20+13 # Longsword (MAP 0)");
    expect(op.worldId).toBe("world-001");
    expect(op.rollMode).toBe("public");
    expect(op.speakerActorId).toBe("actor-001");
  });

  it("rollStrike builds correct chat:send op for MAP 1", () => {
    const vm = makeVM();
    const op = vm.rollStrike("item-longsword", 1);
    expect(op.content).toBe("/r 1d20+8 # Longsword (MAP 1)");
  });
});

// ---------------------------------------------------------------------------
// Strike damage rolls (contract 3)
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — rollStrikeDamage", () => {
  it("returns damage roll chat:send op when damageRoll is present", () => {
    const vm = makeVM();
    const op = vm.rollStrikeDamage("item-longsword", false);
    expect(op).not.toBeNull();
    expect(op!.content).toBe("/r 1d8+4 # Longsword — Damage");
  });

  it("returns crit damage roll chat:send op when critDamageRoll is present", () => {
    const vm = makeVM();
    const op = vm.rollStrikeDamage("item-longsword", true);
    expect(op).not.toBeNull();
    expect(op!.content).toBe("/r (1d8+4)*2 # Longsword — Critical");
  });

  it("returns null when the strike has no damageRoll (older data)", () => {
    const doc = makeCharacter();
    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    const strikes = derived["strikes"] as Array<Record<string, unknown>>;
    delete strikes[0]!["damageRoll"];
    delete strikes[0]!["critDamageRoll"];
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.rollStrikeDamage("item-longsword", false)).toBeNull();
    expect(vm.rollStrikeDamage("item-longsword", true)).toBeNull();
  });

  it("returns null for an unknown strike", () => {
    const vm = makeVM();
    expect(vm.rollStrikeDamage("does-not-exist", false)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Spell attack rolls
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — rollSpellAttack", () => {
  it("returns a chat:send op using derived.spellcasting attack", () => {
    const vm = makeVM();
    const op = vm.rollSpellAttack("entry-arcane");
    expect(op).not.toBeNull();
    expect(op!.content).toBe("/r 1d20+9 # Spell Attack (Arcane Spells)");
  });

  it("returns null when derived.spellcasting entry is missing", () => {
    const vm = makeVM();
    expect(vm.rollSpellAttack("does-not-exist")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — conditions", () => {
  it("extracts active conditions from items", () => {
    const vm = makeVM();
    expect(vm.conditions).toHaveLength(1);
    const frightened = vm.conditions[0]!;
    expect(frightened.slug).toBe("frightened");
    expect(frightened.value).toBe(2);
    expect(frightened.itemId).toBe("item-frightened");
  });

  it("toggleCondition returns remove op when condition is active", () => {
    const vm = makeVM();
    const op = vm.toggleCondition("frightened");
    expect(op).not.toBeNull();
    expect(op!.diff).toMatchObject({ "items.-item-frightened": true });
  });

  it("toggleCondition returns add op when condition is not active", () => {
    const vm = makeVM();
    const op = vm.toggleCondition("stunned");
    expect(op).not.toBeNull();
    expect(op!.diff["items.+"]).toMatchObject({ type: "condition", name: "stunned" });
  });

  it("toggleCondition returns null when not editable", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.toggleCondition("stunned")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Roll ops
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — roll ops", () => {
  it("rollPerception returns correct chat:send op", () => {
    const vm = makeVM();
    const op = vm.rollPerception();
    expect(op.type).toBe("chat:send");
    expect(op.content).toBe("/r 1d20+8 # Perception");
    expect(op.worldId).toBe("world-001");
    expect(op.rollMode).toBe("public");
    expect(op.speakerActorId).toBe("actor-001");
  });

  it("rollSave fortitude returns correct chat:send op", () => {
    const vm = makeVM();
    const op = vm.rollSave("fortitude");
    expect(op.content).toBe("/r 1d20+11 # Fortitude Save");
  });

  it("rollSkill athletics returns correct chat:send op", () => {
    const vm = makeVM();
    const op = vm.rollSkill("athletics");
    expect(op.content).toBe("/r 1d20+11 # Athletics");
  });

  it("formats a negative total without a double sign (never '1d20+-1')", () => {
    const doc = makeCharacter();
    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    (derived["perception"] as Record<string, unknown>)["total"] = -1;
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
      worldId: "world-001",
    });
    expect(vm.rollPerception().content).toBe("/r 1d20-1 # Perception");
  });
});

// ---------------------------------------------------------------------------
// Field update / HP delta
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — editing ops", () => {
  it("fieldUpdate returns diff when editable", () => {
    const vm = makeVM();
    const op = vm.fieldUpdate("system.attributes.hp.value", 50);
    expect(op).not.toBeNull();
    expect(op!.diff["system.attributes.hp.value"]).toBe(50);
  });

  it("fieldUpdate returns null when not editable", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.fieldUpdate("system.attributes.hp.value", 50)).toBeNull();
  });

  it("applyHpDelta clamps at max", () => {
    const vm = makeVM();
    const op = vm.applyHpDelta(100);
    expect(op!.diff["system.attributes.hp.value"]).toBe(75); // max
  });

  it("applyHpDelta clamps at 0", () => {
    const vm = makeVM();
    const op = vm.applyHpDelta(-1000);
    expect(op!.diff["system.attributes.hp.value"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — permission", () => {
  it("editable is true for GM", () => {
    const vm = makeVM({}, { isGm: true, ownership: OwnershipLevel.NONE });
    expect(vm.editable).toBe(true);
  });

  it("editable is true for OWNER", () => {
    const vm = makeVM({}, { isGm: false, ownership: OwnershipLevel.OWNER });
    expect(vm.editable).toBe(true);
  });

  it("editable is false for OBSERVER", () => {
    const vm = makeVM({}, { isGm: false, ownership: OwnershipLevel.OBSERVER });
    expect(vm.editable).toBe(false);
  });

  it("editable is false for NONE", () => {
    const vm = makeVM({}, { isGm: false, ownership: OwnershipLevel.NONE });
    expect(vm.editable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — inventory", () => {
  it("returns inventory items", () => {
    const vm = makeVM();
    const inv = vm.inventory;
    expect(inv).toHaveLength(1);
    expect(inv[0]!.name).toBe("Longsword");
    expect(inv[0]!.subtype).toBe("weapon");
  });

  it("marks item equipped via isEquippedFlag (inSlot: true)", () => {
    const vm = makeVM();
    const inv = vm.inventory;
    expect(inv[0]!.equipped).toBe(true);
  });

  it("marks item not equipped when equipped flag is absent", () => {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    (items[0]!["system"] as Record<string, unknown>)["equipped"] = { inSlot: false };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.inventory[0]!.equipped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isEquippedFlag (contract 1)
// ---------------------------------------------------------------------------

describe("isEquippedFlag", () => {
  it("returns true for sys.equipped === true", () => {
    expect(isEquippedFlag({ equipped: true })).toBe(true);
  });

  it("returns true for sys.equipped.value === true", () => {
    expect(isEquippedFlag({ equipped: { value: true } })).toBe(true);
  });

  it("returns true for sys.equipped.inSlot === true", () => {
    expect(isEquippedFlag({ equipped: { inSlot: true } })).toBe(true);
  });

  it("returns false when equipped is absent or falsy", () => {
    expect(isEquippedFlag({})).toBe(false);
    expect(isEquippedFlag({ equipped: false })).toBe(false);
    expect(isEquippedFlag({ equipped: { inSlot: false, value: false } })).toBe(false);
  });

  it("always returns true for unarmed weapons regardless of equipped state", () => {
    expect(isEquippedFlag({ equipped: false }, true)).toBe(true);
    expect(isEquippedFlag({}, true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hero Points / Focus Points
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — resources", () => {
  it("returns hero points", () => {
    const vm = makeVM();
    expect(vm.heroPoints).toEqual({ value: 1, max: 3 });
  });

  it("returns focus points", () => {
    const vm = makeVM();
    expect(vm.focusPoints).toEqual({ value: 0, max: 0 });
  });
});

// ---------------------------------------------------------------------------
// setHeroPoints / setFocusPoints (clamped setters)
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — setHeroPoints / setFocusPoints", () => {
  it("setHeroPoints clamps at max", () => {
    const vm = makeVM();
    const op = vm.setHeroPoints(99);
    expect(op!.diff["system.resources.heroPoints.value"]).toBe(3);
  });

  it("setHeroPoints clamps at 0", () => {
    const vm = makeVM();
    const op = vm.setHeroPoints(-5);
    expect(op!.diff["system.resources.heroPoints.value"]).toBe(0);
  });

  it("setHeroPoints returns null when not editable", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.setHeroPoints(2)).toBeNull();
  });

  it("setFocusPoints clamps within [0, max]", () => {
    const doc = makeCharacter();
    (doc["system"] as Record<string, unknown>)["resources"] = {
      heroPoints: { value: 1, max: 3 },
      focusPoints: { value: 1, max: 2 },
    };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.setFocusPoints(10)!.diff["system.resources.focusPoints.value"]).toBe(2);
    expect(vm.setFocusPoints(-1)!.diff["system.resources.focusPoints.value"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateLevel — two paths in one diff
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — updateLevel", () => {
  it("updates both system.level.value and system.details.level in one diff", () => {
    const vm = makeVM();
    const op = vm.updateLevel(7);
    expect(op).not.toBeNull();
    expect(op!.diff["system.level.value"]).toBe(7);
    expect(op!.diff["system.details.level"]).toBe(7);
  });

  it("returns null when not editable", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.updateLevel(7)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Feats tab
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — feats", () => {
  it("collects feat/ancestry/background/class/heritage items", () => {
    const vm = makeVM();
    const feats = vm.feats;
    const names = feats.map((f) => f.name);
    expect(names).toContain("Toughness");
    expect(names).toContain("Human");
  });

  it("reads level from feat system.level (number)", () => {
    const vm = makeVM();
    const toughness = vm.feats.find((f) => f.name === "Toughness")!;
    expect(toughness.level).toBe(1);
    expect(toughness.subtype).toBe("feat");
  });

  it("reads level from ancestry system.level.value shape", () => {
    const vm = makeVM();
    const human = vm.feats.find((f) => f.name === "Human")!;
    expect(human.level).toBe(0);
    expect(human.subtype).toBe("ancestry");
  });
});

// ---------------------------------------------------------------------------
// Bio tab
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — bio", () => {
  it("returns biography text", () => {
    const vm = makeVM();
    expect(vm.biography).toBe("A veteran of the border wars.");
  });

  it("returns detailsInfo", () => {
    const vm = makeVM();
    expect(vm.detailsInfo).toEqual({
      ancestry: "Human",
      background: "Soldier",
      class: "Fighter",
      keyAbility: "str",
    });
  });

  it("returns empty string when biography is absent", () => {
    const doc = makeCharacter();
    delete (doc["system"] as Record<string, unknown> & { details: Record<string, unknown> })
      .details["biography"];
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.biography).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Class DC
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — classDC", () => {
  it("returns derived classDC", () => {
    const vm = makeVM();
    expect(vm.classDC).toEqual({ total: 14, dc: 24 });
  });
});

// ---------------------------------------------------------------------------
// Spellcasting entries (contract 4 — bug fixes)
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — spellcastingEntries", () => {
  it("returns one entry with correct label/tradition/prepared", () => {
    const vm = makeVM();
    const entries = vm.spellcastingEntries;
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.entryId).toBe("entry-arcane");
    expect(entry.label).toBe("Arcane Spells");
    expect(entry.tradition).toBe("arcane");
    expect(entry.prepared).toBe("spontaneous");
  });

  it("reads spellDC/spellAttack from derived.spellcasting[entryId]", () => {
    const vm = makeVM();
    const entry = vm.spellcastingEntries[0]!;
    expect(entry.spellDC).toBe(19);
    expect(entry.spellAttack).toBe(9);
    expect(entry.spellAttackFormatted).toBe("+9");
  });

  it("falls back to 10/0 when derived.spellcasting is absent", () => {
    const doc = makeCharacter();
    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    delete derived["spellcasting"];
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    const entry = vm.spellcastingEntries[0]!;
    expect(entry.spellDC).toBe(10);
    expect(entry.spellAttack).toBe(0);
  });

  it('reads slots using keys "0".."10" (NOT "slot0".."slot10")', () => {
    const vm = makeVM();
    const entry = vm.spellcastingEntries[0]!;
    const rank1 = entry.slots.find((s) => s.rank === 1)!;
    expect(rank1.value).toBe(2);
    expect(rank1.max).toBe(3);
  });

  it("groups each spell by its OWN system.level, not by every rank", () => {
    const vm = makeVM();
    const entry = vm.spellcastingEntries[0]!;

    const cantripRank = entry.slots.find((s) => s.rank === 0)!;
    const cantripNames = cantripRank.spells.map((s) => s.name);
    expect(cantripNames).toContain("Shield");
    expect(cantripNames).toContain("Ray of Frost");
    expect(cantripNames).not.toContain("Magic Missile");
    expect(cantripRank.isCantrip).toBe(true);

    const rank1 = entry.slots.find((s) => s.rank === 1)!;
    const rank1Names = rank1.spells.map((s) => s.name);
    expect(rank1Names).toContain("Magic Missile");
    expect(rank1Names).not.toContain("Shield");
    expect(rank1.isCantrip).toBe(false);
  });

  it("associates spells to the entry via the item root `location` field", () => {
    const vm = makeVM();
    const entry = vm.spellcastingEntries[0]!;
    const allSpellIds = entry.slots.flatMap((s) => s.spells.map((sp) => sp.id));
    expect(allSpellIds).toEqual(
      expect.arrayContaining(["spell-shield", "spell-magic-missile", "spell-ray-of-frost"]),
    );
  });

  it("marks hasAttack from system.defense.spellAttack === true", () => {
    const vm = makeVM();
    const entry = vm.spellcastingEntries[0]!;
    const rayOfFrost = entry.slots.flatMap((s) => s.spells).find((s) => s.name === "Ray of Frost")!;
    const shield = entry.slots.flatMap((s) => s.spells).find((s) => s.name === "Shield")!;
    expect(rayOfFrost.hasAttack).toBe(true);
    expect(shield.hasAttack).toBe(false);
  });

  it("includes castTime per spell", () => {
    const vm = makeVM();
    const entry = vm.spellcastingEntries[0]!;
    const magicMissile = entry.slots
      .flatMap((s) => s.spells)
      .find((s) => s.name === "Magic Missile")!;
    expect(magicMissile.castTime).toBe("2A");
  });

  it("falls back to root spellcastingEntry when location is absent (older docs)", () => {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    const magicMissile = items.find((i) => i["_id"] === "spell-magic-missile")!;
    delete magicMissile["location"];
    magicMissile["spellcastingEntry"] = "entry-arcane";
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    const entry = vm.spellcastingEntries[0]!;
    const rank1 = entry.slots.find((s) => s.rank === 1)!;
    expect(rank1.spells.map((s) => s.name)).toContain("Magic Missile");
  });
});
