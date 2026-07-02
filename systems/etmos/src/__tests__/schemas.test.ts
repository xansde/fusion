/**
 * Schema validation tests — each schema validates a good example extracted
 * from a real packs-src entry and rejects a malformed one. Also the catalog
 * count test (CA-13, REQ-ETM-046).
 */
import { describe, it, expect } from "vitest";
import particulasPack from "../../packs-src/particulas.json" with { type: "json" };
import origensPack from "../../packs-src/origens.json" with { type: "json" };
import habilidadesPack from "../../packs-src/habilidades.json" with { type: "json" };
import antagonistasPack from "../../packs-src/antagonistas.json" with { type: "json" };

import { ParticulaSystemSchema } from "../schemas/item-particula.js";
import { OrigemSystemSchema } from "../schemas/item-origem.js";
import { HabilidadeSystemSchema } from "../schemas/item-habilidade.js";
import { TotemSystemSchema } from "../schemas/item-totem.js";
import { ItemEncantadoSystemSchema } from "../schemas/item-encantado.js";
import { FraseMagicaSystemSchema, CriadorAplicadoSchema } from "../schemas/item-frase-magica.js";
import { OradorSystemSchema } from "../schemas/actor-orador.js";
import { AntagonistaSystemSchema } from "../schemas/actor-antagonista.js";
import { ConjuracaoCardSchema } from "../schemas/conjuracao-card.js";

// ---------------------------------------------------------------------------
// ParticulaSystemSchema
// ---------------------------------------------------------------------------

