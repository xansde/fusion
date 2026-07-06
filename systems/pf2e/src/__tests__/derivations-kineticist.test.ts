/**
 * @fusion/system-pf2e — Kineticist derivation tests: "Finn por build" (r18-N2b).
 *
 * Finn — Fleshwarp (Sylph) Kineticist 3, Dual Gate Air+Metal, background
 * Aeronaut, Free Archetype Rogue Dedication. Pathbuilder-validated sheet.
 * This fixture reproduces EVERY target number from the character dossier,
 * fully build-driven (embedded ancestry + class + items + feats), exercising
 * the r18-N2b additions: Toughness HP, Will Expertise@3, CON class DC, and
 * Elemental Blast derivation.
 *
 * TARGET NUMBERS (all verified against the vendor pf2e pack + official rules):
 *   HP  49  = 10 (Fleshwarp) + (8 class + 4 CON) × 3 + 3 (Toughness = +level)
 *   AC  20  = 10 + min(DEX 3, dexCap 3) + Trained light@3 (5) + Elven Chain +2
 *   Fort +11 = 3 + Expert (4) + CON 4        (kineticist fort Expert@1)
 *   Ref  +10 = 3 + Expert (4) + DEX 3        (kineticist reflex Expert@1)
 *   Will +8  = 3 + Expert (4) + WIS 1        (Will Expertise@3: Trained→Expert)
 *   Perc +6  = 3 + Trained (2) + WIS 1       (kineticist perception Trained@1)
 *   ClassDC 19 = 10 + 3 + Trained (2) + CON 4   (keyAbility CON)
 *   Blast atk +9 = 3 + Trained impulse (2) + CON 4   (Rage of Elements p.14:
 *                  impulse uses the class-DC proficiency + attribute = CON)
 *                  → +10 with Gate Attenuator (+1 item bonus)
 *   Speed 30 = 25 (Fleshwarp) + 5 (Fleet feat, land-speed flat-modifier)
 *
 * SOURCE NOTES:
 *   - vendor classes/kineticist.json: hp 8, keyAbility [con], perception 1,
 *     savingThrows {fort 2, reflex 2, will 1}, defenses.light 1, attacks
 *     {simple 1, unarmed 1}, trainedSkills [nature]. Will Expertise & CON class
 *     DC are level-3 / key-ability facts of the class.
 *   - vendor ancestries/fleshwarp.json: hp 10, speed 25, size med.
 *   - vendor equipment/elven-chain-standard-grade.json: category light,
 *     acBonus 2, dexCap 3.
 *   - vendor equipment/gate-attenuator.json: FlatModifier impulse-attack-roll
 *     +1 (item).
 *   - vendor feats/general/level-1/toughness.json: FlatModifier hp @actor.level.
 *   - AoN Elements: air 1d6 electricity/slashing 60 ft (ID=1); metal 1d8
 *     piercing/slashing 30 ft (ID=5).
 *
 * BLAST +8 vs +9 — the dossier's Pathbuilder note said "+8 sem Gate Attenuator".
 * Derived STRICTLY by the official rule that gives +9 (level 3 + trained
 * impulse 2 + CON 4). The dossier's +8 is a stale/imprecise note (its own
 * "~+10 com +1 item" implies +9 base, not +8); the class DC 19 pins CON at +4,
 * which forces +9. We assert the RULE result and document the divergence here.
 *
 * Clean-room: ORC/OGL mechanics only.
 * REQ-PF2-010..022, REQ-PF2-030..034, REQ-PF2-051.
 */

import { describe, it, expect } from "vitest";
import { emptySynthetics } from "@fusion/system-api";
import type { DeriveContext } from "@fusion/system-api";
import { pf2eSystem } from "../index.js";

function emptyCtx(): DeriveContext {
  return {
    system: pf2eSystem,
    synthetics: emptySynthetics(),
    rollOptions: new Set<string>(),
  };
}

function runCharacterPipeline(doc: Record<string, unknown>): void {
  const baseSteps = pf2eSystem.deriveSteps.sortedForPhase("base", "Actor", "character");
  for (const step of baseSteps) step.run(doc, emptyCtx());
  const derivedSteps = pf2eSystem.deriveSteps.sortedForPhase("derived", "Actor", "character");
  for (const step of derivedSteps) step.run(doc, emptyCtx());
}

// ---------------------------------------------------------------------------
// Embedded item factories (real vendor shapes)
// ---------------------------------------------------------------------------

