/**
 * Etmos Marcos de Crescimento + Tabela E — server-side confirm handler
 * (REQ-ETM-035..039, CA-11).
 *
 * `etmos:progressao:confirmar` applies a level-up: increments `system.nivel`,
 * resets the 3 Marcos trilhas, and applies the semiautomatic bônus for each
 * categoria (REQ-ETM-038). The pure `confirmarSubidaDeNivel`
 * (@fusion/system-etmos) decides WHETHER the confirmation is valid
 * (trilhas completas, nivel < 6, all 3 categorias chosen) and what the reset
 * trilhas/new nivel look like; this handler is the I/O orchestrator that
 * reads the Actor, calls that pure function, and applies the bônus payload
 * the client already resolved via its own selector UI:
 *
 *   - Atributo bônus: `{ atributo: "corpo"|"alma"|"mente" }` — a direct
 *     `system.atributos.<attr>.value += 1` (clamped to 6, D2's max).
 *   - Partícula/Habilidade bônus: `{ itemIds: string[] }` — Item documents
 *     the CLIENT already resolved (from the compendium picker / a newly
 *     created Item document) and asks the server to embed onto the Orador's
 *     `items` array. The server does not itself run a compendium search or
 *     create Habilidade Items — that selector UI is client-side (mirrors
 *     how every other embedded-Item add flow in this codebase already works:
 *     there is no existing server-side "add embedded item" primitive to
 *     reuse, and building a full compendium-picker pipeline is out of this
 *     batch's scope — see design doc §6 M5-E notes). The server's job here
 *     is narrower but still real: it validates the itemIds actually resolve
 *     to real Item documents of a plausible type before embedding them, and
 *     it is the ONE place that atomically bundles "nivel++, trilhas reset,
 *     bônus applied" into a single Actor update — no client ever has to
 *     coordinate 3 separate writes.
 *
 * Permission: GM or the Actor's owner (mirrors conjuracao-handlers.ts's
 * resolveAtor/isOwnerOfActor pattern).
 */

import { z } from "zod";
import {
  confirmarSubidaDeNivel,
  opcoesProgressao,
  type MarcosCrescimento,
  type EscolhasSubidaNivel,
  type CategoriaBonus,
} from "@fusion/system-etmos";
import type { Ack, ErrorCode, Envelope } from "@fusion/shared";

import type { HandlerFn, HandlerContext } from "../net/handler-registry.js";
import type { SeqStore } from "../net/seq-store.js";
import type { OpBuffer } from "../net/op-buffer.js";
import type { Namespace } from "socket.io";
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

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

const AtributoBonusSchema = z.object({
  tipo: z.literal("atributo"),
  atributo: z.enum(["corpo", "alma", "mente"]),
});

const ItemsBonusSchema = z.object({
  tipo: z.literal("items"),
  /** Item document ids the client already resolved (compendium pick / created Habilidade). */
  itemIds: z.array(z.string().min(1).max(64)).min(1).max(10),
});

const BonusEscolhidoSchema = z.union([AtributoBonusSchema, ItemsBonusSchema]);

export const EtmosProgressaoConfirmarPayloadSchema = z
  .object({
    actorId: z.string().min(1).max(64),
    fisica: BonusEscolhidoSchema,
    mental: BonusEscolhidoSchema,
    emocional: BonusEscolhidoSchema,
  })
  .strict();

