/**
 * Isekai variant — data invariants and pure helpers.
 *
 * The eight archetypes are hand-transcribed content: the risk here is a typo
 * that silently gates a blessing at the wrong level or points a tracker at an
 * archetype that does not exist. These tests are the guard for that, and they
 * exercise the helpers the Plan column and the Isekai tab consume.
 */

import { describe, it, expect } from "vitest";
import {
  ISEKAI_ARCHETYPES,
  getIsekaiArchetype,
  isekaiBlessingsAtLevel,
  isekaiActionsUpToLevel,
  isekaiLockedFocus,
  type IsekaiTrackerState,
} from "../variants/isekai/index.js";
import {
  ISEKAI_BLESSING_LEVELS,
  MAX_ISEKAI_ARCHETYPES,
  ISEKAI_FOCUS_FLOOR,
} from "../variants/isekai/params.js";

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
    const ids = new Set(ISEKAI_ARCHETYPES.map((a) => a.id));
    const names = new Set(ISEKAI_ARCHETYPES.map((a) => a.name));
    expect(ids.size).toBe(ISEKAI_ARCHETYPES.length);
    expect(names.size).toBe(ISEKAI_ARCHETYPES.length);
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
      expect([...levels].sort((a, b) => a - b), arq.id).toEqual(levels);
      expect(levels.at(-1), arq.id).toBe(12);
    }
  });

  it("never lets an action cost more Focus than the pool can hold at once", () => {
    // 3 is the hard PF2e cap the layer never widens: an ability costing 4
    // would be uncastable by construction, which is a data bug, not a design.
    for (const arq of ISEKAI_ARCHETYPES) {
      for (const action of arq.actions) {
        expect(action.focus, `${arq.id}/${action.id}`).toBeLessThanOrEqual(ISEKAI_FOCUS_FLOOR);
        expect(action.focus, `${arq.id}/${action.id}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gives every action a unique id within its archetype and a real level", () => {
    for (const arq of ISEKAI_ARCHETYPES) {
      const ids = new Set(arq.actions.map((a) => a.id));
      expect(ids.size, arq.id).toBe(arq.actions.length);
      for (const action of arq.actions) {
        expect(action.level, `${arq.id}/${action.id}`).toBeGreaterThanOrEqual(1);
        expect(action.level, `${arq.id}/${action.id}`).toBeLessThanOrEqual(20);
      }
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

  it("only locks Focus from the two archetypes whose rules say so", () => {
    const lockers = ISEKAI_ARCHETYPES.filter((a) => {
      const t = a.tracker;
      if (!t) return false;
      return (
        (t.kind === "roster" && t.namedLocksFocus) || (t.kind === "list" && t.flagLocksFocus)
      );
    }).map((a) => a.id);
    expect(lockers.sort()).toEqual(["carismatico", "especialista"]);
  });
});

describe("getIsekaiArchetype", () => {
  it("resolves a known id", () => {
    expect(getIsekaiArchetype("fodao")?.name).toBe("O FODÃO");
  });

  it("returns undefined for an unknown id instead of throwing", () => {
    // A sheet can carry an id from a future/removed archetype; the sheet must
    // still open. Never throw on data the document happens to hold.
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

  it("sorts by Focus cost descending is NOT assumed — it sorts by level then name", () => {
    const rows = isekaiActionsUpToLevel(["sortudo"], 20);
    const levels = rows.map((r) => r.action.level);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
  });
});

describe("isekaiLockedFocus", () => {
  const empty: IsekaiTrackerState = {};

  it("locks nothing when no tracker state exists", () => {
    expect(isekaiLockedFocus(["carismatico", "especialista"], empty)).toBe(0);
  });

  it("locks one point per ★ Named companion", () => {
    const state: IsekaiTrackerState = {
      carismatico: {
        retinue: [
          { id: "a", name: "Gobta", tier: "active", named: true },
          { id: "b", name: "Ranga", tier: "retinue", named: true },
          { id: "c", name: "Souei", tier: "base", named: false },
        ],
      },
    };
    expect(isekaiLockedFocus(["carismatico"], state)).toBe(2);
  });

  it("locks one point per ★ taught Signature", () => {
    const state: IsekaiTrackerState = {
      especialista: {
        signatures: [
          { id: "a", name: "Lâmina de Vazio", flag: true },
          { id: "b", name: "Salto Curto", flag: false },
        ],
      },
    };
    expect(isekaiLockedFocus(["especialista"], state)).toBe(1);
  });

  it("adds up locks across both archetypes", () => {
    const state: IsekaiTrackerState = {
      carismatico: { retinue: [{ id: "a", name: "Gobta", tier: "active", named: true }] },
      especialista: { signatures: [{ id: "b", name: "Lâmina", flag: true }] },
    };
    expect(isekaiLockedFocus(["carismatico", "especialista"], state)).toBe(2);
  });

  it("ignores state belonging to an archetype the character did not pick", () => {
    const state: IsekaiTrackerState = {
      carismatico: { retinue: [{ id: "a", name: "Gobta", tier: "active", named: true }] },
    };
    expect(isekaiLockedFocus(["fodao", "sortudo"], state)).toBe(0);
  });

  it("survives malformed state without throwing", () => {
    // Documents are edited by hand and by older clients; a bad shape must
    // degrade to "no lock", never crash the derivation.
    const state = {
      carismatico: { retinue: "not-an-array" },
      especialista: { signatures: [null, 42, { flag: true }] },
    } as unknown as IsekaiTrackerState;
    expect(isekaiLockedFocus(["carismatico", "especialista"], state)).toBe(1);
  });

  it("never locks more than the pool floor, so a pool can always exist", () => {
    // Six Named companions would otherwise lock the whole pool away and make
    // the character unable to spend Focus at all.
    const state: IsekaiTrackerState = {
      carismatico: {
        retinue: Array.from({ length: 6 }, (_, i) => ({
          id: `c${String(i)}`,
          name: `Companion ${String(i)}`,
          tier: "retinue" as const,
          named: true,
        })),
      },
    };
    expect(isekaiLockedFocus(["carismatico"], state)).toBeLessThanOrEqual(ISEKAI_FOCUS_FLOOR);
  });
});

describe("variant parameters", () => {
  it("caps the pick at two archetypes", () => {
    expect(MAX_ISEKAI_ARCHETYPES).toBe(2);
  });

  it("floors the Focus pool at the published cap, never above it", () => {
    expect(ISEKAI_FOCUS_FLOOR).toBe(3);
  });
});
