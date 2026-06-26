/**
 * Degrees of Success calculation — PF2e Remaster core mechanic.
 *
 * Clean-room implementation based on:
 *   docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §2 — Graus de Sucesso
 *   Archives of Nethys (ORC license).
 *
 * Four degrees (ordered lowest→highest):
 *   CriticalFailure | Failure | Success | CriticalSuccess
 *
 * Margin-based thresholds (§2.1):
 *   margin >= +10  → CriticalSuccess
 *   margin >= 0    → Success
 *   margin > -10   → Failure
 *   margin <= -10  → CriticalFailure
 *
 * Natural die result adjustments (§2.2):
 *   Natural 20 → upgrade degree by 1 (capped at CriticalSuccess)
 *   Natural 1  → downgrade degree by 1 (capped at CriticalFailure)
 */

export type DegreeOfSuccess = "CriticalSuccess" | "Success" | "Failure" | "CriticalFailure";

/** Numeric order for degree shifting: 0=CritFail, 1=Fail, 2=Success, 3=CritSuccess */
const DEGREE_ORDER: readonly DegreeOfSuccess[] = [
  "CriticalFailure",
  "Failure",
  "Success",
  "CriticalSuccess",
];

/**
 * Calculate the degree of success for a check against a DC.
 *
 * @param check       - The total check result (die roll + modifiers).
 * @param dc          - The difficulty class to beat.
 * @param dieNatural  - The raw unmodified die face (1–20). Used for nat20/nat1 adjustments.
 */
export function calculateDegreeOfSuccess(
  check: number,
  dc: number,
  dieNatural: number,
): DegreeOfSuccess {
  const margin = check - dc;

  // §2.1 — base degree from margin
  let degreeIndex: number;
  if (margin >= 10) {
    degreeIndex = 3; // CriticalSuccess
  } else if (margin >= 0) {
    degreeIndex = 2; // Success
  } else if (margin > -10) {
    degreeIndex = 1; // Failure
  } else {
    degreeIndex = 0; // CriticalFailure  (margin <= -10)
  }

  // §2.2 — natural die adjustments (applied after base degree)
  if (dieNatural === 20) {
    degreeIndex = Math.min(degreeIndex + 1, 3);
  } else if (dieNatural === 1) {
    degreeIndex = Math.max(degreeIndex - 1, 0);
  }

  return DEGREE_ORDER[degreeIndex] as DegreeOfSuccess;
}
