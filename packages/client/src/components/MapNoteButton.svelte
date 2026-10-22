<script lang="ts">
  /**
   * MapNoteButton - GM-only floating button (third in the row, after the ruler and
   * "Mostrar aos jogadores") that arms the pin tool: the next click on the map opens
   * the new-pin form at that spot. Click again (or Esc) to cancel.
   */
  import { noteUi, startPlacing, stopPlacing } from "../lib/notes/noteUi.svelte.js";
  import { closeAllCornerPanels } from "../lib/ui/cornerPanel.svelte.js";

  function toggle(): void {
    if (noteUi.placing) stopPlacing();
    else {
      closeAllCornerPanels();
      startPlacing();
    }
  }
</script>

<div class="note-tool">
  <button
    type="button"
    class="note-tool__main"
    class:note-tool__main--active={noteUi.placing}
    aria-pressed={noteUi.placing}
    aria-label="Pino de nota no mapa"
    title={noteUi.placing ? "Clique no mapa para colocar o pino (Esc cancela)" : "Pino de nota no mapa"}
    onclick={toggle}
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <circle cx="12" cy="10.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6" />
    </svg>
  </button>
  {#if noteUi.placing}
    <p class="note-tool__hint">Clique no mapa para colocar o pino.</p>
  {/if}
</div>

<style>
  .note-tool {
    left: calc(0.75rem + 2 * (2.25rem + 0.4rem));
    position: absolute;
    top: calc(var(--fusion-header-height) + 0.75rem);
    z-index: 90;
  }

  .note-tool__main {
    align-items: center;
    background: var(--fusion-bg);
    backdrop-filter: blur(6px);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: inline-flex;
    height: 2.25rem;
    justify-content: center;
    width: 2.25rem;
  }

  .note-tool__main:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .note-tool__main--active {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-bg);
  }

  .note-tool__hint {
    background: var(--fusion-bg);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
    margin: 0.4rem 0 0;
    max-width: 11rem;
    padding: 0.3rem 0.5rem;
  }
</style>
