/**
 * SystemModule, SystemRegistrar, and defineSystem.
 *
 * REQ-SYS-001: defineSystem(manifest, build) returns SystemModule.
 * REQ-SYS-010: SystemRegistrar.defineModel registers a SystemDataModel.
 * REQ-SYS-011: Every subtype in documentTypes must have a model registered.
 */
import type { z, ZodType } from "zod";
import type { InitiativeFormulaFn } from "@fusion/shared";
import { type SystemManifest, SystemManifestSchema, type DocumentType } from "./manifest.js";
import type { CombatRegistrar, CombatSystemHooks, SystemCombatConfig } from "./combat.js";

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
}

/**
 * The build-time registrar passed to a system's defineSystem(build) callback.
 *
 * Extends the data-model registrar with the combat registration surface
 * (CombatRegistrar) so systems declare initiative formulas + lifecycle hooks
 * alongside their data models.
 */
export interface SystemRegistrar extends CombatRegistrar {
  /**
   * Register a data model (Zod schema) for a (documentType, subtype) pair.
   * REQ-SYS-010
   */
  defineModel<S extends ZodType>(spec: SystemDataModelSpec<S>): void;
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

  return {
    manifest: validManifest,
    models: modelsMap,
    combat,
  };
}
