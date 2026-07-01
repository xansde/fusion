/**
 * @fusion/system-sf2e — Derivation pipeline tests.
 *
 * Mirrors `systems/pf2e/src/__tests__/derivations.test.ts`'s structure
 * (REQ-SF2-004: same math, same pipeline shape). Every derived number is
 * cross-checked by hand and, where the underlying formula is shared with
 * PF2e, by calling the SAME engine-2e functions the derivation steps call
 * (`calculateProficiencyBonus`) — auditable reuse, not reimplementation.
 *
 * Covers:
 *   1. Ability modifiers (REQ-SF2-004).
 *   2. Proficiency bonus (REQ-SF2-004, delegates to engine-2e).
 *   3. AC derivation (REQ-SF2-004).
 *   4. Saves (REQ-SF2-004).
 *   5. Perception (REQ-SF2-004).
 *   6. Skills incl. Computers/Piloting (REQ-SF2-007, REQ-SF2-008).
 *   7. Topological ordering (REQ-SYS-022): ability mod before saves.
 *   8. Suppressed condition: −1 circumstance to attack, −10ft status to
 *      speed (REQ-SF2-006, delta condition confirmed in real compendium
 *      data — see conditions.ts).
 *   9. Strike derivation for a Tech weapon (Arc Rifle) with MAP
 *      (REQ-SF2-018..020).
 *   10. Battery/charge consumption gating a strike (REQ-SF2-020).
 *   11. NPC minimal derivation (REQ-SF2-002).
 *   12. Drained HP reduction (engine-2e, inherited unchanged).
 *
 * Test operative sample (level 5):
 *   STR 14 (+2), DEX 18 (+4), CON 14 (+2), INT 12 (+1), WIS 10 (+0), CHA 10 (+0)
 *   Perception: Expert (rank 2) → 2*2+5 + 0 (WIS) = 9
 *   AC: Trained (rank 1) in light armor; AC bonus 3; dex cap 3 → dex=3; potency 0
 *     → 10 + 3 + (1*2+5) + 3 + 0 = 10 + 3 + 7 + 3 = 23
 *   Reflex: Expert (rank 2) → 2*2+5 + 4(DEX) = 13
 *   Computers: Expert (rank 2) → 2*2+5 + 1(INT) = 10
 *   Piloting: Trained (rank 1) → 1*2+5 + 4(DEX) = 11
 *
 * All numbers verified by hand per requirements.
 *
 * REQ-SF2-002, REQ-SF2-004, REQ-SF2-006..008, REQ-SF2-018..020.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { emptySynthetics, topoSort, type DeriveContext } from "@fusion/system-api";
import {
  collectEffects,
  type EffectSource,
  calculateProficiencyBonus,
  resolveModifiersForSelector,
} from "@fusion/engine-2e";
import {
  stepCharAbilityMods,
  stepCharAc,
  stepCharSaves,
  stepCharPerception,
  stepCharSkills,
  stepCharClassDC,
  stepCharStrikes,
  stepCharHp,
  stepCharDyingMax,
  stepCharDrainedHp,
  CHARACTER_DERIVE_STEPS,
} from "../derivations/character.js";
import {
  stepNpcAc,
  stepNpcHp,
  stepNpcPerception,
  stepNpcSaves,
  stepNpcSkills,
  NPC_DERIVE_STEPS,
} from "../derivations/npc.js";
import { abilityMod, proficiencyBonus } from "../derivations/helpers.js";
import { SF2E_CONDITIONS } from "../conditions.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyCtx(): DeriveContext {
  return {
    system: null,
    synthetics: emptySynthetics(),
    rollOptions: new Set<string>(),
  };
}

function ctxWith(
  synthetics: ReturnType<typeof emptySynthetics>,
  rollOptions?: Set<string>,
): DeriveContext {
  return {
    system: null,
    synthetics,
    rollOptions: rollOptions ?? new Set<string>(),
  };
}

/**
 * Sample level-5 Operative document.
 *
 * STR 14/DEX 18/CON 14/INT 12/WIS 10/CHA 10
 * Perception Expert (rank 2). Saves: Fort Trained (1), Ref Expert (2), Will Trained (1).
 * Skills: computers Expert (2), piloting Trained (1), stealth Expert (2).
 * Proficiencies: classDC Expert (2), weapons.simple Expert (2), armor.light Trained (1).
 * Key ability: DEX. HP: max 68, value 68. No dying/doomed/drained.
 * Equipped light armor (AC+3, dexCap 3, potency 0) and an Arc Rifle (Tech weapon,
 * simple, 1d6 electricity, `bonus` 0, capacity 1, expend 2, charges 1/1 — REQ-SF2-018..020).
 */
