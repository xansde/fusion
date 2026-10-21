/**
 * Drawing the avatar onto a 2D canvas.
 *
 * This is the only module in lib/avatar that touches the DOM. It sits on top of
 * the acervo's pure renderer: `montarCamadas` says which layers, in which order,
 * from which atlas rectangle, with which recolours; this file loads the pixels
 * and paints them.
 *
 * ## Why frames, not atlases, are what gets recoloured
 *
 * An atlas holds every piece of a slot stacked on the Y axis: the hair atlas is
 * 3072×5696 (90 pieces × 64 px), which is ~67 MB once decoded to RGBA. The
 * acervo's `CacheDeRecolor` is documented as caching "the already-recoloured
 * bitmap per (file, palette, colour)" — taken literally, per atlas, one hair
 * colour would cost 67 MB of pixel work and memory, and the creator's grid asks
 * for dozens.
 *
 * So the unit here is the 64×64 FRAME actually drawn: 16 KB, keyed by
 * (atlas, source rect, recolour signature). `idle` needs 2 of them per layer.
 * The cache class is still the acervo's — it is a keyed memo, and the key parts
 * are used as (file, rect, signature).
 *
 * EVERY frame a composition needs is sliced at PREPARE time, recoloured or not,
 * and the prepared avatar keeps its own references to those tiles. The draw loop
 * therefore never looks an atlas up — and it must not: an atlas is one LAYER of
 * one slot, a dressed figure has ~19 of them and the decoded-atlas LRU holds 8,
 * so a draw-time lookup misses most layers on every tick (that was the blinking
 * avatar). The LRU only bounds what preparing costs. It is also what makes the creator's grid cheap — 90 cells
 * composing the whole character reuse the same tiles for the 7 layers they share
 * and only slice the candidate piece.
 *
 * (The wings atlas is 3072×16320 — the acervo's own shape, and the one case
 * where browsing that slot costs a real decode spike.)
 */

import { CacheDeRecolor, montarCamadas, recolorirPixels } from "waybuilder-avatar";
import type { CamadaDesenhavel, Catalogo, Composicao, Selecao } from "waybuilder-avatar";
import { acervoUrl, garantirPaletas, paletasCarregadas } from "./acervo.js";
import { cicloDe, fpsDe, frameEm, ladoDoQuadro } from "./animacao.js";
import { arquivosDasCamadas, resolverRampas, type Rampas } from "./paletas.js";

// ---------------------------------------------------------------------------
// Atlas cache (decoded images) — small LRU
// ---------------------------------------------------------------------------

/**
 * How many decoded atlases stay resident.
 *
 * Eight covers a dressed character (shadow, body, head, hair, clothes, legs,
 * shoes) PLUS the slot being browsed, which is the worst realistic case. Going
 * lower thrashes while a walk cycle warms up; going higher just holds pixels.
 */
const ATLAS_MAXIMO = 8;
const atlases = new Map<string, HTMLImageElement>();
const atlasesEmVoo = new Map<string, Promise<HTMLImageElement | null>>();

function carregarAtlas(arq: string): Promise<HTMLImageElement | null> {
  const pronto = atlases.get(arq);
  if (pronto !== undefined) {
    // Re-insert to mark as most-recently-used (Map keeps insertion order).
    atlases.delete(arq);
    atlases.set(arq, pronto);
    return Promise.resolve(pronto);
  }

  let voo = atlasesEmVoo.get(arq);
  if (voo === undefined) {
    voo = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      // A missing atlas must not take the avatar down: the layer is skipped and
      // the rest of the figure still draws.
      img.onload = () => {
        resolve(img);
      };
      img.onerror = () => {
        resolve(null);
      };
      img.src = acervoUrl(arq);
    })
      .then((img) => {
        if (img !== null) {
          atlases.set(arq, img);
          while (atlases.size > ATLAS_MAXIMO) {
            const maisAntigo = atlases.keys().next().value;
            if (maisAntigo === undefined) break;
            atlases.delete(maisAntigo);
          }
        }
        return img;
      })
      .finally(() => {
        atlasesEmVoo.delete(arq);
      });
    atlasesEmVoo.set(arq, voo);
  }
  return voo;
}

// ---------------------------------------------------------------------------
// Frame cache (recoloured 64×64 tiles)
// ---------------------------------------------------------------------------

