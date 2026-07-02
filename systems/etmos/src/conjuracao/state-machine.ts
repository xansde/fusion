/**
 * @fusion/system-etmos — Compositor card state machine (pure).
 *
 * `conjuracao/state-machine.ts` — REQ-ETM-029..033, design doc §2.7.
 *
 * Pure, deterministic, no I/O (REQ-ETM-NFR-001): the server (M5-C's
 * `packages/server/src/etmos/conjuracao-handlers.ts`) is the ONLY caller that
 * performs persistence/broadcast — this module only decides "is this
 * transition legal" and "what does the card look like after it".
 *
 * Transition diagram (design doc §2.7, spec 19 D5):
 *
 * ```
 * proposta  ──arbitrar(GM)──►  arbitrada  ──rolar(dono|GM)──►  rolada  ──resolver(GM)──►  resolvida
 *    │                              │
 *    ├──cancelar(dono|GM)──► cancelada    └──recusar(GM)──► recusada
 *    └──cancelar antes de rolada──► cancelada (sem custo)
 * ```
 *
 * Guardas (design doc §2.7): só o Narrador (`gm`) arbitra/resolve/recusa;
 * dono do Actor (`dono`) OU o Narrador propõe/rola/cancela. Cancelar só é
 * legal ANTES do estado `rolada` (isto é, a partir de `proposta` ou
 * `arbitrada`) — nunca depois de rolar, mesmo para o Narrador.
 *
 * The server composes the ownership half of the "dono|gm" guard itself (Actor
 * ownership check via `documents/ownership.ts`) — this module receives the
 * ALREADY-RESOLVED `ator` role for the acting user (`"dono"` or `"gm"`) and
 * never re-implements or duplicates the permission predicate itself
 * (project convention — `isRolePrivileged` stays the single source of truth
 * for "is this user a GM", the caller maps that + ownership into `ator`).
 */
import type { EstadoConjuracao } from "../types.js";
import type { ConjuracaoCard } from "../schemas/conjuracao-card.js";

// ---------------------------------------------------------------------------
// Transição — a named edge in the diagram above
// ---------------------------------------------------------------------------

/**
 * The five actions a socket handler may request. `propor` is modelled as a
 * transition too (from a virtual "no card yet" state) so the whole lifecycle
 * — including creation — is described by ONE table, instead of special-casing
 * card creation outside the state machine.
 */
export type TransicaoConjuracao =
  | "propor"
  | "arbitrar"
  | "recusar"
  | "rolar"
  | "resolver"
  | "cancelar";

/** Who is attempting the transition, from the server's already-resolved POV. */
export type AtorConjuracao = "dono" | "gm";

/**
 * Guard context passed to `podeTransicionar`.
 *
 * `jaRolou` distinguishes the two `cancelar` edges in the diagram: cancelling
 * is legal from `proposta` OR `arbitrada`, but NEVER once the card reached
 * `rolada` (or beyond) — REQ-ETM-033 "antes de rolada". The state itself
 * (`rolada`/`resolvida`) already implies `jaRolou`, but the field is kept
 * explicit so callers cannot forget the guard when composing new transitions.
 */
export interface ContextoTransicao {
  readonly ator: AtorConjuracao;
  readonly jaRolou: boolean;
}

// ---------------------------------------------------------------------------
// podeTransicionar — pure guard predicate
// ---------------------------------------------------------------------------

/**
 * `de` is `null` for the `propor` transition (no card exists yet). Every
 * other transition reads an existing card's `estado` as `de`.
 */
