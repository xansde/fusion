/**
 * Etmos Teste Contestado — server-side socket handler (REQ-ETM-021, CA-6).
 *
 * `etmos:teste:contestado` rolls BOTH sides' `2d6+mod` formulas through the
 * SAME authoritative `RollService` every other roll path uses (DEC-CBT-03),
 * then hands the two totals to the pure `resolverContestado` (`@fusion/system-etmos`)
 * to decide the winner — this handler never re-implements the tiebreak rules
 * itself (higher total; empate → provocador; empate → PC beats NPC, CA-6).
 *
 * A single public ChatMessage documents both rolls and the outcome, using the
 * SAME broadcast plumbing (opBuffer push-before-emit, ChatMessage shape) the
 * Compositor's card handlers already use (conjuracao-handlers.ts) — no new
 * envelope/broadcast convention invented here.
 *
 * Permission: any authenticated user may initiate a Teste Contestado — unlike
 * the Compositor cards, this is a one-shot dice action, not a stateful
 * document a specific Actor owns. `isPc` per side is resolved from Actor
 * ownership (mirrors combat-handlers.ts's hasPlayerOwner detection) so
 * `resolverContestado`'s CA-6 rule ("PC vence empate contra NPC") has a real
 * signal to work with; a side with no `actorId` is treated as NPC (isPc=false).
 *
 * Spec: 19-sistema-etmos.md REQ-ETM-021, CA-6.
 */

import type { Namespace } from "socket.io";
import type { Database as Db } from "better-sqlite3";
import {
  createDocumentId,
  defaultStats,
  CHAT_BROADCAST_EVENT,
  CHAT_DOCUMENT_TYPE,
} from "@fusion/shared";
import { EtmosTesteContestadoPayloadSchema } from "@fusion/shared";
import type { ChatMessage, Envelope, Ack, ErrorCode } from "@fusion/shared";

import { resolverContestado } from "@fusion/system-etmos";
import type { ParticipanteContestado } from "@fusion/system-etmos";

import type { HandlerFn, HandlerContext } from "../net/handler-registry.js";
import type { SeqStore } from "../net/seq-store.js";
import type { OpBuffer } from "../net/op-buffer.js";
import type { DocumentStore } from "../documents/store.js";
import { testOwnership, UserRole, OwnershipLevel } from "../documents/ownership.js";
import type { Ownership } from "../documents/ownership.js";
import { RollService, RollError } from "../chat/roll-service.js";
import type { RollServiceOptions } from "../chat/roll-service.js";

// ---------------------------------------------------------------------------
// Handler dependency bundle
// ---------------------------------------------------------------------------

