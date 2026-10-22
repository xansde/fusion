/**
 * posicao.ts — where the avatar overlay stands on the viewer's screen (spec 53).
 *
 * Each viewer chooses (lib/avatar/preferencias.ts): one of the four corners, or a
 * free spot dragged by hand, and a size. Whatever they choose, the avatar is
 * decoration and stays out of the way of the table's controls:
 *
 *   - never under the side drawer, the header, or past the viewport edge;
 *   - never over the action bar: a box that would overlap the (centred, up to
 *     920 px) bar is lifted above it;
 *   - hidden when the free area cannot hold it at all.
 *
 * Pure: the component feeds it the viewport and the preferences and applies
 * `left`/`top` (px from the top-left of the viewport).
 */

import { ACTION_BAR_BOTTOM_OFFSET, computeBarLayout } from "../actionbar/layout.js";

/** Gap to the drawer / right edge. */
export const AVATAR_FOLGA = 12;
/** Gap to the bottom edge when nothing is in the way. */
export const AVATAR_BAIXO = 8;
/** Top of the usable area: under the 48 px header, plus air. */
export const AVATAR_TOPO = 48 + AVATAR_FOLGA;
/** Left of the usable corners: clear of the scene tools column. */
export const AVATAR_ESQUERDA = 60;
/** Generous height of the action bar (status strip + slots), used only to clear it. */
export const ALTURA_BARRA_ACOES = 128;

/** Size bounds of the overlay, in px (the sprite's frame is 64). */
export const TAMANHO_MINIMO = 64;
export const TAMANHO_MAXIMO = 320;
export const TAMANHO_PADRAO = 192;

export type CantoDoAvatar =
  | "inferior-direito"
  | "inferior-esquerdo"
  | "superior-direito"
  | "superior-esquerdo";

export const CANTOS: readonly CantoDoAvatar[] = [
  "superior-esquerdo",
  "superior-direito",
  "inferior-esquerdo",
  "inferior-direito",
];

/** A dragged position: the box's top-left as a fraction of the viewport. */
export interface PosicaoLivre {
  x: number;
  y: number;
}

export interface EntradaPosicao {
  viewportWidth: number;
  viewportHeight: number;
  drawerOpen: boolean;
  /** Side of the square box, px. */
  tamanho: number;
  canto: CantoDoAvatar;
  livre: PosicaoLivre | null;
  oculto?: boolean;
  /**
   * The action bar as measured on screen (`[data-action-bar]`'s rect), or null
   * when there is no bar. Omitted: estimated from the layout (centred, up to
   * 920 px, {@link ALTURA_BARRA_ACOES} tall) — the estimate misses the bar's tab
   * row, so the component passes the real rect whenever it has one.
   */
  barra?: { left: number; right: number; top: number } | null;
}

export interface PosicaoDoAvatar {
  left: number;
  top: number;
  visivel: boolean;
}

function limitar(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max));
}

export function posicaoDoAvatar(entrada: EntradaPosicao): PosicaoDoAvatar {
  const { viewportWidth: vw, viewportHeight: vh, tamanho: t } = entrada;
  const barra = computeBarLayout({ viewportWidth: vw, drawerOpen: entrada.drawerOpen });
  const direitaLivre = vw - barra.drawerWidth;
  const visivel =
    entrada.oculto !== true && barra.freeWidth >= t + AVATAR_FOLGA * 2 && vh >= AVATAR_TOPO + t;

  // The bar's rectangle: measured when the caller has it, estimated otherwise.
  const medida = entrada.barra;
  const temBarra = medida === undefined ? barra.width > 0 : medida !== null;
  const barraEsq = medida ? medida.left : barra.centerX - barra.width / 2;
  const barraDir = medida ? medida.right : barra.centerX + barra.width / 2;
  const topoDaBarra = medida ? medida.top : vh - (ACTION_BAR_BOTTOM_OFFSET + ALTURA_BARRA_ACOES);
  const acimaDaBarra = topoDaBarra - AVATAR_FOLGA - t;
  const cruzaABarra = (left: number) =>
    temBarra && left < barraDir + AVATAR_FOLGA && left + t > barraEsq - AVATAR_FOLGA;

  let left: number;
  let top: number;

  if (entrada.livre !== null) {
    left = limitar(Math.round(entrada.livre.x * vw), 0, direitaLivre - t);
    top = limitar(Math.round(entrada.livre.y * vh), AVATAR_TOPO, vh - t);
    if (cruzaABarra(left) && top + t > topoDaBarra) top = Math.max(AVATAR_TOPO, acimaDaBarra);
    return { left, top, visivel };
  }

  const direita = entrada.canto.endsWith("direito");
  const baixo = entrada.canto.startsWith("inferior");
  left = direita ? direitaLivre - AVATAR_FOLGA - t : AVATAR_ESQUERDA;
  if (baixo) {
    top = vh - AVATAR_BAIXO - t;
    if (cruzaABarra(left)) top = Math.max(AVATAR_TOPO, acimaDaBarra);
  } else {
    top = AVATAR_TOPO;
  }
  return { left, top, visivel };
}

/**
 * The integer sprite zoom that covers `tamanho`: the canvas is drawn at this zoom
 * and scaled down by CSS to the exact size, so pixel art never gets smoothed up.
 */
export function zoomParaTamanho(tamanho: number, lado = 64): number {
  return Math.max(1, Math.ceil(tamanho / lado));
}
