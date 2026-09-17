/**
 * `item:consume` socket handler + core service — task ALQ-F2-11.
 *
 * Same split as `actor:applyDamage` (DEC-SYS-12, REQ-SYS-143): this module
 * validates the payload, enforces ownership/privilege, guarantees atomicity
 * (`expectedVersion` vs. the actor's `_stats.version`, REQ-SYS-143 step 3),
 * and applies whatever the active system's `ConsumeItemDefinition.plan()`
 * (pure, never writes) describes. The RULE — what charge/quantity to spend,
 * what effect to copy, what to roll, what card to post — lives entirely in
 * the registered `ConsumeItemDefinition` (`registrar.registerConsumeItem`,
 * `@fusion/system-api`); this file owns none of it.
 *
 * ATOMICITY (REQ-SYS-143 step 4) — one documented boundary: `writes` (charge/
 * quantity/resource bookkeeping) and `effects` (copied Effect items) commit
 * together inside ONE `DocumentStore.transaction()` (a real, IMMEDIATE
 * SQLite transaction — this is what makes the CONFLICT race genuinely safe:
 * two concurrent consumes of the same last charge/quantity serialize at the
 * SQLite engine level, and the loser's fresh re-read of `_stats.version`
 * inside the transaction sees the winner's bump). `damage` (healing/damage
 * rolled from the item) is APPLIED AFTER that transaction commits, via
 * `ActorMechanicsService.applyDamage` — which cannot participate in the same
 * synchronous SQLite transaction because it is `async` (awaits its own
 * `onDamageApplied` hooks). This mirrors how `ActorMechanicsService` itself
 * is not one giant transaction across every target either (each target gets
 * its own `store.update`) — "atomic" in this codebase means every genuinely
 * shared-resource step (the item/actor write that a race can corrupt) is
 * transactionally safe, not that two independently-authoritative services
 * merge into a single cross-service transaction. If `writes`/`effects`
 * commit and the later `damage` step throws, the item is already consumed —
 * same accepted risk shape as `onDamageApplied`/`registerConsumeHook`'s own
 * error isolation (REQ-SYS-139) elsewhere in this codebase.
 *
 * `registerConsumeHook` callbacks run AFTER the write above commits and
 * BEFORE this op's own broadcast (REQ-SYS-144 — deliberately the OPPOSITE
 * order from `actor:applyDamage`'s `onDamageApplied`, which runs after ITS
 * broadcast; different ops, different spec text, followed literally here).
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-143/144. Spec: 17-sistema-pf2e.md
 * REQ-PF2-223..225. Plan: docs/design/alquimista/tasks.md §2.6, task
 * ALQ-F2-11.
 */

import type { Namespace } from "socket.io";
import type { Logger } from "pino";
import type { Database as Db } from "better-sqlite3";
import { ItemConsumePayloadSchema, createDocumentId, OwnershipLevel } from "@fusion/shared";
import type {
  ItemConsumePayload,
  ItemConsumeAck,
  ItemConsumeResult,
  ChatSpeaker,
  Envelope,
  Ownership,
} from "@fusion/shared";
import type {
  SystemModule,
  ConsumePlan,
  ConsumePlanContext,
  ItemSnapshot,
  TurnHookContext,
} from "@fusion/system-api";
import { ConsumePlanValidationError } from "@fusion/system-api";

