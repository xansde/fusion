/**
 * Etmos Compositor de Magias — server-side conjuração card handlers.
 *
 * The five `etmos:conjuracao:*` socket ops (propor/arbitrar/rolar/resolver/
 * cancelar) that orchestrate the pure state machine
 * (`@fusion/system-etmos`'s `conjuracao/state-machine.ts`) with I/O:
 * persisting the card as `flags.etmos.conjuracao` of a ChatMessage, calling
 * `RollService` for the authoritative `2d6 + Alma` roll (and the Fadiga
 * control roll), applying the Estresse cost to the Actor, and broadcasting.
 *
 * Design doc: docs/design/m5-etmos-compositor.md §2.1/§2.5/§2.7.
 * Spec: 19-sistema-etmos.md REQ-ETM-018, REQ-ETM-024..026, REQ-ETM-029..033.
 *
 * Architectural rule (REQ-ARQ-005): `systems/etmos` never imports from
 * `server`/`client`. This module is the I/O orchestrator that CONSUMES the
 * system's pure functions (`podeTransicionar`, `aplicar`, `custoEstresse`,
 * `computeDegreeOfSuccess`, `classeDificuldade`, `estadoFadiga`) — it never
 * reimplements any of them.
 *
 * Permission guards: every check funnels through `isRolePrivileged`
 * (`documents/ownership.ts`) for "is this user a GM", composed with an Actor
 * ownership check (`testOwnership`, same module) for "is this user the dono
 * of the conjurador Actor" — see `isOwnerOfActor` below, which mirrors
 * `isOwnedByPlayer` in `combat/combat-handlers.ts` (both now delegate to
 * `testOwnership` rather than a hand-rolled `ownership[userId] >= OWNER`
 * read). Neither predicate is duplicated — both are imported from the
 * existing single sources of truth.
 *
 * Randomness: ALL dice go through `RollService.roll()` (CSPRNG, audit log).
 * This module never calls `Math.random()` or any other RNG.
 *
 * Broadcast: every payload sent to clients is a `ChatMessage` (or a
 * `doc:update` Actor patch) built by the SAME persistence/broadcast helpers
 * used by `chat-handler.ts`/`combat-chat.ts` — visibility (whisper/blind) is
 * computed with the identical `isRolePrivileged`-based rules, no separate
 * strip logic invented here.
 */

import type { Namespace } from "socket.io";
import type { Database as Db } from "better-sqlite3";
import { createDocumentId, defaultStats } from "@fusion/shared";
import { CHAT_BROADCAST_EVENT, CHAT_DOCUMENT_TYPE } from "@fusion/shared";
import {
  EtmosConjuracaoProporPayloadSchema,
  EtmosConjuracaoArbitrarPayloadSchema,
  EtmosConjuracaoRolarPayloadSchema,
  EtmosConjuracaoResolverPayloadSchema,
  EtmosConjuracaoCancelarPayloadSchema,
} from "@fusion/shared";
import type { ChatMessage, Envelope, Ack, ErrorCode } from "@fusion/shared";

import {
  ConjuracaoCardSchema,
  parseFraseMagicaSystem,
  podeTransicionar,
  aplicar,
  custoEstresse,
  estadoFadiga,
  computeDegreeOfSuccess,
  classeDificuldade,
  complexidadeMaxima,
} from "@fusion/system-etmos";
import type {
  ConjuracaoCard,
  AtorConjuracao,
  ContextoTransicao,
  Complexidade,
} from "@fusion/system-etmos";

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
import { emitDocumentOp } from "../net/redaction.js";
import { RollService, RollError } from "../chat/roll-service.js";
import type { RollServiceOptions } from "../chat/roll-service.js";
import type { SystemModule } from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Handler dependency bundle
// ---------------------------------------------------------------------------

