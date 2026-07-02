/**
 * @fusion/system-etmos — Orador derivation steps.
 *
 * Registers the three deterministic "base"-phase DeriveSteps for Actor
 * subtype `orador` (spec 19 REQ-ETM-007..010, design doc §2.4):
 *   - `ferimentos.limite` = limiteFerimentos(corpo)
 *   - `estresse.limite`   = limiteEstresse(alma)
 *   - `complexidade_maxima` = complexidadeMaxima(mente)
 *   - `fadiga.estado`     = estadoFadiga(estresse.atual, estresse.limite)
 *     (declared as a 4th step so it can `reads` the just-written
 *     `estresse.limite`, matching the design doc's "Três DeriveSteps `base`,
 *     sem ciclo" — the Fadiga step naturally runs after the Estresse-limite
 *     step because of the read/write dependency graph the engine topo-sorts).
 *
 * All four steps are pure/deterministic (REQ-ETM-NFR-001) and delegate to
 * the pure functions in `../compositor/custo.ts` — the SAME functions used
 * by the servidor's cost application and testable in isolation via the
 * golden-fixture-adjacent tests in `__tests__/custo.test.ts`.
 *
 * Registration: `registrar.derive(step)` is called for each of
 * `ORADOR_DERIVE_STEPS` via `registerDerivations(registrar)`
 * (`./index.ts`), invoked from `systems/etmos/src/index.ts`'s `defineSystem`
 * callback — mirrors `systems/sf2e/src/derivations/index.ts`'s
 * `registerDerivations(registrar)` helper.
 *
 * Clean-room: formulas only, no book prose. Spec: 19-sistema-etmos.md.
 * Design doc: docs/design/m5-etmos-compositor.md §2.4.
 */

import type { DeriveStep } from "@fusion/system-api";
import {
  limiteFerimentos,
  limiteEstresse,
  complexidadeMaxima,
  estadoFadiga,
} from "../compositor/custo.js";

function getSystem(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc["system"] as Record<string, unknown> | undefined) ?? {};
}

function getNumber(
  obj: Record<string, unknown> | undefined,
  path: string[],
  fallback: number,
): number {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return fallback;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "number" ? cur : fallback;
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (!existing || typeof existing !== "object") {
    parent[key] = {};
  }
  return parent[key] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// STEP 1: Limite de Ferimentos = 4 + floor(Corpo / 2) — REQ-ETM-007
// ---------------------------------------------------------------------------

export const stepOradorLimiteFerimentos: DeriveStep = {
  id: "etmos.orador.base.limiteFerimentos",
  documentType: "Actor",
  subtypes: ["orador"],
  phase: "base",
  reads: ["system.atributos.corpo.value"],
  writes: ["system.ferimentos.limite"],

  run(doc) {
    const sys = getSystem(doc);
    const corpo = getNumber(sys, ["atributos", "corpo", "value"], 1);
    const ferimentos = ensureObject(sys, "ferimentos");
    ferimentos["limite"] = limiteFerimentos(corpo);
  },
};

// ---------------------------------------------------------------------------
// STEP 2: Limite de Estresse = 4 + Alma — REQ-ETM-008
// ---------------------------------------------------------------------------

export const stepOradorLimiteEstresse: DeriveStep = {
  id: "etmos.orador.base.limiteEstresse",
  documentType: "Actor",
  subtypes: ["orador"],
  phase: "base",
  reads: ["system.atributos.alma.value"],
  writes: ["system.estresse.limite"],

  run(doc) {
    const sys = getSystem(doc);
    const alma = getNumber(sys, ["atributos", "alma", "value"], 1);
    const estresse = ensureObject(sys, "estresse");
    estresse["limite"] = limiteEstresse(alma);
  },
};

// ---------------------------------------------------------------------------
// STEP 3: Complexidade Máxima, derivada de Mente — REQ-ETM-009
// ---------------------------------------------------------------------------

export const stepOradorComplexidadeMaxima: DeriveStep = {
  id: "etmos.orador.base.complexidadeMaxima",
  documentType: "Actor",
  subtypes: ["orador"],
  phase: "base",
  reads: ["system.atributos.mente.value"],
  writes: ["system.complexidade_maxima"],

  run(doc) {
    const sys = getSystem(doc);
    const mente = getNumber(sys, ["atributos", "mente", "value"], 1);
    sys["complexidade_maxima"] = complexidadeMaxima(mente);
  },
};

// ---------------------------------------------------------------------------
// STEP 4: Estado de Fadiga, derivado de (Estresse atual - Limite) — REQ-ETM-010
//
// Depends on `system.estresse.limite` (written by STEP 2 above) — the topo
// sort orders this step after stepOradorLimiteEstresse via the reads/writes
// dependency graph, no explicit priority number needed.
// ---------------------------------------------------------------------------

export const stepOradorFadiga: DeriveStep = {
  id: "etmos.orador.base.fadiga",
  documentType: "Actor",
  subtypes: ["orador"],
  phase: "base",
  reads: ["system.estresse.atual", "system.estresse.limite"],
  writes: ["system.fadiga.estado"],

  run(doc) {
    const sys = getSystem(doc);
    const estresseAtual = getNumber(sys, ["estresse", "atual"], 0);
    const estresseLimite = getNumber(sys, ["estresse", "limite"], 0);
    const fadiga = ensureObject(sys, "fadiga");
    fadiga["estado"] = estadoFadiga(estresseAtual, estresseLimite);
  },
};

/** All Orador DeriveSteps, in a stable array for bulk registration. */
export const ORADOR_DERIVE_STEPS: readonly DeriveStep[] = [
  stepOradorLimiteFerimentos,
  stepOradorLimiteEstresse,
  stepOradorComplexidadeMaxima,
  stepOradorFadiga,
];
