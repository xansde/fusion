/**
 * Isekai variant — Focus lock arithmetic.
 *
 * This is the only Isekai fact the server derives from, so it is the only one
 * tested here. The archetype CONTENT (blessings, actions, trackers) is the
 * client's and is tested there.
 */

import { describe, it, expect } from "vitest";
import {
  ISEKAI_FOCUS_LOCK_SOURCES,
  isekaiLockedFocus,
  type IsekaiTrackerState,
} from "../variants/isekai/focusLocks.js";
import {
  ISEKAI_FOCUS_FLOOR,
  MAX_ISEKAI_ARCHETYPES,
  ISEKAI_BLESSING_LEVELS,
} from "../variants/isekai/params.js";

describe("ISEKAI_FOCUS_LOCK_SOURCES", () => {
  it("registers exactly the two archetypes whose rules trade pool for power", () => {
    expect(ISEKAI_FOCUS_LOCK_SOURCES.map((s) => s.archetypeId).sort()).toEqual([
      "carismatico",
      "especialista",
    ]);
  });

  it("names one tracker field per source, so the count is unambiguous", () => {
    for (const source of ISEKAI_FOCUS_LOCK_SOURCES) {
      expect(source.trackerId.length).toBeGreaterThan(0);
      expect(source.flag.length).toBeGreaterThan(0);
    }
  });
});

describe("isekaiLockedFocus", () => {
  it("locks nothing when there is no tracker state", () => {
    expect(isekaiLockedFocus(["carismatico", "especialista"], undefined)).toBe(0);
    expect(isekaiLockedFocus(["carismatico", "especialista"], {})).toBe(0);
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
    // Un-picking an archetype must free its locked pool immediately, without
    // having to erase the tracker (the state is kept so re-picking restores it).
    const state: IsekaiTrackerState = {
      carismatico: { retinue: [{ id: "a", name: "Gobta", tier: "active", named: true }] },
    };
    expect(isekaiLockedFocus(["fodao", "sortudo"], state)).toBe(0);
  });

  it("ignores an unknown archetype id instead of throwing", () => {
    expect(isekaiLockedFocus(["nao-existe"], { "nao-existe": { retinue: [] } })).toBe(0);
  });

  it("survives malformed state without throwing", () => {
    const state = {
      carismatico: { retinue: "not-an-array" },
      especialista: { signatures: [null, 42, { flag: true }] },
    } as unknown as IsekaiTrackerState;
    expect(isekaiLockedFocus(["carismatico", "especialista"], state)).toBe(1);
  });

  it("never locks more than the pool floor, so a pool can always exist", () => {
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
    expect(isekaiLockedFocus(["carismatico"], state)).toBe(ISEKAI_FOCUS_FLOOR);
  });
});

describe("variant parameters", () => {
  it("caps the pick at two archetypes", () => {
    expect(MAX_ISEKAI_ARCHETYPES).toBe(2);
  });

  it("floors the Focus pool at the published cap, never above it", () => {
    expect(ISEKAI_FOCUS_FLOOR).toBe(3);
  });

  it("documents the blessing ladder the client's data is checked against", () => {
    expect(ISEKAI_BLESSING_LEVELS).toEqual([1, 3, 4, 5, 6, 8, 12]);
  });
});
