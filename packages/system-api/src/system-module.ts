/**
 * SystemModule, SystemRegistrar, and defineSystem.
 *
 * REQ-SYS-001: defineSystem(manifest, build) returns SystemModule.
 * REQ-SYS-010: SystemRegistrar.defineModel registers a SystemDataModel.
 * REQ-SYS-011: Every subtype in documentTypes must have a model registered.
 * REQ-SYS-020: SystemRegistrar.derive registers a DeriveStep.
 * REQ-SYS-040: SystemRegistrar.sheet registers a sheet component.
 * REQ-SYS-043: SystemRegistrar.condition registers a condition definition.
 * REQ-SYS-045: SystemRegistrar.action registers a declarative action.
 * REQ-SYS-046: SystemRegistrar.chatCard registers a chat card renderer.
 * REQ-SYS-047: SystemRegistrar.setting registers a setting definition.
 */
import type { z, ZodType } from "zod";
import type { InitiativeFormulaFn } from "@fusion/shared";
import { type SystemManifest, SystemManifestSchema, type DocumentType } from "./manifest.js";
import {
  type CombatRegistrar,
  type CombatSystemHooks,
  type SystemCombatConfig,
  type InitiativeCompareFn,
  type InitiativeFormulaRegistrationInput,
  type TurnHookFn,
  type RoundHookFn,
  type CombatEndHookFn,
  type DamageAppliedHookFn,
  type RegisteredTurnHook,
  type TurnHookRegistrations,
  isInitiativeFormulaRegistrationObject,
} from "./combat.js";
import type { ActorMechanics } from "./actor-mechanics.js";
import { DeriveStepRegistry, type DeriveStep } from "./derive.js";
import type { StackingTable } from "./effects.js";
import {
  type SystemSheetSpec,
  type ConditionDefinition,
  type ActionDefinition,
  type ChatCardDefinition,
  type SettingDefinition,
  type ErasedSettingDefinition,
  type ExtendedSystemRegistries,
  emptyExtendedAccumulator,
  type ExtendedAccumulator,
  type RollDataDefinition,
  type DegreeOfSuccessDefinition,
  type EffectsMaterializerDefinition,
} from "./registries.js";

// ---------------------------------------------------------------------------
// Data model spec
// ---------------------------------------------------------------------------

export interface MigrationDefinition {
  from: string;
  to: string;
  migrate(source: Record<string, unknown>): Record<string, unknown>;
}

export interface SystemDataModelSpec<S extends ZodType = ZodType> {
  documentType: DocumentType;
  subtype: string;
  /** Zod schema validating ONLY the `system` field content. */
  schema: S;
  defaults?: Partial<z.infer<S>>;
  migrations?: MigrationDefinition[];
}

export interface SystemDataModel {
  documentType: DocumentType;
  subtype: string;
  schema: ZodType;
  defaults?: Record<string, unknown>;
  migrations: MigrationDefinition[];
}

// ---------------------------------------------------------------------------
// SystemRegistrar
// ---------------------------------------------------------------------------

/**
 * One event's id+priority hook registry, keyed by id. `order` is a
 * monotonically increasing registration counter used ONLY to tie-break equal
 * priorities (REQ-SYS-139: "no empate, na ordem de registro") — never
 * exposed on the built SystemModule.
 */
type HookMap<Fn> = Map<string, { priority: number; fn: Fn; order: number }>;

/** Internal accumulator filled during defineSystem build callback. */
interface RegistrarAccumulator {
  models: SystemDataModel[];
  initiativeFormulas: Map<string, InitiativeFormulaFn>;
  /** Sparse — only combatTypes registered via the `{ roll, compare }` object form. */
  initiativeCompares: Map<string, InitiativeCompareFn>;
  combatHooks: CombatSystemHooks | null;
  deriveSteps: DeriveStepRegistry;
  extended: ExtendedAccumulator;
  // ─── DEC-SYS-11 turn hooks (ALQ-F1-02) ──────────────────────────────────
  onTurnStart: HookMap<TurnHookFn>;
  onTurnEnd: HookMap<TurnHookFn>;
  onRoundStart: HookMap<RoundHookFn>;
  onRoundEnd: HookMap<RoundHookFn>;
  onCombatEnd: HookMap<CombatEndHookFn>;
  /** Onda 2, finding B5 — same registry discipline, REQ-SYS-142 step 5. */
  onDamageApplied: HookMap<DamageAppliedHookFn>;
  /** REQ-SYS-142: at most one per system. */
  actorMechanics: ActorMechanics | null;
}

