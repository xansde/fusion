/**
 * @fusion/system-etmos — Etmos Initiative Formula tests.
 *
 * REQ-ETM-022, CA-7: `2d6 + Corpo`; compare() order = (1) maior initiative,
 * (2) hasPlayerOwner vence NPC, (3) maior Corpo, (4) 0 (fallback estável).
 */
import { describe, it, expect } from "vitest";
import type { CombatantDocument, InitiativeEntry } from "@fusion/shared";
import {
  etmosInitiativeFormula,
  etmosInitiativeCompare,
  etmosInitiativeFormulaRegistration,
} from "../initiative.js";
import { etmosSystem } from "../index.js";

function makeCombatant(overrides: Partial<CombatantDocument> = {}): CombatantDocument {
  return {
    _id: "combatant-1",
    tokenId: null,
    actorId: null,
    name: "Test Combatant",
    img: null,
    initiative: null,
    initiativeStatistic: null,
    hidden: false,
    defeated: false,
    hasPlayerOwner: false,
    flags: {},
    ...overrides,
  } as CombatantDocument;
}

function makeEntry(overrides: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return {
    combatant: makeCombatant(),
    total: null,
    ...overrides,
  };
}

describe("etmosInitiativeFormula — 2d6 + Corpo (REQ-ETM-022)", () => {
  it("returns 2d6 alone when actor is null (no linked actor)", () => {
    const result = etmosInitiativeFormula(makeCombatant(), null);
    expect(result).toEqual({ formula: "2d6", statistic: "Corpo" });
  });

  it("resolves Corpo from system.atributos.corpo.value", () => {
    const actor = { system: { atributos: { corpo: { value: 4 } } } };
    const result = etmosInitiativeFormula(makeCombatant(), actor);
    expect(result.formula).toBe("2d6 + 4");
    expect(result.tiebreaker).toBe(4);
    expect(result.statistic).toBe("Corpo");
  });

  it("defaults Corpo to 0 when the actor doc is malformed/missing atributos", () => {
    const result = etmosInitiativeFormula(makeCombatant(), {});
    expect(result.formula).toBe("2d6 + 0");
    expect(result.tiebreaker).toBe(0);
  });

  // M5-E audit FIX 2: Antagonista persists atributos as BARE integers
  // (systems/etmos/src/types.ts's AtributoAntagonistaSchema — no `.value`/
  // `.max` wrapper, unlike Orador's AtributoSchema), matching
  // antagonistaSheetVM.ts's `atributos` getter. Reading only `corpo.value`
  // silently rolled 2d6+0 with tiebreaker 0 for every Antagonista.
  it("resolves Corpo from a bare integer (Antagonista schema shape, not {value})", () => {
    const actor = { system: { atributos: { corpo: 5 } } };
    const result = etmosInitiativeFormula(makeCombatant(), actor);
    expect(result.formula).toBe("2d6 + 5");
    expect(result.tiebreaker).toBe(5);
    expect(result.statistic).toBe("Corpo");
  });

  it("Antagonista with Corpo 0 (schema allows 0, D2) still resolves 2d6 + 0 explicitly", () => {
    const actor = { system: { atributos: { corpo: 0 } } };
    const result = etmosInitiativeFormula(makeCombatant(), actor);
    expect(result.formula).toBe("2d6 + 0");
    expect(result.tiebreaker).toBe(0);
  });
});

