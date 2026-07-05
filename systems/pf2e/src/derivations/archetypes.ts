/**
 * @fusion/system-pf2e — Archetype (dedication) class-DC metadata.
 *
 * Multiclass/archetype dedications can grant their OWN class DC, distinct
 * from the character's base class DC (REQ-PF2-016, DEC-R12-04). E.g. the
 * Alchemist Dedication makes you "trained in the alchemist class DC" using
 * Intelligence, regardless of your base class's key ability.
 *
 * The concrete key ability + trained rank for each dedication is carried on
 * the feat item itself under `system.subfeatures.proficiencies.<slug>`
 * (`{ attribute, rank }`) — that is the authoritative source read by
 * `stepCharArchetypeClassDCs`. This map is a small, extensible fallback for
 * dedications whose importer output lacks that subfeature block, plus a
 * source of human-readable labels for the sheet.
 *
 * Clean-room: the slug→ability association is a fact of the PF2e Remaster
 * archetype rules (ORC/OGL, Archives of Nethys). No proprietary content.
 */

import type { AbilitySlug } from "../types.js";

/**
 * Known dedication archetype → key ability for its class DC.
 *
 * Extensible: add an entry here when a new dedication that grants a class DC
 * is supported. The key is the archetype's slug (the key used under
 * `subfeatures.proficiencies`, e.g. "alchemist").
 */
export const ARCHETYPE_KEY_ABILITY: Record<string, AbilitySlug> = {
  alchemist: "int",
};

/**
 * Human-readable archetype label by slug (for the sheet's "CD <Archetype>"
 * display). Falls back to a Title-Cased slug when absent.
 */
export const ARCHETYPE_LABEL: Record<string, string> = {
  alchemist: "Alchemist",
};

/** Title-case a slug (e.g. "beast-master" → "Beast Master") as a label fallback. */
export function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
