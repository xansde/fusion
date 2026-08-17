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
import type { Ack } from "@fusion/shared";
import type { HandlerContext, HandlerFn } from "../handler-registry.js";
import { isGamemasterStrict } from "../../documents/ownership.js";
import {
  DEFAULT_PERMISSION_MIN_ROLE,
  findPermissionsSettingId,
  PERMISSION_KEYS,
  resolvePermissionMinRole,
  type PermissionsStoreSource,
} from "../../documents/world-permissions.js";

// ---------------------------------------------------------------------------
// Ack helpers
// ---------------------------------------------------------------------------

function ackError(code: string, message: string): Ack<never> {
  return { ok: false, code: code as never, message };
}

/**
 * REQ-GAV-034, DEC-CFG-05, REQ-CFG-070: the three queries in this file are
 * the door the Mundo and Permissões sections read through, and DEC-CFG-05
 * says "só GAMEMASTER" for both — the "quem vê" column, not just "quem
 * escreve". The rail hiding these sections from a player is ergonomics
 * (REQ-CFG-005), never the boundary; every door that hands back data those
 * sections own gates the same way the write path already does
 * (`isGamemasterStrict` in `doc-handlers.ts`'s `Setting` guard), imported
 * from the single source in `documents/ownership.ts` so the two doors can
 * never drift on which threshold applies.
 */
function requireGamemasterStrict(ctx: HandlerContext): Ack<never> | null {
  if (isGamemasterStrict(ctx.role)) return null;
  return ackError("PERMISSION_DENIED", "Only the Gamemaster can read this configuration data");
}

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
      current = current.unwrap() as ZodTypeAny;
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
  if (inner instanceof z.ZodEnum) {
    const options: string[] = [...(inner.options as string[])];
    return { kind: "enum", options };
  }
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
  /**
   * REQ-CFG-082: when true, the tab must ask "how many actors are affected"
   * (via `settings:impact`) and confirm before turning this OFF; turning it
   * on never confirms.
   */
  requiresConfirmOnDisable?: boolean;
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
  requiresConfirmOnDisable?: boolean | undefined;
  /** REQ-CFG-082: server-only, never serialized — see `buildSettingsImpactHandler`. */
  countAffectedActors?: ((actors: readonly Record<string, unknown>[]) => number) | undefined;
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

/** Just enough of `DocumentStore` to read persisted `Actor` documents. */
export interface SettingsActorStoreSource {
  getAll(table: "actors"): Record<string, unknown>[];
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
 * GAMEMASTER-strict gate (REQ-GAV-034, DEC-CFG-05, spec 37 §8 item 6): the
 * Mundo section's rows are content only a GAMEMASTER may see, not just write
 * — REQ-CFG-070's "role === GAMEMASTER no servidor" covers "tudo que é da
 * mesa", and REQ-GAV-034 says explicitly that the trilho hiding a GM-group
 * tab is not the security boundary, so this door must enforce it itself. The
 * tab hiding the Mundo section from non-privileged seats at the index
 * (REQ-CFG-005) is ergonomics on top of this, never a substitute for it.
 *
 * A world whose system registered nothing (or that has no system at all)
 * answers with an empty list, never an error — same degrade-open shape as
 * `system:conditions` — but only once the requester has cleared the gate.
 */
export function buildSettingsDeclarationsHandler(
  systemModule?: SettingsRegistrySource,
  store?: SettingsStoreSource,
): HandlerFn<SettingsDeclarationsPayload, SettingsDeclarationsResult> {
  return (_payload, ctx) => {
    const denied = requireGamemasterStrict(ctx);
    if (denied) return denied;
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
      if (def.requiresConfirmOnDisable !== undefined) {
        entry.requiresConfirmOnDisable = def.requiresConfirmOnDisable;
      }
      settings.push(entry);
    }

    return { ok: true, result: { systemId: systemModule.manifest.id, settings } };
  };
}

// ---------------------------------------------------------------------------
// settings:impact (REQ-CFG-082) — how many actors a DISABLE would affect
// ---------------------------------------------------------------------------

const SettingsImpactPayloadSchema = z.object({
  /** The namespaced key exactly as `settings:declarations` handed it out. */
  key: z.string(),
});

export type SettingsImpactPayload = z.infer<typeof SettingsImpactPayloadSchema>;

export interface SettingsImpactResult {
  count: number;
}