/** Fleshwarp ancestry: HP 10, speed 25, size med (vendor fleshwarp.json). */
function fleshwarpAncestry(): Record<string, unknown> {
  return {
    _id: "ancestry-fleshwarp",
    name: "Fleshwarp",
    type: "ancestry",
    system: { hp: 10, speed: 25, size: "med", boosts: [], flaws: [], languages: { value: [] } },
  };
}

/**
 * Kineticist class doc (vendor classes/kineticist.json shape).
 * Will Expertise@3 encoded as a proficiencyUpgrade (will → Expert at level 3);
 * classDC Trained (rank 1) — the kineticist is trained in its class DC at
 * level 1; impulse Trained (rank 1) — impulse attacks use the class-DC
 * proficiency.
 */
function kineticistClass(): Record<string, unknown> {
  return {
    _id: "class-kineticist",
    name: "Kineticist",
    type: "class",
    system: {
      hp: 8,
      keyAbility: ["con"],
      perception: 1, // Trained
      savingThrows: { fortitude: 2, reflex: 2, will: 1 }, // Expert / Expert / Trained
      defenses: { unarmored: 1, light: 1, medium: 0, heavy: 0 },
      attacks: { unarmed: 1, simple: 1, martial: 0, advanced: 0 },
      classDC: 1, // Trained
      impulse: 1, // Trained impulse attacks (Rage of Elements)
      trainedSkills: { value: ["nature"], additional: 3 },
      proficiencyUpgrades: [
        // Will Expertise (Kineticist class feature, level 3): Trained → Expert.
        { level: 3, stat: "will", rank: 2 },
      ],
      featLevels: { ancestry: [], class: [2], general: [3], skill: [2] },
      skillIncreaseLevels: [],
      abilityBoostLevels: [5, 10, 15, 20],
      featuresByLevel: [],
    },
  };
}

/** Elven Chain (Standard-Grade), equipped (vendor elven-chain-standard-grade.json). */
function elvenChain(): Record<string, unknown> {
  return {
    _id: "elven-chain-1",
    name: "Elven Chain (Standard-Grade)",
    type: "armor",
    system: {
      category: "light",
      acBonus: 2,
      dexCap: 3,
      runes: { potency: 0 },
      equipped: true,
    },
  };
}

/** Gate Attenuator: +1 item bonus to impulse attack rolls, equipped. */
function gateAttenuator(): Record<string, unknown> {
  return {
    _id: "gate-attenuator-1",
    name: "Gate Attenuator",
    type: "equipment",
    system: {
      equipped: true,
      rules: [{ key: "FlatModifier", selector: "impulse-attack-roll", type: "item", value: 1 }],
    },
  };
}

/** Toughness feat: HP max += level (vendor toughness.json FlatModifier). */
function toughnessFeat(): Record<string, unknown> {
  return {
    _id: "feat-toughness",
    name: "Toughness",
    type: "feat",
    system: {
      category: "general",
      level: 1,
      rules: [{ key: "FlatModifier", selector: "hp", value: "@actor.level" }],
      traits: { rarity: "common", value: ["general"] },
    },
  };
}

/** Fleet feat: +5 land speed (vendor Fleet shape, r16-G1). */
function fleetFeat(): Record<string, unknown> {
  return {
    _id: "feat-fleet",
    name: "Fleet",
    type: "feat",
    system: {
      category: "general",
      level: 1,
      rules: [{ kind: "flat-modifier", selector: "land-speed", value: 5, mode: "add", type: "untyped" }],
      traits: { rarity: "common", value: ["general"] },
    },
  };
}

/** Kinetic Gate class feature carrying the Dual Gate Air+Metal choice. */
function kineticGate(): Record<string, unknown> {
  return {
    _id: "cf-kinetic-gate",
    name: "Kinetic Gate",
    type: "classFeature",
    system: {
      level: 1,
      kineticGates: [
        { element: "air", damageType: "electricity" },
        { element: "metal", damageType: "slashing" },
      ],
    },
  };
}

/** Free Archetype Rogue Dedication feat (does not affect the target numbers). */
function rogueDedication(): Record<string, unknown> {
  return {
    _id: "feat-rogue-dedication",
    name: "Rogue Dedication",
    type: "feat",
    system: {
      category: "class",
      level: 2,
      traits: { rarity: "common", value: ["archetype", "dedication", "rogue"] },
      subfeatures: {
        proficiencies: { rogue: { attribute: "dex", rank: 1 } },
      },
    },
  };
}

