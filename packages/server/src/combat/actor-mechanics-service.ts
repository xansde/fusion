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
 * ONDA-4 ADVERSARIAL REVIEW FIXES (2026-09-17, `.fusion-build/alquimista/
 * onda-4/REVISAO.md` B1/B2/B3/I4) — closed the anti-cheat/authority gaps the
 * paragraphs below used to document as open:
 *   - B1: `selfActorId` used to waive BOTH the snapshot AND the source
 *     message's speaker-ownership check; it only waives the snapshot
 *     (`resolveTargets`'s `selfActorId` branch now runs the same
 *     `requireOwnerOfMessageSpeaker` check the default/snapshot branch
 *     always ran — a shared helper so the two paths can never drift apart
 *     again).
 *   - B2: reapplication idempotency is now enforced — a non-privileged
 *     caller repeating the same `(messageId, rollIndex, multiplier, actorId)`
 *     key gets `FORBIDDEN` without reapplying anything (`appliedKeys`,
 *     in-memory per service instance — a live-session guard, not a durable
 *     audit log). Privileged/`"system"` callers are exempt (a GM correcting a
 *     misclick, or `onDamageApplied`'s own recursive `applyDamage` call, must
 *     still be able to reapply).
 *   - B3 (partial): a non-privileged caller's `critical` is now REREAD from
 *     the recorded roll (`degreeOfSuccess === "criticalSuccess"`), never
 *     trusted from the payload — the one field of step 2b derivable WITHOUT
 *     a richer roll shape, since `criticalSuccess` is core-level d20
 *     vocabulary (REQ-ROL-030-family), not PF2e-specific game content
 *     (DEC-SYS-12 stays intact). `nonlethal` has no persisted carrier at all
 *     (see the gap below) — for a non-privileged caller it is now always
 *     forced `false` (the safe default for "cannot verify") rather than
 *     trusted. A non-privileged `multiplier: 2` (mutually exclusive with
 *     `basicSave`) is now rejected unless the recorded roll was itself a
 *     critical success — `0`/`0.5`/`1` are left unvalidated because they can
 *     only ever REDUCE what the mechanic sees, never inflate it, so they are
 *     not an anti-cheat concern the way `2` is. `type`/`category`/`traits`/
 *     `materials` remain payload-trusted — see the gap below, unchanged.
 *   - I4: `flags.dead` now marks the actor's combatant `defeated: true` in
 *     the scene's active encounter, via `combat-handlers.ts`'s
 *     `markCombatantDefeatedForActor` (REQ-CBT-059).
 *
 * KNOWN, DOCUMENTED GAPS still open against the full REQ-SYS-142 text
 * (registered here rather than silently skipped — same discipline ALQ-F1-02
 * used for its own divergences):
 *   - Step 2b's reread of `type`/`category`/`traits`/`materials` from the
 *     recorded roll for a non-privileged caller is NOT implemented:
 *     `RollResultData` (`08-motor-de-rolagens.md`) carries none of these
 *     fields today — there is nothing server-side to reread them FROM (only
 *     `total` and the generic `degreeOfSuccess` string exist on a roll).
 *     A non-privileged caller's `traits`/`materials`/`type`/`category` still
 *     travel from the payload UNVERIFIED into `ResolvedDamageInstance` — a
 *     forged `materials: ["cold-iron"]` still fakes triggering a weakness
 *     against a REAL pf2e mechanic. Cannot be closed without inventing a
 *     richer persisted-roll shape — needs a design decision alongside a pf2e
 *     mechanic task, not a unilateral fix here. Tracked in issue #225
 *     (xansde/fusion).
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

