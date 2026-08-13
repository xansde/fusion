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

/**
 * A resolved SKILL statistic — a `DerivedStatistic` that also carries the
 * proficiency rank it was derived from.
 *
 * Why skills get their own type instead of a `rank` on `DerivedStatistic`:
 * that base type is shared by AC, saves, perception and attacks, none of
 * which has a rank the sheet has to render — widening it would ripple a
 * meaningless field through the entire derivation surface.
 *
 * Why the rank has to travel on the derived data at all: a sheet cannot read
 * it back from `system.skills.<slug>.rank`. Build-driven ranks (background,
 * class and free skill selections) are computed during derivation and the
 * server persists only `system.derived`, so the persisted rank stays 0 while
 * `total` already includes the proficiency bonus — the sheet would label a
 * trained skill "Untrained".
 */
export interface DerivedSkillStatistic extends DerivedStatistic {
  /** Proficiency rank used to derive `base`: 0 untrained … 4 legendary. */
  readonly rank: number;
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
// Elemental Blast (Kineticist — Rage of Elements)
// ---------------------------------------------------------------------------

/**
 * A single Kineticist Elemental Blast, one per gate element (r18-N2b).
 *
 * The impulse attack roll uses the SAME proficiency + attribute modifier as
 * the kineticist class DC (CON), per Rage of Elements p.14 ("Your impulse
 * attack roll uses the same proficiency and attribute modifier as your
 * kineticist class DC"). Damage die/type/range come from the element.
 *
 * `attackBonus` is the MAP-0 total (level + impulse proficiency + CON + any
 * `impulse-attack-roll` item bonus, e.g. Gate Attenuator +1). MAP variants
 * mirror a strike (impulses are NOT agile: −5 / −10).
 *
 * `damageRoll` is a PURE rollable formula for `@dice-roller/rpg-dice-roller`
 * (no damage type in the text) — CONTRACT 3, matching DerivedStrike. The
 * 2-action CON status bonus is exposed via `twoActionDamageBonus` but NOT
 * baked into the base 1-action ranged roll (the sheet applies it when the
 * player rolls the 2-action variant; a melee blast likewise adds STR).
 */
export interface DerivedElementalBlast {
  /** Gate element slug ("air", "metal", "fire", …). */
  readonly element: string;
  /** Display label (e.g. "Elemental Blast (Air)"). */
  readonly label: string;
  /** Chosen/primary damage type for this element (e.g. "electricity"). */
  readonly damageType: string;
  /** All damage-type options this element allows (e.g. ["electricity","slashing"]). */
  readonly damageTypeOptions: string[];
  /** Whether this blast is being used at range (element's ranged option). */
  readonly isRanged: boolean;
  /** Ranged range in feet (null for a purely melee blast). */
  readonly range: number | null;
  /** Attack bonus at MAP 0 (without the d20). */
  readonly attackBonus: number;
  /** All three MAP variants (0 / −5 / −10 — impulses are never agile). */
  readonly variants: [StrikeVariant, StrikeVariant, StrikeVariant];
  /** Number of damage dice at the character's level. */
  readonly damageDice: number;
  /** Damage die size ("d6", "d8", …). */
  readonly damageDie: string;
  /** Pure rollable 1-action damage formula (no type), e.g. "1d6". CONTRACT 3. */
  readonly damageRoll: string;
  /** Display damage formula, e.g. "1d6 electricity". */
  readonly damageFormula: string;
  /**
   * Status bonus to damage for a 2-action blast (= CON mod). The sheet adds
   * this when the player rolls the 2-action variant.
   */
  readonly twoActionDamageBonus: number;
  /** Item bonus applied to the attack (e.g. Gate Attenuator +1); 0 if none. */
  readonly itemAttackBonus: number;
}

// ---------------------------------------------------------------------------
// Archetype class DC (dedication-granted, DEC-R12-04)
// ---------------------------------------------------------------------------

/**
 * A class DC granted by a multiclass/archetype dedication feat.
 *
 * `slug`  = archetype key (e.g. "alchemist") — from the feat's
 *           `subfeatures.proficiencies.<slug>`.
 * `label` = display name ("Alchemist").
 * `ability` = key ability slug used for this DC ("int", "dex", …).
 * `total` = abilityMod + proficiencyBonus(rank, level).
 * `dc`    = 10 + total.
 * `rank`  = proficiency rank granted (dedications grant Trained = 1).
 */
export interface ArchetypeClassDC {
  readonly slug: string;
  readonly label: string;
  readonly ability: string;
  readonly rank: number;
  readonly total: number;
  readonly dc: number;
}

/**
 * Class DC of ONE class the character has (REQ-MCL-022).
 *
 * Under the multiclass variant a character has one per class, each ranked at
 * ITS OWN class level. An effect that says "your class DC" without naming one
 * uses the highest — which is what `derived.classDC` keeps holding.
 */
export interface ClassDCEntry {
  /** Stable class identity (`flags.fusion.sourceId`). */
  readonly classKey: string;
  /** Display name of the class. */
  readonly label: string;
  /** Levels the character has IN this class. */
  readonly classLevel: number;
  readonly ability: string;
  readonly rank: number;
  readonly total: number;
  readonly dc: number;
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

