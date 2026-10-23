<script lang="ts">
  /**
   * ShowPlayersWindow — the popup every client gets when the GM uses "Mostrar aos jogadores".
   * Closing only hides it for this client (Esc, the button or a click outside).
   */
  import { presenceState, dismissShown } from "../lib/presence/presenceStore.svelte.js";
  import Icon from "./common/Icon.svelte";

  const shown = $derived(presenceState.shown);

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape" && shown) dismissShown();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if shown}
  <div class="show-backdrop" role="presentation" onclick={dismissShown}>
    <div
      class="show-window"
      role="dialog"
      aria-label={shown.title ?? "Mostrado pelo Mestre"}
      tabindex="-1"
      onclick={(e) => {
        e.stopPropagation();
      }}
      onkeydown={(e) => {
        e.stopPropagation();
      }}
    >
      <header class="show-window__head">
        <h2 class="show-window__title">{shown.title ?? "Mostrado pelo Mestre"}</h2>
        <button type="button" class="show-window__close" aria-label="Fechar" onclick={dismissShown}>
          <Icon name="x" size={20} />
        </button>
      </header>
      {#if shown.imageUrl}
        <img class="show-window__img" src={shown.imageUrl} alt={shown.title ?? ""} />
      {/if}
      {#if shown.text}
        <p class="show-window__text">{shown.text}</p>
      {/if}
      {#if shown.fromName}
        <p class="show-window__from">Mostrado por {shown.fromName}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .show-backdrop {
    align-items: center;
    background: var(--fusion-surface-alt);
    display: flex;
    inset: 0;
    justify-content: center;
    position: fixed;
    z-index: 400;
  }

  .show-window {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    box-shadow: var(--fusion-shadow-modal);
    color: var(--fusion-text);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-height: 92vh;
    max-width: min(92vw, 1100px);
    padding: 0.75rem 1rem 1rem;
  }

  .show-window__head {
    align-items: center;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }

  .show-window__title {
    font-size: var(--fusion-text-lg);
    margin: 0;
  }

  .show-window__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--fusion-target);
    height: var(--fusion-target);
    padding: 0;
    border: 0;
    border-radius: var(--fusion-radius);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
  }

  .show-window__close:hover {
    color: var(--fusion-text);
  }

  .show-window__img {
    align-self: center;
    max-height: 72vh;
    max-width: 100%;
    object-fit: contain;
  }

  .show-window__text {
    margin: 0;
    max-width: 70ch;
    overflow-y: auto;
    white-space: pre-wrap;
  }

  .show-window__from {
    color: var(--fusion-text-subtle);
    font-size: var(--fusion-text-sm);
    margin: 0;
  }
</style>