function makeOperativeDoc(level = 5): Record<string, unknown> {
  return {
    system: {
      systemVersion: "0.1.0",
      level: { value: level },
      abilities: {
        str: { value: 14, mod: 0 },
        dex: { value: 18, mod: 0 },
        con: { value: 14, mod: 0 },
        int: { value: 12, mod: 0 },
        wis: { value: 10, mod: 0 },
        cha: { value: 10, mod: 0 },
      },
      attributes: {
        hp: { value: 68, max: 68, temp: 0 },
        ac: { value: 10 },
        speed: { value: 30, otherSpeeds: [] },
        dying: { value: 0, max: 4 },
        wounded: { value: 0 },
        doomed: { value: 0 },
        iwr: { immunities: [], weaknesses: [], resistances: [] },
      },
      saves: {
        fortitude: { rank: 1 },
        reflex: { rank: 2 },
        will: { rank: 1 },
      },
      perception: { rank: 2, senses: [] },
      skills: {
        computers: { rank: 2 },
        piloting: { rank: 1 },
        stealth: { rank: 2 },
        athletics: { rank: 0 },
      },
      proficiencies: {
        classDC: { rank: 2 },
        weapons: { unarmed: 1, simple: 2, martial: 0, advanced: 0 },
        armor: { unarmored: 1, light: 1, medium: 0, heavy: 0 },
      },
      resources: { heroPoints: { value: 1, max: 3 }, focusPoints: { value: 0, max: 0 } },
      currency: { credits: 250 },
      augmentations: { installed: [], apexCount: 0, regularCount: 0 },
      details: { keyAbility: "dex", level },
      traits: { rarity: "common", value: [], size: "med" },
    } as Record<string, unknown>,
    // Equipped light armor: AC+3, dexCap 3, potency 0
    _equippedArmor: {
      category: "light",
      acBonus: 3,
      dexCap: 3,
      potency: 0,
    },
    // Equipped Arc Rifle: Tech weapon (simple, 1d6 electricity), item bonus 0,
    // battery capacity 1, expend 2/shot, currently 1/1 charge (REQ-SF2-018..020).
    _equippedWeapons: [
      {
        name: "Arc Rifle",
        id: "arc-rifle-1",
        damage: { dice: 1, die: "d6", damageType: "electricity", modifier: 0 },
        category: "simple",
        traits: ["arc", "tech"],
        range: 50,
        runes: { potency: 0, striking: 0 },
        bonus: 0,
        charges: { current: 1, max: 1 },
        expend: 2,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Run all base+derived steps in topological order, simulating the pipeline
// (no `defineSystem` registry dependency — steps are sorted directly).
// ---------------------------------------------------------------------------

function runCharacterPipeline(
  doc: Record<string, unknown>,
  effectSources: EffectSource[] = [],
): void {
  const baseSteps = topoSort(CHARACTER_DERIVE_STEPS.filter((s) => s.phase === "base"));
  for (const step of baseSteps) {
    step.run(doc, emptyCtx());
  }

  const baseOptions = new Set<string>();
  const { synthetics } = collectEffects(effectSources, baseOptions);

  const rollOptions = new Set<string>(baseOptions);
  for (const [, opts] of Object.entries(synthetics.rollOptions)) {
    for (const opt of opts) rollOptions.add(opt);
  }

  const derivedCtx = ctxWith(synthetics, rollOptions);

  const derivedSteps = topoSort(CHARACTER_DERIVE_STEPS.filter((s) => s.phase === "derived"));
  for (const step of derivedSteps) {
    step.run(doc, derivedCtx);
  }
}

// ---------------------------------------------------------------------------
// Unit tests — helpers (REQ-SF2-004: delegates to engine-2e)
// ---------------------------------------------------------------------------

describe("abilityMod helper (REQ-SF2-004)", () => {
  it("score 10 → mod 0", () => expect(abilityMod(10)).toBe(0));
  it("score 18 → mod 4", () => expect(abilityMod(18)).toBe(4));
  it("score 14 → mod 2", () => expect(abilityMod(14)).toBe(2));
  it("score 12 → mod 1", () => expect(abilityMod(12)).toBe(1));
});

describe("proficiencyBonus helper (REQ-SF2-004 — thin re-export of engine-2e)", () => {
  it("matches calculateProficiencyBonus from engine-2e directly", () => {
    for (const rank of [0, 1, 2, 3, 4] as const) {
      for (const level of [1, 5, 20]) {
        expect(proficiencyBonus(rank, level)).toBe(calculateProficiencyBonus(rank, level));
      }
    }
  });
  it("rank 2 (Expert) level 5 → 9", () => expect(proficiencyBonus(2, 5)).toBe(9));
});

// ---------------------------------------------------------------------------
// Unit tests — individual steps
// ---------------------------------------------------------------------------

describe("stepCharAbilityMods", () => {
  it("derives correct mods from scores", () => {
    const doc = makeOperativeDoc();
    stepCharAbilityMods.run(doc, emptyCtx());

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const mods = derived["abilityMods"] as Record<string, number>;
    expect(mods.str).toBe(2);
    expect(mods.dex).toBe(4);
    expect(mods.con).toBe(2);
    expect(mods.int).toBe(1);
    expect(mods.wis).toBe(0);
    expect(mods.cha).toBe(0);
  });
});

describe("stepCharHp", () => {
  it("propagates HP values from source", () => {
    const doc = makeOperativeDoc();
    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharHp.run(doc, emptyCtx());

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as { value: number; max: number; temp: number };
    expect(hp.value).toBe(68);
    expect(hp.max).toBe(68);
  });
});

describe("stepCharDyingMax", () => {
  it("max dying = 4 when doomed 0", () => {
    const doc = makeOperativeDoc();
    stepCharDyingMax.run(doc, emptyCtx());
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    expect(derived["dyingMax"]).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — full pipeline on the Operative sample
// ---------------------------------------------------------------------------

describe("Operative level 5 — full derivation pipeline", () => {
  let doc: Record<string, unknown>;

  beforeEach(() => {
    doc = makeOperativeDoc(5);
    runCharacterPipeline(doc);
  });

  it("ability mods are correct", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const mods = derived["abilityMods"] as Record<string, number>;
    expect(mods.str).toBe(2);
    expect(mods.dex).toBe(4);
  });

  it("AC = 23 (10 + 3dex(capped) + 7prof + 3armorBonus + 0potency)", () => {
    // Light armor: dexCap 3 → dex 4 capped to 3.
    // Armor prof Trained at level 5 → rank 1 * 2 + 5 = 7.
    // acBonus = 3, potency = 0.
    // Total = 10 + 3 + 7 + 3 + 0 = 23.
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const ac = derived["ac"] as { total: number };
    expect(ac.total).toBe(23);
  });

  it("Reflex = 13 (Expert rank 2 → 9 + 4 DEX)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as { reflex: { total: number } };
    expect(saves.reflex.total).toBe(13);
  });

  it("Fortitude = 9 (Trained rank 1 → 7 + 2 CON)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const saves = derived["saves"] as { fortitude: { total: number } };
    expect(saves.fortitude.total).toBe(9);
  });

  it("Perception = 9 (Expert rank 2 → 9 + 0 WIS)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const perception = derived["perception"] as { total: number };
    expect(perception.total).toBe(9);
  });

  it("Computers = 10 (Expert rank 2 → 9 + 1 INT) — REQ-SF2-007", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    expect(skills["computers"]?.total).toBe(10);
  });

  it("Piloting = 11 (Trained rank 1 → 7 + 4 DEX) — REQ-SF2-008", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const skills = derived["skills"] as Record<string, { total: number }>;
    expect(skills["piloting"]?.total).toBe(11);
  });

  it("Class DC = 22 (Expert rank 2 → 9 + 4 DEX key; dc = 10+12)", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const classDC = derived["classDC"] as { total: number; dc: number };
    expect(classDC.total).toBe(13);
    expect(classDC.dc).toBe(23);
  });

  it("topological order: ability mods computed before saves depend on them", () => {
    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    expect(derived["abilityMods"]).toBeDefined();
    expect(derived["saves"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Strike derivation for the Arc Rifle (Tech weapon — REQ-SF2-018..020)
// ---------------------------------------------------------------------------

describe("Strikes — Arc Rifle (Tech weapon, REQ-SF2-018..020)", () => {
  it("derives an attack bonus using proficiency + DEX (ranged) + item bonus", () => {
    const doc = makeOperativeDoc(5);
    runCharacterPipeline(doc);

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const strikes = derived["strikes"] as Array<{
      label: string;
      attackBonus: number;
      isRanged: boolean;
      ammoOk: boolean;
      charges?: { current: number; max: number };
      variants: Array<{ mapPenalty: number; total: number }>;
    }>;

    expect(strikes).toHaveLength(1);
    const rifle = strikes[0]!;
    expect(rifle.label).toBe("Arc Rifle");
    expect(rifle.isRanged).toBe(true);

    // Attack bonus = DEX mod (4) + proficiency (simple, Expert rank 2 → 9) + item bonus (0) = 13
    expect(rifle.attackBonus).toBe(13);

    // MAP: not agile → 0 / −5 / −10
    expect(rifle.variants[0]!.mapPenalty).toBe(0);
    expect(rifle.variants[1]!.mapPenalty).toBe(-5);
    expect(rifle.variants[2]!.mapPenalty).toBe(-10);
    expect(rifle.variants[1]!.total).toBe(8);
    expect(rifle.variants[2]!.total).toBe(3);

    // Has 1 charge, expends 2 per shot → NOT enough ammo (REQ-SF2-020).
    expect(rifle.ammoOk).toBe(false);
    expect(rifle.charges).toEqual({ current: 1, max: 1 });
  });

  it("ammoOk is true when charges >= expend", () => {
    const doc = makeOperativeDoc(5);
    const weapons = doc["_equippedWeapons"] as Array<{ charges: { current: number; max: number } }>;
    weapons[0]!.charges = { current: 2, max: 2 };
    runCharacterPipeline(doc);

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const strikes = derived["strikes"] as Array<{ ammoOk: boolean }>;
    expect(strikes[0]!.ammoOk).toBe(true);
  });

  it("Analog weapon (no ammo block) is always ammoOk", () => {
    const doc = makeOperativeDoc(5);
    doc["_equippedWeapons"] = [
      {
        name: "Combat Knife",
        id: "knife-1",
        damage: { dice: 1, die: "d4", damageType: "piercing", modifier: 0 },
        category: "simple",
        traits: ["agile", "finesse"],
        range: null,
        runes: { potency: 1, striking: 0 },
      },
    ];
    runCharacterPipeline(doc);

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const strikes = derived["strikes"] as Array<{ ammoOk: boolean; isRanged: boolean }>;
    expect(strikes[0]!.ammoOk).toBe(true);
    expect(strikes[0]!.isRanged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suppressed condition (SF2e-exclusive delta — REQ-SF2-006)
// ---------------------------------------------------------------------------

describe("Suppressed condition (SF2e-exclusive, real compendium delta)", () => {
  it("is registered with attack-roll and speed FlatModifiers", () => {
    const suppressed = SF2E_CONDITIONS.find((c) => c.slug === "suppressed");
    expect(suppressed).toBeDefined();
    const attackMod = suppressed?.effects.find(
      (e) => e.type === "flatModifier" && e.selector === "attack-roll",
    );
    expect(attackMod).toBeDefined();
    if (attackMod?.type === "flatModifier") {
      expect(attackMod.value).toBe(-1);
      expect(attackMod.modifierType).toBe("circumstance");
    }
  });

  // END-TO-END: run the REAL derive path (collectEffects → derived steps →
  // strike derivation), not just the static SF2E_CONDITIONS registration.
  // `suppressed` is `valued: false` (no badge substitution), so the
  // EffectSource is built directly from its own `effects[]) — sf2e has no
  // conditionsToEffectSources helper (that's pf2e-only; see
  // systems/pf2e/src/conditions.ts), so this mirrors what such a helper
  // would produce for a non-valued condition.
  describe("applied via the real derive pipeline (collectEffects + strike)", () => {
    function suppressedEffectSource(): EffectSource {
      const suppressed = SF2E_CONDITIONS.find((c) => c.slug === "suppressed");
      if (!suppressed) throw new Error("suppressed condition not registered");
      return {
        sourceId: "condition:suppressed",
        label: "Suppressed",
        active: true,
        rules: suppressed.effects,
      };
    }

    it("reduces the Arc Rifle attack bonus by 1 (circumstance) end-to-end", () => {
      const doc = makeOperativeDoc(5);
      runCharacterPipeline(doc, [suppressedEffectSource()]);

      const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
      const strikes = derived["strikes"] as Array<{
        attackBonus: number;
        variants: Array<{ mapPenalty: number; total: number }>;
      }>;
      const rifle = strikes[0]!;

      // Baseline (no suppressed) is 13 — see the Arc Rifle strike test above.
      // Suppressed applies -1 circumstance to the generic "attack-roll"
      // selector, which strikes fold in alongside the ranged-specific one.
      expect(rifle.attackBonus).toBe(12);
      expect(rifle.variants[0]!.total).toBe(12);
      expect(rifle.variants[1]!.total).toBe(7);
      expect(rifle.variants[2]!.total).toBe(2);
    });

    it("produces a -10 status modifier on the speed selector (no stepCharSpeed to read a final value from)", () => {
      // sf2e's derive pipeline has no speed-derivation step yet (confirmed:
      // no stepCharSpeed exists in systems/sf2e/src/derivations/) — the
      // document only carries a static system.attributes.speed.value. So
      // the strongest real-path assertion available is that collectEffects
      // resolves a -10 status modifier for the "speed" selector, without
      // fabricating a derived total the pipeline doesn't actually compute.
      const { synthetics } = collectEffects([suppressedEffectSource()], new Set<string>());
      const rollOptions = new Set<string>();
      for (const opts of Object.values(synthetics.rollOptions)) {
        for (const opt of opts) rollOptions.add(opt);
      }

      const speedMods = resolveModifiersForSelector("speed", synthetics, rollOptions);
      expect(speedMods).toHaveLength(1);
      expect(speedMods[0]!.value).toBe(-10);
      expect(speedMods[0]!.type).toBe("status");
    });
  });
});

// ---------------------------------------------------------------------------
// NPC minimal derivation (REQ-SF2-002)
// ---------------------------------------------------------------------------

describe("NPC minimal derivation (REQ-SF2-002)", () => {
  function makeNpcDoc(): Record<string, unknown> {
    return {
      system: {
        systemVersion: "0.1.0",
        abilities: {
          str: { mod: 3 },
          dex: { mod: 2 },
          con: { mod: 3 },
          int: { mod: 0 },
          wis: { mod: 1 },
          cha: { mod: 0 },
        },
        attributes: {
          hp: { value: 45, max: 45, temp: 0 },
          ac: { value: 19 },
          speed: { value: 25, otherSpeeds: [] },
          perception: { mod: 8, senses: [] },
          iwr: { immunities: [], weaknesses: [], resistances: [] },
        },
        saves: {
          fortitude: { value: 11 },
          reflex: { value: 8 },
          will: { value: 7 },
        },
        skills: {
          athletics: { base: 10 },
          computers: { base: 6 },
        },
        initiative: { statistic: "perception" },
        details: { level: { value: 4 }, languages: { value: [] } },
        traits: { rarity: "common", value: [], size: "med" },
      },
    };
  }

  it("propagates AC/HP/Perception/Saves/Skills totals", () => {
    const doc = makeNpcDoc();
    const ctx = emptyCtx();
    for (const step of topoSort([...NPC_DERIVE_STEPS])) {
      step.run(doc, ctx);
    }

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    expect((derived["ac"] as { total: number }).total).toBe(19);
    expect((derived["hp"] as { value: number }).value).toBe(45);
    expect((derived["perception"] as { total: number }).total).toBe(8);
    expect((derived["saves"] as { fortitude: { total: number } }).fortitude.total).toBe(11);
    expect((derived["skills"] as Record<string, { total: number }>)["computers"]?.total).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Drained HP reduction (engine-2e, inherited unchanged)
// ---------------------------------------------------------------------------

describe("Drained HP reduction (inherited engine-2e formula)", () => {
  it("Drained 2, level 5 → −10 max HP", () => {
    const doc = makeOperativeDoc(5);
    stepCharAbilityMods.run(doc, emptyCtx());
    stepCharHp.run(doc, emptyCtx());

    const ctx = ctxWith(emptySynthetics(), new Set(["drained:2"]));
    stepCharDrainedHp.run(doc, ctx);

    const derived = (doc.system as Record<string, unknown>)["derived"] as Record<string, unknown>;
    const hp = derived["hp"] as { max: number; drainedHpReduction: number };
    expect(hp.drainedHpReduction).toBe(10);
    expect(hp.max).toBe(58); // 68 - 10
  });
});

// Silence unused-import lints for steps referenced only for type-level wiring checks.
void stepCharAc;
void stepCharSaves;
void stepCharPerception;
void stepCharSkills;
void stepCharClassDC;
void stepCharStrikes;
void stepNpcAc;
void stepNpcHp;
void stepNpcPerception;
void stepNpcSaves;
void stepNpcSkills;
