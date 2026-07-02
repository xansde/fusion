/**
 * @fusion/system-etmos — degree.ts (D6 binary degree + classe de dificuldade) tests.
 *
 * REQ-ROL-038/039, REQ-ETM-019, D6 of spec 19.
 */
import { describe, it, expect } from "vitest";
import {
  computeDegreeOfSuccess,
  classeDificuldade,
  etmosDegreeOfSuccessDefinition,
} from "../degree.js";

describe("computeDegreeOfSuccess — binary success/failure + margem (D6)", () => {
  it("total >= dc -> success, margem = total - dc", () => {
    expect(computeDegreeOfSuccess(10, 7)).toEqual({ degree: "success", margem: 3 });
  });

  it("total == dc -> success (margem 0, meets exactly)", () => {
    expect(computeDegreeOfSuccess(7, 7)).toEqual({ degree: "success", margem: 0 });
  });

  it("total < dc -> failure, margem negativo", () => {
    expect(computeDegreeOfSuccess(5, 7)).toEqual({ degree: "failure", margem: -2 });
  });
});

describe("classeDificuldade — faixas narrativas (12b §3.4)", () => {
  it.each([
    [5, "simples"],
    [0, "simples"],
    [6, "facil"],
    [7, "mediano"],
    [10, "mediano"],
    [11, "arduo"],
    [14, "arduo"],
    [15, "dificil"],
    [30, "dificil"],
  ] as const)("total %i -> classe %s", (total, expected) => {
    expect(classeDificuldade(total)).toBe(expected);
  });
});

describe("etmosDegreeOfSuccessDefinition — DegreeOfSuccessDefinition adapter (M5-A E2)", () => {
  it("exposes a stable id for registrar.degreeOfSuccess", () => {
    expect(etmosDegreeOfSuccessDefinition.id).toBe("etmos.conjuracao");
  });

  it("compute() matches computeDegreeOfSuccess + carries classeDificuldade as meta", () => {
    const result = etmosDegreeOfSuccessDefinition.compute(10, 7);
    expect(result.degree).toBe("success");
    expect(result.meta).toEqual({ margem: 3, classeDificuldade: "mediano" });
  });
});
