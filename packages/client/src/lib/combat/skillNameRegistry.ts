/**
 * skillNameRegistry.ts — pluggable localized skill-name resolver (REQ-CBA-066, F3).
 *
 * `combatSetup.ts`'s `initiativeStatisticOptions()` needs to label a skill
 * slug the way the sheet already labels it (Lore included, e.g.
 * "Saber (Underworld)"), but the client core cannot import a system's sheet
 * code (DEC-SEP-02): `systems/pf2e/lib/sheets/pf2e/skillNames.ts` is a
 * satellite territory the core never reaches into directly. This is where a
 * system plugs its own resolver in instead — registered once at boot
 * (`registerPf2eSheets()`), parallel to `sheetRegistry` / `chatCardExtensionRegistry`.
 *
 * Unlike `conditionRegistry`/`footprintRegistry`, the source here is a
 * synchronous local function rather than a server round-trip: the pt-BR
 * skill-name table is a static client-side dictionary, not world data, so
 * there is nothing to fetch and nothing to fail open FROM — the fail-open
 * behaviour is simply "no resolver registered yet ⇒ identity", i.e. the raw
 * slug shows instead of a translated name, exactly like an unknown slug
 * degrading to itself in the pf2e table.
 */

export type SkillNameResolver = (slug: string) => string;

let resolver: SkillNameResolver = (slug) => slug;

/** Register the active system's skill-name resolver (called once at boot). */
export function registerSkillNameResolver(fn: SkillNameResolver): void {
  resolver = fn;
}

/** Resolve a skill slug to its display name via the registered resolver. */
export function skillDisplayName(slug: string): string {
  return resolver(slug);
}

/** Reset to the identity resolver — tests only. */
export function resetSkillNameResolver(): void {
  resolver = (slug) => slug;
}
