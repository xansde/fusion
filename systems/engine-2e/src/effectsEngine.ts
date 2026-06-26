/**
 * Effects Engine — EffectSource collector and Synthetics builder.
 *
 * This is the core of the M3-A effects processing pipeline. Given a set of
 * EffectSources (items, conditions, etc. attached to an actor), it:
 *
 *   1. Extracts active EffectRules (respecting predicates and ignored flags).
 *   2. Builds the Synthetics accumulator (modifiers, roll options, IWR, notes, toggles).
 *   3. Provides per-selector modifier collection (list of unresolved modifiers).
 *   4. Handles roll options with a fixed-point iteration loop.
 *   5. Logs unsupported rule elements via UnsupportedRuleElementLog (FALLBACK).
 *
 * Clean-room design — no PF2e source code copied verbatim.
 * References: specs/15-api-de-sistemas.md REQ-SYS-080..090.
 *
 * REQ-SYS-080: engine implements effect processing.
 * REQ-SYS-082 (FALLBACK): unknown rule types log and skip, no crash.
 * REQ-SYS-083: deferred modifier factories.
 * REQ-SYS-084: selectors as affected domain.
 * REQ-SYS-086: predicate evaluation against roll options.
 * REQ-SYS-088: Synthetics accumulator shape.
 * REQ-SYS-090: ignored/predicate-not-met is no-op.
 */

import {
  type EffectRule,
  type FlatModifierRule,
  type RollOptionRule,
  type NoteRule,
  type ToggleConditionRule,
  type IwrRule,
  type DeferredModifier,
  type ResolvedModifier,
  type RollNote,
  type IwrEntry,
  type Synthetics,
  UnsupportedRuleElementLog,
  isMvpRuleType,
  evaluatePredicate,
  emptySynthetics,
} from "@fusion/system-api";

/**
 * A source of EffectRules — typically an Item or Condition on an actor.
 *
 * sourceId is a stable identifier for logging (slug, id, name).
 * active=false means the whole source is skipped (e.g., unequipped container).
 */
export interface EffectSource {
  readonly sourceId: string;
  /** Display label used in modifier labels. */
  readonly label: string;
  readonly rules: readonly EffectRule[];
  /** Whether this source is currently active (equipped, invested, etc.). */
  readonly active?: boolean;
  /** Item-level equipment state — used to honour requiresEquipped. */
  readonly isEquipped?: boolean;
  /** Item-level investment state — used to honour requiresInvested. */
  readonly isInvested?: boolean;
}

/**
 * Result of processing a set of EffectSources for an actor.
 */
export interface EffectsResult {
  /**
   * The populated Synthetics accumulator.
   * modifiers contains DeferredModifier factories (predicate-gated at roll time).
   * rollOptions contains all injected options by domain.
   * iwr contains immunities, weaknesses, and resistances.
   */
  readonly synthetics: Synthetics;

  /**
   * Log of unsupported (V2/unknown) rule elements encountered.
   * Callers can read this for diagnostics; the pipeline never throws for these.
   */
  readonly unsupportedLog: UnsupportedRuleElementLog;

  /**
   * Conditions that should be toggled on (conditionSlug to value).
   * Callers (prepareData) apply these via the condition registry.
   */
  readonly conditionsToToggle: ReadonlyMap<string, number | undefined>;
}

/**
 * Maximum fixed-point iterations for roll options propagation.
 *
 * If injecting roll options from one RollOption rule enables predicates on other
 * RollOption rules, we iterate until stability. Safety limit prevents infinite loops.
 */
const MAX_ROLL_OPTIONS_ITERATIONS = 10;

/**
 * Collect and process EffectRules from a set of EffectSources.
 *
 * The caller provides:
 *   - sources:     All EffectSources on the actor.
 *   - baseOptions: Initial roll options set (actor flags, conditions from data layer).
 *
 * Processing order:
 *   1. RollOption rules — fixed-point iteration to stable set.
 *   2. FlatModifier rules — push DeferredModifier factories into synthetics.modifiers.
 *   3. Note rules — push into synthetics.rollNotes.
 *   4. ToggleCondition rules — collect into conditionsToToggle.
 *   5. Iwr rules — push into synthetics.iwr.
 *   6. Unknown/V2 rules — log and skip (FALLBACK).
 *
 * REQ-SYS-082 / REQ-SYS-083 / REQ-SYS-086 / REQ-SYS-088 / REQ-SYS-090.
 */