export interface ConjuracaoHandlerDeps {
  readonly store: DocumentStore;
  readonly db: Db;
  readonly ns: Namespace;
  readonly seqStore: SeqStore;
  readonly opBuffer: OpBuffer;
  readonly worldId: string;
  /** Optional RNG override for tests — forwarded to the internal RollService. */
  readonly rollServiceOptions?: Partial<RollServiceOptions>;
  /**
   * The world's resolved SystemModule (from SystemRegistry.tryGet(systemId)),
   * when the system package is available. Used to resolve the registered
   * rollData builder (M5-A E1 / registrar.rollData) for the conjurador Actor
   * so `etmos:conjuracao:rolar` builds its RollRequest.rollData through the
   * SAME single source of truth every other roll path uses — see
   * resolveRollData below. Optional — undefined falls back to a minimal
   * `{ atributos }` shape (documented fallback, mirrors the pre-fix behaviour).
   */
  readonly systemModule?: SystemModule;
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
// Actor ownership guard — composed from the existing Ownership model, never
// duplicating isRolePrivileged's own predicate. Mirrors
// combat/combat-handlers.ts's isOwnedByPlayer helper.
// ---------------------------------------------------------------------------

/**
 * Resolve Actor ownership through the SAME single source of truth used by
 * doc-handlers.ts and (post-M5-C debt payoff) combat-handlers.ts /
 * target-handler.ts / vision-handlers.ts (`testOwnership`/`resolveOwnership`,
 * `documents/ownership.ts`) — NOT a hand-rolled `ownership[userId] >= 3`
 * read. This correctly honours `ownership.default` and `INHERIT` (which
 * resolves to NONE here, since Actors are not addressed via a folder chain
 * in this call site — see resolveOwnership's docstring).
 *
 * `role` is always UserRole.PLAYER here: this helper only ever answers "is
 * this specific user an OWNER of the Actor", independent of privilege — the
 * GM-bypass half of "dono OU GM" is handled separately by
 * `isRolePrivileged(ctx.role)` in `resolveAtor` below, so passing the real
 * (possibly privileged) role would double-apply the GM bypass inside
 * `resolveOwnership` itself and mask a misconfigured ownership map in tests.
 */
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
 * Resolve the `AtorConjuracao` for the acting user against a given Actor, or
 * `null` when the user is neither the Actor's owner nor a GM (i.e. has no
 * standing to act on this card at all).
 *
 * This is the ONLY place that composes "dono do Actor OU GM" — every handler
 * below calls this instead of re-deriving the union itself.
 */
function resolveAtor(
  store: DocumentStore,
  ctx: HandlerContext,
  conjuradorActorId: string,
): AtorConjuracao | null {
  if (isRolePrivileged(ctx.role)) return "gm";
  if (isOwnerOfActor(store, conjuradorActorId, ctx.userId)) return "dono";
  return null;
}

// ---------------------------------------------------------------------------
// ChatMessage persistence (mirrors chat-handler.ts persistChatMessage)
// ---------------------------------------------------------------------------

