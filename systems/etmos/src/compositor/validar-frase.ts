/**
 * @fusion/system-etmos — validarFrase() (sintaxe determinística).
 *
 * Pure function (REQ-ETM-NFR-001): given the composed slots + the caster's
 * Grimório (set of known Partícula slugs, keyed also by Grimório level for
 * Complementos), returns `{ valido, erros }`. Errors are i18n KEYS
 * (REQ-ETM-051), never raw prose strings.
 *
 * Rules (REQ-ETM-028, design doc §2.2):
 *   1. Exactly 1 Função.
 *   2. >= 1 Objeto.
 *   3. Características/Criadores/Modificadores are optional (0+).
 *   4. Every used Partícula must be in the caster's Grimório (slug), unless
 *      the Narrador overrides. Complemento level requirements are enforced
 *      against the Grimório's recorded level for that Complemento.
 *   5. `prefix` Criadores (Ada-/No-) target a Característica index in range;
 *      `mut` targets an Objeto (represented as a caracteristica_slugs entry
 *      holding an Objeto slug — see item-frase-magica.ts docstring).
 *   6. `connector` Criador (Ag) targets exactly 2 DISTINCT valid indices.
 *   7. Modificadores (suffix) carry no target — duplicates are a WARNING,
 *      not an error (Narrador's call).
 *
 * Design doc m5-etmos-compositor.md §2.2 (pseudocode near-final).
 * Golden fixtures: docs/design/m5-etmos-compositor.md §5 (G1..G10).
 */
import type { FraseMagicaSystem } from "../schemas/item-frase-magica.js";
import { getComplementoSyntax, PREFIX_OBJETO_SLUG, CONNECTOR_SLUG } from "../particulas-syntax.js";

// ---------------------------------------------------------------------------
// Grimório view — the minimal shape validarFrase needs from the caster
// ---------------------------------------------------------------------------

/**
 * A read-only view of the caster's known Partículas. `hasSlug` answers "does
 * the Grimório contain this slug at all"; `grimorioLevel` answers "what is
 * the caster's overall Grimório level" (used to gate Complemento
 * nivelGrimorio requirements — design doc §2.2 rule 4). When omitted,
 * validarFrase treats the Grimório as having no level gate (permissive —
 * useful for pure unit tests that only exercise syntax rules).
 */
export interface GrimorioView {
  hasSlug(slug: string): boolean;
  /** Caster's overall Grimório level (1..4), or undefined to skip level gating. */
  grimorioLevel?: number;
}

export interface ValidarFraseResult {
  readonly valido: boolean;
  /** i18n keys, e.g. "etmos.compositor.erro.semFuncao". Empty when valido. */
  readonly erros: string[];
  /** i18n keys for non-blocking warnings (e.g. duplicate modificadores). */
  readonly avisos: string[];
}

const ERR = {
  semFuncao: "etmos.compositor.erro.semFuncao",
  multiplasFuncoes: "etmos.compositor.erro.multiplasFuncoes",
  semObjeto: "etmos.compositor.erro.semObjeto",
  particulaForaDoGrimorio: "etmos.compositor.erro.particulaForaDoGrimorio",
  nivelGrimorioInsuficiente: "etmos.compositor.erro.nivelGrimorioInsuficiente",
  alvoCriadorInvalido: "etmos.compositor.erro.alvoCriadorInvalido",
  conectorAlvoInvalido: "etmos.compositor.erro.conectorAlvoInvalido",
  complementoDesconhecido: "etmos.compositor.erro.complementoDesconhecido",
} as const;

const WARN = {
  modificadorDuplicado: "etmos.compositor.aviso.modificadorDuplicado",
} as const;

/**
 * Validates the syntactic well-formedness of a composed Frase Mágica.
 *
 * `slots` is the subset of FraseMagicaSystem fields the compositor VM has
 * assembled so far (funcao_slug may be "" mid-composition — that's still
 * "0 Funções", not a schema violation, since the Zod schema defaults to "").
 */
