/**
 * oradorSheetVM.test.ts — Unit tests for OradorSheetVM.
 *
 * Tests are 100% headless (no PIXI, no Svelte, no browser APIs).
 * REQ-ETM-006..014, REQ-ETM-042/043.
 */

import { describe, it, expect } from "vitest";
import { OradorSheetVM } from "../oradorSheetVM.js";
import { OwnershipLevel } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOrador(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "orador-001",
    name: "Aiva",
    img: "img/aiva.webp",
    type: "orador",
    items: [
      {
        _id: "part-et",
        type: "particula",
        name: "Et",
        system: {
          slug: "et",
          palavra_etmos: "Et",
          categoria: "funcao",
          significado: "Controlar",
          nivel_grimorio: null,
          subtipo_complemento: null,
          icone_runico: null,
        },
      },
      {
        _id: "part-imu",
        type: "particula",
        name: "Imu",
        system: {
          slug: "imu",
          palavra_etmos: "Imu",
          categoria: "objeto",
          significado: "Mente",
          nivel_grimorio: null,
          subtipo_complemento: null,
          icone_runico: null,
        },
      },
      {
        _id: "part-ag",
        type: "particula",
        name: "Ag",
        system: {
          slug: "ag",
          palavra_etmos: "Ag",
          categoria: "complemento",
          significado: "Conectar",
          nivel_grimorio: 2,
          subtipo_complemento: "criador",
          icone_runico: null,
        },
      },
      {
        _id: "not-a-particula",
        type: "habilidade",
        name: "Alguma Habilidade",
        system: {},
      },
    ],
    system: {
      player_name: "Jogador X",
      ano_escolar: "9º ano",
      idade: 14,
      nivel: 2,
      especie: "Humano",
      mundo_origem: "mundano",
      atributos: {
        corpo: { value: 3, max: 6 },
        alma: { value: 4, max: 6 },
        mente: { value: 5, max: 6 },
      },
      ferimentos: { atual: 1, limite: 5 },
      estresse: { atual: 2, limite: 8 },
      fadiga: { estado: "normal" },
      complexidade_maxima: "complexa",
      dados_empenho: { atual: 3 },
      totem: { possui: true, rank: 2 },
      marcos_crescimento: {
        fisicos: { value: 1, max: 5 },
        mentais: { value: 0, max: 5 },
        emocionais: { value: 2, max: 5 },
      },
      conceito: {
        basico: "Estudante curiosa",
        aparencia: "Cabelo ruivo",
        pontos_importancia: "Sua avó",
        futuro: "Ser cientista",
        valores: [],
      },
    },
    ...overrides,
  };
}

function makeVM(
  docOverrides: Record<string, unknown> = {},
  opts: { ownership?: number; isGm?: boolean; userId?: string } = {},
): OradorSheetVM {
  return new OradorSheetVM({
    doc: makeOrador(docOverrides),
    actorId: "orador-001",
    ownership: opts.ownership ?? OwnershipLevel.OWNER,
    userId: opts.userId ?? "user-1",
    isGm: opts.isGm ?? false,
  });
}

// ---------------------------------------------------------------------------
// Basic fields
// ---------------------------------------------------------------------------

describe("OradorSheetVM — basic fields", () => {
  it("reads name/img", () => {
    const vm = makeVM();
    expect(vm.name).toBe("Aiva");
    expect(vm.img).toBe("img/aiva.webp");
  });

  it("falls back to defaults when name/img missing", () => {
    const vm = makeVM({ name: undefined, img: undefined });
    expect(vm.name).toBe("Orador");
    expect(vm.img).toBeNull();
  });

  it("reads basic info fields", () => {
    const vm = makeVM();
    expect(vm.nivel).toBe(2);
    expect(vm.especie).toBe("Humano");
    expect(vm.mundoOrigem).toBe("mundano");
    expect(vm.playerName).toBe("Jogador X");
    expect(vm.anoEscolar).toBe("9º ano");
    expect(vm.idade).toBe(14);
  });

  it("defaults mundoOrigem to mundano for any non-fantastico value", () => {
    const vm = makeVM({
      system: { ...(makeOrador()["system"] as object), mundo_origem: "invalid" },
    });
    expect(vm.mundoOrigem).toBe("mundano");
  });
});

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