function persistChatMessage(db: Db, msg: ChatMessage): void {
  const now = Date.now();
  const data = JSON.stringify(msg);
  db.prepare(
    `INSERT INTO chat_messages (id, data, timestamp, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(msg._id, data, msg.timestamp, msg.speaker.userId, now, now);
}

function loadChatMessage(db: Db, id: string): ChatMessage | null {
  const row = db.prepare(`SELECT data FROM chat_messages WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as ChatMessage;
}

/** Persist an updated ChatMessage in place (same _id, new data blob). */
function updateChatMessage(db: Db, msg: ChatMessage): void {
  const now = Date.now();
  const data = JSON.stringify(msg);
  db.prepare(`UPDATE chat_messages SET data = ?, updated_at = ? WHERE id = ?`).run(
    data,
    now,
    msg._id,
  );
}

function resolveActorName(db: Db, actorId: string): string {
  try {
    const row = db.prepare(`SELECT data FROM actors WHERE id = ?`).get(actorId) as
      | { data: string }
      | undefined;
    if (row) {
      const data = JSON.parse(row.data) as Record<string, unknown>;
      if (typeof data["name"] === "string") return data["name"];
    }
  } catch {
    // fall through
  }
  return "Conjurador";
}

// ---------------------------------------------------------------------------
// Card <-> ChatMessage flag helpers
// ---------------------------------------------------------------------------

const FLAG_NAMESPACE = "etmos";
const FLAG_KEY = "conjuracao";

/**
 * Result of reading+validating the card flag off a ChatMessage.
 *   - `card: null`   → no card flag at all (message is not a conjuração card).
 *   - `corrupted: true` → a card flag exists but fails ConjuracaoCardSchema
 *     validation (e.g. hand-edited/forged flags, a future incompatible
 *     shape). Distinguished from "no card" so callers can return a typed
 *     VALIDATION_FAILED ack instead of a misleading NOT_FOUND — and so the
 *     handler never throws (readCard used `.parse` previously, which threw
 *     and surfaced as a generic INTERNAL_ERROR to the client).
 */
interface ReadCardResult {
  readonly card: ConjuracaoCard | null;
  readonly corrupted: boolean;
}

function readCard(msg: ChatMessage): ReadCardResult {
  const raw = msg.flags[FLAG_NAMESPACE]?.[FLAG_KEY];
  if (raw === undefined) return { card: null, corrupted: false };
  const result = ConjuracaoCardSchema.safeParse(raw);
  if (!result.success) return { card: null, corrupted: true };
  return { card: result.data, corrupted: false };
}

function writeCard(msg: ChatMessage, card: ConjuracaoCard): ChatMessage {
  return {
    ...msg,
    flags: {
      ...msg.flags,
      [FLAG_NAMESPACE]: {
        ...msg.flags[FLAG_NAMESPACE],
        [FLAG_KEY]: card,
      },
    },
  };
}

/**
 * Card messages are always visible to the GM(s) + the conjurador's owner(s).
 * Cards are not secret rolls — the compositor is a shared GM<->jogador
 * negotiation surface (design doc §3.4) — so this is broadcast-to-all with
 * NO whisper[] by default (matches spec 19's "visível ao Narrador e ao
 * jogador", which does not exclude other players from seeing the proposal
 * exists). We still reuse the ONE broadcast helper below for every card
 * message so no handler invents its own visibility rule.
 */
function broadcastChatMessage(deps: ConjuracaoHandlerDeps, msg: ChatMessage): number {
  const seq = deps.seqStore.next();
  const envelope: Envelope = {
    type: CHAT_BROADCAST_EVENT,
    seq,
    ts: Date.now(),
    payload: {
      documentType: CHAT_DOCUMENT_TYPE,
      documents: [msg],
    },
  };
  // REQ-NET-062: every canonical op must land in the OpBuffer so a client
  // that reconnects via resync:delta can replay it — mirrors
  // doc-handlers.ts:502 / combat-handlers.ts:356 (push BEFORE emitting).
  deps.opBuffer.push(envelope);
  for (const [, socket] of deps.ns.sockets) {
    socket.emit("op", envelope);
  }
  return seq;
}

function buildCardMessage(
  deps: ConjuracaoHandlerDeps,
  authorUserId: string,
  card: ConjuracaoCard,
): ChatMessage {
  const stats = defaultStats();
  const actorName = resolveActorName(deps.db, card.conjurador_actor_id);
  return {
    _id: createDocumentId(),
    worldId: deps.worldId,
    type: "system",
    content: `${actorName} propõe conjurar: "${card.frase.frase_completa}"`,
    speaker: {
      userId: authorUserId,
      actorId: card.conjurador_actor_id,
      alias: actorName,
    },
    timestamp: Date.now(),
    whisper: [],
    blind: false,
    sort: 0,
    ownership: { default: 0 },
    flags: { [FLAG_NAMESPACE]: { [FLAG_KEY]: card } },
    _stats: {
      ...stats,
      lastModifiedBy: authorUserId,
      createdBy: authorUserId,
    },
  };
}

// ---------------------------------------------------------------------------
// etmos:conjuracao:propor — REQ-ETM-029
// ---------------------------------------------------------------------------

export function buildConjuracaoProporHandler(deps: ConjuracaoHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    const parsed = EtmosConjuracaoProporPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { conjuradorActorId, frase } = parsed.data;

    const ator = resolveAtor(deps.store, ctx, conjuradorActorId);
    if (ator === null) {
      return ackError(
        "PERMISSION_DENIED",
        "You do not own this Actor and are not a Narrador — cannot propor a conjuração",
      );
    }

    if (!podeTransicionar(null, "proposta", "propor", { ator, jaRolou: false })) {
      return ackError("PERMISSION_DENIED", "Cannot propor a conjuração here");
    }

    let fraseSystem;
    try {
      fraseSystem = parseFraseMagicaSystem(frase);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return ackError("VALIDATION_FAILED", `Invalid frase: ${msg}`);
    }

    // Immutable snapshot of the frase — spec 19 §Card de Conjuração.
    const card: ConjuracaoCard = {
      estado: "proposta",
      conjurador_actor_id: conjuradorActorId,
      frase: fraseSystem,
      complexidade: null,
      custo_estresse: null,
      excede_maxima: false,
      notas_narrador: "",
      roll_message_id: null,
      dificuldade_alvo: null,
      sucesso: null,
      margem: null,
      classe_dificuldade: null,
      controle_fadiga: null,
    };

    const msg = buildCardMessage(deps, ctx.userId, card);
    persistChatMessage(deps.db, msg);
    const seq = broadcastChatMessage(deps, msg);

    return ackOk({ message: msg }, seq);
  };
}

