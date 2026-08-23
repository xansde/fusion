/**
 * Derive runner — bridges SystemModule.deriveSteps to the server's
 * authoritative document pipeline.
 *
 * WIRING-DERIVE batch: connects the M3-C derivation pipeline (topological
 * DeriveStep sort + effects engine) — which existed in system-api/systems/*
 * but was never invoked anywhere in production — to doc:create / doc:update /
 * embedded handlers and the join snapshot.
 *
 * Design (system-agnostic — works for pf2e, sf2e, and future systems without
 * any system-specific import here):
 *
 *   1. Resolve the DeriveSteps registered for (documentType="Actor", subtype)
 *      from `SystemModule.deriveSteps`. If none are registered, this is a
 *      no-op (e.g. subtype has no derivation, or the active system doesn't
 *      derive at all — the stub system, for instance).
 *   2. Run "base" phase steps (pure functions over the doc).
 *   3. Materialize EffectSources generically from the actor's embedded
 *      Condition items (`doc.items[]` where `type === "condition"`), using
 *      `SystemModule.registries.conditions` (the generic ConditionDefinition
 *      registry — REQ-SYS-043) to resolve each condition's effect rules and
 *      substitute valued-condition placeholders. This mirrors exactly what
 *      pf2e's `conditionToEffectSource` / sf2e's equivalent do internally,
 *      but without importing either system package (keeps this module usable
 *      for any system that registers conditions the standard way).
 *   4. Run `collectEffects` (from @fusion/engine-2e) to build Synthetics.
 *   5. Run "derived" phase steps with the populated Synthetics + rollOptions.
 *
 * CONTRACT (corrected — audit issue 5): the PERSISTED/broadcast contract is
 * "only `doc.system.derived` is ever read back out and written to storage".
 * Authored fields (system.attributes.*, system.saves.*, etc.) are never
 * persisted with a different value — the existing "not re-derived" tests
 * (e2e-dod-m3.test.ts, boot-compendium*.test.ts) assert exactly this for
 * compendium-served documents, which this runner does not touch at all
 * (compendium:get serves raw pack data, no doc:create/update round-trip).
 *
 * This is NOT the same as "only `doc.system.derived` is ever mutated in
 * memory" — several system DeriveSteps (e.g. pf2e/sf2e's
 * stepCharAbilityMods) also mirror a computed value onto a sibling authored
 * field for a LATER step's own consumption within the same run (e.g.
 * `system.abilities.<ability>.mod`, read back by stepCharStrikes). Callers
 * MUST therefore pass a doc whose `system` subtree is a deep, disposable
 * clone (see doc-handlers.ts recomputeDerivedIfNeeded, sync-handlers.ts
 * buildSnapshot, combat-handlers.ts rollInitiative) — never the object as
 * read from the store — and must only read `system.derived` back out of the
 * result. A shallow clone of `system` is NOT sufficient: it still shares
 * nested objects like `system.abilities.str` by reference with the original.
 *
 * PERFORMANCE: DeriveStep.run() is required to be synchronous and I/O-pure
 * (REQ-SYS-024); collectEffects is also pure over its inputs. No I/O is
 * performed here beyond object traversal — safe to call on every Actor
 * create/update.
 *
 * EFFECTS MATERIALIZATION (M5-A / E4): this module's DEFAULT/FALLBACK path
 * hardcodes 2e semantics — it imports collectEffects from @fusion/engine-2e
 * directly and materializes the "template value -1 = placeholder" condition
 * convention inline (resolveConditionModifierValue). That is correct for
 * pf2e/sf2e (both 2e-family systems sharing engine-2e), but a future
 * non-2e-family system would need a different (or no) effects-materialization
 * pipeline.
 *
 * Since M5-A, a system can register its OWN materializer via
 * `registrar.effectsMaterializer({ documentType, subtypes, build(doc) })`
 * (system-api `registries.ts`/`system-module.ts`) — exposed as
 * `SystemModule.registries.effectsMaterializers`. This runner PREFERS a
 * registered materializer that matches the doc's (documentType, subtype)
 * over the 2e-family fallback below. When no materializer matches, the
 * fallback (collectEffects + actorConditionsToEffectSources) runs exactly as
 * before M5-A — pf2e/sf2e do not register one, so their behaviour is
 * byte-for-byte unchanged. A future system may register its own materializer,
 * overriding the fallback entirely for its Actor subtypes.
 */

