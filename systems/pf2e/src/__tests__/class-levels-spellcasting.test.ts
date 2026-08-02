/**
 * @fusion/system-pf2e — Spellcasting under the class-levels variant.
 *
 * The number that matters here is the one a single-class caster never had to
 * distinguish: you get a level-2 wizard's SLOTS but cast them at the rank
 * your CHARACTER level supports. Both halves have to be true at once, and
 * both have to be visible (REQ-MCL-060/061/067).
 *
 * Clean-room: ORC/OGL mechanics only. House rule by Igor (Wayfinder), used
 * with permission and attribution.
 * Spec: 30-multiclasse-por-niveis.md §6.7.
 */

import { describe, it, expect } from "vitest";
import { emptySynthetics } from "@fusion/system-api";
import type { DeriveContext } from "@fusion/system-api";
import { pf2eSystem } from "../index.js";
import type { SpellcastingLevels } from "../derivations/spellcastingLevels.js";
import { spellcastRank, effectiveSpellRank } from "../variants/classLevels/formulas.js";
import { FOCUS_POOL_CAP } from "../variants/classLevels/params.js";

function emptyCtx(): DeriveContext {
  return { system: pf2eSystem, synthetics: emptySynthetics(), rollOptions: new Set<string>() };
}

function runCharacterPipeline(doc: Record<string, unknown>): Record<string, unknown> {
  for (const step of pf2eSystem.deriveSteps.sortedForPhase("base", "Actor", "character")) {
    step.run(doc, emptyCtx());
  }
  for (const step of pf2eSystem.deriveSteps.sortedForPhase("derived", "Actor", "character")) {
    step.run(doc, emptyCtx());
  }
  return (doc["system"] as Record<string, unknown>)["derived"] as Record<string, unknown>;
}

const FIGHTER_ID = "fighter-source-id";
const WIZARD_ID = "wizard-source-id";

/** Full-caster slot table: rank ceil(level/2), 2 slots each, through level 20. */
const fullCasterSlots = Array.from({ length: 20 }, (_, index) => {
  const level = index + 1;
  const maxRank = Math.ceil(level / 2);
  const slots: Record<string, number> = {};
  for (let rank = 1; rank <= maxRank; rank++) slots[String(rank)] = 2;
  return { level, slots };
});

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
    attacks: { unarmed: 1, simple: 1 },
    defenses: { unarmored: 1 },
    classDC: 1,
    trainedSkills: { value: ["arcana"], additional: 2 },
    proficiencyUpgrades: [],
    featuresByLevel: [],
    featLevels: {},
    spellcasting: {
      type: "prepared",
      tradition: "arcane",
      ability: "int",
      cantripsKnown: Array.from({ length: 20 }, (_, i) => ({ level: i + 1, count: 5 })),
      slots: fullCasterSlots,
    },
  },
};

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

const arcaneEntry = {
  _id: "entry-arcane",
  type: "spellcastingEntry",
  name: "Arcane Spells",
  flags: { fusion: { classKey: WIZARD_ID, build: { level: 1, slot: "class:spellcasting" } } },
  system: {
    prepared: { value: "prepared" },
    tradition: { value: "arcane" },
    ability: { value: "int" },
    proficiency: { value: 1 },
    slots: {},
    isFocusPool: false,
  },
};

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
      details: {},
      traits: { rarity: "common", value: [], size: "med" },
      build: { abilities: {}, choices: [], ...build },
    },
  };
}

function split(levelToClass: Record<number, string>): unknown[] {
  return Object.entries(levelToClass).map(([level, sourceId]) => ({
    level: Number(level),
    slot: `classLevel-${level}`,
    type: "classLevel",
    ref: `Compendium.fusion.classes.${sourceId}`,
  }));
}

// ---------------------------------------------------------------------------
// REQ-MCL-060/061/067 — slots from the class level, rank from the character
// ---------------------------------------------------------------------------

describe("Fighter 3 / Wizard 2 — slots by class level, rank by character level", () => {
  const doc = () =>
    makeDoc(5, [fighterItem, wizardItem, arcaneEntry], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_ID, 2: FIGHTER_ID, 3: WIZARD_ID, 4: FIGHTER_ID, 5: WIZARD_ID }),
    });

  it("reports the class level, native rank, effective rank and elevation", () => {
    const derived = runCharacterPipeline(doc());
    const entry = (derived["spellcastingLevels"] as Record<string, SpellcastingLevels>)[
      "entry-arcane"
    ];

    expect(entry?.classKey).toBe(WIZARD_ID);
    // Two wizard levels → a level-2 wizard's slots, whose top rank is 1.
    expect(entry?.classLevel).toBe(2);
    expect(entry?.nativeRank).toBe(1);
    // …cast at the character's own rank: ceil(5/2) = 3.
    expect(entry?.effectiveRank).toBe(3);
    expect(entry?.elevation).toBe(2);
    expect(entry?.fromArchetype).toBe(false);
  });

  it("keeps slot COUNT tied to the class level, not lifted with the rank", () => {
    // The elevation raises how hard a spell lands, never how many you get —
    // otherwise a 1-level dip would out-cast a devoted caster.
    const derived = runCharacterPipeline(doc());
    const entry = (derived["spellcastingLevels"] as Record<string, SpellcastingLevels>)[
      "entry-arcane"
    ];
    expect(entry?.classLevel).toBe(2);
    expect(entry?.effectiveRank).toBeGreaterThan(entry?.nativeRank ?? 0);
  });
});

