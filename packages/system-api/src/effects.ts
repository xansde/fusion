/**
 * Effects / Rule Elements contract.
 *
 * Clean-room reimplementation of the Rule Element concept from PF2e
 * (Apache-2.0 reference, no code copied verbatim). The PF2e system uses
 * Rule Elements to express item-level rules (modifiers, roll options, notes,
 * grants, etc.) in a data-driven way. Fusion generalizes this as "EffectRules"
 * — discriminated by `type`, processed by the engine during `prepareData`,
 * stored in `system.rules` arrays on Items/effects.
 *
 * MVP types (implemented by engine):
 *   flatModifier — numeric bonus/penalty to a selector
 *   rollOption   — inject flag into roll options domain
 *   note         — append explanatory text to a roll result
 *   toggleCondition — apply/remove a condition
 *   iwr          — immunity/weakness/resistance
 *
 * V2 types (reserved in enum, FALLBACK logs and ignores them — no crash):
 *   grantItem, choiceSet, itemAlteration, activeEffectLike,
 *   damageDice, aura, adjustDegreeOfSuccess
 *
 * FALLBACK: any EffectRule whose `type` is not in the MVP set is logged to
 * `unsupportedRuleElements` and silently skipped. This is CRITICAL for the
 * M3-D importer: unknown rule types must not crash the app.
 *
 * REQ-SYS-080: engine implements effect processing.
 * REQ-SYS-081: EffectRuleBase common fields.
 * REQ-SYS-082: canonical type list (MVP vs V2).
 * REQ-SYS-083: deferred modifier factories.
 * REQ-SYS-084: selectors as affected domain.
 * REQ-SYS-085: stacking rules declared by system.
 * REQ-SYS-086: predicate evaluation against roll options.
 * REQ-SYS-090: ignored/predicate-not-met → no-op.
 *
 * REQ-ARQ-005: system-api must NOT import from server or client.
 */
import type { Predicate } from "./derive.js";

// ---------------------------------------------------------------------------
// Rule element type keys (discriminator enum)
// ---------------------------------------------------------------------------

/**
 * Canonical keys for EffectRule types.
 *
 * MVP keys are handled by the engine.
 * V2 keys are reserved and fall back to the unsupported handler.
 */
export const EFFECT_RULE_KEYS = {
  // ── MVP ──────────────────────────────────────────────────────────────────
  /** Numeric bonus/penalty to a selector domain. REQ-SYS-082. */
  FlatModifier: "flatModifier",
  /** Inject a flag string into a roll options domain. REQ-SYS-082. */
  RollOption: "rollOption",
  /** Append explanatory text to a roll result. REQ-SYS-082. */
  Note: "note",
  /** Apply/remove a condition on the actor. REQ-SYS-082. */
  ToggleCondition: "toggleCondition",
  /** Immunity / weakness / resistance to damage type or condition. REQ-SYS-082. */
  Iwr: "iwr",

  // ── [V2] — reserved, currently falls back to unsupported handler ─────────
  /** [V2] Grant another Item via UUID. */
  GrantItem: "grantItem",
  /** [V2] Present a choice set during item preparation. */
  ChoiceSet: "choiceSet",
  /** [V2] Alter another item's data. */
  ItemAlteration: "itemAlteration",
  /** [V2] AE-like property override with modes. */
  ActiveEffectLike: "activeEffectLike",
  /** [V2] Add damage dice (conditional). Static damageDice is MVP via flatModifier. */
  DamageDice: "damageDice",
  /** [V2] Aura effect radiating from actor. */
  Aura: "aura",
  /** [V2] Adjust degree of success (Evasion/Juggernaut style). */
  AdjustDegreeOfSuccess: "adjustDegreeOfSuccess",
} as const;

export type EffectRuleKey = (typeof EFFECT_RULE_KEYS)[keyof typeof EFFECT_RULE_KEYS];

/** MVP rule element type keys — these are handled by the engine. */
export const MVP_EFFECT_RULE_KEYS: ReadonlySet<string> = new Set([
  EFFECT_RULE_KEYS.FlatModifier,
  EFFECT_RULE_KEYS.RollOption,
  EFFECT_RULE_KEYS.Note,
  EFFECT_RULE_KEYS.ToggleCondition,
  EFFECT_RULE_KEYS.Iwr,
]);

