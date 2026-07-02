/**
 * @fusion/system-etmos — montarFrase() golden fixture tests.
 *
 * The 8 valid golden fixtures G1-G8 from docs/design/m5-etmos-compositor.md
 * §5, verified against the SRD by hand. Each asserts the EXACT
 * `frase_completa` string the design doc specifies.
 *
 * REQ-ETM-NFR-001 (pure, testable in isolation), REQ-ETM-027, CA-8.
 */
import { describe, it, expect } from "vitest";
import { montarFrase } from "../montar-frase.js";
import type { FraseMagicaSystem } from "../../schemas/item-frase-magica.js";
import { resolvePalavraFixture } from "./fixtures.js";

type Slots = Pick<
  FraseMagicaSystem,
  "funcao_slug" | "objeto_slugs" | "caracteristica_slugs" | "criadores" | "modificador_slugs"
>;

function slots(partial: Partial<Slots>): Slots {
  return {
    funcao_slug: "",
    objeto_slugs: [],
    caracteristica_slugs: [],
    criadores: [],
    modificador_slugs: [],
    ...partial,
  };
}

describe("montarFrase — golden fixtures (design doc §5)", () => {
  it("G1: Et + Imu -> Etimu (frase mínima, exemplo fundacional do SRD)", () => {
    const result = montarFrase(
      slots({ funcao_slug: "et", objeto_slugs: ["imu"] }),
      resolvePalavraFixture,
    );
    expect(result).toBe("Etimu");
  });

  it("G2: Ev + Eli + Quan -> Eveli Quan (encher copo d'água)", () => {
    const result = montarFrase(
      slots({ funcao_slug: "ev", objeto_slugs: ["eli"], caracteristica_slugs: ["quan"] }),
      resolvePalavraFixture,
    );
    expect(result).toBe("Eveli Quan");
  });

  it("G3: Ev + Eli + Ada-Quan -> Eveli adaQuan (criar estacas de gelo, Ada- nível 3)", () => {
    const result = montarFrase(
      slots({
        funcao_slug: "ev",
        objeto_slugs: ["eli"],
        caracteristica_slugs: ["quan"],
        criadores: [{ slug: "ada", alvo: 0 }],
      }),
      resolvePalavraFixture,
    );
    expect(result).toBe("Eveli adaQuan");
  });

  it("G4: Al + Ayu + Quan+Ag+Aer -> Alayu QuanAgAer (dia ensolarado vira nebuloso, Ag nível 2)", () => {
    const result = montarFrase(
      slots({
        funcao_slug: "al",
        objeto_slugs: ["ayu"],
        caracteristica_slugs: ["quan", "aer"],
        criadores: [{ slug: "ag", alvo: [0, 1] }],
      }),
      resolvePalavraFixture,
    );
    expect(result).toBe("Alayu QuanAgAer");
  });

  it("G5: Ar + Imu + No-Tum -> Arimu noTum (impedir alguém de pensar, No- nível 3)", () => {
    const result = montarFrase(
      slots({
        funcao_slug: "ar",
        objeto_slugs: ["imu"],
        caracteristica_slugs: ["tum"],
        criadores: [{ slug: "no", alvo: 0 }],
      }),
      resolvePalavraFixture,
    );
    expect(result).toBe("Arimu noTum");
  });

  it("G6: Un + Imu + Mut-Exa -> Unimu Mutexa (controlar armadura pela mente, Mut- prefixa Objeto, nível 3)", () => {
    const result = montarFrase(
      slots({
        funcao_slug: "un",
        objeto_slugs: ["imu"],
        // Mut- prefixes an Objeto used as Característica — the target Objeto's
        // slug ("exa") lives in caracteristica_slugs per the schema's design.
        caracteristica_slugs: ["exa"],
        criadores: [{ slug: "mut", alvo: 0 }],
      }),
      resolvePalavraFixture,
    );
    expect(result).toBe("Unimu Mutexa");
  });

  it("G7: Em + Ivi + Ast + Mor -> Emivi Ast Mor (correr muito mais rápido)", () => {
    const result = montarFrase(
      slots({
        funcao_slug: "em",
        objeto_slugs: ["ivi"],
        caracteristica_slugs: ["ast"],
        modificador_slugs: ["mor"],
      }),
      resolvePalavraFixture,
    );
    expect(result).toBe("Emivi Ast Mor");
  });

  it("G8: An + Ivi + Phys + Itam -> Anivi Phys Itam (curar ferimentos ao sofrê-los, Itam nível 4)", () => {
    const result = montarFrase(
      slots({
        funcao_slug: "an",
        objeto_slugs: ["ivi"],
        caracteristica_slugs: ["phys"],
        modificador_slugs: ["itam"],
      }),
      resolvePalavraFixture,
    );
    expect(result).toBe("Anivi Phys Itam");
  });

  it("fusion never happens beyond the núcleo (Função + first Objeto)", () => {
    // Regression guard for R4 (design doc §7): every word after the núcleo
    // must remain a SEPARATE token in the output, never glued further.
    const result = montarFrase(
      slots({ funcao_slug: "ev", objeto_slugs: ["eli", "imu"] }),
      resolvePalavraFixture,
    );
    expect(result).toBe("Eveli Imu");
  });
});