// ---------------------------------------------------------------------------
// etmos:conjuracao:arbitrar — REQ-ETM-030
// ---------------------------------------------------------------------------

export function buildConjuracaoArbitrarHandler(deps: ConjuracaoHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    const parsed = EtmosConjuracaoArbitrarPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const {
      messageId,
      complexidade,
      custoEstresseOverride,
      notasNarrador,
      dificuldadeAlvo,
      recusar,
    } = parsed.data;

    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only a Narrador may arbitrar a conjuração");
    }

    const msg = loadChatMessage(deps.db, messageId);
    if (!msg) return ackError("NOT_FOUND", `ChatMessage not found: ${messageId}`);
    const cardResult = readCard(msg);
    if (cardResult.corrupted) {
      return ackError(
        "VALIDATION_FAILED",
        `Corrupted conjuração card flags on message ${messageId}`,
      );
    }
    const card = cardResult.card;
    if (!card) return ackError("NOT_FOUND", `No conjuração card on message ${messageId}`);

    const contexto: ContextoTransicao = { ator: "gm", jaRolou: false };

    if (recusar === true) {
      if (!podeTransicionar(card.estado, "recusada", "recusar", contexto)) {
        return ackError("VALIDATION_FAILED", `Cannot recusar from state "${card.estado}"`);
      }
      const nextCard = aplicar(card, "recusar", {
        notas_narrador: notasNarrador ?? card.notas_narrador,
      });
      const nextMsg = writeCard(msg, nextCard);
      updateChatMessage(deps.db, nextMsg);
      const seq = broadcastChatMessage(deps, nextMsg);
      return ackOk({ message: nextMsg }, seq);
    }

    if (!podeTransicionar(card.estado, "arbitrada", "arbitrar", contexto)) {
      return ackError("VALIDATION_FAILED", `Cannot arbitrar from state "${card.estado}"`);
    }
    if (!complexidade) {
      return ackError("VALIDATION_FAILED", "complexidade is required to arbitrar (unless recusar)");
    }

    // Rank de Totem só soma em magia NÃO Trivial (REQ-ETM-043) — computed here
    // via the SAME pure custoEstresse() the resolver will use later, so the
    // GM sees the real cost up front; the override (if provided) always wins.
    const rankTotem = readTotemRank(deps.store, card.conjurador_actor_id);
    const computedCusto = custoEstresse(complexidade, rankTotem);
    const custo = custoEstresseOverride ?? computedCusto;

    // REQ-ETM-026: advisory-only — never blocks arbitrar (GM override is
    // legitimate), just records the flag for the M5-D UI to warn on.
    const excedeMaxima = excedeComplexidadeMaxima(
      deps.store,
      card.conjurador_actor_id,
      complexidade,
    );

    const nextCard = aplicar(card, "arbitrar", {
      complexidade,
      custo_estresse: custo,
      excede_maxima: excedeMaxima,
      notas_narrador: notasNarrador ?? card.notas_narrador,
      dificuldade_alvo: dificuldadeAlvo ?? card.dificuldade_alvo,
    });

    const nextMsg = writeCard(msg, nextCard);
    updateChatMessage(deps.db, nextMsg);
    const seq = broadcastChatMessage(deps, nextMsg);
    return ackOk({ message: nextMsg }, seq);
  };
}

// ---------------------------------------------------------------------------
// Actor field readers (Orador schema — systems/etmos/src/schemas/actor-orador.ts)
// ---------------------------------------------------------------------------

function getActorSystem(store: DocumentStore, actorId: string): Record<string, unknown> {
  const actor = store.get("actors", actorId);
  const sys = actor["system"];
  return sys && typeof sys === "object" ? (sys as Record<string, unknown>) : {};
}

function readTotemRank(store: DocumentStore, actorId: string): number {
  try {
    const sys = getActorSystem(store, actorId);
    const totem = sys["totem"] as Record<string, unknown> | undefined;
    const rank = totem?.["rank"];
    return typeof rank === "number" ? rank : 0;
  } catch {
    return 0;
  }
}

