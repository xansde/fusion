/**
 * Combat handlers — all combat:* ops routed from the socket dispatcher.
 *
 * Spec: 10-combate-e-iniciativa.md §REQ-CBT-001..035, §DEC-CBT-01..07
 * REQ-CBT-001: GM creates encounter (combat:create)
 * REQ-CBT-002: add token as combatant (combat:addCombatant)
 * REQ-CBT-003: remove combatant (combat:removeCombatant)
 * REQ-CBT-004: start/next/prev/end (combat:start/next/previous/end)
 * REQ-CBT-005: state persisted after each transition
 * REQ-CBT-006: combatEnd event + ended=true (combat:end)
 * REQ-CBT-010..016: initiative roll (combat:rollInitiative), set (combat:setInitiative), reset (combat:resetInitiative)
 * REQ-CBT-017: manual reorder (combat:reorder)
 * REQ-CBT-020..023: nextTurn/previousTurn with skipDefeated
 * REQ-CBT-024..025: toggleDefeated
 * REQ-CBT-026..029: lifecycle events (turnStart/turnEnd/roundStart/roundEnd)
 * REQ-CBT-031..035: hidden combatant redaction
 * DEC-CBT-06: one active combat per scene in MVP
 *
 * ## Security disciplines
 *
 * Privilege model:
 *   - GM (role ≥ ASSISTANT_GM) = full control
 *   - Player = can only roll initiative for combatants linked to an actor they own
 *
 * Hidden combatant redaction:
 *   All payloads containing CombatDocument are routed through
 *   stripHiddenCombatants() before being emitted to non-GM sockets.
 *   This is the SINGLE source of truth — never redact inline in handlers.
 *
 * Concurrency:
 *   combat:next and combat:previous are inherently serialized by Node.js
 *   single-threaded event loop (GM-only, no shared mutable state across ticks).
 */

import type { Namespace } from "socket.io";
import type { Logger } from "pino";
import type { HandlerFn, HandlerContext } from "../net/handler-registry.js";
import type { SeqStore } from "../net/seq-store.js";
import type { OpBuffer } from "../net/op-buffer.js";
import type { DocumentStore } from "../documents/store.js";
import { DocumentNotFoundError } from "../documents/store.js";
import {
  isRolePrivileged,
  testOwnership,
  UserRole,
  OwnershipLevel,
} from "../documents/ownership.js";
import type { Ownership } from "../documents/ownership.js";
import { stripHiddenCombatantsFromCombat } from "../net/redaction.js";
import type { Database as Db } from "better-sqlite3";
import type { SystemModule } from "@fusion/system-api";
import type { InitiativeFormulaRegistry } from "./initiative-registry.js";
import type { CombatEventBus } from "./combat-event-bus.js";
import { buildInitiativeRollBroadcaster, type InitiativeRollChatEntry } from "./combat-chat.js";
import { runActorDerivation } from "../net/derive-runner.js";
import {
  CombatCreatePayloadSchema,
  CombatBeginPayloadSchema,
  CombatAddCombatantPayloadSchema,
  CombatRemoveCombatantPayloadSchema,
  CombatRollInitiativePayloadSchema,
  CombatSetInitiativePayloadSchema,
  CombatResetInitiativePayloadSchema,
  CombatNextPayloadSchema,
  CombatPreviousPayloadSchema,
  CombatSetDefeatedPayloadSchema,
  CombatSetHiddenPayloadSchema,
  CombatReorderPayloadSchema,
  CombatEndPayloadSchema,
  sortCombatants,
  activeCombatant,
  computeActiveCombatantId,
  nextTurnIndex,
  previousTurnIndex,
  createDocumentId,
} from "@fusion/shared";
import type {
  CombatDocument,
  CombatantDocument,
  CombatTurnSnapshot,
  Ack,
  ErrorCode,
  Envelope,
} from "@fusion/shared";

// ---------------------------------------------------------------------------
// Handler dependency bundle
// ---------------------------------------------------------------------------

export interface CombatHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: Namespace;
  formulaRegistry: InitiativeFormulaRegistry;
  eventBus: CombatEventBus;
  /** Raw DB handle — used to persist/broadcast initiative chat messages (CA-CBT-002). */
  db: Db;
  /** World id this handler set is bound to (chat message worldId). */
  worldId: string;
  /**
   * The world's resolved SystemModule, when available. Used as an on-read
   * safety net in combat:rollInitiative (audit issue 3): compendium-imported
   * or otherwise pre-existing Actor documents may have no persisted
   * `system.derived` (e.g. imported before the compendium import-time
   * derivation fix landed). Deriving on read here guarantees the initiative
   * formula always sees a populated `system.derived.perception` regardless
   * of how/when the actor entered the world. Optional — undefined skips this
   * safety net (stub system, or no system package loaded); the formula falls
   * back to whatever `system.derived` already contains (possibly nothing).
   */
  systemModule?: SystemModule;
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Ack helpers
// ---------------------------------------------------------------------------

function ackOk<R>(result: R, seq: number): Ack<R> {
  return { ok: true, seq, result };
}

function ackError(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, code, message };
}

// ---------------------------------------------------------------------------
// Hidden-combatant redaction
//
// REQ-CBT-031: hidden combatants must NEVER reach non-GM sockets.
//
// This is the SINGLE redaction point for combat documents. Every path that
// sends a CombatDocument to clients must funnel through this function for
// non-GM sockets.
// ---------------------------------------------------------------------------

/**
 * Strip hidden combatants from a CombatDocument for non-privileged players.
 *
 * Thin re-export of the canonical redaction helper so combat handlers and the
 * sync/ack paths share ONE implementation (no drift). REQ-CBT-031.
 */
