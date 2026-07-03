/**
 * conjuracaoCardVM.ts — View-model for ConjuracaoCard.svelte (chat card).
 *
 * Renders the Compositor de Magias negotiation card by state and by the
 * viewing user's role (design doc m5-etmos-compositor.md §3.4):
 *
 *   proposta   — frase+intenção; GM sees [Arbitrar]/[Recusar]; dono sees [Cancelar].
 *   arbitrada  — dono/GM see [Rolar Conjuração].
 *   rolada     — shows the linked roll result (roll_message_id), classe de
 *                dificuldade, sucesso/falha+margem, controle de Fadiga if any;
 *                GM sees [Resolver] with a narração field.
 *   resolvida/recusada/cancelada — read-only final state with history.
 *
 * This VM NEVER re-implements the state machine's guard predicate
 * (podeTransicionar) — it only decides WHICH BUTTONS TO SHOW, matching what
 * the server will accept. The server is the single source of truth for
 * whether a transition is actually legal; a stale VM showing a button that
 * the server then rejects is an acceptable (and rare) UX edge case, not a
 * security concern — auth is enforced server-side, never here.
 *
 * Design doc §3.4. Spec 19-sistema-etmos.md REQ-ETM-029..033, REQ-ETM-026
 * (excede_maxima advisory badge).
 */

import { custoEstresse } from "@fusion/system-etmos";
import type { ConjuracaoCard, Complexidade, EstadoConjuracao } from "@fusion/system-etmos";

// ---------------------------------------------------------------------------
// Role — resolved by the caller (mirrors AtorConjuracao server-side, but this
// VM also needs to represent "neither dono nor GM" for read-only bystanders).
// ---------------------------------------------------------------------------

export type ViewerRole = "dono" | "gm" | "outro";

export function resolveViewerRole(opts: {
  isGm: boolean;
  isOwnerOfConjurador: boolean;
}): ViewerRole {
  if (opts.isGm) return "gm";
  if (opts.isOwnerOfConjurador) return "dono";
  return "outro";
}

// ---------------------------------------------------------------------------
// Op payloads — mirror the shared protocol schemas 1:1 (packages/shared/src/etmos/protocol.ts)
// ---------------------------------------------------------------------------

export interface ArbitrarOp {
  type: "etmos:conjuracao:arbitrar";
  messageId: string;
  complexidade?: Complexidade | null;
  custoEstresseOverride?: number | null;
  notasNarrador?: string;
  dificuldadeAlvo?: number | null;
  recusar?: boolean;
}

export interface RolarOp {
  type: "etmos:conjuracao:rolar";
  messageId: string;
}

export interface ResolverOp {
  type: "etmos:conjuracao:resolver";
  messageId: string;
}

export interface CancelarOp {
  type: "etmos:conjuracao:cancelar";
  messageId: string;
}

// ---------------------------------------------------------------------------
// Complexidade <-> numeric shortcut (1-5), REQ-ETM-030 "atalho de apresentação".
// The persisted value is ALWAYS the textual enum — this mapping is UI-only.
// ---------------------------------------------------------------------------

export const COMPLEXIDADE_NUMERO: readonly Complexidade[] = [
  "trivial",
  "regular",
  "dificil",
  "complexa",
  "milagre",
];

export function complexidadeParaNumero(c: Complexidade): number {
  return COMPLEXIDADE_NUMERO.indexOf(c) + 1;
}

export function numeroParaComplexidade(n: number): Complexidade {
  const idx = Math.min(Math.max(n, 1), COMPLEXIDADE_NUMERO.length) - 1;
  return COMPLEXIDADE_NUMERO[idx] ?? "trivial";
}

// ---------------------------------------------------------------------------
// ConjuracaoCardVM
// ---------------------------------------------------------------------------

export class ConjuracaoCardVM {
  private readonly _card: ConjuracaoCard;
  private readonly _messageId: string;
  private readonly _role: ViewerRole;
  /** Rank de Totem of the conjurador — used to compute the suggested custo live in the arbitrar panel. */
  private readonly _rankTotem: number;

