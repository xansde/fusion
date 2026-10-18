<script lang="ts">
  /**
   * RulerToolButton — floating on-screen switch for the measuring tools.
   *
   * The button opens a small picker: Régua · Explosão · Cone · Linha · Emanação.
   * Régua: click and drag on the map measures; releasing clears (holding R measures
   * too, without the button). Areas: press to anchor, drag to aim, mouse wheel or
   * the field set the size in steps of 5 ft, release to finish (Shift pins it).
   */
  import {
    rulerTool,
    selectRulerMode,
    setAreaSize,
    setRulerTool,
  } from "../lib/presence/rulerToolStore.svelte.js";
  import { TOOL_MODES, isAreaMode } from "../lib/presence/templateTool.js";

  let open = $state(false);

  function onMain(): void {
    if (rulerTool.mode !== null) {
      setRulerTool(null);
      open = false;
    } else {
      open = !open;
    }
  }

  function pick(mode: (typeof TOOL_MODES)[number]["mode"]): void {
    selectRulerMode(mode);
  }

  function onSize(e: Event): void {
    setAreaSize(Number((e.currentTarget as HTMLInputElement).value));
  }

  const hint = $derived(
    rulerTool.mode === "emanation"
      ? "Selecione um token e clique no mapa."
      : isAreaMode(rulerTool.mode)
        ? "Arraste no mapa. Roda = tamanho. Shift ao soltar fixa."
        : rulerTool.mode === "ruler"
          ? "Clique e arraste no mapa."
          : "",
  );
</script>

<div class="ruler-tool">
  <button
    type="button"
    class="ruler-tool__main"
    class:ruler-tool__main--active={rulerTool.mode !== null}
    aria-pressed={rulerTool.mode !== null}
    aria-label="Régua (segure R)"
    title="Régua (segure R)"
    onclick={onMain}
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

  {#if open || rulerTool.mode !== null}
    <div class="ruler-tool__panel" role="group" aria-label="Ferramentas de medição">
      {#each TOOL_MODES as m (m.mode)}
        <button
          type="button"
          class="ruler-tool__mode"
          class:ruler-tool__mode--active={rulerTool.mode === m.mode}
          aria-pressed={rulerTool.mode === m.mode}
          onclick={() => {
            pick(m.mode);
          }}
        >
          {m.label}
        </button>
      {/each}
      {#if isAreaMode(rulerTool.mode)}
        <label class="ruler-tool__size">
          <span>Tamanho</span>
          <input
            type="number"
            min="5"
            max="500"
            step="5"
            value={rulerTool.sizeFt}
            onchange={onSize}
            aria-label="Tamanho em pés"
          />
          <span>pés</span>
        </label>
      {/if}
      {#if hint}
        <p class="ruler-tool__hint">{hint}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .ruler-tool {
    position: absolute;
    top: calc(var(--fusion-header-height) + 0.75rem);
    left: 0.75rem;
    z-index: 90;
    align-items: flex-start;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .ruler-tool__main,
  .ruler-tool__panel {
    background: rgba(24, 24, 31, 0.85);
    backdrop-filter: blur(6px);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
  }

  .ruler-tool__main {
    align-items: center;
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

  .ruler-tool__main:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .ruler-tool__main--active {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-bg);
  }

  .ruler-tool__main:focus-visible,
  .ruler-tool__mode:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }

  .ruler-tool__panel {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.35rem;
    min-width: 9.5rem;
  }

  .ruler-tool__mode {
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    padding: 0.3rem 0.6rem;
    text-align: left;
  }

  .ruler-tool__mode:hover {
    color: var(--fusion-text);
    border-color: var(--fusion-border);
  }

  .ruler-tool__mode--active {
    background: var(--fusion-accent);
    color: var(--fusion-bg);
  }

  .ruler-tool__size {
    align-items: center;
    color: var(--fusion-text-muted);
    display: flex;
    font-size: 0.75rem;
    gap: 0.35rem;
    padding: 0.2rem 0.3rem;
  }

  .ruler-tool__size input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
    padding: 0.15rem 0.3rem;
    width: 4rem;
  }

  .ruler-tool__hint {
    color: var(--fusion-text-subtle);
    font-size: 0.7rem;
    margin: 0;
    max-width: 11rem;
    padding: 0 0.3rem 0.2rem;
  }
</style>
