/**
 * Etmos Reação por rodada — server-side lifecycle hook + socket handler.
 *
 * REQ-ETM-023: 1 Reação por rodada por Combatant, resetada no início do
 * PRÓPRIO turno; a Habilidade "Agilidade Mental" eleva a 2 (a 2ª usada
 * acumula +3 Estresse pelo MESMO caminho de aplicação de Estresse do M5-C).
 * Só o RECURSO é rastreado aqui — o efeito de defesa da Reação é arbitrado
 * pelo Narrador (spec 19).
 *
 * Storage: `CombatantDocument.flags.etmos.reacoes = { atual, max }` — the
 * generic namespaced-flags bag every Combatant already carries (spec 10
 * §Modelo de dados), same pattern the Compositor uses for
 * `ChatMessage.flags.etmos.conjuracao`. `combatants` is a full-array-replace
 * field on Combat (deepMerge never merges arrays by index —
 * documents/merge.ts), so every write here rebuilds the array with ONE
 * combatant's flags patched, mirroring combat-handlers.ts's own
 * setInitiative/toggleDefeated/setHidden pattern.
 *
 * Reset wiring: `registerReacaoResetOnTurnStart` subscribes directly to
 * `CombatEventBus.onLifecycle("turnStart", ...)` — the REAL production path
 * (combat-handlers.ts's buildCombatNextHandler/buildCombatStartHandler call
 * `eventBus.emitLifecycle({ type: "turnStart", ... })` on every real turn
 * advance). `SystemModule.combat.hooks.turnStart` (the system-API
 * `registerCombatHooks` surface) is declared in the type system
 * (system-api/src/combat.ts) but NEVER consumed by the server — no boot path
 * wires `SystemCombatConfig.hooks` into anything. Wiring through it would be
 * silently inert. This module therefore follows the SAME direct-onLifecycle
 * pattern already used in production by `target-handler.ts`'s
 * `registerTargetingCleanup` (turnEnd -> clear targeting) instead.
 */

import type { Namespace } from "socket.io";
import type { Database as Db } from "better-sqlite3";
import { maxReacoes, resetReacoes, usarReacao } from "@fusion/system-etmos";
import type { ReacoesState } from "@fusion/system-etmos";
import type { CombatDocument, CombatantDocument, Ack, ErrorCode, Envelope } from "@fusion/shared";
import { EtmosReacaoUsarPayloadSchema } from "@fusion/shared";

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
import type { CombatEventBus } from "../combat/combat-event-bus.js";
import { broadcastCombatVersionUpdate, broadcastCombatUpdate } from "../combat/combat-handlers.js";
import { estadoFadiga } from "@fusion/system-etmos";

const FLAG_NAMESPACE = "etmos";
const FLAG_KEY = "reacoes";

// ---------------------------------------------------------------------------
// Flag read/write helpers
// ---------------------------------------------------------------------------

function readReacoes(combatant: CombatantDocument): ReacoesState | null {
  const raw = combatant.flags[FLAG_NAMESPACE]?.[FLAG_KEY];
  if (!raw || typeof raw !== "object") return null;
  const atual = (raw as Record<string, unknown>)["atual"];
  const max = (raw as Record<string, unknown>)["max"];
  if (typeof atual !== "number" || typeof max !== "number") return null;
  return { atual, max };
}

function withReacoes(combatant: CombatantDocument, state: ReacoesState): CombatantDocument {
  return {
    ...combatant,
    flags: {
      ...combatant.flags,
      [FLAG_NAMESPACE]: {
        ...combatant.flags[FLAG_NAMESPACE],
        [FLAG_KEY]: state,
      },
    },
  };
}

/** Rebuild the full combatants array with ONE combatant replaced (array-replace semantics). */
function replaceCombatant(
  combatants: readonly CombatantDocument[],
  combatantId: string,
  next: CombatantDocument,
): CombatantDocument[] {
  return combatants.map((c) => (c._id === combatantId ? next : c));
}

// ---------------------------------------------------------------------------
// Actor lookup — mirrors the resolveActorName/getActorSystem helpers in
// conjuracao-handlers.ts (module-private there; re-derived here since these
// two handler files intentionally have no shared-internal-helpers module —
// see conjuracao-handlers.ts's docstring on why this file exists standalone).
// ---------------------------------------------------------------------------