export const stripHiddenCombatants = stripHiddenCombatantsFromCombat;

/**
 * Return true if the combat document contains at least one hidden combatant.
 */
function combatHasHiddenCombatants(combat: Record<string, unknown>): boolean {
  const combatants = combat["combatants"];
  if (!Array.isArray(combatants)) return false;
  return (combatants as Record<string, unknown>[]).some((c) => c["hidden"] === true);
}

/**
 * Return true if the active combatant (by activeCombatantId) is hidden.
 * Used to decide whether to mask the active pointer in player payloads
 * (REQ-CBT-031, audit issue M2-C #4).
 */
function combatActiveIsHidden(combat: Record<string, unknown>): boolean {
  const activeId = combat["activeCombatantId"];
  if (typeof activeId !== "string") return false;
  const combatants = combat["combatants"];
  if (!Array.isArray(combatants)) return false;
  return (combatants as Record<string, unknown>[]).some(
    (c) => c["_id"] === activeId && c["hidden"] === true,
  );
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

/**
 * Broadcast a combat state change to all sockets in the namespace.
 *
 * For GM sockets: full combat document (including hidden combatants).
 * For player sockets: combat document with hidden combatants stripped.
 *
 * Uses per-socket iteration when the combat has hidden combatants; otherwise
 * falls back to the cheap namespace-wide emit.
 */
function broadcastCombatUpdate(
  ns: Namespace,
  envelope: Envelope,
  combatDoc: Record<string, unknown>,
): void {
  if (!combatHasHiddenCombatants(combatDoc)) {
    ns.emit("op", envelope);
    return;
  }

  // Build the player-visible payload once (strip hidden combatants)
  const payload = envelope.payload as {
    combat?: Record<string, unknown>;
    combatId?: string;
    diff?: Record<string, unknown>;
  };
  let playerEnvelope: Envelope;

  // Whether the currently-active combatant is hidden — if so its id/tokenId
  // must not leak to players via the diff's activeCombatantId (issue M2-C #4).
  const activeIsHidden = combatActiveIsHidden(combatDoc);

  if (payload.combat) {
    // stripHiddenCombatants also masks activeCombatantId when the active
    // combatant is hidden, so the combat-body path is fully covered.
    const strippedCombat = stripHiddenCombatants(payload.combat);
    playerEnvelope = {
      ...envelope,
      payload: { ...payload, combat: strippedCombat },
    };
  } else if (payload.diff) {
    const diff = payload.diff;
    const needsCombatantStrip =
      typeof diff["combatants"] !== "undefined" && Array.isArray(diff["combatants"]);
    const needsActiveMask = activeIsHidden && typeof diff["activeCombatantId"] !== "undefined";

    if (needsCombatantStrip || needsActiveMask) {
      const newDiff: Record<string, unknown> = { ...diff };
      if (needsCombatantStrip) {
        newDiff["combatants"] = (diff["combatants"] as Record<string, unknown>[]).filter(
          (c) => c["hidden"] !== true,
        );
      }
      if (needsActiveMask) {
        newDiff["activeCombatantId"] = null;
      }
      playerEnvelope = { ...envelope, payload: { ...payload, diff: newDiff } };
    } else {
      playerEnvelope = envelope;
    }
  } else {
    playerEnvelope = envelope;
  }

  for (const [, socket] of ns.sockets) {
    const data = socket.data as Record<string, unknown> | null | undefined;
    const role = typeof data?.["role"] === "number" ? data["role"] : 0;
    if (isRolePrivileged(role)) {
      socket.emit("op", envelope);
    } else {
      socket.emit("op", playerEnvelope);
    }
  }
}

/**
 * Build and buffer a broadcast envelope.
 */
function buildEnvelope(type: string, payload: unknown, seq: number): Envelope {
  return {
    type: type as Envelope["type"],
    seq,
    ts: Date.now(),
    payload,
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/**
 * Persist the Combat document update to the store.
 * Applies the diff on top of the existing document, validates it, and saves.
 */
function persistCombat(
  deps: CombatHandlerDeps,
  combatId: string,
  diff: Partial<CombatDocument>,
): CombatDocument {
  const { store } = deps;

  // Use the DocumentStore's raw update mechanism
  const updated = store.update("combats", combatId, diff, {
    userId: null,
  });

  if (!updated) {
    throw new Error(`Combat ${combatId} update returned null — document may not have changed`);
  }

  return updated as unknown as CombatDocument;
}

/**
 * Add the recomputed `activeCombatantId` to a diff before persisting.
 *
 * The active combatant is identified by `_id` (not by index) so the value
 * survives redaction when sent to players (REQ-CBT-042/050). Any transition
 * that changes the combatants array order, the turnIndex, or the started flag
 * must funnel through this so the persisted `activeCombatantId` stays in sync
 * with `turnIndex`.
 *
 * The effective state is the diff field when present, else the value from the
 * currently-loaded combat (mirrors the deep-merge that persistCombat applies).
 */
function withActiveCombatantId(
  current: CombatDocument,
  diff: Partial<CombatDocument>,
): Partial<CombatDocument> {
  const combatants = diff.combatants ?? current.combatants;
  const turnIndex = diff.turnIndex ?? current.turnIndex;
  const started = diff.started ?? current.started;
  return {
    ...diff,
    activeCombatantId: computeActiveCombatantId(combatants, turnIndex, started),
  };
}

/**
 * Load a combat document from the store. Throws if not found.
 */
function loadCombat(deps: CombatHandlerDeps, combatId: string): CombatDocument {
  try {
    return deps.store.get("combats", combatId) as unknown as CombatDocument;
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      throw new DocumentNotFoundError("combats", combatId);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Turn snapshot builder
// ---------------------------------------------------------------------------

function buildSnapshot(combat: CombatDocument): CombatTurnSnapshot {
  const combatant = activeCombatant(combat.combatants, combat.turnIndex, combat.started);
  return {
    round: combat.round,
    turnIndex: combat.turnIndex,
    combatantId: combatant?._id ?? null,
    tokenId: combatant?.tokenId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Broadcast + buffer a combat update with optional turnChange
// ---------------------------------------------------------------------------

function broadcastUpdate(
  deps: CombatHandlerDeps,
  updatedCombat: CombatDocument,
  diff: Partial<CombatDocument>,
  prev?: CombatTurnSnapshot,
): number {
  const { seqStore, opBuffer, ns } = deps;
  const seq = seqStore.next();

  const combatPayload = updatedCombat as unknown as Record<string, unknown>;

  // combat:updated envelope (diff-based)
  const updatedPayload = {
    combatId: updatedCombat._id,
    diff: diff as Record<string, unknown>,
    seq,
  };
  const updatedEnvelope = buildEnvelope("combat:updated", updatedPayload, seq);
  opBuffer.push(updatedEnvelope);
  broadcastCombatUpdate(ns, updatedEnvelope, combatPayload);

  // combat:turnChange — emitted additionally for fast canvas turn marker update.
  if (prev !== undefined) {
    const current = buildSnapshot(updatedCombat);
    const turnChangePayload = { combatId: updatedCombat._id, current, previous: prev };
    const turnChangeEnvelope = buildEnvelope("combat:turnChange", turnChangePayload, seq);

    // Issue M2-C #4: combat:turnChange carries combatantId/tokenId of the active
    // (and previous) combatant. If either references a hidden combatant, a player
    // would learn its id/position. Redact those snapshots for non-GM sockets.
    const hiddenIds = collectHiddenCombatantIds(updatedCombat);
    if (hiddenIds.size === 0) {
      // Nothing hidden anywhere — cheap namespace-wide emit.
      ns.emit("op", turnChangeEnvelope);
    } else {
      const playerCurrent = redactSnapshotForPlayer(current, hiddenIds);
      const playerPrevious = redactSnapshotForPlayer(prev, hiddenIds);
      const playerEnvelope = buildEnvelope(
        "combat:turnChange",
        { combatId: updatedCombat._id, current: playerCurrent, previous: playerPrevious },
        seq,
      );
      for (const [, socket] of ns.sockets) {
        const data = socket.data as Record<string, unknown> | null | undefined;
        const role = typeof data?.["role"] === "number" ? data["role"] : 0;
        socket.emit("op", isRolePrivileged(role) ? turnChangeEnvelope : playerEnvelope);
      }
    }
  }

  return seq;
}

/**
 * Collect the _ids of all hidden combatants in a combat document.
 */
function collectHiddenCombatantIds(combat: CombatDocument): Set<string> {
  const ids = new Set<string>();
  for (const c of combat.combatants) {
    if (c.hidden) ids.add(c._id);
  }
  return ids;
}

/**
 * Mask a turn snapshot for a player when its combatant is hidden.
 *
 * When the snapshot's combatantId is a hidden combatant, both combatantId and
 * tokenId are nulled so the player learns nothing about the hidden combatant's
 * identity or token position (REQ-CBT-031, issue M2-C #4). round/turnIndex are
 * preserved (they are not, on their own, identifying — and the player's tracker
 * already shows the round). Returns the original reference when no masking is
 * needed (zero allocation on the fast path).
 */
function redactSnapshotForPlayer(
  snapshot: CombatTurnSnapshot,
  hiddenIds: ReadonlySet<string>,
): CombatTurnSnapshot {
  if (snapshot.combatantId === null || !hiddenIds.has(snapshot.combatantId)) {
    return snapshot;
  }
  return { ...snapshot, combatantId: null, tokenId: null };
}

// ---------------------------------------------------------------------------
// Lifecycle event emission helpers
//
// REQ-CBT-026..029: emit in the correct order around state transitions.
// ---------------------------------------------------------------------------

function emitTurnEnd(
  deps: CombatHandlerDeps,
  combat: CombatDocument,
  combatant: CombatantDocument,
): void {
  deps.eventBus.emitLifecycle({ type: "turnEnd", combat, combatant });
}

function emitTurnStart(
  deps: CombatHandlerDeps,
  combat: CombatDocument,
  combatant: CombatantDocument,
  previous: CombatTurnSnapshot,
): void {
  deps.eventBus.emitLifecycle({ type: "turnStart", combat, combatant, previous });
}

function emitRoundEnd(deps: CombatHandlerDeps, combat: CombatDocument, round: number): void {
  deps.eventBus.emitLifecycle({ type: "roundEnd", combat, round });
}

function emitRoundStart(deps: CombatHandlerDeps, combat: CombatDocument, round: number): void {
  deps.eventBus.emitLifecycle({ type: "roundStart", combat, round });
}

// ---------------------------------------------------------------------------
// combat:create — GM creates a new encounter
// REQ-CBT-001, DEC-CBT-06
// ---------------------------------------------------------------------------

export function buildCombatCreateHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can create a combat encounter");
    }

    const parsed = CombatCreatePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { sceneId, combatType } = parsed.data;

    // DEC-CBT-06: one active combat per scene in MVP
    const existing = deps.store.getAll("combats");
    const activeForScene = existing.find((c) => c["sceneId"] === sceneId && c["ended"] !== true);
    if (activeForScene) {
      // GRUPO 4 (combat panel deadlock, #6) — self-heal defense-in-depth:
      // include the conflicting combatId in the rejection message so a
      // client whose local combatStore.combat is out of sync (e.g. a stale
      // mirror, or a race between two GMs) can recover instead of dead-
      // ending on an empty-state "Create Combat" button that always fails.
      // The client-side fix (resolveActiveCombat scoping by sceneId) closes
      // the root cause; this is the belt-and-suspenders fallback for any
      // remaining desync window.
      const conflictingId = activeForScene["_id"] as string;
      return ackError(
        "VALIDATION_FAILED",
        `A combat encounter already exists for scene ${sceneId} (combatId=${conflictingId}). End it before creating another (DEC-CBT-06).`,
      );
    }

    const combatDoc: Partial<CombatDocument> = {
      _id: createDocumentId(),
      sceneId,
      round: 0,
      turnIndex: 0,
      started: false,
      ended: false,
      skipDefeated: true,
      autoPan: false,
      combatType: combatType ?? "standard",
      trackedResource: null,
      combatants: [],
      activeCombatantId: null,
      flags: {},
      sort: 0,
    };

    let created: CombatDocument;
    try {
      created = deps.store.create("combats", combatDoc, {
        userId: ctx.userId,
      }) as unknown as CombatDocument;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return ackError("VALIDATION_FAILED", msg);
    }

    const { seqStore, opBuffer, ns } = deps;
    const seq = seqStore.next();
    const combatPayload = created as unknown as Record<string, unknown>;
    const createdPayload = { combat: created };
    const envelope = buildEnvelope("combat:created", createdPayload, seq);
    opBuffer.push(envelope);
    broadcastCombatUpdate(ns, envelope, combatPayload);

    return ackOk({ combat: created }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:start — GM begins the encounter
// REQ-CBT-004, REQ-CBT-020
// ---------------------------------------------------------------------------

export function buildCombatStartHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can start combat");
    }

    const parsed = CombatBeginPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    if (combat.started) {
      return ackError("VALIDATION_FAILED", "Combat has already been started");
    }
    if (combat.ended) {
      return ackError("VALIDATION_FAILED", "Combat has already ended");
    }

    const diff: Partial<CombatDocument> = withActiveCombatantId(combat, {
      started: true,
      round: 1,
      turnIndex: 0,
    });

    let updatedCombat: CombatDocument;
    try {
      updatedCombat = persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to persist combat start");
    }

    const prev = buildSnapshot(combat);
    const seq = broadcastUpdate(deps, updatedCombat, diff, prev);

    // Emit lifecycle events: combatStart, then turnStart for the first combatant
    deps.eventBus.emitLifecycle({ type: "combatStart", combat: updatedCombat });

    const firstCombatant = activeCombatant(updatedCombat.combatants, 0, true);
    if (firstCombatant) {
      emitTurnStart(deps, updatedCombat, firstCombatant, prev);
    }

    return ackOk({ combat: updatedCombat }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:addCombatant — GM adds a token to the encounter
// REQ-CBT-002
// ---------------------------------------------------------------------------

export function buildCombatAddCombatantHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can add combatants");
    }

    const parsed = CombatAddCombatantPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId, tokenId, actorId, initiative, hidden } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    if (combat.ended) {
      return ackError("VALIDATION_FAILED", "Cannot add combatants to an ended combat");
    }

    // Resolve token details (name, img, actorId) from the scene's token
    let name = "Unknown";
    let img: string | null = null;
    let resolvedActorId: string | null = actorId ?? null;
    let hasPlayerOwner = false;

    // Try to look up the token in the scene for better defaults
    try {
      const scene = deps.store.get("scenes", combat.sceneId);
      const tokens = scene["tokens"];
      if (Array.isArray(tokens)) {
        const token = (tokens as Record<string, unknown>[]).find((t) => t["_id"] === tokenId);
        if (token) {
          name = typeof token["name"] === "string" ? token["name"] : "Unknown";
          img = typeof token["img"] === "string" ? token["img"] : null;
          if (resolvedActorId === null && typeof token["actorId"] === "string") {
            resolvedActorId = token["actorId"];
          }
        }
      }
    } catch {
      // Scene not found or token missing — use defaults; not fatal
    }

    // Check if the actor has a player owner. "Has a player owner" is true
    // when EITHER `ownership.default` itself resolves to OWNER (every player
    // owns this Actor) OR at least one explicit per-user entry resolves to
    // OWNER for a PLAYER role. Both checks are routed through
    // testOwnership/resolveOwnership (documents/ownership.ts, the single
    // source of truth for default/INHERIT resolution) instead of a bare
    // `val >= 3` numeric comparison that used to skip `default` entirely —
    // that hand-rolled read missed the "every player owns this" case.
    if (resolvedActorId) {
      try {
        const actor = deps.store.get("actors", resolvedActorId);
        const ownership = actor["ownership"];
        if (ownership && typeof ownership === "object" && !Array.isArray(ownership)) {
          const ownerMap = ownership as Ownership;
          hasPlayerOwner =
            defaultGrantsPlayerOwnership(ownerMap) ||
            Object.keys(ownerMap).some(
              (key) =>
                key !== "default" &&
                testOwnership(ownerMap, key, UserRole.PLAYER, OwnershipLevel.OWNER),
            );
        }
      } catch {
        // Actor not found — hasPlayerOwner stays false
      }
    }

    const newCombatant: CombatantDocument = {
      _id: createDocumentId(),
      tokenId,
      actorId: resolvedActorId,
      name,
      img,
      initiative: initiative ?? null,
      initiativeStatistic: null,
      hidden: hidden ?? false,
      defeated: false,
      hasPlayerOwner,
      flags: {},
    };

    // Sort combatants after adding (if any have initiative)
    const formula = deps.formulaRegistry.getFormulaForCombatType(combat.combatType);
    const updatedCombatants = sortCombatants([...combat.combatants, newCombatant], formula);

    const diff: Partial<CombatDocument> = withActiveCombatantId(combat, {
      combatants: updatedCombatants,
    });

    let updatedCombat: CombatDocument;
    try {
      updatedCombat = persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to persist combatant addition");
    }

    const seq = broadcastUpdate(deps, updatedCombat, diff);
    return ackOk({ combat: updatedCombat, combatant: newCombatant }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:removeCombatant — GM removes a combatant
// REQ-CBT-003
// ---------------------------------------------------------------------------

export function buildCombatRemoveCombatantHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can remove combatants");
    }

    const parsed = CombatRemoveCombatantPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId, combatantId } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    const combatantIdx = combat.combatants.findIndex((c) => c._id === combatantId);
    if (combatantIdx === -1) {
      return ackError("NOT_FOUND", `Combatant not found: ${combatantId}`);
    }

    const newCombatants = combat.combatants.filter((c) => c._id !== combatantId);

    // Adjust turn index if necessary (stable pointer after removal)
    let newTurn = combat.turnIndex;
    if (newCombatants.length === 0) {
      newTurn = 0;
    } else if (combatantIdx < combat.turnIndex) {
      newTurn = Math.max(0, combat.turnIndex - 1);
    } else if (combat.turnIndex >= newCombatants.length) {
      newTurn = newCombatants.length - 1;
    }

    const diff: Partial<CombatDocument> = withActiveCombatantId(combat, {
      combatants: newCombatants,
      turnIndex: newTurn,
    });

    let updatedCombat: CombatDocument;
    try {
      updatedCombat = persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to persist combatant removal");
    }

    const seq = broadcastUpdate(deps, updatedCombat, diff);
    return ackOk({ combat: updatedCombat }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:rollInitiative — roll initiative via RollService (server-side RNG)
// REQ-CBT-010..016, DEC-CBT-03
// Security: player can only roll for their own PC combatants
// ---------------------------------------------------------------------------

export function buildCombatRollInitiativeHandler(deps: CombatHandlerDeps): HandlerFn {
  return async (rawPayload, ctx: HandlerContext) => {
    const parsed = CombatRollInitiativePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId, combatantIds, options = {} } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    if (combat.ended) {
      return ackError("VALIDATION_FAILED", "Cannot roll initiative for an ended combat");
    }

    // Determine which combatants to roll for
    let targets: CombatantDocument[];

    // REQ-CBT-034: a player may roll a PC's initiative ONLY when the encounter
    // has not yet started OR that PC's initiative is still null. Once combat is
    // running, a player must not re-roll an already-set initiative (anti-cheat).
    // GMs are unrestricted.
    const playerMayRoll = (c: CombatantDocument): boolean =>
      !combat.started || c.initiative === null;

    if (!combatantIds || combatantIds.length === 0) {
      // Roll all combatants without initiative
      if (isRolePrivileged(ctx.role)) {
        targets = combat.combatants.filter((c) => c.initiative === null);
      } else {
        // Player "roll all" only applies to their own combatants that they are
        // still allowed to roll (REQ-CBT-034).
        targets = combat.combatants.filter(
          (c) => c.initiative === null && isOwnedByPlayer(deps, c, ctx.userId) && playerMayRoll(c),
        );
      }
    } else {
      // Specific combatant ids
      targets = [];
      for (const cid of combatantIds) {
        const combatant = combat.combatants.find((c) => c._id === cid);
        if (!combatant) {
          return ackError("NOT_FOUND", `Combatant not found: ${cid}`);
        }
        // Permission: non-GM can only roll for their own PC combatants
        if (!isRolePrivileged(ctx.role)) {
          if (!isOwnedByPlayer(deps, combatant, ctx.userId)) {
            return ackError(
              "PERMISSION_DENIED",
              `You do not own combatant ${cid} and cannot roll their initiative`,
            );
          }
          // REQ-CBT-034: reject re-rolls of an already-set initiative once the
          // encounter has started.
          if (!playerMayRoll(combatant)) {
            return ackError(
              "PERMISSION_DENIED",
              `Initiative for combatant ${cid} is already set and combat has started; players cannot re-roll it`,
            );
          }
        }
        targets.push(combatant);
      }
    }

    if (targets.length === 0) {
      return ackOk({ combat, rolledCount: 0 }, deps.seqStore.peek());
    }

    const formula = deps.formulaRegistry.getFormulaForCombatType(combat.combatType);

    // Try to load the actor for each target (formula may need it)
    let anyError: string | null = null;
    const tiebreakerMap = new Map<string, number>();

    // CA-CBT-002/009: accumulate per-combatant results for the chat broadcast.
    const initiativeRolls: InitiativeRollChatEntry[] = [];

    // Roll for each target
    const updatedCombatants = [...combat.combatants];
    for (const target of targets) {
      let actor: Record<string, unknown> | null = null;
      if (target.actorId) {
        try {
          actor = deps.store.get("actors", target.actorId);
        } catch {
          // Actor missing — formula handles null gracefully per contract
        }
      }

      // WIRING-DERIVE (audit issue 3): compute-on-read safety net — an actor
      // that predates the compendium import-time derivation fix (or any
      // other drift) may have no persisted `system.derived`, which would
      // make the initiative formula silently fall back to +0 (e.g. an
      // imported NPC's "Perception" statistic masking a real, non-zero mod).
      // Mutates a shallow clone so this read-only view never persists.
      // Import-time derivation (CompendiumService.importToWorld) remains the
      // primary fix — this is defense-in-depth only, cheap because
      // runActorDerivation is a pure, synchronous, I/O-free function.
      if (actor && deps.systemModule) {
        try {
          const clone: Record<string, unknown> = { ...actor };
          const sys = actor["system"];
          // Deep-clone (audit issue 5) — see doc-handlers.ts
          // recomputeDerivedIfNeeded for why a shallow clone of `system` is
          // not enough (some DeriveSteps mirror computed values onto nested
          // objects like system.abilities.<ability>.mod).
          clone["system"] =
            sys && typeof sys === "object" && !Array.isArray(sys)
              ? structuredClone(sys as Record<string, unknown>)
              : {};
          runActorDerivation(clone, deps.systemModule);
          actor = clone;
        } catch (err) {
          deps.logger?.warn(
            { err, actorId: target.actorId },
            "Actor derivation failed while rolling initiative — using actor as-read",
          );
        }
      }

      const rollCtx = {
        combatant: target,
        actor,
        combat,
        options,
      };

      let rollResult: { total: number; tiebreaker?: number; statistic?: string };
      try {
        rollResult = await formula.roll(rollCtx);
      } catch (err) {
        anyError = err instanceof Error ? err.message : String(err);
        break;
      }

      if (rollResult.tiebreaker !== undefined) {
        tiebreakerMap.set(target._id, rollResult.tiebreaker);
      }

      const idx = updatedCombatants.findIndex((c) => c._id === target._id);
      const existing = idx === -1 ? undefined : updatedCombatants[idx];
      if (existing) {
        updatedCombatants[idx] = {
          ...existing,
          initiative: rollResult.total,
          initiativeStatistic: rollResult.statistic ?? existing.initiativeStatistic,
        };
        initiativeRolls.push({
          combatantName: existing.name,
          actorId: existing.actorId,
          total: rollResult.total,
          statistic: rollResult.statistic ?? existing.initiativeStatistic,
          hidden: existing.hidden,
        });
      }
    }

    if (anyError) {
      return ackError("INTERNAL_ERROR", `Initiative roll failed: ${anyError}`);
    }

    // Re-sort with new tiebreakers
    const sortedCombatants = sortCombatants(updatedCombatants, formula, tiebreakerMap);

    const diff: Partial<CombatDocument> = withActiveCombatantId(combat, {
      combatants: sortedCombatants,
    });

    let updatedCombat: CombatDocument;
    try {
      updatedCombat = persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to persist initiative rolls");
    }

    // CA-CBT-002 / CA-CBT-009: broadcast each initiative result to the chat.
    // Author = the user who initiated the roll. Hidden combatants are GM-only.
    const broadcastInitiativeRolls = buildInitiativeRollBroadcaster({
      db: deps.db,
      ns: deps.ns,
      seqStore: deps.seqStore,
      worldId: deps.worldId,
      authorId: ctx.userId,
    });
    broadcastInitiativeRolls(initiativeRolls);

    const seq = broadcastUpdate(deps, updatedCombat, diff);
    return ackOk({ combat: updatedCombat, rolledCount: targets.length }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:setInitiative — GM sets a combatant's initiative manually
// REQ-CBT-014
// ---------------------------------------------------------------------------

export function buildCombatSetInitiativeHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can set initiative manually");
    }

    const parsed = CombatSetInitiativePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId, combatantId, value } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    const combatantIdx = combat.combatants.findIndex((c) => c._id === combatantId);
    const targetCombatant = combatantIdx === -1 ? undefined : combat.combatants[combatantIdx];
    if (!targetCombatant) {
      return ackError("NOT_FOUND", `Combatant not found: ${combatantId}`);
    }

    const updatedCombatants = [...combat.combatants];
    updatedCombatants[combatantIdx] = {
      ...targetCombatant,
      initiative: value,
    };

    const formula = deps.formulaRegistry.getFormulaForCombatType(combat.combatType);
    const sortedCombatants = sortCombatants(updatedCombatants, formula);

    const diff: Partial<CombatDocument> = withActiveCombatantId(combat, {
      combatants: sortedCombatants,
    });

    let updatedCombat: CombatDocument;
    try {
      updatedCombat = persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to persist initiative");
    }

    const seq = broadcastUpdate(deps, updatedCombat, diff);
    return ackOk({ combat: updatedCombat }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:resetInitiative — GM resets all initiatives to null
// REQ-CBT-015
// ---------------------------------------------------------------------------

export function buildCombatResetInitiativeHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can reset initiative");
    }

    const parsed = CombatResetInitiativePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    const resetCombatants = combat.combatants.map((c) => ({
      ...c,
      initiative: null,
    }));

    const diff: Partial<CombatDocument> = withActiveCombatantId(combat, {
      combatants: resetCombatants,
    });

    let updatedCombat: CombatDocument;
    try {
      updatedCombat = persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to reset initiatives");
    }

    const seq = broadcastUpdate(deps, updatedCombat, diff);
    return ackOk({ combat: updatedCombat }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:next — advance to the next turn
// REQ-CBT-004, REQ-CBT-021, REQ-CBT-023, REQ-CBT-026..028
//
// Lifecycle order (REQ-CBT-026..028):
//   1. Emit turnEnd for the current combatant
//   2. If round changes: emit roundEnd for the ending round
//   3. If round changes: emit roundStart for the new round
//   4. Persist new state
//   5. Emit turnStart for the new combatant
//   6. Broadcast
// ---------------------------------------------------------------------------

export function buildCombatNextHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can advance combat turns");
    }

    const parsed = CombatNextPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    if (!combat.started) {
      return ackError("VALIDATION_FAILED", "Combat has not been started yet");
    }
    if (combat.ended) {
      return ackError("VALIDATION_FAILED", "Combat has already ended");
    }

    const prev = buildSnapshot(combat);

    // Compute next turn/round
    const next = nextTurnIndex(
      combat.combatants,
      combat.turnIndex,
      combat.round,
      combat.skipDefeated,
    );

    if (!next) {
      return ackError("VALIDATION_FAILED", "No eligible combatants to advance to");
    }

    const prevCombatant = activeCombatant(combat.combatants, combat.turnIndex, combat.started);
    const roundChanged = next.round !== combat.round;

    // Emit lifecycle events BEFORE persisting (REQ-CBT-026)
    if (prevCombatant) {
      emitTurnEnd(deps, combat, prevCombatant);
    }

    if (roundChanged) {
      emitRoundEnd(deps, combat, combat.round);
    }

    const diff: Partial<CombatDocument> = withActiveCombatantId(combat, {
      turnIndex: next.turnIndex,
      round: next.round,
    });

    let updatedCombat: CombatDocument;
    try {
      updatedCombat = persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to advance combat turn");
    }

    if (roundChanged) {
      emitRoundStart(deps, updatedCombat, next.round);
    }

    const newCombatant = activeCombatant(updatedCombat.combatants, next.turnIndex, true);
    if (newCombatant) {
      emitTurnStart(deps, updatedCombat, newCombatant, prev);
    }

    const seq = broadcastUpdate(deps, updatedCombat, diff, prev);
    return ackOk({ combat: updatedCombat }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:previous — go back one turn
// REQ-CBT-004, REQ-CBT-022
// ---------------------------------------------------------------------------

export function buildCombatPreviousHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can go back in combat");
    }

    const parsed = CombatPreviousPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    if (!combat.started) {
      return ackError("VALIDATION_FAILED", "Combat has not been started yet");
    }
    if (combat.ended) {
      return ackError("VALIDATION_FAILED", "Combat has already ended");
    }

    const prev = buildSnapshot(combat);

    const previous = previousTurnIndex(
      combat.combatants,
      combat.turnIndex,
      combat.round,
      combat.skipDefeated,
    );

    if (!previous) {
      return ackError("VALIDATION_FAILED", "No eligible combatants to go back to");
    }

    const prevCombatant = activeCombatant(combat.combatants, combat.turnIndex, combat.started);
    const roundChanged = previous.round !== combat.round;

    if (prevCombatant) {
      emitTurnEnd(deps, combat, prevCombatant);
    }

    if (roundChanged) {
      emitRoundEnd(deps, combat, combat.round);
    }

    const diff: Partial<CombatDocument> = withActiveCombatantId(combat, {
      turnIndex: previous.turnIndex,
      round: previous.round,
    });

    let updatedCombat: CombatDocument;
    try {
      updatedCombat = persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to go back in combat");
    }

    if (roundChanged) {
      emitRoundStart(deps, updatedCombat, previous.round);
    }

    const newCombatant = activeCombatant(updatedCombat.combatants, previous.turnIndex, true);
    if (newCombatant) {
      emitTurnStart(deps, updatedCombat, newCombatant, prev);
    }

    const seq = broadcastUpdate(deps, updatedCombat, diff, prev);
    return ackOk({ combat: updatedCombat }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:toggleDefeated — toggle the defeated flag
// REQ-CBT-024..025
// ---------------------------------------------------------------------------

export function buildCombatToggleDefeatedHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can toggle defeated status");
    }

    const parsed = CombatSetDefeatedPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId, combatantId, defeated } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    const combatantIdx = combat.combatants.findIndex((c) => c._id === combatantId);
    const current = combatantIdx === -1 ? undefined : combat.combatants[combatantIdx];
    if (!current) {
      return ackError("NOT_FOUND", `Combatant not found: ${combatantId}`);
    }

    const updatedCombatants = [...combat.combatants];
    updatedCombatants[combatantIdx] = { ...current, defeated };

    const diff: Partial<CombatDocument> = withActiveCombatantId(combat, {
      combatants: updatedCombatants,
    });

    let updatedCombat: CombatDocument;
    try {
      updatedCombat = persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to toggle defeated flag");
    }

    const seq = broadcastUpdate(deps, updatedCombat, diff);
    return ackOk({ combat: updatedCombat }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:setHidden — hide or reveal a combatant from players
// REQ-CBT-031
// ---------------------------------------------------------------------------

export function buildCombatSetHiddenHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can hide/reveal combatants");
    }

    const parsed = CombatSetHiddenPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId, combatantId, hidden } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    const combatantIdx = combat.combatants.findIndex((c) => c._id === combatantId);
    const targetCombatant = combatantIdx === -1 ? undefined : combat.combatants[combatantIdx];
    if (!targetCombatant) {
      return ackError("NOT_FOUND", `Combatant not found: ${combatantId}`);
    }

    const updatedCombatants = [...combat.combatants];
    updatedCombatants[combatantIdx] = {
      ...targetCombatant,
      hidden,
    };

    const diff: Partial<CombatDocument> = withActiveCombatantId(combat, {
      combatants: updatedCombatants,
    });

    let updatedCombat: CombatDocument;
    try {
      updatedCombat = persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to set combatant hidden state");
    }

    const { seqStore, opBuffer, ns } = deps;
    const combatPayload = updatedCombat as unknown as Record<string, unknown>;
    const seq = seqStore.next();

    // For hidden state changes, always use per-socket broadcast
    // since the payload sensitivity changes based on the new hidden flag
    const updatedPayload = {
      combatId: updatedCombat._id,
      diff: diff as Record<string, unknown>,
      seq,
    };
    const envelope = buildEnvelope("combat:updated", updatedPayload, seq);
    opBuffer.push(envelope);
    broadcastCombatUpdate(ns, envelope, combatPayload);

    return ackOk({ combat: updatedCombat }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:reorder — manual reorder via drag-and-drop
// REQ-CBT-017
// ---------------------------------------------------------------------------

export function buildCombatReorderHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can reorder combatants");
    }

    const parsed = CombatReorderPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId, order } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    if (order.length !== combat.combatants.length) {
      return ackError(
        "VALIDATION_FAILED",
        `Order array length (${String(order.length)}) must match combatant count (${String(combat.combatants.length)})`,
      );
    }

    // Build a map for quick lookup
    const combatantMap = new Map(combat.combatants.map((c) => [c._id, c]));

    // Validate all ids are present
    for (const id of order) {
      if (!combatantMap.has(id)) {
        return ackError("VALIDATION_FAILED", `Combatant id not found in combat: ${id}`);
      }
    }

    // Build the new ordered array, then reassign initiative values so the
    // manual order survives future sorts (REQ-CBT-017). sortCombatants orders by
    // initiative descending, so we stamp strictly-decreasing integer initiatives
    // following the requested order. The top entry inherits the current maximum
    // initiative (rounded up) so manual reordering does not push the encounter's
    // top value below where it was; subsequent entries step down by 1.
    //
    // Combatants whose initiative is still null are NOT assigned a value — they
    // remain "not yet rolled" and sortCombatants keeps them at the bottom
    // (REQ-CBT-016). The requested order for them is preserved among themselves
    // by array position, which sortCombatants keeps stable.
    const reordered: CombatantDocument[] = [];
    for (const id of order) {
      const c = combatantMap.get(id);
      if (c) reordered.push(c);
    }

    const maxInitiative = combat.combatants.reduce<number>((max, c) => {
      if (c.initiative === null) return max;
      return Math.max(max, c.initiative);
    }, 0);

    // Start at ceil(max) so we stay at or above the previous top value, then
    // step down by 1 for each subsequently-ordered combatant that has a value.
    let nextInitiative = Math.ceil(maxInitiative);
    const renumbered = reordered.map((c) => {
      if (c.initiative === null) return c;
      const assigned = nextInitiative;
      nextInitiative -= 1;
      return { ...c, initiative: assigned };
    });

    const diff: Partial<CombatDocument> = withActiveCombatantId(combat, {
      combatants: renumbered,
    });

    let updatedCombat: CombatDocument;
    try {
      updatedCombat = persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to reorder combatants");
    }

    const seq = broadcastUpdate(deps, updatedCombat, diff);
    return ackOk({ combat: updatedCombat }, seq);
  };
}

