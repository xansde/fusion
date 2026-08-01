/**
 * actionCategories.ts — curated mapping from the pf2e vendor action taxonomy
 * to the display groups shown in the sheet's Actions tab (Pathbuilder-style
 * filter grid).
 *
 * TWO INDEPENDENT VENDOR AXES feed a single display group:
 *
 *   1. Folder axis (primary, Pathbuilder-style): the vendor `actions` pack is
 *      organized into top-level folders — basic, skill, class, exploration,
 *      downtime, ancestry, heritage, archetype, background, familiar, spells,
 *      stamina, mythic, campaign, subsystems, vehicles, aftermath, equipment.
 *      These map 1:1 to the physical subfolders under
 *      tools/importer-pf2e/vendor/pf2e/packs/pf2e/actions/*. This is the axis
 *      the user's reference (Pathbuilder) buckets by: Class, Skills, Gear,
 *      Basic, Exploration, Downtime, Activity.
 *
 *      IMPORTANT: the importer's normalize step strips the Foundry `folder`
 *      field, so this axis only survives into the committed pack if the
 *      importer (agent A) re-injects it — see resolveActionGroup() in
 *      actionsVM.ts for the field-resolution order and its documented
 *      fallback when the folder is absent.
 *
 *   2. Mechanical axis (fallback): the vendor `system.category` field carries
 *      the PF2e mechanical action category — offensive | interaction |
 *      defensive | precision. This is always present in the transformed doc
 *      and is used as a secondary signal when the folder axis is unavailable.
 *
 * This module is pure TS (no DOM/Svelte) so it is unit-testable and reusable
 * by both the VM and the tab component.
 *
 * Display labels are pt-BR per the sheet's product language (specs pt-BR, UI
 * strings otherwise flow through i18n; these group labels are also exposed as
 * i18n keys FUSION.Sheet.Actions.Group.* — kept in sync with GROUP_LABEL_KEYS
 * below so the component renders the localized label while tests assert the
 * curated pt-BR default here).
 */

// ---------------------------------------------------------------------------
// Display groups
// ---------------------------------------------------------------------------

/** Stable identifiers for the display groups (used as filter keys + i18n suffixes). */
export const ACTION_GROUPS = [
  "basic",
  "skill",
  "class",
  "exploration",
  "downtime",
  "equipment",
  "ancestry",
  "archetype",
  "background",
  "other",
] as const;

export type ActionGroup = (typeof ACTION_GROUPS)[number];

/**
 * Display order for the group filter grid (mirrors the Pathbuilder reference:
 * Class, Skills, Gear, Basic, Exploration, Downtime, then the rest).
 */
export const ACTION_GROUP_ORDER: readonly ActionGroup[] = [
  "class",
  "skill",
  "equipment",
  "basic",
  "exploration",
  "downtime",
  "ancestry",
  "archetype",
  "background",
  "other",
] as const;

/** Curated pt-BR default label for each display group. */
export const ACTION_GROUP_LABELS: Record<ActionGroup, string> = {
  basic: "Básicas",
  skill: "Perícia",
  class: "Classe",
  exploration: "Exploração",
  downtime: "Downtime",
  equipment: "Equipamento",
  ancestry: "Ancestralidade",
  archetype: "Arquétipo",
  background: "Antecedente",
  other: "Outras",
};

/** i18n key suffixes for each group (namespace FUSION.Sheet.Actions.Group.*). */
export const GROUP_LABEL_KEYS: Record<ActionGroup, string> = {
  basic: "FUSION.Sheet.Actions.Group.Basic",
  skill: "FUSION.Sheet.Actions.Group.Skill",
  class: "FUSION.Sheet.Actions.Group.Class",
  exploration: "FUSION.Sheet.Actions.Group.Exploration",
  downtime: "FUSION.Sheet.Actions.Group.Downtime",
  equipment: "FUSION.Sheet.Actions.Group.Equipment",
  ancestry: "FUSION.Sheet.Actions.Group.Ancestry",
  archetype: "FUSION.Sheet.Actions.Group.Archetype",
  background: "FUSION.Sheet.Actions.Group.Background",
  other: "FUSION.Sheet.Actions.Group.Other",
};

