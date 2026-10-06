/**
 * `actor:applyCondition` socket handler — task ALQ-F1-09.
 *
 * A thin adapter: maps the socket dispatcher's `HandlerContext` (userId,
 * numeric role) onto `ActorMechanicsService.applyCondition`'s caller contract
 * and returns whatever Ack the service decided. All validation, permission
 * (GM: any actor; player: their own actor (OWNER) or tokens in their live
 * TargetSelection — REQ-CBT-056) and the game-rule dispatch live in
 * `actor-mechanics-service.ts` (core) / the registered system's
 * `ActorMechanics.applyCondition` (rule) — this file owns none of it. Same
 * skeleton as `apply-damage-handler.ts` (ALQ-F1-08).
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-142. Spec: 17-sistema-pf2e.md
 * REQ-PF2-215. Spec: 10-combate-e-iniciativa.md REQ-CBT-056. Plan:
 * docs/design/alquimista/tasks.md §2.4, task ALQ-F1-09.
 */

import type { HandlerContext, HandlerFn } from "../net/handler-registry.js";
import type { ActorMechanicsService } from "./actor-mechanics-service.js";

export interface ApplyConditionHandlerDeps {
  service: ActorMechanicsService;
}

export function buildApplyConditionHandler(deps: ApplyConditionHandlerDeps): HandlerFn {
  return (rawPayload: unknown, ctx: HandlerContext) =>
    deps.service.applyCondition(rawPayload, { userId: ctx.userId, role: ctx.role });
}
