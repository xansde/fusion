<script lang="ts">
  /**
   * FamiliarAbilityPicker.svelte — daily familiar-ability selector (spec 29
   * r16-G4). A searchable checklist over the familiar-abilities-core pack
   * (bilingual EN/pt-BR names) that enforces the derived slot budget: once
   * `abilitiesBudget.max` slots are used, unselected rows are disabled.
   *
   * Rows are loaded by the parent PetCard (shared with the collapsed chips) and
   * passed in; this component owns only the search + toggle interaction.
   *
   * Clean-room: remaster (ORC) mechanics only.
   */

  import { t } from "$lib/i18n/i18n.js";
  import {
    filterAbilityRows,
    buildToggleAbilityOp,
    type LinkedFamiliar,
    type AbilityRow,
    type AbilitiesLoadError,
    type UpdateFamiliarOp,
  } from "../../../../lib/sheets/pf2e/petsVM.js";

  interface Props {
    familiar: LinkedFamiliar;
    rows: AbilityRow[];
    loading: boolean;
    error: AbilitiesLoadError;
    onRetry: () => void;
    onOp: (op: UpdateFamiliarOp) => void;
  }

  let { familiar, rows, loading, error, onRetry, onOp }: Props = $props();

  let search = $state("");

  const selected = $derived(new Set(familiar.selectedAbilities));
  const atCap = $derived(familiar.selectedAbilities.length >= familiar.abilitiesBudget.max);
  const filtered = $derived(filterAbilityRows(rows, search));

  function toggle(row: AbilityRow): void {
    const op = buildToggleAbilityOp(familiar, row.slug);
    if (op) onOp(op);
  }
</script>

<div class="fam-picker">
  <div class="fam-picker__search">
    <span class="fam-picker__search-icon" aria-hidden="true">&#128269;</span>
    <input
      type="text"
      class="fam-picker__search-input"
      placeholder={t("FUSION.Sheet.Pets.SearchAbilities")}
      bind:value={search}
    />
  </div>

  {#if loading}
    <p class="fam-picker__state">{t("FUSION.Sheet.Pets.LoadingAbilities")}</p>
  {:else if error}
    <div class="fam-picker__state fam-picker__state--error">
      <span>
        {error === "not-connected"
          ? t("FUSION.Sheet.Actions.NotConnected")
          : t("FUSION.Sheet.Actions.LoadError")}
      </span>
      <button class="fam-picker__retry" onclick={onRetry}>{t("FUSION.Sheet.Actions.Retry")}</button>
    </div>
  {:else if filtered.length === 0}
    <p class="fam-picker__state">{t("FUSION.Sheet.Actions.NoResults")}</p>
  {:else}
    <div class="fam-picker__list">
      {#each filtered as row (row.slug)}
        {@const isSelected = selected.has(row.slug)}
        {@const disabled = !isSelected && atCap}
        <label class="fam-row" class:fam-row--selected={isSelected} class:fam-row--disabled={disabled}>
          <input
            type="checkbox"
            checked={isSelected}
            {disabled}
            onchange={() => toggle(row)}
          />
          <span class="fam-row__name">
            {row.name}
            {#if row.actionCost}
              <span
                class="fam-row__cost"
                class:fam-row__cost--text={row.actionCost.isText}
                title={row.actionCost.title}
              >{row.actionCost.display}</span>
            {/if}
            {#if row.subtitleEn}
              <span class="fam-row__en">{row.subtitleEn}</span>
            {/if}
          </span>
        </label>
      {/each}
    </div>
  {/if}
</div>

<style>
  .fam-picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .fam-picker__search {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 5px 10px;
  }

  .fam-picker__search:focus-within {
    border-color: var(--fusion-accent);
  }

  .fam-picker__search-icon {
    color: var(--fusion-text-subtle);
    font-size: 12px;
  }

  .fam-picker__search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--fusion-text);
    font-size: 12.5px;
    font-family: var(--fusion-font);
  }

  .fam-picker__state {
    margin: 0;
    padding: 14px 8px;
    text-align: center;
    font-size: 12px;
    color: var(--fusion-text-muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .fam-picker__state--error {
    color: var(--fusion-danger);
  }

  .fam-picker__retry {
    font-family: var(--fusion-font);
    font-weight: 600;
    cursor: pointer;
    padding: 4px 10px;
    font-size: 11px;
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
  }

  .fam-picker__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 4px;
  }

  .fam-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 5px 8px;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    user-select: none;
  }

  .fam-row:hover {
    background: var(--fusion-surface);
  }

  .fam-row--selected {
    background: var(--fusion-accent-dim);
  }

  .fam-row--disabled {
    opacity: 0.45;
    cursor: default;
  }

  .fam-row input {
    accent-color: var(--fusion-accent);
    cursor: inherit;
    margin: 0;
  }

  .fam-row__name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .fam-row__cost {
    margin-left: 6px;
    font-size: 11px;
    font-weight: 700;
    color: var(--fusion-accent);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .fam-row__cost--text {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--fusion-text-subtle);
    letter-spacing: 0;
  }

  .fam-row__en {
    margin-left: 6px;
    font-size: 10.5px;
    font-weight: 400;
    color: var(--fusion-text-subtle);
  }
</style>
