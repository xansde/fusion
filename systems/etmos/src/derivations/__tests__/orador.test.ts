/**
 * @fusion/system-etmos — Orador DeriveSteps tests.
 *
 * Runs each DeriveStep's `run(doc)` directly (no engine/topo-sort needed for
 * unit coverage) and checks the written derived fields for the full
 * attribute range 1-6 (Tabelas B/C/A/D), matching CA-1/CA-2/CA-3.
 *
 * REQ-ETM-007..010, REQ-ETM-NFR-001.
 */
import { describe, it, expect } from "vitest";
import {
  stepOradorLimiteFerimentos,
  stepOradorLimiteEstresse,
  stepOradorComplexidadeMaxima,
  stepOradorFadiga,
  ORADOR_DERIVE_STEPS,
} from "../orador.js";

function makeDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    system: {
      atributos: { corpo: { value: 1 }, alma: { value: 1 }, mente: { value: 1 } },
      ferimentos: { atual: 0, limite: 0 },
      estresse: { atual: 0, limite: 0 },
      fadiga: { estado: "normal" },
      complexidade_maxima: "regular",
      ...overrides,
    },
  };
}

describe("stepOradorLimiteFerimentos — Tabela B (REQ-ETM-007)", () => {
  it.each([
    [1, 4],
    [2, 5],
    [3, 5],
    [4, 6],
    [5, 6],
    [6, 7],
  ])("Corpo %i -> ferimentos.limite %i", (corpo, expected) => {
    const doc = makeDoc({ atributos: { corpo: { value: corpo } } });
    stepOradorLimiteFerimentos.run(doc, {} as never);
    const sys = doc["system"] as Record<string, unknown>;
    const ferimentos = sys["ferimentos"] as Record<string, unknown>;
    expect(ferimentos["limite"]).toBe(expected);
  });

  it("defaults Corpo to 1 when system.atributos is missing", () => {
    const doc: Record<string, unknown> = { system: {} };
    stepOradorLimiteFerimentos.run(doc, {} as never);
    const sys = doc["system"] as Record<string, unknown>;
    const ferimentos = sys["ferimentos"] as Record<string, unknown>;
    expect(ferimentos["limite"]).toBe(4); // limiteFerimentos(1)
  });
});

describe("stepOradorLimiteEstresse — Tabela C (REQ-ETM-008)", () => {
  it.each([
    [1, 5],
    [2, 6],
    [3, 7],
    [4, 8],
    [5, 9],
    [6, 10],
  ])("Alma %i -> estresse.limite %i", (alma, expected) => {
    const doc = makeDoc({ atributos: { alma: { value: alma } } });
    stepOradorLimiteEstresse.run(doc, {} as never);
    const sys = doc["system"] as Record<string, unknown>;
    const estresse = sys["estresse"] as Record<string, unknown>;
    expect(estresse["limite"]).toBe(expected);
  });
});

describe("stepOradorComplexidadeMaxima — Tabela A (REQ-ETM-009)", () => {
  it.each([
    [1, "regular"],
    [2, "regular"],
    [3, "dificil"],
    [4, "dificil"],
    [5, "complexa"],
    [6, "milagre"],
  ])("Mente %i -> complexidade_maxima %s", (mente, expected) => {
    const doc = makeDoc({ atributos: { mente: { value: mente } } });
    stepOradorComplexidadeMaxima.run(doc, {} as never);
    const sys = doc["system"] as Record<string, unknown>;
    expect(sys["complexidade_maxima"]).toBe(expected);
  });
});

describe("stepOradorFadiga — Tabela D (REQ-ETM-010)", () => {
  it("estresse.atual <= limite -> normal", () => {
    const doc = makeDoc({ estresse: { atual: 5, limite: 5 } });
    stepOradorFadiga.run(doc, {} as never);
    const sys = doc["system"] as Record<string, unknown>;
    const fadiga = sys["fadiga"] as Record<string, unknown>;
    expect(fadiga["estado"]).toBe("normal");
  });

  it("d in 1..5 -> cansado", () => {
    const doc = makeDoc({ estresse: { atual: 10, limite: 5 } });
    stepOradorFadiga.run(doc, {} as never);
    const sys = doc["system"] as Record<string, unknown>;
    const fadiga = sys["fadiga"] as Record<string, unknown>;
    expect(fadiga["estado"]).toBe("cansado");
  });

  it("d in 6..8 -> exausto", () => {
    const doc = makeDoc({ estresse: { atual: 13, limite: 5 } });
    stepOradorFadiga.run(doc, {} as never);
    const sys = doc["system"] as Record<string, unknown>;
    const fadiga = sys["fadiga"] as Record<string, unknown>;
    expect(fadiga["estado"]).toBe("exausto");
  });

  it("d > 8 -> esgotado", () => {
    const doc = makeDoc({ estresse: { atual: 20, limite: 5 } });
    stepOradorFadiga.run(doc, {} as never);
    const sys = doc["system"] as Record<string, unknown>;
    const fadiga = sys["fadiga"] as Record<string, unknown>;
    expect(fadiga["estado"]).toBe("esgotado");
  });
});

describe("ORADOR_DERIVE_STEPS — declared metadata sanity", () => {
  it("has exactly 4 steps, all Actor/orador/base", () => {
    expect(ORADOR_DERIVE_STEPS).toHaveLength(4);
    for (const step of ORADOR_DERIVE_STEPS) {
      expect(step.documentType).toBe("Actor");
      expect(step.subtypes).toEqual(["orador"]);
      expect(step.phase).toBe("base");
    }
  });

  it("fadiga step declares a read dependency on estresse.limite (topo-sort order)", () => {
    expect(stepOradorFadiga.reads).toContain("system.estresse.limite");
    expect(stepOradorLimiteEstresse.writes).toContain("system.estresse.limite");
  });

  it("all step ids are unique", () => {
    const ids = ORADOR_DERIVE_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
