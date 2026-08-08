/**
 * Tests for the palette/recolour resolution.
 *
 * Two halves, on purpose:
 *
 *  1. Unit tests over the address grammar, with hand-written palettes — these
 *     pin the semantics of `all.lpcr`, of `base` and of `fonte` winning.
 *  2. A SWEEP over the real installed acervo: for every piece that declares a
 *     colour channel, feed the acervo's own `montarCamadas` and assert that
 *     every recolour entry it emits resolves to two real ramps.
 *
 * The sweep is the part that catches a wrong assumption. A test that only
 * exercised my own fixtures would agree with itself — the same circularity that
 * let 80 green tests coexist with 60 defects in the class-derivation work
 * (docs/lessons.md). It also asserts a MINIMUM number of resolved entries, so
 * it cannot pass by resolving nothing.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { montarCamadas } from "waybuilder-avatar";
import type { Catalogo, Selecao } from "waybuilder-avatar";
import {
  amostraDaRampa,
  arquivoDePaleta,
  arquivosDoPedido,
  coresDoCanal,
  enderecoDaBase,
  resolverRampas,
  type ArquivoDePaleta,
  type PaletasCarregadas,
} from "../paletas.js";

// ---------------------------------------------------------------------------
// Unit — address grammar
// ---------------------------------------------------------------------------

describe("arquivoDePaleta", () => {
  it("keeps the channel's material when the palette is a bare version", () => {
    expect(arquivoDePaleta("body", "ulpc")).toBe("paletas/body/body_ulpc.json");
    expect(arquivoDePaleta("hair", "lpcr")).toBe("paletas/hair/hair_lpcr.json");
  });

  it("lets MATERIAL.versao override the material", () => {
    // `all.lpcr` = material `all`, version `lpcr` — the dot is the separator,
    // and this is why a stored colour must carry its palette.
    expect(arquivoDePaleta("hair", "all.lpcr")).toBe("paletas/all/all_lpcr.json");
    expect(arquivoDePaleta("metal", "all.lpcr")).toBe("paletas/all/all_lpcr.json");
  });
});

describe("enderecoDaBase", () => {
  it("splits <versao>.<rampa> against the channel's material", () => {
    expect(enderecoDaBase("body", "ulpc.light")).toEqual({
      arquivo: "paletas/body/body_ulpc.json",
      rampa: "light",
    });
    expect(enderecoDaBase("hair", "ulpc.orange")).toEqual({
      arquivo: "paletas/hair/hair_ulpc.json",
      rampa: "orange",
    });
  });

  it("keeps everything after the first dot as the ramp name", () => {
    expect(enderecoDaBase("cloth", "ulpc.blue.dark")?.rampa).toBe("blue.dark");
  });

  it("refuses a base with no ramp", () => {
    expect(enderecoDaBase("body", "ulpc")).toBeNull();
    expect(enderecoDaBase("body", "ulpc.")).toBeNull();
    expect(enderecoDaBase("body", ".light")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit — resolution
// ---------------------------------------------------------------------------

const CLARO = ["#000000", "#804020", "#f0d0b0"];
const BRONZE = ["#100000", "#603010", "#c09070"];
const AÇO = ["#101010", "#707070", "#e0e0e0"];

function paletasFake(): PaletasCarregadas {
  const body: ArquivoDePaleta = { light: CLARO, bronze: BRONZE };
  const all: ArquivoDePaleta = { steel: AÇO };
  return new Map([
    ["paletas/body/body_ulpc.json", body],
    ["paletas/all/all_lpcr.json", all],
  ]);
}

describe("resolverRampas", () => {
  it("resolves base → destination inside one material", () => {
    const r = resolverRampas(
      { material: "body", paleta: "ulpc", cor: "bronze", base: "ulpc.light" },
      paletasFake(),
    );
    expect(r).toEqual({ de: CLARO, para: BRONZE });
  });

  it("crosses materials when the palette is qualified", () => {
    const r = resolverRampas(
      { material: "body", paleta: "all.lpcr", cor: "steel", base: "ulpc.light" },
      paletasFake(),
    );
    expect(r).toEqual({ de: CLARO, para: AÇO });
  });

  it("lets the piece's own `fonte` win over `base`", () => {
    const embutida = ["#010101", "#020202", "#030303"];
    const r = resolverRampas(
      { material: "body", paleta: "ulpc", cor: "bronze", base: "ulpc.light", fonte: embutida },
      paletasFake(),
    );
    expect(r).toEqual({ de: embutida, para: BRONZE });
  });

  it("resolves with `fonte` and no `base` at all", () => {
    const embutida = ["#010101"];
    const r = resolverRampas(
      { material: "body", paleta: "ulpc", cor: "bronze", fonte: embutida },
      paletasFake(),
    );
    expect(r?.de).toEqual(embutida);
  });

  it("returns null — never throws — when something is missing", () => {
    const p = paletasFake();
    // colour not in the destination file
    expect(resolverRampas({ material: "body", paleta: "ulpc", cor: "roxo", base: "ulpc.light" }, p)).toBeNull();
    // destination file not loaded
    expect(resolverRampas({ material: "wood", paleta: "ulpc", cor: "oak", base: "ulpc.light" }, p)).toBeNull();
    // no base and no fonte: the source ramp is unknowable
    expect(resolverRampas({ material: "body", paleta: "ulpc", cor: "bronze" }, p)).toBeNull();
    // base points at a ramp that is not there
    expect(resolverRampas({ material: "body", paleta: "ulpc", cor: "bronze", base: "ulpc.nada" }, p)).toBeNull();
  });
});

describe("arquivosDoPedido", () => {
  it("asks for destination and base files", () => {
    expect(arquivosDoPedido({ material: "body", paleta: "all.lpcr", cor: "steel", base: "ulpc.light" })).toEqual([
      "paletas/all/all_lpcr.json",
      "paletas/body/body_ulpc.json",
    ]);
  });

  it("skips the base file when the ramp travels inline", () => {
    expect(
      arquivosDoPedido({ material: "body", paleta: "ulpc", cor: "bronze", base: "ulpc.light", fonte: CLARO }),
    ).toEqual(["paletas/body/body_ulpc.json"]);
  });
});

describe("amostraDaRampa", () => {
  it("takes the middle of the ramp, not an extreme", () => {
    // extremes are near-black / near-white outline colours and identify nothing
    expect(amostraDaRampa(CLARO)).toBe("#804020");
    expect(amostraDaRampa(["#a", "#b", "#c", "#d"])).toBe("#c");
    expect(amostraDaRampa(["#solo"])).toBe("#solo");
    expect(amostraDaRampa([])).toBeNull();
  });
});

describe("coresDoCanal", () => {
  it("qualifies every value and keeps palette order", () => {
    const cores = coresDoCanal({ material: "body", paletas: ["ulpc", "all.lpcr"] }, paletasFake());
    expect(cores.map((c) => c.valor)).toEqual(["ulpc:light", "ulpc:bronze", "all.lpcr:steel"]);
    expect(cores[0]).toMatchObject({ nome: "light", paleta: "ulpc", amostra: "#804020" });
  });

  it("ignores palettes that are not loaded instead of failing", () => {
    const cores = coresDoCanal({ material: "body", paletas: ["ulpc", "inexistente"] }, paletasFake());
    expect(cores.map((c) => c.paleta)).toEqual(["ulpc", "ulpc"]);
  });
});

// ---------------------------------------------------------------------------
// Sweep over the real acervo
// ---------------------------------------------------------------------------

/** Read the installed acervo straight off disk (the test runs in Node). */
function lerAcervo(): { catalogo: Catalogo; paletas: Map<string, ArquivoDePaleta> } {
  const require = createRequire(import.meta.url);
  const dir = dirname(require.resolve("waybuilder-avatar/catalogo.json"));
  const catalogo = JSON.parse(readFileSync(join(dir, "catalogo.json"), "utf8")) as Catalogo;

  const paletas = new Map<string, ArquivoDePaleta>();
  const raiz = join(dir, "paletas");
  for (const material of readdirSync(raiz, { withFileTypes: true })) {
    if (!material.isDirectory()) continue;
    for (const arq of readdirSync(join(raiz, material.name))) {
      if (!arq.endsWith(".json") || arq.startsWith("meta_")) continue;
      const rel = `paletas/${material.name}/${arq}`;
      paletas.set(rel, JSON.parse(readFileSync(join(raiz, material.name, arq), "utf8")) as ArquivoDePaleta);
    }
  }
  return { catalogo, paletas };
}