// ---------------------------------------------------------------------------
// Base fields common to every EffectRule
// REQ-SYS-081
// ---------------------------------------------------------------------------

/**
 * Fields present on every rule element regardless of type.
 *
 * REQ-SYS-081.
 */
export interface EffectRuleBase {
  /** Discriminator — determines which handler processes this rule. */
  readonly type: string;

  /**
   * Stable machine-readable identifier within the item (optional).
   * Used in logs and for targeting by ToggleCondition/ChoiceSet.
   */
  readonly slug?: string;

  /** Human-readable display label. */
  readonly label?: string;

  /**
   * Predicate evaluated against roll options at apply-time.
   * If provided and not satisfied, the rule is a no-op. REQ-SYS-090.
   */
  readonly predicate?: Predicate;

  /**
   * Numeric priority for ordering within the same selector.
   * Higher = applied later (resolves last). Default: 50.
   */
  readonly priority?: number;

  /**
   * When true, the rule is unconditionally skipped (soft-disable without
   * removing from data). REQ-SYS-090.
   */
  readonly ignored?: boolean;

  /**
   * Rule only applies when the item is equipped. [MVP for physical items]
   */
  readonly requiresEquipped?: boolean;

  /**
   * Rule only applies when the item is invested. [MVP for invested items]
   */
  readonly requiresInvested?: boolean;
}

// ---------------------------------------------------------------------------
// MVP rule element shapes
// ---------------------------------------------------------------------------

/**
 * Adds a typed numeric bonus or penalty to a selector domain.
 *
 * `modifierType` controls stacking behaviour as declared by the system's
 * stacking table (e.g., "circumstance", "item", "status", "untyped").
 * The engine does not hardcode PF2e rules — REQ-SYS-085/136.
 *
 * `value` may be a numeric literal or a roll-data expression
 * (`"@actor.level"`, `"floor(@actor.level / 2)"`) resolved by the roll engine.
 * REQ-SYS-087.
 *
 * REQ-SYS-082 (flatModifier).
 */
export interface FlatModifierRule extends EffectRuleBase {
  readonly type: "flatModifier";
  /** Selector or list of selectors this modifier applies to. REQ-SYS-084. */
  readonly selector: string | string[];
  /** Numeric value or roll-data expression. REQ-SYS-087. */
  readonly value: number | string;
  /** Stacking type (system-declared). Default: "untyped". */
  readonly modifierType?: string;
}

/**
 * Injects a flag string into a roll options domain.
 *
 * Predicate-conditional injection (i.e., the option is only injected when the
 * predicate passes at apply-time) is implemented in [V2] along with the full
 * RollOption rule element.
 *
 * REQ-SYS-082 (rollOption).
 */
export interface RollOptionRule extends EffectRuleBase {
  readonly type: "rollOption";
  /** Domain that receives the option (e.g., "all", "attack", "skill"). */
  readonly domain: string;
  /** The option string to inject (e.g., "target:condition:off-guard"). */
  readonly option: string;
  /** When true, the option can be toggled on/off from the UI. [V2 behaviour] */
  readonly toggleable?: boolean;
}

/**
 * Appends an explanatory note to a roll result in a selector domain.
 *
 * REQ-SYS-082 (note).
 */
export interface NoteRule extends EffectRuleBase {
  readonly type: "note";
  /** Selector domain (e.g., "attack-roll", "fortitude"). */
  readonly selector: string | string[];
  /**
   * Note text (may contain inline HTML — sanitized before display).
   * REQ-SYS-134: sanitization is the consumer's responsibility.
   */
  readonly text: string;
}

/**
 * Applies or removes a condition on the owning actor.
 *
 * REQ-SYS-082 (toggleCondition).
 */
export interface ToggleConditionRule extends EffectRuleBase {
  readonly type: "toggleCondition";
  /** Slug of the condition to toggle (e.g., "frightened", "off-guard"). */
  readonly conditionSlug: string;
  /** Value for valued conditions. */
  readonly value?: number;
}

