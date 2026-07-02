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
 * Etmos initiative formula: `2d6 + Corpo`.
 *
 * @param _combatant - The combatant document (unused; Corpo comes from the actor).
 * @param actor      - The actor document (with `system.atributos.corpo.value`), or null.
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
  const corpo = atributos?.["corpo"] as Record<string, unknown> | undefined;
  const corpoValue = typeof corpo?.["value"] === "number" ? corpo["value"] : 0;

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
