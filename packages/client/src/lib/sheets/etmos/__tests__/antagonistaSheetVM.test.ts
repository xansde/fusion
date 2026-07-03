/**
 * antagonistaSheetVM.test.ts — Unit tests for AntagonistaSheetVM.
 *
 * Tests are 100% headless (no PIXI, no Svelte, no browser APIs).
 * REQ-ETM-002, REQ-ETM-049, REQ-ETM-050.
 */

import { describe, it, expect } from "vitest";
import { AntagonistaSheetVM } from "../antagonistaSheetVM.js";
import { OwnershipLevel } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAntagonista(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "antag-001",
    name: "Morto-Vivo Simples",
    img: "img/zumbi.webp",
    type: "antagonista",
    items: [],
    system: {
      ficha_base: "simples",
      ferimentos: { atual: 0, limite: 3 },
      estresse: { atual: 0, limite: 2 },
      complexidade_maxima: "regular",
      movimentacao: 4,
      comunicacao: false,
      atributos: { corpo: 2, alma: 0, mente: 0 },
      aptidoes: [{ nome: "Regeneração Lenta", descricao: "Cura 1 Ferimento por turno." }],
      ataques: [
        {
          nome: "Mordida",
          ferimentos: 2,
          defesa: "parcial",
          alcance: "curto",
          descricao: "Ataque básico.",
        },
        { nome: "Garra", ferimentos: null, defesa: null, alcance: "curto", descricao: "" },
      ],
    },
    ...overrides,
  };
}

function makeVM(
  docOverrides: Record<string, unknown> = {},
  opts: { ownership?: number; isGm?: boolean; userId?: string } = {},
): AntagonistaSheetVM {
  return new AntagonistaSheetVM({
    doc: makeAntagonista(docOverrides),
    actorId: "antag-001",
    ownership: opts.ownership ?? OwnershipLevel.NONE,
    userId: opts.userId ?? "gm-1",
    isGm: opts.isGm ?? true,
  });
}

// ---------------------------------------------------------------------------
// Basic fields
// ---------------------------------------------------------------------------

describe("AntagonistaSheetVM — basic fields", () => {
  it("reads name/img/fichaBase", () => {
    const vm = makeVM();
    expect(vm.name).toBe("Morto-Vivo Simples");
    expect(vm.img).toBe("img/zumbi.webp");
    expect(vm.fichaBase).toBe("simples");
  });

  it("falls back to defaults", () => {
    const vm = makeVM({ name: undefined, img: undefined, system: {} });
    expect(vm.name).toBe("Antagonista");
    expect(vm.img).toBeNull();
    expect(vm.fichaBase).toBe("simples");
  });
});

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