// Tabela A ordering (custo.ts complexidadeMaxima/CUSTO_BASE) — used ONLY to
// compare an arbitrated Complexidade against the conjurador's ceiling
// (REQ-ETM-026); never to gate/block the choice — arbitrar is GM-only and an
// above-ceiling pick is a legitimate Narrador override.
const COMPLEXIDADE_ORDEM: Readonly<Record<Complexidade, number>> = {
  trivial: 0,
  regular: 1,
  dificil: 2,
  complexa: 3,
  milagre: 4,
};

/**
 * REQ-ETM-026: whether `complexidade` (the GM's arbitrated choice) exceeds
 * the conjurador Actor's `complexidadeMaxima(mente)`. Recomputed here from
 * `system.atributos.mente.value` (the SAME pure `complexidadeMaxima` the
 * derive-runner uses) rather than trusting the Actor's already-derived
 * `system.complexidade_maxima`, so this stays correct even if derivation
 * hasn't run yet for this Actor.
 */
function excedeComplexidadeMaxima(
  store: DocumentStore,
  actorId: string,
  complexidade: Complexidade,
): boolean {
  const sys = getActorSystem(store, actorId);
  const mente = readAtributo(sys, "mente");
  const maxima = complexidadeMaxima(mente);
  return COMPLEXIDADE_ORDEM[complexidade] > COMPLEXIDADE_ORDEM[maxima];
}

/**
 * Build the `rollData` object for the conjurador Actor through the SAME
 * registered builder every other roll path uses (M5-A E1,
 * `registrar.rollData` — systems/etmos/src/index.ts). Mirrors
 * `findEffectsMaterializer`'s resolution pattern in
 * `net/derive-runner.ts`: match on (documentType="Actor", subtype), an empty
 * `subtypes` array on the registration meaning "all subtypes".
 *
 * Fallback (documented, only exercised when the system package isn't wired —
 * e.g. a unit test harness that omits `systemModule`): reproduces the
 * previous ad-hoc `{ atributos: sys.atributos }` shape so `@atributos.*`
 * substitution still works, just without going through the single source of
 * truth.
 */
function resolveRollData(
  deps: ConjuracaoHandlerDeps,
  actor: Record<string, unknown>,
  sys: Record<string, unknown>,
): Record<string, unknown> {
  const subtype = typeof actor["type"] === "string" ? actor["type"] : "";
  const builders = deps.systemModule?.registries.rollData ?? [];
  for (const b of builders) {
    if (b.documentType !== "Actor") continue;
    if (b.subtypes.length === 0 || b.subtypes.includes(subtype)) {
      return b.build(actor);
    }
  }
  return { atributos: sys["atributos"] };
}

/** Read `system.atributos.<attr>.value`, defaulting to 1 (min Atributo). */
function readAtributo(sys: Record<string, unknown>, attr: string): number {
  const atributos = sys["atributos"] as Record<string, unknown> | undefined;
  const entry = atributos?.[attr] as Record<string, unknown> | undefined;
  const value = entry?.["value"];
  return typeof value === "number" ? value : 1;
}

function readFadigaEstado(sys: Record<string, unknown>): string {
  const fadiga = sys["fadiga"] as Record<string, unknown> | undefined;
  const estado = fadiga?.["estado"];
  return typeof estado === "string" ? estado : "normal";
}

// ---------------------------------------------------------------------------
// etmos:conjuracao:rolar — REQ-ETM-031, design doc §2.5, REQ-ETM-025
// ---------------------------------------------------------------------------

