/**
 * @fusion/system-etmos — Reação por rodada tests (REQ-ETM-023).
 */
import { describe, it, expect } from "vitest";
import { hasAgilidadeMental, maxReacoes, resetReacoes, usarReacao } from "../reacao.js";

function actorWithItems(items: Record<string, unknown>[]): Record<string, unknown> {
  return { name: "Test Orador", type: "orador", items };
}

describe("hasAgilidadeMental", () => {
  it("false for an actor with no items", () => {
    expect(hasAgilidadeMental(actorWithItems([]))).toBe(false);
  });

  it("false when items array is missing entirely", () => {
    expect(hasAgilidadeMental({ name: "X" })).toBe(false);
  });

  it("false for a habilidade item with a different name", () => {
    const actor = actorWithItems([{ type: "habilidade", name: "Enganar" }]);
    expect(hasAgilidadeMental(actor)).toBe(false);
  });

  it("true for an embedded 'Agilidade Mental' habilidade item", () => {
    const actor = actorWithItems([
      { type: "habilidade", name: "Enganar" },
      { type: "habilidade", name: "Agilidade Mental" },
    ]);
    expect(hasAgilidadeMental(actor)).toBe(true);
  });

  it("ignores a non-habilidade item that happens to share the name", () => {
    const actor = actorWithItems([{ type: "particula", name: "Agilidade Mental" }]);
    expect(hasAgilidadeMental(actor)).toBe(false);
  });
});

describe("maxReacoes — REQ-ETM-023", () => {
  it("1 by default (no Agilidade Mental)", () => {
    expect(maxReacoes(actorWithItems([]))).toBe(1);
  });

  it("1 when actorDoc is null", () => {
    expect(maxReacoes(null)).toBe(1);
  });

  it("2 with Agilidade Mental", () => {
    const actor = actorWithItems([{ type: "habilidade", name: "Agilidade Mental" }]);
    expect(maxReacoes(actor)).toBe(2);
  });
});

describe("resetReacoes", () => {
  it("returns { atual: max, max } for max=1", () => {
    expect(resetReacoes(1)).toEqual({ atual: 1, max: 1 });
  });

  it("returns { atual: max, max } for max=2", () => {
    expect(resetReacoes(2)).toEqual({ atual: 2, max: 2 });
  });
});

describe("usarReacao — REQ-ETM-023", () => {
  it("spends one Reação from a fresh max=1 state, no cost trigger", () => {
    const result = usarReacao(resetReacoes(1));
    expect(result.permitido).toBe(true);
    expect(result.state).toEqual({ atual: 0, max: 1 });
    expect(result.segundaReacaoComCusto).toBe(false);
  });

  it("rejects spending past zero (max=1)", () => {
    const spent = usarReacao(resetReacoes(1)).state;
    const result = usarReacao(spent);
    expect(result.permitido).toBe(false);
    expect(result.state).toEqual(spent); // unchanged
  });

  it("max=2: first spend has no cost trigger", () => {
    const result = usarReacao(resetReacoes(2));
    expect(result.permitido).toBe(true);
    expect(result.state).toEqual({ atual: 1, max: 2 });
    expect(result.segundaReacaoComCusto).toBe(false);
  });

  it("max=2: second spend (1 -> 0) DOES trigger the +3 Estresse cost signal", () => {
    const afterFirst = usarReacao(resetReacoes(2)).state;
    const result = usarReacao(afterFirst);
    expect(result.permitido).toBe(true);
    expect(result.state).toEqual({ atual: 0, max: 2 });
    expect(result.segundaReacaoComCusto).toBe(true);
  });

  it("max=2: rejects spending a third time", () => {
    const afterFirst = usarReacao(resetReacoes(2)).state;
    const afterSecond = usarReacao(afterFirst).state;
    const result = usarReacao(afterSecond);
    expect(result.permitido).toBe(false);
    expect(result.segundaReacaoComCusto).toBe(false);
  });
});