/**
 * The build-time registrar passed to a system's defineSystem(build) callback.
 *
 * Extends the data-model registrar with the combat registration surface
 * (CombatRegistrar) so systems declare initiative formulas + lifecycle hooks
 * alongside their data models.
 *
 * New in M3-A:
 *   - `derive(step)` — register a DeriveStep (REQ-SYS-020).
 *   - `sheet(spec)` — register a sheet component (REQ-SYS-040).
 *   - `condition(def)` — register a condition (REQ-SYS-043).
 *   - `action(def)` — register a declarative action (REQ-SYS-045).
 *   - `chatCard(def)` — register a chat card renderer (REQ-SYS-046).
 *   - `setting(def)` — register a setting (REQ-SYS-047).
 *   - `stackingRules(table)` — declare modifier stacking rules (REQ-SYS-085).
 *
 * New in M5-A (aditive, retrocompatible — lets a non-2e-family system plug
 * into the same registries without depending on engine-2e):
 *   - `rollData(def)` — register a roll-data builder (E1).
 *   - `degreeOfSuccess(def)` — register a degree-of-success comparator (E2).
 *   - `effectsMaterializer(def)` — register an EffectSource materializer (E4).
 *   - `registerInitiativeFormula` (in CombatRegistrar) now also accepts an
 *     `{ roll, compare? }` object form, letting a system supply a
 *     non-monotonic `compare()` (E3, REQ-SYS-042).
 */
export interface SystemRegistrar extends CombatRegistrar {
  /**
   * Register a data model (Zod schema) for a (documentType, subtype) pair.
   * REQ-SYS-010
   */
  defineModel<S extends ZodType>(spec: SystemDataModelSpec<S>): void;

  /**
   * Register a derivation step.
   *
   * The engine sorts steps topologically within each phase.
   * Cycles are detected on first use and throw CyclicDependencyError.
   *
   * REQ-SYS-020.
   *
   * @example
   * ```ts
   * registrar.derive({
   *   id: "engine-2e.ability-modifier",
   *   documentType: "Actor",
   *   subtypes: ["character"],
   *   phase: "base",
   *   reads: ["system.abilities.str.score"],
   *   writes: ["system.abilities.str.mod"],
   *   run(doc, _ctx) {
   *     const score = (doc as any).system?.abilities?.str?.score ?? 10;
   *     (doc as any).system.abilities.str.mod = Math.floor((score - 10) / 2);
   *   },
   * });
   * ```
   */
  derive(step: DeriveStep): void;

  /**
   * Register a Svelte sheet component for a (documentType, subtypes[]) pair.
   * REQ-SYS-040.
   */
  sheet(spec: SystemSheetSpec): void;

  /**
   * Register a condition/status effect definition.
   * REQ-SYS-043.
   */
  condition(def: ConditionDefinition): void;

  /**
   * Register a declarative action (invocable from sheets, macros, chat).
   * REQ-SYS-045.
   */
  action(def: ActionDefinition): void;

  /**
   * Register a chat card renderer for a given cardType.
   * REQ-SYS-046.
   */
  chatCard(def: ChatCardDefinition): void;

  /**
   * Register a world/user/client setting.
   * REQ-SYS-047.
   */
  setting<S extends ZodType>(def: SettingDefinition<S>): void;

  /**
   * Declare the modifier stacking table for this system.
   *
   * The engine uses this table when aggregating modifiers of the same type
   * for a selector. If not declared, all types are treated as "untyped"
   * (fully additive).
   *
   * REQ-SYS-085.
   */
  stackingRules(table: StackingTable): void;

  /**
   * Register a roll-data builder for a (documentType, subtypes) pair.
   *
   * The server calls `build(doc)` to assemble the `@attr`-substitution
   * object before issuing a roll for that document, with fallback to
   * whatever the caller already does when no builder is registered for the
   * doc's (documentType, subtype) — aditive, retrocompatible (M5-A E1).
   *
   * At most one builder per (documentType, subtype): registering an
   * overlapping subtype set for the same documentType twice is a
   * programming error and MUST throw.
   *
   * REQ-ETM-015.
   *
   * @example
   * ```ts
   * registrar.rollData({
   *   documentType: "Actor",
   *   subtypes: ["orador"],
   *   build(doc) {
   *     const system = (doc as any).system ?? {};
   *     return { atributos: system.atributos, ...system.derived };
   *   },
   * });
   * ```
   */
  rollData(def: RollDataDefinition): void;

