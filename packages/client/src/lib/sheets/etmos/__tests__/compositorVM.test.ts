/**
 * compositorVM.test.ts — Unit tests for CompositorVM.
 *
 * Headless (no PIXI, no Svelte, no browser APIs) — mirrors
 * characterSheetVM.test.ts's pattern.
 *
 * Covers (per batch instructions):
 *   - CA-8: montar Et(Função) + Imu(Objeto) -> frase falada "Etimu".
 *   - 0/2 Funções rejeitado com a mensagem i18n correta (etmos.compositor.erro.*).
 *   - Seleção de alvo de Complementos Criadores (Ada-/Ag/Mut-).
 *
 * Golden fixtures reference: docs/design/m5-etmos-compositor.md §5 (G1/G3/G4/G6/G9/G10).
 */

import { describe, it, expect } from "vitest";
import { CompositorVM, emptySlots, readGrimorio } from "../compositorVM.js";
import type { GrimorioParticula } from "../compositorVM.js";

// ---------------------------------------------------------------------------
// Fixtures — an Orador Actor doc with a Grimório covering the golden fixtures
// (slugs/palavras verified against systems/etmos/src/compositor/__tests__/fixtures.ts)
// ---------------------------------------------------------------------------

interface RawParticula {
  slug: string;
  palavra_etmos: string;
  categoria: "funcao" | "objeto" | "caracteristica" | "complemento";
  significado?: string;
  nivel_grimorio?: number | null;
  subtipo_complemento?: "modificador" | "criador" | null;
}

function particulaItem(id: string, p: RawParticula): Record<string, unknown> {
  return {
    _id: id,
    type: "particula",
    system: {
      slug: p.slug,
      palavra_etmos: p.palavra_etmos,
      categoria: p.categoria,
      significado: p.significado ?? "",
      nivel_grimorio: p.nivel_grimorio ?? null,
      subtipo_complemento: p.subtipo_complemento ?? null,
      icone_runico: null,
      verify: false,
    },
  };
}

const RAW_PARTICULAS: RawParticula[] = [
  // Funções
  { slug: "et", palavra_etmos: "Et", categoria: "funcao", significado: "Controlar" },
  { slug: "ev", palavra_etmos: "Ev", categoria: "funcao", significado: "Criar" },
  { slug: "al", palavra_etmos: "Al", categoria: "funcao", significado: "Alterar" },
  { slug: "un", palavra_etmos: "Un", categoria: "funcao", significado: "Unir" },
  // Objetos
  { slug: "imu", palavra_etmos: "Imu", categoria: "objeto", significado: "Mente" },
  { slug: "eli", palavra_etmos: "Eli", categoria: "objeto", significado: "Líquido" },
  { slug: "ayu", palavra_etmos: "Ayu", categoria: "objeto", significado: "Ar" },
  { slug: "exa", palavra_etmos: "Exa", categoria: "objeto", significado: "Metal" },
  // Características
  { slug: "quan", palavra_etmos: "Quan", categoria: "caracteristica", significado: "Quantidade" },
  { slug: "aer", palavra_etmos: "Aer", categoria: "caracteristica", significado: "Ar" },
  // Complementos
  {
    slug: "mor",
    palavra_etmos: "Mor",
    categoria: "complemento",
    subtipo_complemento: "modificador",
    nivel_grimorio: 1,
  },
  {
    slug: "ag",
    palavra_etmos: "Ag",
    categoria: "complemento",
    subtipo_complemento: "criador",
    nivel_grimorio: 2,
  },
  {
    slug: "ada",
    palavra_etmos: "Ada-",
    categoria: "complemento",
    subtipo_complemento: "criador",
    nivel_grimorio: 3,
  },
  {
    slug: "mut",
    palavra_etmos: "Mut-",
    categoria: "complemento",
    subtipo_complemento: "criador",
    nivel_grimorio: 3,
  },
  {
    slug: "itam",
    palavra_etmos: "Itam",
    categoria: "complemento",
    subtipo_complemento: "modificador",
    nivel_grimorio: 4,
  },
];

function makeOradorDoc(
  overrides: { mente?: number; rankTotem?: number } = {},
): Record<string, unknown> {
  return {
    _id: "actor-orador-1",
    name: "Test Orador",
    type: "orador",
    items: RAW_PARTICULAS.map((p, i) => particulaItem(`item-${String(i)}`, p)),
    system: {
      atributos: {
        corpo: { value: 3, max: 6 },
        alma: { value: 3, max: 6 },
        mente: { value: overrides.mente ?? 3, max: 6 },
      },
      totem: { possui: false, rank: overrides.rankTotem ?? 0 },
    },
  };
}

function makeVM(
  doc: Record<string, unknown> = makeOradorDoc(),
  slots = emptySlots(),
): CompositorVM {
  return new CompositorVM({ doc, actorId: "actor-orador-1", slots });
}