// ---------------------------------------------------------------------------
// combat:end — GM ends the encounter
// REQ-CBT-004, REQ-CBT-006
// ---------------------------------------------------------------------------

export function buildCombatEndHandler(deps: CombatHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only GM/Assistant can end combat");
    }

    const parsed = CombatEndPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = loadCombat(deps, combatId);
    } catch {
      return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
    }

    if (combat.ended) {
      return ackError("VALIDATION_FAILED", "Combat has already ended");
    }

    // Emit turnEnd for the current combatant if combat was started (REQ-CBT-006)
    if (combat.started) {
      const currentCombatant = activeCombatant(combat.combatants, combat.turnIndex, combat.started);
      if (currentCombatant) {
        emitTurnEnd(deps, combat, currentCombatant);
      }
    }

    // REQ-CBT-006: emit combatEnd BEFORE persisting ended=true
    deps.eventBus.emitLifecycle({ type: "combatEnd", combat });

    const diff: Partial<CombatDocument> = { ended: true };

    try {
      // Persist ended=true; the deleted broadcast below carries no document body.
      persistCombat(deps, combatId, diff);
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to end combat");
    }

    const { seqStore, opBuffer, ns } = deps;
    const seq = seqStore.next();

    // Broadcast combat:deleted — clients clear the tracker
    const deletedPayload = { combatId };
    const envelope = buildEnvelope("combat:deleted", deletedPayload, seq);
    opBuffer.push(envelope);
    ns.emit("op", envelope); // deletes carry no sensitive data

    return ackOk({ combatId }, seq);
  };
}

