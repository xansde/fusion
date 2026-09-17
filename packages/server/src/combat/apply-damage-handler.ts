/**
 * `actor:applyDamage` socket handler — task ALQ-F1-08.
 *
 * A thin adapter: maps the socket dispatcher's `HandlerContext` (userId,
 * numeric role) onto `ActorMechanicsService.applyDamage`'s caller contract
 * and returns whatever Ack the service decided (already redacted per role —
 * REQ-SYS-142: "o ack devolvido a usuário sem papel privilegiado DEVE seguir
 * a mesma redação do resumo"). All validation, permission and anti-cheat
 * logic lives in `actor-mechanics-service.ts`; this file owns none of it.
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-142. Plan: docs/design/alquimista/
 * tasks.md §2.1, task ALQ-F1-08.
 */

import type { HandlerContext, HandlerFn } from "../net/handler-registry.js";
import type { ActorMechanicsService } from "./actor-mechanics-service.js";

export interface ApplyDamageHandlerDeps {
  service: ActorMechanicsService;
}

export function buildApplyDamageHandler(deps: ApplyDamageHandlerDeps): HandlerFn {
  return (rawPayload: unknown, ctx: HandlerContext) =>
    deps.service.applyDamage(rawPayload, { userId: ctx.userId, role: ctx.role });
}
