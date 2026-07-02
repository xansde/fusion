/**
 * @fusion/system-etmos — computeDegreeOfSuccess() / classeDificuldade().
 *
 * Etmos's OWN binary degree-of-success set (D6 of spec 19) — deliberately
 * NOT the 4-degree engine-2e helper (that's exclusive to PF2e/SF2e). Also
 * implements the separate narrative "classe de dificuldade" label used for
 * chat rendering (color/rótulo), which is metadata, not a degree of success.
 *
 * NOTE: Tabelas A/B/C/D (limiteFerimentos, limiteEstresse, complexidadeMaxima,
 * estadoFadiga, custoEstresse) live in `custo.ts` — this module only owns the
 * roll-classification pair (computeDegreeOfSuccess/classeDificuldade), kept
 * as a single source of truth to avoid duplicate implementations of the same
 * formulas across the two files.
 *
 * Clean-room: formulas only. Spec: 19-sistema-etmos.md (REQ-ROL-038/039, D6).
 * Design doc: docs/design/m5-etmos-compositor.md §2.4.
 */

import type { EtmosDegree, ClasseDificuldade } from "../types.js";

export type { EtmosDegree, ClasseDificuldade };

export interface EtmosDegreeResult {
  readonly degree: EtmosDegree;
  readonly margem: number;
}

/**
 * Etmos's binary degree-of-success comparator (REQ-ROL-038/REQ-ROL-039, D6).
 * `total >= dc` -> "success"; otherwise "failure". `margem = total - dc` is
 * exposed as metadata for narrative flavor, never altering the binary degree.
 */
export function computeDegreeOfSuccess(total: number, dc: number): EtmosDegreeResult {
  const margem = total - dc;
  return { degree: margem >= 0 ? "success" : "failure", margem };
}

/**
 * Narrative difficulty class label (12b §3.4) — separate metadata from the
 * degree of success, used for chat color/rótulo only.
 * Faixas: <6 simples, =6 fácil, 7-10 mediano, 11-14 árduo, >=15 difícil.
 */
export function classeDificuldade(total: number): ClasseDificuldade {
  if (total < 6) return "simples";
  if (total === 6) return "facil";
  if (total <= 10) return "mediano";
  if (total <= 14) return "arduo";
  return "dificil";
}

/**
 * Adapter shaping `computeDegreeOfSuccess` as a `DegreeOfSuccessDefinition`
 * (`packages/system-api/src/registries.ts`). Registered as-is via
 * `registrar.degreeOfSuccess(etmosDegreeOfSuccessDefinition)` in
 * `systems/etmos/src/index.ts`'s `defineSystem` callback (design doc
 * §2.6/E2) — this is the ONLY compute() shape ever registered for
 * "etmos.conjuracao", so `meta.margem`/`meta.classeDificuldade` are always
 * present together; there is no separate inline duplicate to diverge from.
 */
export const ETMOS_DEGREE_OF_SUCCESS_ID = "etmos.conjuracao";

export const etmosDegreeOfSuccessDefinition = {
  id: ETMOS_DEGREE_OF_SUCCESS_ID,
  compute(total: number, dc: number) {
    const { degree, margem } = computeDegreeOfSuccess(total, dc);
    return { degree, meta: { margem, classeDificuldade: classeDificuldade(total) } };
  },
} as const;