import { collectEffects, type EffectSource } from "@fusion/engine-2e";
import { emptySynthetics } from "@fusion/system-api";
import type {
  ConditionDefinition,
  DeriveContext,
  EffectRule,
  FlatModifierRule,
  RegisteredEffectsMaterializer,
  SystemModule,
} from "@fusion/system-api";

// ---------------------------------------------------------------------------
// Generic condition → EffectSource materialization
// ---------------------------------------------------------------------------

/** Minimal shape of an embedded Condition item read from doc.items[]. */
interface EmbeddedConditionItem {
  readonly type?: unknown;
  readonly system?: {
    readonly slug?: unknown;
    readonly value?: unknown;
  };
}

/**
 * Resolve a valued condition's placeholder FlatModifier value.
 *
 * Mirrors the semantics used identically by pf2e's and sf2e's
 * `resolveConditionModifierValue`: a template value of exactly -1 is a
 * placeholder meaning "engine applies -X where X = condition.value";
 * any other template value is used verbatim (not valued, or a non-standard
 * fixed modifier).
 */
function resolveConditionModifierValue(conditionValue: number, templateValue: number): number {
  if (templateValue === -1) {
    return -conditionValue;
  }
  return templateValue;
}

/**
 * Convert one embedded ConditionDefinition + stored value into an
 * EffectSource, generically (system-agnostic — driven entirely by the
 * SystemModule's condition registry).
 */
function conditionToEffectSource(
  slug: string,
  storedValue: number | null,
  conditionDefs: ReadonlyMap<string, ConditionDefinition>,
): EffectSource | null {
  const condDef = conditionDefs.get(slug);
  if (!condDef) return null;

  const isValued = condDef.valued === true && storedValue !== null;
  const baseEffects = condDef.effects ?? [];

  const rules: EffectRule[] = baseEffects.map((rule) => {
    if (rule.type === "flatModifier" && isValued) {
      const fm = rule as FlatModifierRule;
      const templateValue = typeof fm.value === "number" ? fm.value : 0;
      const resolved = resolveConditionModifierValue(storedValue, templateValue);
      return { ...fm, value: resolved };
    }
    return rule;
  });

  if (isValued) {
    rules.push({ type: "rollOption", domain: "all", option: `${slug}:${String(storedValue)}` });
  }

  const label = isValued ? `${condDef.label} ${String(storedValue)}` : condDef.label;

  return {
    sourceId: `condition:${slug}`,
    label,
    active: true,
    rules,
  };
}

/**
 * Materialize every embedded Condition item on an Actor doc into
 * EffectSources, using the system's registered ConditionDefinitions.
 *
 * Unknown slugs (not registered by the system) and non-condition items are
 * silently skipped — this mirrors the FALLBACK behaviour used throughout the
 * effects pipeline (REQ-SYS-082).
 */
function actorConditionsToEffectSources(
  doc: Record<string, unknown>,
  conditionDefs: ReadonlyMap<string, ConditionDefinition>,
): EffectSource[] {
  const rawItems = doc["items"];
  if (!Array.isArray(rawItems)) return [];

  const sources: EffectSource[] = [];
  for (const raw of rawItems as EmbeddedConditionItem[]) {
    if (raw.type !== "condition") continue;
    const slug = raw.system?.slug;
    if (typeof slug !== "string" || slug.length === 0) continue;
    const rawValue = raw.system?.value;
    const value = typeof rawValue === "number" ? rawValue : null;
    const src = conditionToEffectSource(slug, value, conditionDefs);
    if (src) sources.push(src);
  }
  return sources;
}

/**
 * Resolve the registered effects materializer matching a (documentType,
 * subtype) pair, if any. Mirrors the overlap semantics used at registration
 * time (system-module.ts `rollDataOverlaps`): an empty `subtypes` array on
 * the registration means "all subtypes of this documentType".
 *
 * M5-A E4 — this is the ONLY place that decides between a system's own
 * materializer and the 2e-family fallback.
 */
