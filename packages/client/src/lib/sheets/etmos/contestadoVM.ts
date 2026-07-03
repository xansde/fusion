/**
 * contestadoVM.ts — op builder for the Etmos Teste Contestado UI surface
 * (REQ-ETM-021, CA-6).
 *
 * Minimal client-side helper: builds the flat `EtmosTesteContestadoOp` the
 * server's `etmos:teste:contestado` handler (packages/server/src/etmos/contestado-handler.ts)
 * expects. All winner-resolution logic runs server-side via the pure
 * `resolverContestado` (@fusion/system-etmos) + RollService — this module
 * NEVER decides a winner or rolls dice itself, it only assembles the request.
 *
 * UI surface (design doc has no dedicated Compositor-style window for this —
 * spec 19 only requires "Teste Contestado" as a capability, REQ-ETM-021): a
 * compact inline form on the Orador sheet itself
 * (components/sheets/etmos/OradorSheet.svelte's ".contestado-block" —
 * there is no separate TesteContestadoForm.svelte component; the form is
 * inline) lets the acting user pick their own Atributo/Habilidade formula
 * and enter the opposing side's formula + optional actorId, then fires this
 * op via the sheet's existing sendOpFn callback (same pattern as "Propor ao
 * Narrador").
 */

export type ContestadoAtributo = "corpo" | "alma" | "mente";

export interface EtmosTesteContestadoOp {
  type: "etmos:teste:contestado";
  a: { actorId: string | null; formula: string; provocador: boolean };
  b: { actorId: string | null; formula: string; provocador: boolean };
  descricao?: string;
}

/** Build the `2d6 + @atributos.<attr>.value` formula for a self-side Atributo test. */
export function formulaParaAtributo(attr: ContestadoAtributo): string {
  return `2d6 + @atributos.${attr}.value`;
}

/**
 * Build the EtmosTesteContestadoOp for "my side" (actorId + Atributo, always
 * the provocador — the user initiating the form is the one who provoked the
 * test, REQ-ETM-021 rule 2) vs. "opposing side" (actorId optional — null for
 * an ad-hoc/manual NPC bonus, formula built from a flat modifier).
 */
export function buildContestadoOp(opts: {
  meuActorId: string;
  meuAtributo: ContestadoAtributo;
  oponenteActorId: string | null;
  /** Opponent's flat modifier — used to build "2d6 + <n>" when no formula override is given. */
  oponenteBonus: number;
  descricao?: string;
}): EtmosTesteContestadoOp {
  const op: EtmosTesteContestadoOp = {
    type: "etmos:teste:contestado",
    a: {
      actorId: opts.meuActorId,
      formula: formulaParaAtributo(opts.meuAtributo),
      provocador: true,
    },
    b: {
      actorId: opts.oponenteActorId,
      formula: `2d6 + ${String(Math.trunc(opts.oponenteBonus))}`,
      provocador: false,
    },
  };
  if (opts.descricao && opts.descricao.trim().length > 0) {
    op.descricao = opts.descricao.trim();
  }
  return op;
}