describe("AntagonistaSheetVM — permission", () => {
  it("editable for GM", () => {
    const vm = makeVM({}, { isGm: true, ownership: OwnershipLevel.NONE });
    expect(vm.editable).toBe(true);
  });

  it("editable for OWNER non-GM", () => {
    const vm = makeVM({}, { isGm: false, ownership: OwnershipLevel.OWNER });
    expect(vm.editable).toBe(true);
  });

  it("not editable for OBSERVER non-GM", () => {
    const vm = makeVM({}, { isGm: false, ownership: OwnershipLevel.OBSERVER });
    expect(vm.editable).toBe(false);
    expect(vm.fieldUpdate("system.movimentacao", 10)).toBeNull();
    expect(vm.addAptidao()).toBeNull();
    expect(vm.addAtaque()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Atributos — may be 0 (D2, unlike Orador)
// ---------------------------------------------------------------------------

describe("AntagonistaSheetVM — atributos podem ser 0", () => {
  it("reads bare-integer atributos (no {value,max} wrapper)", () => {
    const vm = makeVM();
    expect(vm.atributos).toEqual({ corpo: 2, alma: 0, mente: 0 });
  });

  it("setAtributo allows 0, clamps negative to 0, no upper clamp to 6 required by schema but VM keeps non-negative", () => {
    const vm = makeVM();
    expect(vm.setAtributo("alma", 0)?.diff["system.atributos.alma"]).toBe(0);
    expect(vm.setAtributo("alma", -5)?.diff["system.atributos.alma"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Editable statblock values (not derived)
// ---------------------------------------------------------------------------

describe("AntagonistaSheetVM — editable statblock", () => {
  it("reads ferimentos/estresse/complexidadeMaxima/movimentacao/comunicacao", () => {
    const vm = makeVM();
    expect(vm.ferimentos).toEqual({ atual: 0, limite: 3 });
    expect(vm.estresse).toEqual({ atual: 0, limite: 2 });
    expect(vm.complexidadeMaxima).toBe("regular");
    expect(vm.movimentacao).toBe(4);
    expect(vm.comunicacao).toBe(false);
  });

  it("setFerimentosLimite / setEstresseLimite / setComplexidadeMaxima are directly editable (fixed statblock, not derived)", () => {
    const vm = makeVM();
    expect(vm.setFerimentosLimite(10)?.diff["system.ferimentos.limite"]).toBe(10);
    expect(vm.setEstresseLimite(7)?.diff["system.estresse.limite"]).toBe(7);
    expect(vm.setComplexidadeMaxima("milagre")?.diff["system.complexidade_maxima"]).toBe("milagre");
  });

  it("applyFerimentosDelta clamps to [0, limite]", () => {
    const vm = makeVM();
    expect(vm.applyFerimentosDelta(10)?.diff["system.ferimentos.atual"]).toBe(3);
    expect(vm.applyFerimentosDelta(-10)?.diff["system.ferimentos.atual"]).toBe(0);
  });

  it("setFichaBase updates the enum", () => {
    const vm = makeVM();
    expect(vm.setFichaBase("avancada")?.diff["system.ficha_base"]).toBe("avancada");
  });
});

// ---------------------------------------------------------------------------
// Aptidões CRUD
// ---------------------------------------------------------------------------

describe("AntagonistaSheetVM — aptidoes", () => {
  it("reads aptidoes with index", () => {
    const vm = makeVM();
    expect(vm.aptidoes).toEqual([
      { index: 0, nome: "Regeneração Lenta", descricao: "Cura 1 Ferimento por turno." },
    ]);
  });

  it("addAptidao appends an empty entry", () => {
    const vm = makeVM();
    const op = vm.addAptidao();
    expect(op?.diff["system.aptidoes"]).toEqual([
      { nome: "Regeneração Lenta", descricao: "Cura 1 Ferimento por turno." },
      { nome: "", descricao: "" },
    ]);
  });

  it("updateAptidao patches a single field", () => {
    const vm = makeVM();
    const op = vm.updateAptidao(0, "nome", "Regeneração Rápida");
    expect(op?.diff["system.aptidoes"]).toEqual([
      { nome: "Regeneração Rápida", descricao: "Cura 1 Ferimento por turno." },
    ]);
  });

  it("updateAptidao returns null for out-of-range index", () => {
    const vm = makeVM();
    expect(vm.updateAptidao(5, "nome", "x")).toBeNull();
  });

  it("removeAptidao removes by index", () => {
    const vm = makeVM();
    const op = vm.removeAptidao(0);
    expect(op?.diff["system.aptidoes"]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ataques CRUD — REQ-ETM-050 exact damage
// ---------------------------------------------------------------------------

describe("AntagonistaSheetVM — ataques", () => {
  it("reads ataques with index, including null ferimentos/defesa", () => {
    const vm = makeVM();
    expect(vm.ataques).toEqual([
      {
        index: 0,
        nome: "Mordida",
        ferimentos: 2,
        defesa: "parcial",
        alcance: "curto",
        descricao: "Ataque básico.",
      },
      { index: 1, nome: "Garra", ferimentos: null, defesa: null, alcance: "curto", descricao: "" },
    ]);
  });

  it("addAtaque appends an empty entry", () => {
    const vm = makeVM();
    const op = vm.addAtaque();
    const list = op?.diff["system.ataques"] as unknown[];
    expect(list).toHaveLength(3);
    expect(list[2]).toEqual({
      nome: "",
      ferimentos: null,
      defesa: null,
      alcance: "",
      descricao: "",
    });
  });

  it("updateAtaque patches ferimentos", () => {
    const vm = makeVM();
    const op = vm.updateAtaque(0, "ferimentos", 5);
    const list = op?.diff["system.ataques"] as Array<Record<string, unknown>>;
    expect(list[0]?.["ferimentos"]).toBe(5);
  });

  it("removeAtaque removes by index", () => {
    const vm = makeVM();
    const op = vm.removeAtaque(1);
    const list = op?.diff["system.ataques"] as unknown[];
    expect(list).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Exact damage application to target (REQ-ETM-050 SRD exception)
// ---------------------------------------------------------------------------

describe("AntagonistaSheetVM.buildApplyDamageToTarget", () => {
  it("applies exact ferimentos damage clamped to target's limite", () => {
    const vm = makeVM();
    const ataque = vm.ataques[0]; // Mordida, ferimentos: 2
    expect(ataque).toBeDefined();
    const op = AntagonistaSheetVM.buildApplyDamageToTarget(
      "target-001",
      1,
      4,
      ataque as NonNullable<typeof ataque>,
    );
    expect(op).toEqual({
      type: "doc:update",
      documentType: "Actor",
      id: "target-001",
      diff: { "system.ferimentos.atual": 3 },
    });
  });

  it("clamps at target's limite (does not overshoot)", () => {
    const vm = makeVM();
    const ataque = vm.ataques[0]; // ferimentos: 2
    expect(ataque).toBeDefined();
    const op = AntagonistaSheetVM.buildApplyDamageToTarget(
      "target-001",
      3,
      4,
      ataque as NonNullable<typeof ataque>,
    );
    expect(op?.diff["system.ferimentos.atual"]).toBe(4);
  });

  it("returns null when the Ataque has no declared ferimentos (e.g. Garra)", () => {
    const vm = makeVM();
    const ataque = vm.ataques[1]; // Garra, ferimentos: null
    expect(ataque).toBeDefined();
    const op = AntagonistaSheetVM.buildApplyDamageToTarget(
      "target-001",
      0,
      4,
      ataque as NonNullable<typeof ataque>,
    );
    expect(op).toBeNull();
  });
});
