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
import type { CombatRegistrar, CombatSystemHooks, SystemCombatConfig } from "./combat.js";
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

/** Internal accumulator filled during defineSystem build callback. */
interface RegistrarAccumulator {
  models: SystemDataModel[];
  initiativeFormulas: Map<string, InitiativeFormulaFn>;
  combatHooks: CombatSystemHooks | null;
  deriveSteps: DeriveStepRegistry;
  extended: ExtendedAccumulator;
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
   * stacking table.
   *
   * REQ-SYS-040..047 / REQ-SYS-085.
   */
  readonly registries: ExtendedSystemRegistries;
}

function modelKey(documentType: string, subtype: string): string {
  return `${documentType}:${subtype}`;
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
    combatHooks: null,
    deriveSteps: new DeriveStepRegistry(),
    extended: emptyExtendedAccumulator(),
  };

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

    registerInitiativeFormula(combatType: string, fn: InitiativeFormulaFn): void {
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
      acc.initiativeFormulas.set(combatType, fn);
    },

    registerCombatHooks(hooks: CombatSystemHooks): void {
      if (acc.combatHooks !== null) {
        throw new Error(
          `[defineSystem] system "${manifest.id}" called registerCombatHooks more than once`,
        );
      }
      acc.combatHooks = hooks;
    },
  };

  build(registrar);

  const modelsMap = new Map<string, SystemDataModel>();
  for (const model of acc.models) {
    modelsMap.set(modelKey(model.documentType, model.subtype), model);
  }

  const combat: SystemCombatConfig = {
    initiativeFormulas: acc.initiativeFormulas,
    hooks: acc.combatHooks,
  };

  const registries: ExtendedSystemRegistries = {
    sheets: acc.extended.sheets,
    conditions: acc.extended.conditions,
    actions: acc.extended.actions,
    chatCards: acc.extended.chatCards,
    settings: acc.extended.settings,
    stackingTable: acc.extended.stackingTable,
  };

  return {
    manifest: validManifest,
    models: modelsMap,
    combat,
    deriveSteps: acc.deriveSteps,
    registries,
  };
}
