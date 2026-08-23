/**
 * tokenSheetPlan.ts — what a double click on a token opens.
 *
 * Spec: 41-token.md §5.12 (REQ-TOK-110..114) — the gesture that opens the sheet
 * Spec: 06-canvas-e-renderizacao.md REQ-CNV-094 — the sheet opened FROM a token
 *       shows the EFFECTIVE actor, and an unlinked token owns its own window
 * Spec: 41-token.md REQ-TOK-070/071 — hit points are cut by role everywhere
 *
 * This module is the DECISION, kept pure and free of PIXI, Svelte and the
 * window manager: given the token, the base actor and who is looking, it
 * answers *which* document goes in the window, under which key, and whether
 * that window may write. `openTokenSheet.ts` is the thin arm that carries the
 * decision to the actual sheet opener.
 */

import { resolveEffectiveActor } from "@fusion/shared";

/** The only fields this module reads off a token. */
export interface TokenSheetTokenInput {
  readonly _id: string;
  readonly actorId: string;
  readonly actorLink: boolean;
  readonly actorDelta: Record<string, unknown> | null;
}

export interface TokenSheetViewer {
  /** Privileged role (REQ-USR-013). */
  readonly isGm: boolean;
  /** OWNER (3) over the effective actor (REQ-TOK-032, DEC-TOK-06). */
  readonly isOwner: boolean;
}

export interface TokenSheetPlan {
  readonly actorId: string;
  /** The document the sheet renders: the EFFECTIVE actor (REQ-TOK-112). */
  readonly doc: Record<string, unknown>;
  /** Window identity (REQ-CNV-094). */
  readonly singletonKey: string;
  /** Ownership handed to the sheet component: 3 edits, 0 reads. */
  readonly ownership: number;
  /** True when the window must not write back — see REQ-TOK-113. */
  readonly readOnly: boolean;
}

/**
 * Decide what the gesture opens.
 *
 * Three rules, each with a spec behind it:
 *
 * 1. **The effective actor, not the base one** (REQ-TOK-112, REQ-CNV-094).
 *    A token with a delta is a different creature from the actor it descends
 *    from — showing the base actor would show the wrong hit points, the wrong
 *    name, the wrong art.
 *
 * 2. **An unlinked token owns its window** (REQ-CNV-094). Keying six unlinked
 *    skeletons by their shared `Actor` would collapse six sheets into one.
 *
 * 3. **An unlinked token with a delta opens read-only** (REQ-TOK-113). The
 *    routing REQ-CNV-094 requires for edits — `token:updateActor`
 *    (REQ-DOC-034) — does not exist on the server yet, so an editable window
 *    here would write the change onto the BASE actor and silently alter every
 *    other token of it. Reading is the honest half of the gesture; the other
 *    half unlocks when REQ-DOC-034 lands.
 */
export function planTokenSheet(
  token: TokenSheetTokenInput,
  baseActor: Record<string, unknown>,
  viewer: TokenSheetViewer,
): TokenSheetPlan {
  const hasDelta = !token.actorLink && token.actorDelta !== null;

  const effective = resolveEffectiveActor(
    {
      actorLink: token.actorLink,
      actorDelta: token.actorDelta,
    },
    baseActor as never,
  ) as unknown as Record<string, unknown>;

  const mayEdit = viewer.isGm || viewer.isOwner;

  return {
    actorId: token.actorId,
    doc: effective,
    singletonKey: hasDelta ? `sheet:Token:${token._id}` : `sheet:Actor:${token.actorId}`,
    ownership: hasDelta ? 0 : mayEdit ? 3 : 0,
    readOnly: hasDelta,
  };
}
