<script lang="ts">
  /**
   * NoSceneOverlay.svelte — overlay shown on the canvas when there is no
   * active scene. Guides the GM to activate one (or informs players to wait).
   */

  import { t } from "../../lib/i18n/i18n.js";
  import Icon from "../common/Icon.svelte";

  const {
    isGm,
  }: {
    isGm: boolean;
  } = $props();
</script>

<div class="no-scene" aria-live="polite" aria-atomic="true">
  <div class="no-scene__card">
    <span class="no-scene__icon" aria-hidden="true"><Icon name="map" size={40} /></span>
    <p class="no-scene__title">{t("FUSION.NoScene.Title")}</p>
    <p class="no-scene__hint">
      {#if isGm}
        {t("FUSION.NoScene.HintGm")} <strong>{t("FUSION.NoScene.HintGmScenes")}</strong> {t("FUSION.NoScene.HintGmEnd")}
      {:else}
        {t("FUSION.NoScene.HintPlayer")}
      {/if}
    </p>
  </div>
</div>

<style>
  .no-scene {
    align-items: center;
    display: flex;
    inset: 0;
    justify-content: center;
    pointer-events: none;
    position: absolute;
    z-index: 50;
  }

  .no-scene__card {
    align-items: center;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-3);
    padding: var(--fusion-space-8) var(--fusion-space-8);
    text-align: center;
    max-width: 320px;
  }

  .no-scene__icon {
    color: var(--fusion-text-subtle);
    display: inline-flex;
  }

  .no-scene__title {
    color: var(--fusion-text);
    font-size: var(--fusion-text-md);
    font-weight: 600;
  }

  .no-scene__hint {
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
  }

  .no-scene__hint strong {
    color: var(--fusion-text);
  }
</style>