/**
 * Cap on cached frames. 16 KB each, so ~1500 frames ≈ 24 MB — enough for a full
 * creator grid, and the whole cache is dropped rather than evicted one by one
 * (the acervo's cache has no LRU, and a wholesale drop is honest and cheap).
 */
const QUADROS_MAXIMO = 1500;

const quadros = new CacheDeRecolor<HTMLCanvasElement>();

/**
 * Stable identity of a layer's recolour set.
 *
 * Two layers with the same recolours must hit the same cache entry, and one
 * extra channel must miss it — so every field that changes pixels is in here.
 * Exported for the test: getting this wrong shows up as the wrong colour drawn
 * from cache, which is invisible in code review.
 */
export function assinaturaDoRecolor(camada: CamadaDesenhavel): string {
  const pedidos = camada.recolor ?? [];
  if (pedidos.length === 0) return "";
  return pedidos
    .map((p) => `${p.material}/${p.paleta}:${p.cor}@${p.base ?? "-"}#${(p.fonte ?? []).join(",")}`)
    .join("|");
}

/**
 * The 64×64 tile for one layer at one frame, sliced out of the atlas and
 * recoloured if asked. Cached; `rampas` empty means a plain slice.
 */
function quadroDaCamada(
  atlas: HTMLImageElement,
  arq: string,
  sx: number,
  sy: number,
  lado: number,
  assinatura: string,
  rampas: readonly Rampas[],
): HTMLCanvasElement {
  if (quadros.tamanho > QUADROS_MAXIMO) quadros.limpar();
  return quadros.obter(arq, `${String(sx)}:${String(sy)}`, assinatura, () => {
    const tela = document.createElement("canvas");
    tela.width = lado;
    tela.height = lado;
    // willReadFrequently only matters for the recolour path, which is the one
    // that calls getImageData — asking for it unconditionally would opt every
    // plain slice out of GPU-backed canvases.
    const ctx = tela.getContext("2d", rampas.length > 0 ? { willReadFrequently: true } : undefined);
    if (ctx === null) return tela;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(atlas, sx, sy, lado, lado, 0, 0, lado, lado);
    if (rampas.length === 0) return tela;
    const dados = ctx.getImageData(0, 0, lado, lado);
    // Sequential application, one call per channel — the same order the acervo's
    // own emitter lists them in, so metal is decided before cloth on a helmet.
    for (const rampa of rampas) recolorirPixels(dados.data, rampa.de, rampa.para);
    ctx.putImageData(dados, 0, 0);
    return tela;
  });
}

// ---------------------------------------------------------------------------
// Painter
// ---------------------------------------------------------------------------

/** A composition plus every tile needed to draw it, held by reference. */
export interface AvatarPronto {
  composicao: Composicao;
  animacao: string;
  ciclo: number[];
  fps: number;
  lado: number;
  /**
   * Per layer index: frame number → tile. The pronto OWNS these references, so
   * neither the atlas LRU nor a wholesale drop of the shared frame cache can make
   * a layer vanish from an avatar that is already on screen. A layer absent here
   * is one whose atlas failed to load.
   */
  quadros: Map<number, Map<number, HTMLCanvasElement>>;
}

export interface OpcoesDePreparo {
  /** Only the frame shown at t=0 is sliced — a still grid cell needs no more. */
  parado?: boolean;
}

/**
 * The frames a layer actually shows over its animation cycle, each once.
 *
 * Mirrors {@link frameEm}'s clamping: a layer with a single frame stays on 0,
 * and a cycle step past the layer's strip lands on its last frame.
 */
export function framesDaCamada(ciclo: readonly number[], quadros: number): number[] {
  if (quadros <= 1 || ciclo.length === 0) return [0];
  return [...new Set(ciclo.map((f) => Math.min(f, quadros - 1)))];
}

/**
 * Content identity of what a sprite draws.
 *
 * Callers keep their selection in fresh objects (a mirror broadcast rebuilds the
 * actor on every update, the creator's grid rebuilds each cell's selection on
 * every edit); this key is what lets them skip a re-preparation — and a redraw —
 * when nothing visible changed. Key order does not matter, content does.
 */
