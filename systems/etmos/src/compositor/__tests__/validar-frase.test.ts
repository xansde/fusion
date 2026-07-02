/**
 * @fusion/system-etmos — validarFrase() golden fixture tests.
 *
 * Golden fixtures G1-G10 from docs/design/m5-etmos-compositor.md §5,
 * verified against the SRD by hand: G1-G8 valid, G9/G10 invalid with the
 * exact i18n error keys the design doc specifies.
 *
 * REQ-ETM-NFR-001, REQ-ETM-028, REQ-ETM-051 (i18n keys, never raw prose), CA-8.
 */
import { describe, it, expect } from "vitest";
import { validarFrase, validarFuncaoUnica } from "../validar-frase.js";
import type { FraseMagicaSystem } from "../../schemas/item-frase-magica.js";
import { fullGrimorioFixture } from "./fixtures.js";

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

describe("validarFrase — golden fixtures (design doc §5)", () => {
  const grimorio = fullGrimorioFixture(4); // covers every Complemento level used by G1-G8

  it("G1: Et + Imu -> válida (frase mínima)", () => {
    const result = validarFrase(slots({ funcao_slug: "et", objeto_slugs: ["imu"] }), grimorio);
    expect(result.valido).toBe(true);
    expect(result.erros).toEqual([]);
  });

  it("G2: Ev + Eli + Quan -> válida", () => {
    const result = validarFrase(
      slots({ funcao_slug: "ev", objeto_slugs: ["eli"], caracteristica_slugs: ["quan"] }),
      grimorio,
    );
    expect(result.valido).toBe(true);
  });

  it("G3: Ev + Eli + Ada-Quan -> válida (Ada- exige Grimório nível 3)", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "ev",
        objeto_slugs: ["eli"],
        caracteristica_slugs: ["quan"],
        criadores: [{ slug: "ada", alvo: 0 }],
      }),
      grimorio,
    );
    expect(result.valido).toBe(true);
  });

  it("G3b: Ada- com Grimório nível 2 é insuficiente (nivelGrimorioInsuficiente)", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "ev",
        objeto_slugs: ["eli"],
        caracteristica_slugs: ["quan"],
        criadores: [{ slug: "ada", alvo: 0 }],
      }),
      fullGrimorioFixture(2),
    );
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.nivelGrimorioInsuficiente");
  });

  it("G4: Al + Ayu + Quan+Ag+Aer -> válida (Ag exige Grimório nível 2)", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "al",
        objeto_slugs: ["ayu"],
        caracteristica_slugs: ["quan", "aer"],
        criadores: [{ slug: "ag", alvo: [0, 1] }],
      }),
      grimorio,
    );
    expect(result.valido).toBe(true);
  });

  it("G5: Ar + Imu + No-Tum -> válida (No- exige Grimório nível 3)", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "ar",
        objeto_slugs: ["imu"],
        caracteristica_slugs: ["tum"],
        criadores: [{ slug: "no", alvo: 0 }],
      }),
      grimorio,
    );
    expect(result.valido).toBe(true);
  });

  it("G6: Un + Imu + Mut-Exa -> válida (Mut- prefixa Objeto como Característica, nível 3)", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "un",
        objeto_slugs: ["imu"],
        caracteristica_slugs: ["exa"],
        criadores: [{ slug: "mut", alvo: 0 }],
      }),
      grimorio,
    );
    expect(result.valido).toBe(true);
  });

  it("G7: Em + Ivi + Ast + Mor -> válida", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "em",
        objeto_slugs: ["ivi"],
        caracteristica_slugs: ["ast"],
        modificador_slugs: ["mor"],
      }),
      grimorio,
    );
    expect(result.valido).toBe(true);
  });

  it("G8: An + Ivi + Phys + Itam -> válida (Itam exige Grimório nível 4)", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "an",
        objeto_slugs: ["ivi"],
        caracteristica_slugs: ["phys"],
        modificador_slugs: ["itam"],
      }),
      grimorio,
    );
    expect(result.valido).toBe(true);
  });

  it("G8b: Itam com Grimório nível 3 é insuficiente", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "an",
        objeto_slugs: ["ivi"],
        caracteristica_slugs: ["phys"],
        modificador_slugs: ["itam"],
      }),
      fullGrimorioFixture(3),
    );
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.nivelGrimorioInsuficiente");
  });

  it("G9: sem Função -> inválida, erro semFuncao", () => {
    const result = validarFrase(slots({ objeto_slugs: ["imu"] }), grimorio);
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.semFuncao");
  });

  it("G10: múltiplas Funções (et, ev) -> inválida, erro multiplasFuncoes (via validarFuncaoUnica)", () => {
    // The persisted schema models funcao_slug as a single string, so the
    // "2 Funções selecionadas" case is exercised at the picker layer via
    // validarFuncaoUnica (see validar-frase.ts docstring) — this is the
    // UI-facing guard the Compositor calls BEFORE collapsing to one slug.
    const result = validarFuncaoUnica(["et", "ev"]);
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.multiplasFuncoes");
  });

  it("validarFuncaoUnica: 0 Funções -> semFuncao", () => {
    const result = validarFuncaoUnica([]);
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.semFuncao");
  });

  it("validarFuncaoUnica: exatamente 1 Função -> válida", () => {
    const result = validarFuncaoUnica(["et"]);
    expect(result.valido).toBe(true);
    expect(result.erros).toEqual([]);
  });
});

