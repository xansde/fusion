/**
 * skillNames.ts — curated pt-BR display names for the 16 canonical PF2e skills
 * (B1 r14 #7). The Skills tab shows the pt-BR name as the main line and keeps
 * the EN name (from characterSheetVM's `SkillRow.label`) as the subtitle —
 * matching the "pt-BR main + EN sub" rule used across the sheet.
 *
 * Why a NEW module (not characterSheetVM's SKILL_LABELS): that file is B4
 * territory in this round and its `SkillRow.label` stays EN by contract. The
 * component translates the row's `slug` → pt-BR here, so no cross-territory
 * edit is needed. Lore skills have no canonical slug (the subject is chosen by
 * the player or granted by a background), so they fold onto a generated
 * "Saber (<subject>)" label built from the slug via `loreSlug.ts`.
 *
 * All names are hand-authored for Fusion (clean-room — not copied from any
 * Paizo/Foundry source), matching the game terms already used elsewhere in the
 * pt-BR bundle (abilitySkillHelp.ts, i18n).
 */

import { isLoreSlug, loreSubject } from "./loreSlug.js";

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
 * Resolve a skill slug to its pt-BR display name. A Lore skill becomes
 * "Saber (<subject>)" with the subject title-cased from the slug; an unknown
 * slug falls back to itself (never throws).
 *
 * Detection goes through `isLoreSlug`/`loreSubject` rather than a local
 * `startsWith("lore-")`, so the LEGACY `<subject>-lore` key the background path
 * used to write also reads as a Lore. Matching it by hand here was what made a
 * background's Lore render as the raw slug on the sheet.
 */
export function skillNamePt(slug: string): string {
  if (isLoreSlug(slug)) {
    const subject = loreSubject(slug);
    const titled = subject ? subject.charAt(0).toUpperCase() + subject.slice(1) : subject;
    return titled ? `Saber (${titled})` : "Saber";
  }
  return SKILL_NAMES_PT[slug] ?? slug;
}