  constructor(opts: {
    card: ConjuracaoCard;
    messageId: string;
    role: ViewerRole;
    rankTotem?: number;
  }) {
    this._card = opts.card;
    this._messageId = opts.messageId;
    this._role = opts.role;
    this._rankTotem = opts.rankTotem ?? 0;
  }

  get card(): ConjuracaoCard {
    return this._card;
  }

  get estado(): EstadoConjuracao {
    return this._card.estado;
  }

  get role(): ViewerRole {
    return this._role;
  }

  get isFinal(): boolean {
    return (
      this._card.estado === "resolvida" ||
      this._card.estado === "recusada" ||
      this._card.estado === "cancelada"
    );
  }

  // -------------------------------------------------------------------------
  // Button visibility — one getter per action, matching podeTransicionar's
  // guard shape (ator + estado) without importing the server-side module.
  // -------------------------------------------------------------------------

  get podeArbitrar(): boolean {
    return this._role === "gm" && this._card.estado === "proposta";
  }

  get podeRecusar(): boolean {
    return this._role === "gm" && this._card.estado === "proposta";
  }

  get podeCancelar(): boolean {
    return (
      (this._role === "dono" || this._role === "gm") &&
      (this._card.estado === "proposta" || this._card.estado === "arbitrada")
    );
  }

  get podeRolar(): boolean {
    return (this._role === "dono" || this._role === "gm") && this._card.estado === "arbitrada";
  }

  get podeResolver(): boolean {
    return this._role === "gm" && this._card.estado === "rolada";
  }

  // -------------------------------------------------------------------------
  // Arbitrar panel helpers (design doc §3.4 mini-painel)
  // -------------------------------------------------------------------------

  /** Suggested custo for a Complexidade choice, live-computed via the pure custoEstresse(). */
  custoSugerido(complexidade: Complexidade): number {
    return custoEstresse(complexidade, this._rankTotem);
  }

  buildArbitrarOp(opts: {
    complexidade: Complexidade;
    custoEstresseOverride?: number | null;
    notasNarrador?: string;
    dificuldadeAlvo?: number | null;
  }): ArbitrarOp {
    return {
      type: "etmos:conjuracao:arbitrar",
      messageId: this._messageId,
      complexidade: opts.complexidade,
      ...(opts.custoEstresseOverride !== undefined
        ? { custoEstresseOverride: opts.custoEstresseOverride }
        : {}),
      ...(opts.notasNarrador !== undefined ? { notasNarrador: opts.notasNarrador } : {}),
      ...(opts.dificuldadeAlvo !== undefined ? { dificuldadeAlvo: opts.dificuldadeAlvo } : {}),
    };
  }

  buildRecusarOp(notasNarrador?: string): ArbitrarOp {
    return {
      type: "etmos:conjuracao:arbitrar",
      messageId: this._messageId,
      recusar: true,
      ...(notasNarrador !== undefined ? { notasNarrador } : {}),
    };
  }

  buildRolarOp(): RolarOp {
    return { type: "etmos:conjuracao:rolar", messageId: this._messageId };
  }

  buildResolverOp(): ResolverOp {
    return { type: "etmos:conjuracao:resolver", messageId: this._messageId };
  }

  buildCancelarOp(): CancelarOp {
    return { type: "etmos:conjuracao:cancelar", messageId: this._messageId };
  }

  // -------------------------------------------------------------------------
  // Display helpers
  // -------------------------------------------------------------------------

  /** REQ-ETM-026: advisory badge — the arbitrated Complexidade exceeds the conjurador's ceiling. */
  get mostrarAvisoExcedeMaxima(): boolean {
    return this._card.excede_maxima;
  }

  get resultadoLabel(): string | null {
    if (this._card.sucesso === null) return null;
    return this._card.sucesso ? "ETMOS.Card.Resultado.sucesso" : "ETMOS.Card.Resultado.falha";
  }

  get classeDificuldadeLabel(): string | null {
    if (!this._card.classe_dificuldade) return null;
    return `ETMOS.ClasseDificuldade.${this._card.classe_dificuldade}`;
  }

  get temControleFadiga(): boolean {
    return this._card.controle_fadiga !== null && this._card.controle_fadiga.rolou;
  }
}