import { DocumentNotFoundError } from "../documents/store.js";
import type { DocumentStore } from "../documents/store.js";
import {
  OwnershipLevel,
  UserRole,
  isRolePrivileged,
  resolveOwnership,
} from "../documents/ownership.js";
import type { Ownership } from "../documents/ownership.js";
import type { SeqStore } from "../net/seq-store.js";
import type { OpBuffer } from "../net/op-buffer.js";
import {
  formatDamageAppliedContent,
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
import { markCombatantDefeatedForActor } from "./combat-handlers.js";

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
  /** I4 fix (REQ-CBT-059): needed by `markCombatantDefeatedForActor` to
   * buffer/broadcast the `combat:updated` envelope when `flags.dead` marks a
   * combatant defeated. */
  opBuffer: OpBuffer;
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
    const actorId = typeof entry["actorId"] === "string" ? entry["actorId"] : null;
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
    : { default: OwnershipLevel.NONE };
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

/**
 * REQ-SYS-142 step 3: "esse `messageId` único DEVE ser de uma mensagem cujo
 * ator de origem o usuário possui como OWNER" — shared by BOTH non-privileged
 * target-resolution paths that reread a roll's amount (the default snapshot
 * path and `selfActorId`).
 *
 * B1 fix (onda-4 adversarial review): before this helper existed, only the
 * default/snapshot branch ran this check — `selfActorId` returned straight
 * after checking ownership of the TARGET actor, never the ownership of the
 * message it was about to read an amount from. A player owning their own
 * character could then name ANY `messageId` in the world (another player's
 * damage roll, the GM's) and have its `total` reread as their own heal/
 * damage. `selfActorId` waives the SNAPSHOT (REQ-SYS-142's own text), never
 * this check — folding both call sites through one function is what keeps
 * them from drifting apart again.
 */
function requireOwnerOfMessageSpeaker(
  store: DocumentStore,
  primaryMessage: Record<string, unknown> | undefined,
  caller: { userId: string; role: number },
): ApplyDamageAck | null {
  if (!primaryMessage) {
    return forbidden("no source message to resolve targets from");
  }
  const casterActorId = readSpeakerActorId(primaryMessage);
  if (!casterActorId) {
    return forbidden("source message has no speaker actor");
  }
  let casterActor: Record<string, unknown>;
  try {
    casterActor = store.get("actors", casterActorId);
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return forbidden("caster actor not found");
    }
    throw err;
  }
  const level = resolveOwnership(readOwnership(casterActor), caller.userId, caller.role);
  if (level < OwnershipLevel.OWNER) {
    return forbidden("not OWNER of the caster actor");
  }
  return null;
}

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
      if (!caller) {
        return { ok: false, ack: forbidden("selfActorId requires an authenticated caller") };
      }
      const level = resolveOwnership(readOwnership(actor), caller.userId, caller.role);
      if (level < OwnershipLevel.OWNER) {
        return { ok: false, ack: forbidden("selfActorId requires OWNER ownership") };
      }
      // B1 fix: selfActorId waives the snapshot, never the source message's
      // own speaker-ownership check (see requireOwnerOfMessageSpeaker's doc
      // comment for the exploit this closes).
      const messageCheck = requireOwnerOfMessageSpeaker(store, primaryMessage, caller);
      if (messageCheck) return { ok: false, ack: messageCheck };
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
    if (!caller) {
      return {
        ok: false,
        ack: forbidden("resolving targets from a source message requires an authenticated caller"),
      };
    }
    const messageCheck = requireOwnerOfMessageSpeaker(store, primaryMessage, caller);
    if (messageCheck) return { ok: false, ack: messageCheck };
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
// Idempotency of reapplication (B2 fix, onda-4 adversarial review) — spec
// 15's 2026-09-15 emenda to REQ-SYS-142: "o serviço DEVE marcar cada
// (messageId, rollIndex, multiplier) já aplicado por instância/alvo, e uma
// segunda aplicação da MESMA chave por usuário sem papel privilegiado DEVE
// responder FORBIDDEN sem reaplicar". Tracked per (instance-source,
// multiplier-or-basicSave-degree, target actor) — the finest grain the spec
// text names ("por instância/alvo") — in an in-memory Set scoped to this
// service instance (one per world namespace, living for the namespace's
// whole lifetime): enough to stop a repeated click/resent op in a live
// session, not a durable audit log surviving a server restart.
// ---------------------------------------------------------------------------

/** The non-multiplier, non-basicSave part of the key is fixed per call; this
 * is the part that distinguishes "same roll scaled differently" (a
 * legitimate ×1 then a corrective ×2 from the GM are different keys) from a
 * genuine repeat. */
function multiplierKeyPart(payload: ActorApplyDamagePayload): string {
  if (payload.multiplier !== undefined) return `x${String(payload.multiplier)}`;
  if (payload.basicSave !== undefined) return `save:${payload.basicSave.degree}`;
  return "x1";
}

/** One idempotency key per (instance with a source, target) pair — the
 * "por instância/alvo" grain REQ-SYS-142's emenda names. Instances without a
 * `source` (privileged/system bare `amount`) are not tracked: there is no
 * recorded roll to guard against replaying. Takes just the actor ids (not the
 * full `ResolvedApplyTarget[]`) so the SAME function can key either the
 * candidate target list (for the pre-flight check) or only the targets that
 * actually resolved to a real actor (for marking after success). */
