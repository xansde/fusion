/**
 * @fusion/system-etmos — conjuracao/state-machine.ts unit tests.
 *
 * Covers every valid edge of the diagram (design doc §2.7, spec 19 D5) plus
 * a representative set of rejected/invalid transitions (permission guards,
 * cancelling after rolada, skipping states).
 */
import { describe, it, expect } from "vitest";
import { podeTransicionar, aplicar } from "../state-machine.js";
import type { ConjuracaoCard } from "../../schemas/conjuracao-card.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function baseCard(overrides: Partial<ConjuracaoCard> = {}): ConjuracaoCard {
  return {
    estado: "proposta",
    conjurador_actor_id: "actor-1",
    frase: {
      funcao_slug: "et",
      objeto_slugs: ["imu"],
      caracteristica_slugs: [],
      criadores: [],
      modificador_slugs: [],
      intencao: "Curar um ferimento leve",
      frase_completa: "Etimu",
      complexidade: null,
      estresse_gerado: 0,
      favorita: false,
    },
    complexidade: null,
    custo_estresse: null,
    excede_maxima: false,
    notas_narrador: "",
    roll_message_id: null,
    dificuldade_alvo: null,
    sucesso: null,
    margem: null,
    classe_dificuldade: null,
    controle_fadiga: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

describe("podeTransicionar — valid edges", () => {
  it("propor: null -> proposta, dono", () => {
    expect(podeTransicionar(null, "proposta", "propor", { ator: "dono", jaRolou: false })).toBe(
      true,
    );
  });

  it("propor: null -> proposta, gm", () => {
    expect(podeTransicionar(null, "proposta", "propor", { ator: "gm", jaRolou: false })).toBe(true);
  });

  it("arbitrar: proposta -> arbitrada, gm only", () => {
    expect(
      podeTransicionar("proposta", "arbitrada", "arbitrar", { ator: "gm", jaRolou: false }),
    ).toBe(true);
  });

  it("recusar: proposta -> recusada, gm only", () => {
    expect(
      podeTransicionar("proposta", "recusada", "recusar", { ator: "gm", jaRolou: false }),
    ).toBe(true);
  });

  it("rolar: arbitrada -> rolada, dono", () => {
    expect(podeTransicionar("arbitrada", "rolada", "rolar", { ator: "dono", jaRolou: false })).toBe(
      true,
    );
  });

  it("rolar: arbitrada -> rolada, gm", () => {
    expect(podeTransicionar("arbitrada", "rolada", "rolar", { ator: "gm", jaRolou: false })).toBe(
      true,
    );
  });

  it("resolver: rolada -> resolvida, gm only", () => {
    expect(podeTransicionar("rolada", "resolvida", "resolver", { ator: "gm", jaRolou: true })).toBe(
      true,
    );
  });

  it("cancelar: proposta -> cancelada, dono, antes de rolar", () => {
    expect(
      podeTransicionar("proposta", "cancelada", "cancelar", { ator: "dono", jaRolou: false }),
    ).toBe(true);
  });

  it("cancelar: proposta -> cancelada, gm, antes de rolar", () => {
    expect(
      podeTransicionar("proposta", "cancelada", "cancelar", { ator: "gm", jaRolou: false }),
    ).toBe(true);
  });

  it("cancelar: arbitrada -> cancelada, dono, antes de rolar", () => {
    expect(
      podeTransicionar("arbitrada", "cancelada", "cancelar", { ator: "dono", jaRolou: false }),
    ).toBe(true);
  });

  it("cancelar: arbitrada -> cancelada, gm, antes de rolar", () => {
    expect(
      podeTransicionar("arbitrada", "cancelada", "cancelar", { ator: "gm", jaRolou: false }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invalid transitions — permission guards
// ---------------------------------------------------------------------------

describe("podeTransicionar — rejected: permission guards", () => {
  it("jogador (dono) NÃO pode arbitrar", () => {
    expect(
      podeTransicionar("proposta", "arbitrada", "arbitrar", { ator: "dono", jaRolou: false }),
    ).toBe(false);
  });

  it("jogador (dono) NÃO pode recusar", () => {
    expect(
      podeTransicionar("proposta", "recusada", "recusar", { ator: "dono", jaRolou: false }),
    ).toBe(false);
  });

  it("jogador (dono) NÃO pode resolver", () => {
    expect(
      podeTransicionar("rolada", "resolvida", "resolver", { ator: "dono", jaRolou: true }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Invalid transitions — state guards
// ---------------------------------------------------------------------------

describe("podeTransicionar — rejected: state/sequencing guards", () => {
  it("cancelar depois de rolada (jaRolou=true) é rejeitado, mesmo para o GM", () => {
    expect(podeTransicionar("rolada", "cancelada", "cancelar", { ator: "gm", jaRolou: true })).toBe(
      false,
    );
  });

  it("cancelar depois de resolvida é rejeitado", () => {
    expect(
      podeTransicionar("resolvida", "cancelada", "cancelar", { ator: "gm", jaRolou: true }),
    ).toBe(false);
  });

  it("rolar direto de proposta (pulando arbitrada) é rejeitado", () => {
    expect(podeTransicionar("proposta", "rolada", "rolar", { ator: "dono", jaRolou: false })).toBe(
      false,
    );
  });

  it("resolver direto de arbitrada (pulando rolada) é rejeitado", () => {
    expect(
      podeTransicionar("arbitrada", "resolvida", "resolver", { ator: "gm", jaRolou: false }),
    ).toBe(false);
  });

  it("arbitrar um card já arbitrado (arbitrada -> arbitrada) é rejeitado", () => {
    expect(
      podeTransicionar("arbitrada", "arbitrada", "arbitrar", { ator: "gm", jaRolou: false }),
    ).toBe(false);
  });

  it("recusar um card já arbitrado é rejeitado (recusar só a partir de proposta)", () => {
    expect(
      podeTransicionar("arbitrada", "recusada", "recusar", { ator: "gm", jaRolou: false }),
    ).toBe(false);
  });

  it("propor quando já existe card (de != null) é rejeitado", () => {
    expect(
      podeTransicionar("proposta", "proposta", "propor", { ator: "dono", jaRolou: false }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// aplicar — pure reducer
// ---------------------------------------------------------------------------

describe("aplicar", () => {
  it("arbitrar grava complexidade/custo_estresse/notas_narrador e transiciona", () => {
    const card = baseCard();
    const next = aplicar(card, "arbitrar", {
      complexidade: "regular",
      custo_estresse: 1,
      notas_narrador: "Uso simples de cura.",
    });

    expect(next.estado).toBe("arbitrada");
    expect(next.complexidade).toBe("regular");
    expect(next.custo_estresse).toBe(1);
    expect(next.notas_narrador).toBe("Uso simples de cura.");
    // original untouched (purity)
    expect(card.estado).toBe("proposta");
    expect(card.complexidade).toBeNull();
  });

  it("recusar transiciona sem exigir payload extra", () => {
    const card = baseCard();
    const next = aplicar(card, "recusar");
    expect(next.estado).toBe("recusada");
  });

  it("rolar grava sucesso/margem/classe_dificuldade/roll_message_id", () => {
    const card = baseCard({ estado: "arbitrada", complexidade: "regular", custo_estresse: 1 });
    const next = aplicar(card, "rolar", {
      roll_message_id: "msg-1",
      dificuldade_alvo: 7,
      sucesso: true,
      margem: 2,
      classe_dificuldade: "mediano",
    });

    expect(next.estado).toBe("rolada");
    expect(next.roll_message_id).toBe("msg-1");
    expect(next.sucesso).toBe(true);
    expect(next.margem).toBe(2);
    expect(next.classe_dificuldade).toBe("mediano");
  });

  it("resolver transiciona para resolvida, preservando campos já gravados", () => {
    const card = baseCard({
      estado: "rolada",
      complexidade: "regular",
      custo_estresse: 1,
      sucesso: true,
      margem: 2,
    });
    const next = aplicar(card, "resolver");
    expect(next.estado).toBe("resolvida");
    expect(next.custo_estresse).toBe(1);
    expect(next.sucesso).toBe(true);
  });

  it("cancelar transiciona para cancelada sem tocar em custo", () => {
    const card = baseCard({ estado: "arbitrada", complexidade: "regular", custo_estresse: 1 });
    const next = aplicar(card, "cancelar");
    expect(next.estado).toBe("cancelada");
    // custo_estresse untouched — cancelamento nunca aplica custo (REQ-ETM-033)
    expect(next.custo_estresse).toBe(1);
  });

  it("aplicar nunca muta o objeto original (imutabilidade)", () => {
    const card = baseCard();
    const frozen = JSON.parse(JSON.stringify(card)) as ConjuracaoCard;
    aplicar(card, "arbitrar", { complexidade: "dificil" });
    expect(card).toEqual(frozen);
  });
});
