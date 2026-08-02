/**
 * derivedTypes.ts — Client-side type aliases for PF2e derived data.
 *
 * These mirror the types in systems/pf2e/src/derivations/types.ts exactly.
 * They are duplicated here because @fusion/client must NOT import from
 * systems/pf2e (arch boundary REQ-ARQ-005); the actual data arrives at runtime
 * from the DocumentMirror (which receives it from the server's derive pipeline).
 *
 * These types are used purely for static type-checking of VM view code.
 * They MUST stay in sync with the server-side derivations/types.ts.
 *
 * Clean-room — no Foundry code.
 * Spec: 17-sistema-pf2e.md §Interfaces TypeScript.
 */

// ---------------------------------------------------------------------------
// Modifier breakdown (for UI tooltip/breakdown display)
// ---------------------------------------------------------------------------

export interface ModifierBreakdown {
  readonly slug: string;
  readonly label: string;
  readonly type: string;
  readonly value: number;
}

// ---------------------------------------------------------------------------
// Derived Statistic
// ---------------------------------------------------------------------------

export interface DerivedStatistic {
  readonly slug: string;
  readonly base: number;
  readonly modifiers: ModifierBreakdown[];
  readonly total: number;
  readonly dc: number;
}

// ---------------------------------------------------------------------------
// Strike variants
// ---------------------------------------------------------------------------

export interface StrikeVariant {
  readonly mapPenalty: number;
  readonly total: number;
  readonly formula: string;
}

export interface DerivedStrike {
  readonly label: string;
  readonly sourceId: string;
  readonly isRanged: boolean;
  readonly isAgile: boolean;
  readonly attackBonus: number;
  readonly variants: [StrikeVariant, StrikeVariant, StrikeVariant];
  readonly damageAbilityMod: number;
  readonly damageFormula: string;
  readonly critDamageFormula: string;
  readonly damageType: string;
  readonly traits: string[];
  /**
   * Rollable formula string (no damage type in the text), e.g. "1d6+3".
   * Manual mirror — server contract (Tarefa A). Optional: absent on
   * older/pre-migration derived data — callers must handle undefined.
   */
  readonly damageRoll?: string;
  /**
   * Rollable crit formula string, e.g. "(1d6+3)*2" or with deadly/fatal
   * dice appended. Manual mirror — server contract (Tarefa A).
   */
  readonly critDamageRoll?: string;
}

// ---------------------------------------------------------------------------
// Elemental Blast (Kineticist — Rage of Elements, r18-N2b)
// ---------------------------------------------------------------------------

/**
 * A single Kineticist Elemental Blast, one per gate element. Manual mirror of
 * systems/pf2e derivations/types.ts DerivedElementalBlast — MUST stay in sync.
 *
 * The impulse attack uses the same proficiency + attribute (CON) as the
 * kineticist class DC. `damageRoll` is a pure rollable formula (no type in the
 * text) matching DerivedStrike (CONTRACT 3). The 2-action CON status bonus is
 * exposed via `twoActionDamageBonus` but NOT baked into the 1-action roll.
 */
export interface DerivedElementalBlast {
  readonly element: string;
  readonly label: string;
  readonly damageType: string;
  readonly damageTypeOptions: string[];
  readonly isRanged: boolean;
  readonly range: number | null;
  readonly attackBonus: number;
  readonly variants: [StrikeVariant, StrikeVariant, StrikeVariant];
  readonly damageDice: number;
  readonly damageDie: string;
  readonly damageRoll: string;
  readonly damageFormula: string;
  readonly twoActionDamageBonus: number;
  readonly itemAttackBonus: number;
}

// ---------------------------------------------------------------------------
// Archetype class DC (dedication-granted, DEC-R12-04)
// ---------------------------------------------------------------------------

/**
 * A class DC granted by a multiclass/archetype dedication feat, separate
 * from the base-class classDC. Manual mirror of systems/pf2e
 * derivations/types.ts ArchetypeClassDC — MUST stay in sync.
 */
/**
 * Mirror of systems/pf2e derivations/types.ts ClassDCEntry — MUST stay in sync.
 *
 * One entry per class the character has, each ranked at its own class level
 * (multiclass variant, specs/30). A single-class sheet has exactly one.
 */
