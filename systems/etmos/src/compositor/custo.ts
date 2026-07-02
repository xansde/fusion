/**
 * @fusion/system-etmos — limiteFerimentos/limiteEstresse/complexidadeMaxima/
 * estadoFadiga/custoEstresse (Tabelas A-D).
 *
 * Pure, deterministic (REQ-ETM-NFR-001). The Complexidade ITSELF is NEVER
 * computed here — it is arbitrated by the Narrador (D4) and passed in; these
 * functions only turn attributes / an already-chosen Complexidade into
 * limits/costs/fadiga state.
 *
 * Design doc m5-etmos-compositor.md §2.4. Spec 19-sistema-etmos.md
 * REQ-ETM-007..010, REQ-ETM-024, REQ-ETM-043 (Rank de Totem), CA-1/CA-2/CA-3/CA-12.
 */
import type { Complexidade, EstadoFadiga } from "../types.js";

/**
 * Tabela B — Limite de Ferimentos = 4 + floor(Corpo / 2).
 * REQ-ETM-007. Verified: Corpo 1->4, 2->5, 3->5, 4->6, 5->6, 6->7.
 */
export function limiteFerimentos(corpo: number): number {
  return 4 + Math.floor(corpo / 2);
}

/**
 * Tabela C — Limite de Estresse = 4 + Alma.
 * REQ-ETM-008. Verified: Alma 1->5, 2->6, ..., 6->10.
 */
export function limiteEstresse(alma: number): number {
  return 4 + alma;
}

/**
 * Tabela A — Complexidade Máxima conjurável, derivada de Mente.
 * REQ-ETM-009: Trivial/Regular sempre disponíveis; Difícil se Mente > 2;
 * Complexa se Mente > 4; Milagre se Mente = 6 (máximo).
 */
export function complexidadeMaxima(mente: number): Complexidade {
  if (mente >= 6) return "milagre";
  if (mente >= 5) return "complexa";
  if (mente >= 3) return "dificil";
  return "regular"; // trivial e regular sempre disponíveis
}

/** Tabela A — custo fixo de Estresse por Complexidade. */
export const CUSTO_BASE: Readonly<Record<Complexidade, number>> = {
  trivial: 0,
  regular: 1,
  dificil: 2,
  complexa: 4,
  milagre: 7,
};

/**
 * Custo de Estresse = CUSTO_BASE[complexidade] + rankTotem, exceto para
 * Complexidade "trivial" — Rank de Totem só soma em magia NÃO Trivial
 * (REQ-ETM-043, CA-12; design doc §2.4 "Rank só soma em magia NÃO Trivial").
 *
 * `rankTotem` is clamped to >= 0 defensively (Totem rank is 0..5 by schema,
 * but this function stays safe for any caller).
 */
export function custoEstresse(c: Complexidade, rankTotem: number): number {
  const extraTotem = c === "trivial" ? 0 : Math.max(0, rankTotem);
  return CUSTO_BASE[c] + extraTotem;
}

/**
 * Tabela D — Estado de Fadiga a partir de (Estresse atual − Limite de Estresse).
 * REQ-ETM-010: Normal (d<=0), Cansado (1-5), Exausto (6-8), Esgotado (9+).
 */
export function estadoFadiga(estresse: number, limite: number): EstadoFadiga {
  const d = estresse - limite;
  if (d <= 0) return "normal";
  if (d <= 5) return "cansado";
  if (d <= 8) return "exausto";
  return "esgotado";
}
