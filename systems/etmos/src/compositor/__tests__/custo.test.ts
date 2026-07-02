/**
 * @fusion/system-etmos — custo.ts (Tabelas A-D) tests.
 *
 * Covers limiteFerimentos/limiteEstresse/complexidadeMaxima/estadoFadiga for
 * the full attribute range 1-6 (Tabelas B/C/A/D of packs-src/tabelas.json,
 * verified against spec 19 CA-1/CA-2/CA-3), plus custoEstresse including the
 * G7b golden fixture (rank de Totem, REQ-ETM-043/CA-12).
 */
import { describe, it, expect } from "vitest";
import {
  limiteFerimentos,
  limiteEstresse,
  complexidadeMaxima,
  custoEstresse,
  estadoFadiga,
} from "../custo.js";

describe("limiteFerimentos — Tabela B (REQ-ETM-007, CA-1/CA-2)", () => {
  it.each([
    [1, 4],
    [2, 5],
    [3, 5],
    [4, 6],
    [5, 6],
    [6, 7],
  ])("Corpo %i -> Limite de Ferimentos %i", (corpo, expected) => {
    expect(limiteFerimentos(corpo)).toBe(expected);
  });

  it("CA-2: Corpo 1->6 recalcula Limite de Ferimentos 4->7", () => {
    expect(limiteFerimentos(1)).toBe(4);
    expect(limiteFerimentos(6)).toBe(7);
  });
});

describe("limiteEstresse — Tabela C (REQ-ETM-008, CA-1/CA-2)", () => {
  it.each([
    [1, 5],
    [2, 6],
    [3, 7],
    [4, 8],
    [5, 9],
    [6, 10],
  ])("Alma %i -> Limite de Estresse %i", (alma, expected) => {
    expect(limiteEstresse(alma)).toBe(expected);
  });

  it("CA-2: Alma 1->6 recalcula Limite de Estresse 5->10", () => {
    expect(limiteEstresse(1)).toBe(5);
    expect(limiteEstresse(6)).toBe(10);
  });
});

describe("complexidadeMaxima — Tabela A (REQ-ETM-009, CA-1)", () => {
  it.each([
    [1, "regular"],
    [2, "regular"],
    [3, "dificil"],
    [4, "dificil"],
    [5, "complexa"],
    [6, "milagre"],
  ] as const)("Mente %i -> Complexidade Máxima %s", (mente, expected) => {
    expect(complexidadeMaxima(mente)).toBe(expected);
  });
});

describe("estadoFadiga — Tabela D (REQ-ETM-010, CA-3)", () => {
  it("d <= 0 -> normal", () => {
    expect(estadoFadiga(0, 5)).toBe("normal");
    expect(estadoFadiga(5, 5)).toBe("normal");
    expect(estadoFadiga(0, 0)).toBe("normal");
  });

  it("1 <= d <= 5 -> cansado", () => {
    expect(estadoFadiga(6, 5)).toBe("cansado"); // d=1
    expect(estadoFadiga(10, 5)).toBe("cansado"); // d=5
  });

  it("6 <= d <= 8 -> exausto", () => {
    expect(estadoFadiga(11, 5)).toBe("exausto"); // d=6
    expect(estadoFadiga(13, 5)).toBe("exausto"); // d=8
  });

  it("d > 8 -> esgotado", () => {
    expect(estadoFadiga(14, 5)).toBe("esgotado"); // d=9
    expect(estadoFadiga(100, 5)).toBe("esgotado");
  });
});

describe("custoEstresse — Tabela A + Rank de Totem (REQ-ETM-024/043, CA-12)", () => {
  it.each([
    ["trivial", 0],
    ["regular", 1],
    ["dificil", 2],
    ["complexa", 4],
    ["milagre", 7],
  ] as const)("Complexidade %s, rank 0 -> custo %i", (complexidade, expected) => {
    expect(custoEstresse(complexidade, 0)).toBe(expected);
  });

  it("G7: Complexidade regular, rank 0 -> custo 1", () => {
    expect(custoEstresse("regular", 0)).toBe(1);
  });

  it("G7b: Complexidade regular, rank de Totem 2 -> custo 1 + 2 = 3", () => {
    expect(custoEstresse("regular", 2)).toBe(3);
  });

  it("Rank de Totem NÃO soma em magia Trivial (mesmo com Totem)", () => {
    expect(custoEstresse("trivial", 5)).toBe(0);
  });

  it("CA-12: Totem Rank 2 soma +2 Estresse numa magia não Trivial", () => {
    expect(custoEstresse("dificil", 2)).toBe(2 + 2);
  });

  it("rankTotem negativo é tratado como 0 (defensivo)", () => {
    expect(custoEstresse("regular", -3)).toBe(1);
  });
});
