/**
 * `companion:command` — the owner commands an animal companion (Command an Animal, L3 I4, BHR-F5-07, D-B10).
 *
 * PF2e remaster: the owner spends an action on THEIR turn and the companion acts that turn; the Support is one of its
 * actions. "Commanded" used to live only in the open sheet (it never expired and was lost on reopen). The server is the
 * authority now: it stamps `commandMark` on the running combat of the owner — `{ combatantId, round, actorIds }` — valid
 * only while that combatant is the active one in that round (the same staleness rule as `attackCount`, so a new turn
 * needs no reset write, and every sheet reads the same fact).
 *
 *   - the companion must be the ACTIVE animal companion of a master (`activeCompanionMasterId`);
 *   - permission: GM/assistant, or OWNER of the MASTER actor;
 *   - in a started, not ended combat that holds the master as a combatant: the master must be the active combatant
 *     (refused with CONFLICT otherwise — Command is an action of the owner's own turn), and the mark is written;
 *   - outside any combat there is nothing to record: `{ marked: false }` and the sheet keeps its local state.
 */

import { CompanionCommandPayloadSchema } from "@fusion/shared";
import type { Ack, CompanionCommandResult, ErrorCode } from "@fusion/shared";
import type { HandlerFn } from "../net/handler-registry.js";
import { DocumentNotFoundError } from "../documents/store.js";
import { OwnershipLevel, isRolePrivileged, resolveOwnership } from "../documents/ownership.js";
import type { Ownership } from "../documents/ownership.js";
import { activeCompanionMasterId } from "./companion-active-handler.js";
import { broadcastUpdate, persistCombat } from "./combat-handlers.js";
import type { CombatHandlerDeps } from "./combat-handlers.js";

type Rec = Record<string, unknown>;

function ackError(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, code, message };
}

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readActorOrNull(deps: CombatHandlerDeps, actorId: string): Rec | null {
  try {
    return deps.store.get("actors", actorId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) return null;
    throw err;
  }
}

export function buildCompanionCommandHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    const parsed = CompanionCommandPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { companionActorId } = parsed.data;

    const companion = readActorOrNull(deps, companionActorId);
    if (companion === null)
      return ackError("NOT_FOUND", `Document not found: Actor/${companionActorId}`);
    const masterId = activeCompanionMasterId(companion);
    if (masterId === undefined) {
      return ackError(
        "VALIDATION_FAILED",
        "The actor is not the active animal companion of a master",
      );
    }
    const master = readActorOrNull(deps, masterId);
    if (master === null) return ackError("NOT_FOUND", `Document not found: Actor/${masterId}`);
    const rawOwnership = master["ownership"];
    const ownership: Ownership = isRec(rawOwnership)
      ? (rawOwnership as Ownership)
      : { default: OwnershipLevel.NONE };
    if (
      !isRolePrivileged(ctx.role) &&
      resolveOwnership(ownership, ctx.userId, ctx.role) < OwnershipLevel.OWNER
    ) {
      return ackError("PERMISSION_DENIED", "companion:command requires OWNER of the master actor");
    }

    for (const combat of deps.store.getAll("combats")) {
      if (combat["started"] !== true || combat["ended"] === true) continue;
      const combatants = Array.isArray(combat["combatants"]) ? (combat["combatants"] as Rec[]) : [];
      const own = combatants.find((c) => c["actorId"] === masterId);
      if (own === undefined) continue;
      const combatId = String(combat["_id"]);
      const combatantId = String(own["_id"]);
      if (combat["activeCombatantId"] !== combatantId) {
        return ackError("CONFLICT", "Command an Animal is an action of the owner's own turn");
      }
      const round = typeof combat["round"] === "number" ? combat["round"] : 0;
      const previous = combat["commandMark"];
      const sameTurn =
        isRec(previous) && previous["combatantId"] === combatantId && previous["round"] === round;
      const already =
        sameTurn && Array.isArray(previous["actorIds"]) ? (previous["actorIds"] as string[]) : [];
      const actorIds = already.includes(companionActorId)
        ? [...already]
        : [...already, companionActorId];
      const commandMark = { combatantId, round, actorIds };
      const updated = persistCombat(deps, combatId, { commandMark });
      broadcastUpdate(deps, updated, { commandMark });
      const result: CompanionCommandResult = { marked: true };
      return { ok: true as const, seq: deps.seqStore.peek(), result };
    }

    const result: CompanionCommandResult = { marked: false };
    return { ok: true as const, seq: deps.seqStore.peek(), result };
  };
}
