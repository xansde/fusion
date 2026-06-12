<script lang="ts">
  /**
   * NoSceneOverlay.svelte — overlay shown on the canvas when there is no
   * active scene. Guides the GM to activate one (or informs players to wait).
   */

  const {
    isGm,
  }: {
    isGm: boolean;
  } = $props();
</script>

<div class="no-scene" aria-live="polite" aria-atomic="true">
  <div class="no-scene__card">
    <span class="no-scene__icon" aria-hidden="true">&#x1F5FA;</span>
    <p class="no-scene__title">No Active Scene</p>
    <p class="no-scene__hint">
      {#if isGm}
        Open the <strong>Scenes</strong> panel and activate a scene to begin.
      {:else}
        Waiting for the Game Master to activate a scene&hellip;
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
    background: rgba(24, 24, 31, 0.82);
    backdrop-filter: blur(8px);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 2rem 2.5rem;
    text-align: center;
    max-width: 320px;
  }

  .no-scene__icon {
    font-size: 2.5rem;
    line-height: 1;
    opacity: 0.4;
  }

  .no-scene__title {
    color: var(--fusion-text);
    font-size: 1rem;
    font-weight: 600;
  }

  .no-scene__hint {
    color: var(--fusion-text-muted);
    font-size: 0.8125rem;
    line-height: 1.55;
  }

  .no-scene__hint strong {
    color: var(--fusion-text);
  }
</style>