export function podeTransicionar(
  de: EstadoConjuracao | null,
  para: EstadoConjuracao,
  transicao: TransicaoConjuracao,
  contexto: ContextoTransicao,
): boolean {
  const { ator, jaRolou } = contexto;

  switch (transicao) {
    case "propor":
      // Virtual "no card" -> proposta. Dono do Actor OU GM pode propor
      // (REQ-ETM-029 says "o sistema" cria o card ao enviar a Frase — o
      // dono do Actor é quem envia; o GM pode propor em nome do jogador).
      // `ator` is typed as exactly "dono" | "gm" — both are always allowed
      // here, so there is no third case to guard against.
      return de === null && para === "proposta";

    case "arbitrar":
      // Só o Narrador arbitra (REQ-ETM-030). proposta -> arbitrada.
      return de === "proposta" && para === "arbitrada" && ator === "gm";

    case "recusar":
      // Só o Narrador recusa, e só a partir de proposta (REQ-ETM-030).
      return de === "proposta" && para === "recusada" && ator === "gm";

    case "rolar":
      // Dono do Actor OU o Narrador rola (REQ-ETM-031). arbitrada -> rolada.
      // Both `ator` values are allowed — see the "propor" comment above.
      return de === "arbitrada" && para === "rolada";

    case "resolver":
      // Só o Narrador resolve (REQ-ETM-032). rolada -> resolvida.
      return de === "rolada" && para === "resolvida" && ator === "gm";

    case "cancelar":
      // Dono do Actor OU o Narrador cancela (REQ-ETM-033), SOMENTE antes de
      // `rolada` — ou seja, a partir de proposta ou arbitrada, e apenas
      // quando a rolagem ainda não ocorreu. Cancelar nunca tem custo. Both
      // `ator` values are allowed — see the "propor" comment above.
      return (de === "proposta" || de === "arbitrada") && para === "cancelada" && !jaRolou;

    default: {
      const _never: never = transicao;
      return _never;
    }
  }
}

// ---------------------------------------------------------------------------
// aplicar — pure reducer, never mutates the input card
// ---------------------------------------------------------------------------

/**
 * Payload accepted per transition. Every field is optional because each
 * transition only writes a subset of `ConjuracaoCard` — callers pass exactly
 * what that transition is documented to set (design doc §2.5/§2.7, spec 19
 * REQ-ETM-030..033) and `aplicar` merges it onto the card immutably.
 */
export interface PayloadTransicao {
  readonly complexidade?: ConjuracaoCard["complexidade"];
  readonly custo_estresse?: ConjuracaoCard["custo_estresse"];
  readonly excede_maxima?: ConjuracaoCard["excede_maxima"];
  readonly notas_narrador?: string;
  readonly roll_message_id?: ConjuracaoCard["roll_message_id"];
  readonly dificuldade_alvo?: ConjuracaoCard["dificuldade_alvo"];
  readonly sucesso?: ConjuracaoCard["sucesso"];
  readonly margem?: ConjuracaoCard["margem"];
  readonly classe_dificuldade?: ConjuracaoCard["classe_dificuldade"];
  readonly controle_fadiga?: ConjuracaoCard["controle_fadiga"];
}

const ESTADO_POR_TRANSICAO: Record<Exclude<TransicaoConjuracao, "propor">, EstadoConjuracao> = {
  arbitrar: "arbitrada",
  recusar: "recusada",
  rolar: "rolada",
  resolver: "resolvida",
  cancelar: "cancelada",
};

/**
 * Apply a transition to a card, returning a NEW object (never mutates `card`
 * or any nested value — REQ-ETM-NFR-001 purity, and so the server can safely
 * hand the previous card to a broadcast/log path after calling this).
 *
 * Callers MUST have already checked `podeTransicionar` — this function does
 * not re-validate the guard; it only computes the resulting shape. This
 * mirrors the "pure reducer, guard checked separately" split used elsewhere
 * in the codebase (e.g. combat's turn-index helpers).
 */
export function aplicar(
  card: ConjuracaoCard,
  transicao: Exclude<TransicaoConjuracao, "propor">,
  payload: PayloadTransicao = {},
): ConjuracaoCard {
  return {
    ...card,
    ...payload,
    estado: ESTADO_POR_TRANSICAO[transicao],
  };
}
