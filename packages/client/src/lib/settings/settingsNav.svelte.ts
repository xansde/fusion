/**
 * settingsNav.svelte.ts — pure index↔section navigation for the Configurações tab.
 *
 * Spec 37 (`specs/37-configuracoes.md`), DEC-CFG-04/05: the tab opens on an **index**
 * of sections; choosing one substitutes the index with that section's content in the
 * same drawer slot, never a floating window (REQ-CFG-010, REQ-CFG-013). This module
 * owns exactly that: the static list of sections (with the role cut of DEC-CFG-05,
 * REQ-CFG-005) and the two-state machine that drives the swap (REQ-CFG-010..012).
 * Section *content* is each section's own task (G101..G106) — this module never
 * renders anything.
 *
 * `SettingsNav` is a class with a `$state` field, the same shape as
 * `lib/combat/turnHead.svelte.ts`'s `TurnHeadState`: tests instantiate it directly
 * (`new SettingsNav()`), and `SettingsTab.svelte` takes it as an *injectable* prop
 * defaulting to a fresh instance per mount — never a module singleton. That default
 * is what satisfies REQ-CFG-012 for free: `SidebarDrawer` unmounts the previous panel
 * and mounts a new one on every tab switch or collapse (REQ-GAV-017), so a nav
 * created at component-init time always starts back at the index. Nothing here reads
 * or writes `localStorage`.
 */

// ---------------------------------------------------------------------------
// Sections (DEC-CFG-05)
// ---------------------------------------------------------------------------

/** Ids of the five sections DEC-CFG-05 names, in the table's own order. */
export type SettingsSectionId = "preferences" | "world" | "permissions" | "users" | "mods";

export interface SettingsSectionDescriptor {
  readonly id: SettingsSectionId;
  /** i18n key of the section's index row title. */
  readonly titleKey: string;
  /** i18n key of the section's one-line index row description. */
  readonly descriptionKey: string;
  /**
   * DEC-CFG-05: `true` restricts the entry to a GAMEMASTER-equivalent seat
   * (REQ-CFG-005). "Minhas preferências" is the only section everyone sees.
   */
  readonly privileged: boolean;
}

/**
 * The five sections, in index order (REQ-CFG-003). Registration order IS display
 * order — nothing downstream sorts this list.
 */
export const SETTINGS_SECTIONS: readonly SettingsSectionDescriptor[] = [
  {
    id: "preferences",
    titleKey: "FUSION.Settings.Sections.Preferences.Title",
    descriptionKey: "FUSION.Settings.Sections.Preferences.Description",
    privileged: false,
  },
  {
    id: "world",
    titleKey: "FUSION.Settings.Sections.World.Title",
    descriptionKey: "FUSION.Settings.Sections.World.Description",
    privileged: true,
  },
  {
    id: "permissions",
    titleKey: "FUSION.Settings.Sections.Permissions.Title",
    descriptionKey: "FUSION.Settings.Sections.Permissions.Description",
    privileged: true,
  },
  {
    id: "users",
    titleKey: "FUSION.Settings.Sections.Users.Title",
    descriptionKey: "FUSION.Settings.Sections.Users.Description",
    privileged: true,
  },
  {
    id: "mods",
    titleKey: "FUSION.Settings.Sections.Mods.Title",
    descriptionKey: "FUSION.Settings.Sections.Mods.Description",
    privileged: true,
  },
];

/**
 * The index a given seat actually sees (REQ-CFG-003..005): every section for a
 * privileged seat, and exactly "Minhas preferências" — a locked five-item list would
 * not be honest — for anyone else.
 */
export function visibleSettingsSections(isGm: boolean): readonly SettingsSectionDescriptor[] {
  return SETTINGS_SECTIONS.filter((section) => isGm || !section.privileged);
}

/**
 * Look up a section by id. Only ever called with an id that came out of
 * `SETTINGS_SECTIONS` itself (the nav machine below accepts no other kind), so a miss
 * means a programming error, not user input — hence the throw instead of `undefined`.
 */
export function getSettingsSection(id: SettingsSectionId): SettingsSectionDescriptor {
  const section = SETTINGS_SECTIONS.find((entry) => entry.id === id);
  if (section === undefined) {
    throw new Error(`Unknown settings section id: ${id}`);
  }
  return section;
}

// ---------------------------------------------------------------------------
// Navigation machine (REQ-CFG-010..013)
// ---------------------------------------------------------------------------

/**
 * The index↔section machine. `activeSectionId === null` means the index is showing
 * (REQ-CFG-003); any other value names the section currently substituting it
 * (REQ-CFG-010). There is no third state and no history — `back()` always lands on
 * the index, never on a previous section (REQ-CFG-011).
 */
export class SettingsNav {
  #activeSectionId: SettingsSectionId | null = $state(null);

  /** `null` while the index is showing; the open section's id otherwise. */
  get activeSectionId(): SettingsSectionId | null {
    return this.#activeSectionId;
  }

  /**
   * Substitute the index with `id`'s content, inside the same drawer slot
   * (REQ-CFG-010). Never opens a window (REQ-CFG-013) — this method only ever
   * flips one field.
   */
  open(id: SettingsSectionId): void {
    this.#activeSectionId = id;
  }

  /** The "‹" control: return to the index (REQ-CFG-011). */
  back(): void {
    this.#activeSectionId = null;
  }
}