export function validarFrase(
  slots: Pick<
    FraseMagicaSystem,
    "funcao_slug" | "objeto_slugs" | "caracteristica_slugs" | "criadores" | "modificador_slugs"
  >,
  grimorio?: GrimorioView,
): ValidarFraseResult {
  const erros: string[] = [];
  const avisos: string[] = [];

  // --- Rule 1: exactly 1 Função ---
  // funcao_slug is modeled as a single string slot; "0 Funções" is the empty
  // string. "≥2 Funções" cannot be represented by a single-string slot, so
  // callers that allow multi-select during composition MUST pass a sentinel
  // (see validarFraseMultiFuncao below for the UI-facing variant used by G10).
  if (slots.funcao_slug.length === 0) {
    erros.push(ERR.semFuncao);
  }

  // --- Rule 2: >= 1 Objeto ---
  if (slots.objeto_slugs.length === 0) {
    erros.push(ERR.semObjeto);
  }

  // --- Rule 4: every used Partícula is in the Grimório ---
  if (grimorio) {
    const allSlugs = [
      ...(slots.funcao_slug.length > 0 ? [slots.funcao_slug] : []),
      ...slots.objeto_slugs,
      ...slots.caracteristica_slugs,
      ...slots.criadores.map((c) => c.slug),
      ...slots.modificador_slugs,
    ];
    for (const slug of allSlugs) {
      if (!grimorio.hasSlug(slug)) {
        erros.push(ERR.particulaForaDoGrimorio);
        break; // one error is enough to flag the whole frase as invalid
      }
    }
  }

  // --- Rules 5/6: Criadores target validation ---
  const caracteristicaCount = slots.caracteristica_slugs.length;
  const connectorTargets = new Set<number>();

  for (const criador of slots.criadores) {
    const syntax = getComplementoSyntax(criador.slug);
    if (!syntax) {
      erros.push(ERR.complementoDesconhecido);
      continue;
    }

    // Grimório level gate (design doc §1.4 / rule 4).
    if (grimorio?.grimorioLevel !== undefined && grimorio.grimorioLevel < syntax.nivelGrimorio) {
      erros.push(ERR.nivelGrimorioInsuficiente);
    }

    if (syntax.ligacao === "connector") {
      // Ag: alvo must be a tuple of 2 DISTINCT valid indices.
      // (`alvo`'s type is `number | [number, number]` — CriadorAplicadoSchema
      // guarantees any array value already has exactly 2 elements via
      // z.tuple(), so `.length !== 2` would be statically dead; the
      // Array.isArray guard alone is enough to discriminate the union.)
      if (
        !Array.isArray(criador.alvo) ||
        criador.alvo[0] === criador.alvo[1] ||
        criador.alvo.some((i) => i < 0 || i >= caracteristicaCount)
      ) {
        erros.push(ERR.conectorAlvoInvalido);
      } else {
        connectorTargets.add(criador.alvo[0]);
        connectorTargets.add(criador.alvo[1]);
      }
    } else if (syntax.ligacao === "prefix") {
      // Ada-/No-/Mut-: alvo must be a single valid index.
      // (Mut- targets an Objeto-as-Característica slot — same index space,
      // see item-frase-magica.ts docstring; validarFrase does not need to
      // distinguish ada/no from mut here, only that the index is in range.)
      if (
        typeof criador.alvo !== "number" ||
        criador.alvo < 0 ||
        criador.alvo >= caracteristicaCount
      ) {
        erros.push(ERR.alvoCriadorInvalido);
      }
    }
  }

  // --- Rule 7: duplicate Modificadores → warning, not error ---
  // Also gate each Modificador's Grimório level here (rule 4) — Modificadores
  // (Mor/Min/San/Sar/Sin/Itam) are Complementos too, but they live in
  // modificador_slugs, not in `criadores`, so they never passed through the
  // Criador loop above. Itam (nivelGrimorio 4) MUST be gated the same way
  // Ada-/No-/Mut-/Ag are — this is what makes G8 (Itam, nível 4) meaningful.
  const seenModificadores = new Set<string>();
  for (const slug of slots.modificador_slugs) {
    if (seenModificadores.has(slug)) {
      avisos.push(WARN.modificadorDuplicado);
    }
    seenModificadores.add(slug);

    const syntax = getComplementoSyntax(slug);
    if (
      syntax &&
      grimorio?.grimorioLevel !== undefined &&
      grimorio.grimorioLevel < syntax.nivelGrimorio
    ) {
      erros.push(ERR.nivelGrimorioInsuficiente);
    }
  }

  return { valido: erros.length === 0, erros, avisos };
}

/**
 * UI-facing variant for the "multiple Funções selected" case (G10):
 * `validarFrase` above models Função as a single slug slot (the compositor
 * VM never lets the user select 2 at once in the final data model), but the
 * fixture G10 exercises rejecting an attempted 2-Função selection BEFORE it
 * collapses to a single slot. Compositor VMs that allow transient multi-select
 * during the picking step call this guard first.
 */
export function validarFuncaoUnica(funcaoSlugsSelecionados: readonly string[]): ValidarFraseResult {
  if (funcaoSlugsSelecionados.length === 0) {
    return { valido: false, erros: [ERR.semFuncao], avisos: [] };
  }
  if (funcaoSlugsSelecionados.length > 1) {
    return { valido: false, erros: [ERR.multiplasFuncoes], avisos: [] };
  }
  return { valido: true, erros: [], avisos: [] };
}

export { PREFIX_OBJETO_SLUG, CONNECTOR_SLUG };