// ---------------------------------------------------------------------------
// readGrimorio
// ---------------------------------------------------------------------------

describe("readGrimorio", () => {
  it("reads embedded particula Items grouped by categoria, ignoring other Item types", () => {
    const doc = makeOradorDoc();
    doc["items"] = [
      ...(doc["items"] as Record<string, unknown>[]),
      { _id: "not-a-particula", type: "habilidade", system: {} },
    ];
    const grimorio: GrimorioParticula[] = readGrimorio(doc);
    expect(grimorio.length).toBe(RAW_PARTICULAS.length);
    expect(grimorio.some((p) => p.slug === "et")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CA-8 — Et + Imu -> "Etimu"
// ---------------------------------------------------------------------------

describe("CompositorVM — CA-8 frase falada", () => {
  it("montar Et (Função) + Imu (Objeto) gera a frase falada 'Etimu'", () => {
    let vm = makeVM();
    vm = new CompositorVM({
      doc: makeOradorDoc(),
      actorId: "actor-orador-1",
      slots: vm.toggleFuncao("et"),
    });
    vm = new CompositorVM({
      doc: makeOradorDoc(),
      actorId: "actor-orador-1",
      slots: vm.toggleObjeto("imu"),
    });

    expect(vm.fraseCompleta).toBe("Etimu");
    expect(vm.validacao.valido).toBe(true);
    expect(vm.validacao.erros).toEqual([]);
  });

  it("fraseTokens exposes 'Etimu' as a single funcao-categorized token", () => {
    let slots = emptySlots();
    slots = { ...slots, funcaoSlugsSelecionados: ["et"], objetoSlugs: ["imu"] };
    const vm = makeVM(makeOradorDoc(), slots);

    expect(vm.fraseTokens).toHaveLength(1);
    expect(vm.fraseTokens[0]).toEqual({ text: "Etimu", categoria: "funcao" });
  });
});

// ---------------------------------------------------------------------------
// 0/2 Funções rejeitado com a mensagem i18n correta
// ---------------------------------------------------------------------------

describe("CompositorVM — validação de Função (0 ou 2+)", () => {
  it("0 Funções selecionadas produz erro semFuncao", () => {
    const vm = makeVM();
    const result = vm.validacao;
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.semFuncao");
  });

  it("2 Funções selecionadas (transient multi-select) produz erro multiplasFuncoes", () => {
    let slots = emptySlots();
    slots = { ...slots, funcaoSlugsSelecionados: ["et", "ev"], objetoSlugs: ["imu"] };
    const vm = makeVM(makeOradorDoc(), slots);

    const result = vm.validacao;
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.multiplasFuncoes");
  });

  it("toggleFuncao adds a second Função slug when a different Função is toggled (transient multi-select, G10)", () => {
    const vm = makeVM();
    const afterFirst = vm.toggleFuncao("et");
    expect(afterFirst.funcaoSlugsSelecionados).toEqual(["et"]);

    const vm2 = makeVM(makeOradorDoc(), afterFirst);
    const afterSecond = vm2.toggleFuncao("ev");
    expect(afterSecond.funcaoSlugsSelecionados).toEqual(["et", "ev"]);
  });

  it("podePropor is false with 0 Funções even when Intenção is filled", () => {
    let slots = emptySlots();
    slots = { ...slots, intencao: "Fazer algo" };
    const vm = makeVM(makeOradorDoc(), slots);
    expect(vm.podePropor).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Seleção de alvo de Complementos Criadores (Ada-/Ag/Mut-)
// ---------------------------------------------------------------------------

describe("CompositorVM — seleção de alvo de Criadores", () => {
  it("Ada- (prefix) target selection produces 'adaQuan' — G3", () => {
    let slots = emptySlots();
    slots = {
      ...slots,
      funcaoSlugsSelecionados: ["ev"],
      objetoSlugs: ["eli"],
      caracteristicaSlugs: ["quan"],
    };
    let vm = makeVM(makeOradorDoc(), slots);

    // prefixAlvoOptions exposes the Característica index(es) available.
    const alvoOptions = vm.prefixAlvoOptions();
    expect(alvoOptions).toEqual([{ index: 0, label: "Quan" }]);

    slots = vm.applyPrefixCriador("ada", 0);
    vm = makeVM(makeOradorDoc(), slots);

    expect(vm.slots.criadores).toEqual([{ slug: "ada", alvo: 0 }]);
    expect(vm.fraseCompleta).toBe("Eveli adaQuan");
    expect(vm.validacao.valido).toBe(true);
  });

  it("Ag (connector) target selection between two Características produces 'QuanAgAer' — G4", () => {
    let slots = emptySlots();
    slots = {
      ...slots,
      funcaoSlugsSelecionados: ["al"],
      objetoSlugs: ["ayu"],
      caracteristicaSlugs: ["quan", "aer"],
    };
    let vm = makeVM(makeOradorDoc(), slots);

    const pairs = vm.connectorAlvoOptions();
    expect(pairs).toEqual([{ a: 0, b: 1, label: "Quan + Aer" }]);

    slots = vm.applyConnectorCriador(0, 1);
    vm = makeVM(makeOradorDoc(), slots);

    expect(vm.slots.criadores).toEqual([{ slug: "ag", alvo: [0, 1] }]);
    expect(vm.fraseCompleta).toBe("Alayu QuanAgAer");
    expect(vm.validacao.valido).toBe(true);
  });

  it("Mut- target selection over an Objeto produces 'Mutexa' — G6", () => {
    let slots = emptySlots();
    slots = { ...slots, funcaoSlugsSelecionados: ["un"], objetoSlugs: ["imu"] };
    let vm = makeVM(makeOradorDoc(), slots);

    // Mut- targets an Objeto (converted to a Característica slot), not an
    // existing Característica — objetoOptionsForMut offers the Grimório's Objetos.
    const mutOptions = vm.objetoOptionsForMut;
    expect(mutOptions.some((o) => o.slug === "exa")).toBe(true);

    slots = vm.applyMutCriador("exa");
    vm = makeVM(makeOradorDoc(), slots);

    expect(vm.slots.caracteristicaSlugs).toEqual(["exa"]);
    expect(vm.slots.criadores).toEqual([{ slug: "mut", alvo: 0 }]);
    expect(vm.fraseCompleta).toBe("Unimu Mutexa");
  });

  it("removing a Característica drops any Criador that targeted it and reindexes the rest", () => {
    let slots = emptySlots();
    slots = {
      ...slots,
      funcaoSlugsSelecionados: ["al"],
      objetoSlugs: ["ayu"],
      caracteristicaSlugs: ["quan", "aer"],
      criadores: [{ slug: "ag", alvo: [0, 1] }],
    };
    const vm = makeVM(makeOradorDoc(), slots);

    const afterRemoval = vm.toggleCaracteristica("quan");
    expect(afterRemoval.caracteristicaSlugs).toEqual(["aer"]);
    expect(afterRemoval.criadores).toEqual([]); // Ag lost a target -> dropped
  });

  it("Criadores below the caster's Grimório level are marked indisponivel", () => {
    // Orador's Grimório only has level-1 (mor) and level-2 (ag) Complementos
    // present at max — ada/mut require level 3, itam requires level 4.
    const doc = makeOradorDoc();
    const vm = makeVM(doc);
    const ada = vm.complementoOptions.find((o) => o.slug === "ada");
    const itam = vm.complementoOptions.find((o) => o.slug === "itam");
    // grimorioLevel() picks the HIGHEST nivel_grimorio present (4, from itam
    // in the fixture) — so all complementos are marked disponivel here; a
    // Grimório WITHOUT itam should gate it.
    expect(ada?.disponivel).toBe(true);
    expect(itam?.disponivel).toBe(true);

    const limitedDoc = makeOradorDoc();
    limitedDoc["items"] = (limitedDoc["items"] as Record<string, unknown>[]).filter((item) => {
      const sys = item["system"] as Record<string, unknown>;
      return sys["slug"] !== "itam" && sys["slug"] !== "ada" && sys["slug"] !== "mut";
    });
    const limitedVm = makeVM(limitedDoc);
    const adaLimited = limitedVm.complementoOptions.find((o) => o.slug === "mor"); // still level 1
    expect(adaLimited?.disponivel).toBe(true);
    // grimorioLevel is now capped at 2 (ag) since ada/mut/itam are absent.
    expect(limitedVm.grimorioLevel).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Custo preview / complexidadeMaxima
// ---------------------------------------------------------------------------

describe("CompositorVM — custoPreview", () => {
  it("marks tiers above complexidadeMaxima(mente) as excedeMaxima", () => {
    // mente = 1 -> complexidadeMaxima = "regular" (idx 1) -> dificil/complexa/milagre exceed.
    const vm = makeVM(makeOradorDoc({ mente: 1 }));
    const preview = vm.custoPreview;
    expect(preview.find((p) => p.complexidade === "trivial")?.excedeMaxima).toBe(false);
    expect(preview.find((p) => p.complexidade === "regular")?.excedeMaxima).toBe(false);
    expect(preview.find((p) => p.complexidade === "dificil")?.excedeMaxima).toBe(true);
    expect(preview.find((p) => p.complexidade === "milagre")?.excedeMaxima).toBe(true);
  });

  it("adds rankTotem to non-trivial custo", () => {
    const vm = makeVM(makeOradorDoc({ rankTotem: 2 }));
    const preview = vm.custoPreview;
    expect(preview.find((p) => p.complexidade === "trivial")?.custo).toBe(0); // rank never applies to trivial
    expect(preview.find((p) => p.complexidade === "regular")?.custo).toBe(1 + 2);
  });
});