/**
 * Finn's fully build-driven document. Ability boosts are a SYNTHETIC origin
 * sequence chosen to land on CON 18 / DEX 16 / WIS 12 via the boost math
 * (matching the build machinery, not literal Fleshwarp/Aeronaut lore — same
 * convention as the Tobias-by-build fixture).
 */
function makeFinnDoc(
  opts: { withToughness?: boolean; level?: number } = {},
): Record<string, unknown> {
  const withToughness = opts.withToughness ?? true;
  const level = opts.level ?? 3;

  const items: Record<string, unknown>[] = [
    fleshwarpAncestry(),
    kineticistClass(),
    elvenChain(),
    gateAttenuator(),
    fleetFeat(),
    kineticGate(),
    rogueDedication(),
  ];
  if (withToughness) items.push(toughnessFeat());

  return {
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
      resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
      details: { keyAbility: "str", level },
      traits: { rarity: "common", value: [], size: "med" },
      build: {
        abilities: {
          // Synthetic sequence → CON 18 (4 boosts), DEX 16 (3), WIS 12 (1).
          ancestryBoosts: ["con", "dex"],
          ancestryFlaws: [],
          ancestryFree: ["con", "dex"],
          backgroundBoosts: ["con", "wis"],
          backgroundFree: ["dex"],
          classBoost: ["con"],
          levelledBoosts: {},
        },
        choices: [],
        bonusHp: 0,
        bonusHpPerLevel: 0,
        freeArchetype: true,
      },
    },
    items,
  };
}

// ---------------------------------------------------------------------------
// Ability scores + HP + AC + saves + perception + classDC
// ---------------------------------------------------------------------------

