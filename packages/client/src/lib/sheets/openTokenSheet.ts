/**
 * openTokenSheet.ts — carries out the decision planTokenSheet made.
 *
 * Spec: 41-token.md §5.12 (REQ-TOK-110..114), 06-canvas-e-renderizacao.md REQ-CNV-094
 *
 * The split is deliberate: `tokenSheetPlan.ts` decides (pure, fully tested),
 * this file only routes the plan to the right opener. Keeping the decision out
 * of here is what lets the rules be tested without a window manager, a Svelte
 * runtime or a registered sheet.
 */

import type { Socket } from "socket.io-client";
import {
  planTokenSheet,
  type TokenSheetTokenInput,
  type TokenSheetViewer,
} from "./tokenSheetPlan.js";
import { openActorSheet } from "./pf2e/registerPf2eSheets.js";
import { openEtmosActorSheet } from "./etmos/registerEtmosSheets.js";

export interface OpenTokenSheetContext extends TokenSheetViewer {
  readonly userId: string;
  readonly worldId?: string;
  readonly socket?: Socket;
  readonly sendOpFn?: (op: unknown) => void;
}

/**
 * Open the sheet of the actor a token manifests (REQ-TOK-110/112).
 *
 * The caller is responsible for having checked that this user may see it
 * (`canOpenTokenSheet`, REQ-TOK-111) — the gesture's guard lives with the
 * gesture, in TokenInteractionManager, next to the identical guard for moving.
 */
export function openTokenSheet(
  token: TokenSheetTokenInput,
  baseActor: Record<string, unknown>,
  ctx: OpenTokenSheetContext,
): void {
  const plan = planTokenSheet(token, baseActor, { isGm: ctx.isGm, isOwner: ctx.isOwner });

  const opts = {
    userId: ctx.userId,
    ownership: plan.ownership,
    isGm: ctx.isGm,
    singletonKey: plan.singletonKey,
    ...(ctx.worldId !== undefined ? { worldId: ctx.worldId } : {}),
    ...(ctx.socket !== undefined ? { socket: ctx.socket } : {}),
    ...(ctx.sendOpFn !== undefined ? { sendOpFn: ctx.sendOpFn } : {}),
  };

  if (plan.family === "etmos") openEtmosActorSheet(plan.actorId, plan.doc, opts);
  else openActorSheet(plan.actorId, plan.doc, opts);
}
