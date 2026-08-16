<script lang="ts">
  /**
   * SettingsTab.svelte — the Configurações tab of the side drawer (spec 37, id
   * "settings", anchored to the rail footer by DEC-GAV-09 / REQ-CFG-001).
   *
   * It is deliberately EMPTY for now. Spec 37 (world settings, permissions, users,
   * mods for the GM; own preferences for the player) is written but not built yet —
   * it is the last phase of the drawer plan. What this file provides today is the
   * one thing spec 36 §7 demands of every child tab even before its content exists:
   * a header with the tab's own title, and an honest empty state instead of a hole.
   *
   * No ✕ and no collapse control here either: clicking the active tab in the rail is
   * the only gesture (REQ-GAV-011).
   */

  import type { SidebarPanelProps } from "../../lib/sidebar/registry.js";
  import { t } from "../../lib/i18n/i18n.js";

  // The drawer hands every panel the same contract (registry, REQ-GAV-030). The
  // placeholder uses none of it yet — spec 37 will — but it declares the shape, so
  // this is a normal tab panel and not a special case.
  const {}: SidebarPanelProps = $props();
</script>

<div class="settings-tab">
  <header class="settings-tab__header">
    <span class="settings-tab__title">{t("FUSION.Sidebar.Settings.Title")}</span>
  </header>

  <!-- Spec 36 §7.4: the empty state of the tab, until spec 37 fills it. -->
  <div class="settings-tab__body">
    <p class="settings-tab__empty">{t("FUSION.Sidebar.Settings.Empty")}</p>
  </div>
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
    justify-content: space-between;
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

  .settings-tab__body {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .settings-tab__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    padding: 1.5rem 1rem;
    text-align: center;
  }
</style>
