/**
 * skillNames.ts — curated pt-BR display names for the 16 canonical PF2e skills
 * (B1 r14 #7). The Skills tab shows the pt-BR name as the main line and keeps
 * the EN name (from characterSheetVM's `SkillRow.label`) as the subtitle —
 * matching the "pt-BR main + EN sub" rule used across the sheet.
 *
 * Why a NEW module (not characterSheetVM's SKILL_LABELS): that file is B4
 * territory in this round and its `SkillRow.label` stays EN by contract. The
 * component translates the row's `slug` → pt-BR here, so no cross-territory
 * edit is needed. Lore skills have no canonical slug (keyed `lore-<x>`), so
 * they fold onto a generated "Saber (<x>)" label.
 *
 * All names are hand-authored for Fusion (clean-room — not copied from any
 * Paizo/Foundry source), matching the game terms already used elsewhere in the
 * pt-BR bundle (abilitySkillHelp.ts, i18n).
 */

/** EN game term → pt-BR display name, keyed by the canonical skill slug. */
export const SKILL_NAMES_PT: Record<string, string> = {
  acrobatics: "Acrobacia",
  arcana: "Arcanismo",
  athletics: "Atletismo",
  crafting: "Ofício",
  deception: "Enganação",
  diplomacy: "Diplomacia",
  intimidation: "Intimidação",
  medicine: "Medicina",
  nature: "Natureza",
  occultism: "Ocultismo",
  performance: "Atuação",
  religion: "Religião",
  society: "Sociedade",
  stealth: "Furtividade",
  survival: "Sobrevivência",
  thievery: "Ladinagem",
};

/**
 * Resolve a skill slug to its pt-BR display name. Lore skills (`lore-<x>`)
 * become "Saber (<x>)" with the custom subject title-cased from the slug; an
 * unknown slug falls back to itself (never throws).
 */
export function skillNamePt(slug: string): string {
  if (slug.startsWith("lore-")) {
    const subject = slug.replace(/^lore-/, "").replace(/-+/g, " ").trim();
    const titled = subject ? subject.charAt(0).toUpperCase() + subject.slice(1) : subject;
    return titled ? `Saber (${titled})` : "Saber";
  }
  return SKILL_NAMES_PT[slug] ?? slug;
}