function loadActorDoc(
  store: DocumentStore,
  actorId: string | null,
): Record<string, unknown> | null {
  if (actorId === null) return null;
  try {
    return store.get("actors", actorId);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// registerReacaoResetOnTurnStart — REQ-ETM-023 reset half
// ---------------------------------------------------------------------------

export interface ReacaoResetDeps {
  store: DocumentStore;
}

/**
 * Register a turnStart listener that resets the active combatant's Reação
 * counter to `maxReacoes(actor)` (1, or 2 with Agilidade Mental). Only
 * combatants with an `actorId` resolving to an `orador`/`antagonista` Actor
 * get a reset — other systems' combatants are left untouched (their `flags`
 * simply never gain an `etmos` key).
 *
 * The persisted CombatDocument update goes through the SAME `store.update`
 * mechanism combat-handlers.ts itself uses — no bespoke broadcast is emitted
 * here; the NEXT combat:updated broadcast (or the caller's own turnStart
 * broadcast, which combat-handlers.ts already sends unconditionally on every
 * turn change) naturally carries the updated flags because this write lands
 * in the store BEFORE that broadcast is built... EXCEPT `emitLifecycle` is
 * called by combat-handlers.ts's buildCombatNextHandler/buildCombatStartHandler
 * AFTER persistCombat() and its own broadcastUpdate() — see those handlers.
 * To guarantee the client actually sees the reset Reação, this handler
 * broadcasts its OWN follow-up `combat:updated` diff after persisting,
 * exactly like combat-handlers.ts's buildCombatSetHiddenHandler does for its
 * own out-of-band per-combatant patch. T036: it also follows up with
 * `broadcastCombatVersionUpdate` (combat-handlers.ts) so the `_stats.version`
 * this `store.update` call just bumped reaches every client's
 * DocumentMirror — combat:updated's payload never carries `_stats`.
 */
export function registerReacaoResetOnTurnStart(
  eventBus: CombatEventBus,
  deps: ReacaoResetDeps & {
    seqStore: SeqStore;
    opBuffer: OpBuffer;
    ns: Namespace;
  },
): void {
  eventBus.onLifecycle("turnStart", (event) => {
    if (event.type !== "turnStart") return;
    const { combat, combatant } = event;

    const actor = loadActorDoc(deps.store, combatant.actorId);
    // Only reset for Etmos actors (orador/antagonista) — a non-Etmos world's
    // combatants have no `system.atributos`-shaped doc and Agilidade Mental
    // detection would be meaningless; skip silently (no-op for other systems).
    if (actor === null || (actor["type"] !== "orador" && actor["type"] !== "antagonista")) {
      return;
    }

    const max = maxReacoes(actor);
    const nextState = resetReacoes(max);
    const existing = readReacoes(combatant);
    // Skip the write entirely when nothing would change (idempotent — avoids
    // a no-op store.update on every turnStart for a combatant already at
    // { atual: max, max } from a previous manual reset).
    if (existing !== null && existing.atual === nextState.atual && existing.max === nextState.max) {
      return;
    }

    const updatedCombatant = withReacoes(combatant, nextState);
    const updatedCombatants = replaceCombatant(combat.combatants, combatant._id, updatedCombatant);

    let updated: Record<string, unknown> | null;
    try {
      updated = deps.store.update(
        "combats",
        combat._id,
        { combatants: updatedCombatants },
        {
          userId: null,
        },
      );
    } catch {
      return; // combat may have been deleted/ended concurrently — non-fatal
    }
    if (!updated) return;

    broadcastCombatantsPatch(deps, combat._id, updatedCombatants, updated);

    // T036: this write bumps Combat's `_stats.version` (store.update above)
    // but broadcastCombatantsPatch only ever emitted combat:updated, whose
    // {combatId, diff, seq} payload never carries `_stats` — see
    // broadcastCombatVersionUpdate's docstring (combat-handlers.ts) for why
    // that leaves DocumentMirror._stats.version permanently stale without
    // this companion doc:update.
    broadcastCombatVersionUpdate(deps, updated);
  });
}

function broadcastCombatantsPatch(
  deps: { seqStore: SeqStore; opBuffer: OpBuffer; ns: Namespace },
  combatId: string,
  combatants: CombatantDocument[],
  combatDoc: Record<string, unknown>,
): void {
  const seq = deps.seqStore.next();
  const envelope: Envelope = {
    type: "combat:updated",
    seq,
    ts: Date.now(),
    payload: { combatId, diff: { combatants }, seq },
  };
  deps.opBuffer.push(envelope);
  // `diff.combatants` is the FULL combatant list, hidden ones included. Sending
  // it namespace-wide handed every player the combatants the GM had hidden —
  // the same leak REQ-CBT-031 closes elsewhere, on a path that had been missed.
  // `broadcastCombatUpdate` is the per-socket split the rest of the combat code
  // already uses; the predicate is not duplicated here.
  broadcastCombatUpdate(deps.ns, envelope, combatDoc);
}

// ---------------------------------------------------------------------------
// etmos:reacao:usar — REQ-ETM-023 spend half
// ---------------------------------------------------------------------------

export interface ReacaoHandlerDeps {
  readonly store: DocumentStore;
  readonly db: Db;
  readonly ns: Namespace;
  readonly seqStore: SeqStore;
  readonly opBuffer: OpBuffer;
  readonly worldId: string;
}

function ackOk<R>(result: R, seq: number): Ack<R> {
  return { ok: true, seq, result };
}
function ackError(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, code, message };
}

function isOwnerOfActor(store: DocumentStore, actorId: string, userId: string): boolean {
  let actor: Record<string, unknown>;
  try {
    actor = store.get("actors", actorId);
  } catch {
    return false;
  }
  const ownership = actor["ownership"] as Ownership | undefined;
  if (!ownership) return false;
  return testOwnership(ownership, userId, UserRole.PLAYER, OwnershipLevel.OWNER);
}

/**
 * Apply +3 Estresse to an Actor via the SAME field-shape the Compositor's
 * resolver uses (conjuracao-handlers.ts's buildConjuracaoResolverHandler) —
 * `system.estresse.atual` + recomputed `system.fadiga.estado` — so the two
 * Estresse-application call sites never diverge on shape.
 *
 * Returns the updated document (or `null` if `store.update` returned null)
 * so the caller can broadcast it — see T032/broadcastActorUpdate below: this
 * write bumps `_stats.version` and MUST be paired with a `doc:update`
 * broadcast or a connected client's DocumentMirror is stuck on the stale
 * version forever.
 *
 * Cross-reference (M5-E audit FIX 6): conjuracao-handlers.ts's
 * buildConjuracaoResolverHandler has the exact inline equivalent of this
 * function (REQ-ETM-024's Estresse-on-resolver cost) — see the
 * cross-reference comment there. Intentionally NOT unified in this batch;
 * the Compositor resolver flow is intocável for M5-E. TODO [divida futura]:
 * extract a shared `applyEstresseCost(store, actorId, delta, userId)`
 * helper once both call sites are touched again for an unrelated reason —
 * do not extract preemptively just to satisfy DRY.
 */
function applyEstresseCost(
  store: DocumentStore,
  actorId: string,
  delta: number,
  userId: string,
): Record<string, unknown> | null {
  const actor = store.get("actors", actorId);
  const sys = (actor["system"] as Record<string, unknown> | undefined) ?? {};
  const estresse = (sys["estresse"] as Record<string, unknown> | undefined) ?? {};
  const atual = typeof estresse["atual"] === "number" ? estresse["atual"] : 0;
  const limite = typeof estresse["limite"] === "number" ? estresse["limite"] : 0;
  const novoAtual = atual + delta;
  return store.update(
    "actors",
    actorId,
    {
      system: {
        estresse: { atual: novoAtual },
        fadiga: { estado: estadoFadiga(novoAtual, limite) },
      },
    },
    { userId },
  );
}

/**
 * Broadcast an updated Actor document via the standard doc:update envelope
 * (T032) — same shape and namespace-wide emission conjuracao-handlers.ts's
 * broadcastActorUpdate uses for the identical Estresse-cost write, so every
 * connected client's DocumentMirror reflects the Estresse/Fadiga change (and
 * the bumped `_stats.version`) immediately. Not filtered by ownership: the
 * regular doc:update broadcast path (doc-handlers.ts's broadcastToWorld)
 * does not filter Actor documents by ownership either — this follows that
 * SAME established precedent rather than inventing a stricter one here.
 */
function broadcastActorUpdate(deps: ReacaoHandlerDeps, actor: Record<string, unknown>): void {
  const seq = deps.seqStore.next();
  const envelope: Envelope = {
    type: "doc:update",
    seq,
    ts: Date.now(),
    payload: {
      documentType: "Actor",
      documents: [actor],
    },
  };
  // REQ-NET-062: push BEFORE emitting — same ordering as every other
  // doc:update broadcast site (doc-handlers.ts, combat-handlers.ts,
  // conjuracao-handlers.ts's broadcastActorUpdate).
  deps.opBuffer.push(envelope);
  deps.ns.emit("op", envelope);
}

export function buildReacaoUsarHandler(deps: ReacaoHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    const parsed = EtmosReacaoUsarPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { combatId, combatantId } = parsed.data;

    let combat: CombatDocument;
    try {
      combat = deps.store.get("combats", combatId) as unknown as CombatDocument;
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return ackError("NOT_FOUND", `Combat not found: ${combatId}`);
      }
      throw err;
    }

    const combatant = combat.combatants.find((c) => c._id === combatantId);
    if (!combatant) {
      return ackError("NOT_FOUND", `Combatant not found: ${combatantId}`);
    }

    // Permission: GM, or the owner of the combatant's Actor.
    if (!isRolePrivileged(ctx.role)) {
      const ownsIt =
        combatant.actorId !== null && isOwnerOfActor(deps.store, combatant.actorId, ctx.userId);
      if (!ownsIt) {
        return ackError(
          "PERMISSION_DENIED",
          "You do not own this combatant and are not a Narrador — cannot use its Reação",
        );
      }
    }

    const existing = readReacoes(combatant);
    if (existing === null) {
      return ackError(
        "VALIDATION_FAILED",
        "This combatant has no Reação state yet — its turn must start at least once first",
      );
    }

    const result = usarReacao(existing);
    if (!result.permitido) {
      return ackError("VALIDATION_FAILED", "No Reação remaining this round");
    }

    const updatedCombatant = withReacoes(combatant, result.state);
    const updatedCombatants = replaceCombatant(combat.combatants, combatantId, updatedCombatant);

    let updated: Record<string, unknown> | null;
    try {
      updated = deps.store.update(
        "combats",
        combatId,
        { combatants: updatedCombatants },
        {
          userId: ctx.userId,
        },
      );
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to persist Reação usage");
    }
    if (!updated) {
      return ackError("INTERNAL_ERROR", "Reação update returned null");
    }

    // REQ-ETM-023: 2ª Reação (Agilidade Mental) acumula +3 Estresse, mesmo
    // caminho de aplicação de custo do M5-C (conjuracao-handlers.ts resolver).
    if (result.segundaReacaoComCusto && combatant.actorId !== null) {
      try {
        const updatedActor = applyEstresseCost(deps.store, combatant.actorId, 3, ctx.userId);
        if (updatedActor) {
          broadcastActorUpdate(deps, updatedActor);
        }
      } catch {
        // Actor may have been deleted concurrently — the Reação spend itself
        // still succeeded; the cost is best-effort and non-fatal here.
      }
    }

    const seq = deps.seqStore.next();
    const envelope: Envelope = {
      type: "combat:updated",
      seq,
      ts: Date.now(),
      payload: { combatId, diff: { combatants: updatedCombatants }, seq },
    };
    deps.opBuffer.push(envelope);
    deps.ns.emit("op", envelope);

    // T036: see broadcastCombatVersionUpdate's docstring (combat-handlers.ts)
    // — the store.update() above bumped Combat's `_stats.version`, and the
    // combat:updated envelope just built/emitted never carries `_stats`.
    broadcastCombatVersionUpdate(deps, updated);

    return ackOk({ state: result.state, segundaReacaoComCusto: result.segundaReacaoComCusto }, seq);
  };
}
