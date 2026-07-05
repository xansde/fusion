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
  filterSpellPicker,
  sortSpellPickerEntries,
  resolveInitialTradition,
  type SpellPickerEntry,
} from "../characterSheetVM.js";
import {
  OwnershipLevel,
  DocUpdatePayloadSchema,
  DocCreatePayloadSchema,
  DocDeletePayloadSchema,
} from "@fusion/shared";

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

// ---------------------------------------------------------------------------
// Skills — R10-C4 item 1: 16 canonical skills + lore, untrained rollable
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — skills (canonical 16 + lore)", () => {
  it("returns 17 rows (16 canonical + 1 lore) sorted alphabetically by label, with a full derived.skills doc", () => {
    const doc = makeCharacter();
    const system = doc["system"] as Record<string, unknown>;
    // Add a lore skill on the raw document (not part of the canonical 16).
    (system["skills"] as Record<string, unknown>)["lore-warfare"] = { rank: 2, lore: true };
    const derived = system["derived"] as Record<string, unknown>;
    const derivedSkills = derived["skills"] as Record<string, unknown>;
    derivedSkills["lore-warfare"] = { slug: "lore-warfare", base: 9, modifiers: [], total: 9, dc: 19 };
    // Fill out the remaining canonical skills so derived.skills is "complete"
    // (mirrors the R10-A guarantee that the server always derives all 16).
    const allCanonical = [
      "acrobatics",
      "arcana",
      "athletics",
      "crafting",
      "deception",
      "diplomacy",
      "intimidation",
      "medicine",
      "nature",
      "occultism",
      "performance",
      "religion",
      "society",
      "stealth",
      "survival",
      "thievery",
    ];
    for (const slug of allCanonical) {
      if (!(slug in derivedSkills)) {
        derivedSkills[slug] = { slug, base: 0, modifiers: [], total: 0, dc: 10 };
      }
    }

    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
      worldId: "world-001",
    });

    const skills = vm.skills;
    expect(skills).toHaveLength(17);

    // Sorted alphabetically by label.
    const labels = skills.map((s) => s.label);
    const sortedLabels = [...labels].sort((a, b) => a.localeCompare(b));
    expect(labels).toEqual(sortedLabels);

    // Untrained skill (rank 0, not on the raw system.skills at all — e.g.
    // "arcana") still appears, with rank 0 and the correct derived mod.
    const arcana = skills.find((s) => s.slug === "arcana")!;
    expect(arcana).toBeDefined();
    expect(arcana.rank).toBe(0);
    expect(arcana.rankLabel).toBe("U");
    expect(arcana.total).toBe(0);
    expect(arcana.totalFormatted).toBe("+0");

    // rollSkill works for an untrained skill (uses derived.skills total).
    const op = vm.rollSkill("arcana");
    expect(op.content).toBe("/r 1d20+0 # Arcana");

    // Lore skill present with generated label.
    const lore = skills.find((s) => s.slug === "lore-warfare")!;
    expect(lore.isLore).toBe(true);
    expect(lore.label).toBe("Lore (warfare)");
    expect(lore.total).toBe(9);
  });

  it("falls back to all 16 canonical skills (untrained) when derived is absent", () => {
    const doc = makeCharacter();
    (doc["system"] as Record<string, unknown>)["derived"] = undefined;
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    const skills = vm.skills;
    // At least the 16 canonical skills must be present (doc also declares
    // acrobatics/athletics/stealth on system.skills, which are a subset).
    expect(skills.length).toBeGreaterThanOrEqual(16);
    const slugs = skills.map((s) => s.slug);
    for (const slug of [
      "acrobatics",
      "arcana",
      "athletics",
      "crafting",
      "deception",
      "diplomacy",
      "intimidation",
      "medicine",
      "nature",
      "occultism",
      "performance",
      "religion",
      "society",
      "stealth",
      "survival",
      "thievery",
    ]) {
      expect(slugs).toContain(slug);
    }
    // Untrained fallback total is 0 when no derived data exists.
    const arcana = skills.find((s) => s.slug === "arcana")!;
    expect(arcana.rank).toBe(0);
    expect(arcana.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// spellTabs — R10-C4 item 2 (DEC-R10-03)
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — spellTabs", () => {
  function makeTwoEntryDoc(): Record<string, unknown> {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    // Second non-focus entry.
    items.push({
      _id: "entry-divine",
      name: "Divine Font",
      type: "spellcastingEntry",
      system: {
        tradition: "divine",
        prepared: "prepared",
        ability: "wis",
        slots: { "0": { value: 0, max: 0 }, "1": { value: 1, max: 1 } },
      },
    });
    // Focus entry.
    items.push({
      _id: "entry-focus",
      name: "Bloodline Focus Spells",
      type: "spellcastingEntry",
      system: {
        tradition: "arcane",
        prepared: "focus",
        ability: "cha",
        isFocusPool: true,
        slots: {},
      },
    });
    // A spell that lives under the divine entry, to verify location routing.
    items.push({
      _id: "spell-heal",
      name: "Heal",
      type: "spell",
      location: "entry-divine",
      system: { level: 1, defense: { spellAttack: false }, castTime: "2A" },
    });
    return doc;
  }

  it("returns [entry1, entry2, Focus] with no Rituals tab when there are no ritual items", () => {
    const doc = makeTwoEntryDoc();
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    const tabs = vm.spellTabs;
    expect(tabs.map((t) => t.key)).toEqual(["entry-arcane", "entry-divine", "focus"]);
    expect(tabs.map((t) => t.kind)).toEqual(["entry", "entry", "focus"]);
    expect(tabs.some((t) => t.kind === "rituals")).toBe(false);

    const focusTab = tabs.find((t) => t.kind === "focus")!;
    expect(focusTab.entries).toHaveLength(1);
    expect(focusTab.entries[0]!.entryId).toBe("entry-focus");
  });

  it("adds a Rituals tab when the actor has a ritual item", () => {
    const doc = makeTwoEntryDoc();
    const items = doc["items"] as Array<Record<string, unknown>>;
    items.push({
      _id: "ritual-item",
      name: "Some Ritual",
      type: "ritual",
      system: { level: 3 },
    });
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    const tabs = vm.spellTabs;
    expect(tabs.map((t) => t.kind)).toEqual(["entry", "entry", "focus", "rituals"]);
    const ritualsTab = tabs.find((t) => t.kind === "rituals")!;
    expect(ritualsTab.key).toBe("rituals");
    expect(ritualsTab.entries).toEqual([]);
  });

  it("associates spells to the correct entry tab via item location", () => {
    const doc = makeTwoEntryDoc();
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    const tabs = vm.spellTabs;
    const divineTab = tabs.find((t) => t.key === "entry-divine")!;
    const spellNames = divineTab.entries[0]!.slots.flatMap((s) => s.spells.map((sp) => sp.name));
    expect(spellNames).toContain("Heal");

    const arcaneTab = tabs.find((t) => t.key === "entry-arcane")!;
    const arcaneSpellNames = arcaneTab.entries[0]!.slots.flatMap((s) =>
      s.spells.map((sp) => sp.name),
    );
    expect(arcaneSpellNames).not.toContain("Heal");
  });
});

// ---------------------------------------------------------------------------
// Spell management ops — R10-C4 item 3 (DEC-R10-04), validated against the
// real Zod wire schemas (best proof of contract).
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — spell management ops (protocol-validated)", () => {
  it("addSpellToEntry builds a doc:create with parent Actor, location=entryId, and no _id", () => {
    const vm = makeVM();
    const spellDoc = {
      _id: "compendium-spell-id-should-be-dropped",
      name: "Fireball",
      type: "spell",
      system: { level: 3 },
    };
    const op = vm.addSpellToEntry("entry-arcane", spellDoc);
    expect(op).not.toBeNull();
    expect(op!.type).toBe("doc:create");
    expect(op!.parent).toEqual({ type: "Actor", id: "actor-001" });
    expect(op!.data["location"]).toBe("entry-arcane");
    expect(op!.data["_id"]).toBeUndefined();
    expect("_id" in op!.data).toBe(false);

    // Validate against the real wire schema (data must be normalized to an array).
    const wirePayload = { documentType: op!.documentType, data: [op!.data], parent: op!.parent };
    const result = DocCreatePayloadSchema.safeParse(wirePayload);
    expect(result.success).toBe(true);
  });

  it("addSpellToEntry returns null when not editable", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.addSpellToEntry("entry-arcane", { name: "Fireball" })).toBeNull();
  });

  it("removeSpell builds a doc:delete with parent Actor", () => {
    const vm = makeVM();
    const op = vm.removeSpell("spell-magic-missile");
    expect(op).not.toBeNull();
    expect(op!.type).toBe("doc:delete");
    expect(op!.id).toBe("spell-magic-missile");
    expect(op!.parent).toEqual({ type: "Actor", id: "actor-001" });

    const wirePayload = { documentType: op!.documentType, ids: [op!.id], parent: op!.parent };
    const result = DocDeletePayloadSchema.safeParse(wirePayload);
    expect(result.success).toBe(true);
  });

  it("removeSpell returns null when not editable", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.removeSpell("spell-magic-missile")).toBeNull();
  });

  it("prepareSpell builds a minimal doc:update diff targeting the embedded entry Item", () => {
    const vm = makeVM();
    const op = vm.prepareSpell("entry-arcane", 1, 0, "spell-magic-missile");
    expect(op).not.toBeNull();
    expect(op!.type).toBe("doc:update");
    expect(op!.documentType).toBe("Item");
    expect(op!.id).toBe("entry-arcane");
    // embedded.id is the PARENT Actor's id (the server loads the parent by
    // embedded.id and edits child `_id` inside its items[]) — regression for
    // the r10-C live finding "Parent not found: Actor/<entryId>".
    expect(op!.embedded).toEqual({ type: "Item", id: "actor-001" });
    // The diff carries the WHOLE prepared array (never a `prepared.<index>`
    // path — the server's diff applier would morph the array into an object;
    // r10-C live finding "Expected array, received object").
    expect(op!.diff).toEqual({
      "system.slots.1.prepared": [{ id: "spell-magic-missile", expended: false }],
    });

    // Validate against the real wire schema (single update, batched).
    const wirePayload = {
      documentType: op!.documentType,
      updates: [{ _id: op!.id, diff: op!.diff, embedded: op!.embedded }],
    };
    const result = DocUpdatePayloadSchema.safeParse(wirePayload);
    expect(result.success).toBe(true);
  });

  it("unprepareSlot builds a doc:update diff clearing the slot with the {id:'', expended:false} sentinel", () => {
    const vm = makeVM();
    const op = vm.unprepareSlot("entry-arcane", 1, 0);
    expect(op).not.toBeNull();
    expect(op!.diff).toEqual({
      "system.slots.1.prepared": [{ id: "", expended: false }],
    });
    expect(op!.embedded).toEqual({ type: "Item", id: "actor-001" });

    const wirePayload = {
      documentType: op!.documentType,
      updates: [{ _id: op!.id, diff: op!.diff, embedded: op!.embedded }],
    };
    const result = DocUpdatePayloadSchema.safeParse(wirePayload);
    expect(result.success).toBe(true);
  });

  it("toggleSlotExpended flips expended from false to true (minimal diff)", () => {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    const entry = items.find((i) => i["_id"] === "entry-arcane")!;
    (entry["system"] as Record<string, unknown>)["slots"] = {
      "1": { value: 2, max: 3, prepared: [{ id: "spell-magic-missile", expended: false }] },
    };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    const op = vm.toggleSlotExpended("entry-arcane", 1, 0);
    expect(op).not.toBeNull();
    expect(op!.diff).toEqual({
      "system.slots.1.prepared": [{ id: "spell-magic-missile", expended: true }],
    });

    const wirePayload = {
      documentType: op!.documentType,
      updates: [{ _id: op!.id, diff: op!.diff, embedded: op!.embedded }],
    };
    const result = DocUpdatePayloadSchema.safeParse(wirePayload);
    expect(result.success).toBe(true);
  });

  it("toggleSlotExpended flips expended from true back to false", () => {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    const entry = items.find((i) => i["_id"] === "entry-arcane")!;
    (entry["system"] as Record<string, unknown>)["slots"] = {
      "1": { value: 2, max: 3, prepared: [{ id: "spell-magic-missile", expended: true }] },
    };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    const op = vm.toggleSlotExpended("entry-arcane", 1, 0);
    expect(op!.diff).toEqual({
      "system.slots.1.prepared": [{ id: "spell-magic-missile", expended: false }],
    });
  });

  it("prepareSpell/unprepareSlot/toggleSlotExpended return null when not editable", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.prepareSpell("entry-arcane", 1, 0, "spell-x")).toBeNull();
    expect(vm.unprepareSlot("entry-arcane", 1, 0)).toBeNull();
    expect(vm.toggleSlotExpended("entry-arcane", 1, 0)).toBeNull();
  });

  it("getPreparedSlot reads the raw prepared-slot entry", () => {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    const entry = items.find((i) => i["_id"] === "entry-arcane")!;
    (entry["system"] as Record<string, unknown>)["slots"] = {
      "1": { value: 2, max: 3, prepared: [{ id: "spell-magic-missile", expended: true }] },
    };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.getPreparedSlot("entry-arcane", 1, 0)).toEqual({
      id: "spell-magic-missile",
      expended: true,
    });
    expect(vm.getPreparedSlot("entry-arcane", 1, 5)).toBeNull();
    expect(vm.getPreparedSlot("does-not-exist", 1, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// restAll — "Descansar" header button (feedback: expended slots had no
// recovery path). Recovers every expended prepared slot across every
// spellcasting entry/rank + refills Focus Points to max. Never touches HP.
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — restAll", () => {
  it("clears expended on every rank across every entry (one op per rank-with-expended-slots)", () => {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    const entry = items.find((i) => i["_id"] === "entry-arcane")!;
    (entry["system"] as Record<string, unknown>)["slots"] = {
      "0": { value: 0, max: 0 },
      "1": {
        value: 2,
        max: 3,
        prepared: [
          { id: "spell-magic-missile", expended: true },
          { id: "spell-x", expended: false },
        ],
      },
      "2": {
        value: 1,
        max: 1,
        prepared: [{ id: "spell-y", expended: true }],
      },
    };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });

    const ops = vm.restAll();
    // Two ranks had at least one expended slot → 2 doc:update ops (no focus
    // points on this fixture, so no third op).
    expect(ops.length).toBe(2);

    const rank1Op = ops.find((op) => "diff" in op && "system.slots.1.prepared" in (op as { diff: Record<string, unknown> }).diff);
    expect(rank1Op).toBeDefined();
    expect((rank1Op as { diff: Record<string, unknown> }).diff).toEqual({
      "system.slots.1.prepared": [
        { id: "spell-magic-missile", expended: false },
        { id: "spell-x", expended: false },
      ],
    });
    expect((rank1Op as { embedded?: unknown }).embedded).toEqual({ type: "Item", id: "actor-001" });

    const rank2Op = ops.find((op) => "diff" in op && "system.slots.2.prepared" in (op as { diff: Record<string, unknown> }).diff);
    expect((rank2Op as { diff: Record<string, unknown> }).diff).toEqual({
      "system.slots.2.prepared": [{ id: "spell-y", expended: false }],
    });

    // Every emitted op validates against the real wire schema.
    for (const op of ops) {
      const u = op as { documentType: string; id: string; diff: Record<string, unknown>; embedded?: { type: string; id: string } };
      const wirePayload = { documentType: u.documentType, updates: [{ _id: u.id, diff: u.diff, embedded: u.embedded }] };
      expect(DocUpdatePayloadSchema.safeParse(wirePayload).success).toBe(true);
    }
  });

  it("also refills focusPoints.value to max when below max", () => {
    const doc = makeCharacter();
    (doc["system"] as Record<string, unknown>)["resources"] = {
      heroPoints: { value: 1, max: 3 },
      focusPoints: { value: 1, max: 3 },
    };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    const ops = vm.restAll();
    const focusOp = ops.find(
      (op) => "diff" in op && "system.resources.focusPoints.value" in (op as { diff: Record<string, unknown> }).diff,
    );
    expect(focusOp).toBeDefined();
    expect((focusOp as { diff: Record<string, unknown> }).diff["system.resources.focusPoints.value"]).toBe(3);
  });

  it("returns an empty array when nothing is expended and focus points are full", () => {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    const entry = items.find((i) => i["_id"] === "entry-arcane")!;
    (entry["system"] as Record<string, unknown>)["slots"] = {
      "1": { value: 2, max: 3, prepared: [{ id: "spell-magic-missile", expended: false }] },
    };
    (doc["system"] as Record<string, unknown>)["resources"] = {
      heroPoints: { value: 1, max: 3 },
      focusPoints: { value: 2, max: 2 },
    };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.restAll()).toEqual([]);
  });

  it("returns an empty array when not editable", () => {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    const entry = items.find((i) => i["_id"] === "entry-arcane")!;
    (entry["system"] as Record<string, unknown>)["slots"] = {
      "1": { value: 2, max: 3, prepared: [{ id: "spell-magic-missile", expended: true }] },
    };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OBSERVER,
      userId: "u",
      isGm: false,
    });
    expect(vm.restAll()).toEqual([]);
  });

  it("skips cantrip slots (rank 0 has no expended concept)", () => {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    const entry = items.find((i) => i["_id"] === "entry-arcane")!;
    (entry["system"] as Record<string, unknown>)["slots"] = {
      "0": { value: 0, max: 0, prepared: [{ id: "spell-shield", expended: true }] },
    };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.restAll()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveSpellName — prepared-slot name resolution across 3 embedded layers
// + dangling ref (DEC-R12-05, W3 r12). Layer 4 (compendium on-demand) lives
// in the Svelte component; here we verify layers 1-3 + the null contract.
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — resolveSpellName (DEC-R12-05)", () => {
  it("layer 1: resolves a spell grouped under the given entry", () => {
    const vm = makeVM();
    // Magic Missile is embedded with location=entry-arcane at rank 1.
    expect(vm.resolveSpellName("entry-arcane", "spell-magic-missile")).toBe("Magic Missile");
  });

  it("layer 2: resolves a spell that belongs to a DIFFERENT entry", () => {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    items.push({
      _id: "entry-divine",
      name: "Divine",
      type: "spellcastingEntry",
      system: { tradition: "divine", prepared: "prepared", ability: "wis", slots: {} },
    });
    items.push({
      _id: "spell-heal",
      name: "Heal",
      type: "spell",
      location: "entry-divine",
      system: { level: 1 },
    });
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    // Asked for it under entry-arcane, but it lives under entry-divine — still found.
    expect(vm.resolveSpellName("entry-arcane", "spell-heal")).toBe("Heal");
  });

  it("layer 3: resolves an embedded spell whose location link is stale/wrong", () => {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    // A spell embedded but pointing at a non-existent entry (mislinked).
    items.push({
      _id: "spell-orphan-link",
      name: "Mislinked Spell",
      type: "spell",
      location: "entry-does-not-exist",
      system: { level: 2 },
    });
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    // Not grouped under any entry (layers 1-2 miss), but the embedded item
    // exists (layer 3 recovers it by id, location-agnostic).
    expect(vm.resolveSpellName("entry-arcane", "spell-orphan-link")).toBe("Mislinked Spell");
  });

  it("returns null for a dangling reference (id matches no embedded spell — Tobias 'QM1xJwDDsAEYA3uJ')", () => {
    const vm = makeVM();
    expect(vm.resolveSpellName("entry-arcane", "QM1xJwDDsAEYA3uJ")).toBeNull();
  });

  it("returns null for an empty/blank id (unprepared-slot sentinel)", () => {
    const vm = makeVM();
    expect(vm.resolveSpellName("entry-arcane", "")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// focusSpells / focusEntryId — Foco tab (DEC-R12-05, feedback b).
// Heal-on-read: focus spells are collected by the "focus" trait OR by a link
// to an isFocusPool entry, regardless of a possibly-wrong location.
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — focusSpells / focusEntryId", () => {
  function makeFocusDoc(): Record<string, unknown> {
    const doc = makeCharacter();
    const items = doc["items"] as Array<Record<string, unknown>>;
    items.push({
      _id: "entry-focus",
      name: "Focus Spells",
      type: "spellcastingEntry",
      system: { tradition: "arcane", prepared: "focus", ability: "int", isFocusPool: true, slots: {} },
    });
    return doc;
  }

  it("returns [] and null entry when there are no focus spells/entries", () => {
    const vm = makeVM();
    expect(vm.focusSpells).toEqual([]);
    expect(vm.focusEntryId).toBeNull();
  });

  it("exposes the focus-pool entry id when present", () => {
    const vm = new CharacterSheetVM({
      doc: makeFocusDoc(),
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.focusEntryId).toBe("entry-focus");
  });

  it("collects a spell linked to the focus entry (correct location)", () => {
    const doc = makeFocusDoc();
    const items = doc["items"] as Array<Record<string, unknown>>;
    items.push({
      _id: "spell-shooting-star",
      name: "Shooting Star",
      type: "spell",
      location: "entry-focus",
      system: { level: 1, traits: { value: ["focus"] } },
    });
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.focusSpells.map((s) => s.name)).toEqual(["Shooting Star"]);
  });

  it("heals on read: collects a focus-trait spell even when its location is wrong", () => {
    const doc = makeFocusDoc();
    const items = doc["items"] as Array<Record<string, unknown>>;
    items.push({
      _id: "spell-conflux",
      name: "Conflux Spell",
      type: "spell",
      // location points at the NON-focus arcane entry (mislinked), but the
      // focus trait makes it a focus spell regardless.
      location: "entry-arcane",
      system: { level: 1, traits: { value: ["focus", "magus"] } },
    });
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.focusSpells.map((s) => s.name)).toContain("Conflux Spell");
  });

  it("does not double-count a focus-trait spell that is also linked to the focus entry", () => {
    const doc = makeFocusDoc();
    const items = doc["items"] as Array<Record<string, unknown>>;
    items.push({
      _id: "spell-both",
      name: "Both",
      type: "spell",
      location: "entry-focus",
      system: { level: 1, traits: { value: ["focus"] } },
    });
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.focusSpells.filter((s) => s.id === "spell-both")).toHaveLength(1);
  });

  it("does not collect ordinary (non-focus) spells", () => {
    const vm = new CharacterSheetVM({
      doc: makeFocusDoc(),
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    // The base fixture's Magic Missile / Shield / Ray of Frost are not focus.
    expect(vm.focusSpells).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// archetypeClassDCs getter — DEC-R12-04 exposure to the sheet.
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — archetypeClassDCs", () => {
  it("returns [] when derived.archetypeClassDCs is absent (pre-r12 doc)", () => {
    const vm = makeVM();
    expect(vm.archetypeClassDCs).toEqual([]);
  });

  it("exposes derived.archetypeClassDCs verbatim when present (Alchemist DC 18)", () => {
    const doc = makeCharacter();
    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    derived["archetypeClassDCs"] = [
      { slug: "alchemist", label: "Alchemist", ability: "int", rank: 1, total: 8, dc: 18 },
    ];
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.archetypeClassDCs).toHaveLength(1);
    expect(vm.archetypeClassDCs[0]!.slug).toBe("alchemist");
    expect(vm.archetypeClassDCs[0]!.dc).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// sendOp normalization — R10-C4 item 4 (regression + embedded passthrough).
// Exercised indirectly through the exact payload shapes the VM produces,
// mirroring normalizeDocUpdate/normalizeDocCreate/normalizeDocDelete in
// packages/client/src/lib/docs/sendOp.ts (covered directly in sendOp.test.ts).
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — op payload shapes stay wire-compatible", () => {
  it("doc:update ops without embedded (flat legacy shape) still validate", () => {
    const vm = makeVM();
    const op = vm.applyHpDelta(-5);
    expect(op).not.toBeNull();
    expect(op!.embedded).toBeUndefined();
    const wirePayload = {
      documentType: op!.documentType,
      updates: [{ _id: op!.id, diff: op!.diff }],
    };
    expect(DocUpdatePayloadSchema.safeParse(wirePayload).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Focus points cap + spell picker filters — R10-C4 item 5
// ---------------------------------------------------------------------------

describe("CharacterSheetVM — setFocusPoints hard cap at 3 (DEC-R10-02)", () => {
  it("clamps to 3 even when focusPoints.max is stale/higher (e.g. 5)", () => {
    const doc = makeCharacter();
    (doc["system"] as Record<string, unknown>)["resources"] = {
      heroPoints: { value: 1, max: 3 },
      focusPoints: { value: 1, max: 5 },
    };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.setFocusPoints(99)!.diff["system.resources.focusPoints.value"]).toBe(3);
  });

  it("still respects a lower max (e.g. 2) below the hard cap", () => {
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
    expect(vm.setFocusPoints(99)!.diff["system.resources.focusPoints.value"]).toBe(2);
  });

  it("clamps at 0 for negative input regardless of max", () => {
    const doc = makeCharacter();
    (doc["system"] as Record<string, unknown>)["resources"] = {
      heroPoints: { value: 1, max: 3 },
      focusPoints: { value: 1, max: 5 },
    };
    const vm = new CharacterSheetVM({
      doc,
      actorId: "actor-001",
      ownership: OwnershipLevel.OWNER,
      userId: "u",
      isGm: true,
    });
    expect(vm.setFocusPoints(-1)!.diff["system.resources.focusPoints.value"]).toBe(0);
  });

  it("returns null when not editable", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.setFocusPoints(2)).toBeNull();
  });
});

describe("filterSpellPicker", () => {
  function entry(name: string, level: number, traditions: string[] = []): SpellPickerEntry {
    return {
      name,
      index: {
        "system.level": level,
        "system.traits.traditions": traditions,
      },
    };
  }

  const entries: SpellPickerEntry[] = [
    entry("Shield", 0, ["arcane", "divine", "occult", "primal"]),
    entry("Magic Missile", 1, ["arcane"]),
    entry("Heal", 1, ["divine", "primal"]),
    entry("Fireball", 3, ["arcane", "primal"]),
  ];

  it("filters by maxRank (inclusive)", () => {
    const result = filterSpellPicker(entries, { maxRank: 1 });
    expect(result.map((e) => e.name)).toEqual(["Shield", "Magic Missile", "Heal"]);
  });

  it("filters by tradition membership", () => {
    const result = filterSpellPicker(entries, { tradition: "divine" });
    expect(result.map((e) => e.name)).toEqual(["Shield", "Heal"]);
  });

  it("filters by case-insensitive name substring", () => {
    const result = filterSpellPicker(entries, { search: "fire" });
    expect(result.map((e) => e.name)).toEqual(["Fireball"]);
  });

  it("combines maxRank + tradition + search with AND semantics", () => {
    const result = filterSpellPicker(entries, {
      maxRank: 1,
      tradition: "arcane",
      search: "mag",
    });
    expect(result.map((e) => e.name)).toEqual(["Magic Missile"]);
  });

  it("returns all entries when no filters are given", () => {
    const result = filterSpellPicker(entries, {});
    expect(result).toHaveLength(4);
  });

  it("returns empty array when no entry matches", () => {
    const result = filterSpellPicker(entries, { search: "nonexistent-spell-name" });
    expect(result).toEqual([]);
  });

  // Accent-insensitive search (picker UX fix): pt-BR users type with
  // diacritics but pack names are English/ASCII — and vice versa.
  it("matches accented query against ASCII name", () => {
    const result = filterSpellPicker(entries, { search: "mágic" });
    expect(result.map((e) => e.name)).toEqual(["Magic Missile"]);
  });

  it("matches ASCII query against accented name", () => {
    const accented = [entry("Revelação Arcana", 2, ["arcane"])];
    const result = filterSpellPicker(accented, { search: "revelacao" });
    expect(result.map((e) => e.name)).toEqual(["Revelação Arcana"]);
  });
});

// ---------------------------------------------------------------------------
// sortSpellPickerEntries — picker display order (rank asc → name asc)
// ---------------------------------------------------------------------------

describe("sortSpellPickerEntries", () => {
  function entry(name: string, level: number): SpellPickerEntry {
    return { name, index: { "system.level": level } };
  }

  it("sorts by rank ascending, then name ascending", () => {
    const entries = [
      entry("Zephyr", 1),
      entry("Fireball", 3),
      entry("Aid", 1),
      entry("Shield", 0),
    ];
    const result = sortSpellPickerEntries(entries);
    expect(result.map((e) => e.name)).toEqual(["Shield", "Aid", "Zephyr", "Fireball"]);
  });

  it("sorts names case- and accent-insensitively within a rank", () => {
    const entries = [entry("échelon", 1), entry("Ebb", 1), entry("acid", 1)];
    const result = sortSpellPickerEntries(entries);
    expect(result.map((e) => e.name)).toEqual(["acid", "Ebb", "échelon"]);
  });

  it("does not mutate the input array", () => {
    const entries = [entry("B", 2), entry("A", 1)];
    const snapshot = [...entries];
    sortSpellPickerEntries(entries);
    expect(entries).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// resolveInitialTradition — soft tradition default (never-empty-on-open fix)
// ---------------------------------------------------------------------------

describe("resolveInitialTradition", () => {
  function entry(name: string, traditions: string[]): SpellPickerEntry {
    return { name, index: { "system.traits.traditions": traditions } };
  }

  const entries = [
    entry("Magic Missile", ["arcane"]),
    entry("Heal", ["divine", "primal"]),
    entry("Force Fang", []), // focus spell — no traditions
  ];

  it("returns the tradition when at least one entry matches it", () => {
    expect(resolveInitialTradition(entries, "arcane")).toBe("arcane");
    expect(resolveInitialTradition(entries, "divine")).toBe("divine");
  });

  it("returns null when no entry carries the tradition (mismatch never empties the list)", () => {
    expect(resolveInitialTradition(entries, "occult")).toBeNull();
    expect(resolveInitialTradition(entries, "Arcane")).toBeNull(); // wrong casing = mismatch
  });

  it("returns null for empty/blank/undefined tradition", () => {
    expect(resolveInitialTradition(entries, "")).toBeNull();
    expect(resolveInitialTradition(entries, "   ")).toBeNull();
    expect(resolveInitialTradition(entries, undefined)).toBeNull();
  });

  it("returns null for an empty index (default filter returns non-empty list downstream)", () => {
    expect(resolveInitialTradition([], "arcane")).toBeNull();
  });

  it("guarantees the default filter pipeline yields a non-empty, sorted list", () => {
    // End-to-end guard for the original bug: apply the SAME pipeline the
    // picker uses on open (soft tradition + no search + sort) and assert the
    // result is non-empty and rank->name ordered even when the entry's
    // tradition matches nothing in the pack.
    const pack = [
      { name: "Zeta", index: { "system.level": 2, "system.traits.traditions": [] } },
      { name: "Alpha", index: { "system.level": 1, "system.traits.traditions": [] } },
      { name: "Beta", index: { "system.level": 1, "system.traits.traditions": [] } },
    ];
    const tradition = resolveInitialTradition(pack, "arcane"); // no match → null
    const filtered = filterSpellPicker(pack, {
      ...(tradition !== null ? { tradition } : {}),
      search: "",
    });
    const sorted = sortSpellPickerEntries(filtered);
    expect(sorted.length).toBeGreaterThan(0);
    expect(sorted.map((e) => e.name)).toEqual(["Alpha", "Beta", "Zeta"]);
  });
});
