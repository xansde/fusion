/**
 * statusModel.test.ts — the small decisions of the status strip (BAR-F1-04; spec 53 REQ-BAR-027,
 * REQ-BAR-038; prototype `.ab-state`).
 *
 * Hit points colour by how much is left (the prototype's thresholds), the MAP of the next attack is
 * written with the typographic minus, and the conditions on the strip are listed by id. All display
 * data (D-15): nothing here decides what the actor may do. (The portrait is the app's `ActorPortrait`.)
 */

import { describe, expect, it } from "vitest";

import {
  conditionIdsOf,
  formatMapPenalty,
  hpPercent,
  hpTone,
  tempPercent,
} from "../statusModel.js";

describe("hpPercent / tempPercent — a barra de PV", () => {
  it("é a fração do máximo, entre 0 e 100", () => {
    expect(hpPercent(27, 33)).toBeCloseTo(81.82, 1);
    expect(hpPercent(33, 33)).toBe(100);
    expect(hpPercent(0, 33)).toBe(0);
  });

  it("PV acima do máximo (temporário não conta aqui) e PV negativo ficam dentro da barra", () => {
    expect(hpPercent(40, 33)).toBe(100);
    expect(hpPercent(-4, 33)).toBe(0);
  });

  it("máximo zero ou ausente: a barra vazia, nunca NaN", () => {
    expect(hpPercent(5, 0)).toBe(0);
    expect(hpPercent(5, -1)).toBe(0);
    expect(hpPercent(Number.NaN, 10)).toBe(0);
  });

  it("os temporários ocupam o que sobra da barra, sem passar dela", () => {
    expect(tempPercent(3, 33, 81.82)).toBeCloseTo(9.09, 1);
    expect(tempPercent(30, 33, 81.82)).toBeCloseTo(18.18, 1);
    expect(tempPercent(0, 33, 50)).toBe(0);
    expect(tempPercent(5, 0, 0)).toBe(0);
  });
});

describe("hpTone — a cor pelo que sobra (limiares do protótipo)", () => {
  it("até 25% é perigo; até 50% é aviso; acima é saudável", () => {
    expect(hpTone(100)).toBe("success");
    expect(hpTone(51)).toBe("success");
    expect(hpTone(50)).toBe("warning");
    expect(hpTone(26)).toBe("warning");
    expect(hpTone(25)).toBe("danger");
    expect(hpTone(0)).toBe("danger");
  });
});

describe("formatMapPenalty — o MAP do próximo ataque (REQ-BAR-038)", () => {
  it("zero é 0; os outros levam o sinal de menos tipográfico", () => {
    expect(formatMapPenalty(0)).toBe("0");
    expect(formatMapPenalty(-5)).toBe("−5");
    expect(formatMapPenalty(-10)).toBe("−10");
  });
});

describe("conditionIdsOf — as condições que estão na faixa", () => {
  it("são os ids dos chips, na ordem", () => {
    expect(conditionIdsOf({ conditions: [{ id: "frightened" }, { id: "hidden" }] })).toEqual([
      "frightened",
      "hidden",
    ]);
    expect(conditionIdsOf({ conditions: [] })).toEqual([]);
  });

  it("um status que veio sem a lista (provedor que quebrou o contrato) não tem condições, e não derruba a barra", () => {
    expect(conditionIdsOf({})).toEqual([]);
    expect(conditionIdsOf({ conditions: undefined })).toEqual([]);
  });
});
