/**
 * spellHeightening.test.ts — pure heightening math (r16-G3).
 */

import { describe, it, expect } from "vitest";
import {
  effectiveSpellRank,
  computeHeightenedSpell,
  healSpellSystem,
} from "../spellHeightening.js";

describe("effectiveSpellRank", () => {
  it("cantrips auto-heighten to ceil(level/2), min 1", () => {
    expect(effectiveSpellRank("cantrip", 1, 0)).toBe(1);
    expect(effectiveSpellRank("cantrip", 3, 0)).toBe(2); // Tobias case
    expect(effectiveSpellRank("cantrip", 5, 0)).toBe(3);
    expect(effectiveSpellRank("cantrip", 20, 0)).toBe(10);
  });

  it("focus spells auto-heighten to ceil(level/2), min 1", () => {
    expect(effectiveSpellRank("focus", 1, 1)).toBe(1);
    expect(effectiveSpellRank("focus", 3, 1)).toBe(2);
    expect(effectiveSpellRank("focus", 8, 1)).toBe(4);
  });

  it("prepared spells cast at the slot rank (never below base)", () => {
    expect(effectiveSpellRank("prepared", 3, 1, 3)).toBe(3);
    expect(effectiveSpellRank("prepared", 3, 2, 1)).toBe(2); // clamp to base
    expect(effectiveSpellRank("prepared", 3, 1, undefined)).toBe(1); // no slot → base
  });

  it("grimoire spells stay at base rank", () => {
    expect(effectiveSpellRank("grimoire", 20, 3)).toBe(3);
  });
});

describe("computeHeightenedSpell — interval", () => {
  // Horizon Thunder Sphere: base 1, component "0" = 3d6, +2d6 every +1 rank.
  const horizon = {
    level: 1,
    damage: { "0": { formula: "3d6", type: "electricity", category: null } },
    heightening: { type: "interval", interval: 1, damage: { "0": "2d6" } },
  };

  it("no heightening at base rank leaves the base formula untouched", () => {
    const r = computeHeightenedSpell(horizon, 1, 1);
    expect(r.heightenedBy).toBe(0);
    expect(r.rollFormula).toBe("3d6");
    expect(r.hasComplexHeightening).toBe(false);
  });

  it("interval=1 adds one extra term per rank above base", () => {
    const r2 = computeHeightenedSpell(horizon, 1, 2);
    expect(r2.rollFormula).toBe("3d6+2d6");
    expect(r2.heightenedBy).toBe(1);

    const r3 = computeHeightenedSpell(horizon, 1, 3);
    expect(r3.rollFormula).toBe("3d6+2d6+2d6");
    expect(r3.heightenedBy).toBe(2);
  });

  it("interval=2 only steps every 2 ranks (floor)", () => {
    const fireball = {
      level: 3,
      damage: { "0": { formula: "6d6", type: "fire", category: null } },
      heightening: { type: "interval", interval: 2, damage: { "0": "2d6" } },
    };
    // effRank 4 → 1 above base, floor(1/2)=0 steps → unchanged
    expect(computeHeightenedSpell(fireball, 3, 4).rollFormula).toBe("6d6");
    // effRank 5 → 2 above base, floor(2/2)=1 step
    expect(computeHeightenedSpell(fireball, 3, 5).rollFormula).toBe("6d6+2d6");
    // effRank 7 → 4 above base, floor(4/2)=2 steps
    expect(computeHeightenedSpell(fireball, 3, 7).rollFormula).toBe("6d6+2d6+2d6");
  });

  it("preserves the damage type in the display", () => {
    const r = computeHeightenedSpell(horizon, 1, 3);
    expect(r.damageDisplay).toBe("3d6+2d6+2d6 electricity");
  });

  it("handles composite base formulas without breaking the roll (Ignition-like)", () => {
    const forceBolt = {
      level: 1,
      damage: { "0": { formula: "1d4+1", type: "force", category: null } },
      heightening: { type: "interval", interval: 2, damage: { "0": "1d4+1" } },
    };
    // effRank 3 → 2 above base → 1 step: "1d4+1+1d4+1"
    expect(computeHeightenedSpell(forceBolt, 1, 3).rollFormula).toBe("1d4+1+1d4+1");
  });
});

describe("computeHeightenedSpell — fixed", () => {
  // Darklight: base 7, "0"=2d6 bludgeoning + "1"=2d6 void; rank 10 rewrites both to 3d6.
  const darklight = {
    level: 7,
    damage: {
      "0": { formula: "2d6", type: "bludgeoning", category: null },
      "1": { formula: "2d6", type: "void", category: null },
    },
    heightening: {
      type: "fixed",
      levels: {
        "10": {
          damage: {
            "0": { formula: "3d6", type: "bludgeoning" },
            "1": { formula: "3d6", type: "void" },
          },
        },
      },
    },
  };

  it("below the fixed level keeps base damage", () => {
    const r = computeHeightenedSpell(darklight, 7, 8);
    expect(r.rollFormula).toBe("2d6+2d6");
    expect(r.hasComplexHeightening).toBe(false);
  });

  it("at/above the fixed level overrides damage with the level entry", () => {
    const r = computeHeightenedSpell(darklight, 7, 10);
    expect(r.rollFormula).toBe("3d6+3d6");
  });

  it("flags complex fixed changes (target/range) without altering the formula", () => {
    const cloudedFocus = {
      level: 1,
      damage: {},
      heightening: {
        type: "fixed",
        levels: {
          "3": { target: { value: "2 creatures" } },
          "6": { target: { value: "4 creatures" } },
        },
      },
    };
    const r = computeHeightenedSpell(cloudedFocus, 1, 3);
    expect(r.hasComplexHeightening).toBe(true);
    expect(r.rollFormula).toBeNull(); // no damage to roll
  });
});

