/**
 * tokenAddDialogVM.ts — the pure logic behind `TokenAddDialog.svelte` (TK022-client).
 *
 * REQ-TOK-002 / DEC-TOK-04: a token with no actor is not a representable state. Before
 * this module, the dialog had no actor PICKER at all — just a raw text input for a
 * hand-typed id, and the submit path built a `{ tokens: { $push: {...} } }` diff that
 * `doc:update` cannot apply (see `lib/docs/tokenCreateOp.ts` for why). This module is
 * everything the dialog needs that can be exercised without mounting a component:
 * turning the world's actors into a searchable list (`filterTokenActorOptions`),
 * validating the form so "no actor selected" disables the button with a legible reason
 * (CA-TOK-003), and building the `doc:create` op (`buildCreateTokenOp`, on top of the
 * shared `buildTokenCreateOp`).
 *
 * Kept out of the component so it can be exercised without a DOM: the client project
 * runs Vitest in a node environment.
 *
 * `defaultTokenPosition` fixes defect 1 of the Fase 1 e2e: the form's "X"/"Y" fields
 * used to default to `(0, 0)`, a corner of the scene's padding margin (REQ-CNV-066),
 * so a token created without the GM touching those fields landed off to the side of
 * the visible map instead of on it. See `lib/canvas/sceneCoords.ts` for why `(0, 0)`
 * is a legitimate scene coordinate (REQ-CNV-011) and not a unit bug.
 */

import { buildTokenCreateOp, type TokenCreateOp } from "../docs/tokenCreateOp.js";
import { sceneContentOffset, type SceneDimensionsInput } from "../canvas/sceneCoords.js";

// ---------------------------------------------------------------------------
// Actor picker
// ---------------------------------------------------------------------------

/** The shape the picker needs from an Actor document — nothing system-specific. */
export interface TokenActorOption {
  readonly id: string;
  readonly name: string;
  readonly img: string | null;
}

/** Minimal Actor document as read from the `DocumentMirror` — see `TokenActorOption`. */
export interface MinimalActorDoc {
  readonly _id: string;
  readonly name: string;
  readonly img?: string | null;
}

/** Project the mirror's raw Actor documents into what the picker renders. */
export function toTokenActorOptions(actors: readonly MinimalActorDoc[]): TokenActorOption[] {
  return actors.map((actor) => ({ id: actor._id, name: actor.name, img: actor.img ?? null }));
}

/**
 * Actors whose name contains `query` (case-insensitive), alphabetical — an empty query
 * returns every actor, so the list is never empty just because nothing was typed yet.
 */
export function filterTokenActorOptions(
  actors: readonly TokenActorOption[],
  query: string,
): TokenActorOption[] {
  const q = query.trim().toLowerCase();
  const matches =
    q === "" ? [...actors] : actors.filter((actor) => actor.name.toLowerCase().includes(q));
  return matches.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------

export interface TokenAddFormData {
  actorId: string;
  name: string;
  x: number;
  y: number;
  hidden: boolean;
}

export interface TokenAddFormErrors {
  /** i18n key — never a raw English string (the component resolves it with `t()`). */
  actorId?: string;
  name?: string;
}

/**
 * CA-TOK-003 / REQ-TOK-002 / REQ-TOK-020: no actor picked, no token — the one rule this
 * form exists to enforce. `name` keeps its own soft cap so a wildly long override is
 * refused before it reaches the wire, same as before this dialog had a picker.
 */
export function validateTokenAddForm(data: TokenAddFormData): TokenAddFormErrors {
  const errs: TokenAddFormErrors = {};
  if (!data.actorId.trim()) errs.actorId = "FUSION.Scenes.TokenAdd.Error.ActorRequired";
  if (data.name.trim().length > 128) errs.name = "FUSION.Scenes.TokenAdd.Error.NameTooLong";
  return errs;
}

export function isTokenAddFormValid(errs: TokenAddFormErrors): boolean {
  return Object.keys(errs).length === 0;
}

// ---------------------------------------------------------------------------
// Default position (defect 1, Fase 1 e2e)
// ---------------------------------------------------------------------------

/**
 * The "X"/"Y" fields' starting value: the middle of the visible map, in scene
 * coordinates (REQ-CNV-011) — not `(0, 0)`, which sits in the scene's padding
 * margin (REQ-CNV-066: staging space around the map, not the map itself).
 * The GM is always free to overwrite it; this only decides what a token
 * looks like when they do not.
 */
export function defaultTokenPosition(scene: SceneDimensionsInput): { x: number; y: number } {
  const { padX, padY } = sceneContentOffset(scene);
  return {
    x: padX + Math.round(scene.width / 2),
    y: padY + Math.round(scene.height / 2),
  };
}

// ---------------------------------------------------------------------------
// Op builder
// ---------------------------------------------------------------------------

/**
 * REQ-TOK-020/021 (§7.2): `actorId`/`x`/`y` are the only mandatory content. `name` and
 * `hidden` are the two overridable fields this dialog exposes — sent only when the
 * caller actually set them (a blank name inherits the actor's own, REQ-TOK-060; an
 * unchecked "hidden" leaves the server default, REQ-TOK-024). REQ-TOK-010/012/022: no
 * `texture`/`width`/`height`/`disposition`/`actorDelta` — none of the fields §7.2 marks
 * derived or refused are ever written here, only the two the dialog itself offers.
 *
 * `data.x`/`data.y` are sent through unchanged as `Token.x`/`y` — REQ-CNV-011 (spec 06)
 * defines "scene coordinates" as origin at the corner of the PADDED area, the same
 * system `TokenSprite`/`TableScreen.handleCanvasDrop`'s `worldX`/`worldY` already use
 * with no conversion of their own, so there is no unit to convert here (see
 * `TokenAddDialog.svelte` for where the *default* shown in these fields comes from —
 * that is the part defect 1 of the Fase 1 e2e was actually about).
 */
export function buildCreateTokenOp(sceneId: string, data: TokenAddFormData): TokenCreateOp {
  const fields: Record<string, unknown> = {
    actorId: data.actorId.trim(),
    x: data.x,
    y: data.y,
  };
  const name = data.name.trim();
  if (name !== "") fields["name"] = name;
  if (data.hidden) fields["hidden"] = true;
  return buildTokenCreateOp(sceneId, fields);
}