/**
 * `settings:impact` — answers REQ-CFG-082's "quantos são afetados" for the
 * confirmation the Mundo section shows before turning a
 * `requiresConfirmOnDisable` setting off (Q-CFG-03: this handler is the
 * chosen answer to "quem conta" — computed on demand, only when the tab is
 * about to disable one such setting, never eagerly on every section open).
 *
 * Genericity holds the same way `settings:declarations` does (REQ-CFG-031):
 * this handler has no branch keyed on any setting's key or on any system id.
 * It strips the `<systemId>:` namespace prefix, looks up the ONE declaration
 * that key belongs to, and — only if that declaration registered its own
 * `countAffectedActors` — hands it the world's Actor documents and reports
 * back whatever number it returns. What "affected" means for a given setting
 * is entirely the declaring system's business.
 *
 * Degrades to `{ count: 0 }` (never an error) when: no system is resolved,
 * the key does not belong to this system, the key is not declared, or the
 * declaration never registered a counter — an unconfirmable setting simply
 * reports nothing to confirm.
 *
 * GAMEMASTER-strict gate (REQ-GAV-034, DEC-CFG-05): this query runs the
 * requested setting's `countAffectedActors` over EVERY actor in the world —
 * exactly the "quantos são afetados" the Mundo section's disable confirmation
 * shows, so it is Mundo-section content and gated the same as
 * `settings:declarations`, checked before the world is even touched.
 */
export function buildSettingsImpactHandler(
  systemModule?: SettingsRegistrySource,
  actorStore?: SettingsActorStoreSource,
): HandlerFn<unknown, SettingsImpactResult> {
  return (rawPayload, ctx) => {
    const denied = requireGamemasterStrict(ctx);
    if (denied) return denied;
    if (!systemModule) return { ok: true, result: { count: 0 } };

    const parsed = SettingsImpactPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return { ok: true, result: { count: 0 } };
    const { key } = parsed.data;

    const prefix = `${systemModule.manifest.id}:`;
    if (!key.startsWith(prefix)) return { ok: true, result: { count: 0 } };
    const localKey = key.slice(prefix.length);

    const def = systemModule.registries.settings.get(localKey);
    if (!def?.countAffectedActors) return { ok: true, result: { count: 0 } };

    const actors = actorStore ? actorStore.getAll("actors") : [];
    return { ok: true, result: { count: def.countAffectedActors(actors) } };
  };
}

// ---------------------------------------------------------------------------
// settings:permissions (REQ-USR-008/009, REQ-CFG-040..042) — the door the
// Configurações tab's Permissões section reads its rows through.
// ---------------------------------------------------------------------------

export interface SettingsPermissionRow {
  key: string;
  /** The floor actually enforced right now: a GM override, or the default. */
  minRole: number;
  /** The product's shipped default (REQ-CFG-041's "difere do default"). */
  defaultMinRole: number;
}

export interface SettingsPermissionsResult {
  /** `fusion.permissions` Setting document `_id`, or `null` — nothing written yet. */
  settingId: string | null;
  permissions: SettingsPermissionRow[];
}

export type SettingsPermissionsPayload = Record<string, never>;

/**
 * `settings:permissions` — REQ-CFG-040: one row per configurable Permission
 * (REQ-USR-008), never a matrix. Every key in `world-permissions.ts`'s
 * `PERMISSION_KEYS` becomes exactly one row; genericity here means this
 * handler has no per-key branch — it maps the array, nothing else — so a key
 * added to that module later shows up with zero lines touched here.
 *
 * GAMEMASTER-strict gate, same reasoning as `settings:declarations`
 * (REQ-GAV-034, DEC-CFG-05): the Permissões section is "só GAMEMASTER" for
 * reads too, not only for the write REQ-CFG-042/070/073 enforce via the
 * GAMEMASTER-strict guard on `Setting` writes in `doc-handlers.ts`. The tab
 * hiding the section from non-privileged seats at the index (REQ-CFG-005) is
 * ergonomics on top of this gate, never a substitute for it.
 */
export function buildSettingsPermissionsHandler(
  store?: PermissionsStoreSource,
): HandlerFn<SettingsPermissionsPayload, SettingsPermissionsResult> {
  return (_payload, ctx) => {
    const denied = requireGamemasterStrict(ctx);
    if (denied) return denied;
    const source: PermissionsStoreSource = store ?? { getAll: () => [] };
    const settingId = findPermissionsSettingId(source);
    const permissions: SettingsPermissionRow[] = PERMISSION_KEYS.map((key) => ({
      key,
      minRole: resolvePermissionMinRole(source, key),
      defaultMinRole: DEFAULT_PERMISSION_MIN_ROLE[key],
    }));
    return { ok: true, result: { settingId, permissions } };
  };
}
