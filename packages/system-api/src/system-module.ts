/**
 * SystemModule, SystemRegistrar, and defineSystem.
 *
 * REQ-SYS-001: defineSystem(manifest, build) returns SystemModule.
 * REQ-SYS-010: SystemRegistrar.defineModel registers a SystemDataModel.
 * REQ-SYS-011: Every subtype in documentTypes must have a model registered.
 */
import type { z, ZodType } from "zod";
import { type SystemManifest, SystemManifestSchema, type DocumentType } from "./manifest.js";

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
}

export interface SystemRegistrar {
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
  const acc: RegistrarAccumulator = { models: [] };

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
  };

  build(registrar);

  const modelsMap = new Map<string, SystemDataModel>();
  for (const model of acc.models) {
    modelsMap.set(modelKey(model.documentType, model.subtype), model);
  }

  return {
    manifest: validManifest,
    models: modelsMap,
  };
}