export interface ClassDCEntry {
  readonly classKey: string;
  readonly label: string;
  readonly classLevel: number;
  readonly ability: string;
  readonly rank: number;
  readonly total: number;
  readonly dc: number;
}

export interface ArchetypeClassDC {
  readonly slug: string;
  readonly label: string;
  readonly ability: string;
  readonly rank: number;
  readonly total: number;
  readonly dc: number;
}

// ---------------------------------------------------------------------------
// CharacterDerived (populated by M3-B steps on server; arrives via DocumentMirror)
// ---------------------------------------------------------------------------

export interface CharacterDerived {
  readonly abilityMods: {
    readonly str: number;
    readonly dex: number;
    readonly con: number;
    readonly int: number;
    readonly wis: number;
    readonly cha: number;
  };

  readonly hp: {
    readonly value: number;
    readonly max: number;
    readonly temp: number;
    readonly drainedHpReduction: number;
  };

  readonly ac: DerivedStatistic;

  readonly saves: {
    readonly fortitude: DerivedStatistic;
    readonly reflex: DerivedStatistic;
    readonly will: DerivedStatistic;
  };

  readonly perception: DerivedStatistic;

  readonly skills: Record<string, DerivedStatistic>;

  readonly classDC: {
    readonly total: number;
    readonly dc: number;
    readonly modifiers: ModifierBreakdown[];
  };

  /**
   * Class DCs granted by archetype/multiclass dedications (DEC-R12-04),
   * separate from the base-class classDC. Manual mirror — server contract.
   * Optional: absent on pre-r12 derived data — callers treat as [].
   */
  readonly archetypeClassDCs?: ArchetypeClassDC[];
  /** One class DC per class the character has (REQ-MCL-022). */
  readonly classDCs?: ClassDCEntry[];
  /** Per spellcasting entry: class level, native/effective rank, elevation. */
  readonly spellcastingLevels?: Record<
    string,
    {
      readonly classKey: string | null;
      readonly classLevel: number;
      readonly nativeRank: number;
      readonly effectiveRank: number;
      readonly elevation: number;
      readonly fromArchetype: boolean;
    }
  >;

  readonly strikes: DerivedStrike[];

  /**
   * Kineticist Elemental Blasts, one per gate element (r18-N2b). Manual mirror
   * — server contract. Optional: absent on non-kineticist / pre-r18 derived
   * data — the blasts getter treats it as [].
   */
  readonly elementalBlasts?: DerivedElementalBlast[];

  readonly dyingMax: number;

  /**
   * Spell DC/attack per spellcasting entry, keyed by entryItemId.
   * Manual mirror — server contract (Tarefa A). Optional: absent on
   * older/pre-migration derived data — callers must fall back to 10/0.
   */
  readonly spellcasting?: Record<
    string,
    {
      readonly dc: number;
      readonly attack: number;
      readonly ability: string;
      readonly rank: number;
    }
  >;

  /**
   * Derived land speed (r16-G1): base system.speed.value plus any land-speed
   * FlatModifiers from embedded feats (Fleet, ancestry feats, …). Manual mirror
   * of stepCharSpeed's system.derived.speed. Optional: absent on pre-r16 derived
   * data — the speed getter falls back to the raw system.speed.value.
   */
  readonly speed?: {
    readonly value: number;
    readonly base: number;
    readonly modifiers: ModifierBreakdown[];
    readonly otherSpeeds?: unknown[];
  };
}

// ---------------------------------------------------------------------------
// NpcDerived
// ---------------------------------------------------------------------------

export interface NpcDerived {
  readonly ac: {
    readonly total: number;
    readonly modifiers: ModifierBreakdown[];
  };

  readonly hp: {
    readonly value: number;
    readonly max: number;
    readonly temp: number;
  };

  readonly perception: {
    readonly total: number;
    readonly modifiers: ModifierBreakdown[];
  };

  readonly saves: {
    readonly fortitude: { total: number; modifiers: ModifierBreakdown[] };
    readonly reflex: { total: number; modifiers: ModifierBreakdown[] };
    readonly will: { total: number; modifiers: ModifierBreakdown[] };
  };

  readonly skills: Record<string, { total: number; modifiers: ModifierBreakdown[] }>;
}
