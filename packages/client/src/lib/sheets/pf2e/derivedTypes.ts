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

  readonly strikes: DerivedStrike[];

  readonly dyingMax: number;
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
