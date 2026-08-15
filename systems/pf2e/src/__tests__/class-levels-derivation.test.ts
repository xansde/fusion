/**
 * @fusion/system-pf2e — Derivation under the class-levels variant.
 *
 * The load-bearing test here is the FIRST one: turning the variant on for a
 * single-class character must change nothing, field for field (REQ-MCL-002 /
 * REQ-MCL-003 / CA-MCL-01). Everything else in this file is only safe to
 * ship because that one holds.
 *
 * Then the canonical case of the spec — a Fighter 3 / Wizard 2 (CA-MCL-02) —
 * exercised on the real pipeline, not on the formulas in isolation.
 *
 * The class items below are SYNTHETIC (like the r10 build fixtures): they
 * carry the shape of a class doc with numbers chosen to make the arithmetic
 * legible, not a reproduction of any published class's stat block.
 *
 * Clean-room: ORC/OGL mechanics only. House rule by Igor (Wayfinder), used
 * with permission and attribution.
 * Spec: 30-multiclasse-por-niveis.md §6.2..6.4, §7.1.
 */

import { describe, it, expect } from "vitest";
import { emptySynthetics } from "@fusion/system-api";
import type { DeriveContext } from "@fusion/system-api";
import { pf2eSystem } from "../index.js";

function emptyCtx(): DeriveContext {
  return { system: pf2eSystem, synthetics: emptySynthetics(), rollOptions: new Set<string>() };
}

function runCharacterPipeline(doc: Record<string, unknown>): void {
  for (const step of pf2eSystem.deriveSteps.sortedForPhase("base", "Actor", "character")) {
    step.run(doc, emptyCtx());
  }
  for (const step of pf2eSystem.deriveSteps.sortedForPhase("derived", "Actor", "character")) {
    step.run(doc, emptyCtx());
  }
}

// ---------------------------------------------------------------------------
// Synthetic class items
// ---------------------------------------------------------------------------

const FIGHTER_ID = "fighter-source-id";
const WIZARD_ID = "wizard-source-id";

const fighterItem = {
  _id: "item-fighter",
  type: "class",
  name: "Fighter",
  flags: { fusion: { sourceId: FIGHTER_ID } },
  system: {
    hp: 10,
    keyAbility: ["str"],
    perception: 2,
    savingThrows: { fortitude: 2, reflex: 2, will: 1 },
    attacks: { unarmed: 2, simple: 2, martial: 2, advanced: 1 },
    defenses: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
    classDC: 1,
    trainedSkills: { value: ["athletics"], additional: 3 },
    proficiencyUpgrades: [],
    featuresByLevel: [],
    featLevels: {},
  },
};

const wizardItem = {
  _id: "item-wizard",
  type: "class",
  name: "Wizard",
  flags: { fusion: { sourceId: WIZARD_ID } },
  system: {
    hp: 6,
    keyAbility: ["int"],
    perception: 1,
    savingThrows: { fortitude: 1, reflex: 1, will: 2 },
    attacks: { unarmed: 1, simple: 1, martial: 0, advanced: 0 },
    defenses: { unarmored: 1, light: 0, medium: 0, heavy: 0 },
    classDC: 1,
    trainedSkills: { value: ["arcana"], additional: 2 },
    proficiencyUpgrades: [],
    featuresByLevel: [],
    featLevels: {},
  },
};

const ancestryItem = { _id: "item-ancestry", type: "ancestry", name: "Human", system: { hp: 8 } };

