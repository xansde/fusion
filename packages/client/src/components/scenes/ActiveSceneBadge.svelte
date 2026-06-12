<script lang="ts">
  /**
   * ActiveSceneBadge.svelte — shows the active scene name in the header.
   *
   * Receives the SceneDocument (or null) and renders a compact badge.
   * Renders nothing when no scene is active.
   */

  import type { SceneDocument } from "@fusion/shared";

  const {
    scene,
  }: {
    scene: SceneDocument | null;
  } = $props();
</script>

{#if scene}
  <div class="active-scene-badge" aria-label="Active scene: {scene.name}">
    <span class="badge__icon" aria-hidden="true">&#x1F5FA;</span>
    <span class="badge__name">{scene.name}</span>
  </div>
{/if}

<style>
  .active-scene-badge {
    align-items: center;
    background: var(--fusion-accent-dim);
    border: 1px solid rgba(124, 92, 252, 0.35);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    gap: 0.35rem;
    overflow: hidden;
    padding: 0.2rem 0.55rem;
  }

  .badge__icon {
    color: var(--fusion-accent);
    flex-shrink: 0;
    font-size: 0.85rem;
    line-height: 1;
  }

  .badge__name {
    color: var(--fusion-text);
    font-size: 0.8rem;
    font-weight: 500;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
