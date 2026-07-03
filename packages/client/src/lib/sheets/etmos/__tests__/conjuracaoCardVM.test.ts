/**
 * conjuracaoCardVM.test.ts — Unit tests for ConjuracaoCardVM.
 *
 * Headless. Covers button visibility per estado/role (design doc §3.4) and
 * op-builder payload shapes (mirrors packages/shared/src/etmos/protocol.ts
 * schemas 1:1).
 */

import { describe, it, expect } from "vitest";
import {
  ConjuracaoCardVM,
  resolveViewerRole,
  complexidadeParaNumero,
  numeroParaComplexidade,
} from "../conjuracaoCardVM.js";
import type { ConjuracaoCard } from "@fusion/system-etmos";

function makeCard(overrides: Partial<ConjuracaoCard> = {}): ConjuracaoCard {
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

describe("resolveViewerRole", () => {
  it("gm takes precedence over ownership", () => {
    expect(resolveViewerRole({ isGm: true, isOwnerOfConjurador: true })).toBe("gm");
  });
  it("owner without gm resolves to dono", () => {
    expect(resolveViewerRole({ isGm: false, isOwnerOfConjurador: true })).toBe("dono");
  });
  it("neither resolves to outro", () => {
    expect(resolveViewerRole({ isGm: false, isOwnerOfConjurador: false })).toBe("outro");
  });
});

describe("ConjuracaoCardVM — button visibility by estado/role", () => {
  it("proposta: GM sees Arbitrar/Recusar, dono sees Cancelar, outro sees nothing", () => {
    const card = makeCard({ estado: "proposta" });
    const gmVm = new ConjuracaoCardVM({ card, messageId: "m1", role: "gm" });
    expect(gmVm.podeArbitrar).toBe(true);
    expect(gmVm.podeRecusar).toBe(true);
    expect(gmVm.podeCancelar).toBe(true); // gm can also cancel
    expect(gmVm.podeRolar).toBe(false);
    expect(gmVm.podeResolver).toBe(false);

    const donoVm = new ConjuracaoCardVM({ card, messageId: "m1", role: "dono" });
    expect(donoVm.podeArbitrar).toBe(false);
    expect(donoVm.podeRecusar).toBe(false);
    expect(donoVm.podeCancelar).toBe(true);

    const outroVm = new ConjuracaoCardVM({ card, messageId: "m1", role: "outro" });
    expect(outroVm.podeArbitrar).toBe(false);
    expect(outroVm.podeCancelar).toBe(false);
    expect(outroVm.podeRolar).toBe(false);
  });

  it("arbitrada: dono/GM see Rolar and Cancelar", () => {
    const card = makeCard({ estado: "arbitrada", complexidade: "regular", custo_estresse: 1 });
    const donoVm = new ConjuracaoCardVM({ card, messageId: "m1", role: "dono" });
    expect(donoVm.podeRolar).toBe(true);
    expect(donoVm.podeCancelar).toBe(true);
    expect(donoVm.podeArbitrar).toBe(false);
  });

  it("rolada: only GM sees Resolver; nobody can Cancelar anymore", () => {
    const card = makeCard({ estado: "rolada", complexidade: "regular", custo_estresse: 1 });
    const gmVm = new ConjuracaoCardVM({ card, messageId: "m1", role: "gm" });
    expect(gmVm.podeResolver).toBe(true);
    expect(gmVm.podeCancelar).toBe(false);
    expect(gmVm.podeRolar).toBe(false);

    const donoVm = new ConjuracaoCardVM({ card, messageId: "m1", role: "dono" });
    expect(donoVm.podeResolver).toBe(false);
  });

  it("resolvida/recusada/cancelada are final — isFinal true, no actions", () => {
    for (const estado of ["resolvida", "recusada", "cancelada"] as const) {
      const card = makeCard({ estado });
      const gmVm = new ConjuracaoCardVM({ card, messageId: "m1", role: "gm" });
      expect(gmVm.isFinal).toBe(true);
      expect(gmVm.podeArbitrar).toBe(false);
      expect(gmVm.podeResolver).toBe(false);
      expect(gmVm.podeCancelar).toBe(false);
    }
  });
});

describe("ConjuracaoCardVM — REQ-ETM-026 excede_maxima advisory", () => {
  it("mostrarAvisoExcedeMaxima reflects card.excede_maxima", () => {
    const card = makeCard({ estado: "arbitrada", excede_maxima: true });
    const vm = new ConjuracaoCardVM({ card, messageId: "m1", role: "gm" });
    expect(vm.mostrarAvisoExcedeMaxima).toBe(true);
  });
});

describe("ConjuracaoCardVM — op builders match the shared protocol payload shape", () => {
  it("buildArbitrarOp", () => {
    const card = makeCard({ estado: "proposta" });
    const vm = new ConjuracaoCardVM({ card, messageId: "msg-42", role: "gm" });
    const op = vm.buildArbitrarOp({ complexidade: "regular", notasNarrador: "ok" });
    expect(op).toEqual({
      type: "etmos:conjuracao:arbitrar",
      messageId: "msg-42",
      complexidade: "regular",
      notasNarrador: "ok",
    });
  });

  it("buildRecusarOp sets recusar: true", () => {
    const card = makeCard({ estado: "proposta" });
    const vm = new ConjuracaoCardVM({ card, messageId: "msg-42", role: "gm" });
    const op = vm.buildRecusarOp("sem motivo");
    expect(op).toEqual({
      type: "etmos:conjuracao:arbitrar",
      messageId: "msg-42",
      recusar: true,
      notasNarrador: "sem motivo",
    });
  });

  it("buildRolarOp / buildResolverOp / buildCancelarOp", () => {
    const card = makeCard({ estado: "arbitrada" });
    const vm = new ConjuracaoCardVM({ card, messageId: "msg-7", role: "dono" });
    expect(vm.buildRolarOp()).toEqual({ type: "etmos:conjuracao:rolar", messageId: "msg-7" });
    expect(vm.buildResolverOp()).toEqual({ type: "etmos:conjuracao:resolver", messageId: "msg-7" });
    expect(vm.buildCancelarOp()).toEqual({ type: "etmos:conjuracao:cancelar", messageId: "msg-7" });
  });
});

describe("Complexidade <-> número (REQ-ETM-030 atalho de apresentação)", () => {
  it("round-trips 1..5", () => {
    for (let n = 1; n <= 5; n++) {
      const c = numeroParaComplexidade(n);
      expect(complexidadeParaNumero(c)).toBe(n);
    }
  });

  it("maps trivial=1 .. milagre=5", () => {
    expect(numeroParaComplexidade(1)).toBe("trivial");
    expect(numeroParaComplexidade(5)).toBe("milagre");
  });
});

describe("ConjuracaoCardVM — custoSugerido uses pure custoEstresse()", () => {
  it("computes custo including rankTotem for non-trivial Complexidade", () => {
    const card = makeCard({ estado: "proposta" });
    const vm = new ConjuracaoCardVM({ card, messageId: "m1", role: "gm", rankTotem: 2 });
    expect(vm.custoSugerido("regular")).toBe(1 + 2);
    expect(vm.custoSugerido("trivial")).toBe(0); // rank never applies to trivial
  });
});