// ---------------------------------------------------------------------------
// Helper: check if a combatant is owned by the given player
// REQ-CBT-034
// ---------------------------------------------------------------------------

/**
 * Whether `ownership.default` alone grants OWNER to an arbitrary PLAYER —
 * i.e. "every player owns this document" — resolved through the single
 * source of truth (testOwnership) rather than a bare `ownership.default >= 3`
 * read. Probes with a key that can never collide with a real userId so the
 * probe deterministically falls through to the `default` entry inside
 * getUserLevel/resolveOwnership.
 */
function defaultGrantsPlayerOwnership(ownership: Ownership): boolean {
  return testOwnership(ownership, "default-probe", UserRole.PLAYER, OwnershipLevel.OWNER);
}

function isOwnedByPlayer(
  deps: CombatHandlerDeps,
  combatant: CombatantDocument,
  userId: string,
): boolean {
  if (!combatant.actorId) return false;

  try {
    const actor = deps.store.get("actors", combatant.actorId);
    const ownership = actor["ownership"];
    if (!ownership || typeof ownership !== "object" || Array.isArray(ownership)) return false;
    // Delegate to the single source of truth (documents/ownership.ts) so
    // `ownership.default` and INHERIT are honoured — a hand-rolled
    // `ownerMap[userId] >= 3` read ignores both. `role` is always
    // UserRole.PLAYER here: this helper only answers "does this specific
    // user own the Actor", independent of privilege — the GM-bypass half of
    // "own OR GM" is applied separately by callers via isRolePrivileged.
    return testOwnership(ownership as Ownership, userId, UserRole.PLAYER, OwnershipLevel.OWNER);
  } catch {
    return false;
  }
}
