/**
 * Palette plumbing for the avatar's runtime recolour.
 *
 * `montarCamadas` (waybuilder-avatar) tells us WHAT to recolour — per layer, a
 * list of `{material, paleta, cor, base?, fonte?}`. It deliberately stops there:
 * turning that into two colour ramps means reading the acervo's palette files,
 * which is I/O, and the acervo's renderer is pure by design.
 *
 * This module is the missing half, and it is pure too: it maps a recolour entry
 * to the palette FILES it needs and, given those files' contents, to the
 * `{de, para}` pair that `recolorirPixels` consumes. Loading is
 * acervo.ts's job; drawing is desenhar.ts's.
 *
 * The address grammar, from the acervo's own contract (tipos.ts):
 *
 *   material   `body`, `hair`, `cloth`, `metal`, `wood`, `eye`, `all`
 *   paleta     `ulpc` (same material) or `all.lpcr` (MATERIAL.versao — the dot
 *              means the destination ramp lives in ANOTHER material's file)
 *   cor        ramp name inside that file (`tan`, `steel`…)
 *   base       `<versao>.<rampa>` — the ramp the art was painted in, already
 *              resolved by the acervo's build. 41 channels declare their own;
 *              deducing it from the material recolours from the wrong ramp and
 *              the colour silently does not apply.
 *   fonte      source ramp embedded in the piece; wins over `base`.
 */

import type { CamadaDesenhavel } from "waybuilder-avatar";

/** One recolour request, as emitted by `montarCamadas`. */
export type PedidoDeRecolor = NonNullable<CamadaDesenhavel["recolor"]>[number];

/** A palette file's contents: ramp name → ordered hex colours (dark → light). */
export type ArquivoDePaleta = Record<string, string[]>;

/** Loaded palette files, keyed by their acervo-relative path. */
export type PaletasCarregadas = ReadonlyMap<string, ArquivoDePaleta>;

/** The pair `recolorirPixels` needs: replace ramp `de` with ramp `para`. */
export interface Rampas {
  de: string[];
  para: string[];
}

/**
 * Acervo-relative path of a palette file.
 *
 * `paleta` is either a bare version (`ulpc`, and then the file belongs to
 * `material`) or `MATERIAL.versao` (`all.lpcr`), which overrides the material.
 */
export function arquivoDePaleta(material: string, paleta: string): string {
  const ponto = paleta.indexOf(".");
  const mat = ponto === -1 ? material : paleta.slice(0, ponto);
  const versao = ponto === -1 ? paleta : paleta.slice(ponto + 1);
  return `paletas/${mat}/${mat}_${versao}.json`;
}

/** Split a `base` (`<versao>.<rampa>`) into the file it lives in and the ramp. */
export function enderecoDaBase(
  material: string,
  base: string,
): { arquivo: string; rampa: string } | null {
  const ponto = base.indexOf(".");
  if (ponto <= 0 || ponto === base.length - 1) return null;
  const versao = base.slice(0, ponto);
  const rampa = base.slice(ponto + 1);
  return { arquivo: `paletas/${material}/${material}_${versao}.json`, rampa };
}

/**
 * Palette files a recolour request needs loaded before it can be resolved.
 *
 * Always the destination file; plus the base's file unless the piece carries
 * its source ramp inline (`fonte`).
 */
export function arquivosDoPedido(pedido: PedidoDeRecolor): string[] {
  const arquivos = [arquivoDePaleta(pedido.material, pedido.paleta)];
  if (pedido.fonte === undefined && pedido.base !== undefined) {
    const base = enderecoDaBase(pedido.material, pedido.base);
    if (base !== null) arquivos.push(base.arquivo);
  }
  return arquivos;
}

/** Every palette file a whole set of layers needs. */
export function arquivosDasCamadas(camadas: readonly CamadaDesenhavel[]): string[] {
  const fora = new Set<string>();
  for (const camada of camadas) {
    for (const pedido of camada.recolor ?? []) {
      for (const arquivo of arquivosDoPedido(pedido)) fora.add(arquivo);
    }
  }
  return [...fora];
}

