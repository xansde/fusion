/**
 * @fusion/system-pf2e — Build-driven schema round-trips + full "Tobias por
 * build" fixture (R10-A / TASK A3).
 *
 * This file complements `derivations-build.test.ts` (A2's simplified
 * fixture) with:
 *   1. A full-fidelity "Tobias por build" fixture reproducing ALL the trained
 *      skills from the r10 plan's acceptance criterion (arcana, crafting
 *      EXPERT, diplomacy, medicine, occultism, performance, society,
 *      stealth, thievery, + Lore Fireworks), not just the two skills the A2
 *      fixture exercised — including the Untrained baselines (acrobatics,
 *      athletics) DEC-R10-07 requires to always be present.
 *   2. `spellSlotsForLevel` exercised against the ACTUAL Magus progression
 *      table shape defined on the class item (levels 1, 2, 3), matching the
 *      Pathbuilder per-day layout referenced in the task prompt.
 *   3. Schema round-trips: the new `classFeature` item type, `ClassSystemSchema`
 *      with a full structured progression block, the `build` block on
 *      `CharacterSystemSchema`, and a pre-r10 (no `build` field) character doc
 *      continuing to validate untouched (compat guarantee, DEC-R10-01).
 *
 * NOTE on ability-boost origins (same disclaimer as derivations-build.test.ts):
 * the boost/flaw sequence below is SYNTHETIC — chosen to land on the plan's
 * target scores (STR 10, DEX 16, CON 12, INT 16, WIS 10, CHA 14) via the
 * documented boost math, not a literal reproduction of Ratfolk/Snow
 * Rat/Fireworks Performer lore (that is exercised by the R10-B importer
 * tests). This file verifies BUILD MACHINERY + SCHEMA VALIDITY, which are
 * origin-agnostic.
 *
 * Clean-room: ORC/OGL mechanics only.
 * REQ-PF2-003, REQ-PF2-010..022, REQ-PF2-083, REQ-PF2-204,
 * DEC-R10-01/02/06/07.
 */

import { describe, it, expect } from "vitest";
import { emptySynthetics } from "@fusion/system-api";
import type { DeriveContext } from "@fusion/system-api";
import { pf2eSystem } from "../index.js";
import { spellSlotsForLevel } from "../derivations/build.js";
import type { ClassSpellcasting } from "../schemas/item-equipment.js";
import { ClassSystemSchema } from "../schemas/item-equipment.js";
import { ClassFeatureSystemSchema } from "../schemas/item-class-feature.js";
import { CharacterSystemSchema } from "../schemas/actor-character.js";

function emptyCtx(): DeriveContext {
  return {
    system: pf2eSystem,
    synthetics: emptySynthetics(),
    rollOptions: new Set<string>(),
  };
}

function runCharacterPipeline(doc: Record<string, unknown>): void {
  const baseSteps = pf2eSystem.deriveSteps.sortedForPhase("base", "Actor", "character");
  for (const step of baseSteps) {
    step.run(doc, emptyCtx());
  }
  const derivedSteps = pf2eSystem.deriveSteps.sortedForPhase("derived", "Actor", "character");
  for (const step of derivedSteps) {
    step.run(doc, emptyCtx());
  }
}

// ---------------------------------------------------------------------------
// Shared Magus class item fixture (level 1 base + proficiencyUpgrades to 3)
// ---------------------------------------------------------------------------

/**
 * A structurally complete Magus class item's `system` block, matching the
 * shape `ClassSystemSchema` (A1) defines: level-1 initial proficiencies +
 * `proficiencyUpgrades` entries bringing Fortitude/Will to Expert (rank 2)
 * and the classDC to Trained (rank 1) — mirroring the fixture used in
 * `derivations-build.test.ts` for numeric parity.
 */
function magusClassSystem(): Record<string, unknown> {
  return {
    hp: 8,
    keyAbility: ["int"],
    perception: 1, // Trained at level 1
    savingThrows: { fortitude: 2, reflex: 1, will: 2 }, // Expert/Trained/Expert
    defenses: { unarmored: 1, light: 1, medium: 0, heavy: 0 },
    attacks: { unarmed: 1, simple: 1, martial: 1, advanced: 0 },
    classDC: 1, // Trained at level 1
    featLevels: { ancestry: [], class: [2], general: [3], skill: [2] },
    skillIncreaseLevels: [],
    abilityBoostLevels: [5, 10, 15, 20],
    trainedSkills: { value: ["arcana"], additional: 1 },
    proficiencyUpgrades: [],
    spellcasting: {
      tradition: "arcane",
      type: "prepared",
      ability: "int",
      cantripsKnown: [
        { level: 1, count: 5 },
        { level: 3, count: 5 },
      ],
      slots: [
        // Pathbuilder-style perDay layout: level 1 → 1 rank-1 slot;
        // level 2 → 2 rank-1 slots; level 3 → 2 rank-1 + 1 rank-2 slots.
        { level: 1, slots: { "1": 1 } },
        { level: 2, slots: { "1": 2 } },
        { level: 3, slots: { "1": 2, "2": 1 } },
      ],
    },
    featuresByLevel: [],
  };
}

