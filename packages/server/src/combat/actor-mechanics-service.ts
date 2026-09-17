/**
 * ActorMechanicsService — the CORE half of `actor:applyDamage` (DF-02,
 * REQ-SYS-142, plan §2.1 — task ALQ-F1-08).
 *
 * DEC-SYS-12: the engine does not hardcode game rules. This service:
 *   1. validates the payload against `ActorApplyDamagePayloadSchema`;
 *   2. REREADS amount/targets from the persisted roll (never trusts the
 *      client) — `source: { messageId, rollIndex }` always wins over a
 *      client-sent `amount`; a bare `amount` (no `source`) is only honoured
 *      from a privileged caller or `actingAs: "system"` (DF-03);
 *   3. resolves targets: a non-privileged caller applies to EVERY token in
 *      `flags.fusion.targetSnapshot` of the roll they own (D-02); a
 *      privileged caller may override with `targetTokenIds`;
 *   4. calls the active system's registered `ActorMechanics.applyDamage` ONCE
 *      PER TARGET (never applies IWR/hardness/dying itself — that is the
 *      system's job) and persists the returned patch atomically per actor;
 *   5. publishes the `actor:damageApplied` summary as a ChatMessage, redacted
 *      per role (D-04 — `net/redaction.ts`, never a second predicate);
 *   6. runs `onDamageApplied` once per target (REQ-SYS-142 step 5);
 *   7. answers `NOT_SUPPORTED` without writing anything when no system
 *      registered `registerActorMechanics` (step 6).
 *
 * KNOWN, DOCUMENTED GAPS against the full REQ-SYS-142 text (registered here
 * rather than silently skipped — same discipline ALQ-F1-02 used for its own
 * divergences; see this task's report for the full writeup):
 *   - Step 2b (reread `type`/`category`/`critical`/`nonlethal`/`traits`/
 *     `materials` from the recorded roll for a non-privileged caller) is NOT
 *     implemented: `RollResultData` (`08-motor-de-rolagens.md`) carries none
 *     of these fields today — there is nothing server-side to reread them
 *     FROM. Only `amount` (via `rolls[].total`) and `basicSave.degree` (via
 *     `rolls[].degreeOfSuccess`, below) are anti-cheat-checked.
 *   - Step 2c's `multiplier`-vs-`degreeOfSuccess` validation is not
 *     implemented for the same reason (no core-level mapping from a
 *     system-opaque `degreeOfSuccess` string to a legal multiplier exists).
 *     `basicSave.degree` IS validated (direct string compare) since that
 *     needs no game-specific mapping.
 *   - The idempotency-of-reapplication emenda (marking every
 *     `(messageId, rollIndex, multiplier)` as consumed) is not implemented —
 *     out of this task's own "Entrega"/test list.
 *   - REQ-CBT-059 (marking the combatant `defeated` on `flags.dead`) is not
 *     implemented here — D-03's own "tarefas afetadas" row names F1-01/06/12,
 *     not F1-08.
 *
 * `ActorMechanicsPatch.breakdown` → `DamageAppliedTarget.byType` convention
 * (undocumented anywhere upstream — `DamageBreakdownStep.step` is explicitly
 * "system-defined, not a fixed union" per system-api's own doc comment, and
 * `DamageAppliedTargetSchema` has no field for a full IWR ledger): this
 * service treats a `breakdown` entry as one FINAL per-type damage line when
 * `step` equals a resolved instance's `type` (e.g. `"fire"`), summing
 * `amount` per type. A mechanic that emits no such entries falls back to the
 * PRE-mechanic resolved-instance totals (grouped by type). `resistanceApplied`
 * is left unset either way — no structured carrier for it exists yet. Flagged
 * in the task report for the parallel ALQ-F1-06 lane (the real pf2e
 * mechanic) to confirm or supersede.
 *
 * Spec: 15-api-de-sistemas.md REQ-SYS-142. Spec: 09-chat-e-mensagens.md
 * REQ-CHT-052/053. Plan: docs/design/alquimista/tasks.md §2.1, task
 * ALQ-F1-08.
 */

