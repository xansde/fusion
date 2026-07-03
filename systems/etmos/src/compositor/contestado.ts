/**
 * @fusion/system-etmos — resolverContestado() (Teste Contestado, REQ-ETM-021, CA-6).
 *
 * Pure, deterministic resolver (REQ-ETM-NFR-001) for the outcome of a
 * Teste Contestado GIVEN two already-rolled `2d6+mod` totals. This function
 * never rolls dice itself — dice ALWAYS go through RollService on the
 * server (REQ-ETM-NFR-002, DEC-CBT-03); the caller (server handler) rolls
 * both sides first, then calls this to decide the winner.
 *
 * Resolution rule (spec 19 REQ-ETM-021, CA-6):
 *   1. Higher total wins.
 *   2. Tied totals → the side that PROVOCOU (initiated) the test wins.
 *   3. Tied totals, no provocador distinguishable (or both/neither flagged as
 *      provocador) → a jogador (PC) wins against a personagem do Narrador (NPC).
 *      CA-6: "Um Teste Contestado entre um jogador e um NPC com empate é
 *      resolvido a favor do jogador."
 *   4. Still tied (both PC, or both NPC, or provocador unknown on both) →
 *      "empate" (no winner) — the Narrador arbitrates narratively (D8).
 *
 * Design doc m5-etmos-compositor.md — Teste Contestado is [ETM-CORE] scope
 * per spec 19 §Requisitos funcionais "Rolagens (testes)".
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LadoContestado = "a" | "b";

/** One side's inputs to a Teste Contestado. */
export interface ParticipanteContestado {
  /** The already-rolled `2d6+mod` total (RollService — never computed here). */
  readonly total: number;
  /** True if this side is a player-owned Actor (PC); false for NPC/Narrador-controlled. */
  readonly isPc: boolean;
  /** True if this side provocou (initiated) the Teste Contestado. */
  readonly provocador: boolean;
}

export interface ResolverContestadoResult {
  /** The winning side, or `null` on an unresolved empate (Narrador arbitrates, D8). */
  readonly vencedor: LadoContestado | null;
  /** Human/i18n-agnostic reason code — for chat message / UI display. */
  readonly motivo: "maiorTotal" | "provocadorVenceEmpate" | "pcVenceEmpateContraNpc" | "empate";
  /** `a.total - b.total` — positive favors "a", negative favors "b", 0 = tied totals. */
  readonly margem: number;
}

// ---------------------------------------------------------------------------
// resolverContestado
// ---------------------------------------------------------------------------

/**
 * Resolve a Teste Contestado between two participants given their already
 * rolled totals (REQ-ETM-021, CA-6).
 */
export function resolverContestado(
  a: ParticipanteContestado,
  b: ParticipanteContestado,
): ResolverContestadoResult {
  const margem = a.total - b.total;

  // 1. Higher total wins outright.
  if (margem > 0) return { vencedor: "a", motivo: "maiorTotal", margem };
  if (margem < 0) return { vencedor: "b", motivo: "maiorTotal", margem };

  // 2. Tied total: the provocador wins (REQ-ETM-021). Only meaningful when
  // exactly one side is flagged as provocador — if both or neither are, this
  // rule cannot distinguish a winner and falls through to rule 3.
  if (a.provocador !== b.provocador) {
    return { vencedor: a.provocador ? "a" : "b", motivo: "provocadorVenceEmpate", margem };
  }

  // 3. Tied total, provocador tied/unknown: PC beats NPC (CA-6).
  if (a.isPc !== b.isPc) {
    return { vencedor: a.isPc ? "a" : "b", motivo: "pcVenceEmpateContraNpc", margem };
  }

  // 4. Fully tied (same total, same provocador flag, same PC/NPC status) —
  // no mechanical winner; the Narrador arbitrates narratively (D8).
  return { vencedor: null, motivo: "empate", margem };
}
