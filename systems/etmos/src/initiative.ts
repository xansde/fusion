/**
 * @fusion/system-etmos — Etmos Initiative Formula.
 *
 * Registers `etmos` as the InitiativeFormula for Etmos combats: `2d6 + Corpo`
 * (REQ-ETM-022, design doc §2.6/E3). The desempate rule — "jogadores vencem
 * NPCs; entre jogadores empatados, maior Corpo" — is inherently non-monotonic
 * (it depends on `hasPlayerOwner`, not a single numeric score), so it is
 * expressed via `compare(a, b)` rather than the numeric `tiebreaker` field,
 * per DEC-CBT-04 / M5-A's `InitiativeFormulaRegistration` shape
 * (`{ roll, compare }`, `packages/system-api/src/combat.ts`).
 *
 * `compare` order (REQ-ETM-022):
 *   1. Higher `total` initiative wins.
 *   2. Tied `total` → combatant with `hasPlayerOwner` wins over one without.
 *   3. Still tied → higher Corpo wins.
 *   4. Still tied → 0 (stable / insertion-order fallback, handled by the core).
 *
 * Clean-room: spec 19 REQ-ETM-022, CA-7. No Foundry code copied.
 */

import type { InitiativeFormulaFn, InitiativeFormulaResult, InitiativeEntry } from "@fusion/shared";
import type { InitiativeCompareFn } from "@fusion/system-api";

/**
 * Read `atributos.corpo` off a system doc, accepting BOTH shapes Etmos
 * persists: Orador's `{ value, max }` wrapper (`AtributoSchema`, D2 min 1)
 * AND Antagonista's bare integer (`AtributoAntagonistaSchema`,
 * systems/etmos/src/types.ts — Antagonistas may have Atributo 0, no
 * `.value`/`.max` wrapper; see also antagonistaSheetVM.ts's `atributos`
 * getter, which reads the same bare-integer shape). Reading only
 * `corpo.value` silently yields 0 for every Antagonista (2d6+0, tiebreaker
 * 0 regardless of its real Corpo) — this is the M5-E audit FIX 2.
 */
function readCorpo(atributos: Record<string, unknown> | undefined): number {
  const corpo = atributos?.["corpo"];
  if (typeof corpo === "number") return corpo;
  const wrapped = corpo as Record<string, unknown> | undefined;
  const value = wrapped?.["value"];
  return typeof value === "number" ? value : 0;
}

/**
 * Etmos initiative formula: `2d6 + Corpo`.
 *
 * @param _combatant - The combatant document (unused; Corpo comes from the actor).
 * @param actor      - The actor document (with `system.atributos.corpo`, either
 *   Orador's `{ value, max }` or Antagonista's bare integer), or null.
 */
export const etmosInitiativeFormula: InitiativeFormulaFn = (
  _combatant,
  actor,
): InitiativeFormulaResult => {
  if (actor === null) {
    return { formula: "2d6", statistic: "Corpo" };
  }

  const system = actor["system"] as Record<string, unknown> | undefined;
  const atributos = system?.["atributos"] as Record<string, unknown> | undefined;
  const corpoValue = readCorpo(atributos);

  return {
    formula: `2d6 + ${String(corpoValue)}`,
    tiebreaker: corpoValue,
    statistic: "Corpo",
  };
};

/** Reads `system.atributos.corpo.value` off an InitiativeEntry's combatant's linked actor snapshot, if present on the entry itself. */
function getCorpoFromEntry(entry: InitiativeEntry): number {
  // The InitiativeEntry only carries `combatant` + `total`/`tiebreaker`; Corpo
  // isn't part of that shape directly, but `tiebreaker` IS populated with the
  // Corpo value by `etmosInitiativeFormula` above (see `tiebreaker: corpoValue`).
  // Reusing it here keeps `compare` self-contained without needing to re-read
  // the actor document.
  return entry.tiebreaker ?? 0;
}

/**
 * Non-monotonic Etmos initiative comparator (REQ-ETM-022, DEC-CBT-04):
 *   1. Higher total initiative wins.
 *   2. Tied total → hasPlayerOwner wins over NPC.
 *   3. Still tied → higher Corpo wins.
 *   4. Still tied → 0 (stable fallback).
 */
export const etmosInitiativeCompare: InitiativeCompareFn = (
  a: InitiativeEntry,
  b: InitiativeEntry,
): number => {
  const totalA = a.total ?? -Infinity;
  const totalB = b.total ?? -Infinity;
  if (totalA !== totalB) {
    return totalB - totalA; // descending: higher total first
  }

  const aIsPlayer = a.combatant.hasPlayerOwner;
  const bIsPlayer = b.combatant.hasPlayerOwner;
  if (aIsPlayer !== bIsPlayer) {
    return aIsPlayer ? -1 : 1; // players sort before NPCs
  }

  const corpoA = getCorpoFromEntry(a);
  const corpoB = getCorpoFromEntry(b);
  if (corpoA !== corpoB) {
    return corpoB - corpoA; // descending: higher Corpo first
  }

  return 0;
};

/** Full registration object for `registrar.initiativeFormula("etmos", ...)` (M5-A shape). */
export const etmosInitiativeFormulaRegistration = {
  roll: etmosInitiativeFormula,
  compare: etmosInitiativeCompare,
} as const;
