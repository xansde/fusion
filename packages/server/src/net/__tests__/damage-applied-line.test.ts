import { describe, expect, it } from "vitest";
import type { DamageAppliedTarget } from "@fusion/shared";
import { formatDamageAppliedLine } from "../redaction.js";

function target(byType: Array<{ type: string; amount: number }>): DamageAppliedTarget {
  return {
    name: "Alvo",
    total: byType.reduce((n, b) => n + b.amount, 0),
    byType,
  } as unknown as DamageAppliedTarget;
}

describe("formatDamageAppliedLine", () => {
  it("says each damage type in pt-BR, like the card does", () => {
    expect(formatDamageAppliedLine(target([{ type: "fire", amount: 1 }]))).toBe(
      "Alvo sofreu 1 de dano (1 de fogo)",
    );
  });

  it("joins several types and leaves an unknown one as it came", () => {
    expect(
      formatDamageAppliedLine(
        target([
          { type: "slashing", amount: 5 },
          { type: "astral", amount: 2 },
        ]),
      ),
    ).toBe("Alvo sofreu 7 de dano (5 de cortante + 2 de astral)");
  });
});

describe("formatDamageAppliedLine — cura e PV temporários (fechamento 22/10)", () => {
  // Ao vivo: "Curar" gravou "Ilse Tanner sofreu 0 de dano (0 de healing)" no chat, ao lado do card que dizia
  // "recuperou 0 de PV". A linha diz o que o card diz.
  it("a cura recupera PV, não sofre dano", () => {
    expect(formatDamageAppliedLine(target([{ type: "healing", amount: 12 }]))).toBe(
      "Alvo recuperou 12 de PV",
    );
  });

  it("PV temporários são ganhos", () => {
    expect(formatDamageAppliedLine(target([{ type: "temp-hp", amount: 5 }]))).toBe(
      "Alvo ganhou 5 de PV temporário",
    );
  });

  it("dano sem tipo é dito em pt-BR", () => {
    expect(formatDamageAppliedLine(target([{ type: "untyped", amount: 3 }]))).toBe(
      "Alvo sofreu 3 de dano (3 de sem tipo)",
    );
  });
});
