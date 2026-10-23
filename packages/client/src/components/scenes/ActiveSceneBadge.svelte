<script lang="ts">
  /**
   * ActiveSceneBadge.svelte — shows the active scene name in the header.
   *
   * Receives the SceneDocument (or null) and renders a compact badge.
   * Renders nothing when no scene is active.
   */

  import type { SceneDocument } from "@fusion/shared";
  import Icon from "../common/Icon.svelte";
  import { t } from "../../lib/i18n/i18n.js";

  const {
    scene,
  }: {
    scene: SceneDocument | null;
  } = $props();
</script>

{#if scene}
  <div class="active-scene-badge" title={scene.name} aria-label="{t('FUSION.Sidebar.Scenes.ActiveScene')}: {scene.name}">
    <span class="badge__icon" aria-hidden="true"><Icon name="map" size={16} /></span>
    <span class="badge__name">{scene.name}</span>
  </div>
{/if}

<style>
  .active-scene-badge {
    align-items: center;
    background: var(--fusion-accent-dim);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    gap: var(--fusion-space-2);
    min-height: 32px;
    min-width: 0;
    overflow: hidden;
    padding: 0 var(--fusion-space-2);
  }

  .badge__icon {
    color: var(--fusion-accent);
    display: inline-flex;
    flex-shrink: 0;
  }

  .badge__name {
    color: var(--fusion-text);
    font-size: var(--fusion-text-sm);
    font-weight: var(--fusion-weight-medium);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