import type { HandlerContext, HandlerFn } from "../handler-registry.js";
import { DocumentNotFoundError } from "../../documents/store.js";
import type { DocumentStoreTransaction, DocumentStore } from "../../documents/store.js";
import { isRolePrivileged, resolveOwnership, UserRole } from "../../documents/ownership.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import { broadcastToWorld } from "./doc-handlers.js";
import { RollService } from "../../chat/roll-service.js";
import type { RollServiceOptions } from "../../chat/roll-service.js";
import {
  buildBaseMessage,
  persistChatMessage,
  broadcastChatMessage,
} from "../../chat/chat-handler.js";
import { tokenLookupSourceFromStore } from "../redaction.js";
import type { TokenLookupSource } from "../redaction.js";
import { resolveTargetSelection } from "../../combat/target-selection.js";
import type { TargetingStore } from "../../combat/targeting-store.js";
import type { ActorMechanicsService } from "../../combat/actor-mechanics-service.js";
import {
  createStubTurnHookContextServices,
  createDocumentWriteTurnHookContextServices,
} from "../../combat/turn-hook-runner.js";
import type { CompendiumService } from "../../compendium/service.js";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface ItemConsumeHandlerDeps {
  store: DocumentStore;
  db: Db;
  ns: Namespace;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  worldId: string;
  systemModule: SystemModule | undefined;
  targetingStore: TargetingStore;
  compendium: CompendiumService;
  actorMechanicsService: ActorMechanicsService;
  /** Injectable for deterministic tests — same pattern as chat-handler.ts's `buildChatSendHandler`. */
  rollServiceOptions?: Partial<RollServiceOptions>;
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Small structural readers (actors/items are untyped `Record<string, unknown>`
// at the DocumentStore boundary — same discipline as actor-mechanics-service.ts).
// ---------------------------------------------------------------------------

function readOwnership(doc: Record<string, unknown>): Ownership {
  const ownership = doc["ownership"];
  return ownership && typeof ownership === "object"
    ? (ownership as Ownership)
    : { default: OwnershipLevel.NONE };
}

function readVersion(doc: Record<string, unknown>): number | undefined {
  const stats = doc["_stats"];
  if (!stats || typeof stats !== "object") return undefined;
  const version = (stats as Record<string, unknown>)["version"];
  return typeof version === "number" ? version : undefined;
}

function readItems(actor: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(actor["items"]) ? (actor["items"] as Record<string, unknown>[]) : [];
}

function findEmbeddedItem(actor: Record<string, unknown>, itemId: string): ItemSnapshot | null {
  return readItems(actor).find((it) => it["_id"] === itemId) ?? null;
}

// ---------------------------------------------------------------------------
// Op-level errors — thrown inside the transaction, caught by the handler and
// mapped to the matching Ack code. Kept local (not exported): this is the
// same "small per-file error type" discipline apply-damage-handler.ts's
// sibling module uses its own `forbidden()`/`validationFailed()` helpers for,
// except here the error needs to cross a `store.transaction()` boundary
// (which only propagates a thrown value, never a return-typed union) so it
// has to be a real Error subclass instead of a returned Ack.
// ---------------------------------------------------------------------------

class ItemConsumeOpError extends Error {
  constructor(
    public readonly code:
      | "PERMISSION_DENIED"
      | "NOT_FOUND"
      | "VALIDATION_FAILED"
      | "CONFLICT"
      | "NOT_SUPPORTED",
    message: string,
  ) {
    super(message);
    this.name = "ItemConsumeOpError";
  }
}

function ackFor(err: ItemConsumeOpError): ItemConsumeAck {
  return { ok: false, code: err.code, message: err.message };
}

// ---------------------------------------------------------------------------
// Find the active (non-ended) combat this actor is a combatant of, if any —
// same scan `combat-handlers.ts`'s `markCombatantDefeatedForActor` already
// uses for the same "which combat is this actor in" question, kept local
// (not exported from there) rather than reusing its module: that function's
// own export surface is scoped to defeat-marking, not a general lookup.
// ---------------------------------------------------------------------------

function findActiveCombatForActor(
  store: DocumentStore,
  actorId: string,
): { combatId: string; round: number } | null {
  const combats = store.getAll("combats");
  const combat = combats.find((c) => {
    if (c["ended"] === true) return false;
    const combatants = c["combatants"];
    return (
      Array.isArray(combatants) &&
      (combatants as Record<string, unknown>[]).some((cbt) => cbt["actorId"] === actorId)
    );
  });
  if (!combat) return null;
  const round = typeof combat["round"] === "number" ? combat["round"] : 0;
  return { combatId: combat["_id"] as string, round };
}

// ---------------------------------------------------------------------------
// Apply plan.writes + plan.effects onto the actor, inside the transaction.
// Returns the updated actor doc, the ids of newly-created effect items, and
// a list of effect-resolution failures (logged, never fatal — REQ-PF2-225
// still expects the charge/quantity spend to go through even when an effect
// ref cannot be resolved).
// ---------------------------------------------------------------------------

interface ApplyWritesResult {
  actorAfter: Record<string, unknown>;
  appliedEffectIds: string[];
}

function applyConsumePlanWrites(
  deps: ItemConsumeHandlerDeps,
  txn: DocumentStoreTransaction,
  actorId: string,
  actorBefore: Record<string, unknown>,
  plan: ConsumePlan,
  planCtx: ConsumePlanContext,
): ApplyWritesResult {
  let items = readItems(actorBefore);
  let actorDiff: Record<string, unknown> = {};

  for (const op of plan.writes) {
    switch (op.kind) {
      case "updateActor":
        actorDiff = { ...actorDiff, ...op.diff };
        break;
      case "createItem": {
        const rawId = op.data["_id"];
        const id = typeof rawId === "string" && rawId.length > 0 ? rawId : createDocumentId();
        items = [...items, { ...op.data, _id: id }];
        break;
      }
      case "updateItem":
        items = items.map((it) => (it["_id"] === op.itemId ? { ...it, ...op.diff } : it));
        break;
      case "deleteItem":
        items = items.filter((it) => it["_id"] !== op.itemId);
        break;
    }
  }

  const appliedEffectIds: string[] = [];
  for (const pe of plan.effects) {
    if (!pe.packId) {
      deps.logger?.warn(
        { sourceId: pe.sourceId },
        "[item-handlers] PlannedEffect without packId — skipped (system must always set it, DEC-SYS-12)",
      );
      continue;
    }
    // I4 fix (onda-5 adversarial review, `.fusion-build/alquimista/onda-5/
    // REVISAO.md`): this used to resolve with the CALLER's own role
    // (`viewerRole`), so a pack marked `audience: "gm"` had its effect
    // applied for the GM and silently skipped (only a `logger.warn`,
    // `ack: {ok:true}`) for a player — even one already authorized (OWNER
    // check above) to consume the item. The audience gate is about what a
    // client may BROWSE in the compendium (REQ-CPD-071); it has no business
    // gating a mechanical effect an already-authorized consume plans to
    // apply. The server resolves this as itself — `UserRole.GAMEMASTER` is
    // used purely as the "privileged enough to see every pack" sentinel
    // here, same discipline as `ApplyDamageOptions.actingAs: "system"`.
    const doc = deps.compendium.getDocumentBySourceRef(UserRole.GAMEMASTER, {
      packName: pe.packId,
      sourceId: pe.sourceId,
    });
    if (!doc) {
      deps.logger?.warn(
        { sourceId: pe.sourceId, packId: pe.packId },
        "[item-handlers] effectRef did not resolve to a pack document — skipped",
      );
      continue;
    }
    const rawSystem =
      doc["system"] && typeof doc["system"] === "object"
        ? (doc["system"] as Record<string, unknown>)
        : {};
    const existingFusion =
      rawSystem["fusion"] && typeof rawSystem["fusion"] === "object"
        ? (rawSystem["fusion"] as Record<string, unknown>)
        : {};
    const newId = createDocumentId();
    const embedded: Record<string, unknown> = {
      _id: newId,
      name: doc["name"],
      type: typeof doc["type"] === "string" ? doc["type"] : "effect",
      img: doc["img"],
      system: {
        ...rawSystem,
        fusion: {
          ...existingFusion,
          origin: pe.origin,
          // Server-resolved ONLY (same discipline as ApplyConditionOptions.now,
          // @fusion/system-api/actor-mechanics.ts) — "what round is it right
          // now" is never client- or plan()-suppliable; the core already knows
          // it via ConsumePlanContext, so it stamps startedAt itself instead of
          // trusting plan() to echo it back.
          startedAt: { combatId: planCtx.combatId, round: planCtx.round },
          expiry: pe.expiry,
        },
      },
    };
    items = [...items, embedded];
    appliedEffectIds.push(newId);
  }

  // `items` always rides the diff (even when unchanged) alongside whatever
  // `updateActor` ops contributed — same "full replacement array" convention
  // `actor-mechanics-service.ts`'s `applyMechanicsPatch` already establishes
  // for `store.update`'s deep-merge (REQ-DOC-037).
  actorDiff = { ...actorDiff, items };

  const updated = txn.update("actors", actorId, actorDiff);
  return { actorAfter: updated ?? actorBefore, appliedEffectIds };
}

// ---------------------------------------------------------------------------
// onConsumed hook context — REQ-SYS-144/140: same TurnHookContext shape and
// wiring `socket-manager.ts` builds for the turn-hook runner (stub +
// document-write services + the real ActorMechanicsService for applyDamage).
// ---------------------------------------------------------------------------

function buildConsumeHookContext(deps: ItemConsumeHandlerDeps, round: number): TurnHookContext {
  return {
    ...createStubTurnHookContextServices(),
    ...createDocumentWriteTurnHookContextServices({
      store: deps.store,
      db: deps.db,
      ns: deps.ns,
      seqStore: deps.seqStore,
      opBuffer: deps.opBuffer,
      worldId: deps.worldId,
    }),
    applyDamage: (p) => deps.actorMechanicsService.applyDamage(p, "system"),
    worldTime: { round, turn: 0 },
  };
}

// ---------------------------------------------------------------------------
// The op
// ---------------------------------------------------------------------------

async function consumeItem(
  deps: ItemConsumeHandlerDeps,
  rollService: RollService,
  tokenSource: TokenLookupSource,
  rawPayload: unknown,
  ctx: HandlerContext,
): Promise<ItemConsumeAck> {
  const parsed = ItemConsumePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION_FAILED", message: parsed.error.message };
  }
  const payload: ItemConsumePayload = parsed.data;

  const def = deps.systemModule?.consumeItem;
  if (!def) {
    return {
      ok: false,
      code: "NOT_SUPPORTED",
      message: "no ConsumeItem plan registered for the active system",
    };
  }

  const privileged = isRolePrivileged(ctx.role);
  const combatInfo = findActiveCombatForActor(deps.store, payload.actorId);
  const planCtx: ConsumePlanContext = {
    inCombat: combatInfo !== null,
    combatId: combatInfo?.combatId ?? null,
    round: combatInfo?.round ?? null,
    targets: resolveTargetSelection(deps.store, deps.targetingStore, ctx.userId).map((t) => ({
      tokenId: t.tokenId,
      actorId: t.actorId,
    })),
    roll: (formula: string) =>
      rollService.roll({
        formula,
        mode: "public",
        worldId: deps.worldId,
        userId: ctx.userId,
        actorId: payload.actorId,
      }).total,
  };

  let txnResult: {
    actorAfter: Record<string, unknown>;
    appliedEffectIds: string[];
    plan: ConsumePlan;
    item: ItemSnapshot | null;
  };
  try {
    txnResult = deps.store.transaction((txn) => {
      let actor: Record<string, unknown>;
      try {
        actor = deps.store.get("actors", payload.actorId);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          throw new ItemConsumeOpError("NOT_FOUND", `actor "${payload.actorId}" not found`);
        }
        throw err;
      }

      if (!privileged) {
        const level = resolveOwnership(readOwnership(actor), ctx.userId, ctx.role);
        if (level < OwnershipLevel.OWNER) {
          throw new ItemConsumeOpError("PERMISSION_DENIED", "not OWNER of the actor");
        }
      }

      // REQ-SYS-143 step 3, checked BEFORE resolving the item (deliberately
      // ahead of the item-existence check below, even though spec 15's own
      // numbered list orders "ator ou item inexistente" (step 2) before
      // "expectedVersion" (step 3)): the race this guards is TWO consumes of
      // the SAME last charge/quantity, and by the time the loser's
      // transaction runs, the winner has ALREADY deleted the item — so an
      // existence check running first would answer NOT_FOUND, an accurate
      // but misleading "wrong id" answer for what is actually "the actor you
      // read is stale, reload and look again" (CONFLICT). The actor's own
      // `_stats.version` is the single fact that distinguishes "stale read"
      // from "always-invalid reference", so it is checked FIRST, against the
      // fresh read every non-conflicting caller also needs.
      const currentVersion = readVersion(actor);
      if (currentVersion !== payload.expectedVersion) {
        throw new ItemConsumeOpError(
          "CONFLICT",
          "actor has been modified since expectedVersion was read",
        );
      }

      let item: ItemSnapshot | null = null;
      if (payload.mode === "use" || payload.mode === "strike") {
        item = findEmbeddedItem(actor, payload.itemId as string);
        if (!item) {
          throw new ItemConsumeOpError(
            "NOT_FOUND",
            `item "${payload.itemId ?? ""}" not found on actor "${payload.actorId}"`,
          );
        }
      }

      if (!def.appliesTo(item, payload)) {
        throw new ItemConsumeOpError(
          "NOT_SUPPORTED",
          "no ConsumeItem plan applies to this item/mode",
        );
      }

      let plan: ConsumePlan;
      try {
        plan = def.plan(actor, item, payload, planCtx);
      } catch (err) {
        if (err instanceof ConsumePlanValidationError) {
          throw new ItemConsumeOpError("VALIDATION_FAILED", err.message);
        }
        throw err;
      }

      const { actorAfter, appliedEffectIds } = applyConsumePlanWrites(
        deps,
        txn,
        payload.actorId,
        actor,
        plan,
        planCtx,
      );

      return { actorAfter, appliedEffectIds, plan, item };
    });
  } catch (err) {
    if (err instanceof ItemConsumeOpError) {
      return ackFor(err);
    }
    throw err;
  }

  const { actorAfter, appliedEffectIds, plan, item } = txnResult;

  // REQ-SYS-143 step 4 (documented boundary — see module header): damage
  // applies AFTER the transactional write, via the real ActorMechanicsService.
  for (const damagePayload of plan.damage) {
    await deps.actorMechanicsService.applyDamage(damagePayload, "system");
  }

  // REQ-SYS-144: onConsumed hooks run after persisting, before THIS op's own broadcast.
  const result: ItemConsumeResult = {
    consumed: plan.consumed,
    appliedEffectIds,
    chatMessageIds: [],
  };
  const hooks = deps.systemModule?.onConsumed ?? [];
  if (hooks.length > 0) {
    const hookCtx = buildConsumeHookContext(deps, planCtx.round ?? 0);
    const systemId = deps.systemModule?.manifest.id ?? "(no system loaded)";
    for (const hook of hooks) {
      try {
        await hook.fn({ actorId: payload.actorId, item, payload, result }, hookCtx);
      } catch (err) {
        deps.logger?.error(
          { err, systemId, hookId: hook.id },
          `[item-handlers] "registerConsumeHook" hook "${hook.id}" (system "${systemId}") threw/rejected — isolated (REQ-SYS-139)`,
        );
      }
    }
  }

  // Broadcast the actor's write (items/quantity changed above) — DocumentStore
  // itself never broadcasts (same discipline as every other handler in this
  // package, e.g. turn-hook-runner.ts's deleteEmbedded).
  const actorSeq = deps.seqStore.next();
  const actorEnvelope: Envelope = {
    type: "doc:update",
    seq: actorSeq,
    ts: Date.now(),
    payload: { documentType: "Actor", documents: [actorAfter] },
  };
  deps.opBuffer.push(actorEnvelope);
  broadcastToWorld(deps.ns, actorEnvelope, "Actor");

  // Post the consume card(s) — REQ-PF2-225.
  const speaker: ChatSpeaker = {
    userId: ctx.userId,
    actorId: payload.actorId,
    alias: "Sistema",
  };
  for (const card of plan.cards) {
    const msg = buildBaseMessage(deps.worldId, speaker, "system", card.content);
    if (card.flags !== undefined) {
      msg.flags = card.flags as Record<string, Record<string, unknown>>;
    }
    persistChatMessage(deps.db, msg);
    const seq = broadcastChatMessage(
      deps.ns,
      deps.seqStore,
      msg,
      speaker.userId,
      "doc:create",
      tokenSource,
    );
    result.chatMessageIds.push(msg._id);
    void seq;
  }

  return { ok: true, result };
}

export function buildItemConsumeHandler(deps: ItemConsumeHandlerDeps): HandlerFn {
  const rollService = new RollService({ db: deps.db, ...deps.rollServiceOptions });
  const tokenSource = tokenLookupSourceFromStore(deps.store);
  return (rawPayload: unknown, ctx: HandlerContext) =>
    consumeItem(deps, rollService, tokenSource, rawPayload, ctx);
}
