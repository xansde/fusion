/**
 * Isekai layer — archetype data invariants and content helpers.
 *
 * The eight archetypes are hand-transcribed content: the risk is a typo that
 * silently gates a blessing at the wrong level, or an archetype that trades
 * pool for power on the client while the server's lock table never heard of
 * it. These tests are the guard for both.
 */

import { describe, it, expect } from "vitest";
import {
  ISEKAI_ARCHETYPES,
  ISEKAI_BLESSING_LEVELS,
  ISEKAI_FOCUS_FLOOR,
  MAX_ISEKAI_ARCHETYPES,
  getIsekaiArchetype,
  isekaiActionsUpToLevel,
  isekaiBlessingsAtLevel,
  isekaiDestinyDicePlan,
  isekaiListCapAtLevel,
  isekaiUsesAtLevel,
} from "../isekai/index.js";

describe("Isekai archetype data", () => {
  it("ships the eight archetypes of the source material", () => {
    expect(ISEKAI_ARCHETYPES).toHaveLength(8);
    expect(ISEKAI_ARCHETYPES.map((a) => a.id).sort()).toEqual([
      "carismatico",
      "crafter",
      "especialista",
      "evolutivo",
      "fodao",
      "queridinho",
      "sortudo",
      "underdog",
    ]);
  });

  it("gives every archetype a unique id and a unique name", () => {
    expect(new Set(ISEKAI_ARCHETYPES.map((a) => a.id)).size).toBe(ISEKAI_ARCHETYPES.length);
    expect(new Set(ISEKAI_ARCHETYPES.map((a) => a.name)).size).toBe(ISEKAI_ARCHETYPES.length);
  });

  it("gives every archetype a hex accent colour the sheet can use directly", () => {
    for (const arq of ISEKAI_ARCHETYPES) {
      expect(arq.color, arq.id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("unlocks every Minor Blessing on the documented ladder", () => {
    for (const arq of ISEKAI_ARCHETYPES) {
      for (const blessing of arq.minorBlessings) {
        expect(
          ISEKAI_BLESSING_LEVELS,
          `${arq.id}: "${blessing.name}" at level ${String(blessing.level)}`,
        ).toContain(blessing.level);
      }
    }
  });

  it("keeps Minor Blessings sorted by level, and every archetype ends at 12", () => {
    for (const arq of ISEKAI_ARCHETYPES) {
      const levels = arq.minorBlessings.map((b) => b.level);
      expect(
        [...levels].sort((a, b) => a - b),
        arq.id,
      ).toEqual(levels);
      expect(levels.at(-1), arq.id).toBe(12);
    }
  });

  it("never lets an action cost more Focus than the pool can hold", () => {
    // An ability costing 4 would be uncastable by construction — a data bug,
    // not a design choice.
    for (const arq of ISEKAI_ARCHETYPES) {
      for (const action of arq.actions) {
        expect(action.focus, `${arq.id}/${action.id}`).toBeLessThanOrEqual(ISEKAI_FOCUS_FLOOR);
        expect(action.focus, `${arq.id}/${action.id}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gives every action a unique id within its archetype and a playable level", () => {
    for (const arq of ISEKAI_ARCHETYPES) {
      expect(new Set(arq.actions.map((a) => a.id)).size, arq.id).toBe(arq.actions.length);
      for (const action of arq.actions) {
        expect(action.level, `${arq.id}/${action.id}`).toBeGreaterThanOrEqual(1);
        expect(action.level, `${arq.id}/${action.id}`).toBeLessThanOrEqual(20);
      }
    }
  });

  it("gives every archetype at least one thing to spend on", () => {
    // An archetype with no actions would render an empty half of the Isekai
    // tab — a sign the transcription dropped its panel.
    for (const arq of ISEKAI_ARCHETYPES) {
      expect(arq.actions.length, arq.id).toBeGreaterThan(0);
    }
  });

  it("gives a tracker to every archetype except the Queridinho de Deus", () => {
    for (const arq of ISEKAI_ARCHETYPES) {
      if (arq.id === "queridinho") {
        expect(arq.tracker).toBeUndefined();
      } else {
        expect(arq.tracker, arq.id).toBeDefined();
      }
    }
  });

  it("gives every tracker a unique kind-appropriate id", () => {
    for (const arq of ISEKAI_ARCHETYPES) {
      if (arq.tracker) expect(arq.tracker.id.length, arq.id).toBeGreaterThan(0);
    }
  });
});

describe("Focus locks agree with the server's lock table", () => {
  // Source of truth: systems/pf2e/src/variants/isekai/focusLocks.ts —
  // ISEKAI_FOCUS_LOCK_SOURCES. Mirrored here (not imported: arch boundary)
  // so a new locking archetype registered on only one side fails a test.
  const SERVER_LOCK_SOURCES = [
    { archetypeId: "carismatico", trackerId: "retinue", flag: "named" },
    { archetypeId: "especialista", trackerId: "signatures", flag: "flag" },
  ];

  it("locks Focus from exactly the archetypes the server knows about", () => {
    const fromData = ISEKAI_ARCHETYPES.filter((a) => {
      const t = a.tracker;
      if (!t) return false;
      return (t.kind === "roster" && t.namedLocksFocus) || (t.kind === "list" && t.flagLocksFocus);
    }).map((a) => a.id);
    expect(fromData.sort()).toEqual(SERVER_LOCK_SOURCES.map((s) => s.archetypeId).sort());
  });

  it("keeps the tracker ids the server reads state from", () => {
    for (const source of SERVER_LOCK_SOURCES) {
      const arq = getIsekaiArchetype(source.archetypeId);
      expect(arq?.tracker?.id, source.archetypeId).toBe(source.trackerId);
    }
  });
});

describe("getIsekaiArchetype", () => {
  it("resolves a known id", () => {
    expect(getIsekaiArchetype("fodao")?.name).toBe("O FODÃO");
  });

  it("returns undefined for an unknown id instead of throwing", () => {
    expect(getIsekaiArchetype("nao-existe")).toBeUndefined();
  });
});

describe("isekaiBlessingsAtLevel", () => {
  it("returns only the blessings that unlock exactly at that level", () => {
    const rows = isekaiBlessingsAtLevel(["fodao"], 6);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.blessing.name).toBe("Passada Imparável");
    expect(rows[0]?.archetype.id).toBe("fodao");
  });

  it("merges both archetypes at the same level, in archetype order", () => {
    const rows = isekaiBlessingsAtLevel(["fodao", "sortudo"], 12);
    expect(rows.map((r) => r.archetype.id)).toEqual(["fodao", "sortudo"]);
    expect(rows.map((r) => r.blessing.name)).toEqual(["Plot Armor", "A Casa Sempre Vence"]);
  });

  it("returns both level-1 blessings of an archetype", () => {
    const rows = isekaiBlessingsAtLevel(["fodao"], 1);
    expect(rows.map((r) => r.blessing.name)).toEqual([
      "Couraça de Protagonista",
      "Vitalidade Sobre-Humana",
    ]);
  });

  it("returns nothing at a level with no unlock", () => {
    expect(isekaiBlessingsAtLevel(["fodao", "sortudo"], 7)).toEqual([]);
  });

  it("ignores unknown ids", () => {
    expect(isekaiBlessingsAtLevel(["nao-existe"], 1)).toEqual([]);
  });
});

describe("isekaiActionsUpToLevel", () => {
  it("includes an action at its own level and every level above", () => {
    expect(isekaiActionsUpToLevel(["fodao"], 5).map((r) => r.action.id)).not.toContain("passada");
    expect(isekaiActionsUpToLevel(["fodao"], 6).map((r) => r.action.id)).toContain("passada");
    expect(isekaiActionsUpToLevel(["fodao"], 20).map((r) => r.action.id)).toContain("passada");
  });

  it("sorts by unlock level", () => {
    const levels = isekaiActionsUpToLevel(["sortudo", "carismatico"], 20).map(
      (r) => r.action.level,
    );
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
  });

  it("returns nothing for a character with no archetypes", () => {
    expect(isekaiActionsUpToLevel([], 20)).toEqual([]);
  });
});

describe("tracker helpers", () => {
  const sortudo = getIsekaiArchetype("sortudo");
  const especialista = getIsekaiArchetype("especialista");
  const fodao = getIsekaiArchetype("fodao");

  it("rolls 3 Dados do Destino at level 1", () => {
    expect(isekaiDestinyDicePlan(sortudo!, 1)).toEqual({ count: 3, fixed: [] });
  });

  it("adds Pé de Coelho's extra die from level 3", () => {
    expect(isekaiDestinyDicePlan(sortudo!, 3).count).toBe(4);
  });

  it("adds the fixed 20 and 1 from level 12", () => {
    const plan = isekaiDestinyDicePlan(sortudo!, 12);
    expect(plan.count).toBe(4);
    expect(plan.fixed).toEqual([20, 1]);
  });

  it("returns an empty plan for an archetype with no dice pool", () => {
    expect(isekaiDestinyDicePlan(fodao!, 20)).toEqual({ count: 0, fixed: [] });
  });

  it("walks the Signature cap staircase", () => {
    expect(isekaiListCapAtLevel(especialista!, 1)).toBe(1);
    expect(isekaiListCapAtLevel(especialista!, 5)).toBe(1);
    expect(isekaiListCapAtLevel(especialista!, 6)).toBe(2);
    expect(isekaiListCapAtLevel(especialista!, 11)).toBe(2);
    expect(isekaiListCapAtLevel(especialista!, 12)).toBe(3);
    expect(isekaiListCapAtLevel(especialista!, 20)).toBe(3);
  });

  it("has no list cap for an archetype without a list tracker", () => {
    expect(isekaiListCapAtLevel(sortudo!, 20)).toBeNull();
  });

  it("reveals limited uses only from the level that grants them", () => {
    expect(isekaiUsesAtLevel(fodao!, 5)).toHaveLength(0);
    expect(isekaiUsesAtLevel(fodao!, 6).map((u) => u.id)).toEqual(["passada"]);
    expect(isekaiUsesAtLevel(fodao!, 12).map((u) => u.id)).toEqual(["passada", "plot"]);
  });
});

describe("mirrored parameters", () => {
  it("caps the pick at two archetypes", () => {
    expect(MAX_ISEKAI_ARCHETYPES).toBe(2);
  });
});
