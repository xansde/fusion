<script lang="ts">
  /**
   * RulerToolButton — floating on-screen switch for the ruler tool.
   *
   * With the tool on, click-and-drag on the map measures; releasing clears.
   * Holding R measures too, without the button (see attachRuler.ts).
   */
  import { rulerTool, toggleRulerTool } from "../lib/presence/rulerToolStore.svelte.js";
</script>

<button
  type="button"
  class="ruler-tool"
  class:ruler-tool--active={rulerTool.active}
  aria-pressed={rulerTool.active}
  aria-label="Régua (segure R)"
  title="Régua (segure R)"
  onclick={toggleRulerTool}
>
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path
      d="M3 17.5 17.5 3 21 6.5 6.5 21z M7 14l2.5 2.5 M10 11l1.5 1.5 M13 8l2.5 2.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
  </svg>
</button>

<style>
  .ruler-tool {
    position: absolute;
    top: calc(var(--fusion-header-height) + 0.75rem);
    left: 0.75rem;
    z-index: 90;
    align-items: center;
    background: rgba(24, 24, 31, 0.85);
    backdrop-filter: blur(6px);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: inline-flex;
    height: 2.25rem;
    justify-content: center;
    transition:
      background-color var(--fusion-transition),
      color var(--fusion-transition),
      border-color var(--fusion-transition);
    width: 2.25rem;
  }

  .ruler-tool:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .ruler-tool--active {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-bg);
  }

  .ruler-tool:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }
</style>
