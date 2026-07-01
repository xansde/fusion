/**
 * @fusion/system-sf2e — Derived data types for SF2e actors.
 *
 * Mirrors `systems/pf2e/src/derivations/types.ts` verbatim (REQ-SF2-004):
 * the derived-statistic and strike shapes are IDENTICAL to PF2e because the
 * underlying math (TEML proficiency, ability mods, modifier stacking, MAP)
 * is the same shared engine-2e core. No SF2e-exclusive fields are needed on
 * these types — SF2e deltas (grade, charges, credits, augmentations) live in
 * the source schemas, not in the derived-statistic shape.
 *
 * These types represent the output of the `prepareDerived` pipeline — data
 * computed from `_source` that is NEVER persisted (mirrors DEC-PF2-03).
 *
 * Clean-room: ORC/OGL mechanics only. No Foundry code copied.
 * REQ-SF2-004, REQ-SF2-007, REQ-SF2-018..020.
 * Spec: 18-sistema-sf2e.md.
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
 * SF2e adds `ammoOk` (false when a Tech weapon has no charges left —
 * REQ-SF2-020) on top of the PF2e shape.
 *
 * REQ-SF2-030 (inherited), REQ-SF2-018..020 (Tech weapon delta).
 */
export interface DerivedStrike {
  /** Display name (weapon name or "Claw", "Bite", etc.). */
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
  /** Critical damage formula (typically double). */
  readonly critDamageFormula: string;
  /** Damage type. */
  readonly damageType: string;
  /** Weapon traits (for UI and downstream processing). */
  readonly traits: string[];
  /**
   * True when the weapon can fire: either it is not ammo-tracked (no `ammo`
   * block, e.g. an Analog melee weapon) or it has >= `expend` charges left.
   * False strikes should be disabled in the UI. REQ-SF2-020.
   */
  readonly ammoOk: boolean;
  /** Current/max charges remaining, when the weapon tracks ammo (Tech weapons). */
  readonly charges?: { current: number; max: number };
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
 * REQ-SF2-002, REQ-SF2-004.
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

  /** Derived HP values (after drained penalty, inherited from engine-2e). */
  readonly hp: {
    readonly value: number;
    readonly max: number;
    readonly temp: number;
    /** Reduction to max HP from drained condition (level × drainedValue). */
    readonly drainedHpReduction: number;
  };

  /** Armor Class breakdown. */
  readonly ac: DerivedStatistic;

  /** Saving throws. */
  readonly saves: {
    readonly fortitude: DerivedStatistic;
    readonly reflex: DerivedStatistic;
    readonly will: DerivedStatistic;
  };

  /** Perception. */
  readonly perception: DerivedStatistic;

  /** All 18 canonical SF2e skills (incl. computers/piloting) and any Lore skills. */
  readonly skills: Record<string, DerivedStatistic>;

  /** Class DC. */
  readonly classDC: {
    readonly total: number;
    readonly dc: number;
    readonly modifiers: ModifierBreakdown[];
  };

  /** Derived strikes from equipped weapons. */
  readonly strikes: DerivedStrike[];

  /** Dying max adjusted for doomed (inherited from engine-2e). */
  readonly dyingMax: number;
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
 * REQ-SF2-002, REQ-SF2-004.
 */
export interface NpcDerived {
  /** AC after applying condition modifiers. */
  readonly ac: {
    readonly total: number;
    readonly modifiers: ModifierBreakdown[];
  };

  /** HP (value/max/temp). */
  readonly hp: {
    readonly value: number;
    readonly max: number;
    readonly temp: number;
  };

  /** Perception modifier after applying condition modifiers. */
  readonly perception: {
    readonly total: number;
    readonly modifiers: ModifierBreakdown[];
  };

  /** Saving throws with modifiers. */
  readonly saves: {
    readonly fortitude: { total: number; modifiers: ModifierBreakdown[] };
    readonly reflex: { total: number; modifiers: ModifierBreakdown[] };
    readonly will: { total: number; modifiers: ModifierBreakdown[] };
  };

  /** Skills (total mod, from statblock + condition modifiers). */
  readonly skills: Record<string, { total: number; modifiers: ModifierBreakdown[] }>;
}