export interface ContestadoHandlerDeps {
  readonly store: DocumentStore;
  readonly db: Db;
  readonly ns: Namespace;
  readonly seqStore: SeqStore;
  readonly opBuffer: OpBuffer;
  readonly worldId: string;
  /** Optional RNG override for tests — forwarded to the internal RollService. */
  readonly rollServiceOptions?: Partial<RollServiceOptions>;
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
// isPc — hasPlayerOwner detection, mirrors combat-handlers.ts's check on
// combat:addCombatant (default-ownership + per-user PLAYER-role OWNER scan).
// A null actorId (anonymous/NPC-only side) is treated as NOT a PC.
// ---------------------------------------------------------------------------

function defaultGrantsPlayerOwnership(ownership: Ownership): boolean {
  return testOwnership(ownership, " default-probe", UserRole.PLAYER, OwnershipLevel.OWNER);
}

function isPcActor(store: DocumentStore, actorId: string | null): boolean {
  if (actorId === null) return false;
  try {
    const actor = store.get("actors", actorId);
    const ownership = actor["ownership"];
    if (!ownership || typeof ownership !== "object" || Array.isArray(ownership)) return false;
    const ownerMap = ownership as Ownership;
    return (
      defaultGrantsPlayerOwnership(ownerMap) ||
      Object.keys(ownerMap).some(
        (key) =>
          key !== "default" && testOwnership(ownerMap, key, UserRole.PLAYER, OwnershipLevel.OWNER),
      )
    );
  } catch {
    return false;
  }
}

function resolveActorName(db: Db, actorId: string | null): string {
  if (actorId === null) return "Participante";
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
  return "Participante";
}

// ---------------------------------------------------------------------------
// Broadcast helper — same ChatMessage/opBuffer convention as
// conjuracao-handlers.ts's broadcastChatMessage.
// ---------------------------------------------------------------------------

function broadcastChatMessage(deps: ContestadoHandlerDeps, msg: ChatMessage): number {
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
  // REQ-NET-062: push BEFORE emitting (resync:delta replay safety).
  deps.opBuffer.push(envelope);
  for (const [, socket] of deps.ns.sockets) {
    socket.emit("op", envelope);
  }
  return seq;
}

function persistChatMessage(db: Db, msg: ChatMessage): void {
  const now = Date.now();
  const data = JSON.stringify(msg);
  db.prepare(
    `INSERT INTO chat_messages (id, data, timestamp, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(msg._id, data, msg.timestamp, msg.speaker.userId, now, now);
}

// ---------------------------------------------------------------------------
// etmos:teste:contestado — REQ-ETM-021, CA-6
// ---------------------------------------------------------------------------

const MOTIVO_LABEL: Record<string, string> = {
  maiorTotal: "maior resultado",
  provocadorVenceEmpate: "empate — quem provocou vence",
  pcVenceEmpateContraNpc: "empate — jogador vence contra NPC",
  empate: "empate — sem vencedor mecânico",
};

export function buildContestadoHandler(deps: ContestadoHandlerDeps): HandlerFn {
  const rollService = new RollService({ db: deps.db, ...deps.rollServiceOptions });

  return (rawPayload, ctx: HandlerContext) => {
    const parsed = EtmosTesteContestadoPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { a, b, descricao } = parsed.data;

    let totalA: number;
    let totalB: number;
    try {
      totalA = rollService.roll({
        formula: a.formula,
        mode: "public",
        worldId: deps.worldId,
        userId: ctx.userId,
        ...(a.actorId !== null ? { actorId: a.actorId } : {}),
      }).total;
      totalB = rollService.roll({
        formula: b.formula,
        mode: "public",
        worldId: deps.worldId,
        userId: ctx.userId,
        ...(b.actorId !== null ? { actorId: b.actorId } : {}),
      }).total;
    } catch (err) {
      if (err instanceof RollError) {
        return ackError("VALIDATION_FAILED", err.message);
      }
      throw err;
    }

    const participanteA: ParticipanteContestado = {
      total: totalA,
      isPc: isPcActor(deps.store, a.actorId),
      provocador: a.provocador,
    };
    const participanteB: ParticipanteContestado = {
      total: totalB,
      isPc: isPcActor(deps.store, b.actorId),
      provocador: b.provocador,
    };

    const resultado = resolverContestado(participanteA, participanteB);

    const nomeA = resolveActorName(deps.db, a.actorId);
    const nomeB = resolveActorName(deps.db, b.actorId);
    const nomeVencedor: string | null =
      resultado.vencedor === "a" ? nomeA : resultado.vencedor === "b" ? nomeB : null;

    const titulo = descricao ? `Teste Contestado: ${descricao}` : "Teste Contestado";
    const content =
      `${titulo}\n${nomeA}: ${String(totalA)} vs ${nomeB}: ${String(totalB)}\n` +
      (nomeVencedor !== null
        ? `Vencedor: ${nomeVencedor} (${MOTIVO_LABEL[resultado.motivo] ?? resultado.motivo})`
        : `Sem vencedor mecânico (${MOTIVO_LABEL[resultado.motivo] ?? resultado.motivo}) — o Narrador arbitra.`);

    const stats = defaultStats("0.1.0");
    const msg: ChatMessage = {
      _id: createDocumentId(),
      worldId: deps.worldId,
      type: "system",
      content,
      speaker: { userId: ctx.userId, alias: "Teste Contestado" },
      timestamp: Date.now(),
      whisper: [],
      blind: false,
      sort: 0,
      ownership: { default: 0 },
      flags: {
        etmos: {
          contestado: {
            a: {
              actorId: a.actorId,
              total: totalA,
              isPc: participanteA.isPc,
              provocador: a.provocador,
            },
            b: {
              actorId: b.actorId,
              total: totalB,
              isPc: participanteB.isPc,
              provocador: b.provocador,
            },
            vencedor: resultado.vencedor,
            motivo: resultado.motivo,
            margem: resultado.margem,
          },
        },
      },
      _stats: { ...stats, lastModifiedBy: ctx.userId, createdBy: ctx.userId },
    };

    persistChatMessage(deps.db, msg);
    const seq = broadcastChatMessage(deps, msg);

    return ackOk({ message: msg, resultado, totalA, totalB }, seq);
  };
}