  /**
   * Register a degree-of-success comparator.
   *
   * The `degree` returned by `compute()` is a system-defined string (each
   * system owns its own set — e.g. a simpler "success"/"failure" pair for a
   * non-2e-family system). This is a NEW, independent, aditive surface:
   * PF2e/SF2e are NOT required to migrate to it and keep resolving
   * degree-of-success via their existing pipeline (the engine-2e
   * `calculateDegreeOfSuccess` helper called from their actions) — see M5-A E2.
   *
   * Calling this twice with the same `id` is a programming error and MUST
   * throw.
   */
  degreeOfSuccess(def: DegreeOfSuccessDefinition): void;

  /**
   * Register an EffectSource materializer for a (documentType, subtypes)
   * pair.
   *
   * Lets the derive-runner delegate EffectSource materialization
   * (`packages/server/src/net/derive-runner.ts`) to the ACTIVE system
   * instead of assuming 2e-family semantics (`collectEffects` from
   * `@fusion/engine-2e`). When no materializer is registered for a doc's
   * (documentType, subtype), the derive-runner falls back to its existing
   * 2e-family materialization — aditive, retrocompatible (M5-A E4).
   *
   * At most one materializer per (documentType, subtype): registering an
   * overlapping subtype set for the same documentType twice is a
   * programming error and MUST throw.
   */
  effectsMaterializer(def: EffectsMaterializerDefinition): void;

  /**
   * Register this system's ActorMechanics — the pure rule behind
   * `actor:applyDamage`/`actor:applyCondition` (DEC-SYS-12, REQ-SYS-142).
   *
   * At most once per system: calling this twice is a programming error and
   * MUST throw. `onTurnStart`/`onTurnEnd`/`onRoundStart`/`onRoundEnd`/
   * `onCombatEnd`/`onDamageApplied` (DEC-SYS-11) are inherited from
   * CombatRegistrar via TurnHookRegistrar — same registrar object, same
   * id+priority discipline.
   */
  registerActorMechanics(mechanics: ActorMechanics): void;
}

// ---------------------------------------------------------------------------
// SystemModule
// ---------------------------------------------------------------------------

export interface SystemModule {
  /** The validated manifest. */
  readonly manifest: SystemManifest;
  /** All registered data models, indexed by "documentType:subtype". */
  readonly models: ReadonlyMap<string, SystemDataModel>;
  /**
   * Combat registrations: initiative formulas (per combatType) and lifecycle
   * hooks. Always present; `initiativeFormulas` is empty and `hooks` is null
   * when the system registered nothing combat-related.
   *
   * Spec: 10-combate-e-iniciativa.md §system API.
   */
  readonly combat: SystemCombatConfig;

  /**
   * This system's ActorMechanics (DEC-SYS-12, REQ-SYS-142), or null when the
   * system registered none — `actor:applyDamage`/`applyCondition` then
   * resolve to `NOT_SUPPORTED` without writing anything.
   */
  readonly actorMechanics: ActorMechanics | null;

  /**
   * Derivation step registry.
   *
   * Call `deriveSteps.sortedForPhase(phase, docType, subtype)` to obtain
   * topologically-sorted steps ready for execution.
   *
   * REQ-SYS-020..023.
   */
  readonly deriveSteps: DeriveStepRegistry;

  /**
   * Extended registries: sheets, conditions, actions, chat cards, settings,
   * stacking table, roll-data builders, degree-of-success comparators,
   * effects materializers.
   *
   * REQ-SYS-040..047 / REQ-SYS-085 / M5-A (E1/E2/E4).
   */
  readonly registries: ExtendedSystemRegistries;
}

function modelKey(documentType: string, subtype: string): string {
  return `${documentType}:${subtype}`;
}

/** Generate the storage id for a rollData/effectsMaterializer registration. */
function rollDataId(documentType: string, subtypes: string[]): string {
  return `${documentType}:${subtypes.join(",")}`;
}

/**
 * Whether two (documentType, subtypes) registrations overlap: same
 * documentType, and either shares at least one subtype OR either side
 * declares "all subtypes" (empty array).
 */
function rollDataOverlaps(
  a: { documentType: string; subtypes: string[] },
  b: { documentType: string; subtypes: string[] },
): boolean {
  if (a.documentType !== b.documentType) return false;
  if (a.subtypes.length === 0 || b.subtypes.length === 0) return true;
  const bSet = new Set(b.subtypes);
  return a.subtypes.some((s) => bSet.has(s));
}

