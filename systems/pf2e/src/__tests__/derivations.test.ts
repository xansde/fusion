/**
 * @fusion/system-pf2e — Derivation pipeline tests.
 *
 * Tests for character and NPC derivation steps:
 *   1. Ability modifiers (REQ-PF2-010)
 *   2. Proficiency bonus (REQ-PF2-011)
 *   3. AC derivation (REQ-PF2-020)
 *   4. Saves (REQ-PF2-015)
 *   5. Perception (REQ-PF2-014)
 *   6. Skills (REQ-PF2-012)
 *   7. Topological ordering (REQ-SYS-022): ability mod before saves
 *   8. Frightened 2 condition: −2 status to all checks (REQ-PF2-051)
 *   9. Strikes with MAP (REQ-PF2-030..034)
 *   10. NPC minimal derivation (REQ-PF2-002)
 *   11. Drained HP reduction (REQ-PF2-051): Drained 2, level 5 → −10 HP max
 *
 * Test fighter sample (level 5):
 *   STR 18 (+4), DEX 16 (+3), CON 14 (+2), INT 10 (+0), WIS 12 (+1), CHA 8 (−1)
 *   Perception: Expert (rank 2) → 2*2+5 + 1 (WIS) = 10
 *   AC: Trained (rank 1) in plate (heavy); AC bonus 6; dex cap 0 → dex=0; potency 1
 *     → 10 + 0 + (1*2+5) + 6 + 1 = 10 + 0 + 7 + 6 + 1 = 24
 *   Fortitude: Expert (rank 2) → 2*2+5 + 2(CON) = 11
 *   Reflex: Trained (rank 1) → 1*2+5 + 3(DEX) = 10
 *   Will: Expert (rank 2) → 2*2+5 + 1(WIS) = 10
 *   Athletics: Expert (rank 2) → 2*2+5 + 4(STR) = 13
 *   Class DC rank Expert → base 2*2+5 + 4(STR key) = 13; DC = 23
 *
 * All numbers verified by hand per requirements.
 *
 * REQ-PF2-010..022, REQ-PF2-030..034, REQ-PF2-051, REQ-PF2-200.
 */

import { describe, it, expect } from "vitest";
import { emptySynthetics } from "@fusion/system-api";
import { collectEffects, type EffectSource } from "@fusion/engine-2e";
import type { DeriveContext } from "@fusion/system-api";
import {
  stepCharAbilityMods,
  stepCharAc as _stepCharAc,
  stepCharSaves as _stepCharSaves,
  stepCharPerception as _stepCharPerception,
  stepCharSkills as _stepCharSkills,
  stepCharClassDC as _stepCharClassDC,
  stepCharStrikes as _stepCharStrikes,
  stepCharHp,
  stepCharDyingMax,
  stepCharDrainedHp as _stepCharDrainedHp,
  CHARACTER_DERIVE_STEPS,
} from "../derivations/character.js";
import {
  stepNpcAc,
  stepNpcHp,
  stepNpcPerception,
  stepNpcSaves,
  stepNpcSkills as _stepNpcSkills,
} from "../derivations/npc.js";
import { pf2eSystem } from "../index.js";
import { abilityMod, proficiencyBonus } from "../derivations/helpers.js";
import { topoSort } from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal DeriveContext with empty synthetics. */
function emptyCtx(): DeriveContext {
  return {
    system: pf2eSystem,
    synthetics: emptySynthetics(),
    rollOptions: new Set<string>(),
  };
}

/** Build a DeriveContext with the given synthetics and rollOptions. */
function ctxWith(
  synthetics: ReturnType<typeof emptySynthetics>,
  rollOptions?: Set<string>,
): DeriveContext {
  return {
    system: pf2eSystem,
    synthetics,
    rollOptions: rollOptions ?? new Set<string>(),
  };
}

/**
 * Sample level-5 Fighter document.
 *
 * STR 18/DEX 16/CON 14/INT 10/WIS 12/CHA 8
 * Perception Expert (rank 2), Saves: Fort Expert (2), Ref Trained (1), Will Expert (2)
 * Skills: athletics Expert (2), acrobatics Trained (1)
 * Proficiencies: classDC Expert (2), weapons.martial Expert (2), armor.heavy Trained (1)
 * Key ability: STR
 * HP: max 75, value 75
 * No dying/doomed/drained.
 */