describe("OradorSheetVM — permission", () => {
  it("is editable for OWNER", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OWNER, isGm: false });
    expect(vm.editable).toBe(true);
  });

  it("is editable for GM regardless of ownership", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.NONE, isGm: true });
    expect(vm.editable).toBe(true);
  });

  it("is NOT editable for OBSERVER non-GM", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.editable).toBe(false);
  });

  it("fieldUpdate returns null when not editable", () => {
    const vm = makeVM({}, { ownership: OwnershipLevel.OBSERVER, isGm: false });
    expect(vm.fieldUpdate("system.idade", 20)).toBeNull();
    expect(vm.applyFerimentosDelta(1)).toBeNull();
    expect(vm.applyEstresseDelta(1)).toBeNull();
    expect(vm.resetDadosEmpenho()).toBeNull();
    expect(vm.applyDadosEmpenhoDelta(1)).toBeNull();
    expect(vm.setTemTotem(true)).toBeNull();
    expect(vm.setRankTotem(3)).toBeNull();
    expect(vm.setAtributo("corpo", 5)).toBeNull();
    expect(vm.setMarcoValue("fisicos", 3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Atributos — 3 trilhas 1..6
// ---------------------------------------------------------------------------

describe("OradorSheetVM — atributos", () => {
  it("exposes the 3 trilhas in order corpo/alma/mente", () => {
    const vm = makeVM();
    expect(vm.atributos).toEqual([
      { slug: "corpo", value: 3, max: 6 },
      { slug: "alma", value: 4, max: 6 },
      { slug: "mente", value: 5, max: 6 },
    ]);
  });

  it("atributo(slug) reads a single trilha", () => {
    const vm = makeVM();
    expect(vm.atributo("mente")).toEqual({ slug: "mente", value: 5, max: 6 });
  });

  it("setAtributo clamps to [1,6] (D2: Orador min 1, no 0)", () => {
    const vm = makeVM();
    expect(vm.setAtributo("corpo", 0)).toEqual({
      type: "doc:update",
      documentType: "Actor",
      id: "orador-001",
      diff: { "system.atributos.corpo.value": 1 },
    });
    expect(vm.setAtributo("corpo", 9)).toEqual({
      type: "doc:update",
      documentType: "Actor",
      id: "orador-001",
      diff: { "system.atributos.corpo.value": 6 },
    });
    expect(vm.setAtributo("corpo", 3.7)).toEqual({
      type: "doc:update",
      documentType: "Actor",
      id: "orador-001",
      diff: { "system.atributos.corpo.value": 4 },
    });
  });
});

// ---------------------------------------------------------------------------
// Derivados READ-ONLY (never recomputed — server DeriveSteps own these)
// ---------------------------------------------------------------------------

describe("OradorSheetVM — derivados (read-only)", () => {
  it("reads ferimentos/estresse/complexidadeMaxima/estadoFadiga verbatim from doc", () => {
    const vm = makeVM();
    expect(vm.ferimentos).toEqual({ atual: 1, limite: 5 });
    expect(vm.estresse).toEqual({ atual: 2, limite: 8 });
    expect(vm.complexidadeMaxima).toBe("complexa");
    expect(vm.estadoFadiga).toBe("normal");
  });

  it("does NOT recompute derivados even if atributos would imply a different value", () => {
    // Mente 5 would derive to "complexa" per complexidadeMaxima() in systems/etmos,
    // but the VM must read the server-written field verbatim, not recompute.
    const vm = makeVM({
      system: {
        ...(makeOrador()["system"] as Record<string, unknown>),
        complexidade_maxima: "milagre", // deliberately mismatched with mente=5
      },
    });
    expect(vm.complexidadeMaxima).toBe("milagre");
  });

  it("falls back to sensible defaults when derivados are missing", () => {
    const vm = makeVM({
      system: { atributos: { corpo: { value: 1 }, alma: { value: 1 }, mente: { value: 1 } } },
    });
    expect(vm.ferimentos).toEqual({ atual: 0, limite: 4 });
    expect(vm.estresse).toEqual({ atual: 0, limite: 5 });
    expect(vm.complexidadeMaxima).toBe("regular");
    expect(vm.estadoFadiga).toBe("normal");
  });
});

// ---------------------------------------------------------------------------
// Trackers ops
// ---------------------------------------------------------------------------

describe("OradorSheetVM — tracker ops", () => {
  it("applyFerimentosDelta clamps to [0, limite]", () => {
    const vm = makeVM();
    expect(vm.applyFerimentosDelta(1)).toEqual({
      type: "doc:update",
      documentType: "Actor",
      id: "orador-001",
      diff: { "system.ferimentos.atual": 2 },
    });
    expect(vm.applyFerimentosDelta(-5)).toEqual({
      type: "doc:update",
      documentType: "Actor",
      id: "orador-001",
      diff: { "system.ferimentos.atual": 0 },
    });
    expect(vm.applyFerimentosDelta(100)).toEqual({
      type: "doc:update",
      documentType: "Actor",
      id: "orador-001",
      diff: { "system.ferimentos.atual": 5 },
    });
  });

  it("applyEstresseDelta is NOT clamped to limite (can exceed for Fadiga escalation)", () => {
    const vm = makeVM();
    const op = vm.applyEstresseDelta(100);
    expect(op?.diff["system.estresse.atual"]).toBe(102);
  });

  it("applyEstresseDelta clamps at 0 minimum", () => {
    const vm = makeVM();
    expect(vm.applyEstresseDelta(-100)).toEqual({
      type: "doc:update",
      documentType: "Actor",
      id: "orador-001",
      diff: { "system.estresse.atual": 0 },
    });
  });

  it("resetDadosEmpenho sets to 0 (R7 manual 'novo dia' button)", () => {
    const vm = makeVM();
    expect(vm.resetDadosEmpenho()).toEqual({
      type: "doc:update",
      documentType: "Actor",
      id: "orador-001",
      diff: { "system.dados_empenho.atual": 0 },
    });
  });

  it("applyDadosEmpenhoDelta clamps at 0 minimum", () => {
    const vm = makeVM();
    expect(vm.applyDadosEmpenhoDelta(-100)?.diff["system.dados_empenho.atual"]).toBe(0);
    expect(vm.applyDadosEmpenhoDelta(1)?.diff["system.dados_empenho.atual"]).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Totem
// ---------------------------------------------------------------------------

describe("OradorSheetVM — totem", () => {
  it("reads temTotem/rankTotem", () => {
    const vm = makeVM();
    expect(vm.temTotem).toBe(true);
    expect(vm.rankTotem).toBe(2);
  });

  it("setRankTotem clamps to [0,5]", () => {
    const vm = makeVM();
    expect(vm.setRankTotem(-1)?.diff["system.totem.rank"]).toBe(0);
    expect(vm.setRankTotem(9)?.diff["system.totem.rank"]).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Marcos
// ---------------------------------------------------------------------------

describe("OradorSheetVM — marcos", () => {
  it("reads marcos tracks", () => {
    const vm = makeVM();
    expect(vm.marcos).toEqual({
      fisicos: { value: 1, max: 5 },
      mentais: { value: 0, max: 5 },
      emocionais: { value: 2, max: 5 },
    });
  });

  it("setMarcoValue clamps to [0, max]", () => {
    const vm = makeVM();
    expect(vm.setMarcoValue("fisicos", -1)?.diff["system.marcos_crescimento.fisicos.value"]).toBe(
      0,
    );
    expect(vm.setMarcoValue("fisicos", 99)?.diff["system.marcos_crescimento.fisicos.value"]).toBe(
      5,
    );
  });
});

// ---------------------------------------------------------------------------
// Conceito
// ---------------------------------------------------------------------------

describe("OradorSheetVM — conceito", () => {
  it("reads all conceito fields", () => {
    const vm = makeVM();
    expect(vm.conceitoBasico).toBe("Estudante curiosa");
    expect(vm.conceitoAparencia).toBe("Cabelo ruivo");
    expect(vm.conceitoPontosImportancia).toBe("Sua avó");
    expect(vm.conceitoFuturo).toBe("Ser cientista");
  });
});

// ---------------------------------------------------------------------------
// Grimório
// ---------------------------------------------------------------------------

describe("OradorSheetVM — grimorio", () => {
  it("groups embedded particula items by categoria", () => {
    const vm = makeVM();
    const g = vm.grimorio;
    expect(g.funcao).toHaveLength(1);
    expect(g.funcao[0]?.slug).toBe("et");
    expect(g.objeto).toHaveLength(1);
    expect(g.objeto[0]?.slug).toBe("imu");
    expect(g.complemento).toHaveLength(1);
    expect(g.complemento[0]?.slug).toBe("ag");
    expect(g.complemento[0]?.nivelGrimorio).toBe(2);
    expect(g.complemento[0]?.subtipoComplemento).toBe("criador");
    expect(g.caracteristica).toHaveLength(0);
  });

  it("ignores non-particula embedded items", () => {
    const vm = makeVM();
    const all = [
      ...vm.grimorio.funcao,
      ...vm.grimorio.objeto,
      ...vm.grimorio.caracteristica,
      ...vm.grimorio.complemento,
    ];
    expect(all.some((p) => p.slug === "")).toBe(false);
    expect(all).toHaveLength(3);
  });

  it("grimorioSlugs returns the Set of all known slugs", () => {
    const vm = makeVM();
    expect(vm.grimorioSlugs).toEqual(new Set(["et", "imu", "ag"]));
  });

  it("hasParticulas is true when Grimório is non-empty", () => {
    const vm = makeVM();
    expect(vm.hasParticulas).toBe(true);
  });

  it("hasParticulas is false and grimorio groups are empty for an actor with no items", () => {
    const vm = makeVM({ items: [] });
    expect(vm.hasParticulas).toBe(false);
    expect(vm.grimorio).toEqual({ funcao: [], objeto: [], caracteristica: [], complemento: [] });
    expect(vm.grimorioSlugs.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Compositor window key
// ---------------------------------------------------------------------------

describe("OradorSheetVM — compositor singleton key", () => {
  it("builds a stable per-actor singleton key", () => {
    const vm = makeVM();
    expect(vm.compositorSingletonKey).toBe("compositor:orador-001");
  });
});
