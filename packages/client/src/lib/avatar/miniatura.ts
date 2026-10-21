/**
 * miniatura.ts — renders the avatar as a square PNG for the token or the sheet portrait.
 *
 * The figure is drawn once (front, still frame — the first pose of `idle`) at the
 * acervo's native 64x64, cropped to the figure, and enlarged by an INTEGER factor
 * with nearest-neighbour: pixel art must not be smoothed, and a non-integer factor
 * would make some source pixels wider than others. The result is centred on a
 * transparent square.
 *
 * The geometry (bounding box + crop plan) is pure and tested; only
 * `renderizarMiniatura` touches a canvas.
 */

import type { Catalogo, Selecao } from "waybuilder-avatar";
import { ANIMACAO_PADRAO, animacaoDisponivel, ladoDoQuadro } from "./animacao.js";
import { desenharAvatar, prepararAvatar } from "./desenhar.js";

export type ModoMiniatura = "token" | "retrato";

/** Side of the PNG sent to the library. */
export const LADO_DA_MINIATURA = 256;
/** Transparent margin kept around the figure, in source pixels. */
const FOLGA = 2;
/** Share of the figure's height the portrait keeps (head and shoulders). */
const FRACAO_BUSTO = 0.45;

export interface Caixa {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlanoDaMiniatura {
  /** Source square (in the frame's pixels). */
  sx: number;
  sy: number;
  lado: number;
  /** Integer enlargement. */
  escala: number;
  /** Where the enlarged square lands in the target. */
  dx: number;
  dy: number;
}

/** Bounding box of the non-transparent pixels, or null when the frame is empty. */
export function caixaDaFigura(rgba: Uint8ClampedArray, w: number, h: number): Caixa | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((rgba[(y * w + x) * 4 + 3] ?? 0) === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function planoDaMiniatura(
  caixa: Caixa,
  opcoes: { modo: ModoMiniatura; alvo: number; quadro: number },
): PlanoDaMiniatura {
  const { modo, alvo, quadro } = opcoes;
  // The portrait keeps only the top of the figure.
  const regiao: Caixa =
    modo === "retrato" ? { ...caixa, h: Math.max(1, Math.round(caixa.h * FRACAO_BUSTO)) } : caixa;

  const lado = Math.min(quadro, Math.max(regiao.w, regiao.h) + FOLGA * 2);
  const centroX = regiao.x + regiao.w / 2;
  // The bust hugs the top of the figure; the full figure is centred.
  const sy0 = modo === "retrato" ? regiao.y - FOLGA : regiao.y + regiao.h / 2 - lado / 2;
  const sx = Math.round(Math.min(Math.max(0, centroX - lado / 2), quadro - lado));
  const sy = Math.round(Math.min(Math.max(0, sy0), quadro - lado));
  const escala = Math.max(1, Math.floor(alvo / lado));
  const tamanho = lado * escala;
  return {
    sx,
    sy,
    lado,
    escala,
    dx: Math.floor((alvo - tamanho) / 2),
    dy: Math.floor((alvo - tamanho) / 2),
  };
}

/**
 * Draw the avatar and return the PNG, or null when there is no figure to draw.
 * `selecao`/`corpo` are the creator's CURRENT choices — what the preview shows.
 */
export async function renderizarMiniatura(
  catalogo: Catalogo,
  selecao: Selecao,
  corpo: string,
  modo: ModoMiniatura,
): Promise<Blob | null> {
  const animacao = animacaoDisponivel(catalogo, ANIMACAO_PADRAO);
  const pronto = await prepararAvatar(catalogo, selecao, corpo, animacao, { parado: true });
  const lado = ladoDoQuadro(catalogo);

  const origem = document.createElement("canvas");
  origem.width = lado;
  origem.height = lado;
  const octx = origem.getContext("2d", { willReadFrequently: true });
  if (octx === null) return null;

  // Still frame: time 0 is the first pose of the cycle. Every tile was sliced by
  // prepararAvatar, so one paint is the whole figure — it used to retry for 120
  // frames against an atlas cache too small for a dressed figure, then export
  // whatever layers happened to be resident.
  desenharAvatar(octx, pronto, 0, 1);

  const caixa = caixaDaFigura(octx.getImageData(0, 0, lado, lado).data, lado, lado);
  if (caixa === null) return null;

  const plano = planoDaMiniatura(caixa, { modo, alvo: LADO_DA_MINIATURA, quadro: lado });
  const saida = document.createElement("canvas");
  saida.width = LADO_DA_MINIATURA;
  saida.height = LADO_DA_MINIATURA;
  const sctx = saida.getContext("2d");
  if (sctx === null) return null;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(
    origem,
    plano.sx,
    plano.sy,
    plano.lado,
    plano.lado,
    plano.dx,
    plano.dy,
    plano.lado * plano.escala,
    plano.lado * plano.escala,
  );
  return new Promise((resolve) => {
    saida.toBlob((blob) => {
      resolve(blob);
    }, "image/png");
  });
}