function findEffectsMaterializer(
  materializers: readonly RegisteredEffectsMaterializer[],
  documentType: string,
  subtype: string,
): RegisteredEffectsMaterializer | null {
  for (const m of materializers) {
    if (m.documentType !== documentType) continue;
    if (m.subtypes.length === 0 || m.subtypes.includes(subtype)) return m;
  }
  return null;
}

/**
 * Materialize EffectSources for an Actor doc, preferring a system-registered
 * materializer (M5-A E4) over the 2e-family fallback.
 *
 * - A registered materializer's `GenericEffectSource[]` output is
 *   structurally compatible with `@fusion/engine-2e`'s `EffectSource[]`
 *   (same shape — see `GenericEffectSource` docstring in system-api
 *   registries.ts) so it can be fed directly into `collectEffects` below.
 * - When no materializer matches, falls back to
 *   `actorConditionsToEffectSources` + `collectEffects`, IDENTICAL to the
 *   pre-M5-A behaviour (pf2e/sf2e never register a materializer).
 */
function materializeEffectSources(
  doc: Record<string, unknown>,
  systemModule: SystemModule,
  subtype: string,
): EffectSource[] {
  const materializer = findEffectsMaterializer(
    systemModule.registries.effectsMaterializers,
    "Actor",
    subtype,
  );
  if (materializer) {
    // GenericEffectSource is structurally identical to EffectSource (see the
    // GenericEffectSource docstring in system-api registries.ts) — no cast
    // needed, TypeScript accepts it directly via structural typing.
    return materializer.build(doc);
  }
  return actorConditionsToEffectSources(doc, systemModule.registries.conditions);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine the Actor subtype for a doc (falls back to "" when absent —
 * matches DeriveStep.subtypes semantics where [] means "all subtypes", but a
 * doc without a `type` field simply won't match any subtype-scoped step).
 */
function actorSubtype(doc: Record<string, unknown>): string {
  const type = doc["type"];
  return typeof type === "string" ? type : "";
}

/**
 * Run the full derivation pipeline (base → effects → derived) for a single
 * Actor document, mutating `doc.system.derived` in place.
 *
 * Returns `true` when derivation actually ran (steps were registered for
 * this subtype), `false` when it was a no-op (unknown subtype, non-Actor
 * doc, or a system with no derivation steps registered — e.g. stub system).
 *
 * Safe to call unconditionally on every Actor create/update: the no-op path
 * is a single Map lookup plus an empty-array topoSort (cheap).
 */
export function runActorDerivation(
  doc: Record<string, unknown>,
  systemModule: SystemModule,
): boolean {
  const subtype = actorSubtype(doc);
  if (subtype.length === 0) return false;

  const baseSteps = systemModule.deriveSteps.sortedForPhase("base", "Actor", subtype);
  const derivedSteps = systemModule.deriveSteps.sortedForPhase("derived", "Actor", subtype);
  if (baseSteps.length === 0 && derivedSteps.length === 0) return false;

  // Ensure system.derived exists as an object before any step reads it back
  // (steps that read `system.derived.*` in "reads" but run before it's ever
  // been created otherwise see undefined, which every step already guards).
  const sys = doc["system"];
  if (!sys || typeof sys !== "object") {
    doc["system"] = {};
  }

  const baseCtx: DeriveContext = {
    system: systemModule,
    synthetics: emptySynthetics(),
    rollOptions: new Set<string>(),
  };

  for (const step of baseSteps) {
    step.run(doc, baseCtx);
  }

  const effectSources = materializeEffectSources(doc, systemModule, subtype);
  const { synthetics } = collectEffects(effectSources, new Set<string>());

  const rollOptions = new Set<string>();
  for (const opts of Object.values(synthetics.rollOptions)) {
    for (const opt of opts) rollOptions.add(opt);
  }

  const derivedCtx: DeriveContext = {
    system: systemModule,
    synthetics,
    rollOptions,
  };

  for (const step of derivedSteps) {
    step.run(doc, derivedCtx);
  }

  return true;
}
