/**
 * @fusion/system-pf2e — Derived data types for PF2e actors.
 *
 * These types represent the output of the `prepareDerived` pipeline — data
 * computed from `_source` that is NEVER persisted (DEC-PF2-03).
 *
 * Design notes:
 *   - CharacterDerived / NpcDerived are plain objects attached to
 *     `doc.system.derived` by DeriveSteps.
 *   - All numeric fields include `modifiers[]` for UI display (breakdown).
 *   - Strikes expose three MAP variants (0 / −5 / −10 or 0 / −4 / −8 agile).
 *
 * REQ-PF2-010..022, REQ-PF2-030..034, REQ-PF2-200.
 * Spec: specs/17-sistema-pf2e.md §Interfaces TypeScript.
 */

// ---------------------------------------------------------------------------
// Modifier summary (for breakdown display)
// ---------------------------------------------------------------------------

/**
 * A single modifier contribution already resolved for display.
 * Carries slug + label + value + type for UI breakdown.
 */
export interface ModifierBreakdown {
  readonly slug: string;
  readonly label: string;
  readonly type: string;
  readonly value: number;
}

// ---------------------------------------------------------------------------
// Statistic — the output of combining base + proficiency + modifiers
// ---------------------------------------------------------------------------

/**
 * A resolved statistic: total modifier for d20 rolls.
 *
 * `base`       = abilityMod + proficiencyBonus (computed during "base" phase)
 * `total`      = base + stacked modifiers (after "derived" phase)
 * `dc`         = 10 + total (for statistics used as passive DCs)
 * `modifiers`  = breakdown list for UI (from the stacking resolution)
 */
export interface DerivedStatistic {
  readonly slug: string;
  /** Ability modifier + proficiency bonus (no other modifiers). */
  readonly base: number;
  /** Resolved bonus modifiers applied to this statistic. */
  readonly modifiers: ModifierBreakdown[];
  /** Total modifier (what you add to d20). */
  readonly total: number;
  /** DC = 10 + total (applicable when stat is used as a DC). */
  readonly dc: number;
}

// ---------------------------------------------------------------------------
// Strike (derived from weapon/melee item)
// ---------------------------------------------------------------------------

/**
 * A single attack variant — MAP 0, MAP 1, or MAP 2.
 */
export interface StrikeVariant {
  /** Map penalty applied to this variant (0, -4/-5, or -8/-10). */
  readonly mapPenalty: number;
  /** Bonus modifier to the attack roll (total, including MAP). */
  readonly total: number;
  /** Formula string for the roll engine, e.g. "1d20 + 7". */
  readonly formula: string;
}

/**
 * A derived strike — one attack action from a weapon or melee entry.
 *
 * Exposes three MAP variants. Damage formula is separate (rolled on hit).
 *
 * REQ-PF2-030, REQ-PF2-031, REQ-PF2-034.
 */
export interface DerivedStrike {
  /** Display name (weapon name or "Longsword", "Claw", etc.). */
  readonly label: string;
  /** Weapon/melee item source (slug or id). */
  readonly sourceId: string;
  /** Whether the weapon is ranged (range !== null). */
  readonly isRanged: boolean;
  /** Whether the weapon has the "agile" trait (−4/−8 MAP). */
  readonly isAgile: boolean;
  /** Attack bonus at MAP 0 (without the d20). */
  readonly attackBonus: number;
  /** All three MAP variants (indices 0, 1, 2). */
  readonly variants: [StrikeVariant, StrikeVariant, StrikeVariant];
  /** Ability modifier applied to damage (STR melee, DEX finesse/ranged, 0 otherwise). */
  readonly damageAbilityMod: number;
  /** Damage formula string for the roll engine, e.g. "2d8 + 4 fire". */
  readonly damageFormula: string;
  /** Critical damage formula (typically double; deadly/fatal modify this). */
  readonly critDamageFormula: string;
  /**
   * Pure rollable damage formula for `@dice-roller/rpg-dice-roller`, with NO
   * damage type in the text (e.g. "1d6+3", "1d4-1", or "1d6" when bonus is 0).
   * CONTRACT 3.
   */
  readonly damageRoll?: string;
  /**
   * Pure rollable critical damage formula (e.g. "(1d6+3)*2"; with deadly:
   * "(1d6+3)*2+1d6"; with fatal d8: "(1d8+3)*2+1d8"). CONTRACT 3.
   */
  readonly critDamageRoll?: string;
  /** Damage type. */
  readonly damageType: string;
  /** Weapon traits (for UI and downstream processing). */
  readonly traits: string[];
}