export function buildConjuracaoRolarHandler(deps: ConjuracaoHandlerDeps): HandlerFn {
  const rollService = new RollService({ db: deps.db, ...deps.rollServiceOptions });

  return (rawPayload, ctx: HandlerContext) => {
    const parsed = EtmosConjuracaoRolarPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { messageId } = parsed.data;

    const msg = loadChatMessage(deps.db, messageId);
    if (!msg) return ackError("NOT_FOUND", `ChatMessage not found: ${messageId}`);
    const cardResult = readCard(msg);
    if (cardResult.corrupted) {
      return ackError(
        "VALIDATION_FAILED",
        `Corrupted conjuração card flags on message ${messageId}`,
      );
    }
    const card = cardResult.card;
    if (!card) return ackError("NOT_FOUND", `No conjuração card on message ${messageId}`);

    const ator = resolveAtor(deps.store, ctx, card.conjurador_actor_id);
    if (ator === null) {
      return ackError(
        "PERMISSION_DENIED",
        "You do not own this Actor and are not a Narrador — cannot rolar this conjuração",
      );
    }

    if (!podeTransicionar(card.estado, "rolada", "rolar", { ator, jaRolou: false })) {
      return ackError("VALIDATION_FAILED", `Cannot rolar from state "${card.estado}"`);
    }

    let actorDoc: Record<string, unknown>;
    let sys: Record<string, unknown>;
    try {
      actorDoc = deps.store.get("actors", card.conjurador_actor_id);
      sys = (actorDoc["system"] as Record<string, unknown> | undefined) ?? {};
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return ackError("NOT_FOUND", `Conjurador Actor not found: ${card.conjurador_actor_id}`);
      }
      throw err;
    }

    // design doc §2.5 step 2: "2d6 + @atributos.alma.value" — rollData is
    // built through the registered builder (M5-A E1 / registrar.rollData),
    // the SAME single source of truth every other roll path uses; never
    // hand-assembled from `sys.atributos` here (see resolveRollData).
    let rollResult;
    try {
      rollResult = rollService.roll({
        formula: "2d6 + @atributos.alma.value",
        rollData: resolveRollData(deps, actorDoc, sys),
        mode: "public",
        worldId: deps.worldId,
        userId: ctx.userId,
        actorId: card.conjurador_actor_id,
      });
    } catch (err) {
      if (err instanceof RollError) {
        return ackError("VALIDATION_FAILED", err.message);
      }
      throw err;
    }

    let sucesso: boolean | null = null;
    let margem: number | null = null;
    let classeDif: string | null = null;
    if (card.dificuldade_alvo !== null) {
      const degree = computeDegreeOfSuccess(rollResult.total, card.dificuldade_alvo);
      sucesso = degree.degree === "success";
      margem = degree.margem;
      classeDif = classeDificuldade(rollResult.total);
    }

    // --- Roll chat message (public, references the actor) ---
    const actorName = resolveActorName(deps.db, card.conjurador_actor_id);
    const rollContent =
      card.dificuldade_alvo !== null
        ? `${actorName} testa Conjuração: ${String(rollResult.total)} (DC ${String(card.dificuldade_alvo)}) — ${sucesso ? "Sucesso" : "Falha"}`
        : `${actorName} testa Conjuração: ${String(rollResult.total)}`;
    const stats = defaultStats();
    const rollMsg: ChatMessage = {
      _id: createDocumentId(),
      worldId: deps.worldId,
      type: "roll",
      content: rollContent,
      speaker: {
        userId: ctx.userId,
        actorId: card.conjurador_actor_id,
        alias: actorName,
      },
      timestamp: Date.now(),
      whisper: [],
      blind: false,
      rolls: [rollResult],
      sort: 0,
      ownership: { default: 0 },
      flags: {},
      _stats: { ...stats, lastModifiedBy: ctx.userId, createdBy: ctx.userId },
    };
    persistChatMessage(deps.db, rollMsg);
    broadcastChatMessage(deps, rollMsg);

    // --- Fadiga control roll (REQ-ETM-025) ---
    // Exausto/Esgotado + Complexidade != trivial => second 2d6 control roll.
    const fadigaEstado = readFadigaEstado(sys);
    const complexidadeNaoTrivial = card.complexidade !== null && card.complexidade !== "trivial";
    let controleFadiga: ConjuracaoCard["controle_fadiga"] = null;

    if ((fadigaEstado === "exausto" || fadigaEstado === "esgotado") && complexidadeNaoTrivial) {
      const corpo = readAtributo(sys, "corpo");
      let controlRoll;
      try {
        controlRoll = rollService.roll({
          formula: "2d6",
          mode: "public",
          worldId: deps.worldId,
          userId: ctx.userId,
          actorId: card.conjurador_actor_id,
        });
      } catch (err) {
        if (err instanceof RollError) {
          return ackError("VALIDATION_FAILED", err.message);
        }
        throw err;
      }

      const valor = controlRoll.total;
      const falhou = fadigaEstado === "exausto" ? valor > corpo + 4 : false;
      const morreu = fadigaEstado === "esgotado" ? valor > corpo + 3 : false;

      controleFadiga = { rolou: true, valor, falhou, morreu };

      const controlContent =
        fadigaEstado === "exausto"
          ? `${actorName} está Exausto — controle de Fadiga: ${String(valor)} (Corpo+4=${String(corpo + 4)}) — ${falhou ? "a magia FALHA" : "resiste"}`
          : `${actorName} está Esgotado — controle de Fadiga: ${String(valor)} (Corpo+3=${String(corpo + 3)}) — ${morreu ? "risco de MORTE após conjurar (confirmação do Narrador)" : "resiste"}`;

      const controlMsg: ChatMessage = {
        _id: createDocumentId(),
        worldId: deps.worldId,
        type: "roll",
        content: controlContent,
        speaker: {
          userId: ctx.userId,
          actorId: card.conjurador_actor_id,
          alias: actorName,
        },
        timestamp: Date.now(),
        whisper: [],
        blind: false,
        rolls: [controlRoll],
        sort: 0,
        ownership: { default: 0 },
        flags: {},
        _stats: { ...stats, lastModifiedBy: ctx.userId, createdBy: ctx.userId },
      };
      persistChatMessage(deps.db, controlMsg);
      broadcastChatMessage(deps, controlMsg);

      // REQ-ETM-025: Exausto's failure overrides sucesso (the magic fails),
      // but the Estresse cost still applies at resolver time regardless
      // (REQ-ETM-024) — resolver never reads `sucesso` to decide the cost.
      if (falhou) {
        sucesso = false;
      }
    }

    const nextCard = aplicar(card, "rolar", {
      roll_message_id: rollMsg._id,
      sucesso,
      margem,
      classe_dificuldade: classeDif,
      controle_fadiga: controleFadiga,
    });

    const nextMsg = writeCard(msg, nextCard);
    updateChatMessage(deps.db, nextMsg);
    const seq = broadcastChatMessage(deps, nextMsg);

    return ackOk({ message: nextMsg, roll: rollResult }, seq);
  };
}

