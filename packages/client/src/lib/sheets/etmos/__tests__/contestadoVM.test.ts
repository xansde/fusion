/**
 * contestadoVM.test.ts — Unit tests for the Teste Contestado op builder
 * (REQ-ETM-021, CA-6). Headless — no PIXI/Svelte/browser APIs.
 */
import { describe, it, expect } from "vitest";
import { buildContestadoOp, formulaParaAtributo } from "../contestadoVM.js";

describe("formulaParaAtributo", () => {
  it("builds the 2d6 + @atributos.<attr>.value formula for each Atributo", () => {
    expect(formulaParaAtributo("corpo")).toBe("2d6 + @atributos.corpo.value");
    expect(formulaParaAtributo("alma")).toBe("2d6 + @atributos.alma.value");
    expect(formulaParaAtributo("mente")).toBe("2d6 + @atributos.mente.value");
  });
});

describe("buildContestadoOp", () => {
  it("builds a valid EtmosTesteContestadoOp with the acting side flagged as provocador", () => {
    const op = buildContestadoOp({
      meuActorId: "actor-1",
      meuAtributo: "corpo",
      oponenteActorId: "actor-2",
      oponenteBonus: 3,
    });
    expect(op).toEqual({
      type: "etmos:teste:contestado",
      a: { actorId: "actor-1", formula: "2d6 + @atributos.corpo.value", provocador: true },
      b: { actorId: "actor-2", formula: "2d6 + 3", provocador: false },
    });
  });

  it("allows a null oponenteActorId for an ad-hoc/manual NPC", () => {
    const op = buildContestadoOp({
      meuActorId: "actor-1",
      meuAtributo: "alma",
      oponenteActorId: null,
      oponenteBonus: 2,
    });
    expect(op.b.actorId).toBeNull();
    expect(op.b.formula).toBe("2d6 + 2");
  });

  it("includes descricao only when non-empty", () => {
    const withDesc = buildContestadoOp({
      meuActorId: "a",
      meuAtributo: "mente",
      oponenteActorId: null,
      oponenteBonus: 0,
      descricao: "  Disputa de vontades  ",
    });
    expect(withDesc.descricao).toBe("Disputa de vontades");

    const withoutDesc = buildContestadoOp({
      meuActorId: "a",
      meuAtributo: "mente",
      oponenteActorId: null,
      oponenteBonus: 0,
      descricao: "   ",
    });
    expect(withoutDesc.descricao).toBeUndefined();
  });

  it("truncates a fractional oponenteBonus to an integer formula", () => {
    const op = buildContestadoOp({
      meuActorId: "a",
      meuAtributo: "corpo",
      oponenteActorId: null,
      oponenteBonus: 2.7,
    });
    expect(op.b.formula).toBe("2d6 + 2");
  });
});
