/**
 * Resolves the two PF2e/SF2e-composite world-scope variant-rule settings
 * (multiclasse por níveis de classe / arquétipo livre — DEC-MCL-09) at the
 * one place every `runActorDerivation` call site needs the CURRENT value.
 *
 * Bug this fixes: DEC-MCL-09 (2026-08-15) moved both toggles from a
 * per-actor field (`system.build.variantRules.classLevels`,
 * `system.build.freeArchetype`) to a world-scope `Setting` document, and
 * REQ-CFG-033 stopped the ficha from ever writing that legacy actor field
 * again. But `resolveClassLevels` (`@fusion/engine-2e`,
 * `progression/levels.ts`) and the pf2e `freeArchetype` getter
 * (`systems/pf2e/src/index.ts`) still only ever read the ACTOR's own
 * `system.build.*` — never the world Setting — so a character built through
 * the UI after DEC-MCL-09 always derives as if BOTH variants were off, no
 * matter what the GM configured in Configurações → Mundo.
 *
 * The fix is not "make the derivation steps read the world setting" (they
 * are pure, doc-only functions by contract — REQ-SYS-024) but "overlay the
 * world's resolved value onto the doc's `system.build` before deriving",
 * which is exactly what `runActorDerivation`'s new `worldVariantRules`
 * parameter does. This module only resolves that value; it never mutates
 * anything.
 *
 * Storage format mirrors `settings-handlers.ts`'s `indexStoredSettings`: a
 * `Setting` document `{ _id, key, value }` in the `"settings"` table, keyed
 * `${systemModule.manifest.id}:variantRules.<name>` (REQ-CFG-071) — e.g.
 * `"pf2e:variantRules.classLevels"` on a pure PF2e world, or
 * `"pf2e-sf2e:variantRules.classLevels"` on a misto world (the composite
 * system unions pf2e's settings registry verbatim, so the key keeps pf2e's
 * local name but the composite's own manifest id as prefix).
 *
 * A key with no stored `Setting` document resolves to `false` — a GM who
 * never opened Configurações → Mundo means the setting sits at its
 * registered default (`false` for both, `systems/pf2e/src/index.ts`), not
 * "unknown". This is what makes the overlay safe to apply unconditionally:
 * it always produces a definite value, never `undefined`.
 */

/** Just enough of `DocumentStore` to read persisted `Setting` documents. */
export interface WorldVariantRulesStoreSource {
  getAll(table: "settings"): Record<string, unknown>[];
}

/** Just enough of a `SystemModule` to namespace the setting keys. */
export interface WorldVariantRulesSystemSource {
  manifest: { id: string };
}

/** The overlay `runActorDerivation` merges onto `doc.system.build`. */
export interface ResolvedWorldVariantRules {
  readonly classLevels: boolean;
  readonly freeArchetype: boolean;
}

/**
 * Resolve both variant-rule settings for the world's active system.
 *
 * Returns `{ classLevels: false, freeArchetype: false }` (the registered
 * defaults) when `store` or `systemModule` is missing — the same
 * degrade-open posture the rest of this module's callers already take for a
 * world with no system resolved.
 */
export function resolveWorldVariantRules(
  store: WorldVariantRulesStoreSource | undefined,
  systemModule: WorldVariantRulesSystemSource | undefined,
): ResolvedWorldVariantRules {
  if (!store || !systemModule) return { classLevels: false, freeArchetype: false };

  const systemId = systemModule.manifest.id;
  const classLevelsKey = `${systemId}:variantRules.classLevels`;
  const freeArchetypeKey = `${systemId}:variantRules.freeArchetype`;

  let classLevels = false;
  let freeArchetype = false;

  for (const doc of store.getAll("settings")) {
    const key = doc["key"];
    if (key === classLevelsKey) classLevels = doc["value"] === true;
    else if (key === freeArchetypeKey) freeArchetype = doc["value"] === true;
  }

  return { classLevels, freeArchetype };
}