// ---------------------------------------------------------------------------
// Turn-hook accumulator helpers (DEC-SYS-11, REQ-SYS-138/139/141)
// ---------------------------------------------------------------------------

/**
 * Register one turn-hook entry into a per-event HookMap.
 *
 * Throws on a duplicate `id` WITHIN this event (REQ-SYS-138) — the same `id`
 * registered for a DIFFERENT event is fine, since each event has its own map.
 */
function registerHook<Fn>(
  map: HookMap<Fn>,
  systemId: string,
  eventName: string,
  id: string,
  fn: Fn,
  opts: { priority?: number } | undefined,
  nextOrder: () => number,
): void {
  if (id.length === 0) {
    throw new Error(`[defineSystem] ${eventName} for "${systemId}": id must be a non-empty string`);
  }
  if (map.has(id)) {
    throw new Error(
      `[defineSystem] system "${systemId}" registered duplicate "${eventName}" hook id "${id}"`,
    );
  }
  map.set(id, { priority: opts?.priority ?? 0, fn, order: nextOrder() });
}

/**
 * Freeze a HookMap into the sorted, inspectable form exposed on SystemModule
 * (REQ-SYS-139: priority descending, ties broken by registration order).
 */
function sortHookMap<Fn>(map: HookMap<Fn>): ReadonlyArray<RegisteredTurnHook<Fn>> {
  return [...map.entries()]
    .sort(([, a], [, b]) => b.priority - a.priority || a.order - b.order)
    .map(([id, entry]) => ({ id, priority: entry.priority, fn: entry.fn }));
}

// ---------------------------------------------------------------------------
// defineSystem
// ---------------------------------------------------------------------------

/**
 * Define a game system and return its SystemModule.
 *
 * REQ-SYS-001: Exposed entry point for system packages.
 * REQ-SYS-002: Manifest is validated by Zod; invalid manifest throws.
 */
