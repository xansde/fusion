/**
 * statusModel.ts — the small decisions of the status strip (BAR-F1-04; spec 53 REQ-BAR-027,
 * REQ-BAR-038; prototype `.ab-state`).
 *
 * Pure (§2.10). Hit points colour by how much is left (the prototype's thresholds), the MAP of the
 * next attack is written with the typographic minus, and the conditions on the strip are listed by
 * id. All of it is display data (D-15): nothing here decides what the actor may do. The portrait is
 * the app's own `ActorPortrait` (it resolves the asset grant and paints the initials), not drawn here.
 */

/** Width of the hit-point fill, as a percentage of the track: 0 when the maximum is not a positive number. */
export function hpPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !(max > 0)) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/** Width of the temporary-hit-point segment: what the fill leaves free, at most. */
export function tempPercent(temp: number, max: number, fillPercent: number): number {
  if (!Number.isFinite(temp) || temp <= 0 || !(max > 0)) return 0;
  return Math.max(0, Math.min(100 - fillPercent, (temp / max) * 100));
}

export type HpTone = "success" | "warning" | "danger";

/** The colour of the fill: red up to a quarter, amber up to half, green above (the prototype's). */
export function hpTone(percent: number): HpTone {
  if (percent <= 25) return "danger";
  if (percent <= 50) return "warning";
  return "success";
}

/** "0", "−5", "−10": the multiple attack penalty of the next attack, with the typographic minus. */
export function formatMapPenalty(penalty: 0 | -5 | -10): string {
  return penalty === 0 ? "0" : `−${String(Math.abs(penalty))}`;
}

/**
 * The ids of the conditions on the strip. A status that came without the list (a provider that broke
 * the contract) has none, rather than taking the bar down.
 */
export function conditionIdsOf(status: {
  readonly conditions?: ReadonlyArray<{ readonly id: string }> | undefined;
}): string[] {
  return (status.conditions ?? []).map((condition) => condition.id);
}