describe("ParticulaSystemSchema", () => {
  it("validates a real Função entry (et)", () => {
    const src = particulasPack.funcoes.find((f) => f.id === "et");
    expect(src).toBeDefined();
    const result = ParticulaSystemSchema.safeParse({
      slug: src.id,
      palavra_etmos: src.palavra_etmos,
      categoria: "funcao",
      significado: src.nome,
      descricao: src.descricao,
      nivel_grimorio: null,
      subtipo_complemento: null,
      icone_runico: null,
      verify: src.verify === true,
    });
    expect(result.success).toBe(true);
  });

  it("validates a real Complemento entry (ada, nivel 3, criador)", () => {
    const src = particulasPack.complementos.find((c) => c.id === "ada");
    expect(src).toBeDefined();
    const result = ParticulaSystemSchema.safeParse({
      slug: src.id,
      palavra_etmos: src.palavra_etmos,
      categoria: "complemento",
      significado: src.nome,
      descricao: src.descricao,
      nivel_grimorio: src.nivel_grimorio,
      subtipo_complemento: src.subtipo,
      icone_runico: null,
      verify: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nivel_grimorio).toBe(3);
      expect(result.data.subtipo_complemento).toBe("criador");
    }
  });

  it("rejects a malformed entry (missing slug, bad categoria)", () => {
    const result = ParticulaSystemSchema.safeParse({
      palavra_etmos: "Et",
      categoria: "nao-existe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects nivel_grimorio out of 1..4 range", () => {
    const result = ParticulaSystemSchema.safeParse({
      slug: "x",
      palavra_etmos: "X",
      categoria: "complemento",
      nivel_grimorio: 5,
      subtipo_complemento: "modificador",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Catalog count — CA-13, REQ-ETM-046
// ---------------------------------------------------------------------------

describe("Partícula catalog counts (CA-13)", () => {
  it("packs-src has 18 Funções, 19 Objetos, 34 Características, 10 Complementos = 81 total", () => {
    expect(particulasPack.funcoes.length).toBe(18);
    expect(particulasPack.objetos.length).toBe(19);
    expect(particulasPack.caracteristicas.length).toBe(34);
    expect(particulasPack.complementos.length).toBe(10);
    const total =
      particulasPack.funcoes.length +
      particulasPack.objetos.length +
      particulasPack.caracteristicas.length +
      particulasPack.complementos.length;
    expect(total).toBe(81);
  });

  it("exactly one Função is marked verify:true (Mat, non-canonical, D3)", () => {
    const verifyFuncoes = particulasPack.funcoes.filter((f) => f.verify === true);
    expect(verifyFuncoes).toHaveLength(1);
    expect(verifyFuncoes[0].id).toBe("mat");
  });
});

// ---------------------------------------------------------------------------
// OrigemSystemSchema
// ---------------------------------------------------------------------------

describe("OrigemSystemSchema", () => {
  it("validates a real Origem entry (berco-de-ouro)", () => {
    const src = origensPack.origens.find((o) => o.id === "berco-de-ouro");
    expect(src).toBeDefined();
    // NOTE: packs-src uses adjective forms "mundana"/"fantastica" (matching
    // "Origem Mundana"/"Origem Fantástica"), while spec 19's OrigemSystem
    // type uses "mundano"/"fantastico" (matching the Mundo type shared with
    // Orador.mundo_origem). The pack BUILD script (scripts/build-packs.mjs)
    // normalizes "mundana"->"mundano"/"fantastica"->"fantastico" — this test
    // exercises the schema with the ALREADY-NORMALIZED value, same as what
    // the build script emits.
    expect(src.tipo).toBe("mundana");
    const result = OrigemSystemSchema.safeParse({
      mundo_associado: "mundano",
      exclusiva: src.exclusiva,
      descricao: src.descricao,
      efeito_mecanico: src.efeito_mecanico,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid mundo_associado", () => {
    const result = OrigemSystemSchema.safeParse({
      mundo_associado: "outro-mundo",
      exclusiva: false,
      descricao: "",
      efeito_mecanico: "",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HabilidadeSystemSchema
// ---------------------------------------------------------------------------

describe("HabilidadeSystemSchema", () => {
  it("validates a real Habilidade prática entry (armas-brancas)", () => {
    const src = habilidadesPack.habilidades_praticas.find((h) => h.id === "armas-brancas");
    expect(src).toBeDefined();
    const result = HabilidadeSystemSchema.safeParse({
      categoria: "pratica",
      descricao: src.descricao,
      bonus: src.bonus_por_escolha ?? 0,
      usos_por_dia: null,
      requer_acao: false,
      escolhivel_multiplas_vezes: src.escolhivel_multiplas_vezes,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid categoria", () => {
    const result = HabilidadeSystemSchema.safeParse({
      categoria: "mistica",
      descricao: "",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AntagonistaSystemSchema
// ---------------------------------------------------------------------------

describe("AntagonistaSystemSchema", () => {
  it("validates the real morto-vivo-simples example (Atributo 0 allowed)", () => {
    const src = antagonistasPack.exemplos_fichas.find((f) => f.id === "morto-vivo-simples");
    expect(src).toBeDefined();
    const result = AntagonistaSystemSchema.safeParse({
      ficha_base: src.ficha_base,
      ferimentos: { atual: 0, limite: src.limite_ferimentos },
      estresse: { atual: 0, limite: src.limite_estresse },
      complexidade_maxima: src.complexidade_maxima,
      movimentacao: src.movimentacao_m,
      comunicacao: src.comunicacao,
      atributos: src.atributos,
      aptidoes: [],
      ataques: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.atributos.mente).toBe(0);
      expect(result.data.atributos.alma).toBe(0);
    }
  });

  it("rejects an invalid ficha_base", () => {
    const result = AntagonistaSystemSchema.safeParse({
      ficha_base: "lendaria",
      atributos: { corpo: 1, alma: 1, mente: 1 },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OradorSystemSchema
// ---------------------------------------------------------------------------

describe("OradorSystemSchema", () => {
  it("validates a minimal valid Orador (Atributos 1..6, D2 minimum 1)", () => {
    const result = OradorSystemSchema.safeParse({
      atributos: {
        corpo: { value: 3, max: 6 },
        alma: { value: 2, max: 6 },
        mente: { value: 4, max: 6 },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects Atributo value 0 (D2: minimum 1 for Oradores)", () => {
    const result = OradorSystemSchema.safeParse({
      atributos: {
        corpo: { value: 0, max: 6 },
        alma: { value: 2, max: 6 },
        mente: { value: 4, max: 6 },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects Atributo value above 6", () => {
    const result = OradorSystemSchema.safeParse({
      atributos: {
        corpo: { value: 7, max: 6 },
        alma: { value: 2, max: 6 },
        mente: { value: 4, max: 6 },
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FraseMagicaSystemSchema / CriadorAplicadoSchema
// ---------------------------------------------------------------------------

describe("FraseMagicaSystemSchema", () => {
  it("validates a full frase with a prefix Criador (G3 shape)", () => {
    const result = FraseMagicaSystemSchema.safeParse({
      funcao_slug: "ev",
      objeto_slugs: ["eli"],
      caracteristica_slugs: ["quan"],
      criadores: [{ slug: "ada", alvo: 0 }],
      modificador_slugs: [],
      intencao: "Criar estacas de gelo",
      frase_completa: "Eveli adaQuan",
      complexidade: "dificil",
      estresse_gerado: 2,
      favorita: false,
    });
    expect(result.success).toBe(true);
  });

  it("validates a connector Criador with a tuple alvo (G4 shape)", () => {
    const result = CriadorAplicadoSchema.safeParse({ slug: "ag", alvo: [0, 1] });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid complexidade enum value", () => {
    const result = FraseMagicaSystemSchema.safeParse({
      funcao_slug: "et",
      objeto_slugs: ["imu"],
      complexidade: "lendaria",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TotemSystemSchema / ItemEncantadoSystemSchema / ConjuracaoCardSchema — smoke
// ---------------------------------------------------------------------------

describe("remaining schemas — smoke tests", () => {
  it("TotemSystemSchema validates a rank-2 Totem", () => {
    const result = TotemSystemSchema.safeParse({ rank: 2, is_santuario: false });
    expect(result.success).toBe(true);
  });

  it("TotemSystemSchema rejects rank above 5", () => {
    const result = TotemSystemSchema.safeParse({ rank: 6 });
    expect(result.success).toBe(false);
  });

  it("ItemEncantadoSystemSchema validates a full record", () => {
    const result = ItemEncantadoSystemSchema.safeParse({
      frase: {
        funcao_slug: "et",
        objeto_slugs: ["imu"],
      },
      grau_sofisticacao: "simples",
      veiculo: "consumivel",
      pp_necessarios: 5,
      pp_acumulados: 0,
      concluido: false,
    });
    expect(result.success).toBe(true);
  });

  it("ConjuracaoCardSchema validates a proposta card", () => {
    const result = ConjuracaoCardSchema.safeParse({
      estado: "proposta",
      conjurador_actor_id: "abc123",
      frase: { funcao_slug: "et", objeto_slugs: ["imu"] },
    });
    expect(result.success).toBe(true);
  });

  it("ConjuracaoCardSchema rejects an invalid estado", () => {
    const result = ConjuracaoCardSchema.safeParse({
      estado: "em-analise",
      conjurador_actor_id: "abc123",
      frase: { funcao_slug: "et", objeto_slugs: ["imu"] },
    });
    expect(result.success).toBe(false);
  });
});
