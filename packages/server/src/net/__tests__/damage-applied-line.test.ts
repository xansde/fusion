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