describe("REQ-MCL-202 — a single-class caster sees zero elevation", () => {
  it("Wizard 5 pure: native rank equals effective rank", () => {
    const derived = runCharacterPipeline(
      makeDoc(5, [wizardItem, arcaneEntry], { variantRules: { classLevels: true } }),
    );
    const entry = (derived["spellcastingLevels"] as Record<string, SpellcastingLevels>)[
      "entry-arcane"
    ];
    expect(entry?.classLevel).toBe(5);
    expect(entry?.nativeRank).toBe(3);
    expect(entry?.effectiveRank).toBe(3);
    expect(entry?.elevation).toBe(0);
  });

  it("holds at every level for a full caster, with the variant off", () => {
    for (let level = 1; level <= 20; level++) {
      const derived = runCharacterPipeline(makeDoc(level, [wizardItem, arcaneEntry], {}));
      const entry = (derived["spellcastingLevels"] as Record<string, SpellcastingLevels>)[
        "entry-arcane"
      ];
      expect(entry?.elevation).toBe(0);
      expect(entry?.effectiveRank).toBe(effectiveSpellRank(level));
    }
  });
});

describe("REQ-MCL-065 — archetype slots run RAW", () => {
  it("an archetype entry gets no elevation", () => {
    const archetypeEntry = {
      ...arcaneEntry,
      _id: "entry-archetype",
      flags: { fusion: { classKey: WIZARD_ID, build: { level: 4, slot: "archetype:spellcasting" } } },
    };
    const derived = runCharacterPipeline(
      makeDoc(5, [fighterItem, wizardItem, archetypeEntry], {
        variantRules: { classLevels: true },
        choices: split({ 1: FIGHTER_ID, 2: FIGHTER_ID, 3: WIZARD_ID, 4: FIGHTER_ID, 5: WIZARD_ID }),
      }),
    );
    const entry = (derived["spellcastingLevels"] as Record<string, SpellcastingLevels>)[
      "entry-archetype"
    ];
    expect(entry?.fromArchetype).toBe(true);
    expect(entry?.elevation).toBe(0);
  });
});

describe("entry→class attribution", () => {
  it("falls back to the sole casting class when the flag is absent (pre-variant docs)", () => {
    const unflagged = { ...arcaneEntry, flags: {} };
    const derived = runCharacterPipeline(makeDoc(5, [wizardItem, unflagged], {}));
    const entry = (derived["spellcastingLevels"] as Record<string, SpellcastingLevels>)[
      "entry-arcane"
    ];
    expect(entry?.classKey).toBe(WIZARD_ID);
    expect(entry?.classLevel).toBe(5);
  });

  it("declines to guess when two casting classes exist and the flag is absent", () => {
    const secondCaster = {
      ...wizardItem,
      _id: "item-witch",
      name: "Witch",
      flags: { fusion: { sourceId: "witch-source-id" } },
    };
    const unflagged = { ...arcaneEntry, flags: {} };
    const derived = runCharacterPipeline(
      makeDoc(5, [wizardItem, secondCaster, unflagged], {
        variantRules: { classLevels: true },
        choices: split({
          1: WIZARD_ID,
          2: WIZARD_ID,
          3: "witch-source-id",
          4: WIZARD_ID,
          5: "witch-source-id",
        }),
      }),
    );
    const entry = (derived["spellcastingLevels"] as Record<string, SpellcastingLevels>)[
      "entry-arcane"
    ];
    // Attributing it to whichever class was listed first would silently give
    // the entry the wrong slot table.
    expect(entry?.classKey).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// REQ-MCL-062/064 — the summoning axis, decided by trait
// ---------------------------------------------------------------------------

describe("REQ-MCL-064 — the summon axis is decided by TRAIT, never by a spell list", () => {
  it("routes summon and incarnate spells through the capped formula", () => {
    // Wizard 2 in a level-5 character: ceil(2/2)+2 = 3, floored at the
    // dedication rank 1, capped at ceil(5/2) = 3.
    expect(spellcastRank(["summon"], 2, 5)).toBe(3);
    expect(spellcastRank(["incarnate"], 2, 5)).toBe(3);
  });

  it("routes everything else through the plain effective rank", () => {
    expect(spellcastRank([], 2, 5)).toBe(effectiveSpellRank(5));
    expect(spellcastRank(["fire", "manipulate"], 2, 5)).toBe(effectiveSpellRank(5));
  });

  it("caps a 1-level dip's summon below a devoted caster's at the same character level", () => {
    // Wizard 1 vs Wizard 20, both in a level-20 character.
    expect(spellcastRank(["summon"], 1, 20)).toBeLessThan(spellcastRank(["summon"], 20, 20));
  });

  it("keeps archetype-sourced spells on the RAW route", () => {
    expect(spellcastRank(["summon"], 2, 20, { fromArchetype: true, nativeRank: 4 })).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// REQ-MCL-066 — one focus pool
// ---------------------------------------------------------------------------

describe("REQ-MCL-066 — focus points are one pool, capped, regardless of class count", () => {
  it("clamps the pool even with two focus-granting classes", () => {
    const doc = makeDoc(5, [fighterItem, wizardItem], {
      variantRules: { classLevels: true },
      choices: split({ 1: FIGHTER_ID, 2: FIGHTER_ID, 3: WIZARD_ID, 4: FIGHTER_ID, 5: WIZARD_ID }),
    });
    const sys = doc["system"] as Record<string, unknown>;
    (sys["resources"] as Record<string, unknown>)["focusPoints"] = { value: 6, max: 6 };
    runCharacterPipeline(doc);
    const focus = (sys["resources"] as { focusPoints: { value: number; max: number } }).focusPoints;
    expect(focus.max).toBe(FOCUS_POOL_CAP);
    expect(focus.value).toBe(FOCUS_POOL_CAP);
  });
});
