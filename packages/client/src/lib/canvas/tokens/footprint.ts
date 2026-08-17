/**
 * footprint.ts — a token's size on the grid, in cells.
 *
 * Spec: 41-token.md REQ-TOK-010, REQ-TOK-012 — `width`/`height` were removed from
 * `TokenDocumentSchema` (TK023): a token has no size field of its own, only the
 * bounding box its effective actor's size category converts to.
 * Spec: 15-sistemas-de-jogo.md REQ-SYS-009 — each system declares the conversion
 * from an actor's size category to a footprint (e.g. PF2e "Large" → 2×2 cells).
 *
 * TK041 is the task that wires that real, per-system conversion. Until it lands,
 * every token occupies exactly one cell, matching the historical hardcoded
 * default `width: 1, height: 1` this module replaces at every call site.
 *
 * Kept as its own module (rather than inlined at each caller) so the day TK041
 * lands there is exactly one place to change — every consumer (TokenSprite,
 * TokenInteractionManager's drag/add snapping) already calls through here.
 */

import type { TokenDocument } from "@fusion/shared";

/** A token's footprint on the grid, in cells. */
export interface TokenFootprint {
  readonly width: number;
  readonly height: number;
}

/**
 * The only fields `footprintOf` will need from the effective actor once TK041
 * derives the real conversion (the actor's size category lives in `system`).
 */
export interface FootprintActorInput {
  system?: Record<string, unknown>;
}

/**
 * Derive a token's footprint (in grid cells) from its effective actor.
 *
 * `token` is accepted (and typed) for the TK041 conversion that reads it
 * (e.g. a token-level size override, if one is ever added) even though today's
 * stub does not look at either argument — see the module doc comment.
 *
 * TK041: derivar do tamanho pelo sistema (REQ-SYS-009).
 */
export function footprintOf(
  _token: TokenDocument | undefined,
  _actor: FootprintActorInput | undefined,
): TokenFootprint {
  return { width: 1, height: 1 };
}