/** Character shell at `level`, with the given items and build block. */
function makeDoc(
  level: number,
  items: unknown[],
  build: Record<string, unknown>,
): Record<string, unknown> {
  return {
    items,
    system: {
      systemVersion: "0.1.0",
      level: { value: level },
      abilities: {
        str: { value: 10, mod: 0 },
        dex: { value: 10, mod: 0 },
        con: { value: 14, mod: 0 },
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
      details: {},
      traits: { rarity: "common", value: [], size: "med" },
      build: { abilities: {}, choices: [], ...build },
    },
  };
}

/** `classLevel` choices assigning each character level to a class. */
function split(levelToClass: Record<number, string>): unknown[] {
  return Object.entries(levelToClass).map(([level, sourceId]) => ({
    level: Number(level),
    slot: `classLevel-${level}`,
    type: "classLevel",
    ref: `Compendium.fusion.classes.${sourceId}`,
  }));
}

/** Derived block, after running the whole pipeline. */
function derive(doc: Record<string, unknown>): Record<string, unknown> {
  runCharacterPipeline(doc);
  const sys = doc["system"] as Record<string, unknown>;
  return sys["derived"] as Record<string, unknown>;
}

/** The parts of `system` a compatibility comparison must cover. */
function comparableSystem(doc: Record<string, unknown>): Record<string, unknown> {
  const sys = doc["system"] as Record<string, unknown>;
  const derived = { ...(sys["derived"] as Record<string, unknown>) };
  // `classLevels`/`proficiencyOrigin`/`hpByLevel` are NEW audit output, absent
  // before the variant existed — excluded so the comparison is about the
  // numbers that already existed, which are the ones that must not move.
  delete derived["classLevels"];
  delete derived["proficiencyOrigin"];
  delete derived["hpByLevel"];
  return {
    abilities: sys["abilities"],
    attributes: sys["attributes"],
    saves: sys["saves"],
    perception: sys["perception"],
    skills: sys["skills"],
    proficiencies: sys["proficiencies"],
    details: sys["details"],
    derived,
  };
}

// ---------------------------------------------------------------------------
// REQ-MCL-002 / 003 / CA-MCL-01 — the compatibility guarantee
// ---------------------------------------------------------------------------

describe("REQ-MCL-002 — with the variant off, nothing moves", () => {
  // Two CON boosts → score 14 → +2, so the per-level CON term is actually
  // exercised rather than silently multiplied by zero.
  const singleClassBuild = {
    abilities: { classBoost: ["str"], ancestryBoosts: ["con"], backgroundBoosts: ["con"] },
    choices: [
      { level: 1, slot: "skillTraining-1a", type: "skillTraining", skill: "stealth", rank: 1 },
    ],
  };

  it("a build with no variantRules block at all derives as it always did", () => {
    const doc = makeDoc(5, [fighterItem, ancestryItem], singleClassBuild);
    const derived = derive(doc);
    const sys = doc["system"] as Record<string, unknown>;

    // HP: 8 ancestry + (10 + 2 con) * 5 levels = 68 — the pre-variant formula.
    expect((sys["attributes"] as { hp: { max: number } }).hp.max).toBe(68);
    expect(derived["classDC"]).toBeDefined();
  });

  it("turning the toggle ON for a single-class character changes NOTHING (REQ-MCL-003)", () => {
    const off = makeDoc(5, [fighterItem, ancestryItem], singleClassBuild);
    const on = makeDoc(5, [fighterItem, ancestryItem], {
      ...singleClassBuild,
      variantRules: { classLevels: true },
    });
    runCharacterPipeline(off);
    runCharacterPipeline(on);

    expect(comparableSystem(on)).toEqual(comparableSystem(off));
  });

  it("an explicit all-in-one-class split is identical to no split at all (REQ-MCL-202)", () => {
    const noSplit = makeDoc(5, [fighterItem, ancestryItem], singleClassBuild);
    const explicit = makeDoc(5, [fighterItem, ancestryItem], {
      ...singleClassBuild,
      variantRules: { classLevels: true },
      choices: [
        ...singleClassBuild.choices,
        ...split({ 1: FIGHTER_ID, 2: FIGHTER_ID, 3: FIGHTER_ID, 4: FIGHTER_ID, 5: FIGHTER_ID }),
      ],
    });
    runCharacterPipeline(noSplit);
    runCharacterPipeline(explicit);

    expect(comparableSystem(explicit)).toEqual(comparableSystem(noSplit));
  });

  it("is still a no-op on an r9 actor with no class item", () => {
    const doc = makeDoc(3, [], { variantRules: { classLevels: true } });
    const sys = doc["system"] as Record<string, unknown>;
    runCharacterPipeline(doc);
    // Manual HP untouched — the build steps must never fire without a class.
    expect((sys["attributes"] as { hp: { max: number } }).hp.max).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// CA-MCL-02 — the canonical Fighter 3 / Wizard 2
// ---------------------------------------------------------------------------

describe("CA-MCL-02 — Fighter 3 / Wizard 2 at character level 5", () => {
  const build = {
    abilities: { ancestryBoosts: ["con"], backgroundBoosts: ["con"] },
    variantRules: { classLevels: true },
    // Levels 1, 2 and 4 bought Fighter; 3 and 5 bought Wizard.
    choices: split({ 1: FIGHTER_ID, 2: FIGHTER_ID, 3: WIZARD_ID, 4: FIGHTER_ID, 5: WIZARD_ID }),
  };
  const makeSplitDoc = (items: unknown[] = [fighterItem, wizardItem, ancestryItem]) =>
    makeDoc(5, items, build);

  it("records the split, with the first class named", () => {
    const derived = derive(makeSplitDoc());
    const levels = derived["classLevels"] as {
      variantActive: boolean;
      characterLevel: number;
      classLevels: Record<string, number>;
      firstClass: string;
    };
    expect(levels.variantActive).toBe(true);
    expect(levels.characterLevel).toBe(5);
    expect(levels.classLevels).toEqual({ [FIGHTER_ID]: 3, [WIZARD_ID]: 2 });
    expect(levels.firstClass).toBe(FIGHTER_ID);
  });

  it("sums HP per level, each level paying its own class's die (REQ-MCL-033)", () => {
    const doc = makeSplitDoc();
    const derived = derive(doc);
    const sys = doc["system"] as Record<string, unknown>;

    // 8 ancestry + F(10+2) + F(10+2) + W(6+2) + F(10+2) + W(6+2) = 8 + 52 = 60.
    // The pre-variant formula would have said 8 + (10+2)*5 = 68, charging the
    // Fighter die for two Wizard levels.
    expect((sys["attributes"] as { hp: { max: number } }).hp.max).toBe(60);

    const hpByLevel = derived["hpByLevel"] as Array<{ level: number; class: string; hp: number }>;
    expect(hpByLevel).toHaveLength(5);
    expect(hpByLevel.map((row) => row.class)).toEqual([
      FIGHTER_ID,
      FIGHTER_ID,
      WIZARD_ID,
      FIGHTER_ID,
      WIZARD_ID,
    ]);
    expect(hpByLevel.map((row) => row.hp)).toEqual([10, 10, 6, 10, 6]);
  });

  it("takes the BEST rank per proficiency and records where it came from (REQ-MCL-021)", () => {
    const doc = makeSplitDoc();
    const derived = derive(doc);
    const sys = doc["system"] as Record<string, unknown>;

    const saves = sys["saves"] as Record<string, { rank: number }>;
    // Will: Fighter 1 vs Wizard 2 → the Wizard's Expert wins.
    expect(saves["will"]?.rank).toBe(2);
    // Fortitude/Reflex: the Fighter's 2 wins over the Wizard's 1.
    expect(saves["fortitude"]?.rank).toBe(2);
    expect(saves["reflex"]?.rank).toBe(2);
    expect((sys["perception"] as { rank: number }).rank).toBe(2);

    const origin = derived["proficiencyOrigin"] as Record<string, { rank: number; from: string }>;
    expect(origin["will"]).toEqual({ rank: 2, from: WIZARD_ID });
    expect(origin["fortitude"]).toEqual({ rank: 2, from: FIGHTER_ID });
    expect(origin["perception"]).toEqual({ rank: 2, from: FIGHTER_ID });
  });

  it("keeps the martial weapon training the Wizard alone would not grant", () => {
    const doc = makeSplitDoc();
    derive(doc);
    const sys = doc["system"] as Record<string, unknown>;
    const weapons = (sys["proficiencies"] as { weapons: Record<string, number> }).weapons;
    expect(weapons["martial"]).toBe(2);
  });

  it("grants the automatic skills of BOTH classes (REQ-MCL-034)", () => {
    const doc = makeSplitDoc();
    derive(doc);
    const skills = (doc["system"] as Record<string, unknown>)["skills"] as Record<
      string,
      { rank: number }
    >;
    expect(skills["athletics"]?.rank).toBeGreaterThanOrEqual(1);
    expect(skills["arcana"]?.rank).toBeGreaterThanOrEqual(1);
  });

  it("keys off the FIRST class only — a dip never re-keys the character (REQ-MCL-031)", () => {
    const derived = derive(makeSplitDoc());
    const details = (derived["classLevels"] as { firstClass: string }).firstClass;
    expect(details).toBe(FIGHTER_ID);
  });
});

// ---------------------------------------------------------------------------
// CA-MCL-05 / REQ-MCL-203 — order independence
// ---------------------------------------------------------------------------

describe("REQ-MCL-203 — the result does not depend on ordering", () => {
  const choices = split({
    1: FIGHTER_ID,
    2: FIGHTER_ID,
    3: WIZARD_ID,
    4: FIGHTER_ID,
    5: WIZARD_ID,
  });

  it("is unchanged when the class ITEMS are listed in the other order", () => {
    const a = makeDoc(5, [fighterItem, wizardItem, ancestryItem], {
      variantRules: { classLevels: true },
      choices,
    });
    const b = makeDoc(5, [wizardItem, fighterItem, ancestryItem], {
      variantRules: { classLevels: true },
      choices,
    });
    runCharacterPipeline(a);
    runCharacterPipeline(b);
    expect(comparableSystem(b)).toEqual(comparableSystem(a));
  });

  it("is unchanged when the CHOICES are listed out of level order", () => {
    const a = makeDoc(5, [fighterItem, wizardItem, ancestryItem], {
      variantRules: { classLevels: true },
      choices,
    });
    const b = makeDoc(5, [fighterItem, wizardItem, ancestryItem], {
      variantRules: { classLevels: true },
      choices: [...choices].reverse(),
    });
    runCharacterPipeline(a);
    runCharacterPipeline(b);
    expect(comparableSystem(b)).toEqual(comparableSystem(a));
  });

  it("distinguishes WHICH levels went to which class, not just how many", () => {
    // Same 3/2 totals, but the first class differs — and the first class is
    // rule-bearing (REQ-MCL-013/031), so these two must NOT be equal.
    const fighterFirst = makeDoc(5, [fighterItem, wizardItem, ancestryItem], {
      variantRules: { classLevels: true },
      choices,
    });
    const wizardFirst = makeDoc(5, [fighterItem, wizardItem, ancestryItem], {
      variantRules: { classLevels: true },
      choices: split({ 1: WIZARD_ID, 2: WIZARD_ID, 3: FIGHTER_ID, 4: FIGHTER_ID, 5: FIGHTER_ID }),
    });
    const a = derive(fighterFirst);
    const b = derive(wizardFirst);
    expect((a["classLevels"] as { firstClass: string }).firstClass).toBe(FIGHTER_ID);
    expect((b["classLevels"] as { firstClass: string }).firstClass).toBe(WIZARD_ID);
  });
});

// ---------------------------------------------------------------------------
// Robustness — the r11 posture: degrade, never throw
// ---------------------------------------------------------------------------

describe("robustness — malformed splits degrade instead of throwing", () => {
  it("drops a classLevel choice pointing at no class the actor has", () => {
    const doc = makeDoc(3, [fighterItem, ancestryItem], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_ID, 2: FIGHTER_ID, 3: "some-class-not-on-this-actor" }),
    });
    expect(() => {
      runCharacterPipeline(doc);
    }).not.toThrow();
    const derived = (doc["system"] as Record<string, unknown>)["derived"] as Record<
      string,
      unknown
    >;
    // The unresolvable level is dropped, NOT silently handed to the Fighter:
    // guessing would move HP and proficiencies to a class never taken.
    expect((derived["classLevels"] as { classLevels: Record<string, number> }).classLevels).toEqual(
      {
        [FIGHTER_ID]: 2,
      },
    );
  });

  it("survives a class item authored outside the schema", () => {
    const junkClass = {
      _id: "item-junk",
      type: "class",
      name: "Junk",
      flags: { fusion: { sourceId: "junk" } },
      system: { hp: 8 },
    };
    const doc = makeDoc(2, [junkClass, ancestryItem], {
      variantRules: { classLevels: true },
      choices: split({ 1: "junk", 2: "junk" }),
    });
    expect(() => {
      runCharacterPipeline(doc);
    }).not.toThrow();
  });
});