describe("etmosInitiativeCompare — REQ-ETM-022 desempate (CA-7)", () => {
  it("higher total initiative wins regardless of player/NPC status", () => {
    const a = makeEntry({ total: 10, combatant: makeCombatant({ hasPlayerOwner: false }) });
    const b = makeEntry({ total: 5, combatant: makeCombatant({ hasPlayerOwner: true }) });
    expect(etmosInitiativeCompare(a, b)).toBeLessThan(0); // a sorts before b
  });

  it("tied total: player combatant beats NPC combatant", () => {
    const player = makeEntry({
      total: 8,
      tiebreaker: 2,
      combatant: makeCombatant({ hasPlayerOwner: true }),
    });
    const npc = makeEntry({
      total: 8,
      tiebreaker: 5,
      combatant: makeCombatant({ hasPlayerOwner: false }),
    });
    // NPC has HIGHER Corpo (tiebreaker), but player still wins per REQ-ETM-022 rule 2.
    expect(etmosInitiativeCompare(player, npc)).toBeLessThan(0); // player sorts before npc
    expect(etmosInitiativeCompare(npc, player)).toBeGreaterThan(0);
  });

  it("tied total, both player (or both NPC): higher Corpo wins", () => {
    const highCorpo = makeEntry({
      total: 8,
      tiebreaker: 5,
      combatant: makeCombatant({ hasPlayerOwner: true, _id: "high" }),
    });
    const lowCorpo = makeEntry({
      total: 8,
      tiebreaker: 2,
      combatant: makeCombatant({ hasPlayerOwner: true, _id: "low" }),
    });
    expect(etmosInitiativeCompare(highCorpo, lowCorpo)).toBeLessThan(0);
  });

  it("fully tied (total, hasPlayerOwner, Corpo) -> 0 (stable fallback)", () => {
    const a = makeEntry({
      total: 8,
      tiebreaker: 3,
      combatant: makeCombatant({ hasPlayerOwner: true }),
    });
    const b = makeEntry({
      total: 8,
      tiebreaker: 3,
      combatant: makeCombatant({ hasPlayerOwner: true }),
    });
    expect(etmosInitiativeCompare(a, b)).toBe(0);
  });

  it("null total sorts after any numeric total", () => {
    const rolled = makeEntry({ total: 3, combatant: makeCombatant({ hasPlayerOwner: false }) });
    const notRolled = makeEntry({
      total: null,
      combatant: makeCombatant({ hasPlayerOwner: true }),
    });
    expect(etmosInitiativeCompare(rolled, notRolled)).toBeLessThan(0);
  });

  // M5-E audit FIX 2: end-to-end roll -> compare using an Antagonista's bare-
  // integer Corpo shape. Before the fix, both Antagonistas' tiebreaker was
  // silently 0 regardless of their real Corpo, breaking rule 3 of the
  // desempate order.
  it("tied total, both NPC (Antagonista bare-integer schema shape): higher Corpo wins via compare", () => {
    const highCorpoActor = { system: { atributos: { corpo: 5 } } };
    const lowCorpoActor = { system: { atributos: { corpo: 1 } } };

    const highRoll = etmosInitiativeFormula(makeCombatant({ _id: "high" }), highCorpoActor);
    const lowRoll = etmosInitiativeFormula(makeCombatant({ _id: "low" }), lowCorpoActor);
    expect(highRoll.tiebreaker).toBe(5);
    expect(lowRoll.tiebreaker).toBe(1);

    const high = makeEntry({
      total: 8,
      tiebreaker: highRoll.tiebreaker,
      combatant: makeCombatant({ hasPlayerOwner: false, _id: "high" }),
    });
    const low = makeEntry({
      total: 8,
      tiebreaker: lowRoll.tiebreaker,
      combatant: makeCombatant({ hasPlayerOwner: false, _id: "low" }),
    });
    expect(etmosInitiativeCompare(high, low)).toBeLessThan(0);
  });
});

describe("etmosInitiativeFormulaRegistration — M5-A {roll, compare} shape", () => {
  it("exposes both roll and compare for registrar.initiativeFormula", () => {
    expect(etmosInitiativeFormulaRegistration.roll).toBe(etmosInitiativeFormula);
    expect(etmosInitiativeFormulaRegistration.compare).toBe(etmosInitiativeCompare);
  });
});

describe("etmosSystem — registered initiative formula reaches the server (M5-E)", () => {
  it("registers 'etmos' in combat.initiativeFormulas and combat.initiativeCompares", () => {
    // Real production wiring path: defineSystem → registrar.registerInitiativeFormula
    // → SystemModule.combat.{initiativeFormulas,initiativeCompares} — the SAME maps
    // registerSystemFormulas (server/combat/system-formula-adapter.ts) reads to build
    // the InitiativeFormula the engine's sortCombatants actually uses (REQ-ETM-022, CA-7).
    expect(etmosSystem.combat.initiativeFormulas.get("etmos")).toBe(etmosInitiativeFormula);
    expect(etmosSystem.combat.initiativeCompares.get("etmos")).toBe(etmosInitiativeCompare);
  });
});
