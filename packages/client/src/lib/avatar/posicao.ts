/**
 * posicao.ts — where the avatar corner stands relative to the drawer and the
 * action bar (spec 53). The avatar is decoration: it must never cover the bar.
 *
 * It lives bottom-right, left of the side drawer. When the (centred, up to 780
 * px) action bar would reach under it — a small window with the drawer open —
 * the avatar rises above the bar instead of overlapping it.
 */

import { ACTION_BAR_BOTTOM_OFFSET, computeBarLayout } from "../actionbar/layout.js";

/** Sprite zoom used by the corner and the 64 px frame it multiplies. */
export const AVATAR_ZOOM = 3;
export const AVATAR_LARGURA = 64 * AVATAR_ZOOM;
/** Gap to the right edge / drawer, and to the bottom when nothing is in the way. */
export const AVATAR_FOLGA = 12;
export const AVATAR_BAIXO = 8;
/** Generous height of the action bar (status strip + slots), used only to clear it. */
export const ALTURA_BARRA_ACOES = 128;

export interface EntradaPosicao {
  viewportWidth: number;
  drawerOpen: boolean;
}

export interface PosicaoDoCanto {
  right: number;
  bottom: number;
  visivel: boolean;
}

export function posicaoDoCanto(entrada: EntradaPosicao): PosicaoDoCanto {
  const barra = computeBarLayout(entrada);
  const right = barra.drawerWidth + AVATAR_FOLGA;
  const visivel = barra.freeWidth >= AVATAR_LARGURA + AVATAR_FOLGA * 2;
  const esquerdaDoAvatar = entrada.viewportWidth - right - AVATAR_LARGURA;
  const direitaDaBarra = barra.centerX + barra.width / 2;
  const colide = barra.width > 0 && direitaDaBarra + AVATAR_FOLGA > esquerdaDoAvatar;
  return {
    right,
    bottom: colide ? ACTION_BAR_BOTTOM_OFFSET + ALTURA_BARRA_ACOES + AVATAR_FOLGA : AVATAR_BAIXO,
    visivel,
  };
}