/**
 * Declares an immunity, weakness, or resistance.
 *
 * REQ-SYS-082 (iwr).
 */
export interface IwrRule extends EffectRuleBase {
  readonly type: "iwr";
  readonly category: "immunity" | "weakness" | "resistance";
  /** Damage type or condition slug this entry applies to. */
  readonly target: string;
  /** Numeric value for weaknesses/resistances. Not used for immunities. */
  readonly value?: number;
  /** Damage types/conditions that bypass this IWR entry. */
  readonly exceptions?: string[];
  /** Damage types against which the value is doubled. */
  readonly doubleVs?: string[];
}

// ---------------------------------------------------------------------------
// [V2] placeholder shapes (accepted by the registry but not processed)
// ---------------------------------------------------------------------------

export interface GrantItemRule extends EffectRuleBase {
  readonly type: "grantItem";
  readonly uuid: string;
}

export interface ChoiceSetRule extends EffectRuleBase {
  readonly type: "choiceSet";
  readonly choices: unknown;
}

export interface ItemAlterationRule extends EffectRuleBase {
  readonly type: "itemAlteration";
  readonly itemId: string;
  readonly alteration: unknown;
}

export interface ActiveEffectLikeRule extends EffectRuleBase {
  readonly type: "activeEffectLike";
  readonly path: string;
  readonly mode: "add" | "multiply" | "override" | "upgrade" | "downgrade";
  readonly value: number | string | boolean;
}

export interface DamageDiceRule extends EffectRuleBase {
  readonly type: "damageDice";
  readonly selector: string;
  readonly diceNumber: number;
  readonly dieSize: string;
}

export interface AuraRule extends EffectRuleBase {
  readonly type: "aura";
  readonly radius: number;
  readonly effects: EffectRule[];
}

export interface AdjustDegreeOfSuccessRule extends EffectRuleBase {
  readonly type: "adjustDegreeOfSuccess";
  readonly selector: string;
  readonly adjustment: "improve" | "worsen";
}

/** An unknown rule element — produced by the fallback handler for V2/unknown types. */
export interface UnknownEffectRule extends EffectRuleBase {
  readonly type: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// EffectRule discriminated union
// ---------------------------------------------------------------------------

/**
 * A discriminated union of all effect rule shapes.
 *
 * The engine dispatches on `type`:
 * - MVP types → active processing.
 * - V2 types  → logged to `unsupportedRuleElements`, no-op.
 * - Unknown   → logged to `unsupportedRuleElements`, no-op.
 *
 * REQ-SYS-082.
 */
export type EffectRule =
  // MVP
  | FlatModifierRule
  | RollOptionRule
  | NoteRule
  | ToggleConditionRule
  | IwrRule
  // [V2]
  | GrantItemRule
  | ChoiceSetRule
  | ItemAlterationRule
  | ActiveEffectLikeRule
  | DamageDiceRule
  | AuraRule
  | AdjustDegreeOfSuccessRule
  // Fallback for truly unknown keys
  | UnknownEffectRule;

// ---------------------------------------------------------------------------
// Unsupported rule element fallback
// REQ-SYS-082 (FALLBACK): log and ignore unknown types without crashing.
// ---------------------------------------------------------------------------

/**
 * A record of an unsupported rule element encountered during processing.
 *
 * Critical for the M3-D importer: items from pf2e JSON may have rule types
 * that Fusion has not yet implemented. Logging them here prevents crashes.
 *
 * REQ-SYS-082 FALLBACK.
 */
export interface UnsupportedRuleElementEntry {
  /** The unknown rule element type. */
  readonly type: string;
  /** Source item slug/id. */
  readonly sourceId: string;
  /** The raw rule data (for debugging). */
  readonly raw: unknown;
}

/**
 * Accumulator for unsupported rule elements encountered during prepareData.
 *
 * One instance per actor prepare cycle. Consumers (dev tools, importer
 * diagnostics) can read this after prepareData completes.
 */
export class UnsupportedRuleElementLog {
  private readonly _entries: UnsupportedRuleElementEntry[] = [];

