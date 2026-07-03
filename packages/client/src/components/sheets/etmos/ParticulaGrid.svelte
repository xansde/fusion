<script lang="ts">
  /**
   * ParticulaGrid.svelte — selectable grid of Grimório Partículas.
   *
   * Reused by every step of the Compositor (Função/Objeto/Característica) and
   * by ComplementoGrid-like usage for Complementos. Placeholder tipográfico
   * (D7, REQ-ETM-047): each cell shows the Etmos word styled + colored by
   * categoria — NO proprietary rune art, `icone_runico` stays an empty slot.
   *
   * Design doc m5-etmos-compositor.md §3.5.
   */
  import { t } from "$lib/i18n/i18n.js";
  import type { ParticulaOption } from "$lib/sheets/etmos/compositorVM.js";

  interface Props {
    options: ParticulaOption[];
    categoria: "funcao" | "objeto" | "caracteristica" | "complemento";
    emptyLabelKey: string;
    onToggle: (slug: string) => void;
  }

  const { options, categoria, emptyLabelKey, onToggle }: Props = $props();
</script>

<div class="particula-grid particula-grid--{categoria}" role="list" aria-label={categoria}>
  {#if options.length === 0}
    <p class="particula-grid__empty">{t(emptyLabelKey)}</p>
  {:else}
    {#each options as opt (opt.slug)}
      <button
        type="button"
        class="particula-cell particula-cell--{categoria}"
        class:particula-cell--selected={opt.selected}
        class:particula-cell--disabled={!opt.disponivel}
        disabled={!opt.disponivel}
        onclick={() => onToggle(opt.slug)}
        role="listitem"
        aria-pressed={opt.selected}
        title={opt.significado}
      >
        <span class="particula-cell__word">{opt.palavra}</span>
        {#if opt.significado}
          <span class="particula-cell__meaning">{opt.significado}</span>
        {/if}
      </button>
    {/each}
  {/if}
</div>

<style>
  .particula-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 6px;
  }

  .particula-grid__empty {
    grid-column: 1 / -1;
    color: var(--fusion-text-muted);
    font-size: 12px;
    padding: 8px 0;
  }

  .particula-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 6px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface);
    cursor: pointer;
    transition: background var(--fusion-transition), border-color var(--fusion-transition);
  }

  .particula-cell:hover:not(.particula-cell--disabled),
  .particula-cell:focus-visible {
    border-color: var(--fusion-accent);
  }

  .particula-cell--disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .particula-cell__word {
    font-weight: 700;
    font-size: 13px;
    font-family: var(--fusion-font-mono);
  }

  .particula-cell__meaning {
    font-size: 9px;
    color: var(--fusion-text-muted);
    text-align: center;
  }

  /* Placeholder tipográfico — cor por categoria (D7, REQ-ETM-047) */
  .particula-cell--funcao .particula-cell__word { color: #ff8b6a; }
  .particula-cell--objeto .particula-cell__word { color: #66aaff; }
  .particula-cell--caracteristica .particula-cell__word { color: #3ddc84; }
  .particula-cell--complemento .particula-cell__word { color: #cc88ff; }

  .particula-cell--selected {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
  }

  .particula-cell--selected .particula-cell__word {
    color: var(--fusion-text);
  }
</style>
