/**
 * Golden fixtures — montarFrase/validarFrase/custoEstresse against the SRD.
 *
 * Transcribed verbatim from docs/design/m5-etmos-compositor.md §5 (G1..G10),
 * hand-verified against the SRD by the design doc author. These are the
 * REQUIRED tests per the M5-B batch instructions (REQ-ETM-NFR-001).
 */
import { describe, it, expect } from "vitest";
import particulasPack from "../../packs-src/particulas.json" with { type: "json" };
import { montarFrase } from "../compositor/montar-frase.js";
import { validarFrase, validarFuncaoUnica } from "../compositor/validar-frase.js";
import { custoEstresse } from "../compositor/custo.js";
import type { FraseMagicaSystem } from "../schemas/item-frase-magica.js";

// ---------------------------------------------------------------------------
// Build a slug → palavra_etmos resolver from the real pack-src data.
// ---------------------------------------------------------------------------

interface PackParticulaEntry {
  id: string;
  palavra_etmos: string;
}

const ALL_PARTICULAS: PackParticulaEntry[] = [
  ...particulasPack.funcoes,
  ...particulasPack.objetos,
  ...particulasPack.caracteristicas,
  ...particulasPack.complementos,
];

const PALAVRA_BY_SLUG = new Map(ALL_PARTICULAS.map((p) => [p.id, p.palavra_etmos]));

function resolvePalavra(slug: string): string {
  const palavra = PALAVRA_BY_SLUG.get(slug);
  if (palavra === undefined) throw new Error(`Unknown slug in fixture: "${slug}"`);
  return palavra;
}

/** Permissive Grimório stub — every slug known, no level gating. */
const OPEN_GRIMORIO = { hasSlug: () => true };

type FraseSlots = Pick<
  FraseMagicaSystem,
  "funcao_slug" | "objeto_slugs" | "caracteristica_slugs" | "criadores" | "modificador_slugs"
>;

// ---------------------------------------------------------------------------
// G1 — Etimu (frase mínima fundacional)
// ---------------------------------------------------------------------------

