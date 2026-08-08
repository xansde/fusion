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
 * EVERY frame is sliced into that cache, recoloured or not. That is what makes
 * the decoded-atlas LRU safe to keep small: once a frame is cached the big image
 * is not needed to draw it again, so an eviction costs at most a re-decode, never
 * a missing layer. It is also what makes the creator's grid cheap — 90 cells
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
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
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
  return quadros.obter(arq, `${sx}:${sy}`, assinatura, () => {
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

/** A composition plus everything needed to draw it without awaiting again. */
export interface AvatarPronto {
  composicao: Composicao;
  animacao: string;
  ciclo: number[];
  fps: number;
  lado: number;
  /** Resolved ramps per layer index; absent when the layer needs no recolour. */
  rampas: Map<number, Rampas[]>;
}

/**
 * Resolve a selection into something drawable: layers, ramps, atlases loaded.
 *
 * Async on purpose, and called on every SELECTION change rather than every
 * frame: the draw itself must be synchronous so it can run inside
 * requestAnimationFrame without a promise between the tick and the pixels.
 */
export async function prepararAvatar(
  catalogo: Catalogo,
  selecao: Selecao,
  corpo: string,
  animacao: string,
): Promise<AvatarPronto> {
  const composicao = montarCamadas(catalogo, selecao, corpo, animacao);

  await garantirPaletas(arquivosDasCamadas(composicao.camadas));
  const paletas = paletasCarregadas();

  const rampas = new Map<number, Rampas[]>();
  composicao.camadas.forEach((camada, indice) => {
    const pedidos = camada.recolor ?? [];
    if (pedidos.length === 0) return;
    const resolvidas = pedidos
      .map((pedido) => resolverRampas(pedido, paletas))
      .filter((r): r is Rampas => r !== null);
    if (resolvidas.length > 0) rampas.set(indice, resolvidas);
  });

  // Load every atlas the composition touches before the first draw, so the
  // figure appears whole instead of assembling itself layer by layer.
  await Promise.all([...new Set(composicao.camadas.map((c) => c.arq))].map(carregarAtlas));

  return {
    composicao,
    animacao,
    ciclo: cicloDe(catalogo, animacao),
    fps: fpsDe(catalogo),
    lado: ladoDoQuadro(catalogo),
    rampas,
  };
}

/**
 * Draw one frame. Synchronous: anything not yet loaded is skipped this tick.
 *
 * `tMs` is a monotonic time, not a frame index — the cycle and fps decide which
 * frame that is, so every avatar on screen animates in step regardless of how
 * often its own canvas repaints.
 *
 * Returns how many layers could NOT be drawn. A STILL sprite (a grid cell) has
 * no next tick to fix itself on, so its caller repaints until this reaches zero;
 * without that, an atlas evicted mid-grid would leave a cell permanently blank.
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
    const atlas = atlases.get(camada.arq);
    if (atlas === undefined) {
      // Not decoded yet (or evicted): ask for it and let the next tick draw it.
      void carregarAtlas(camada.arq);
      faltando++;
      return;
    }

    const frame = frameEm(tMs, pronto.ciclo, pronto.fps, camada.frames);
    const sx = camada.x + frame * lado;
    const sy = camada.y;
    const rampas = pronto.rampas.get(indice) ?? [];

    const tile = quadroDaCamada(
      atlas,
      camada.arq,
      sx,
      sy,
      lado,
      rampas.length > 0 ? assinaturaDoRecolor(camada) : "",
      rampas,
    );
    ctx.drawImage(tile, 0, 0, lado, lado, 0, 0, lado * zoom, lado * zoom);
  });

  return faltando;
}

/** Drop the pixel caches. Called when the creator closes — it is the heavy user. */
export function liberarPixelsDoAvatar(): void {
  atlases.clear();
  quadros.limpar();
}
