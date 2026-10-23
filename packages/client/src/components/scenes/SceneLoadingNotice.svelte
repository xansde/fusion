<script lang="ts">
  /**
   * SceneLoadingNotice.svelte — the discreet "Carregando cena…" pill shown while the next
   * scene's art is still on its way (only after 300 ms; a fast switch never shows it). The
   * current scene stays on screen underneath — this replaces the empty canvas the table used to
   * stare at.
   */
  import { t } from "../../lib/i18n/i18n.js";
  import { sceneLoadingState } from "../../lib/canvas/sceneLoadingState.svelte.js";
</script>

{#if sceneLoadingState.pending > 0}
  <p class="scene-loading-notice" role="status">
    <span class="scene-loading-notice__dot" aria-hidden="true"></span>
    {t("FUSION.Scene.Loading")}
  </p>
{/if}

<style>
  .scene-loading-notice {
    align-items: center;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-magic);
    border-radius: var(--fusion-radius-lg);
    color: var(--fusion-text);
    display: flex;
    font-size: var(--fusion-text-sm);
    gap: 0.45rem;
    left: 50%;
    margin: 0;
    padding: 0.3rem 0.8rem;
    pointer-events: none;
    position: absolute;
    top: 4.2rem;
    transform: translateX(-50%);
    z-index: 30;
  }

  .scene-loading-notice__dot {
    animation: scene-loading-pulse 0.9s ease-in-out infinite;
    background: var(--fusion-accent);
    border-radius: 50%;
    height: 0.5rem;
    width: 0.5rem;
  }

  @keyframes scene-loading-pulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scene-loading-notice__dot {
      animation: none;
    }
  }
</style>
