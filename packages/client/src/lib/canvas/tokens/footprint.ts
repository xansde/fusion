/**
 * footprint.ts — a token's size on the grid, in cells.
 *
 * Spec: 41-token.md REQ-TOK-010, REQ-TOK-012, REQ-TOK-017 — `width`/`height` were
 * removed from `TokenDocumentSchema` (TK023): a token has no size field of its
 * own, only the bounding box its effective actor's size category converts to,
 * and that conversion is re-derived on every call — nothing here is cached
 * onto the token, so a creature that changes size mid-game (a growth spell)
 * changes footprint with zero writes to the token (REQ-TOK-017, CA-TOK-002).
 * Spec: 15-api-de-sistemas.md REQ-SYS-009 — each system declares the
 * conversion from an actor's size category to a footprint (e.g. PF2e
 * "Grande" → 2×2 cells) via its manifest's `sizeToFootprint`, and the engine
 * only forwards it — it never arbitrates the rule itself (DEC-TOK-03).
 *
 * The table itself cannot be imported here: the client package must not
 * depend on a game system (REQ-ARQ-005 — `systems/pf2e`/`systems/sf2e` are
 * server-only). `footprintRegistry.svelte.ts` is the door the manifest's
 * declaration crosses (`system:footprint`, TK041); this module only reads it.
 * A category absent from the table — including "the registry hasn't answered
 * yet" and "the world's system declares no table at all" — degrades to 1×1,
 * the same default every token had before this task.
 *
 * Kept as its own module (rather than inlined at each caller) so there is
 * exactly one place a consumer (TokenSprite, TokenInteractionManager's
 * drag/add snapping) calls through to get a footprint.
 *
 * Spec: 17-sistema-pf2e.md DEC-PF2-13 / REQ-PF2-154 — the size the SHEET derived
 * (`system.derived.size`: a character's ancestry, heritage, size chosen at creation
 * and feats that enlarge it) is read FIRST, and `system.traits.size` after it. Until
 * then nothing wrote a character's `traits.size` (it sat at the schema default
 * `med`), so a Minotaur took one square although this module was ready to draw two.
 */

import { readActorSizeCategory, type TokenDocument } from "@fusion/shared";
import { footprintRegistry } from "./footprintRegistry.svelte.js";

/** A token's footprint on the grid, in cells. */
export interface TokenFootprint {
  readonly width: number;
  readonly height: number;
}

/** The only field `footprintOf` needs from the effective actor: its `system` blob. */
export interface FootprintActorInput {
  system?: Record<string, unknown>;
}

const DEFAULT_FOOTPRINT: TokenFootprint = { width: 1, height: 1 };

/**
 * Derive a token's footprint (in grid cells) from its effective actor.
 *
 * `token` is accepted (and typed) for a possible future token-level size
 * override, even though today's derivation does not look at it — the
 * footprint is entirely a function of the actor's size category and the
 * active system's table (REQ-TOK-012, DEC-TOK-03).
 */
export function footprintOf(
  _token: TokenDocument | undefined,
  actor: FootprintActorInput | undefined,
): TokenFootprint {
  // `readActorSizeCategory` (shared with the server): `system.derived.size`, else `system.traits.size`
  // — a bare string, or `{ value }` on some raw/imported rows (the `NpcSizeSchema` shape). The client
  // cannot import a system's schema (REQ-ARQ-005), so the shared reader accepts both shapes defensively.
  const size = readActorSizeCategory(actor?.system);
  if (size === undefined) return DEFAULT_FOOTPRINT;
  return footprintRegistry.sizeToFootprint.get(size) ?? DEFAULT_FOOTPRINT;
}