import type { Namespace } from "socket.io";
import type { Logger } from "pino";
import type { Database as Db } from "better-sqlite3";
import { ActorApplyDamagePayloadSchema, createDocumentId } from "@fusion/shared";
import type {
  ActorApplyDamagePayload,
  ActorDamageAppliedPayload,
  ApplyDamageAck,
  ChatSpeaker,
  DamageAppliedTarget,
  DamageAppliedTypeBreakdown,
} from "@fusion/shared";
import type {
  ActorMechanicsPatch,
  ApplyDamageOptions,
  ResolvedDamageInstance,
  SystemModule,
  TurnHookContext,
} from "@fusion/system-api";

import { DocumentStore, DocumentNotFoundError } from "../documents/store.js";
import {
  OwnershipLevel,
  UserRole,
  isRolePrivileged,
  resolveOwnership,
} from "../documents/ownership.js";
import type { Ownership } from "../documents/ownership.js";
import type { SeqStore } from "../net/seq-store.js";
import {
  redactDamageAppliedPayloadForNonPrivileged,
  tokenLookupSourceFromStore,
} from "../net/redaction.js";
import type { TokenLookupSource } from "../net/redaction.js";
import { locateToken } from "./target-selection.js";
import {
  buildBaseMessage,
  persistChatMessage,
  broadcastChatMessage,
} from "../chat/chat-handler.js";
import { createStubTurnHookContextServices } from "./turn-hook-runner.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Who is invoking the service — mirrors `ApplyDamageOptions.actingAs`, with
 * the server's own numeric role (`HandlerContext.role`) rather than a string. */
export type ActorMechanicsCaller = { userId: string; role: number } | "system";

export interface ActorMechanicsServiceDeps {
  store: DocumentStore;
  /** Raw DB handle — needed by `persistChatMessage` (chat-handler.ts). */
  db: Db;
  ns: Namespace;
  seqStore: SeqStore;
  worldId: string;
  systemModule: SystemModule | undefined;
  logger?: Logger;
}

export interface ActorMechanicsService {
  applyDamage(rawPayload: unknown, caller: ActorMechanicsCaller): Promise<ApplyDamageAck>;
}

// ---------------------------------------------------------------------------
// Small structural readers — chat_messages/actors are untyped
// `Record<string, unknown>` at the DocumentStore boundary (same discipline as
// combat/target-selection.ts).
// ---------------------------------------------------------------------------

interface TargetSnapshotEntry {
  tokenId: string;
  actorId: string | null;
  sceneId: string;
}

function readSpeakerActorId(msg: Record<string, unknown>): string | undefined {
  const speaker = msg["speaker"];
  if (!speaker || typeof speaker !== "object") return undefined;
  const actorId = (speaker as Record<string, unknown>)["actorId"];
  return typeof actorId === "string" ? actorId : undefined;
}

function readRoll(
  msg: Record<string, unknown>,
  rollIndex: number,
): Record<string, unknown> | undefined {
  const rolls = msg["rolls"];
  if (!Array.isArray(rolls)) return undefined;
  const roll = rolls[rollIndex] as unknown;
  return roll && typeof roll === "object" ? (roll as Record<string, unknown>) : undefined;
}

function readRollTotal(msg: Record<string, unknown>, rollIndex: number): number | undefined {
  const total = readRoll(msg, rollIndex)?.["total"];
  return typeof total === "number" ? total : undefined;
}

function readRollDegree(msg: Record<string, unknown>, rollIndex: number): string | undefined {
  const degree = readRoll(msg, rollIndex)?.["degreeOfSuccess"];
  return typeof degree === "string" ? degree : undefined;
}

function readTargetSnapshot(msg: Record<string, unknown>): TargetSnapshotEntry[] {
  const flags = msg["flags"];
  if (!flags || typeof flags !== "object") return [];
  const fusion = (flags as Record<string, unknown>)["fusion"];
  if (!fusion || typeof fusion !== "object") return [];
  const snapshot = (fusion as Record<string, unknown>)["targetSnapshot"];
  if (!Array.isArray(snapshot)) return [];
  const result: TargetSnapshotEntry[] = [];
  for (const raw of snapshot as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const tokenId = entry["tokenId"];
    if (typeof tokenId !== "string") continue;
    const actorId = typeof entry["actorId"] === "string" ? (entry["actorId"] as string) : null;
    const sceneId = typeof entry["sceneId"] === "string" ? entry["sceneId"] : "";
    result.push({ tokenId, actorId, sceneId });
  }
  return result;
}

