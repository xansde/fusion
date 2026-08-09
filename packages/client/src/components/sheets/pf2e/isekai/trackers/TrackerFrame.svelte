<script lang="ts">
  /**
   * TrackerFrame.svelte — the shared chrome every Isekai tracker sits in:
   * accent border, title, a right-aligned counter, the body, and the rules
   * note underneath.
   *
   * Exists so the seven widgets don't each re-declare the same scoped CSS
   * (Svelte styles are per-component, so shared classes would have to be
   * copy-pasted seven times and would drift on the first tweak).
   */

  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    /** `#rrggbb` accent of the owning archetype. */
    accent: string;
    /** Short right-aligned status, e.g. "batalha 2/3" or "preparadas 4/7". */
    meta?: string | undefined;
    note?: string | undefined;
    children: Snippet;
    /** Action buttons row, rendered under the body. */
    controls?: Snippet | undefined;
  }

  let { title, accent, meta, note, children, controls }: Props = $props();
</script>

<section class="trk" style={`--accent: ${accent}`}>
  <header class="trk__head">
    <span class="trk__title">{title}</span>
    {#if meta}<span class="trk__meta">{meta}</span>{/if}
  </header>

  <div class="trk__body">
    {@render children()}
  </div>

  {#if controls}
    <div class="trk__controls">
      {@render controls()}
    </div>
  {/if}

  {#if note}
    <p class="trk__note">{note}</p>
  {/if}
</section>

<style>
  .trk {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px 12px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-left: 3px solid var(--accent);
    border-radius: var(--fusion-radius);
  }

  .trk__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  .trk__title {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }

  .trk__meta {
    font-size: 10.5px;
    color: var(--fusion-text-subtle);
    white-space: nowrap;
  }

  .trk__body {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .trk__controls {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /*
   * Buttons and text inputs inside a tracker body/controls are styled here,
   * globally-scoped to this component's subtree: the seven widgets render
   * plain <button>/<input> and would each need the same rules otherwise.
   */
  .trk :global(button) {
    font-size: 11px;
    padding: 3px 9px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font);
  }

  .trk :global(button:hover:not(:disabled)) {
    border-color: var(--accent);
  }

  .trk :global(button:disabled) {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .trk :global(input[type="text"]) {
    flex: 1;
    min-width: 90px;
    font-size: 11.5px;
    padding: 3px 7px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
  }

  .trk__note {
    margin: 0;
    font-size: 10px;
    line-height: 1.4;
    color: var(--fusion-text-subtle);
  }
</style>