describe("computeHeightenedSpell — no heightening", () => {
  it("a plain damage spell is untouched at any rank", () => {
    const magicMissile = {
      level: 1,
      damage: { "0": { formula: "1d4+1", type: "force", category: null } },
    };
    const r = computeHeightenedSpell(magicMissile, 1, 5);
    expect(r.rollFormula).toBe("1d4+1");
    expect(r.heightenedBy).toBe(4); // rank rose, but no heightening data
    expect(r.hasComplexHeightening).toBe(false);
  });

  it("a spell with no damage yields null formula", () => {
    const r = computeHeightenedSpell({ level: 1, damage: {} }, 1, 3);
    expect(r.rollFormula).toBeNull();
    expect(r.damageDisplay).toBeNull();
  });

  it("degrades gracefully on malformed system", () => {
    const r = computeHeightenedSpell(null, 0, 2);
    expect(r.rollFormula).toBeNull();
    // base 0 (cantrip-like) is normalized to the rank-1 casting baseline.
    expect(r.baseRank).toBe(1);
    expect(r.effectiveRank).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// healSpellSystem (r16 verificação viva) — real Argiburgo shapes
// ---------------------------------------------------------------------------

describe("healSpellSystem", () => {
  // The embedded Ignition copy on Tobias: no heightening, damage keyed "0",
  // empty traits — exactly what the world DB inspection revealed.
  const embeddedIgnition = {
    damage: { "0": { formula: "2d4", type: "fire", kinds: ["damage"], applyMod: false } },
    traits: { value: [] },
  };
  // The spells-core pack Ignition: interval heightening keyed by the pack's
  // component id, full traits (including "attack").
  const packIgnition = {
    level: 1,
    damage: { cQDyW0QpjJ38MlSi: { formula: "2d4", type: "fire" } },
    heightening: { type: "interval", interval: 1, damage: { cQDyW0QpjJ38MlSi: "1d4" } },
    traits: { value: ["attack", "cantrip", "concentrate", "fire", "manipulate"] },
  };

  it("overlays pack heightening/damage/traits when the embedded copy lacks them", () => {
    const healed = healSpellSystem(embeddedIgnition, packIgnition);
    expect(healed["heightening"]).toEqual(packIgnition.heightening);
    // damage is replaced by the pack's (keys line up with heightening).
    expect(healed["damage"]).toEqual(packIgnition.damage);
    expect((healed["traits"] as { value: string[] }).value).toContain("attack");
  });

  it("does not clobber a real embedded value", () => {
    const embeddedWithData = {
      heightening: { type: "interval", interval: 1, damage: { "0": "9d9" } },
      damage: { "0": { formula: "9d9", type: "acid" } },
      traits: { value: ["custom"] },
    };
    const healed = healSpellSystem(embeddedWithData, packIgnition);
    expect(healed["heightening"]).toEqual(embeddedWithData.heightening);
    expect(healed["damage"]).toEqual(embeddedWithData.damage);
    expect((healed["traits"] as { value: string[] }).value).toEqual(["custom"]);
  });

  it("returns the embedded system unchanged when no pack match", () => {
    const healed = healSpellSystem(embeddedIgnition, null);
    expect(healed).toEqual(embeddedIgnition);
  });

  it("does NOT heal system.level (cantrip grouping stays at rank 0)", () => {
    const healed = healSpellSystem(embeddedIgnition, packIgnition);
    expect(healed["level"]).toBeUndefined();
  });

  it("end-to-end: healed Ignition heightens for Tobias (L3 cantrip → rank 2 → 2d4+1d4)", () => {
    const healed = healSpellSystem(embeddedIgnition, packIgnition);
    // Cantrip base 0 → effective rank ceil(3/2) = 2.
    const eff = effectiveSpellRank("cantrip", 3, 0);
    expect(eff).toBe(2);
    const h = computeHeightenedSpell(healed, 0, eff);
    // base normalized to 1, heightenedBy 1 → one extra 1d4 term.
    expect(h.rollFormula).toBe("2d4+1d4");
    expect(h.heightenedBy).toBe(1);
  });

  it("end-to-end: Horizon Thunder Sphere at rank 3 → 3d6+2d6+2d6", () => {
    const embedded = {
      damage: { "0": { formula: "3d6", type: "electricity" } },
      traits: { value: [] },
    };
    const pack = {
      level: 1,
      damage: { "0": { formula: "3d6", type: "electricity" } },
      heightening: { type: "interval", interval: 1, damage: { "0": "2d6" } },
      traits: { value: ["attack", "concentrate", "electricity", "manipulate"] },
    };
    const healed = healSpellSystem(embedded, pack);
    // Prepared in a rank-3 slot (base 1 → +2 → two extra 2d6 terms).
    const h = computeHeightenedSpell(healed, 1, 3);
    expect(h.rollFormula).toBe("3d6+2d6+2d6");
    expect(h.heightenedBy).toBe(2);
  });
});
