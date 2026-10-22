/**
 * imagemDoAtor.ts — the guards around "Usar como token / retrato".
 *
 * Writing the actor's `img` replaces the art every token of that actor shows,
 * so the creator never writes a value it has not checked, and asks before it
 * replaces art the player brought from elsewhere (18/10 incident: Bhrotto's
 * token art was lost). Pure, so the rules are tested without a socket.
 */

import { isPortraitPlaceholder } from "../common/portrait.js";
import { ehArteDeAvatar } from "./arteDeAvatar.js";

/** What the avatar upload must hand back: one PNG straight under /assets/. */
const CAMINHO_DE_ARTE = /^\/assets\/[A-Za-z0-9._-]+\.png$/;

/** True for a path the creator may write to `img`; anything else aborts the write. */
export function caminhoDeArteValido(caminho: unknown): caminho is string {
  return typeof caminho === "string" && CAMINHO_DE_ARTE.test(caminho);
}

/**
 * Whether replacing `imgAtual` needs the player's explicit OK.
 *
 * No when there is nothing real there (empty, placeholder, compendium stub) or
 * when it is already avatar art — iterating on the avatar is the normal loop, and
 * the server remembers the replaced image either way.
 */
export function precisaConfirmarSubstituicao(imgAtual: string | null | undefined): boolean {
  if (isPortraitPlaceholder(imgAtual)) return false;
  return !ehArteDeAvatar(imgAtual);
}

/** The remembered image is worth offering only when it differs from the current one. */
export function podeRestaurar(
  imgAtual: string | null | undefined,
  anterior: string | null,
): anterior is string {
  return anterior !== null && anterior.trim() !== "" && anterior !== (imgAtual ?? "");
}
