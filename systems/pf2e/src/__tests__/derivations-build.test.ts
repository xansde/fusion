/**
 * @fusion/system-pf2e — Build-driven derivation tests (R10-A / TASK A2).
 *
 * Covers:
 *   1. stepCharSkills always derives all 16 canonical skills (untrained
 *      ones included), plus persisted Lore skills (DEC-R10-07).
 *   2. Build-driven steps (abilities, class application, skills, HP, focus
 *      clamp) are all NO-OPS on an r9 manual-entry actor (no embedded
 *      `type:'class'` item) — compat guarantee from DEC-R10-01.
 *   3. Full pipeline against a synthetic "Tobias-by-build" fixture: a
 *      level-3 Magus (INT key ability) built entirely from
 *      `system.build` + an embedded class item, reproducing the numeric
 *      acceptance criteria from .fusion-build/r10-plan.md R10-A:
 *        AC 19 (leather +1 item, dexCap), HP 33, saves +8/+8/+7,
 *        classDC 18 / spell attack +8, focus 1/1 (clamped max ≤ 3).
 *   4. `spellSlotsForLevel` pure helper.
 *
 * NOTE on the ability-boost origins used below: they are a SYNTHETIC
 * sequence chosen to land on the plan's target ability scores (DEX 16,
 * CON 12, INT 16) via the documented boost/flaw math — not a literal
 * reproduction of Ratfolk ancestry lore (facts of that specific ancestry
 * are exercised by the R10-B importer tests instead). This test only
 * verifies the BUILD MACHINERY (boost application order + clamping),
 * which is origin-agnostic.
 *
 * Clean-room: ORC/OGL mechanics only.
 * REQ-PF2-010..022, REQ-PF2-083, DEC-R10-01/02/07.
 */

import { describe, it, expect } from "vitest";
import { emptySynthetics } from "@fusion/system-api";
import type { DeriveContext } from "@fusion/system-api";
import { pf2eSystem } from "../index.js";
import { spellSlotsForLevel } from "../derivations/build.js";
import type { ClassSpellcasting } from "../schemas/item-equipment.js";

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
// 1. stepCharSkills — all 16 canonical skills always derived (DEC-R10-07)
// ---------------------------------------------------------------------------