function readActorName(actor: Record<string, unknown>): string {
  const name = actor["name"];
  return typeof name === "string" && name.length > 0 ? name : "?";
}

function readAttributesHp(actor: Record<string, unknown>): Record<string, unknown> | undefined {
  const system = actor["system"];
  if (!system || typeof system !== "object") return undefined;
  const attributes = (system as Record<string, unknown>)["attributes"];
  if (!attributes || typeof attributes !== "object") return undefined;
  const hp = (attributes as Record<string, unknown>)["hp"];
  return hp && typeof hp === "object" ? (hp as Record<string, unknown>) : undefined;
}

function readHp(actor: Record<string, unknown>): number | undefined {
  const value = readAttributesHp(actor)?.["value"];
  return typeof value === "number" ? value : undefined;
}

function readTempHp(actor: Record<string, unknown>): number | undefined {
  const temp = readAttributesHp(actor)?.["temp"];
  return typeof temp === "number" ? temp : undefined;
}

function readOwnership(doc: Record<string, unknown>): Ownership {
  const ownership = doc["ownership"];
  return ownership && typeof ownership === "object"
    ? (ownership as Ownership)
    : ({ default: OwnershipLevel.NONE } as Ownership);
}

/** Best-effort reverse lookup: the first token anywhere whose `actorId`
 * matches. Used only for `selfActorId` (plan §2.1) — a self-damage payload
 * names an actor, not a token, so the summary's `tokenId` is filled in on a
 * best-effort basis. */
