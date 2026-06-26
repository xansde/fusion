/**
 * Multiple Attack Penalty (MAP) — PF2e Remaster core mechanic.
 *
 * Clean-room implementation based on:
 *   docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §1.4 — Multiple Attack Penalty
 *   Archives of Nethys (ORC license).
 *
 * MAP table (§1.4):
 *   Standard weapon: 1st=0, 2nd=-5, 3rd+=−10
 *   Agile weapon:    1st=0, 2nd=-4, 3rd+=−8
 *
 * MAP applies only to attack rolls (not damage). MAP resets at the start of
 * each character turn. Only actions with the Attack trait increment MAP.
 */

/** MAP penalty table for standard (non-agile) weapons. */
const MAP_STANDARD: readonly number[] = [0, -5, -10];

/** MAP penalty table for agile weapons. */
const MAP_AGILE: readonly number[] = [0, -4, -8];

/**
 * Calculate the Multiple Attack Penalty for a given attack.
 *
 * @param attackNumber  - The 1-based attack number in the current turn (1 = first attack, 2 = second, etc.).
 * @param weaponAgile   - Whether the weapon has the Agile trait.
 * @returns             - The MAP penalty (0 or negative integer).
 *
 * REQ per golden fixtures: map.json (12 cases, 1 verify).
 */
export function calculateMapPenalty(attackNumber: number, weaponAgile: boolean): number {
  const table = weaponAgile ? MAP_AGILE : MAP_STANDARD;
  // Attack number is 1-based; clamp to the last entry for 3rd+.
  const index = Math.min(Math.max(attackNumber - 1, 0), table.length - 1);
  return table[index] ?? 0;
}