  /** Record an unsupported rule element. */
  add(entry: UnsupportedRuleElementEntry): void {
    this._entries.push(entry);
  }

  /** All recorded entries. */
  get entries(): readonly UnsupportedRuleElementEntry[] {
    return this._entries;
  }

  /** True when at least one unsupported rule was encountered. */
  get hasEntries(): boolean {
    return this._entries.length > 0;
  }
}

/**
 * Determine whether a given rule element type is supported in the MVP.
 *
 * Unknown types should be passed to UnsupportedRuleElementLog and skipped.
 */
export function isMvpRuleType(type: string): boolean {
  return MVP_EFFECT_RULE_KEYS.has(type);
}

// ---------------------------------------------------------------------------
// Stacking rules (system-declared)
// REQ-SYS-085
// ---------------------------------------------------------------------------

/**
 * Rule for a single modifier type describing how multiple modifiers of that
 * type are combined.
 *
 * `stackBehaviour`:
 *   - `"highest-bonus-only"` → only the single largest positive value applies.
 *   - `"lowest-penalty-only"` → only the single most-negative value applies.
 *   - `"additive"` → all values are summed (default for "untyped").
 *   - `"override"` → last-applied value wins.
 */
export interface ModifierTypeRule {
  readonly type: string; // e.g., "circumstance", "status", "item", "untyped"
  readonly bonusBehaviour: "highest-only" | "additive";
  readonly penaltyBehaviour: "lowest-only" | "additive";
}

/**
 * A system-declared stacking table.
 *
 * The engine does NOT hardcode PF2e stacking rules; systems provide this table
 * via `registrar.stackingRules(table)`. Any type absent from the table is
 * treated as "untyped" (additive for both bonuses and penalties).
 *
 * REQ-SYS-085 / REQ-SYS-136.
 *
 * Example — PF2e table:
 * ```ts
 * [
 *   { type: "circumstance", bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
 *   { type: "status",       bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
 *   { type: "item",         bonusBehaviour: "highest-only", penaltyBehaviour: "lowest-only" },
 *   { type: "untyped",      bonusBehaviour: "additive",     penaltyBehaviour: "additive"    },
 * ]
 * ```
 */
export type StackingTable = readonly ModifierTypeRule[];

/**
 * Aggregate a list of resolved modifiers for a selector according to a stacking
 * table.
 *
 * For each modifier type:
 *   - Bonuses (value > 0): apply bonusBehaviour.
 *   - Penalties (value < 0): apply penaltyBehaviour.
 *   - Untyped (type absent from table): additive.
 *
 * REQ-SYS-085.
 */
export function aggregateModifiers(
  modifiers: ReadonlyArray<{ value: number; type: string }>,
  table: StackingTable,
): number {
  const rulesByType = new Map<string, ModifierTypeRule>();
  for (const rule of table) {
    rulesByType.set(rule.type, rule);
  }

  // Group by type, then by sign
  const grouped = new Map<string, { bonuses: number[]; penalties: number[] }>();
  for (const mod of modifiers) {
    let group = grouped.get(mod.type);
    if (!group) {
      group = { bonuses: [], penalties: [] };
      grouped.set(mod.type, group);
    }
    if (mod.value >= 0) {
      group.bonuses.push(mod.value);
    } else {
      group.penalties.push(mod.value);
    }
  }

  let total = 0;

  for (const [type, group] of grouped) {
    const rule = rulesByType.get(type);
    const bonusBehaviour = rule?.bonusBehaviour ?? "additive";
    const penaltyBehaviour = rule?.penaltyBehaviour ?? "additive";

    if (group.bonuses.length > 0) {
      if (bonusBehaviour === "highest-only") {
        total += Math.max(...group.bonuses);
      } else {
        total += group.bonuses.reduce((a, b) => a + b, 0);
      }
    }

    if (group.penalties.length > 0) {
      if (penaltyBehaviour === "lowest-only") {
        total += Math.min(...group.penalties);
      } else {
        total += group.penalties.reduce((a, b) => a + b, 0);
      }
    }
  }

  return total;
}