describe("validarFrase — regras estruturais adicionais (REQ-ETM-028)", () => {
  const grimorio = fullGrimorioFixture(4);

  it("rejeita 0 Objetos com erro semObjeto", () => {
    const result = validarFrase(slots({ funcao_slug: "et" }), grimorio);
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.semObjeto");
  });

  it("Partícula fora do Grimório -> particulaForaDoGrimorio", () => {
    const grimorioSemImu = {
      hasSlug: (slug: string) => slug !== "imu",
      grimorioLevel: 4,
    };
    const result = validarFrase(
      slots({ funcao_slug: "et", objeto_slugs: ["imu"] }),
      grimorioSemImu,
    );
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.particulaForaDoGrimorio");
  });

  it("Ag (connector) com apenas 1 alvo -> conectorAlvoInvalido", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "al",
        objeto_slugs: ["ayu"],
        caracteristica_slugs: ["quan", "aer"],
        criadores: [{ slug: "ag", alvo: 0 as unknown as [number, number] }],
      }),
      grimorio,
    );
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.conectorAlvoInvalido");
  });

  it("Ag com índices duplicados (mesmo índice duas vezes) -> conectorAlvoInvalido", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "al",
        objeto_slugs: ["ayu"],
        caracteristica_slugs: ["quan", "aer"],
        criadores: [{ slug: "ag", alvo: [0, 0] }],
      }),
      grimorio,
    );
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.conectorAlvoInvalido");
  });

  it("Ag com índice fora do range -> conectorAlvoInvalido", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "al",
        objeto_slugs: ["ayu"],
        caracteristica_slugs: ["quan"],
        criadores: [{ slug: "ag", alvo: [0, 5] }],
      }),
      grimorio,
    );
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.conectorAlvoInvalido");
  });

  it("Ada- (prefix) com índice fora do range -> alvoCriadorInvalido", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "ev",
        objeto_slugs: ["eli"],
        caracteristica_slugs: ["quan"],
        criadores: [{ slug: "ada", alvo: 3 }],
      }),
      grimorio,
    );
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.alvoCriadorInvalido");
  });

  it("duplicar Mor+Min é sintaticamente válido mas gera aviso, não erro", () => {
    const result = validarFrase(
      slots({
        funcao_slug: "em",
        objeto_slugs: ["ivi"],
        modificador_slugs: ["mor", "mor"],
      }),
      grimorio,
    );
    expect(result.valido).toBe(true);
    expect(result.avisos).toContain("etmos.compositor.aviso.modificadorDuplicado");
  });

  it("erros são sempre chaves i18n (nunca prosa crua)", () => {
    const result = validarFrase(slots({}), grimorio);
    for (const erro of result.erros) {
      expect(erro).toMatch(/^etmos\.compositor\.erro\./);
    }
  });
});
