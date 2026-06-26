/**
 * TEML Proficiency bonus — PF2e Remaster.
 *
 * Clean-room implementation based on:
 *   docs/research/13-pf2e-sf2e-mecanicas-nucleo.md §3.1 — Sistema TEML
 *   specs/17-sistema-pf2e.md REQ-PF2-011, §Conceitos (TEML)
 *   Archives of Nethys (ORC license).
 *
 * Formula: rank > 0 ? (rank * 2) + level : 0
 *
 * Rank mapping:
 *   Untrained = 0 → always +0 (level NOT added)
 *   Trained   = 1 → +2 + level
 *   Expert    = 2 → +4 + level
 *   Master    = 3 → +6 + level
 *   Legendary = 4 → +8 + level
 *
 * Level may be 0 or negative (NPCs with negative levels per specs/17).
 */

export type ProficiencyRank = "Untrained" | "Trained" | "Expert" | "Master" | "Legendary";

/** Numeric rank value for each proficiency label. */
export const PROFICIENCY_RANK_VALUE: Record<ProficiencyRank, number> = {
  Untrained: 0,
  Trained: 1,
  Expert: 2,
  Master: 3,
  Legendary: 4,
};

/**
 * Calculate the proficiency bonus from a rank and character level.
 *
 * @param rankValue  - Numeric rank (0=Untrained, 1=Trained, 2=Expert, 3=Master, 4=Legendary).
 * @param level      - Character/NPC level (may be 0 or negative).
 * @returns          - The proficiency bonus to add to checks.
 *
 * REQ per golden fixtures: teml-proficiency.json (15 cases, 1 verify).
 */
export function calculateProficiencyBonus(rankValue: number, level: number): number {
  if (rankValue <= 0) return 0;
  return rankValue * 2 + level;
}

/**
 * Calculate proficiency bonus from a named rank label.
 *
 * Convenience wrapper that resolves the rank label to its numeric value.
 */
export function calculateProficiencyBonusByRank(rank: ProficiencyRank, level: number): number {
  return calculateProficiencyBonus(PROFICIENCY_RANK_VALUE[rank], level);
}