export function chaveDoAvatar(
  selecao: Selecao,
  corpo: string,
  animacao: string,
  parado: boolean,
): string {
  const slots = Object.keys(selecao).sort();
  const partes = slots.map((slot) => {
    const escolha = selecao[slot];
    if (escolha === undefined) return slot;
    const cores = Object.entries(escolha.cores ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([canal, valor]) => `${canal}=${valor}`)
      .join(",");
    return `${slot}:${escolha.id}[${cores}]`;
  });
  return `${corpo}|${animacao}|${parado ? "parado" : "anim"}|${partes.join(";")}`;
}

/**
 * Resolve a selection into something drawable: layers, ramps, and every tile.
 *
 * Async on purpose, and called on every SELECTION change rather than every
 * frame: the draw itself must be synchronous so it can run inside
 * requestAnimationFrame without a promise between the tick and the pixels.
 *
 * Every tile the cycle needs is sliced here, from the atlas references the
 * loads resolved with — never from the shared LRU, which holds 8 atlases while
 * a dressed figure has one per layer (19 for a sixteen-slot outfit). Looking the
 * atlas up at draw time instead is what made layers blink in and out.
 */
export async function prepararAvatar(
  catalogo: Catalogo,
  selecao: Selecao,
  corpo: string,
  animacao: string,
  opcoes: OpcoesDePreparo = {},
): Promise<AvatarPronto> {
  const composicao = montarCamadas(catalogo, selecao, corpo, animacao);

  await garantirPaletas(arquivosDasCamadas(composicao.camadas));
  const paletas = paletasCarregadas();

  const ciclo = cicloDe(catalogo, animacao);
  const fps = fpsDe(catalogo);
  const lado = ladoDoQuadro(catalogo);

  const arquivos = [...new Set(composicao.camadas.map((c) => c.arq))];
  const imagens = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    arquivos.map(async (arq) => {
      imagens.set(arq, await carregarAtlas(arq));
    }),
  );

  const quadrosPorCamada = new Map<number, Map<number, HTMLCanvasElement>>();
  composicao.camadas.forEach((camada, indice) => {
    const atlas = imagens.get(camada.arq) ?? null;
    if (atlas === null) return;
    const rampas = (camada.recolor ?? [])
      .map((pedido) => resolverRampas(pedido, paletas))
      .filter((r): r is Rampas => r !== null);
    const assinatura = rampas.length > 0 ? assinaturaDoRecolor(camada) : "";
    const frames =
      opcoes.parado === true
        ? [frameEm(0, ciclo, fps, camada.frames)]
        : framesDaCamada(ciclo, camada.frames);
    const tiles = new Map<number, HTMLCanvasElement>();
    for (const frame of frames) {
      tiles.set(
        frame,
        quadroDaCamada(
          atlas,
          camada.arq,
          camada.x + frame * lado,
          camada.y,
          lado,
          assinatura,
          rampas,
        ),
      );
    }
    quadrosPorCamada.set(indice, tiles);
  });

  return { composicao, animacao, ciclo, fps, lado, quadros: quadrosPorCamada };
}

/** Which step of the cycle time `tMs` falls in — a redraw is only due when it changes. */
export function passoEm(tMs: number, fps: number): number {
  return Math.floor((Math.max(0, tMs) * fps) / 1000);
}

/**
 * Draw one frame. Synchronous, and never touches the network or the decoder:
 * every tile was sliced by {@link prepararAvatar}.
 *
 * `tMs` is a monotonic time, not a frame index — the cycle and fps decide which
 * frame that is, so every avatar on screen animates in step regardless of how
 * often its own canvas repaints.
 *
 * Returns how many layers could NOT be drawn (an atlas that failed to load).
 */
export function desenharAvatar(
  ctx: CanvasRenderingContext2D,
  pronto: AvatarPronto,
  tMs: number,
  zoom: number,
): number {
  const { lado } = pronto;
  let faltando = 0;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.imageSmoothingEnabled = false;

  pronto.composicao.camadas.forEach((camada, indice) => {
    const frame = frameEm(tMs, pronto.ciclo, pronto.fps, camada.frames);
    const tile = pronto.quadros.get(indice)?.get(frame);
    if (tile === undefined) {
      faltando++;
      return;
    }
    ctx.drawImage(tile, 0, 0, lado, lado, 0, 0, lado * zoom, lado * zoom);
  });

  return faltando;
}

/** Drop the pixel caches. Called when the creator closes — it is the heavy user. */
export function liberarPixelsDoAvatar(): void {
  atlases.clear();
  quadros.limpar();
}