export type EtmosProgressaoConfirmarPayload = z.infer<typeof EtmosProgressaoConfirmarPayloadSchema>;

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface ProgressaoHandlerDeps {
  readonly store: DocumentStore;
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

function readMarcos(sys: Record<string, unknown>): MarcosCrescimento {
  const m = (sys["marcos_crescimento"] as Record<string, unknown> | undefined) ?? {};
  const trilha = (key: string): { value: number; max: number } => {
    const t = (m[key] as Record<string, unknown> | undefined) ?? {};
    return {
      value: typeof t["value"] === "number" ? t["value"] : 0,
      max: typeof t["max"] === "number" ? t["max"] : 5,
    };
  };
  return {
    fisicos: trilha("fisicos"),
    mentais: trilha("mentais"),
    emocionais: trilha("emocionais"),
  };
}

function readNivel(sys: Record<string, unknown>): number {
  return typeof sys["nivel"] === "number" ? sys["nivel"] : 1;
}

function readAtributo(sys: Record<string, unknown>, attr: string): number {
  const atributos = sys["atributos"] as Record<string, unknown> | undefined;
  const entry = atributos?.[attr] as Record<string, unknown> | undefined;
  const value = entry?.["value"];
  return typeof value === "number" ? value : 1;
}

/**
 * Derive the bônus `tipo` a categoria MUST use at this transição, from
 * Tabela E's own opção text (`opcoesProgressao`'s single source of truth —
 * see systems/etmos/src/compositor/progressao.ts). Every Tabela E row's
 * "mental" opção text is "+1 ponto de Atributo..." (tipo "atributo"); every
 * "fisica"/"emocional" opção grants Grimório/Habilidade Items (tipo
 * "items") — never the reverse, at any nivel. Anti-forge (M5-E audit): a
 * payload whose bonus.tipo doesn't match this derivation is rejected
 * wholesale — else an owner could send `{tipo:"atributo"}` on all 3
 * categorias and gain +3 Atributo per level-up instead of the +1 Tabela E
 * actually grants for "mental".
 */
function tipoEsperado(opcaoTexto: string): "atributo" | "items" {
  return opcaoTexto.includes("Atributo") ? "atributo" : "items";
}

// ---------------------------------------------------------------------------
// buildProgressaoConfirmarHandler
// ---------------------------------------------------------------------------

export function buildProgressaoConfirmarHandler(deps: ProgressaoHandlerDeps): HandlerFn {
  return (rawPayload, ctx: HandlerContext) => {
    const parsed = EtmosProgressaoConfirmarPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return ackError("VALIDATION_FAILED", parsed.error.message);
    }
    const { actorId, fisica, mental, emocional } = parsed.data;

    if (!isRolePrivileged(ctx.role) && !isOwnerOfActor(deps.store, actorId, ctx.userId)) {
      return ackError(
        "PERMISSION_DENIED",
        "You do not own this Actor and are not a Narrador — cannot confirm progressão",
      );
    }

    let actor: Record<string, unknown>;
    try {
      actor = deps.store.get("actors", actorId);
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return ackError("NOT_FOUND", `Actor not found: ${actorId}`);
      }
      throw err;
    }
    if (actor["type"] !== "orador") {
      return ackError("VALIDATION_FAILED", "Only Orador actors have Marcos de Crescimento");
    }

    const sys = (actor["system"] as Record<string, unknown> | undefined) ?? {};
    const marcos = readMarcos(sys);
    const nivelAtual = readNivel(sys);

    const escolhas: EscolhasSubidaNivel = { fisica: true, mental: true, emocional: true };
    const result = confirmarSubidaDeNivel(nivelAtual, marcos, escolhas);
    if (!result.ok) {
      const messages: Record<string, string> = {
        trilhasIncompletas:
          "As 3 trilhas de Marcos precisam estar completas (5+5+5) para subir de nível",
        nivelMaximo: "Este Orador já está no Nível máximo (6)",
        categoriaFaltando:
          "É necessário escolher um bônus para cada categoria (Físico/Mental/Emocional)",
      };
      return ackError(
        "VALIDATION_FAILED",
        messages[result.erro ?? ""] ?? "Cannot confirm progressão",
      );
    }

    // Anti-forge (M5-E audit FIX 1): the expected bônus `tipo` per categoria
    // is DERIVED from Tabela E (opcoesProgressao(nivelAtual)) — the same
    // source of truth already shown to the player in the UI — never trusted
    // from the client payload alone. A payload whose tipo diverges (e.g. an
    // owner sending {tipo:"atributo"} for "fisica", which Tabela E always
    // grants as Grimório Items) is rejected wholesale before any mutation.
    const opcao = opcoesProgressao(nivelAtual);
    if (opcao === null) {
      return ackError("VALIDATION_FAILED", "Cannot confirm progressão");
    }
    const categoriaBonus: Record<CategoriaBonus, EtmosProgressaoConfirmarPayload["fisica"]> = {
      fisica,
      mental,
      emocional,
    };
    const opcaoTextoPorCategoria: Record<CategoriaBonus, string> = {
      fisica: opcao.fisica,
      mental: opcao.mental,
      emocional: opcao.emocional,
    };
    for (const categoria of ["fisica", "mental", "emocional"] as const) {
      const esperado = tipoEsperado(opcaoTextoPorCategoria[categoria]);
      const recebido = categoriaBonus[categoria].tipo;
      if (recebido !== esperado) {
        return ackError(
          "VALIDATION_FAILED",
          `Bônus de categoria "${categoria}" deve ser do tipo "${esperado}" nesta transição (Tabela E) — recebido "${recebido}"`,
        );
      }
    }

    // Resolve the 3 bônus into a single system-patch + items-append.
    const systemPatch: Record<string, unknown> = {
      nivel: result.novoNivel,
      marcos_crescimento: result.trilhasReiniciadas,
    };
    const itemIdsToEmbed: string[] = [];

    for (const bonus of [fisica, mental, emocional]) {
      if (bonus.tipo === "atributo") {
        const atributos = (systemPatch["atributos"] as Record<string, unknown> | undefined) ?? {};
        const current = readAtributo(sys, bonus.atributo);
        const next = Math.min(6, current + 1);
        systemPatch["atributos"] = { ...atributos, [bonus.atributo]: { value: next } };
      } else {
        itemIdsToEmbed.push(...bonus.itemIds);
      }
    }

    // Resolve + append embedded items (Partícula/Habilidade bônus). Each id
    // must resolve to a real Item document — a forged/stale id is rejected
    // wholesale (VALIDATION_FAILED) rather than silently dropped, so the
    // client's selector state and the persisted Actor never diverge.
    const existingItems = Array.isArray(actor["items"])
      ? (actor["items"] as Record<string, unknown>[])
      : [];
    const newItems: Record<string, unknown>[] = [];
    for (const itemId of itemIdsToEmbed) {
      let itemDoc: Record<string, unknown>;
      try {
        itemDoc = deps.store.get("items", itemId);
      } catch {
        return ackError("VALIDATION_FAILED", `Item not found for bônus: ${itemId}`);
      }
      if (itemDoc["type"] !== "particula" && itemDoc["type"] !== "habilidade") {
        return ackError(
          "VALIDATION_FAILED",
          `Item ${itemId} is not a valid Marcos bônus type (particula/habilidade)`,
        );
      }
      newItems.push(itemDoc);
    }

    let updated: Record<string, unknown> | null;
    try {
      updated = deps.store.update(
        "actors",
        actorId,
        {
          system: systemPatch,
          ...(newItems.length > 0 ? { items: [...existingItems, ...newItems] } : {}),
        },
        { userId: ctx.userId },
      );
    } catch {
      return ackError("INTERNAL_ERROR", "Failed to apply progressão");
    }
    if (!updated) {
      return ackError("INTERNAL_ERROR", "Progressão update returned null");
    }

    const seq = deps.seqStore.next();
    const envelope: Envelope = {
      type: "doc:update",
      seq,
      ts: Date.now(),
      payload: { documentType: "Actor", documents: [updated] },
    };
    deps.opBuffer.push(envelope);
    // REQ-NET-096: an Actor is ownership-gated on emission — per socket, never
    // namespace-wide, or the whole sheet reaches every connected player.
    emitDocumentOp(deps.ns, envelope);

    return ackOk({ actor: updated, novoNivel: result.novoNivel }, seq);
  };
}
