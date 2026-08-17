<script lang="ts">
  /**
   * SettingsTab.svelte — the Configurações tab of the side drawer (spec 37, id
   * "settings", anchored to the rail footer by DEC-GAV-09 / REQ-CFG-001).
   *
   * G100: the index and the drill-in navigation. The tab opens on an **index** of
   * sections — one line per section, title + one-line description + a "›" advance
   * indicator, deliberately without a per-section icon (REQ-CFG-003, REQ-CFG-004) —
   * cut by role at the index itself
   * (DEC-CFG-05, REQ-CFG-005): a non-privileged seat sees exactly one entry, "Minhas
   * preferências". Choosing a section substitutes the index with its content in this
   * same panel (REQ-CFG-010); the header of that content shows a "‹ voltar" control
   * plus the section's own name, and NOTHING else — no ✕, no other collapse control
   * (REQ-CFG-011, DEC-GAV-03). **Nothing in this tab ever opens a floating window**
   * (REQ-CFG-013, DEC-CFG-04) — every section's content, once its own task builds it,
   * renders inside `.settings-tab__body` and nowhere else.
   *
   * The section's *content* is each section's own task (G101 Minhas preferências,
   * G102 Mundo, G104 Permissões, G105 Usuários, G106 Mods) — all five are wired in
   * now, so the `{#if}` chain below is exhaustive over `SettingsSectionId` and there
   * is no pending-placeholder branch left. Mundo (G102) renders purely from what the
   * active system declared (REQ-CFG-030/031). Permissões (G104): one row per
   * configurable Permission (REQ-USR-008), never a matrix (REQ-CFG-040). Usuários
   * (G105): list + create/edit/reset/deactivate/kick, all inside this same panel
   * (REQ-CFG-050..054). Mods (G106): a static empty-state section — no mod can exist
   * yet (REQ-CFG-064) — gated by an explicit `isGm` check on top of the index cut, so
   * a `nav` forced open on "mods" for a non-privileged seat still renders nothing
   * (REQ-CFG-061).
   *
   * The navigation machine itself is `lib/settings/settingsNav.svelte.ts`'s
   * `SettingsNav` — pure, tested on its own. `nav` is an injectable prop (mirrors
   * `TurnHead.svelte`'s `state` prop) defaulting to a fresh instance per mount, which
   * is what satisfies REQ-CFG-012 for free: `SidebarDrawer` unmounts the previous
   * panel and mounts a new one on every switch or collapse (REQ-GAV-017), so a nav
   * nobody injected always starts back at the index.
   */

  import type { SidebarPanelProps } from "../../lib/sidebar/registry.js";
  import { t } from "../../lib/i18n/i18n.js";
  import {
    getSettingsSection,
    SettingsNav,
    visibleSettingsSections,
  } from "../../lib/settings/settingsNav.svelte.js";
  import PreferencesSection from "./PreferencesSection.svelte";
  import WorldSection from "./WorldSection.svelte";
  import PermissionsSection from "./PermissionsSection.svelte";
  import UsersSection from "./UsersSection.svelte";
  import ModsSection from "./ModsSection.svelte";

  interface Props extends SidebarPanelProps {
    /** Injectable so tests own their own (mirrors `TurnHead.svelte`'s `state` prop). */
    nav?: SettingsNav;
  }

  const { isGm, worldId, userId, socket, nav = new SettingsNav() }: Props = $props();

  const sections = $derived(visibleSettingsSections(isGm));
  const activeSection = $derived(
    nav.activeSectionId === null ? null : getSettingsSection(nav.activeSectionId),
  );
</script>

<div class="settings-tab">
  {#if activeSection}
    <!-- REQ-CFG-011: "voltar" + the section's name, and nothing else. -->
    <header class="settings-tab__header">
      <button type="button" class="settings-tab__back" onclick={() => nav.back()}>
        <span aria-hidden="true">‹</span>
        {t("FUSION.Settings.Nav.Back")}
      </button>
      <span class="settings-tab__section-title">{t(activeSection.titleKey)}</span>
    </header>
    <!-- REQ-CFG-013 / DEC-CFG-04: everything a section shows lives here, one column,
         never in a floating window. Real content lands section by section (G101..G106). -->
    <div class="settings-tab__body">
      {#if activeSection.id === "preferences"}
        <PreferencesSection {worldId} {userId} />
      {:else if activeSection.id === "world"}
        <WorldSection {socket} />
      {:else if activeSection.id === "permissions"}
        <PermissionsSection {socket} />
      {:else if activeSection.id === "users"}
        <UsersSection />
      {:else if activeSection.id === "mods" && isGm}
        <!-- REQ-CFG-061: not shown to a non-privileged seat, not even in reading —
             the index already cuts this entry (DEC-CFG-05), and this second `isGm`
             check means a `nav` forced open on "mods" (bypassing the index click)
             still renders nothing for a player, instead of relying solely on the
             index button never being clicked. -->
        <ModsSection />
      {/if}
    </div>
  {:else}
    <header class="settings-tab__header">
      <span class="settings-tab__title">{t("FUSION.Sidebar.Settings.Title")}</span>
    </header>
    <!-- REQ-CFG-003/004: one line per section, title + description + advance
         indicator, no per-section icon. The indicator is a plain "›" glyph (same
         family as the section header's own "‹" back control below), not an SVG
         pictograph identifying the section — REQ-CFG-004 only bans the latter. -->
    <ul class="settings-tab__index">
      {#each sections as section (section.id)}
        <li>
          <button
            type="button"
            class="settings-tab__index-item"
            onclick={() => nav.open(section.id)}
          >
            <span class="settings-tab__index-item-text">
              <span class="settings-tab__index-item-title">{t(section.titleKey)}</span>
              <span class="settings-tab__index-item-description"
                >{t(section.descriptionKey)}</span
              >
            </span>
            <span class="settings-tab__index-item-indicator" aria-hidden="true">›</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .settings-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .settings-tab__header {
    align-items: center;
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    gap: 0.5rem;
    justify-content: flex-start;
    padding: 0.6rem 0.75rem;
    flex-shrink: 0;
  }

  .settings-tab__title {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .settings-tab__back {
    align-items: center;
    background: none;
    border: none;
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: flex;
    font: inherit;
    gap: 0.25rem;
    padding: 0;
  }

  .settings-tab__back:hover {
    color: var(--fusion-text);
  }

  .settings-tab__section-title {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .settings-tab__body {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .settings-tab__index {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .settings-tab__index-item {
    align-items: center;
    background: none;
    border: none;
    border-bottom: 1px solid var(--fusion-border);
    cursor: pointer;
    display: flex;
    flex-direction: row;
    font: inherit;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    text-align: left;
    width: 100%;
  }

  .settings-tab__index-item:hover {
    background: var(--fusion-surface-alt);
  }

  .settings-tab__index-item-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .settings-tab__index-item-indicator {
    color: var(--fusion-text-subtle);
    flex-shrink: 0;
    font-size: 1rem;
  }

  .settings-tab__index-item-title {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .settings-tab__index-item-description {
    color: var(--fusion-text-subtle);
    font-size: 0.75rem;
  }
</style>
