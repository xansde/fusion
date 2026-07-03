/**
 * @fusion/system-etmos — Marcos de Crescimento + Tabela E progressão tests
 * (REQ-ETM-035..039, CA-11).
 */
import { describe, it, expect } from "vitest";
import {
  opcoesProgressao,
  trilhaCompleta,
  todasTrilhasCompletas,
  clampMarcoValue,
  confirmarSubidaDeNivel,
} from "../progressao.js";
import type { MarcosCrescimento, EscolhasSubidaNivel } from "../progressao.js";

function trilhas(overrides: Partial<MarcosCrescimento> = {}): MarcosCrescimento {
  const cheia = { value: 5, max: 5 };
  return { fisicos: cheia, mentais: cheia, emocionais: cheia, ...overrides };
}

const TODAS_ESCOLHIDAS: EscolhasSubidaNivel = { fisica: true, mental: true, emocional: true };

describe("opcoesProgressao — Tabela E (REQ-ETM-037)", () => {
  it.each([1, 2, 3, 4, 5])("returns a row for de_nivel %i -> para_nivel %i+1", (nivel) => {
    const opcao = opcoesProgressao(nivel);
    expect(opcao).not.toBeNull();
    expect(opcao?.deNivel).toBe(nivel);
    expect(opcao?.paraNivel).toBe(nivel + 1);
    expect(opcao?.fisica.length).toBeGreaterThan(0);
    expect(opcao?.mental.length).toBeGreaterThan(0);
    expect(opcao?.emocional.length).toBeGreaterThan(0);
  });

  it("returns null at nivel 6 (max, no further transition)", () => {
    expect(opcoesProgressao(6)).toBeNull();
  });

  it("nivel 1->2 mental option is a free Atributo point (Tabela E row 1)", () => {
    const opcao = opcoesProgressao(1);
    expect(opcao?.mental).toContain("Atributo");
  });

  it("nivel 5->6 grants two Habilidades emocionalmente (Tabela E row 5)", () => {
    const opcao = opcoesProgressao(5);
    expect(opcao?.emocional).toContain("Teórica");
    expect(opcao?.emocional).toContain("Prática");
  });
});

describe("trilhaCompleta / todasTrilhasCompletas — REQ-ETM-036/037", () => {
  it("a trilha at max is completa", () => {
    expect(trilhaCompleta({ value: 5, max: 5 })).toBe(true);
  });

  it("a trilha below max is not completa", () => {
    expect(trilhaCompleta({ value: 4, max: 5 })).toBe(false);
  });

  it("todasTrilhasCompletas is true only when all 3 are at max", () => {
    expect(todasTrilhasCompletas(trilhas())).toBe(true);
    expect(todasTrilhasCompletas(trilhas({ fisicos: { value: 4, max: 5 } }))).toBe(false);
    expect(todasTrilhasCompletas(trilhas({ mentais: { value: 0, max: 5 } }))).toBe(false);
  });
});

describe("clampMarcoValue", () => {
  it("clamps to [0, max]", () => {
    expect(clampMarcoValue(-1, 5)).toBe(0);
    expect(clampMarcoValue(6, 5)).toBe(5);
    expect(clampMarcoValue(3, 5)).toBe(3);
  });

  it("rounds fractional input", () => {
    expect(clampMarcoValue(2.6, 5)).toBe(3);
  });
});

describe("confirmarSubidaDeNivel — REQ-ETM-038/039, CA-11", () => {
  it("CA-11: caso completo de subida — increments nivel and resets all 3 trilhas", () => {
    const result = confirmarSubidaDeNivel(1, trilhas(), TODAS_ESCOLHIDAS);
    expect(result.ok).toBe(true);
    expect(result.novoNivel).toBe(2);
    expect(result.trilhasReiniciadas).toEqual({
      fisicos: { value: 0, max: 5 },
      mentais: { value: 0, max: 5 },
      emocionais: { value: 0, max: 5 },
    });
  });

  it("rejects when trilhas are not all completas", () => {
    const incompletas = trilhas({ fisicos: { value: 4, max: 5 } });
    const result = confirmarSubidaDeNivel(1, incompletas, TODAS_ESCOLHIDAS);
    expect(result.ok).toBe(false);
    expect(result.erro).toBe("trilhasIncompletas");
  });

  it("rejects at nivel 6 (max, nowhere to go)", () => {
    const result = confirmarSubidaDeNivel(6, trilhas(), TODAS_ESCOLHIDAS);
    expect(result.ok).toBe(false);
    expect(result.erro).toBe("nivelMaximo");
  });

  it("CA-11: rejeição de opção repetida — a categoria missing from escolhas is rejected", () => {
    const semFisica: EscolhasSubidaNivel = { fisica: false, mental: true, emocional: true };
    const result = confirmarSubidaDeNivel(1, trilhas(), semFisica);
    expect(result.ok).toBe(false);
    expect(result.erro).toBe("categoriaFaltando");
  });

  it("CA-11: after a successful subida, a SECOND confirm attempt (trilhas now reset/incomplete) is rejected", () => {
    const first = confirmarSubidaDeNivel(1, trilhas(), TODAS_ESCOLHIDAS);
    expect(first.ok).toBe(true);
    if (!first.ok || !first.trilhasReiniciadas) throw new Error("expected success");

    // Attempting to confirm AGAIN immediately (as if a double-click replayed
    // the op) against the now-reset trilhas must be rejected — the same
    // categoria's bônus cannot be granted twice in a row without re-filling
    // the trilhas (REQ-ETM-039).
    const second = confirmarSubidaDeNivel(2, first.trilhasReiniciadas, TODAS_ESCOLHIDAS);
    expect(second.ok).toBe(false);
    expect(second.erro).toBe("trilhasIncompletas");
  });

  it("walks the full N1->N6 progression sequentially", () => {
    let nivel = 1;
    let marcos = trilhas();
    for (let i = 0; i < 5; i++) {
      const result = confirmarSubidaDeNivel(nivel, marcos, TODAS_ESCOLHIDAS);
      expect(result.ok).toBe(true);
      if (!result.ok || result.novoNivel === undefined || !result.trilhasReiniciadas) {
        throw new Error("expected success");
      }
      nivel = result.novoNivel;
      // Re-fill trilhas to completa for the next iteration (simulates play).
      marcos = trilhas();
      void result.trilhasReiniciadas;
    }
    expect(nivel).toBe(6);
    // Nivel 6 has no further transition.
    expect(confirmarSubidaDeNivel(6, marcos, TODAS_ESCOLHIDAS).erro).toBe("nivelMaximo");
  });
});
