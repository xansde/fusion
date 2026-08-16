/**
 * settings:declarations — the door the Configurações tab's Mundo section reads
 * its rows through (spec 37 §5.4, REQ-CFG-030/031, RNF-CFG-02, DEC-SYS-08).
 *
 * The settings ENGINE already exists (`SystemRegistrar.setting`, REQ-SYS-047) —
 * this handler never re-defines it, only hands the client what the active
 * system declared with escopo `world`, PLUS whatever value a GM already wrote
 * (a `Setting` document, REQ-CFG-071). The client package cannot import a
 * game system (only the server resolves one, per world), so without this door
 * the Mundo section would have no schema to render from at all.
 *
 * Genericity (REQ-CFG-031, RNF-CFG-02) is structural, not a promise kept by
 * discipline: this handler iterates `systemModule.registries.settings` — it
 * has no branch keyed on any one setting's `key`, so a brand-new declaration
 * (any system, any mod later) shows up the moment it is registered, with zero
 * lines changed here. The only per-schema knowledge this file has is turning
 * a Zod type into one of the THREE shapes REQ-CFG-030 names (boolean/enum/
 * number) — that classification reads `schema` structurally (instanceof
 * checks against Zod's own classes), never a system id or a setting key.
 *
 * `scope !== "world"` declarations (REQ-SYS-047 also allows `"user"`/
 * `"client"`) are filtered out here: this door serves the Mundo section only
 * (Q-CFG-01 tracks where `user`-scope settings will live).
 */

import { z, type ZodTypeAny } from "zod";
import type { HandlerFn } from "../handler-registry.js";

// ---------------------------------------------------------------------------
// Schema → render-kind classification
// ---------------------------------------------------------------------------

/** The three shapes REQ-CFG-030 names. Anything else does not render (yet). */
export type SettingRenderKind = "boolean" | "enum" | "number" | "unsupported";

/** Unwrap the optional/default/nullable wrappers a declaration may carry. */
function unwrapSchema(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodDefault) {
      current = current._def.innerType as ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap();
      continue;
    }
    return current;
  }
}

/**
 * Classify a declared setting's Zod schema into what the tab can draw
 * (REQ-CFG-030). Reads the schema's own shape only — never a key or a
 * system id — which is what makes REQ-CFG-031 (no system knowledge in the
 * tab's code) hold on the server side of this door too.
 */
export function classifySettingSchema(schema: ZodTypeAny): {
  kind: SettingRenderKind;
  options?: string[];
} {
  const inner = unwrapSchema(schema);
  if (inner instanceof z.ZodBoolean) return { kind: "boolean" };
  if (inner instanceof z.ZodNumber) return { kind: "number" };
  if (inner instanceof z.ZodEnum) return { kind: "enum", options: [...inner.options] };
  return { kind: "unsupported" };
}

// ---------------------------------------------------------------------------
// Wire contract
// ---------------------------------------------------------------------------

export interface WorldSettingDeclaration {
  /** `Setting` document `_id` if a GM already wrote a value, else `null` (create on first write). */
  id: string | null;
  /** Namespaced by the declaring system (REQ-CFG-071), e.g. `"pf2e:freeArchetype"`. */
  key: string;
  kind: Exclude<SettingRenderKind, "unsupported">;
  /** Present only when `kind === "enum"`. */
  options?: string[];
  label: string;
  hint?: string;
  requiresReload?: boolean;
  /** The stored value, or the declared default when nothing was written yet. */
  value: unknown;
}

export interface SettingsDeclarationsResult {
  /** Id of the world's active system, or `null` when no system is resolved. */
  systemId: string | null;
  settings: WorldSettingDeclaration[];
}

export type SettingsDeclarationsPayload = Record<string, never>;

// ---------------------------------------------------------------------------
// Sources this handler reads — narrowed to keep it testable without a real
// SystemModule or a real DocumentStore (mirrors ConditionRegistrySource in
// system.ts).
// ---------------------------------------------------------------------------

export interface ErasedSettingDefinitionLike {
  key: string;
  scope: "world" | "user" | "client";
  schema: ZodTypeAny;
  default: unknown;
  label: string;
  // `exactOptionalPropertyTypes: true`: matches `ErasedSettingDefinition`'s own
  // shape (registries.ts) so the real SystemModule assigns here structurally.
  hint?: string | undefined;
  requiresReload?: boolean | undefined;
}

export interface SettingsRegistrySource {
  manifest: { id: string };
  registries: {
    settings: ReadonlyMap<string, ErasedSettingDefinitionLike>;
  };
}

/** Just enough of `DocumentStore` to read persisted `Setting` documents. */
export interface SettingsStoreSource {
  getAll(table: "settings"): Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Index stored `Setting` documents (`{ _id, key, value }`) by their `key`. */
function indexStoredSettings(
  store: SettingsStoreSource,
): Map<string, { id: string; value: unknown }> {
  const byKey = new Map<string, { id: string; value: unknown }>();
  for (const doc of store.getAll("settings")) {
    const id = doc["_id"];
    const key = doc["key"];
    if (typeof id !== "string" || typeof key !== "string") continue;
    byKey.set(key, { id, value: doc["value"] });
  }
  return byKey;
}

/**
 * `settings:declarations` — hand the client the active system's world-scope
 * setting declarations, each already carrying its current value (REQ-CFG-030,
 * RNF-CFG-02).
 *
 * No role gate, on purpose: like `system:conditions`, this is read of static
 * (well, GM-written) declared data, not a write — the write path (doc:create/
 * doc:update of `Setting`) is what REQ-CFG-070 actually gates. The tab hides
 * the Mundo section from non-privileged seats at the index (REQ-CFG-005), but
 * that is ergonomics, not the boundary (REQ-GAV-034).
 *
 * A world whose system registered nothing (or that has no system at all)
 * answers with an empty list, never an error — same degrade-open shape as
 * `system:conditions`.
 */
export function buildSettingsDeclarationsHandler(
  systemModule?: SettingsRegistrySource,
  store?: SettingsStoreSource,
): HandlerFn<SettingsDeclarationsPayload, SettingsDeclarationsResult> {
  return () => {
    if (!systemModule) {
      return { ok: true, result: { systemId: null, settings: [] } };
    }
    const storedByKey = store
      ? indexStoredSettings(store)
      : new Map<string, { id: string; value: unknown }>();
    const settings: WorldSettingDeclaration[] = [];

    for (const def of systemModule.registries.settings.values()) {
      if (def.scope !== "world") continue;
      const classification = classifySettingSchema(def.schema);
      if (classification.kind === "unsupported") continue;

      const key = `${systemModule.manifest.id}:${def.key}`;
      const stored = storedByKey.get(key);
      const entry: WorldSettingDeclaration = {
        id: stored?.id ?? null,
        key,
        kind: classification.kind,
        label: def.label,
        value: stored ? stored.value : def.default,
      };
      if (classification.options !== undefined) entry.options = classification.options;
      if (def.hint !== undefined) entry.hint = def.hint;
      if (def.requiresReload !== undefined) entry.requiresReload = def.requiresReload;
      settings.push(entry);
    }

    return { ok: true, result: { systemId: systemModule.manifest.id, settings } };
  };
}