// ---------------------------------------------------------------------------
// etmos:conjuracao:resolver — REQ-ETM-032, REQ-ETM-024
// ---------------------------------------------------------------------------

export function buildConjuracaoResolverHandler(deps: ConjuracaoHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    const parsed = EtmosConjuracaoResolverPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { messageId } = parsed.data;

    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Only a Narrador may resolver a conjuração");
    }

    const msg = loadChatMessage(deps.db, messageId);
    if (!msg) return ackError("NOT_FOUND", `ChatMessage not found: ${messageId}`);
    const cardResult = readCard(msg);
    if (cardResult.corrupted) {
      return ackError(
        "VALIDATION_FAILED",
        `Corrupted conjuração card flags on message ${messageId}`,
      );
    }
    const card = cardResult.card;
    if (!card) return ackError("NOT_FOUND", `No conjuração card on message ${messageId}`);

    if (!podeTransicionar(card.estado, "resolvida", "resolver", { ator: "gm", jaRolou: true })) {
      return ackError("VALIDATION_FAILED", `Cannot resolver from state "${card.estado}"`);
    }
    if (card.complexidade === null || card.custo_estresse === null) {
      return ackError(
        "VALIDATION_FAILED",
        "Card has no complexidade/custo_estresse — was it ever arbitrada?",
      );
    }

    // REQ-ETM-024: Estresse SEMPRE acumula ao resolver, mesmo em falha.
    // custo_estresse was fixed at arbitragem time (possibly GM-overridden);
    // resolver applies EXACTLY that value, never recomputing it from
    // `sucesso` — success/failure never changes whether the cost applies.
    //
    // Cross-reference (M5-E audit FIX 6): reacao-handler.ts's
    // applyEstresseCost replicates this EXACT same shape
    // (`system.estresse.atual` + recomputed `system.fadiga.estado` via
    // estadoFadiga) for the Agilidade Mental 2nd-Reação cost. The two call
    // sites are intentionally NOT unified in this batch — this Compositor
    // resolver flow is considered intocável for M5-E (see this file's own
    // docstring). TODO [divida futura]: extract a shared
    // `applyEstresseCost(store, actorId, delta, userId)` helper once both
    // call sites are touched again for an unrelated reason — do not extract
    // preemptively just to satisfy DRY.
    const custo = card.custo_estresse;

    let updatedActor: Record<string, unknown> | null;
    try {
      const actor = deps.store.get("actors", card.conjurador_actor_id);
      const sys = (actor["system"] as Record<string, unknown> | undefined) ?? {};
      const estresse = (sys["estresse"] as Record<string, unknown> | undefined) ?? {};
      const atual = typeof estresse["atual"] === "number" ? estresse["atual"] : 0;
      const limite = typeof estresse["limite"] === "number" ? estresse["limite"] : 0;
      const novoAtual = atual + custo;

      updatedActor = deps.store.update(
        "actors",
        card.conjurador_actor_id,
        {
          system: {
            estresse: { atual: novoAtual },
            fadiga: { estado: estadoFadiga(novoAtual, limite) },
          },
        },
        { userId: ctx.userId },
      );
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return ackError("NOT_FOUND", `Conjurador Actor not found: ${card.conjurador_actor_id}`);
      }
      throw err;
    }

    if (updatedActor) {
      broadcastActorUpdate(deps, updatedActor);
    }

    const nextCard = aplicar(card, "resolver");
    const nextMsg = writeCard(msg, nextCard);
    updateChatMessage(deps.db, nextMsg);
    const seq = broadcastChatMessage(deps, nextMsg);

    return ackOk({ message: nextMsg, actor: updatedActor }, seq);
  };
}

