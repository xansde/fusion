/**
 * @fusion/system-etmos — Reação por rodada (REQ-ETM-023).
 *
 * Pure, deterministic helpers (REQ-ETM-NFR-001) for the "1 Reação por
 * rodada por Combatant, resetada no início do próprio turno" tracker. The
 * Habilidade "Agilidade Mental" (packs-src/habilidades.json id
 * "agilidade-mental") elevates the max to 2; the 2ª Reação used in a round
 * accumulates +3 Estresse (same Tabela-A-adjacent cost path the Compositor
 * uses at resolver time — REQ-ETM-024).
 *
 * The server (packages/server/src/etmos/reacao-handler.ts) owns the I/O:
 * WHERE the counter is persisted (`CombatantDocument.flags.etmos.reacoes`,
 * the per-combatant namespaced-flags bag — spec 10 §Modelo de dados) and
 * WHEN it resets (the real production turnStart lifecycle event,
 * CombatEventBus). This module only decides the numbers.
 *
 * Design doc m5-etmos-compositor.md §6 (M5-E). Spec 19-sistema-etmos.md
 * REQ-ETM-023.
 */

// ---------------------------------------------------------------------------
// hasAgilidadeMental — embedded Item detection
// ---------------------------------------------------------------------------

/**
 * Detect whether an Orador Actor document has the "Agilidade Mental"
 * Habilidade embedded. Habilidade items (schemas/item-habilidade.ts) carry
 * no mechanical slug field — only `categoria`/`bonus`/etc — so the ONLY
 * identifier available is the embedded Item's `name`, exactly as compiled
 * from packs-src/habilidades.json ("Agilidade Mental", id "agilidade-mental").
 * This is intentionally the single source of truth for this check — no
 * caller should re-match the name string itself.
 */
const AGILIDADE_MENTAL_NOME = "Agilidade Mental";

export function hasAgilidadeMental(actorDoc: Record<string, unknown>): boolean {
  const items = actorDoc["items"];
  if (!Array.isArray(items)) return false;
  return (items as Record<string, unknown>[]).some(
    (item) => item["type"] === "habilidade" && item["name"] === AGILIDADE_MENTAL_NOME,
  );
}

// ---------------------------------------------------------------------------
// maxReacoes — REQ-ETM-023
// ---------------------------------------------------------------------------

/** 1 Reação por rodada by default; 2 with "Agilidade Mental". */
export function maxReacoes(actorDoc: Record<string, unknown> | null): number {
  if (actorDoc === null) return 1;
  return hasAgilidadeMental(actorDoc) ? 2 : 1;
}

// ---------------------------------------------------------------------------
// ReacoesState — the persisted shape (CombatantDocument.flags.etmos.reacoes)
// ---------------------------------------------------------------------------

export interface ReacoesState {
  readonly atual: number;
  readonly max: number;
}

/** Fresh state at the start of a combatant's own turn (REQ-ETM-023). */
export function resetReacoes(max: number): ReacoesState {
  return { atual: max, max };
}

// ---------------------------------------------------------------------------
// usarReacao — consume one Reação
// ---------------------------------------------------------------------------

export interface UsarReacaoResult {
  /** The new state after spending one Reação. */
  readonly state: ReacoesState;
  /** Whether the spend was allowed (atual > 0 before spending). */
  readonly permitido: boolean;
  /**
   * True when this spend was the 2ª Reação of the round (i.e. `max === 2`
   * and the combatant had exactly 1 remaining before this spend) — the
   * Agilidade Mental cost trigger (REQ-ETM-023: "a 2ª Reação acumula +3
   * Estresse"). The server applies the actual Estresse delta through the
   * SAME apply-Estresse path the Compositor's resolver uses
   * (conjuracao-handlers.ts) — this function only signals WHEN to.
   */
  readonly segundaReacaoComCusto: boolean;
}

/**
 * Spend one Reação from `state`. Returns `permitido: false` (state
 * unchanged) when there is nothing left to spend — the caller should reject
 * the action rather than silently no-op past zero.
 */
export function usarReacao(state: ReacoesState): UsarReacaoResult {
  if (state.atual <= 0) {
    return { state, permitido: false, segundaReacaoComCusto: false };
  }
  // The 2ª Reação of a max-2 round is the spend that takes atual from 1 to 0.
  const segundaReacaoComCusto = state.max >= 2 && state.atual === 1;
  return {
    state: { atual: state.atual - 1, max: state.max },
    permitido: true,
    segundaReacaoComCusto,
  };
}
