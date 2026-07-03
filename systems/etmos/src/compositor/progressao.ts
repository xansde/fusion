/**
 * @fusion/system-etmos — Marcos de Crescimento + Tabela E progression
 * (REQ-ETM-035..039, CA-11).
 *
 * Pure, deterministic (REQ-ETM-NFR-001). Tabela E ("Progressão de Nível",
 * packs-src/tabelas.json's `tabela_E_progressao_nivel`) is transcribed here
 * as a typed constant — mirrors how Tabela A (custo.ts's `CUSTO_BASE`) is
 * already hand-transcribed rather than read from the raw JSON at runtime,
 * since tabelas.json is reference data (not a compiled Document pack —
 * build-packs.mjs never touches it, see its own docstring's pack list).
 *
 * Design doc m5-etmos-compositor.md §6 (M5-E). Spec 19-sistema-etmos.md
 * REQ-ETM-035..039, CA-11.
 */
import type { CategoriaMarco, Trilha } from "../types.js";

// ---------------------------------------------------------------------------
// Tabela E — Progressão de Nível (N1 -> N6)
//
// Source: systems/etmos/packs-src/tabelas.json, "tabela_E_progressao_nivel".
// Keyed by `de_nivel` (the level the Orador is transitioning FROM); level 6
// is the max and has no outgoing transition (marcosCompletos at nivel 6
// simply has no opcoesProgressao entry — see opcoesProgressao below).
// ---------------------------------------------------------------------------

export type CategoriaBonus = "fisica" | "mental" | "emocional";

export interface OpcaoProgressao {
  readonly deNivel: number;
  readonly paraNivel: number;
  readonly fisica: string;
  readonly mental: string;
  readonly emocional: string;
}

const TABELA_E: readonly OpcaoProgressao[] = [
  {
    deNivel: 1,
    paraNivel: 2,
    fisica: "+1 Objeto e +1 Característica no Grimório",
    mental: "+1 ponto de Atributo (distribuído livremente)",
    emocional: "+1 Habilidade Prática",
  },
  {
    deNivel: 2,
    paraNivel: 3,
    fisica: "+1 Função no Grimório",
    mental: "+1 ponto de Atributo (distribuído livremente)",
    emocional: "+1 Habilidade Teórica",
  },
  {
    deNivel: 3,
    paraNivel: 4,
    fisica: "+1 Objeto e +1 Característica no Grimório",
    mental: "+1 ponto de Atributo (distribuído livremente)",
    emocional: "+1 Habilidade Prática",
  },
  {
    deNivel: 4,
    paraNivel: 5,
    fisica: "+1 Função no Grimório",
    mental: "+1 ponto de Atributo (distribuído livremente)",
    emocional: "+1 Habilidade Teórica",
  },
  {
    deNivel: 5,
    paraNivel: 6,
    fisica: "+1 Função, +1 Objeto e +1 Característica no Grimório",
    mental: "+1 ponto de Atributo (distribuído livremente)",
    emocional: "+1 Habilidade Teórica e +1 Habilidade Prática",
  },
];

/**
 * Resolve the Tabela E row for the transition starting at `nivelAtual`, or
 * `null` when there is no further transition (nivel >= 6, the schema's max —
 * OradorSystemSchema's `nivel` field, actor-orador.ts).
 */
export function opcoesProgressao(nivelAtual: number): OpcaoProgressao | null {
  return TABELA_E.find((row) => row.deNivel === nivelAtual) ?? null;
}

// ---------------------------------------------------------------------------
// Marcos de Crescimento — trilha completion + Bônus signaling (REQ-ETM-036)
// ---------------------------------------------------------------------------

export type MarcosCrescimento = Record<CategoriaMarco, Trilha>;

/** A trilha is "completa" (bloqueada, Bônus disponível) at its max — REQ-ETM-036. */
export function trilhaCompleta(trilha: Trilha): boolean {
  return trilha.value >= trilha.max;
}

/** Every categoria's trilha is completa — REQ-ETM-037 (habilita subida de nível). */
export function todasTrilhasCompletas(marcos: MarcosCrescimento): boolean {
  return (
    trilhaCompleta(marcos.fisicos) &&
    trilhaCompleta(marcos.mentais) &&
    trilhaCompleta(marcos.emocionais)
  );
}

