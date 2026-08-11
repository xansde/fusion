<script lang="ts">
  /**
   * IsekaiArchetypeSelector.svelte — pick up to two of the eight Isekai
   * archetypes, in the Plan column's configuration area.
   *
   * Shown only while the variant toggle is on. Each card states the archetype
   * name, its axis and — the part that actually drives the choice — the PF2e
   * law it revokes. Cards beyond the cap are disabled rather than hidden: the
   * player should see what they are NOT taking, and why they can't.
   */

  import { ISEKAI_ARCHETYPES, MAX_ISEKAI_ARCHETYPES } from "../../../../lib/sheets/pf2e/isekai/index.js";
  import { t } from "../../../../lib/i18n/i18n.js";

  interface Props {
    /** Archetype ids currently on the sheet. */
    selected: string[];
    editable: boolean;
    onToggle: (archetypeId: string) => void;
  }

  let { selected, editable, onToggle }: Props = $props();

  const remaining = $derived(MAX_ISEKAI_ARCHETYPES - selected.length);
</script>

<div class="isekai-selector">
  <div class="isekai-selector__hint">
    {#if remaining > 0}
      {t("FUSION.Sheet.Isekai.PickHint", { n: String(remaining) })}
    {:else}
      {t("FUSION.Sheet.Isekai.PickComplete")}
    {/if}
  </div>

  <div class="isekai-selector__grid">
    {#each ISEKAI_ARCHETYPES as arq (arq.id)}
      {@const on = selected.includes(arq.id)}
      <button
        type="button"
        class="isekai-card"
        class:isekai-card--on={on}
        style={`--accent: ${arq.color}`}
        disabled={!editable || (!on && remaining <= 0)}
        aria-pressed={on}
        title={arq.tagline}
        onclick={() => onToggle(arq.id)}
      >
        <span class="isekai-card__name">{arq.name}</span>
        <span class="isekai-card__axis">{arq.axis}</span>
        <span class="isekai-card__revokes">
          <span class="isekai-card__revokes-label">{t("FUSION.Sheet.Isekai.Revokes")}</span>
          {arq.revokes}
        </span>
      </button>
    {/each}
  </div>
</div>

<style>
  .isekai-selector {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 4px 0 10px;
  }

  .isekai-selector__hint {
    font-size: 11px;
    color: var(--fusion-text-muted);
  }

  .isekai-selector__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 6px;
  }

  .isekai-card {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    padding: 8px 9px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-left: 3px solid color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: var(--fusion-radius);
    cursor: pointer;
    font-family: var(--fusion-font);
    transition:
      border-color 0.12s,
      background 0.12s;
  }

  .isekai-card:hover:not(:disabled) {
    border-color: var(--accent);
    border-left-color: var(--accent);
  }

  .isekai-card--on {
    border-color: var(--accent);
    border-left-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--fusion-surface));
  }

  .isekai-card:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .isekai-card__name {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.02em;
  }

  .isekai-card__axis {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fusion-text-subtle);
  }

  .isekai-card__revokes {
    font-size: 10.5px;
    line-height: 1.35;
    color: var(--fusion-text-muted);
  }

  .isekai-card__revokes-label {
    font-weight: 700;
    color: var(--fusion-text-subtle);
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.05em;
    margin-right: 3px;
  }
</style>
