/**
 * Frame timing for the avatar's animation.
 *
 * Pure: takes a timestamp, gives back which frame of the strip to draw. That is
 * what lets the loop live in a component and the arithmetic be tested.
 *
 * The frame ORDER is not `0..n`. The acervo carries a cycle per animation
 * (`recorte.ciclos`, lifted from the LPC generator's own constants), and it
 * matters: `walk` is `[1..8]` and skips frame 0, which is the standing pose — in
 * raw order the walk hitches once per lap. `idle` is `[0,0,1,1]`, i.e. each pose
 * held for two ticks, which is what makes it read as breathing instead of a
 * twitch.
 */

import type { Catalogo } from "waybuilder-avatar";

/** What the corner overlay loops when nothing is going on. */
export const ANIMACAO_PADRAO = "idle";

/** What it loops while a combat is running. */
export const ANIMACAO_COMBATE = "combat_idle";

/** Frames per second when the catalog does not say (the generator's own value). */
const FPS_PADRAO = 8;

/** Frame side in pixels, when the catalog does not say. */
const LADO_PADRAO = 64;

export function fpsDe(catalogo: Catalogo): number {
  const fps = catalogo.recorte.fps;
  return fps !== undefined && fps > 0 ? fps : FPS_PADRAO;
}

export function ladoDoQuadro(catalogo: Catalogo): number {
  const lado = catalogo.recorte.altura_do_frame;
  return lado > 0 ? lado : LADO_PADRAO;
}

/**
 * The frame cycle of an animation.
 *
 * Falls back to a single still frame rather than to `[0..n]`: a catalog without
 * `ciclos` is an older acervo, and inventing a cycle for it would animate strips
 * in an order nobody authored.
 */
export function cicloDe(catalogo: Catalogo, animacao: string): number[] {
  const ciclo = catalogo.recorte.ciclos?.[animacao];
  return ciclo !== undefined && ciclo.length > 0 ? ciclo : [0];
}

/**
 * Which frame to draw at time `tMs`, clamped to what the layer actually has.
 *
 * `quadros` is the layer's own frame count: a piece whose animation was
 * substituted has exactly 1, and it must stay on frame 0 forever instead of
 * following the cycle into a neighbour's art.
 */
export function frameEm(tMs: number, ciclo: readonly number[], fps: number, quadros = Infinity): number {
  if (ciclo.length === 0 || quadros <= 1) return 0;
  const passo = Math.floor((Math.max(0, tMs) * fps) / 1000);
  const indice = ((passo % ciclo.length) + ciclo.length) % ciclo.length;
  const frame = ciclo[indice] ?? 0;
  return Math.min(frame, Math.max(0, quadros - 1));
}

/**
 * Pick an animation the acervo actually has, preferring the requested one.
 *
 * The corner overlay asks for `combat_idle` during a fight; an acervo cut
 * without it must fall back to `idle` rather than draw the first frame of
 * whatever happened to be first in the strip.
 */
export function animacaoDisponivel(catalogo: Catalogo, ...preferidas: string[]): string {
  const disponiveis = catalogo.recorte.animacoes;
  for (const nome of preferidas) {
    if (disponiveis.includes(nome)) return nome;
  }
  return disponiveis[0] ?? ANIMACAO_PADRAO;
}