describe("Finn-by-build — Fleshwarp Kineticist 3, Dual Gate Air+Metal (r18-N2b)", () => {
  it("ability scores derive to CON 18 / DEX 16 / WIS 12", () => {
    const doc = makeFinnDoc();
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as { abilities: Record<string, { value: number }> };
    expect(sys.abilities.con.value).toBe(18);
    expect(sys.abilities.dex.value).toBe(16);
    expect(sys.abilities.wis.value).toBe(12);
  });

  it("key ability is CON (from the class item)", () => {
    const doc = makeFinnDoc();
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as { details: { keyAbility: string } };
    expect(sys.details.keyAbility).toBe("con");
  });

  it("HP = 49  (Fleshwarp 10 + (8 + CON 4) × 3 + Toughness 3)", () => {
    const doc = makeFinnDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as { max: number };
    expect(hp.max).toBe(49);
  });

  it("AC = 20  (Elven Chain +2, dexCap 3, Trained light@3)", () => {
    const doc = makeFinnDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const ac = derived["ac"] as { total: number };
    expect(ac.total).toBe(20);
  });

  it("saves = Fortitude +11 / Reflex +10 / Will +8", () => {
    const doc = makeFinnDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as Record<string, { total: number }>;
    expect(saves["fortitude"]?.total).toBe(11); // Expert@3 (7) + CON 4
    expect(saves["reflex"]?.total).toBe(10); // Expert@3 (7) + DEX 3
    expect(saves["will"]?.total).toBe(8); // Will Expertise@3 → Expert (7) + WIS 1
  });

  it("Perception = +6  (Trained@3 + WIS 1)", () => {
    const doc = makeFinnDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const perception = derived["perception"] as { total: number };
    expect(perception.total).toBe(6);
  });

  it("Class DC = 19  (10 + 3 + Trained 2 + CON 4), keyAbility CON", () => {
    const doc = makeFinnDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const classDC = derived["classDC"] as { total: number; dc: number };
    // total = Trained@3 (5) + CON 4 = 9; dc = 10 + 9 = 19.
    expect(classDC.total).toBe(9);
    expect(classDC.dc).toBe(19);
  });

  it("Speed = 30  (Fleshwarp 25 + Fleet +5)", () => {
    const doc = makeFinnDoc();
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const speed = derived["speed"] as { value: number; base: number };
    expect(speed.base).toBe(25);
    expect(speed.value).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Elemental Blast (Air + Metal)
// ---------------------------------------------------------------------------

describe("Finn — Elemental Blast derivation (Air + Metal, Gate Attenuator +1)", () => {
  interface Blast {
    element: string;
    attackBonus: number;
    damageDie: string;
    damageDice: number;
    damageRoll: string;
    damageType: string;
    range: number | null;
    isRanged: boolean;
    twoActionDamageBonus: number;
    itemAttackBonus: number;
    variants: { total: number; mapPenalty: number }[];
  }

  function blastsOf(doc: Record<string, unknown>): Record<string, Blast> {
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const list = derived["elementalBlasts"] as Blast[];
    const byElement: Record<string, Blast> = {};
    for (const b of list) byElement[b.element] = b;
    return byElement;
  }

  it("derives one blast per gate element (air + metal)", () => {
    const blasts = blastsOf(makeFinnDoc());
    expect(Object.keys(blasts).sort()).toEqual(["air", "metal"]);
  });

  it("attack bonus = +10 (level 3 + trained impulse 2 + CON 4 + Gate Attenuator 1)", () => {
    const blasts = blastsOf(makeFinnDoc());
    expect(blasts["air"]?.attackBonus).toBe(10);
    expect(blasts["metal"]?.attackBonus).toBe(10);
    expect(blasts["air"]?.itemAttackBonus).toBe(1);
  });

  it("attack bonus = +9 WITHOUT Gate Attenuator (rule base: 3 + 2 + CON 4)", () => {
    const doc = makeFinnDoc();
    // Remove the Gate Attenuator to expose the pure-rule +9.
    (doc.items as Record<string, unknown>[]) = (doc.items as Record<string, unknown>[]).filter(
      (i) => i["_id"] !== "gate-attenuator-1",
    );
    const blasts = blastsOf(doc);
    expect(blasts["air"]?.attackBonus).toBe(9);
    expect(blasts["air"]?.itemAttackBonus).toBe(0);
  });

  it("MAP variants are 0 / −5 / −10 (impulses are never agile)", () => {
    const blasts = blastsOf(makeFinnDoc());
    const air = blasts["air"];
    expect(air?.variants.map((v) => v.total)).toEqual([10, 5, 0]);
    expect(air?.variants.map((v) => v.mapPenalty)).toEqual([0, -5, -10]);
  });

  it("Air blast: 1d6 electricity, ranged 60 ft (AoN Elements ID=1)", () => {
    const blasts = blastsOf(makeFinnDoc());
    const air = blasts["air"];
    expect(air?.damageDie).toBe("d6");
    expect(air?.damageDice).toBe(1);
    expect(air?.damageRoll).toBe("1d6");
    expect(air?.damageType).toBe("electricity");
    expect(air?.range).toBe(60);
    expect(air?.isRanged).toBe(true);
  });

  it("Metal blast: 1d8 slashing, ranged 30 ft (AoN Elements ID=5)", () => {
    const blasts = blastsOf(makeFinnDoc());
    const metal = blasts["metal"];
    expect(metal?.damageDie).toBe("d8");
    expect(metal?.damageRoll).toBe("1d8");
    expect(metal?.damageType).toBe("slashing");
    expect(metal?.range).toBe(30);
  });

  it("2-action blast damage bonus = CON mod (+4)", () => {
    const blasts = blastsOf(makeFinnDoc());
    expect(blasts["air"]?.twoActionDamageBonus).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Negative fixtures
// ---------------------------------------------------------------------------

describe("Finn — negative fixtures (Toughness / level)", () => {
  it("WITHOUT Toughness: HP = 46 (no +level bonus)", () => {
    const doc = makeFinnDoc({ withToughness: false });
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as { max: number };
    expect(hp.max).toBe(46);
  });

  it("at level 1: Will is only Trained (Will Expertise@3 not yet active)", () => {
    const doc = makeFinnDoc({ level: 1 });
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as { saves: { will: { rank: number } } };
    // Kineticist will save is Trained (rank 1) at level 1; the upgrade to
    // Expert only fires at level 3.
    expect(sys.saves.will.rank).toBe(1);
  });

  it("at level 3: Will is upgraded to Expert (rank 2)", () => {
    const doc = makeFinnDoc({ level: 3 });
    runCharacterPipeline(doc);
    const sys = doc.system as unknown as { saves: { will: { rank: number } } };
    expect(sys.saves.will.rank).toBe(2);
  });

  it("non-kineticist (no gates, no class): elementalBlasts is empty", () => {
    const doc = makeFinnDoc();
    (doc.items as Record<string, unknown>[]) = [];
    runCharacterPipeline(doc);
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    expect(derived["elementalBlasts"]).toEqual([]);
  });
});