describe("stepCharSkills — all 16 canonical skills always present (DEC-R10-07)", () => {
  it("a manual r9 doc with only 2 trained skills derives all 16 + those 2 correctly", () => {
    const doc: Record<string, unknown> = {
      system: {
        systemVersion: "0.1.0",
        level: { value: 1 },
        abilities: {
          str: { value: 10, mod: 0 },
          dex: { value: 14, mod: 0 },
          con: { value: 10, mod: 0 },
          int: { value: 10, mod: 0 },
          wis: { value: 10, mod: 0 },
          cha: { value: 10, mod: 0 },
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
        saves: { fortitude: { rank: 0 }, reflex: { rank: 0 }, will: { rank: 0 } },
        perception: { rank: 0, senses: [] },
        skills: {
          acrobatics: { rank: 1 },
          stealth: { rank: 2 },
        },
        proficiencies: {},
        resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
        details: { keyAbility: "str", level: 1 },
        traits: { rarity: "common", value: [], size: "med" },
      },
      items: [],
    };

    runCharacterPipeline(doc);

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number; base: number }>;

    // All 16 canonical skills present.
    const canonical = [
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
    for (const slug of canonical) {
      expect(skills[slug]).toBeDefined();
    }
    expect(Object.keys(skills)).toHaveLength(16);

    // Untrained skill (e.g. athletics, STR key, mod 0) → base 0.
    expect(skills["athletics"]?.total).toBe(0);
    // Trained acrobatics (DEX +2, rank1 lvl1 = 3) → 3+2=5.
    expect(skills["acrobatics"]?.total).toBe(5);
    // Expert stealth (DEX +2, rank2 lvl1 = 5) → 5+2=7.
    expect(skills["stealth"]?.total).toBe(7);
  });

  it("persisted Lore skills are included alongside the 16 canonical", () => {
    const doc: Record<string, unknown> = {
      system: {
        systemVersion: "0.1.0",
        level: { value: 1 },
        abilities: {
          str: { value: 10, mod: 0 },
          dex: { value: 10, mod: 0 },
          con: { value: 10, mod: 0 },
          int: { value: 12, mod: 0 },
          wis: { value: 10, mod: 0 },
          cha: { value: 10, mod: 0 },
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
        saves: { fortitude: { rank: 0 }, reflex: { rank: 0 }, will: { rank: 0 } },
        perception: { rank: 0, senses: [] },
        skills: {
          "underworld-lore": { rank: 1, lore: true },
        },
        proficiencies: {},
        resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
        details: { keyAbility: "str", level: 1 },
        traits: { rarity: "common", value: [], size: "med" },
      },
      items: [],
    };

    runCharacterPipeline(doc);

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    expect(Object.keys(skills)).toHaveLength(17); // 16 canonical + 1 lore
    // Lore uses INT (mod +1) regardless of slug; rank1 lvl1 = 3; total = 4.
    expect(skills["underworld-lore"]?.total).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 2. Build-driven steps are no-ops without an embedded class item (r9 compat)
// ---------------------------------------------------------------------------

describe("Build-driven steps no-op without an embedded class item (DEC-R10-01 compat)", () => {
  function makeManualDoc(): Record<string, unknown> {
    return {
      system: {
        systemVersion: "0.1.0",
        level: { value: 1 },
        abilities: {
          str: { value: 14, mod: 0 },
          dex: { value: 12, mod: 0 },
          con: { value: 14, mod: 0 },
          int: { value: 10, mod: 0 },
          wis: { value: 10, mod: 0 },
          cha: { value: 8, mod: 0 },
        },
        attributes: {
          hp: { value: 20, max: 20, temp: 0 },
          ac: { value: 10 },
          speed: { value: 25, otherSpeeds: [] },
          dying: { value: 0, max: 4 },
          wounded: { value: 0 },
          doomed: { value: 0 },
          iwr: { immunities: [], weaknesses: [], resistances: [] },
        },
        saves: { fortitude: { rank: 1 }, reflex: { rank: 1 }, will: { rank: 1 } },
        perception: { rank: 1, senses: [] },
        skills: { athletics: { rank: 1 } },
        proficiencies: { classDC: { rank: 1 } },
        resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 5, max: 5 } },
        details: { keyAbility: "str", level: 1 },
        traits: { rarity: "common", value: [], size: "med" },
        // A build block IS present, but there is no embedded class item —
        // per DEC-R10-01 this alone must NOT activate build-driven steps.
        build: {
          abilities: { classBoost: ["dex"] },
          choices: [],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
      items: [], // no 'class' item
    };
  }

  it("ability scores are untouched (STR stays 14, not boosted)", () => {
    const doc = makeManualDoc();
    runCharacterPipeline(doc);
    const sys = doc.system as Record<string, { value: number }>;
    expect((sys.abilities as unknown as Record<string, { value: number }>).str.value).toBe(14);
    expect((sys.abilities as unknown as Record<string, { value: number }>).dex.value).toBe(12);
  });

  it("HP max is untouched (manual 20, not recomputed)", () => {
    const doc = makeManualDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as { max: number };
    expect(hp.max).toBe(20);
  });

  it("focus points ABOVE 3 are still clamped to 3 (hard rule, not build-gated)", () => {
    const doc = makeManualDoc();
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as {
      resources: { focusPoints: { value: number; max: number } };
    };
    // stored max 5 (schema max(3) would normally reject this at parse time,
    // but this test bypasses .parse() to exercise the derivation-level
    // second guard directly) → clamped to 3; value 5 clamped to 3 too.
    expect(sys.resources.focusPoints.max).toBe(3);
    expect(sys.resources.focusPoints.value).toBe(3);
  });

  it("classDC rank is untouched (manual rank 1 stands)", () => {
    const doc = makeManualDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const classDC = derived["classDC"] as { total: number };
    // Trained (1) at level 1 = 3; STR key mod (14 → +2) = 2; total = 5.
    expect(classDC.total).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 3. "Tobias por build" — level-3 Magus fixture (R10-A acceptance criterion)
// ---------------------------------------------------------------------------

describe("Tobias-by-build — level 3 Magus, fully build-driven (R10-A acceptance)", () => {
  function makeTobiasByBuildDoc(): Record<string, unknown> {
    return {
      system: {
        systemVersion: "0.1.0",
        level: { value: 3 },
        // Placeholder abilities — overwritten entirely by stepCharBuildAbilities.
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
        skills: {},
        proficiencies: {},
        resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 1, max: 1 } },
        details: { keyAbility: "str", level: 3 },
        traits: { rarity: "common", value: [], size: "med" },
        build: {
          abilities: {
            // Synthetic origin sequence landing on DEX16/CON12/INT16 (see
            // file-level NOTE — not a literal Ratfolk lore reproduction).
            ancestryBoosts: ["dex", "int"],
            ancestryFlaws: [],
            ancestryFree: ["dex", "dex", "int"],
            backgroundBoosts: ["con"],
            classBoost: ["int"],
            levelledBoosts: {},
          },
          choices: [
            { level: 1, slot: "skillTraining-1", type: "skillTraining", skill: "occultism" },
            { level: 3, slot: "skillIncrease-1", type: "skillIncrease", skill: "arcana", rank: 2 },
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
          system: {
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
                { level: 1, count: 2 },
                { level: 3, count: 3 },
              ],
              slots: [
                { level: 1, slots: { "1": 2 } },
                { level: 3, slots: { "1": 3 } },
              ],
            },
            featuresByLevel: [],
          },
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

  it("ability scores derive to DEX 16 / CON 12 / INT 16 (from boost ledger)", () => {
    doc = makeTobiasByBuildDoc();
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as { abilities: Record<string, { value: number }> };
    expect(sys.abilities.dex.value).toBe(16);
    expect(sys.abilities.con.value).toBe(12);
    expect(sys.abilities.int.value).toBe(16);
    expect(sys.abilities.str.value).toBe(10);
    expect(sys.abilities.wis.value).toBe(10);
    expect(sys.abilities.cha.value).toBe(10);
  });

  it("key ability is overridden to INT from the class item", () => {
    doc = makeTobiasByBuildDoc();
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as { details: { keyAbility: string } };
    expect(sys.details.keyAbility).toBe("int");
  });

  it("backgroundFree boosts apply exactly like ancestryFree (R11 item 1 — new ledger field)", () => {
    doc = makeTobiasByBuildDoc();
    const build = (doc.system as Record<string, unknown>)["build"] as Record<string, unknown>;
    const abilities = build["abilities"] as Record<string, unknown>;
    // Move the 3 ancestryFree picks over to backgroundFree — same slugs,
    // different origin — the resulting scores must be identical.
    abilities["ancestryFree"] = [];
    abilities["backgroundFree"] = ["dex", "dex", "int"];
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as { abilities: Record<string, { value: number }> };
    expect(sys.abilities.dex.value).toBe(16);
    expect(sys.abilities.int.value).toBe(16);
  });

  it("HP max = 33 (ancestry 6 + (class 8 + conMod 1) * level 3)", () => {
    doc = makeTobiasByBuildDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as { max: number };
    expect(hp.max).toBe(33);
  });

  it("AC = 19 (leather +1 item, dexCap 2)", () => {
    doc = makeTobiasByBuildDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const ac = derived["ac"] as { total: number };
    // 10 + cappedDex(2) + armorProf Trained@lvl3(5) + acBonus(1) + potency(1) = 19
    expect(ac.total).toBe(19);
  });

  it("saves = Fortitude +8 / Reflex +8 / Will +7", () => {
    doc = makeTobiasByBuildDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    expect(saves["fortitude"]?.total).toBe(8); // Expert@lvl3(7) + CON+1
    expect(saves["reflex"]?.total).toBe(8); // Trained@lvl3(5) + DEX+3
    expect(saves["will"]?.total).toBe(7); // Expert@lvl3(7) + WIS+0
  });

  it("classDC = total 8 / dc 18", () => {
    doc = makeTobiasByBuildDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const classDC = derived["classDC"] as { total: number; dc: number };
    // Trained@lvl3(5) + INT+3 = 8; dc = 18
    expect(classDC.total).toBe(8);
    expect(classDC.dc).toBe(18);
  });

  it("focus points stay 1/1 (already ≤ 3, unaffected by clamp)", () => {
    doc = makeTobiasByBuildDoc();
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as {
      resources: { focusPoints: { value: number; max: number } };
    };
    expect(sys.resources.focusPoints.value).toBe(1);
    expect(sys.resources.focusPoints.max).toBe(1);
  });

  it("trained skills: arcana rank 2 (class trained@1 + build skillIncrease@3), occultism rank 1 (build choice)", () => {
    doc = makeTobiasByBuildDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    // Arcana: expert (rank2) @ level3 = 7; INT +3 = 10.
    expect(skills["arcana"]?.total).toBe(10);
    // Occultism: trained (rank1) @ level3 = 5; INT +3 = 8.
    expect(skills["occultism"]?.total).toBe(8);
    // Untrained skill still present (DEC-R10-07): athletics, STR mod 0 → 0.
    expect(skills["athletics"]?.total).toBe(0);
    expect(Object.keys(skills)).toHaveLength(16);
  });

  it("weapon/armor category proficiencies come from the class's attacks/defenses maps", () => {
    doc = makeTobiasByBuildDoc();
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as {
      proficiencies: {
        weapons: Record<string, number>;
        armor: Record<string, number>;
      };
    };
    expect(sys.proficiencies.weapons.simple).toBe(1);
    expect(sys.proficiencies.weapons.martial).toBe(1);
    expect(sys.proficiencies.armor.light).toBe(1);
    expect(sys.proficiencies.armor.heavy).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. spellSlotsForLevel pure helper
// ---------------------------------------------------------------------------

describe("spellSlotsForLevel", () => {
  const progression: ClassSpellcasting = {
    tradition: "arcane",
    type: "prepared",
    ability: "int",
    cantripsKnown: [
      { level: 1, count: 2 },
      { level: 3, count: 3 },
      { level: 7, count: 4 },
    ],
    slots: [
      { level: 1, slots: { "1": 2 } },
      { level: 3, slots: { "1": 3 } },
      { level: 5, slots: { "1": 3, "2": 2 } },
    ],
  };

  it("exact level match (level 3) returns that entry", () => {
    const result = spellSlotsForLevel(progression, 3);
    expect(result.cantripsKnown).toBe(3);
    expect(result.slotsByRank).toEqual({ "1": 3 });
  });

  it("level between entries (level 4) falls back to the highest entry at or below", () => {
    const result = spellSlotsForLevel(progression, 4);
    expect(result.cantripsKnown).toBe(3); // still the level-3 entry
    expect(result.slotsByRank).toEqual({ "1": 3 });
  });

  it("level above all entries (level 10) uses the highest entry", () => {
    const result = spellSlotsForLevel(progression, 10);
    expect(result.cantripsKnown).toBe(4);
    expect(result.slotsByRank).toEqual({ "1": 3, "2": 2 });
  });

  it("level below the first entry (level 0, e.g. a non-casting level) returns zero/empty", () => {
    const result = spellSlotsForLevel(progression, 0);
    expect(result.cantripsKnown).toBe(0);
    expect(result.slotsByRank).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 6. Malformed class item — defensive degradation (audit r10-A, medium issue)
// ---------------------------------------------------------------------------

describe("Malformed class item degrades to rank-0 defaults instead of throwing", () => {
  it("a class item with only {hp} runs the full pipeline without throwing", () => {
    const doc: Record<string, unknown> = {
      system: {
        systemVersion: "0.1.0",
        level: { value: 3 },
        abilities: {
          str: { value: 10, mod: 0 },
          dex: { value: 10, mod: 0 },
          con: { value: 12, mod: 0 },
          int: { value: 10, mod: 0 },
          wis: { value: 10, mod: 0 },
          cha: { value: 10, mod: 0 },
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
        saves: { fortitude: { rank: 0 }, reflex: { rank: 0 }, will: { rank: 0 } },
        perception: { rank: 0, senses: [] },
        skills: {},
        proficiencies: {},
        resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
        details: { keyAbility: "str", level: 3 },
        traits: { rarity: "common", value: [], size: "med" },
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
      // Authored OUTSIDE the schema: no keyAbility/savingThrows/attacks/
      // defenses/trainedSkills/perception/classDC — Zod defaults never ran.
      items: [{ _id: "cls1", type: "class", name: "Broken", system: { hp: 8 } }],
    };

    expect(() => runCharacterPipeline(doc)).not.toThrow();

    const sys = doc.system as Record<string, unknown>;
    const saves = sys["saves"] as Record<string, { rank: number }>;
    expect(saves["fortitude"].rank).toBe(0);
    // HP formula still applies with the fields that DO exist. The empty
    // build.abilities ledger resets CON to base 10 (no boosts assigned yet),
    // so: 0 ancestry + (8 class + 0 con) * 3 = 24.
    const hp = (sys["attributes"] as Record<string, { max?: number }>)["hp"];
    expect(hp.max).toBe(24);
  });

  it("a skillIncrease choice without an explicit rank bumps one rank instead of no-op", () => {
    const doc: Record<string, unknown> = {
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
          hp: { value: 10, max: 10, temp: 0 },
          ac: { value: 10 },
          speed: { value: 25, otherSpeeds: [] },
          dying: { value: 0, max: 4 },
          wounded: { value: 0 },
          doomed: { value: 0 },
          iwr: { immunities: [], weaknesses: [], resistances: [] },
        },
        saves: { fortitude: { rank: 0 }, reflex: { rank: 0 }, will: { rank: 0 } },
        perception: { rank: 0, senses: [] },
        skills: {},
        proficiencies: {},
        resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
        details: { keyAbility: "str", level: 3 },
        traits: { rarity: "common", value: [], size: "med" },
        build: {
          abilities: {
            ancestryBoosts: [],
            ancestryFlaws: [],
            ancestryFree: [],
            backgroundBoosts: [],
            classBoost: [],
            levelledBoosts: {},
          },
          choices: [
            { level: 1, slot: "skillTraining-1a", type: "skillTraining", skill: "arcana" },
            // No explicit rank: fallback must bump trained(1) -> expert(2).
            { level: 3, slot: "skillIncrease-3", type: "skillIncrease", skill: "arcana" },
          ],
          bonusHp: 0,
          bonusHpPerLevel: 0,
          freeArchetype: false,
        },
      },
      items: [{ _id: "cls1", type: "class", name: "Broken", system: { hp: 8 } }],
    };

    runCharacterPipeline(doc);

    const skills = (doc.system as Record<string, unknown>)["skills"] as Record<
      string,
      { rank: number }
    >;
    expect(skills["arcana"].rank).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7. Partial boosts ledger — real-world dialogs write only the keys they own
// (r11 live finding: Tobias's ledger had backgroundFree/classBoost but no
// backgroundBoosts key, and the unguarded iteration threw inside
// recomputeDerivedIfNeeded, silently freezing the stored derived).
// ---------------------------------------------------------------------------

describe("Partial build.abilities ledger derives without throwing", () => {
  it("a ledger missing backgroundBoosts/levelledBoosts keys still derives scores", () => {
    const doc: Record<string, unknown> = {
      system: {
        systemVersion: "0.1.0",
        level: { value: 3 },
        abilities: {
          str: { value: 8, mod: 0 },
          dex: { value: 18, mod: 0 },
          con: { value: 14, mod: 0 },
          int: { value: 16, mod: 0 },
          wis: { value: 12, mod: 0 },
          cha: { value: 10, mod: 0 },
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
        saves: { fortitude: { rank: 0 }, reflex: { rank: 0 }, will: { rank: 0 } },
        perception: { rank: 0, senses: [] },
        skills: {},
        proficiencies: {},
        resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
        details: { keyAbility: "str", level: 3 },
        traits: { rarity: "common", value: [], size: "sm" },
        // Raw persisted shape as written by the r11 dialogs — NO Zod
        // defaults, NO backgroundBoosts, NO choices/bonusHp keys.
        build: {
          abilities: {
            ancestryBoosts: ["dex", "int"],
            ancestryFlaws: ["str"],
            ancestryFree: ["cha"],
            backgroundFree: ["int", "dex"],
            classBoost: ["str"],
          },
        },
      },
      items: [
        {
          _id: "cls1",
          type: "class",
          name: "Magus",
          system: { hp: 8, keyAbility: ["dex", "str"] },
        },
      ],
    };

    expect(() => runCharacterPipeline(doc)).not.toThrow();

    const sys = doc.system as Record<string, unknown>;
    const abilities = sys["abilities"] as Record<string, { value: number }>;
    // str 10 -2(flaw) +2(class) = 10; dex 10+2+2 = 14; int 10+2+2 = 14; cha 12.
    expect(abilities["str"].value).toBe(10);
    expect(abilities["dex"].value).toBe(14);
    expect(abilities["int"].value).toBe(14);
    expect(abilities["cha"].value).toBe(12);

    // And the final scores ride inside derived for the client (r11).
    const derived = sys["derived"] as { abilityScores?: Record<string, number> };
    expect(derived.abilityScores?.["dex"]).toBe(14);
  });
});