describe("varredura do acervo real", () => {
  const { catalogo, paletas } = lerAcervo();
  const comCanal = catalogo.itens.filter((i) => (i.canais_de_cor ?? []).length > 0);

  it("has palettes for every material the catalog references", () => {
    const faltando = new Set<string>();
    for (const item of comCanal) {
      for (const canal of item.canais_de_cor ?? []) {
        for (const paleta of canal.paletas) {
          const arq = arquivoDePaleta(canal.material, paleta);
          if (!paletas.has(arq)) faltando.add(arq);
        }
      }
    }
    expect([...faltando]).toEqual([]);
  });

  it("offers at least one colour on every channel of every piece", () => {
    const vazios: string[] = [];
    for (const item of comCanal) {
      for (const canal of item.canais_de_cor ?? []) {
        if (coresDoCanal(canal, paletas).length === 0) vazios.push(`${item.id}/${canal.nome}`);
      }
    }
    expect(vazios).toEqual([]);
  });

  it("resolves every recolour montarCamadas emits, for every piece with a channel", () => {
    let resolvidos = 0;
    const falhas: string[] = [];

    for (const item of comCanal) {
      // First body this piece actually has art for — `sem_arte` pieces would
      // otherwise produce no layers and quietly contribute nothing.
      const corpo = catalogo.recorte.corpos.find((c) => !(item.sem_arte ?? []).includes(c));
      if (corpo === undefined) continue;

      // Pick the first offered colour of every channel — the same value the
      // creator's picker would store.
      const cores: Record<string, string> = {};
      for (const canal of item.canais_de_cor ?? []) {
        const primeira = coresDoCanal(canal, paletas)[0];
        if (primeira !== undefined) cores[canal.nome] = primeira.valor;
      }

      const selecao: Selecao = { [item.slot]: { id: item.id, cores } };
      const { camadas } = montarCamadas(catalogo, selecao, corpo, "idle");

      for (const camada of camadas) {
        for (const pedido of camada.recolor ?? []) {
          const rampas = resolverRampas(pedido, paletas);
          if (rampas === null) {
            falhas.push(`${item.id} ${pedido.material}/${pedido.paleta}:${pedido.cor} base=${pedido.base ?? "-"}`);
            continue;
          }
          expect(rampas.de.length).toBeGreaterThan(0);
          expect(rampas.para.length).toBeGreaterThan(0);
          resolvidos++;
        }
      }
    }

    expect(falhas).toEqual([]);
    // Guard against a green run that resolved nothing: the acervo's own README
    // puts the recolour-dependent share at 383 of 609 pieces.
    expect(resolvidos).toBeGreaterThan(300);
  });

  it("inherits the body's skin tone into head/nose/ear pieces", () => {
    // `segue_cor_do_corpo` is what keeps the face from being a different colour
    // than the torso. If my picker stored a colour per piece instead of letting
    // the body drive it, this is the test that would fail.
    const corpo = catalogo.itens.find((i) => i.slot === "body");
    const seguidor = catalogo.itens.find((i) => i.segue_cor_do_corpo === true && i.slot !== "body");
    expect(corpo).toBeDefined();
    expect(seguidor).toBeDefined();
    if (corpo === undefined || seguidor === undefined) return;

    const canalCorpo = corpo.canais_de_cor?.[0];
    expect(canalCorpo).toBeDefined();
    const tom = coresDoCanal(canalCorpo!, paletas).at(-1)!.valor;

    const variante = catalogo.recorte.corpos.find(
      (c) => !(seguidor.sem_arte ?? []).includes(c) && !(corpo.sem_arte ?? []).includes(c),
    )!;
    const { camadas } = montarCamadas(
      catalogo,
      {
        [corpo.slot]: { id: corpo.id, cores: { [canalCorpo!.nome]: tom } },
        [seguidor.slot]: { id: seguidor.id }, // NO colour asked for
      },
      variante,
      "idle",
    );

    const doSeguidor = camadas.find((c) => c.slot === seguidor.slot);
    expect(doSeguidor?.recolor?.[0]?.cor).toBe(tom.split(":")[1]);
    const rampas = resolverRampas(doSeguidor!.recolor![0]!, paletas);
    expect(rampas).not.toBeNull();
  });
});