/**
 * Clamp a Marco click to [0, max], additionally refusing to INCREASE past
 * max once already complete when the trilha is locked pending a level-up
 * confirmation (REQ-ETM-036: "bloquear novos pontos nessa categoria"). A
 * trilha that is already at max may still be clicked DOWN (to correct a
 * misclick) — only increases beyond max are blocked, which `Math.min` below
 * already guarantees structurally; this helper exists so callers have one
 * function to call instead of re-deriving the clamp inline.
 */
export function clampMarcoValue(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

// ---------------------------------------------------------------------------
// confirmarSubidaDeNivel — REQ-ETM-038/039, CA-11
// ---------------------------------------------------------------------------

export interface EscolhasSubidaNivel {
  readonly fisica: boolean;
  readonly mental: boolean;
  readonly emocional: boolean;
}

export interface ConfirmarSubidaResult {
  readonly ok: boolean;
  /** i18n-agnostic error code, present only when ok is false. */
  readonly erro?: "trilhasIncompletas" | "nivelMaximo" | "categoriaFaltando";
  /** The Orador's new nivel, present only when ok is true. */
  readonly novoNivel?: number;
  /** The reset trilhas (all back to { value: 0, max: 5 }), present only when ok is true. */
  readonly trilhasReiniciadas?: MarcosCrescimento;
}

/**
 * Validate + resolve a level-up confirmation (REQ-ETM-038, CA-11).
 *
 * REQ-ETM-037 ("apresentar, PARA CADA categoria, a opção da Tabela E") +
 * REQ-ETM-038 ("aplicar os bônus escolhidos", plural) mean a level-up grants
 * ALL THREE categoria bônus together — it is not "pick 1 of 3". REQ-ETM-039's
 * "impedir escolher a mesma opção de categoria mais de uma vez na mesma
 * subida" (regra SRD: uma por categoria) is therefore: each categoria's
 * bônus is applied EXACTLY once per subida, never zero times (a skipped
 * categoria) and never twice. `EscolhasSubidaNivel`'s one-boolean-per-categoria
 * shape models "has this categoria's selector been completed with a concrete
 * pick" — confirmarSubidaDeNivel requires ALL THREE to be true; the caller
 * (UI) is what makes "twice" structurally impossible by only ever presenting
 * each categoria's selector once per subida (design doc's semiautomatic
 * selector flow, REQ-ETM-038).
 *
 * Rules:
 *   - All 3 trilhas must be completa (REQ-ETM-037) — else `trilhasIncompletas`.
 *   - `nivelAtual` must have a Tabela E transition (< 6) — else `nivelMaximo`.
 *   - ALL 3 categorias must be chosen — else `categoriaFaltando`.
 *
 * On success, the trilhas reset to `{ value: 0, max: 5 }` for the next level
 * (REQ-ETM-038 "reiniciar as 3 trilhas") and `nivel` increments by 1.
 * Applying the chosen bônus itself (Atributo/Partícula/Habilidade selector)
 * is UI/server orchestration OUTSIDE this pure function — see
 * packages/server/src/etmos/progressao-handler.ts.
 */
export function confirmarSubidaDeNivel(
  nivelAtual: number,
  marcos: MarcosCrescimento,
  escolhas: EscolhasSubidaNivel,
): ConfirmarSubidaResult {
  if (!todasTrilhasCompletas(marcos)) {
    return { ok: false, erro: "trilhasIncompletas" };
  }
  const opcao = opcoesProgressao(nivelAtual);
  if (opcao === null) {
    return { ok: false, erro: "nivelMaximo" };
  }
  if (!escolhas.fisica || !escolhas.mental || !escolhas.emocional) {
    return { ok: false, erro: "categoriaFaltando" };
  }

  const trilhaVazia: Trilha = { value: 0, max: 5 };
  return {
    ok: true,
    novoNivel: opcao.paraNivel,
    trilhasReiniciadas: { fisicos: trilhaVazia, mentais: trilhaVazia, emocionais: trilhaVazia },
  };
}