  /**
   * Saving throws. REQ-PF2-015.
   *
   * Each entry also carries the `rank` it was derived from (mirrors
   * CONTRACT C1 for skills, issue #38) — the sheet must read the
   * proficiency label from here, not from `system.saves`, which never
   * receives the class-granted rank back once derivation runs (only
   * `system.derived` is persisted).
   */
  readonly saves: {
    readonly fortitude: DerivedSkillStatistic;
    readonly reflex: DerivedSkillStatistic;
    readonly will: DerivedSkillStatistic;
  };

  /**
   * Perception. REQ-PF2-014. Carries `rank` for the same reason `saves`
   * does above (issue #38).
   */
  readonly perception: DerivedSkillStatistic;

  /** All 16 canonical skills (and any Lore skills). REQ-PF2-012 */
  readonly skills: Record<string, DerivedSkillStatistic>;

  /** Class DC. REQ-PF2-016 */
  readonly classDC: {
    readonly total: number;
    readonly dc: number;
    readonly modifiers: ModifierBreakdown[];
  };

  /**
   * Class DCs granted by multiclass/archetype dedications (DEC-R12-04),
   * separate from the base-class `classDC`. One entry per dedication feat
   * that grants its own class DC (e.g. Alchemist Dedication → INT-based
   * class DC). Empty when the character has no such dedications. Optional:
   * docs derived before r12 lack it (clients treat absent as `[]`).
   */
  readonly archetypeClassDCs?: ArchetypeClassDC[];
  /** One entry per class the character has (REQ-MCL-022). */
  readonly classDCs?: ClassDCEntry[];

  /** Derived strikes from equipped weapons. REQ-PF2-030 */
  readonly strikes: DerivedStrike[];

  /**
   * Kineticist Elemental Blasts, one per gate element (r18-N2b). Empty/absent
   * for non-kineticists. Optional: docs derived before r18 lack it (clients
   * treat absent as `[]`).
   */
  readonly elementalBlasts?: DerivedElementalBlast[];

  /** Dying max adjusted for doomed. REQ-PF2-074 */
  readonly dyingMax: number;

  /**
   * Land speed after applying FlatModifiers carried by embedded feats,
   * heritages, class features, and ancestry items (e.g. Fleet's +5 land
   * speed) — PF2e stacking applied (r16-G1). `base` is the raw
   * `system.speed.value` before modifiers; `otherSpeeds` is passed through
   * unmodified (climb/swim/fly/burrow are out of this batch's scope).
   * Optional: docs derived before r16 lack it (clients fall back to the raw
   * `system.speed.value`).
   */
  readonly speed?: {
    readonly value: number;
    readonly base: number;
    readonly modifiers: ModifierBreakdown[];
    readonly otherSpeeds: unknown[];
  };

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