// ---------------------------------------------------------------------------
// Axis 1: vendor folder -> display group
// ---------------------------------------------------------------------------

/**
 * Every top-level folder under the vendor `actions` pack, mapped to its
 * display group. The test suite asserts this map covers every folder present
 * in the vendor tree (no folder left ungrouped) — see actionCategories.test.ts.
 *
 * Grouping rationale (per the task's entrega-1 spec):
 *   basic -> Básicas; skill -> Perícia; exploration -> Exploração;
 *   downtime -> Downtime; class -> Classe; equipment -> Equipamento;
 *   ancestry/heritage -> Ancestralidade; archetype -> Arquétipo;
 *   background -> Antecedente; familiar/spells/stamina/mythic + the remaining
 *   niche folders -> Outras.
 */
export const VENDOR_FOLDER_TO_GROUP: Record<string, ActionGroup> = {
  basic: "basic",
  skill: "skill",
  class: "class",
  exploration: "exploration",
  downtime: "downtime",
  equipment: "equipment",
  ancestry: "ancestry",
  heritage: "ancestry",
  archetype: "archetype",
  background: "background",
  // Niche folders bucketed under "Outras".
  familiar: "other",
  spells: "other",
  stamina: "other",
  mythic: "other",
  campaign: "other",
  subsystems: "other",
  vehicles: "other",
  aftermath: "other",
};

/**
 * The canonical list of vendor folders, exposed for the coverage test so it
 * asserts against a single source of truth rather than re-listing folders.
 */
export const KNOWN_VENDOR_FOLDERS: readonly string[] = Object.keys(VENDOR_FOLDER_TO_GROUP);

// ---------------------------------------------------------------------------
// Axis 2: vendor mechanical category -> display group (fallback)
// ---------------------------------------------------------------------------

/**
 * The vendor `system.category` (mechanical PF2e action category) mapped to a
 * display group, used only as a fallback when the folder axis is unavailable.
 * offensive/precision are combat-oriented and bucket under "Básicas" (the
 * common combat maneuvers most players expect there); interaction/defensive
 * also fall through to "Básicas" as the safest generic bucket. This axis never
 * produces a class/skill/etc. group — those require the folder axis — so it is
 * intentionally coarse and conservative.
 */
export const MECHANICAL_CATEGORY_TO_GROUP: Record<string, ActionGroup> = {
  offensive: "basic",
  interaction: "basic",
  defensive: "basic",
  precision: "basic",
};

/**
 * Resolve a display group from a raw vendor folder name (case-insensitive,
 * trimmed). Returns null when the folder is unknown (caller decides the
 * fallback — typically the mechanical axis, then "other").
 */
export function groupFromFolder(folder: string | null | undefined): ActionGroup | null {
  if (typeof folder !== "string") return null;
  const key = folder.trim().toLowerCase();
  return VENDOR_FOLDER_TO_GROUP[key] ?? null;
}

/**
 * Resolve a display group from the vendor mechanical `system.category`
 * (offensive/interaction/defensive/precision). Returns null for unknown
 * values (incl. "classfeature", ability categories, etc.).
 */
export function groupFromMechanicalCategory(
  category: string | null | undefined,
): ActionGroup | null {
  if (typeof category !== "string") return null;
  const key = category.trim().toLowerCase();
  return MECHANICAL_CATEGORY_TO_GROUP[key] ?? null;
}

/** The i18n key for a group's localized label. */
export function groupLabelKey(group: ActionGroup): string {
  return GROUP_LABEL_KEYS[group];
}

/** The curated pt-BR default label for a group (i18n-independent). */
export function groupLabel(group: ActionGroup): string {
  return ACTION_GROUP_LABELS[group];
}