function findTokenForActor(
  store: DocumentStore,
  actorId: string,
): { tokenId: string; sceneId: string } | null {
  for (const scene of store.getAll("scenes")) {
    const tokens = scene["tokens"];
    if (!Array.isArray(tokens)) continue;
    for (const raw of tokens as Record<string, unknown>[]) {
      if (raw["actorId"] !== actorId) continue;
      const tokenId = raw["_id"];
      const sceneId = scene["_id"];
      if (typeof tokenId === "string" && typeof sceneId === "string") {
        return { tokenId, sceneId };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ack helpers
// ---------------------------------------------------------------------------

function forbidden(message: string): ApplyDamageAck {
  return { ok: false, code: "FORBIDDEN", message };
}

function validationFailed(message: string): ApplyDamageAck {
  return { ok: false, code: "VALIDATION_FAILED", message };
}

// ---------------------------------------------------------------------------
// Target resolution (REQ-SYS-142 step 3)
// ---------------------------------------------------------------------------

interface ResolvedApplyTarget {
  tokenId: string | null;
  actorId: string;
  sceneId: string | null;
}

type TargetResolution =
  | {
      ok: true;
      targets: ResolvedApplyTarget[];
      primaryMessage: Record<string, unknown> | undefined;
    }
  | { ok: false; ack: ApplyDamageAck };

function resolveTargets(
  store: DocumentStore,
  payload: ActorApplyDamagePayload,
  privileged: boolean,
  caller: { userId: string; role: number } | undefined,
  primaryMessageId: string | undefined,
): TargetResolution {
  let primaryMessage: Record<string, unknown> | undefined;
  if (primaryMessageId !== undefined) {
    try {
      primaryMessage = store.get("chat_messages", primaryMessageId);
    } catch (err) {
      if (!(err instanceof DocumentNotFoundError)) throw err;
      primaryMessage = undefined;
    }
  }

  // selfActorId dispenses the snapshot; requires OWNER of the actor for a
  // non-privileged caller (plan §2.1: "aplicar em si dispensa snapshot").
  if (payload.selfActorId !== undefined) {
    let actor: Record<string, unknown>;
    try {
      actor = store.get("actors", payload.selfActorId);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return {
          ok: false,
          ack: validationFailed(`selfActorId "${payload.selfActorId}" not found`),
        };
      }
      throw err;
    }
    if (!privileged) {
      const level = resolveOwnership(
        readOwnership(actor),
        caller?.userId ?? null,
        caller!.role as UserRole,
      );
      if (level < OwnershipLevel.OWNER) {
        return { ok: false, ack: forbidden("selfActorId requires OWNER ownership") };
      }
    }
    const token = findTokenForActor(store, payload.selfActorId);
    return {
      ok: true,
      targets: [
        {
          tokenId: token?.tokenId ?? null,
          actorId: payload.selfActorId,
          sceneId: token?.sceneId ?? null,
        },
      ],
      primaryMessage,
    };
  }

  // Privileged override: targetTokenIds names tokens directly.
  if (privileged && payload.targetTokenIds !== undefined && payload.targetTokenIds.length > 0) {
    const resolved: ResolvedApplyTarget[] = [];
    for (const tokenId of payload.targetTokenIds) {
      const loc = locateToken(store, tokenId);
      if (!loc || loc.actorId === null) continue;
      resolved.push({ tokenId, actorId: loc.actorId, sceneId: loc.sceneId });
    }
    if (resolved.length === 0) {
      return {
        ok: false,
        ack: validationFailed("none of targetTokenIds resolved to an actor-bound token"),
      };
    }
    return { ok: true, targets: resolved, primaryMessage };
  }

  // Default: the target snapshot frozen on the origin roll message (D-02).
  if (!primaryMessage) {
    return { ok: false, ack: forbidden("no source message to resolve targets from") };
  }

  if (!privileged) {
    const casterActorId = readSpeakerActorId(primaryMessage);
    if (!casterActorId) {
      return { ok: false, ack: forbidden("source message has no speaker actor") };
    }
    let casterActor: Record<string, unknown>;
    try {
      casterActor = store.get("actors", casterActorId);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return { ok: false, ack: forbidden("caster actor not found") };
      }
      throw err;
    }
    const level = resolveOwnership(
      readOwnership(casterActor),
      caller?.userId ?? null,
      caller!.role as UserRole,
    );
    if (level < OwnershipLevel.OWNER) {
      return { ok: false, ack: forbidden("not OWNER of the caster actor") };
    }
  }

  const snapshot = readTargetSnapshot(primaryMessage);
  const resolved = snapshot
    .filter((s): s is TargetSnapshotEntry & { actorId: string } => s.actorId !== null)
    .map((s) => ({ tokenId: s.tokenId, actorId: s.actorId, sceneId: s.sceneId }));
  if (resolved.length === 0) {
    return { ok: false, ack: forbidden("source message has an empty target snapshot") };
  }
  return { ok: true, targets: resolved, primaryMessage };
}

// ---------------------------------------------------------------------------
// byType / deathCondition derivation
// ---------------------------------------------------------------------------

function computeByType(
  resolvedInstances: readonly ResolvedDamageInstance[],
  breakdown: ActorMechanicsPatch["breakdown"],
): DamageAppliedTypeBreakdown[] {
  const byTypeStep = breakdown.filter((b) => resolvedInstances.some((i) => i.type === b.step));
  const source: Array<{ type: string; amount: number }> =
    byTypeStep.length > 0
      ? byTypeStep.map((b) => ({ type: b.step, amount: b.amount }))
      : resolvedInstances.map((i) => ({ type: i.type, amount: i.amount }));

  const totals = new Map<string, number>();
  for (const entry of source) {
    totals.set(entry.type, (totals.get(entry.type) ?? 0) + entry.amount);
  }
  return [...totals.entries()].map(([type, amount]) => ({ type, amount }));
}

function deriveDeathCondition(
  flags: ActorMechanicsPatch["flags"],
  resolvedInstances: readonly ResolvedDamageInstance[],
): "dead" | "dying" | "unconscious" | null {
  if (flags.dead) return "dead";
  if (!flags.droppedToZero) return null;
  const allNonlethal =
    resolvedInstances.length > 0 && resolvedInstances.every((i) => i.nonlethal === true);
  return allNonlethal ? "unconscious" : "dying";
}

// ---------------------------------------------------------------------------
// Persist diff + embedded (documents/store.ts "update + embutidos")
// ---------------------------------------------------------------------------

function applyMechanicsPatch(
  store: DocumentStore,
  actorId: string,
  actorBefore: Record<string, unknown>,
  patch: ActorMechanicsPatch,
): Record<string, unknown> {
  const toApply: Record<string, unknown> = { ...patch.diff };

  if (patch.embeddedCreate.length > 0 || patch.embeddedDelete.length > 0) {
    const existing = Array.isArray(actorBefore["items"])
      ? (actorBefore["items"] as Record<string, unknown>[])
      : [];
    const deleteSet = new Set(patch.embeddedDelete);
    const kept = existing.filter((item) => {
      const id = item["_id"];
      return typeof id !== "string" || !deleteSet.has(id);
    });
    const usedIds = new Set(
      kept.map((item) => item["_id"]).filter((id): id is string => typeof id === "string"),
    );
    const created = patch.embeddedCreate.map((item) => {
      const rawId = item["_id"];
      if (typeof rawId === "string" && rawId.length > 0 && !usedIds.has(rawId)) {
        usedIds.add(rawId);
        return item;
      }
      let id = createDocumentId();
      while (usedIds.has(id)) id = createDocumentId();
      usedIds.add(id);
      return { ...item, _id: id };
    });
    toApply["items"] = [...kept, ...created];
  }

  const updated = store.update("actors", actorId, toApply);
  return updated ?? actorBefore;
}

// ---------------------------------------------------------------------------
// Chat summary content — plain-text fallback line, ALWAYS the non-privileged
// (no hp) rendering: the interactive card (ALQ-F1-10) is what shows the
// privileged extra via the structured `flags.fusion.damageApplied`, which
// IS redacted per-socket (net/redaction.ts). Keeping `content` itself
// role-invariant means there is only ONE string to reason about for leaks —
// no second "does content also need redacting per socket" question.
// ---------------------------------------------------------------------------

function formatSummaryContent(payload: ActorDamageAppliedPayload): string {
  return payload.targets
    .map(
      (t) =>
        `${t.name} sofreu ${String(t.total)} de dano (${t.byType.map((b) => `${String(b.amount)} ${b.type}`).join(" + ")})`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createActorMechanicsService(
  deps: ActorMechanicsServiceDeps,
): ActorMechanicsService {
  const tokenSource: TokenLookupSource = tokenLookupSourceFromStore(deps.store);
  const service: ActorMechanicsService = {
    applyDamage: (rawPayload, caller) =>
      applyDamage(deps, service, tokenSource, rawPayload, caller),
  };
  return service;
}

/** `TurnHookContext` handed to `onDamageApplied` callbacks — not combat-scoped
 * (a target can take damage outside any encounter), so `worldTime` has no
 * natural round/turn to report; `{round:0, turn:0}` is this task's own,
 * documented default. Every other service is the same stub production wiring
 * uses until ALQ-F1-09+ replace them, except `applyDamage`, which recurses
 * into THIS service with `actingAs: "system"` (REQ-SYS-140: "toda escrita...
 * passa pelo mesmo caminho"). */
function buildOnDamageAppliedContext(service: ActorMechanicsService): TurnHookContext {
  const stub = createStubTurnHookContextServices();
  return {
    ...stub,
    applyDamage: (p) => service.applyDamage(p, "system"),
    worldTime: { round: 0, turn: 0 },
  };
}

/** The `source.rollIndex` of the first instance pointing at `messageId` — used
 * only to grade `basicSave.degree` against that roll's recorded degree. */
function rollIndexForMessage(payload: ActorApplyDamagePayload, messageId: string): number {
  const match = payload.instances.find((i) => i.source?.messageId === messageId);
  return match?.source?.rollIndex ?? 0;
}

async function applyDamage(
  deps: ActorMechanicsServiceDeps,
  service: ActorMechanicsService,
  tokenSource: TokenLookupSource,
  rawPayload: unknown,
  caller: ActorMechanicsCaller,
): Promise<ApplyDamageAck> {
  const parsed = ActorApplyDamagePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return validationFailed(parsed.error.message);
  }
  const payload = parsed.data;

  const isSystem = caller === "system";
  // Re-checks `caller === "system"` directly (rather than branching on the
  // `isSystem` alias) so the narrowing does not depend on TS's aliased-
  // condition inference — `userCtx` is unambiguously `{userId, role}` here.
  const userCtx = caller === "system" ? undefined : caller;
  const privileged = isSystem || isRolePrivileged(userCtx!.role);

  // Step 2: amount without source is privileged/system-only.
  for (const instance of payload.instances) {
    if (instance.source === undefined && !privileged) {
      return forbidden('amount without source requires a privileged role or actingAs "system"');
    }
  }

  // Every instance carrying `source` must share ONE messageId for a
  // non-privileged caller (REQ-SYS-142 step 3) — checked BEFORE resolving
  // targets so a mixed-message payload never combines one roll's total with
  // another roll's snapshot.
  const sourceMessageIds = new Set(
    payload.instances.filter((i) => i.source !== undefined).map((i) => i.source!.messageId),
  );
  if (!privileged && sourceMessageIds.size > 1) {
    return validationFailed("every instance must share the same source.messageId");
  }

  const mechanics = deps.systemModule?.actorMechanics;
  if (!mechanics) {
    return {
      ok: false,
      code: "NOT_SUPPORTED",
      message: "no ActorMechanics registered for the active system",
    };
  }

  const primaryMessageId: string | undefined = sourceMessageIds.values().next().value;
  const targetResolution = resolveTargets(
    deps.store,
    payload,
    privileged,
    userCtx,
    primaryMessageId,
  );
  if (!targetResolution.ok) return targetResolution.ack;
  const { targets, primaryMessage } = targetResolution;

  // basicSave.degree, from a non-privileged caller, MUST match the recorded
  // degree of its roll (REQ-SYS-142 step 2c) — no game-specific mapping
  // needed for a direct string compare.
  if (!privileged && payload.basicSave !== undefined && primaryMessage && primaryMessageId) {
    const recordedDegree = readRollDegree(
      primaryMessage,
      rollIndexForMessage(payload, primaryMessageId),
    );
    if (recordedDegree === undefined || recordedDegree !== payload.basicSave.degree) {
      return forbidden("basicSave.degree does not match the recorded roll's degreeOfSuccess");
    }
  }

  // Resolve each instance's amount — reread from its own source message when
  // present (ALWAYS wins, even for a privileged caller — DF-03/step 2),
  // otherwise the privileged/system-only client-sent amount.
  const messageCache = new Map<string, Record<string, unknown> | null>();
  if (primaryMessageId !== undefined) messageCache.set(primaryMessageId, primaryMessage ?? null);

  const resolvedInstances: ResolvedDamageInstance[] = [];
  for (const instance of payload.instances) {
    let amount: number;
    if (instance.source !== undefined) {
      let msg = messageCache.get(instance.source.messageId);
      if (msg === undefined) {
        try {
          msg = deps.store.get("chat_messages", instance.source.messageId);
        } catch (err) {
          if (!(err instanceof DocumentNotFoundError)) throw err;
          msg = null;
        }
        messageCache.set(instance.source.messageId, msg);
      }
      const total = msg ? readRollTotal(msg, instance.source.rollIndex) : undefined;
      if (total === undefined) {
        return privileged
          ? validationFailed(
              `source roll not found (messageId=${instance.source.messageId}, rollIndex=${String(instance.source.rollIndex)})`,
            )
          : forbidden("source roll not found");
      }
      amount = total;
    } else {
      amount = instance.amount!;
    }
    resolvedInstances.push({
      type: instance.type,
      amount,
      ...(instance.category !== undefined ? { category: instance.category } : {}),
      ...(instance.traits !== undefined ? { traits: instance.traits } : {}),
      ...(instance.materials !== undefined ? { materials: instance.materials } : {}),
      ...(instance.critical !== undefined ? { critical: instance.critical } : {}),
      ...(instance.nonlethal !== undefined ? { nonlethal: instance.nonlethal } : {}),
    });
  }

  const opts: ApplyDamageOptions = {
    actingAs: isSystem
      ? "system"
      : { userId: userCtx!.userId, role: UserRole[userCtx!.role] ?? String(userCtx!.role) },
    ...(payload.multiplier !== undefined ? { multiplier: payload.multiplier } : {}),
    ...(payload.basicSave !== undefined ? { basicSave: payload.basicSave } : {}),
    ...(privileged && payload.hardness !== undefined ? { hardness: payload.hardness } : {}),
    ...(privileged && payload.ignoreResistance !== undefined
      ? { ignoreResistance: payload.ignoreResistance }
      : {}),
  };

  const targetResults: DamageAppliedTarget[] = [];
  const hookEvents: Array<{
    target: DamageAppliedTarget;
    actorAfter: Record<string, unknown> | null;
  }> = [];

  for (const target of targets) {
    let actorBefore: Record<string, unknown>;
    try {
      actorBefore = deps.store.get("actors", target.actorId);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) continue;
      throw err;
    }

    const patch = mechanics.applyDamage(actorBefore, resolvedInstances, opts);
    const actorAfter = applyMechanicsPatch(deps.store, target.actorId, actorBefore, patch);

    const byType = computeByType(resolvedInstances, patch.breakdown);
    const total = byType.reduce((sum, b) => sum + b.amount, 0);
    const tempHpAfter = readTempHp(actorAfter);

    const damageTarget: DamageAppliedTarget = {
      tokenId: target.tokenId ?? target.actorId,
      actorId: target.actorId,
      name: readActorName(actorBefore),
      byType,
      total,
      hpBefore: readHp(actorBefore),
      hpAfter: readHp(actorAfter),
      ...(tempHpAfter !== undefined ? { tempHpAfter } : {}),
      deathCondition: deriveDeathCondition(patch.flags, resolvedInstances),
    };
    targetResults.push(damageTarget);
    hookEvents.push({ target: damageTarget, actorAfter });
  }

  if (targetResults.length === 0) {
    return { ok: false, code: "NOT_FOUND", message: "no target actor could be resolved" };
  }

  const speaker: ChatSpeaker = {
    userId: userCtx?.userId ?? "system",
    ...(primaryMessage && readSpeakerActorId(primaryMessage) !== undefined
      ? { actorId: readSpeakerActorId(primaryMessage) }
      : {}),
    alias: "Sistema",
  };
  const summaryMessage = buildBaseMessage(deps.worldId, speaker, "system", "");
  const fullPayload: ActorDamageAppliedPayload = {
    sourceMessageId: primaryMessage ? (primaryMessage["_id"] as string) : summaryMessage._id,
    targets: targetResults,
  };
  summaryMessage.content = formatSummaryContent(fullPayload);
  summaryMessage.flags = { fusion: { damageApplied: fullPayload } };

  persistChatMessage(deps.db, summaryMessage);
  const seq = broadcastChatMessage(
    deps.ns,
    deps.seqStore,
    summaryMessage,
    speaker.userId,
    "doc:create",
    tokenSource,
  );

  const hookCtx = buildOnDamageAppliedContext(service);
  for (const event of hookEvents) {
    await runOnDamageAppliedHooks(deps, fullPayload.sourceMessageId, event, hookCtx);
  }

  const redactedPayload = redactDamageAppliedPayloadForNonPrivileged(fullPayload);
  const resultPayload = privileged ? fullPayload : redactedPayload;
  return { ok: true, seq, result: resultPayload };
}

/** REQ-SYS-142 step 5: `onDamageApplied` once per target, series,
 * error-isolated — same discipline as turn-hook-runner.ts's `runSeries`
 * (not reused directly: that function is private to that module and its
 * event shape — `{combat, combatant, actor}` — does not fit this hook's
 * combat-less `{target, actor, sourceMessageId}` event). */
async function runOnDamageAppliedHooks(
  deps: ActorMechanicsServiceDeps,
  sourceMessageId: string,
  event: { target: DamageAppliedTarget; actorAfter: Record<string, unknown> | null },
  ctx: TurnHookContext,
): Promise<void> {
  const hooks = deps.systemModule?.combat.turnHooks.onDamageApplied;
  if (!hooks || hooks.length === 0) return;
  const systemId = deps.systemModule?.manifest.id ?? "(no system loaded)";
  for (const hook of hooks) {
    try {
      await hook.fn({ target: event.target, actor: event.actorAfter, sourceMessageId }, ctx);
    } catch (err) {
      deps.logger?.error(
        { err, systemId, hookId: hook.id },
        `[actor-mechanics-service] "onDamageApplied" hook "${hook.id}" (system "${systemId}") threw/rejected — isolated (REQ-SYS-139)`,
      );
    }
  }
}
