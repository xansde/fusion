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
 * A key with no stored `Setting` document resolves to `undefined`, NOT
 * `false` — this is the achado 5/REQ-CFG-034 fix from the adversarial
 * review of core#273/satélite#278 (26/09/2026). Before that fix this
 * resolved straight to `false`, which meant "the GM never opened
 * Configurações → Mundo" and "the GM explicitly turned it off" were
 * indistinguishable — and the world setting ALWAYS won, even over an actor
 * whose legacy `system.build.variantRules.classLevels`/`freeArchetype`
 * field was already `true` (pre-DEC-MCL-09 sheets, or any world a GM never
 * touched Configurações on). That silently de-multiclassed every such
 * actor's HP/proficiencies on the very next `doc:update` after this
 * overlay shipped. `undefined` lets the caller (`runActorDerivation`)
 * fall back to the actor's own legacy field when the world has no opinion
 * yet — the SAME `world ?? legado` precedence the client sheet already
 * uses (`planVM.ts`'s `worldVariants?.classLevels ?? getClassLevelsVariant(sys)`)
 * — without needing the REQ-CFG-034 world-migration-on-first-open to exist
 * first. A GM who explicitly sets the setting (`true` or `false`) always
 * wins from then on, migration or not.
 */

/** Just enough of `DocumentStore` to read persisted `Setting` documents. */
export interface WorldVariantRulesStoreSource {
  getAll(table: "settings"): Record<string, unknown>[];
}

/** Just enough of a `SystemModule` to namespace the setting keys. */
export interface WorldVariantRulesSystemSource {
  manifest: { id: string };
}

/**
 * The overlay `runActorDerivation` merges onto `doc.system.build`.
 *
 * `undefined` means "no Setting document stored for this key" — the GM
 * never opened Configurações → Mundo (or a fresh/imported world with no
 * settings table yet). It is NOT the same as `false` (GM explicitly turned
 * it off): the caller must fall back to the actor's own legacy field in
 * that case, never treat `undefined` as "off" (achado 5, revisão
 * core#273/satélite#278, 26/09/2026).
 */
export interface ResolvedWorldVariantRules {
  readonly classLevels: boolean | undefined;
  readonly freeArchetype: boolean | undefined;
  /**
   * HJ-09 (#434, decisão D4): the skill slugs EVERY character of this world
   * receives trained, from the `campaign.trainedSkills` setting. Not a
   * "variant rule", but it rides the same overlay for the same reason: the
   * derivation steps are doc-only (REQ-SYS-024), so the world value has to
   * reach them as `system.build.campaignSkills`.
   *
   * `undefined` = no Setting stored (the GM never configured it); `[]` = the GM
   * explicitly cleared it. Unlike the two booleans there is NO per-actor
   * legacy field to fall back to, and there must never be one: if the actor's
   * own document could carry the list, its owner could grant themselves any
   * skill. The overlay therefore always REPLACES whatever the doc held.
   */
  readonly campaignSkills?: readonly string[] | undefined;
  /**
   * House rules of the campaign A Queda (decision 2026-10-05): four boolean
   * world settings that relax the PF2e feat-slot rules. World-authoritative
   * like `campaignSkills` — no per-actor legacy field exists, so `undefined`
   * (never stored) is NOT a fallback to the actor's own value: the overlay
   * drops whatever the doc carries. `true`/`false` are written as-is.
   */
  readonly bonusGeneralFeatLevel1?: boolean | undefined;
  readonly freeOccultismOrReligion?: boolean | undefined;
  readonly ancestryFeatsInGeneralSlots?: boolean | undefined;
  readonly ancestryFeatLevelMinus2?: boolean | undefined;
}

/** The four house-rule keys (local names, `variantRules.<key>`). */
export const HOUSE_RULE_VARIANT_KEYS = [
  "bonusGeneralFeatLevel1",
  "freeOccultismOrReligion",
  "ancestryFeatsInGeneralSlots",
  "ancestryFeatLevelMinus2",
] as const;
export type HouseRuleVariantKey = (typeof HOUSE_RULE_VARIANT_KEYS)[number];

/** A skill slug as the systems spell them (`occultism`, `lore-scribing`). */
const CAMPAIGN_SKILL_SLUG = /^[a-z][a-z0-9-]*$/;

/**
 * Normalise a stored `campaign.trainedSkills` value: only strings that look
 * like a skill slug survive, de-duplicated, in the stored order. The server
 * does not validate a Setting's `value` against the declared schema on write,
 * so this is the door that keeps a malformed or forged value out of the
 * derivation. A non-array resolves to `[]` (the GM wrote something unusable:
 * "no skills", never a throw).
 */
function normalizeCampaignSkills(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && CAMPAIGN_SKILL_SLUG.test(entry) && !out.includes(entry)) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Resolve both variant-rule settings for the world's active system.
 *
 * Returns every field `undefined` when
 * `store` or `systemModule` is missing (no system resolved for this world)
 * — the caller's fallback-to-legacy-field path applies here too, same as
 * for an unset key on a resolved system.
 */
export function resolveWorldVariantRules(
  store: WorldVariantRulesStoreSource | undefined,
  systemModule: WorldVariantRulesSystemSource | undefined,
): ResolvedWorldVariantRules {
  if (!store || !systemModule) {
    return {
      classLevels: undefined,
      freeArchetype: undefined,
      campaignSkills: undefined,
      bonusGeneralFeatLevel1: undefined,
      freeOccultismOrReligion: undefined,
      ancestryFeatsInGeneralSlots: undefined,
      ancestryFeatLevelMinus2: undefined,
    };
  }

  const systemId = systemModule.manifest.id;
  const classLevelsKey = `${systemId}:variantRules.classLevels`;
  const freeArchetypeKey = `${systemId}:variantRules.freeArchetype`;
  const campaignSkillsKey = `${systemId}:campaign.trainedSkills`;

  let classLevels: boolean | undefined;
  let freeArchetype: boolean | undefined;
  let campaignSkills: string[] | undefined;
  const houseRules: Partial<Record<HouseRuleVariantKey, boolean>> = {};
  const houseRuleKeys = new Map<string, HouseRuleVariantKey>(
    HOUSE_RULE_VARIANT_KEYS.map((k) => [`${systemId}:variantRules.${k}`, k]),
  );

  for (const doc of store.getAll("settings")) {
    const key = doc["key"];
    if (key === classLevelsKey) classLevels = doc["value"] === true;
    else if (key === freeArchetypeKey) freeArchetype = doc["value"] === true;
    else if (key === campaignSkillsKey) campaignSkills = normalizeCampaignSkills(doc["value"]);
    else if (typeof key === "string") {
      const houseRule = houseRuleKeys.get(key);
      if (houseRule) houseRules[houseRule] = doc["value"] === true;
    }
  }

  return {
    classLevels,
    freeArchetype,
    campaignSkills,
    bonusGeneralFeatLevel1: houseRules.bonusGeneralFeatLevel1,
    freeOccultismOrReligion: houseRules.freeOccultismOrReligion,
    ancestryFeatsInGeneralSlots: houseRules.ancestryFeatsInGeneralSlots,
    ancestryFeatLevelMinus2: houseRules.ancestryFeatLevelMinus2,
  };
}