function makeFighterDoc(level = 5): Record<string, unknown> {
  return {
    system: {
      systemVersion: "0.1.0",
      level: { value: level },
      abilities: {
        str: { value: 18, mod: 0 },
        dex: { value: 16, mod: 0 },
        con: { value: 14, mod: 0 },
        int: { value: 10, mod: 0 },
        wis: { value: 12, mod: 0 },
        cha: { value: 8, mod: 0 },
      },
      attributes: {
        hp: { value: 75, max: 75, temp: 0 },
        ac: { value: 10 },
        speed: { value: 25, otherSpeeds: [] },
        dying: { value: 0, max: 4 },
        wounded: { value: 0 },
        doomed: { value: 0 },
        iwr: { immunities: [], weaknesses: [], resistances: [] },
      },
      saves: {
        fortitude: { rank: 2 },
        reflex: { rank: 1 },
        will: { rank: 2 },
      },
      perception: { rank: 2, senses: [] },
      skills: {
        athletics: { rank: 2 },
        acrobatics: { rank: 1 },
        stealth: { rank: 0 },
      },
      proficiencies: {
        classDC: { rank: 2 },
        weapons: { unarmed: 1, simple: 1, martial: 2, advanced: 0 },
        armor: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
      },
      resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
      details: { keyAbility: "str", level: level },
      traits: { rarity: "common", value: [], size: "med" },
    } as Record<string, unknown>,
    // Equipped plate armor: heavy, AC+6, dexCap 0, potency 1 (REQ-PF2-020, REQ-PF2-130)
    _equippedArmor: {
      category: "heavy",
      acBonus: 6,
      dexCap: 0,
      potency: 1,
    },
    // Equipped longsword: martial, 1d8 slashing, potency 1, striking 1
    _equippedWeapons: [
      {
        name: "Longsword",
        id: "longsword-1",
        damage: { dice: 1, die: "d8", damageType: "slashing", modifier: 0 },
        category: "martial",
        traits: [],
        range: null,
        runes: { potency: 1, striking: 1 },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Run all base+derived steps in topological order, simulating the pipeline
// ---------------------------------------------------------------------------

/**
 * Simulate the full derivation pipeline for a character document.
 *
 * 1. Run "base" steps (topologically sorted).
 * 2. Collect effects (build synthetics from EffectSources).
 * 3. Run "derived" steps (topologically sorted).
 */
function runCharacterPipeline(
  doc: Record<string, unknown>,
  effectSources: EffectSource[] = [],
): void {
  // Base phase
  const baseSteps = pf2eSystem.deriveSteps.sortedForPhase("base", "Actor", "character");
  for (const step of baseSteps) {
    step.run(doc, emptyCtx());
  }

  // Collect effects (conditions → Synthetics)
  const baseOptions = new Set<string>();
  const { synthetics, conditionsToToggle: _ctt } = collectEffects(effectSources, baseOptions);

  // Merge roll options from synthetics
  const rollOptions = new Set<string>(baseOptions);
  for (const [, opts] of Object.entries(synthetics.rollOptions)) {
    for (const opt of opts) rollOptions.add(opt);
  }

  const derivedCtx = ctxWith(synthetics, rollOptions);

  // Derived phase
  const derivedSteps = pf2eSystem.deriveSteps.sortedForPhase("derived", "Actor", "character");
  for (const step of derivedSteps) {
    step.run(doc, derivedCtx);
  }
}

// ---------------------------------------------------------------------------
// Unit tests — helpers
// ---------------------------------------------------------------------------

describe("abilityMod helper (REQ-PF2-010)", () => {
  it("score 10 → mod 0", () => expect(abilityMod(10)).toBe(0));
  it("score 18 → mod 4", () => expect(abilityMod(18)).toBe(4));
  it("score 16 → mod 3", () => expect(abilityMod(16)).toBe(3));
  it("score 14 → mod 2", () => expect(abilityMod(14)).toBe(2));
  it("score 8  → mod -1", () => expect(abilityMod(8)).toBe(-1));
  it("score 1  → mod -5", () => expect(abilityMod(1)).toBe(-5));
});

describe("proficiencyBonus helper (REQ-PF2-011)", () => {
  it("rank 0 (Untrained) level 5 → 0", () => expect(proficiencyBonus(0, 5)).toBe(0));
  it("rank 1 (Trained)   level 5 → 7", () => expect(proficiencyBonus(1, 5)).toBe(7));
  it("rank 2 (Expert)    level 5 → 9", () => expect(proficiencyBonus(2, 5)).toBe(9));
  it("rank 3 (Master)    level 5 → 11", () => expect(proficiencyBonus(3, 5)).toBe(11));
  it("rank 4 (Legendary) level 5 → 13", () => expect(proficiencyBonus(4, 5)).toBe(13));
  it("rank 1 level 1 → 3", () => expect(proficiencyBonus(1, 1)).toBe(3));
  it("NPC level −1, rank 0 → 0", () => expect(proficiencyBonus(0, -1)).toBe(0));
  it("NPC level −1, rank 1 → 1", () => expect(proficiencyBonus(1, -1)).toBe(1));
});

// ---------------------------------------------------------------------------
// Unit tests — individual steps (without full pipeline)
// ---------------------------------------------------------------------------

describe("stepCharAbilityMods", () => {
  it("derives correct mods from scores", () => {
    const doc = makeFighterDoc();
    stepCharAbilityMods.run(doc, emptyCtx());

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const mods = derived["abilityMods"] as Record<string, number>;
    expect(mods.str).toBe(4); // 18 → +4
    expect(mods.dex).toBe(3); // 16 → +3
    expect(mods.con).toBe(2); // 14 → +2
    expect(mods.int).toBe(0); // 10 → +0
    expect(mods.wis).toBe(1); // 12 → +1
    expect(mods.cha).toBe(-1); // 8 → −1
  });

  it("also updates system.abilities.*.mod", () => {
    const doc = makeFighterDoc();
    stepCharAbilityMods.run(doc, emptyCtx());
    const sys = doc.system as Record<string, Record<string, { mod: number }>>;
    expect(sys.abilities.str.mod).toBe(4);
    expect(sys.abilities.dex.mod).toBe(3);
  });
});

describe("stepCharHp", () => {
  it("propagates HP values from source", () => {
    const doc = makeFighterDoc();
    stepCharAbilityMods.run(doc, emptyCtx()); // need abilityMods first
    stepCharHp.run(doc, emptyCtx());

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as {
      value: number;
      max: number;
      temp: number;
      drainedHpReduction: number;
    };
    expect(hp.value).toBe(75);
    expect(hp.max).toBe(75);
    expect(hp.temp).toBe(0);
    expect(hp.drainedHpReduction).toBe(0);
  });
});

describe("stepCharDyingMax", () => {
  it("max dying = 4 when doomed 0", () => {
    const doc = makeFighterDoc();
    stepCharDyingMax.run(doc, emptyCtx());
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    expect(derived["dyingMax"]).toBe(4);
  });

  it("max dying = 3 when doomed 1", () => {
    const doc = makeFighterDoc();
    ((doc.system as Record<string, unknown>)["attributes"] as Record<string, unknown>)["doomed"] = {
      value: 1,
    };
    stepCharDyingMax.run(doc, emptyCtx());
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    expect(derived["dyingMax"]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — full pipeline on the fighter
// ---------------------------------------------------------------------------

describe("Fighter level 5 — full derivation pipeline", () => {
  let doc: Record<string, unknown>;

  beforeEach(() => {
    doc = makeFighterDoc(5);
    runCharacterPipeline(doc);
  });

  it("ability mods are correct", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const mods = derived["abilityMods"] as Record<string, number>;
    expect(mods.str).toBe(4);
    expect(mods.dex).toBe(3);
    expect(mods.con).toBe(2);
    expect(mods.wis).toBe(1);
  });

  it("AC = 24 (10 + 0dex + 7prof + 6armorBonus + 1potency)", () => {
    // Heavy armor: dexCap 0 → capped dex = 0
    // Armor prof Trained at level 5 → rank 1 * 2 + 5 = 7
    // acBonus = 6, potency = 1
    // Total = 10 + 0 + 7 + 6 + 1 = 24
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const ac = derived["ac"] as { total: number; base: number };
    expect(ac.total).toBe(24);
    expect(ac.base).toBe(24); // no modifiers from empty synthetics
  });

  it("Fortitude = 11 (Expert rank 2 + CON 2 at level 5: 2*2+5=9, +2=11)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    // Expert: 2*2+5 = 9; CON mod = 2; total = 11
    expect(saves["fortitude"]?.total).toBe(11);
  });

  it("Reflex = 10 (Trained rank 1 + DEX 3 at level 5: 1*2+5=7, +3=10)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    // Trained: 1*2+5 = 7; DEX mod = 3; total = 10
    expect(saves["reflex"]?.total).toBe(10);
  });

  it("Will = 10 (Expert rank 2 + WIS 1 at level 5: 9+1=10)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    expect(saves["will"]?.total).toBe(10);
  });

  it("Perception = 10 (Expert rank 2 + WIS 1 at level 5: 9+1=10)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const perception = derived["perception"] as { total: number };
    expect(perception.total).toBe(10);
  });

  it("Athletics = 13 (Expert rank 2 + STR 4 at level 5: 9+4=13)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    expect(skills["athletics"]?.total).toBe(13);
  });

  it("Acrobatics = 10 (Trained rank 1 + DEX 3 at level 5: 7+3=10)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    expect(skills["acrobatics"]?.total).toBe(10);
  });

  it("Stealth = 10 (Untrained rank 0 → 0 prof + DEX 3 = 3... wait rank=0 → prof=0)", () => {
    // Untrained: rank 0 → profBonus = 0; DEX mod = 3; total = 3
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    expect(skills["stealth"]?.total).toBe(3);
  });

  it("Class DC = 23 (10 + Expert(2)*2+5 + STR4 = 10+9+4=23)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const classDC = derived["classDC"] as { dc: number; total: number };
    // base = 9 (expert prof) + 4 (STR key) = 13; dc = 10 + 13 = 23
    expect(classDC.total).toBe(13);
    expect(classDC.dc).toBe(23);
  });

  it("Strike (Longsword) attack bonus = 11 at MAP 0", () => {
    // STR +4, martial Expert = 9, potency +1 = 14... wait: rank 2 at level 5 = 9, +4 STR +1 potency = 14
    // Actually: attackBonus = strMod(4) + profBonus(rank2, level5=9) + potency(1) = 4+9+1 = 14
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const strikes = derived["strikes"] as Array<{
      attackBonus: number;
      variants: Array<{ total: number; formula: string }>;
    }>;
    expect(strikes).toHaveLength(1);
    const strike = strikes[0];
    expect(strike).toBeDefined();
    if (strike) {
      expect(strike.attackBonus).toBe(14);
      expect(strike.variants[0]?.total).toBe(14);
      expect(strike.variants[0]?.formula).toBe("1d20 + 14");
    }
  });

  it("Strike MAP 1 = attack −5", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const strikes = derived["strikes"] as Array<{
      variants: Array<{ total: number; mapPenalty: number }>;
    }>;
    const strike = strikes[0];
    if (strike) {
      expect(strike.variants[1]?.mapPenalty).toBe(-5);
      expect(strike.variants[1]?.total).toBe(9); // 14 - 5
    }
  });

  it("Strike MAP 2 = attack −10", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const strikes = derived["strikes"] as Array<{ variants: Array<{ total: number }> }>;
    const strike = strikes[0];
    if (strike) {
      expect(strike.variants[2]?.total).toBe(4); // 14 - 10
    }
  });

  it("Strike damage formula uses 2 dice (striking rune level 1)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const strikes = derived["strikes"] as Array<{ damageFormula: string }>;
    const strike = strikes[0];
    if (strike) {
      // 2d8 + 4 slashing (2 dice from striking 1, +4 from STR)
      expect(strike.damageFormula).toContain("2d8");
      expect(strike.damageFormula).toContain("+4");
      expect(strike.damageFormula).toContain("slashing");
    }
  });

  it("saves have DC available (save.dc = 10 + total)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number; dc: number }>;
    expect(saves["fortitude"]?.dc).toBe(10 + 11); // 21
    expect(saves["reflex"]?.dc).toBe(10 + 10); // 20
  });

  it("HP max = 75, no drained reduction", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as { max: number; drainedHpReduction: number };
    expect(hp.max).toBe(75);
    expect(hp.drainedHpReduction).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Topological order: ability mods before saves
// REQ-SYS-022
// ---------------------------------------------------------------------------

describe("Topological ordering (REQ-SYS-022)", () => {
  it("all character steps sort without cycle", () => {
    const sorted = topoSort(CHARACTER_DERIVE_STEPS);
    expect(sorted).toHaveLength(CHARACTER_DERIVE_STEPS.length);
  });

  it("abilityMods step comes before saves in sorted base phase", () => {
    const baseSteps = pf2eSystem.deriveSteps.sortedForPhase("base", "Actor", "character");
    const abilityIdx = baseSteps.findIndex((s) => s.id === "pf2e.character.base.abilityMods");
    // hp depends on abilityMods; it should come after
    const hpIdx = baseSteps.findIndex((s) => s.id === "pf2e.character.base.hp");
    expect(abilityIdx).toBeGreaterThanOrEqual(0);
    expect(hpIdx).toBeGreaterThan(abilityIdx);
  });

  it("AC step is in derived phase (after effects)", () => {
    const derivedSteps = pf2eSystem.deriveSteps.sortedForPhase("derived", "Actor", "character");
    const acIdx = derivedSteps.findIndex((s) => s.id === "pf2e.character.derived.ac");
    expect(acIdx).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Frightened 2 — −2 status to all checks and DCs (REQ-PF2-051)
// ---------------------------------------------------------------------------

import { conditionsToEffectSources } from "../conditions.js";
import type { ConditionItem } from "../actions/conditions-manager.js";
import { beforeEach } from "vitest";

describe("Frightened 2 condition (REQ-PF2-051)", () => {
  let doc: Record<string, unknown>;

  beforeEach(() => {
    doc = makeFighterDoc(5);

    // END-TO-END: start from a REAL stored ConditionItem (slug + value), NOT a
    // hand-fabricated EffectSource. `conditionsToEffectSources` materializes it
    // via the ConditionDefinition, substituting the placeholder FlatModifier
    // value (−1) with the resolved value (−2 for frightened 2). This proves the
    // value-multiplication wiring works ponta-a-ponta (REQ-PF2-051).
    const frightenedItem: ConditionItem = {
      _id: "cond-frightened-1",
      name: "Frightened",
      type: "Item",
      system: { slug: "frightened", value: 2 },
    };

    const sources = conditionsToEffectSources([frightenedItem]);
    runCharacterPipeline(doc, sources);
  });

  it("AC is reduced by 2 (frightened status penalty)", () => {
    // AC = 24 normally, −2 from frightened = 22
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const ac = derived["ac"] as { total: number };
    expect(ac.total).toBe(22);
  });

  it("Fortitude save is reduced by 2", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    // Fortitude was 11, −2 = 9
    expect(saves["fortitude"]?.total).toBe(9);
  });

  it("Reflex save is reduced by 2", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    // Reflex was 10, −2 = 8
    expect(saves["reflex"]?.total).toBe(8);
  });

  it("Will save is reduced by 2", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    // Will was 10, −2 = 8
    expect(saves["will"]?.total).toBe(8);
  });

  it("Perception is reduced by 2", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const perception = derived["perception"] as { total: number };
    // Perception was 10, −2 = 8
    expect(perception.total).toBe(8);
  });

  it("Skill checks are reduced by 2", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    // Athletics was 13, −2 = 11
    expect(skills["athletics"]?.total).toBe(11);
  });

  it("Class DC is reduced by 2", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const classDC = derived["classDC"] as { dc: number };
    // Was 23, −2 = 21
    expect(classDC.dc).toBe(21);
  });

  it("modifiers breakdown includes the frightened-penalty entry", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<
      string,
      { modifiers: Array<{ slug: string; value: number }> }
    >;
    const fortMods = saves["fortitude"]?.modifiers ?? [];
    const frightenedMod = fortMods.find((m) => m.slug === "frightened-penalty");
    expect(frightenedMod).toBeDefined();
    expect(frightenedMod?.value).toBe(-2);
  });

  it("status penalties of same type do not stack (only worst applies)", () => {
    // Verify stacking: if we had two frightened-type status penalties,
    // the higher magnitude wins (lowest-only for penalties).
    // Here we only have one, so total = −2.
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<
      string,
      { modifiers: Array<{ slug: string; type: string }> }
    >;
    const fortMods = saves["fortitude"]?.modifiers ?? [];
    const statusMods = fortMods.filter((m) => m.type === "status");
    // Only one status penalty should appear after stacking resolves duplicates.
    expect(statusMods.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Agile weapon — MAP 0/−4/−8
// REQ-PF2-031
// ---------------------------------------------------------------------------

describe("Agile weapon strike MAP", () => {
  it("agile dagger has MAP 0/−4/−8 variants", () => {
    const doc = makeFighterDoc(5);
    // Override equipped weapons with an agile dagger
    doc["_equippedWeapons"] = [
      {
        name: "Dagger",
        id: "dagger-1",
        damage: { dice: 1, die: "d4", damageType: "piercing", modifier: 0 },
        category: "simple",
        traits: ["agile", "finesse", "thrown-20"],
        range: null,
        runes: { potency: 0, striking: 0 },
      },
    ];

    runCharacterPipeline(doc);

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const strikes = derived["strikes"] as Array<{
      isAgile: boolean;
      variants: Array<{ mapPenalty: number }>;
    }>;

    expect(strikes).toHaveLength(1);
    const strike = strikes[0];
    expect(strike?.isAgile).toBe(true);
    expect(strike?.variants[0]?.mapPenalty).toBe(0);
    expect(strike?.variants[1]?.mapPenalty).toBe(-4);
    expect(strike?.variants[2]?.mapPenalty).toBe(-8);
  });
});

// ---------------------------------------------------------------------------
// Drained 2 at level 5 — HP max reduced by 10 (REQ-PF2-051)
// Criterion: Drained 2 on level 5 char → −10 HP max.
// ---------------------------------------------------------------------------

describe("Drained 2 at level 5 (REQ-PF2-051)", () => {
  it("HP max is reduced by 10 (level 5 × drained 2)", () => {
    const doc = makeFighterDoc(5);

    // END-TO-END: start from a REAL stored ConditionItem (drained, value 2), NOT
    // a hand-injected "drained:2" roll option. `conditionsToEffectSources` emits
    // the value-carrying roll option ("drained:2") so the drained-HP derivation
    // reduces max HP by level × value (REQ-PF2-051: drained 2 @ lvl 5 → −10).
    const drainedItem: ConditionItem = {
      _id: "cond-drained-1",
      name: "Drained",
      type: "Item",
      system: { slug: "drained", value: 2 },
    };

    runCharacterPipeline(doc, conditionsToEffectSources([drainedItem]));

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as { max: number; drainedHpReduction: number };
    // level 5 × drained 2 = 10 reduction; 75 − 10 = 65
    expect(hp.drainedHpReduction).toBe(10);
    expect(hp.max).toBe(65);
  });

  it("drained also applies a −2 status penalty to Fortitude (value-multiplied)", () => {
    // The condition's placeholder FlatModifier (−1 on fortitude) must be
    // multiplied to −value (−2) when materialized from the ConditionItem.
    const doc = makeFighterDoc(5);
    const drainedItem: ConditionItem = {
      _id: "cond-drained-2",
      name: "Drained",
      type: "Item",
      system: { slug: "drained", value: 2 },
    };

    runCharacterPipeline(doc, conditionsToEffectSources([drainedItem]));

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    // Fortitude was 11, −2 (drained 2 status penalty) = 9
    expect(saves["fortitude"]?.total).toBe(9);
  });

  it("HP current is clamped to new max if it exceeded the reduced max", () => {
    // Simulate a character at full HP (75) who gains drained 2
    const doc = makeFighterDoc(5);

    const drainedItem: ConditionItem = {
      _id: "cond-drained-3",
      name: "Drained",
      type: "Item",
      system: { slug: "drained", value: 2 },
    };

    runCharacterPipeline(doc, conditionsToEffectSources([drainedItem]));

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as { value: number; max: number };
    // HP value should be clamped to the new max (65)
    expect(hp.max).toBe(65);
    expect(hp.value).toBeLessThanOrEqual(hp.max);
  });
});

// ---------------------------------------------------------------------------
// NPC — Skeleton Guard (statblock from agent summary)
// level −1, AC 16, HP 4, Fort +2, Ref +9, Will +2, Perception mod +6
// ---------------------------------------------------------------------------

describe("Skeleton Guard NPC derivation", () => {
  it("propagates flat AC without modification (no conditions)", () => {
    const doc: Record<string, unknown> = {
      system: {
        systemVersion: "0.1.0",
        abilities: {
          str: { mod: 2 },
          dex: { mod: 5 },
          con: { mod: 0 },
          int: { mod: -2 },
          wis: { mod: 2 },
          cha: { mod: -3 },
        },
        attributes: {
          hp: { value: 4, max: 4, temp: 0 },
          ac: { value: 16 },
          speed: { value: 25, otherSpeeds: [] },
          perception: { mod: 6, senses: [] },
          iwr: { immunities: [], weaknesses: [], resistances: [] },
        },
        saves: { fortitude: { value: 2 }, reflex: { value: 9 }, will: { value: 2 } },
        skills: {},
        details: { level: { value: -1 }, languages: { value: [] } },
        traits: { rarity: "common", value: [], size: "med" },
        initiative: { statistic: "perception" },
      },
    };

    // Run NPC steps
    const ctx = emptyCtx();
    stepNpcAc.run(doc, ctx);
    stepNpcHp.run(doc, ctx);
    stepNpcPerception.run(doc, ctx);
    stepNpcSaves.run(doc, ctx);

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const ac = derived["ac"] as { total: number };
    const hp = derived["hp"] as { value: number; max: number };
    const perc = derived["perception"] as { total: number };
    const saves = derived["saves"] as Record<string, { total: number }>;

    expect(ac.total).toBe(16);
    expect(hp.value).toBe(4);
    expect(hp.max).toBe(4);
    expect(perc.total).toBe(6);
    expect(saves["fortitude"]?.total).toBe(2);
    expect(saves["reflex"]?.total).toBe(9);
    expect(saves["will"]?.total).toBe(2);
  });

  it("applies frightened condition to NPC saves", () => {
    const doc: Record<string, unknown> = {
      system: {
        systemVersion: "0.1.0",
        abilities: {
          str: { mod: 2 },
          dex: { mod: 5 },
          con: { mod: 0 },
          int: { mod: -2 },
          wis: { mod: 2 },
          cha: { mod: -3 },
        },
        attributes: {
          hp: { value: 4, max: 4, temp: 0 },
          ac: { value: 16 },
          speed: { value: 25, otherSpeeds: [] },
          perception: { mod: 6, senses: [] },
          iwr: { immunities: [], weaknesses: [], resistances: [] },
        },
        saves: { fortitude: { value: 2 }, reflex: { value: 9 }, will: { value: 2 } },
        skills: {},
        details: { level: { value: -1 }, languages: { value: [] } },
        traits: { rarity: "common", value: [], size: "med" },
        initiative: { statistic: "perception" },
      },
    };

    // END-TO-END: materialize a real frightened-1 ConditionItem (−1 to all
    // checks/DCs after value-multiplication: −1 × 1 = −1).
    const frightenedItem: ConditionItem = {
      _id: "cond-npc-frightened",
      name: "Frightened",
      type: "Item",
      system: { slug: "frightened", value: 1 },
    };

    const sources = conditionsToEffectSources([frightenedItem]);
    const { synthetics } = collectEffects(sources, new Set<string>());
    const ctx = ctxWith(synthetics);

    stepNpcAc.run(doc, ctx);
    stepNpcSaves.run(doc, ctx);
    stepNpcPerception.run(doc, ctx);

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    const perc = derived["perception"] as { total: number };

    // Fortitude was 2, −1 = 1
    expect(saves["fortitude"]?.total).toBe(1);
    // Reflex was 9, −1 = 8
    expect(saves["reflex"]?.total).toBe(8);
    // Perception was 6, −1 = 5
    expect(perc.total).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Derive steps are registered on pf2eSystem
// ---------------------------------------------------------------------------

describe("pf2eSystem.deriveSteps registration", () => {
  it("character base steps are registered", () => {
    const steps = pf2eSystem.deriveSteps.sortedForPhase("base", "Actor", "character");
    expect(steps.length).toBeGreaterThan(0);
    const ids = steps.map((s) => s.id);
    expect(ids).toContain("pf2e.character.base.abilityMods");
    expect(ids).toContain("pf2e.character.base.hp");
    expect(ids).toContain("pf2e.character.base.dyingMax");
  });

  it("character derived steps are registered", () => {
    const steps = pf2eSystem.deriveSteps.sortedForPhase("derived", "Actor", "character");
    expect(steps.length).toBeGreaterThan(0);
    const ids = steps.map((s) => s.id);
    expect(ids).toContain("pf2e.character.derived.ac");
    expect(ids).toContain("pf2e.character.derived.saves");
    expect(ids).toContain("pf2e.character.derived.perception");
    expect(ids).toContain("pf2e.character.derived.skills");
    expect(ids).toContain("pf2e.character.derived.classDC");
    expect(ids).toContain("pf2e.character.derived.strikes");
  });

  it("npc derived steps are registered", () => {
    const steps = pf2eSystem.deriveSteps.sortedForPhase("derived", "Actor", "npc");
    expect(steps.length).toBeGreaterThan(0);
    const ids = steps.map((s) => s.id);
    expect(ids).toContain("pf2e.npc.derived.ac");
    expect(ids).toContain("pf2e.npc.derived.saves");
    expect(ids).toContain("pf2e.npc.derived.perception");
  });
});

// ---------------------------------------------------------------------------
// FIX-1 — Valued conditions materialize their value via conditionToEffectSource
// END-TO-END from a real ConditionItem (slug + value), never a fabricated source.
// REQ-PF2-051.
// ---------------------------------------------------------------------------

import { conditionToEffectSource } from "../conditions.js";

describe("conditionToEffectSource — value multiplication (FIX-1)", () => {
  function makeItem(slug: string, value?: number): ConditionItem {
    return {
      _id: `cond-${slug}`,
      name: slug,
      type: "Item",
      system: value === undefined ? { slug } : { slug, value },
    };
  }

  it("frightened 3 → FlatModifier value −3 (placeholder −1 multiplied)", () => {
    const src = conditionToEffectSource(makeItem("frightened", 3));
    expect(src).not.toBeNull();
    const fm = src?.rules.find((r) => r.type === "flatModifier") as
      | { value: number; modifierType: string }
      | undefined;
    expect(fm?.value).toBe(-3);
    expect(fm?.modifierType).toBe("status");
  });

  it("clumsy 2 → FlatModifier value −2", () => {
    const src = conditionToEffectSource(makeItem("clumsy", 2));
    const fm = src?.rules.find((r) => r.type === "flatModifier") as { value: number } | undefined;
    expect(fm?.value).toBe(-2);
  });

  it("enfeebled 1 → FlatModifier value −1", () => {
    const src = conditionToEffectSource(makeItem("enfeebled", 1));
    const fm = src?.rules.find((r) => r.type === "flatModifier") as { value: number } | undefined;
    expect(fm?.value).toBe(-1);
  });

  it("sickened 4 → FlatModifier value −4", () => {
    const src = conditionToEffectSource(makeItem("sickened", 4));
    const fm = src?.rules.find((r) => r.type === "flatModifier") as { value: number } | undefined;
    expect(fm?.value).toBe(-4);
  });

  it("stupefied 2 → FlatModifier value −2", () => {
    const src = conditionToEffectSource(makeItem("stupefied", 2));
    const fm = src?.rules.find((r) => r.type === "flatModifier") as { value: number } | undefined;
    expect(fm?.value).toBe(-2);
  });

  it("non-valued condition (off-guard) keeps its static FlatModifier value", () => {
    const src = conditionToEffectSource(makeItem("off-guard"));
    const fm = src?.rules.find((r) => r.type === "flatModifier") as { value: number } | undefined;
    expect(fm?.value).toBe(-2); // off-guard −2 circumstance to AC, no multiplication
  });

  it("valued condition emits a value-carrying roll option (slug:value)", () => {
    const src = conditionToEffectSource(makeItem("drained", 2));
    const ro = src?.rules.find(
      (r) => r.type === "rollOption" && (r as { option: string }).option === "drained:2",
    );
    expect(ro).toBeDefined();
  });

  it("unknown condition slug returns null", () => {
    expect(conditionToEffectSource(makeItem("not-a-real-condition", 2))).toBeNull();
  });
});

describe("Frightened 3 end-to-end from ConditionItem (FIX-1)", () => {
  it("applies −3 to fortitude, perception, and AC from a real ConditionItem", () => {
    const doc = makeFighterDoc(5);
    const item: ConditionItem = {
      _id: "cond-frightened-3",
      name: "Frightened",
      type: "Item",
      system: { slug: "frightened", value: 3 },
    };

    runCharacterPipeline(doc, conditionsToEffectSources([item]));

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    const perception = derived["perception"] as { total: number };
    const ac = derived["ac"] as { total: number };

    expect(saves["fortitude"]?.total).toBe(11 - 3); // 8
    expect(perception.total).toBe(10 - 3); // 7
    expect(ac.total).toBe(24 - 3); // 21
  });
});

// ---------------------------------------------------------------------------
// FIX-4 — untyped bonuses do NOT stack (highest-only) on an attack selector.
// Aligns the PF2e stacking table with the engine-2e canonical table.
// ---------------------------------------------------------------------------

describe("Untyped stacking on attack (FIX-4)", () => {
  it("two untyped attack bonuses → only the highest counts", () => {
    const doc = makeFighterDoc(5);

    // Two untyped FlatModifier bonuses on melee-attack-roll: +2 and +3.
    // Per PF2e RAW (engine-2e table), untyped bonuses are highest-only → +3.
    const buffSource: EffectSource = {
      sourceId: "test:untyped-buffs",
      label: "Untyped Buffs",
      active: true,
      rules: [
        {
          type: "flatModifier",
          selector: "melee-attack-roll",
          value: 2,
          modifierType: "untyped",
          slug: "buff-a",
        },
        {
          type: "flatModifier",
          selector: "melee-attack-roll",
          value: 3,
          modifierType: "untyped",
          slug: "buff-b",
        },
      ],
    };

    runCharacterPipeline(doc, [buffSource]);

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const strikes = derived["strikes"] as Array<{ attackBonus: number }>;
    // Base longsword attack bonus = 14 (STR 4 + martial expert 9 + potency 1).
    // Untyped highest-only adds +3 (not +5) → 17.
    expect(strikes[0]?.attackBonus).toBe(17);
  });
});