/**
 * Every palette file the whole catalog can possibly need.
 *
 * The creator loads all of them up front — the colour PICKER has to list a
 * channel's ramps before anything is equipped, so lazy per-selection loading
 * would show an empty swatch row on first click. It is cheap: the pinned acervo
 * has 14 palette files totalling ~34 KB, against the catalog's own 1.7 MB.
 */
export function arquivosDePaletaDoCatalogo(catalogo: {
  itens: readonly { canais_de_cor?: readonly { material: string; paletas: string[]; base?: string }[] }[];
}): string[] {
  const fora = new Set<string>();
  for (const item of catalogo.itens) {
    for (const canal of item.canais_de_cor ?? []) {
      for (const paleta of canal.paletas) fora.add(arquivoDePaleta(canal.material, paleta));
      if (canal.base !== undefined) {
        const base = enderecoDaBase(canal.material, canal.base);
        if (base !== null) fora.add(base.arquivo);
      }
    }
  }
  return [...fora];
}

/**
 * Resolve a recolour request into the ramp pair, or null when it cannot be.
 *
 * Null is a legitimate outcome, not an error to throw on: a palette that failed
 * to load, or a colour name that is not in the file, must leave the layer drawn
 * in its base art. The alternative — throwing — would take the whole avatar
 * down over one unpaintable helmet strap.
 */
export function resolverRampas(
  pedido: PedidoDeRecolor,
  paletas: PaletasCarregadas,
): Rampas | null {
  const destinoArq = paletas.get(arquivoDePaleta(pedido.material, pedido.paleta));
  const para = destinoArq?.[pedido.cor];
  if (para === undefined || para.length === 0) return null;

  // `fonte` travels with the piece and wins: it is the ramp that piece was
  // actually painted in, whatever the channel's material declares.
  if (pedido.fonte !== undefined && pedido.fonte.length > 0) {
    return { de: pedido.fonte, para };
  }

  if (pedido.base === undefined) return null;
  const base = enderecoDaBase(pedido.material, pedido.base);
  if (base === null) return null;
  const de = paletas.get(base.arquivo)?.[base.rampa];
  if (de === undefined || de.length === 0) return null;

  return { de, para };
}

/**
 * A single colour that represents a ramp, for the swatch in the colour picker.
 *
 * Ramps run dark → light and the extremes are near-black / near-white outlines,
 * so neither end identifies the colour. The middle does — and it is the same
 * choice the acervo makes for its own `amostras` of band-based pieces, which
 * keeps the two colour worlds looking alike in the same picker row.
 */
export function amostraDaRampa(rampa: readonly string[]): string | null {
  if (rampa.length === 0) return null;
  return rampa[Math.floor(rampa.length / 2)] ?? null;
}

/**
 * The colours a channel offers, in picker order, one entry per ramp.
 *
 * `valor` is what goes into the stored selection and it is ALWAYS qualified
 * (`ulpc:tan`). Unqualified names are ambiguous by measurement: 18 of the 19
 * names repeated across a channel's palettes are different ramps — there are
 * three distinct `white`s and three distinct `orange`s.
 */
export interface CorDoCanal {
  /** Stored value — `<paleta>:<rampa>`. */
  valor: string;
  /** Raw ramp name, for the pt-BR lookup in the catalog's `cores` map. */
  nome: string;
  /** Palette the ramp came from, so the picker can group by it. */
  paleta: string;
  /** Hex swatch, or null when the ramp is empty. */
  amostra: string | null;
}

export function coresDoCanal(
  canal: { material: string; paletas: string[] },
  paletas: PaletasCarregadas,
): CorDoCanal[] {
  const fora: CorDoCanal[] = [];
  const vistos = new Set<string>();
  for (const paleta of canal.paletas) {
    const arquivo = paletas.get(arquivoDePaleta(canal.material, paleta));
    if (arquivo === undefined) continue;
    for (const [nome, rampa] of Object.entries(arquivo)) {
      const valor = `${paleta}:${nome}`;
      if (vistos.has(valor)) continue;
      vistos.add(valor);
      fora.push({ valor, nome, paleta, amostra: amostraDaRampa(rampa) });
    }
  }
  return fora;
}