// ---------------------------------------------------------------------------
// 1. Full "Tobias por build" fixture — all trained skills from the r10 plan
// ---------------------------------------------------------------------------

describe("Tobias-por-build (full fixture) — level 3 Magus, all plan skills", () => {
  function makeDoc(): Record<string, unknown> {
    return {
      system: {
        systemVersion: "0.1.0",
        level: { value: 3 },
        abilities: {
          str: { value: 10, mod: 0 },
          dex: { value: 10, mod: 0 },
          con: { value: 10, mod: 0 },
          int: { value: 10, mod: 0 },
          wis: { value: 10, mod: 0 },
          cha: { value: 10, mod: 0 },
        },
        attributes: {
          hp: { value: 0, max: 0, temp: 0 },
          ac: { value: 10 },
          speed: { value: 25, otherSpeeds: [] },
          dying: { value: 0, max: 4 },
          wounded: { value: 0 },
          doomed: { value: 0 },
          iwr: { immunities: [], weaknesses: [], resistances: [] },
        },
        saves: { fortitude: { rank: 0 }, reflex: { rank: 0 }, will: { rank: 0 } },
        perception: { rank: 0, senses: [] },
        skills: {
          "fireworks-lore": { rank: 1, lore: true },
        },
        proficiencies: {},
        resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 1, max: 1 } },
        details: { keyAbility: "str", level: 3 },
        traits: { rarity: "common", value: [], size: "sm" },
        build: {
          abilities: {
            // Synthetic sequence landing on STR10/DEX16/CON12/INT16/WIS10/CHA14
            // (see file-level NOTE).
            ancestryBoosts: ["dex", "int"],
            ancestryFlaws: ["str"],
            ancestryFree: ["cha"],
            backgroundBoosts: ["int", "dex"],
            classBoost: ["str"],
            levelledBoosts: { "1": ["int", "dex", "con", "cha"] },
          },
          choices: [
            { level: 1, slot: "skillTraining-1", type: "skillTraining", skill: "diplomacy" },
            { level: 1, slot: "skillTraining-2", type: "skillTraining", skill: "medicine" },
            { level: 1, slot: "skillTraining-3", type: "skillTraining", skill: "occultism" },
            { level: 1, slot: "skillTraining-4", type: "skillTraining", skill: "performance" },
            { level: 1, slot: "skillTraining-5", type: "skillTraining", skill: "society" },
            { level: 1, slot: "skillTraining-6", type: "skillTraining", skill: "stealth" },
            { level: 1, slot: "skillTraining-7", type: "skillTraining", skill: "thievery" },
            {
              level: 3,
              slot: "skillIncrease-1",
              type: "skillIncrease",
              skill: "crafting",
              rank: 1,
            },
            {
              level: 3,
              slot: "skillIncrease-1b",
              type: "skillIncrease",
              skill: "crafting",
              rank: 2,
            },
          ],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
      items: [
        {
          _id: "ancestry-ratfolk",
          name: "Ratfolk",
          type: "ancestry",
          system: { hp: 6, speed: 25, size: "sm", boosts: [], flaws: [], languages: { value: [] } },
        },
        {
          _id: "class-magus",
          name: "Magus",
          type: "class",
          system: magusClassSystem(),
        },
        {
          _id: "leather-1",
          name: "Leather Armor",
          type: "armor",
          system: {
            category: "light",
            acBonus: 1,
            dexCap: 2,
            runes: { potency: 1 },
            equipped: true,
          },
        },
      ],
    };
  }

  let doc: Record<string, unknown>;

  it("abilities: STR 10, DEX 16, CON 12, INT 16, WIS 10, CHA 14", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as { abilities: Record<string, { value: number }> };
    expect(sys.abilities.str.value).toBe(10);
    expect(sys.abilities.dex.value).toBe(16);
    expect(sys.abilities.con.value).toBe(12);
    expect(sys.abilities.int.value).toBe(16);
    expect(sys.abilities.wis.value).toBe(10);
    expect(sys.abilities.cha.value).toBe(14);
  });

  it("HP max = 33 (ancestry 6 + (class 8 + conMod 1) * level 3)", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as { max: number };
    expect(hp.max).toBe(33);
  });

  it("saves: Fortitude +8, Reflex +8, Will +7", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    expect(saves["fortitude"]?.total).toBe(8); // Expert@lvl3(7) + CON+1
    expect(saves["reflex"]?.total).toBe(8); // Trained@lvl3(5) + DEX+3
    expect(saves["will"]?.total).toBe(7); // Expert@lvl3(7) + WIS+0
  });

  it("perception +5 (Trained, WIS 0)", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const perception = derived["perception"] as { total: number };
    // Trained@lvl3 = 5; WIS mod 0 → 5
    expect(perception.total).toBe(5);
  });

  it("AC = 19 (leather +1 item bonus, dexCap 2, Trained light armor)", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const ac = derived["ac"] as { total: number };
    // 10 + cappedDex(2) + armorProf Trained@lvl3(5) + acBonus(1) + potency(1) = 19
    expect(ac.total).toBe(19);
  });

  it("class DC 15 via the ledger's classBoost (STR key — Pathbuilder shows 'Magus DC 15')", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const classDC = derived["classDC"] as { total: number; dc: number };
    // r11 fix: stepCharApplyClass prefers build.abilities.classBoost[0]
    // ('str' in this fixture) over the class item's keyAbility[0]. The old
    // expectation (INT-keyed DC 18) conflated the SPELL DC with the class
    // DC — the user's Pathbuilder export shows Magus DC 15 and Spell DC 18.
    // Trained@lvl3(5) + STR+0 = 5; dc = 15.
    expect(classDC.total).toBe(5);
    expect(classDC.dc).toBe(15);
  });

  it("skills: Acrobatics +3 untrained, Athletics +0 untrained (still present, DEC-R10-07)", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    // Untrained: no proficiency bonus, only ability mod.
    expect(skills["acrobatics"]?.total).toBe(3); // DEX +3
    expect(skills["athletics"]?.total).toBe(0); // STR +0
  });

  it("skills: Arcana +8 trained (class trained skill, INT key)", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    // Trained (rank1) @ level3 = 5; INT +3 = 8.
    expect(skills["arcana"]?.total).toBe(8);
  });

  it("skills: Crafting +10 expert (build skillIncrease to rank 2 at level 3)", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    // Expert (rank2) @ level3 = 7; INT +3 = 10.
    expect(skills["crafting"]?.total).toBe(10);
  });

  it("skills: Thievery +8 trained (build skillTraining choice)", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    // Trained (rank1) @ level3 = 5; DEX +3 = 8.
    expect(skills["thievery"]?.total).toBe(8);
  });

  it("skills: Diplomacy/Medicine/Occultism/Performance/Society/Stealth all trained", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    // Diplomacy/Performance: CHA +2, rank1@lvl3=5 → 7.
    expect(skills["diplomacy"]?.total).toBe(7);
    expect(skills["performance"]?.total).toBe(7);
    // Medicine: WIS +0, rank1@lvl3=5 → 5.
    expect(skills["medicine"]?.total).toBe(5);
    // Occultism/Society: INT +3, rank1@lvl3=5 → 8.
    expect(skills["occultism"]?.total).toBe(8);
    expect(skills["society"]?.total).toBe(8);
    // Stealth: DEX +3, rank1@lvl3=5 → 8.
    expect(skills["stealth"]?.total).toBe(8);
  });

  it("skills: Lore Fireworks +8 trained (persisted lore skill, INT-keyed)", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    // Lore uses INT regardless of slug: rank1@lvl3=5; INT +3 = 8.
    expect(skills["fireworks-lore"]?.total).toBe(8);
  });

  it("skills: exactly 17 entries (16 canonical + 1 lore)", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, unknown>;
    expect(Object.keys(skills)).toHaveLength(17);
  });

  it("focus points: persisted {value:1, max:1} → derived 1/1 (unaffected, already ≤ 3)", () => {
    doc = makeDoc();
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as {
      resources: { focusPoints: { value: number; max: number } };
    };
    expect(sys.resources.focusPoints.value).toBe(1);
    expect(sys.resources.focusPoints.max).toBe(1);
  });

  it("focus points: persisted max 5 (bypassing schema) is clamped to 3 by the derivation guard", () => {
    doc = makeDoc();
    ((doc.system as Record<string, unknown>)["resources"] as Record<string, unknown>)[
      "focusPoints"
    ] = { value: 5, max: 5 };
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as {
      resources: { focusPoints: { value: number; max: number } };
    };
    expect(sys.resources.focusPoints.max).toBe(3);
    expect(sys.resources.focusPoints.value).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 2. spellSlotsForLevel against the actual Magus progression shape
// ---------------------------------------------------------------------------

describe("spellSlotsForLevel — Magus progression (levels 1, 2, 3)", () => {
  const progression = magusClassSystem()["spellcasting"] as ClassSpellcasting;

  it("level 1: 5 cantrips known + 1 rank-1 slot", () => {
    const result = spellSlotsForLevel(progression, 1);
    expect(result.cantripsKnown).toBe(5);
    expect(result.slotsByRank).toEqual({ "1": 1 });
  });

  it("level 2: still 5 cantrips (no new entry), 2 rank-1 slots", () => {
    const result = spellSlotsForLevel(progression, 2);
    expect(result.cantripsKnown).toBe(5); // falls back to level-1 entry
    expect(result.slotsByRank).toEqual({ "1": 2 });
  });

  it("level 3: 5 cantrips known + 2 rank-1 + 1 rank-2 slots", () => {
    const result = spellSlotsForLevel(progression, 3);
    expect(result.cantripsKnown).toBe(5);
    expect(result.slotsByRank).toEqual({ "1": 2, "2": 1 });
  });
});

// ---------------------------------------------------------------------------
// 3. Compat r9 — doc WITHOUT a class item (e.g. the current argiburgo Tobias)
// ---------------------------------------------------------------------------

describe("Compat r9 — manual-entry doc without an embedded class item", () => {
  function makeManualTobiasDoc(): Record<string, unknown> {
    return {
      system: {
        systemVersion: "0.1.0",
        level: { value: 3 },
        abilities: {
          str: { value: 10, mod: 0 },
          dex: { value: 18, mod: 0 },
          con: { value: 12, mod: 0 },
          int: { value: 16, mod: 0 },
          wis: { value: 10, mod: 0 },
          cha: { value: 14, mod: 0 },
        },
        attributes: {
          hp: { value: 33, max: 33, temp: 0 },
          ac: { value: 10 },
          speed: { value: 25, otherSpeeds: [] },
          dying: { value: 0, max: 4 },
          wounded: { value: 0 },
          doomed: { value: 0 },
          iwr: { immunities: [], weaknesses: [], resistances: [] },
        },
        saves: { fortitude: { rank: 2 }, reflex: { rank: 1 }, will: { rank: 2 } },
        perception: { rank: 1, senses: [] },
        skills: {
          arcana: { rank: 1 },
          occultism: { rank: 1 },
          "fireworks-lore": { rank: 1, lore: true },
        },
        proficiencies: {
          classDC: { rank: 1 },
          weapons: { unarmed: 1, simple: 1, martial: 1, advanced: 0 },
          armor: { unarmored: 1, light: 1, medium: 0, heavy: 0 },
        },
        resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 1, max: 1 } },
        details: { keyAbility: "int", level: 3 },
        traits: { rarity: "common", value: [], size: "sm" },
        // NO `build` block at all — this is the r9 shape.
      },
      items: [], // no embedded class item
    };
  }

  it("HP max stays manual (33), not recomputed", () => {
    const doc = makeManualTobiasDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as { max: number };
    expect(hp.max).toBe(33);
  });

  it("saves/classDC ranks stay manual (Fortitude +8, Will +7, classDC 18)", () => {
    const doc = makeManualTobiasDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    const classDC = derived["classDC"] as { dc: number };
    expect(saves["fortitude"]?.total).toBe(8);
    expect(saves["will"]?.total).toBe(7);
    expect(classDC.dc).toBe(18);
  });

  it("the only permitted delta vs r9: all 16 skills now present (untrained included)", () => {
    const doc = makeManualTobiasDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    // 16 canonical + 1 lore.
    expect(Object.keys(skills)).toHaveLength(17);
    // Previously-untracked skills now appear as untrained (ability mod only).
    // NOTE: this fixture's DEX is 18 (mod +4), unlike the "por build" fixture
    // above (DEX 16, mod +3) — the two are deliberately different characters.
    expect(skills["athletics"]?.total).toBe(0); // STR +0
    expect(skills["stealth"]?.total).toBe(4); // DEX +4, untrained
    // Manually-authored trained skills are unchanged.
    expect(skills["arcana"]?.total).toBe(8); // Trained@lvl3(5) + INT+3
    expect(skills["occultism"]?.total).toBe(8);
  });

  it("ability scores are completely untouched (no build block to drive them)", () => {
    const doc = makeManualTobiasDoc();
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as { abilities: Record<string, { value: number }> };
    expect(sys.abilities.dex.value).toBe(18);
    expect(sys.abilities.int.value).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// 4. Schema round-trips
// ---------------------------------------------------------------------------

describe("ClassFeatureSystemSchema round-trip (new item type, REQ-PF2-003)", () => {
  it("accepts a minimal classFeature (Arcane Spellcasting, level 1)", () => {
    const result = ClassFeatureSystemSchema.safeParse({
      level: 1,
      category: "classfeature",
      traits: { rarity: "common", value: ["magus"] },
      description: "Grants arcane prepared spellcasting.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a hybridStudy category classFeature (Starlit Span sub-choice)", () => {
    const result = ClassFeatureSystemSchema.safeParse({
      level: 3,
      category: "hybridStudy",
      traits: { rarity: "common", value: ["magus"] },
    });
    expect(result.success).toBe(true);
  });

  it("defaults category to 'classfeature' when omitted", () => {
    const result = ClassFeatureSystemSchema.safeParse({ level: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe("classfeature");
    }
  });

  it("rejects a level outside 1..20", () => {
    expect(ClassFeatureSystemSchema.safeParse({ level: 21 }).success).toBe(false);
    expect(ClassFeatureSystemSchema.safeParse({ level: 0 }).success).toBe(false);
  });

  it("passes through extra fields (REQ-PF2-204)", () => {
    const result = ClassFeatureSystemSchema.safeParse({
      level: 1,
      legacyFoundryFlag: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("ClassSystemSchema round-trip — full Magus progression block", () => {
  it("accepts the full magusClassSystem() fixture", () => {
    const result = ClassSystemSchema.safeParse(magusClassSystem());
    expect(result.success).toBe(true);
  });

  it("round-trips featLevels, trainedSkills, and proficiencyUpgrades", () => {
    const data = {
      ...magusClassSystem(),
      proficiencyUpgrades: [
        { level: 3, stat: "perception", rank: 2 },
        { level: 7, stat: "weapons.martial", rank: 2 },
      ],
    };
    const result = ClassSystemSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.featLevels.class).toEqual([2]);
      expect(result.data.trainedSkills.value).toEqual(["arcana"]);
      expect(result.data.proficiencyUpgrades).toHaveLength(2);
    }
  });

  it("round-trips the spellcasting progression table (cantrips + slots by rank)", () => {
    const result = ClassSystemSchema.safeParse(magusClassSystem());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.spellcasting?.tradition).toBe("arcane");
      expect(result.data.spellcasting?.slots).toHaveLength(3);
      expect(result.data.spellcasting?.slots[2]?.slots).toEqual({ "1": 2, "2": 1 });
    }
  });

  it("spellcasting is optional (non-casting classes omit it)", () => {
    const { spellcasting: _sc, ...noCasting } = magusClassSystem();
    const result = ClassSystemSchema.safeParse(noCasting);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.spellcasting).toBeUndefined();
    }
  });

  it("defaults abilityBoostLevels to the standard PF2e cadence [5,10,15,20]", () => {
    const { abilityBoostLevels: _abl, ...withoutBoostLevels } = magusClassSystem();
    const result = ClassSystemSchema.safeParse(withoutBoostLevels);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.abilityBoostLevels).toEqual([5, 10, 15, 20]);
    }
  });

  it("rejects a proficiencyUpgrade with an invalid rank", () => {
    const data = {
      ...magusClassSystem(),
      proficiencyUpgrades: [{ level: 3, stat: "perception", rank: 9 }],
    };
    expect(ClassSystemSchema.safeParse(data).success).toBe(false);
  });
});

describe("CharacterSystemSchema.build block round-trip (DEC-R10-01)", () => {
  const baseCharacter = {
    level: { value: 3 },
    abilities: {
      str: { value: 10 },
      dex: { value: 16 },
      con: { value: 12 },
      int: { value: 16 },
      wis: { value: 10 },
      cha: { value: 14 },
    },
    attributes: {
      hp: { value: 33, max: 33 },
      speed: { value: 25 },
      dying: { value: 0, max: 4 },
      wounded: { value: 0 },
      doomed: { value: 0 },
    },
    saves: { fortitude: { rank: 2 }, reflex: { rank: 1 }, will: { rank: 2 } },
    perception: { rank: 1 },
    skills: { arcana: { rank: 1 } },
    proficiencies: { classDC: { rank: 1 } },
    details: { keyAbility: "int", level: 3 },
  };

  it("accepts a character with a fully populated build block", () => {
    const result = CharacterSystemSchema.safeParse({
      ...baseCharacter,
      build: {
        abilities: {
          ancestryBoosts: ["dex", "int"],
          ancestryFlaws: ["str"],
          ancestryFree: ["cha"],
          backgroundBoosts: ["int", "dex"],
          classBoost: ["str"],
          levelledBoosts: { "1": ["int", "dex", "con", "cha"] },
        },
        choices: [
          { level: 1, slot: "skillTraining-1", type: "skillTraining", skill: "diplomacy" },
          {
            level: 3,
            slot: "skillIncrease-1",
            type: "skillIncrease",
            skill: "crafting",
            rank: 2,
          },
        ],
        bonusHp: 0,
        bonusHpPerLevel: 0,
        freeArchetype: false,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.build?.abilities.ancestryBoosts).toEqual(["dex", "int"]);
      expect(result.data.build?.choices).toHaveLength(2);
    }
  });

  it("build block is optional — absent entirely is still valid (pre-r10 doc)", () => {
    const result = CharacterSystemSchema.safeParse(baseCharacter);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.build).toBeUndefined();
    }
  });

  it("rejects a build.choices entry with an invalid level", () => {
    const result = CharacterSystemSchema.safeParse({
      ...baseCharacter,
      build: {
        abilities: {},
        choices: [{ level: 25, slot: "x", type: "skillTraining" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty build block (defaults abilities/choices/flags)", () => {
    const result = CharacterSystemSchema.safeParse({ ...baseCharacter, build: {} });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.build?.choices).toEqual([]);
      expect(result.data.build?.freeArchetype).toBe(false);
      expect(result.data.build?.abilities.ancestryBoosts).toEqual([]);
    }
  });
});

describe("Pre-r10 character docs continue to validate untouched (compat)", () => {
  it("a full r9-shaped character (no build, no new class fields) still validates", () => {
    // This mirrors the shape produced by the r9 importer/manual entry —
    // exactly what schemas-actor.test.ts's `validCharacter` fixture uses,
    // re-asserted here to pin the compat guarantee for the r10 build block.
    const r9Character = {
      level: { value: 5 },
      abilities: {
        str: { value: 18 },
        dex: { value: 14 },
        con: { value: 16 },
        int: { value: 10 },
        wis: { value: 12 },
        cha: { value: 8 },
      },
      attributes: {
        hp: { value: 55, max: 60 },
        speed: { value: 25 },
        dying: { value: 0, max: 4 },
        wounded: { value: 0 },
        doomed: { value: 0 },
      },
      saves: {
        fortitude: { rank: 2 },
        reflex: { rank: 1 },
        will: { rank: 1 },
      },
      perception: { rank: 1 },
      skills: {
        acrobatics: { rank: 0 },
        athletics: { rank: 2 },
      },
      proficiencies: {
        classDC: { rank: 1 },
      },
      details: {
        keyAbility: "str",
        class: "Fighter",
        level: 5,
      },
    };

    const result = CharacterSystemSchema.safeParse(r9Character);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.build).toBeUndefined();
    }
  });

  it("a pre-r10 class item (no progression fields) still validates via defaults", () => {
    // Minimal r9-era class item — only the fields that predate R10-A.
    const legacyClass = {
      hp: 10,
      keyAbility: ["str"],
      perception: 1,
      savingThrows: { fortitude: 2, reflex: 1, will: 1 },
      defenses: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
      attacks: { unarmed: 1, simple: 1, martial: 2, advanced: 0 },
      classDC: 1,
    };
    const result = ClassSystemSchema.safeParse(legacyClass);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.featLevels).toEqual({ ancestry: [], class: [], general: [], skill: [] });
      expect(result.data.trainedSkills).toEqual({ value: [], additional: 0 });
      expect(result.data.proficiencyUpgrades).toEqual([]);
      expect(result.data.spellcasting).toBeUndefined();
      expect(result.data.featuresByLevel).toEqual([]);
    }
  });
});