// ---------------------------------------------------------------------------
// Character derived data
// ---------------------------------------------------------------------------

/**
 * Full derived data for a `character` actor.
 *
 * Attached to `doc.system.derived` after `prepareDerived` runs.
 * Never persisted to storage.
 *
 * REQ-PF2-003 / DEC-PF2-03.
 */
export interface CharacterDerived {
  /** Ability modifier cache (computed in "base" phase). */
  readonly abilityMods: {
    readonly str: number;
    readonly dex: number;
    readonly con: number;
    readonly int: number;
    readonly wis: number;
    readonly cha: number;
  };

  /**
   * Final ability SCORES after the build-driven base-phase overwrite
   * (r11): what the sheet must display for build-driven actors — the raw
   * persisted scores can be stale manual values. Optional: docs derived
   * before r11 lack it (clients fall back to the raw scores).
   */
  readonly abilityScores?: {
    readonly str: number;
    readonly dex: number;
    readonly con: number;
    readonly int: number;
    readonly wis: number;
    readonly cha: number;
  };

  /** Derived HP values (after drained penalty). REQ-PF2-021, REQ-PF2-051 */
  readonly hp: {
    readonly value: number;
    readonly max: number;
    readonly temp: number;
    /** Reduction to max HP from drained condition (level × drainedValue). */
    readonly drainedHpReduction: number;
  };

  /** Armor Class breakdown. REQ-PF2-020 */
  readonly ac: DerivedStatistic;

  /** Saving throws. REQ-PF2-015 */
  readonly saves: {
    readonly fortitude: DerivedStatistic;
    readonly reflex: DerivedStatistic;
    readonly will: DerivedStatistic;
  };

  /** Perception. REQ-PF2-014 */
  readonly perception: DerivedStatistic;

  /** All 16 canonical skills (and any Lore skills). REQ-PF2-012 */
  readonly skills: Record<string, DerivedStatistic>;

  /** Class DC. REQ-PF2-016 */
  readonly classDC: {
    readonly total: number;
    readonly dc: number;
    readonly modifiers: ModifierBreakdown[];
  };

  /** Derived strikes from equipped weapons. REQ-PF2-030 */
  readonly strikes: DerivedStrike[];

  /** Dying max adjusted for doomed. REQ-PF2-074 */
  readonly dyingMax: number;

  /**
   * Spellcasting DC/attack per spellcastingEntry item id (CONTRACT 2).
   * `attack` already includes synthetics modifiers; `dc = 10 + attack`.
   * Optional: absent for characters with no spellcasting entries (some
   * derivation call sites may skip writing an empty object).
   */
  readonly spellcasting?: Record<
    string,
    { dc: number; attack: number; ability: string; rank: number }
  >;
}

// ---------------------------------------------------------------------------
// NPC derived data
// ---------------------------------------------------------------------------

/**
 * Derived data for an `npc` actor.
 *
 * NPCs use flat values from the statblock; derivation only applies
 * condition/effect modifiers on top of the stored totals.
 *
 * REQ-PF2-002 / DEC-PF2-03.
 */
export interface NpcDerived {
  /** AC after applying condition modifiers. REQ-PF2-020 */
  readonly ac: {
    readonly total: number;
    readonly modifiers: ModifierBreakdown[];
  };

  /** HP (value/max/temp). REQ-PF2-021 */
  readonly hp: {
    readonly value: number;
    readonly max: number;
    readonly temp: number;
  };

  /** Perception modifier after applying condition modifiers. REQ-PF2-014 */
  readonly perception: {
    readonly total: number;
    readonly modifiers: ModifierBreakdown[];
  };

  /** Saving throws with modifiers. REQ-PF2-015 */
  readonly saves: {
    readonly fortitude: { total: number; modifiers: ModifierBreakdown[] };
    readonly reflex: { total: number; modifiers: ModifierBreakdown[] };
    readonly will: { total: number; modifiers: ModifierBreakdown[] };
  };

  /** Skills (total mod, from statblock + condition modifiers). */
  readonly skills: Record<string, { total: number; modifiers: ModifierBreakdown[] }>;
}