/**
 * Broadcast an updated Actor document via the standard doc:update envelope,
 * so every connected client's local mirror reflects the Estresse/Fadiga
 * change immediately (same shape produced by doc-handlers.ts's Actor update
 * path — no bespoke envelope invented here).
 */
function broadcastActorUpdate(deps: ConjuracaoHandlerDeps, actor: Record<string, unknown>): void {
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
  // REQ-NET-062: push BEFORE emitting — same ordering as doc-handlers.ts:502
  // and combat-handlers.ts:356 — so a resync:delta client sees the Actor
  // Estresse/Fadiga patch even if it reconnects between this push and the
  // subsequent card-state broadcast.
  deps.opBuffer.push(envelope);
  // REQ-NET-096: an Actor is ownership-gated on emission, so this goes out per
  // socket — never `ns.emit`, which would hand the whole sheet (`system`, and
  // with it `attributes.hp`) to every connected player. The buffer push above
  // is unaffected: the delta replay applies the same cut, per viewer.
  emitDocumentOp(deps.ns, envelope);
}

// ---------------------------------------------------------------------------
// etmos:conjuracao:cancelar — REQ-ETM-033
// ---------------------------------------------------------------------------

export function buildConjuracaoCancelarHandler(deps: ConjuracaoHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    const parsed = EtmosConjuracaoCancelarPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { messageId } = parsed.data;

    const msg = loadChatMessage(deps.db, messageId);
    if (!msg) return ackError("NOT_FOUND", `ChatMessage not found: ${messageId}`);
    const cardResult = readCard(msg);
    if (cardResult.corrupted) {
      return ackError(
        "VALIDATION_FAILED",
        `Corrupted conjuração card flags on message ${messageId}`,
      );
    }
    const card = cardResult.card;
    if (!card) return ackError("NOT_FOUND", `No conjuração card on message ${messageId}`);

    const ator = resolveAtor(deps.store, ctx, card.conjurador_actor_id);
    if (ator === null) {
      return ackError(
        "PERMISSION_DENIED",
        "You do not own this Actor and are not a Narrador — cannot cancelar this conjuração",
      );
    }

    // jaRolou is derived from the card's own state, not trusted from the
    // client — `rolada`/`resolvida` are the only states where a roll has
    // happened, matching the state machine's own `estado` bookkeeping.
    const jaRolou = card.estado === "rolada" || card.estado === "resolvida";

    if (!podeTransicionar(card.estado, "cancelada", "cancelar", { ator, jaRolou })) {
      return ackError(
        "VALIDATION_FAILED",
        `Cannot cancelar from state "${card.estado}" (jaRolou=${String(jaRolou)})`,
      );
    }

    // REQ-ETM-033: cancelamento nunca aplica custo — aplicar("cancelar") does
    // not touch custo_estresse/complexidade, and this handler never calls
    // custoEstresse() or the Actor store at all.
    const nextCard = aplicar(card, "cancelar");
    const nextMsg = writeCard(msg, nextCard);
    updateChatMessage(deps.db, nextMsg);
    const seq = broadcastChatMessage(deps, nextMsg);

    return ackOk({ message: nextMsg }, seq);
  };
}