function idempotencyKeysFor(
  payload: ActorApplyDamagePayload,
  targetActorIds: readonly string[],
): string[] {
  const multiplierPart = multiplierKeyPart(payload);
  const keys: string[] = [];
  for (const instance of payload.instances) {
    if (!instance.source) continue;
    for (const actorId of targetActorIds) {
      keys.push(
        `${instance.source.messageId}::${String(instance.source.rollIndex)}::${multiplierPart}::${actorId}`,
      );
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createActorMechanicsService(
  deps: ActorMechanicsServiceDeps,
): ActorMechanicsService {
  const tokenSource: TokenLookupSource = tokenLookupSourceFromStore(deps.store);
  const appliedKeys = new Set<string>();
  const service: ActorMechanicsService = {
    applyDamage: (rawPayload, caller) =>
      applyDamage(deps, service, tokenSource, appliedKeys, rawPayload, caller),
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
  appliedKeys: Set<string>,
  rawPayload: unknown,
  caller: ActorMechanicsCaller,
): Promise<ApplyDamageAck> {
  const parsed = ActorApplyDamagePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return validationFailed(parsed.error.message);
  }
  const payload = parsed.data;

  // Every check below re-tests `caller === "system"` directly (rather than
  // branching on a boolean alias) so TS narrows `caller` itself within the
  // same expression — `userCtx` is unambiguously `{userId, role}` here.
  const userCtx = caller === "system" ? undefined : caller;
  const privileged = caller === "system" || isRolePrivileged(caller.role);

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
    payload.instances
      .map((i) => i.source?.messageId)
      .filter((messageId): messageId is string => messageId !== undefined),
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

  // B2 fix (idempotency emenda): a non-privileged caller may never reapply
  // the same (messageId, rollIndex, multiplier) to the same target twice.
  // Checked BEFORE calling the mechanic; privileged/system callers are exempt
  // (a GM correction, or onDamageApplied's own recursive "system" call, must
  // still be able to reapply the same key).
  const candidateIdempotencyKeys = idempotencyKeysFor(
    payload,
    targets.map((t) => t.actorId),
  );
  if (!privileged && candidateIdempotencyKeys.some((k) => appliedKeys.has(k))) {
    return forbidden("this (messageId, rollIndex, multiplier) was already applied to this target");
  }

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

  // B3 fix (multiplier vs. degreeOfSuccess, REQ-SYS-142 step 2c): a
  // non-privileged ×2 claim (mutually exclusive with basicSave, which is
  // validated above) is only legal when the recorded roll was itself a
  // critical success — the same core-level d20 vocabulary the `critical`
  // reread below uses, not a PF2e-specific rule (DEC-SYS-12). 0/0.5/1 are
  // left unvalidated: they can only ever REDUCE what the mechanic sees,
  // never inflate it, so they are not an anti-cheat concern the way ×2 is.
  if (!privileged && payload.multiplier === 2 && primaryMessage && primaryMessageId) {
    const recordedDegree = readRollDegree(
      primaryMessage,
      rollIndexForMessage(payload, primaryMessageId),
    );
    if (recordedDegree !== "criticalSuccess") {
      return forbidden("multiplier 2 requires the recorded roll to be a critical success");
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
    let recordedDegree: string | undefined;
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
      recordedDegree = msg ? readRollDegree(msg, instance.source.rollIndex) : undefined;
    } else {
      // DamageInstanceInputSchema's refine guarantees `amount` when `source`
      // is absent (zod refinements are runtime-only — they cannot narrow the
      // static type), so this is a defensive check, not a real branch.
      if (instance.amount === undefined) {
        throw new Error("unreachable: DamageInstanceInputSchema requires amount without source");
      }
      amount = instance.amount;
    }

    // B3 fix (REQ-SYS-142 step 2b): a non-privileged caller's `critical` is
    // REREAD from the recorded roll, never trusted from the payload —
    // `criticalSuccess` is the same generic d20 vocabulary `basicSave.degree`
    // already grades against, so this needs no game-specific mapping
    // (DEC-SYS-12). `nonlethal` has no persisted carrier on a roll at all
    // (see the module doc comment's KNOWN GAP), so the safe "reread" of "no
    // data" is `false` — a non-privileged caller can never make a hit look
    // nonlethal by simply claiming it. Privileged/system callers keep the
    // payload's own value, unchanged.
    const critical =
      !privileged && instance.source !== undefined
        ? recordedDegree === "criticalSuccess"
        : instance.critical;
    const nonlethal = !privileged && instance.source !== undefined ? false : instance.nonlethal;

    resolvedInstances.push({
      type: instance.type,
      amount,
      ...(instance.category !== undefined ? { category: instance.category } : {}),
      ...(instance.traits !== undefined ? { traits: instance.traits } : {}),
      ...(instance.materials !== undefined ? { materials: instance.materials } : {}),
      ...(critical !== undefined ? { critical } : {}),
      ...(nonlethal !== undefined ? { nonlethal } : {}),
    });
  }

  const opts: ApplyDamageOptions = {
    actingAs:
      caller === "system"
        ? "system"
        : { userId: caller.userId, role: UserRole[caller.role] ?? String(caller.role) },
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

    // I4 fix (REQ-CBT-059): flags.dead marks the actor's combatant defeated
    // in the scene's active encounter, if any — same effect/broadcast as
    // combat:setDefeated, in this same op.
    if (patch.flags.dead) {
      markCombatantDefeatedForActor(deps, target.actorId, target.sceneId);
    }

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

  // B2 fix: mark every key ACTUALLY applied (only the targets that resolved
  // to a real actor, never the full candidate list computed before the
  // per-target loop — a target that turned out not to exist consumed no
  // key). Marked unconditionally (not just for non-privileged callers) so a
  // privileged application still blocks a LATER non-privileged replay of the
  // same key.
  for (const key of idempotencyKeysFor(
    payload,
    targetResults.map((t) => t.actorId),
  )) {
    appliedKeys.add(key);
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
  summaryMessage.content = formatDamageAppliedContent(fullPayload);
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