describe("golden fixtures (design doc §5)", () => {
  it("G1: Et + Imu -> Etimu (frase mínima)", () => {
    const slots: FraseSlots = {
      funcao_slug: "et",
      objeto_slugs: ["imu"],
      caracteristica_slugs: [],
      criadores: [],
      modificador_slugs: [],
    };
    expect(montarFrase(slots, resolvePalavra)).toBe("Etimu");
    expect(validarFrase(slots, OPEN_GRIMORIO).valido).toBe(true);
    expect(custoEstresse("trivial", 0)).toBe(0);
    expect(custoEstresse("regular", 0)).toBe(1);
  });

  it("G2: Ev + Eli + Quan -> Eveli Quan", () => {
    const slots: FraseSlots = {
      funcao_slug: "ev",
      objeto_slugs: ["eli"],
      caracteristica_slugs: ["quan"],
      criadores: [],
      modificador_slugs: [],
    };
    expect(montarFrase(slots, resolvePalavra)).toBe("Eveli Quan");
    expect(validarFrase(slots, OPEN_GRIMORIO).valido).toBe(true);
    expect(custoEstresse("trivial", 0)).toBe(0);
  });

  it("G3: Ev + Eli + Quan + Ada->Quan -> Eveli adaQuan", () => {
    const slots: FraseSlots = {
      funcao_slug: "ev",
      objeto_slugs: ["eli"],
      caracteristica_slugs: ["quan"],
      criadores: [{ slug: "ada", alvo: 0 }],
      modificador_slugs: [],
    };
    expect(montarFrase(slots, resolvePalavra)).toBe("Eveli adaQuan");
    expect(validarFrase(slots, OPEN_GRIMORIO).valido).toBe(true);
    expect(custoEstresse("dificil", 0)).toBe(2);
  });

  it("G4: Al + Ayu + Quan,Aer + Ag->(0,1) -> Alayu QuanAgAer", () => {
    const slots: FraseSlots = {
      funcao_slug: "al",
      objeto_slugs: ["ayu"],
      caracteristica_slugs: ["quan", "aer"],
      criadores: [{ slug: "ag", alvo: [0, 1] }],
      modificador_slugs: [],
    };
    expect(montarFrase(slots, resolvePalavra)).toBe("Alayu QuanAgAer");
    expect(validarFrase(slots, OPEN_GRIMORIO).valido).toBe(true);
    expect(custoEstresse("regular", 0)).toBe(1);
    expect(custoEstresse("dificil", 0)).toBe(2);
  });

  it("G5: Ar + Imu + Tum + No->Tum -> Arimu noTum", () => {
    const slots: FraseSlots = {
      funcao_slug: "ar",
      objeto_slugs: ["imu"],
      caracteristica_slugs: ["tum"],
      criadores: [{ slug: "no", alvo: 0 }],
      modificador_slugs: [],
    };
    expect(montarFrase(slots, resolvePalavra)).toBe("Arimu noTum");
    expect(validarFrase(slots, OPEN_GRIMORIO).valido).toBe(true);
    expect(custoEstresse("dificil", 0)).toBe(2);
    expect(custoEstresse("complexa", 0)).toBe(4);
  });

  it("G6: Un + Imu + Mut->Exa(objeto) -> Unimu Mutexa", () => {
    const slots: FraseSlots = {
      funcao_slug: "un",
      objeto_slugs: ["imu"],
      // Mut- prefixes an Objeto used as Característica — the Objeto's slug
      // ("exa") is placed in caracteristica_slugs per the schema's design
      // (item-frase-magica.ts docstring).
      caracteristica_slugs: ["exa"],
      criadores: [{ slug: "mut", alvo: 0 }],
      modificador_slugs: [],
    };
    expect(montarFrase(slots, resolvePalavra)).toBe("Unimu Mutexa");
    expect(validarFrase(slots, OPEN_GRIMORIO).valido).toBe(true);
    expect(custoEstresse("dificil", 0)).toBe(2);
  });

  it("G7: Em + Ivi + Ast + Mor -> Emivi Ast Mor", () => {
    const slots: FraseSlots = {
      funcao_slug: "em",
      objeto_slugs: ["ivi"],
      caracteristica_slugs: ["ast"],
      criadores: [],
      modificador_slugs: ["mor"],
    };
    expect(montarFrase(slots, resolvePalavra)).toBe("Emivi Ast Mor");
    expect(validarFrase(slots, OPEN_GRIMORIO).valido).toBe(true);
    expect(custoEstresse("regular", 0)).toBe(1);
  });

  it("G7b: custoEstresse with rank Totem 2 at regular complexity -> 1 + 2 = 3 (REQ-ETM-043)", () => {
    expect(custoEstresse("regular", 2)).toBe(3);
  });

  it("G8: An + Ivi + Phys + Itam -> Anivi Phys Itam", () => {
    const slots: FraseSlots = {
      funcao_slug: "an",
      objeto_slugs: ["ivi"],
      caracteristica_slugs: ["phys"],
      criadores: [],
      modificador_slugs: ["itam"],
    };
    expect(montarFrase(slots, resolvePalavra)).toBe("Anivi Phys Itam");
    expect(validarFrase(slots, OPEN_GRIMORIO).valido).toBe(true);
    expect(custoEstresse("complexa", 0)).toBe(4);
  });

  it("G9: sem Função -> inválida, erro semFuncao", () => {
    const slots: FraseSlots = {
      funcao_slug: "",
      objeto_slugs: ["imu"],
      caracteristica_slugs: [],
      criadores: [],
      modificador_slugs: [],
    };
    const result = validarFrase(slots, OPEN_GRIMORIO);
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.semFuncao");
  });

  it("G10: múltiplas Funções -> inválida, erro multiplasFuncoes", () => {
    const result = validarFuncaoUnica(["et", "ev"]);
    expect(result.valido).toBe(false);
    expect(result.erros).toContain("etmos.compositor.erro.multiplasFuncoes");
  });
});

// ---------------------------------------------------------------------------
// Rank Totem does NOT add to Trivial complexity (design doc §2.4)
// ---------------------------------------------------------------------------

describe("custoEstresse — rank Totem exceptions", () => {
  it("does not add rank Totem to trivial complexity", () => {
    expect(custoEstresse("trivial", 3)).toBe(0);
  });

  it("adds rank Totem to non-trivial complexities", () => {
    expect(custoEstresse("milagre", 1)).toBe(8);
  });
});