export function defineSystem(
  manifest: SystemManifest,
  build: (registrar: SystemRegistrar) => void,
): SystemModule {
  // Validate manifest
  const parseResult = SystemManifestSchema.safeParse(manifest);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    const path = firstIssue?.path.join(".") ?? "(root)";
    const msg = firstIssue?.message ?? "unknown";
    throw new Error(
      `[defineSystem] Invalid SystemManifest for system "${manifest.id}": field "${path}" — ${msg}`,
    );
  }

  const validManifest = parseResult.data;
  const acc: RegistrarAccumulator = {
    models: [],
    initiativeFormulas: new Map<string, InitiativeFormulaFn>(),
    initiativeCompares: new Map<string, InitiativeCompareFn>(),
    combatHooks: null,
    deriveSteps: new DeriveStepRegistry(),
    extended: emptyExtendedAccumulator(),
    onTurnStart: new Map(),
    onTurnEnd: new Map(),
    onRoundStart: new Map(),
    onRoundEnd: new Map(),
    onCombatEnd: new Map(),
    onDamageApplied: new Map(),
    actorMechanics: null,
  };

  // Monotonic counter shared by every turn-hook event — only used to
  // tie-break equal priorities WITHIN one event's own map (REQ-SYS-139), so a
  // single shared counter is equivalent to (and simpler than) six separate
  // per-event counters.
  let hookOrder = 0;
  const nextHookOrder = (): number => hookOrder++;

  const registrar: SystemRegistrar = {
    defineModel<S extends ZodType>(spec: SystemDataModelSpec<S>): void {
      const base = {
        documentType: spec.documentType,
        subtype: spec.subtype,
        schema: spec.schema,
        migrations: spec.migrations ?? [],
      };
      const model: SystemDataModel =
        spec.defaults !== undefined ? { ...base, defaults: spec.defaults } : base;
      acc.models.push(model);
    },

    derive(step: DeriveStep): void {
      acc.deriveSteps.add(step);
    },

    sheet(spec: SystemSheetSpec): void {
      const id = `${spec.documentType}:${spec.subtypes.join(",")}:${spec.label}`;
      acc.extended.sheets.push({ ...spec, id });
    },

    condition(def: ConditionDefinition): void {
      if (acc.extended.conditions.has(def.slug)) {
        throw new Error(
          `[defineSystem] system "${manifest.id}" registered duplicate condition slug "${def.slug}"`,
        );
      }
      acc.extended.conditions.set(def.slug, def);
    },

    action(def: ActionDefinition): void {
      if (acc.extended.actions.has(def.slug)) {
        throw new Error(
          `[defineSystem] system "${manifest.id}" registered duplicate action slug "${def.slug}"`,
        );
      }
      acc.extended.actions.set(def.slug, def);
    },

    chatCard(def: ChatCardDefinition): void {
      if (acc.extended.chatCards.has(def.cardType)) {
        throw new Error(
          `[defineSystem] system "${manifest.id}" registered duplicate chatCard type "${def.cardType}"`,
        );
      }
      acc.extended.chatCards.set(def.cardType, def);
    },

    setting<S extends ZodType>(def: SettingDefinition<S>): void {
      if (acc.extended.settings.has(def.key)) {
        throw new Error(
          `[defineSystem] system "${manifest.id}" registered duplicate setting key "${def.key}"`,
        );
      }
      // Erase the generic type parameter for storage
      const erased: ErasedSettingDefinition = {
        key: def.key,
        scope: def.scope,
        schema: def.schema,
        default: def.default,
        label: def.label,
        hint: def.hint,
        requiresReload: def.requiresReload,
        requiresConfirmOnDisable: def.requiresConfirmOnDisable,
        countAffectedActors: def.countAffectedActors?.bind(def),
        onChange:
          def.onChange !== undefined
            ? (value: unknown) => {
                def.onChange?.(value);
              }
            : undefined,
      };
      acc.extended.settings.set(def.key, erased);
    },

    stackingRules(table: StackingTable): void {
      acc.extended.stackingTable = table;
    },

    rollData(def: RollDataDefinition): void {
      const id = rollDataId(def.documentType, def.subtypes);
      const overlap = acc.extended.rollData.find((existing) => rollDataOverlaps(existing, def));
      if (overlap) {
        throw new Error(
          `[defineSystem] system "${manifest.id}" registered overlapping rollData builders for documentType "${def.documentType}" (subtypes: [${def.subtypes.join(", ")}] vs [${overlap.subtypes.join(", ")}])`,
        );
      }
      acc.extended.rollData.push({ ...def, id });
    },

    degreeOfSuccess(def: DegreeOfSuccessDefinition): void {
      if (acc.extended.degreeOfSuccess.has(def.id)) {
        throw new Error(
          `[defineSystem] system "${manifest.id}" registered duplicate degreeOfSuccess id "${def.id}"`,
        );
      }
      acc.extended.degreeOfSuccess.set(def.id, def);
    },

    effectsMaterializer(def: EffectsMaterializerDefinition): void {
      const id = rollDataId(def.documentType, def.subtypes);
      const overlap = acc.extended.effectsMaterializers.find((existing) =>
        rollDataOverlaps(existing, def),
      );
      if (overlap) {
        throw new Error(
          `[defineSystem] system "${manifest.id}" registered overlapping effectsMaterializer for documentType "${def.documentType}" (subtypes: [${def.subtypes.join(", ")}] vs [${overlap.subtypes.join(", ")}])`,
        );
      }
      acc.extended.effectsMaterializers.push({ ...def, id });
    },

    registerInitiativeFormula(combatType: string, input: InitiativeFormulaRegistrationInput): void {
      if (combatType.length === 0) {
        throw new Error(
          `[defineSystem] registerInitiativeFormula for "${manifest.id}": combatType must be a non-empty string`,
        );
      }
      if (acc.initiativeFormulas.has(combatType)) {
        throw new Error(
          `[defineSystem] system "${manifest.id}" registered two initiative formulas for combatType "${combatType}"`,
        );
      }
      // Accept both forms (M5-A E3): a bare fn (legacy — PF2e/SF2e, stored
      // exactly as before) or { roll, compare? } (new — compare stored in
      // the separate, sparse initiativeCompares map).
      if (isInitiativeFormulaRegistrationObject(input)) {
        acc.initiativeFormulas.set(combatType, input.roll);
        if (input.compare !== undefined) {
          acc.initiativeCompares.set(combatType, input.compare);
        }
      } else {
        acc.initiativeFormulas.set(combatType, input);
      }
    },

    registerCombatHooks(hooks: CombatSystemHooks): void {
      if (acc.combatHooks !== null) {
        throw new Error(
          `[defineSystem] system "${manifest.id}" called registerCombatHooks more than once`,
        );
      }
      acc.combatHooks = hooks;

      // REQ-SYS-141: registerCombatHooks is an ADAPTER — each present
      // function becomes one entry in the corresponding DEC-SYS-11 registry
      // with id "legacy" and priority 0. CombatSystemHooks has no
      // roundEnd/combatEnd equivalent, so only these three are adapted. The
      // wrapper drops the new TurnHookContext argument: the legacy signature
      // never had one.
      //
      // Called via `hooks.turnStart?.(...)` (never extracted to a bare local)
      // so @typescript-eslint/unbound-method has nothing to flag — same
      // "call through the object, don't detach the method" convention as
      // registries.ts's `def.onChange?.(value)`.
      if (hooks.turnStart) {
        registerHook<TurnHookFn>(
          acc.onTurnStart,
          manifest.id,
          "onTurnStart",
          "legacy",
          (e) => hooks.turnStart?.(e.combatant, e.combat),
          { priority: 0 },
          nextHookOrder,
        );
      }
      if (hooks.turnEnd) {
        registerHook<TurnHookFn>(
          acc.onTurnEnd,
          manifest.id,
          "onTurnEnd",
          "legacy",
          (e) => hooks.turnEnd?.(e.combatant, e.combat),
          { priority: 0 },
          nextHookOrder,
        );
      }
      if (hooks.roundStart) {
        registerHook<RoundHookFn>(
          acc.onRoundStart,
          manifest.id,
          "onRoundStart",
          "legacy",
          (e) => hooks.roundStart?.(e.combat),
          { priority: 0 },
          nextHookOrder,
        );
      }
    },

    onTurnStart(id: string, fn: TurnHookFn, opts?: { priority?: number }): void {
      registerHook(acc.onTurnStart, manifest.id, "onTurnStart", id, fn, opts, nextHookOrder);
    },

    onTurnEnd(id: string, fn: TurnHookFn, opts?: { priority?: number }): void {
      registerHook(acc.onTurnEnd, manifest.id, "onTurnEnd", id, fn, opts, nextHookOrder);
    },

    onRoundStart(id: string, fn: RoundHookFn, opts?: { priority?: number }): void {
      registerHook(acc.onRoundStart, manifest.id, "onRoundStart", id, fn, opts, nextHookOrder);
    },

    onRoundEnd(id: string, fn: RoundHookFn, opts?: { priority?: number }): void {
      registerHook(acc.onRoundEnd, manifest.id, "onRoundEnd", id, fn, opts, nextHookOrder);
    },

    onCombatEnd(id: string, fn: CombatEndHookFn, opts?: { priority?: number }): void {
      registerHook(acc.onCombatEnd, manifest.id, "onCombatEnd", id, fn, opts, nextHookOrder);
    },

    onDamageApplied(id: string, fn: DamageAppliedHookFn, opts?: { priority?: number }): void {
      registerHook(
        acc.onDamageApplied,
        manifest.id,
        "onDamageApplied",
        id,
        fn,
        opts,
        nextHookOrder,
      );
    },

    registerActorMechanics(mechanics: ActorMechanics): void {
      if (acc.actorMechanics !== null) {
        throw new Error(
          `[defineSystem] system "${manifest.id}" called registerActorMechanics more than once`,
        );
      }
      acc.actorMechanics = mechanics;
    },
  };

  build(registrar);

  const modelsMap = new Map<string, SystemDataModel>();
  for (const model of acc.models) {
    modelsMap.set(modelKey(model.documentType, model.subtype), model);
  }

  const turnHooks: TurnHookRegistrations = {
    onTurnStart: sortHookMap(acc.onTurnStart),
    onTurnEnd: sortHookMap(acc.onTurnEnd),
    onRoundStart: sortHookMap(acc.onRoundStart),
    onRoundEnd: sortHookMap(acc.onRoundEnd),
    onCombatEnd: sortHookMap(acc.onCombatEnd),
    onDamageApplied: sortHookMap(acc.onDamageApplied),
  };

  const combat: SystemCombatConfig = {
    initiativeFormulas: acc.initiativeFormulas,
    initiativeCompares: acc.initiativeCompares,
    hooks: acc.combatHooks,
    turnHooks,
  };

  const registries: ExtendedSystemRegistries = {
    sheets: acc.extended.sheets,
    conditions: acc.extended.conditions,
    actions: acc.extended.actions,
    chatCards: acc.extended.chatCards,
    settings: acc.extended.settings,
    stackingTable: acc.extended.stackingTable,
    rollData: acc.extended.rollData,
    degreeOfSuccess: acc.extended.degreeOfSuccess,
    effectsMaterializers: acc.extended.effectsMaterializers,
  };

  return {
    manifest: validManifest,
    models: modelsMap,
    combat,
    actorMechanics: acc.actorMechanics,
    deriveSteps: acc.deriveSteps,
    registries,
  };
}