export function collectEffects(
  sources: readonly EffectSource[],
  baseOptions: ReadonlySet<string>,
): EffectsResult {
  const synthetics = emptySynthetics();
  const unsupportedLog = new UnsupportedRuleElementLog();
  const conditionsToToggle = new Map<string, number | undefined>();

  // Gather active rules from all sources
  const activeRules = gatherActiveRules(sources);

  // Phase 1: Roll Options (fixed-point)
  // Start with the base options and keep injecting until stable.
  const rollOptions = buildRollOptionSet(activeRules, baseOptions, synthetics);

  // Phase 2: FlatModifier, Note, ToggleCondition, IWR
  //
  // Important design note on predicate evaluation:
  //   - FlatModifier: ALWAYS stored as a DeferredModifier factory. The factory
  //     re-evaluates the predicate at roll time. This enables target-context predicates
  //     (e.g., "target:condition:off-guard") that are unknown at prepareData time.
  //     REQ-SYS-083: deferred modifier factories.
  //   - Note: ALWAYS stored. Predicate filtering happens at resolve time via
  //     resolveNotesForSelector(), which also has roll-time context.
  //   - ToggleCondition / IWR: predicate evaluated at build time (these are
  //     actor-state effects that apply during prepareData, not at roll time).
  //   - Unknown/V2: fallback log regardless of predicate.

  for (const { rule, source, label } of activeRules) {
    if (!isMvpRuleType(rule.type)) {
      // FALLBACK: log unknown/V2 rule elements without crashing (REQ-SYS-082).
      // Predicate is NOT checked — we log and skip unconditionally for non-MVP types.
      unsupportedLog.add({ type: rule.type, sourceId: source, raw: rule });
      continue;
    }

    switch (rule.type) {
      case "rollOption":
        // Already processed in Phase 1 — skip here
        break;

      case "flatModifier":
        // No build-time predicate check — the DeferredModifier factory handles it.
        processFlatModifier(rule as FlatModifierRule, source, label, synthetics);
        break;

      case "note":
        // No build-time predicate check — resolveNotesForSelector() handles it.
        processNote(rule as NoteRule, source, synthetics);
        break;

      case "toggleCondition": {
        // Build-time predicate: condition toggles affect actor state during prepareData.
        if (rule.predicate && !evaluatePredicate(rule.predicate, rollOptions)) {
          break;
        }
        const tcRule = rule as ToggleConditionRule;
        conditionsToToggle.set(tcRule.conditionSlug, tcRule.value);
        break;
      }

      case "iwr":
        // Build-time predicate: IWR affects actor state during prepareData.
        if (rule.predicate && !evaluatePredicate(rule.predicate, rollOptions)) {
          break;
        }
        processIwr(rule as IwrRule, source, synthetics);
        break;
    }
  }

  return { synthetics, unsupportedLog, conditionsToToggle };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ActiveRule {
  readonly rule: EffectRule;
  readonly source: string;
  readonly label: string;
}

/**
 * Collect all active (non-ignored, equipped/invested conditions met) rules
 * across all sources. Pre-filter by ignored and equipment requirements.
 */
function gatherActiveRules(sources: readonly EffectSource[]): ActiveRule[] {
  const result: ActiveRule[] = [];

  for (const src of sources) {
    // Source-level active gate
    if (src.active === false) continue;

    for (const rule of src.rules) {
      // Rule-level ignore flag (REQ-SYS-090)
      if (rule.ignored === true) continue;

      // Equipment requirements
      if (rule.requiresEquipped === true && src.isEquipped !== true) continue;
      if (rule.requiresInvested === true && src.isInvested !== true) continue;

      result.push({ rule, source: src.sourceId, label: src.label });
    }
  }

  return result;
}

/**
 * Build the final roll options set via fixed-point iteration.
 *
 * RollOption rules inject strings into the options set. Because some rules may be
 * predicate-gated and their predicates may reference options from other RollOption
 * rules, we iterate until no new options are added.
 *
 * Safety: capped at MAX_ROLL_OPTIONS_ITERATIONS to prevent infinite loops.
 */
function buildRollOptionSet(
  activeRules: readonly ActiveRule[],
  baseOptions: ReadonlySet<string>,
  synthetics: Synthetics,
): ReadonlySet<string> {
  // Populate synthetics.rollOptions by domain for consumers
  const domainSets: Record<string, Set<string>> = synthetics.rollOptions;

  let currentOptions = new Set<string>(baseOptions);
  let changed = true;
  let iterations = 0;

  while (changed && iterations < MAX_ROLL_OPTIONS_ITERATIONS) {
    changed = false;
    iterations++;

    for (const { rule } of activeRules) {
      if (rule.type !== "rollOption") continue;
      const roRule = rule as RollOptionRule;

      // Predicate gate (uses current accumulated options)
      if (roRule.predicate && !evaluatePredicate(roRule.predicate, currentOptions)) {
        continue;
      }

      if (!currentOptions.has(roRule.option)) {
        currentOptions = new Set(currentOptions);
        currentOptions.add(roRule.option);
        changed = true;
      }

      // Also track in synthetics.rollOptions by domain
      if (!domainSets[roRule.domain]) {
        domainSets[roRule.domain] = new Set<string>();
      }
      // eslint guaranteed: domainSets[roRule.domain] was just initialized above
      const domainSet = domainSets[roRule.domain];
      if (domainSet) domainSet.add(roRule.option);
    }
  }

  return currentOptions;
}

/**
 * Process a FlatModifier rule into a DeferredModifier factory in synthetics.
 *
 * The DeferredModifier factory is evaluated at roll time (not during prepareData)
 * so predicates can still consider roll-time context (target, etc.).
 * REQ-SYS-083.
 */
function processFlatModifier(
  rule: FlatModifierRule,
  sourceId: string,
  label: string,
  synthetics: Synthetics,
): void {
  const selectors = Array.isArray(rule.selector) ? rule.selector : [rule.selector];
  const modType = rule.modifierType ?? "untyped";
  const slug = rule.slug ?? `${sourceId}-${modType}`;
  const modLabel = rule.label ?? label;

  // Resolve static numeric value; expression values treated as 0 until roll engine
  // evaluates them (roll expressions resolve at roll time in M3-D)
  const numericValue = typeof rule.value === "number" ? rule.value : 0;

  const modifiersMap: Record<string, DeferredModifier[]> = synthetics.modifiers;
  for (const selector of selectors) {
    // Capture predicate for roll-time re-evaluation
    const predicate = rule.predicate;
    const deferred: DeferredModifier = (rollTimeOptions) => {
      if (predicate && !evaluatePredicate(predicate, rollTimeOptions)) {
        return null;
      }
      const resolved: ResolvedModifier = {
        slug,
        label: modLabel,
        selector,
        value: numericValue,
        type: modType,
        source: sourceId,
      };
      return resolved;
    };

    const bucket = modifiersMap[selector] ?? [];
    bucket.push(deferred);
    modifiersMap[selector] = bucket;
  }
}

/**
 * Process a Note rule into synthetics.rollNotes.
 */
function processNote(rule: NoteRule, sourceId: string, synthetics: Synthetics): void {
  const selectors = Array.isArray(rule.selector) ? rule.selector : [rule.selector];
  const notesMap: Record<string, RollNote[]> = synthetics.rollNotes;

  for (const selector of selectors) {
    const note: RollNote = {
      selector,
      text: rule.text,
      ...(rule.predicate !== undefined ? { predicate: rule.predicate } : {}),
      source: sourceId,
    };

    const bucket = notesMap[selector] ?? [];
    bucket.push(note);
    notesMap[selector] = bucket;
  }
}

/**
 * Process an IWR rule into synthetics.iwr.
 */
function processIwr(rule: IwrRule, sourceId: string, synthetics: Synthetics): void {
  const entry: IwrEntry = {
    category: rule.category,
    target: rule.target,
    ...(rule.value !== undefined ? { value: rule.value } : {}),
    ...(rule.exceptions !== undefined ? { exceptions: rule.exceptions } : {}),
    ...(rule.doubleVs !== undefined ? { doubleVs: rule.doubleVs } : {}),
    source: sourceId,
  };

  if (rule.category === "immunity") {
    synthetics.iwr.immunities.push(entry);
  } else if (rule.category === "weakness") {
    synthetics.iwr.weaknesses.push(entry);
  } else {
    synthetics.iwr.resistances.push(entry);
  }
}

/**
 * Resolve all deferred modifiers for a selector at roll time.
 *
 * Evaluates each DeferredModifier factory with the provided roll-time options.
 * Returns only the modifiers whose predicates are satisfied.
 *
 * @param selector    - The selector domain (e.g., "attack-roll", "ac").
 * @param synthetics  - The populated Synthetics from collectEffects().
 * @param rollOptions - Current roll-time options (may include target context).
 * @returns           - Resolved modifier list (not yet stacked — caller applies stacking).
 */
export function resolveModifiersForSelector(
  selector: string,
  synthetics: Synthetics,
  rollOptions: ReadonlySet<string>,
): ResolvedModifier[] {
  const factories = synthetics.modifiers[selector];
  if (!factories || factories.length === 0) return [];

  const resolved: ResolvedModifier[] = [];
  for (const factory of factories) {
    const mod = factory(rollOptions);
    if (mod !== null) {
      resolved.push(mod);
    }
  }
  return resolved;
}

/**
 * Collect roll notes for a selector at roll time.
 *
 * Filters notes whose predicates are satisfied by the provided roll options.
 */
export function resolveNotesForSelector(
  selector: string,
  synthetics: Synthetics,
  rollOptions: ReadonlySet<string>,
): RollNote[] {
  const notes = synthetics.rollNotes[selector];
  if (!notes || notes.length === 0) return [];

  return notes.filter((note) => {
    if (!note.predicate) return true;
    return evaluatePredicate(note.predicate, rollOptions);
  });
}
