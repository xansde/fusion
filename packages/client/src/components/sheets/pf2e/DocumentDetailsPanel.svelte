<script lang="ts">
  /**
   * DocumentDetailsPanel.svelte — side/bottom details panel shown when a
   * row is selected in a compendium picker (W2-C2 feedback: "ao clicar,
   * abrir uma caixa na lateral mostrando descrição, traits, rolagens,
   * teste, etc.").
   *
   * Pure presentation component: the caller (SpellPickerDialog and,
   * eventually, CompendiumPickerDialog) owns the fetch (compendiumApi
   * .getDocument(uuid), cached per dialog session via DocumentDetailsCache)
   * and passes the loading/error/document state down as props. This keeps
   * the panel itself free of socket/session concerns and independently
   * testable/reusable.
   *
   * Layout: renders as a side column on wide viewports (>= 720px) and
   * collapses to a full-width block below the results list on narrow
   * viewports, per the task's "lateral (ou inferior em viewport estreito)"
   * requirement — done with CSS container-free media query on the dialog's
   * own width via a wrapping class toggled by the parent, kept simple here
   * with a straightforight max-width breakpoint.
   *
   * Rolagens/testes citados na descrição são texto por ora (nada
   * executável — V2), conforme o item 2 da tarefa.
   */

  import {
    sanitizeDescriptionHtml,
    buildMechanicalFields,
    buildDetailsHeader,
    pickLocalizedDescription,
    traitDisplayName,
    rarityDisplayName,
  } from "../../../lib/compendium/documentDetails.js";
  import { t, i18n } from "../../../lib/i18n/i18n.js";

  interface Props {
    /** Full document (system.description + system.* mechanical fields), or null before selection. */
    document: Record<string, unknown> | null;
    loading: boolean;
    error: boolean;
    onRetry: () => void;
    /**
     * The level at which the CALLER already knows this document was granted
     * (e.g. a Plan-column class-feature chip's `PlanDetailsRequest.level`,
     * issue #58) — overrides a classFeature document's own static
     * `system.level` for both the header badge and the "Level" mechanical
     * field, since class-features-core reuses 17 documents across classes
     * that grant them at different levels. null/omitted (the default) falls
     * back to the document's own level, so callers with no class context
     * (spell/feat pickers) render exactly as before.
     */
    contextLevel?: number | null;
    /**
     * i18n keys for the panel's state strings. Default to the spell-picker
     * namespace so existing callers (SpellPickerDialog) keep their copy; the
     * Actions tab overrides these with FUSION.Sheet.Actions.Details.* so the
     * hint/placeholder reads "Select an action", not "Select a spell".
     */
    loadingKey?: string;
    loadErrorKey?: string;
    retryKey?: string;
    selectHintKey?: string;
    noDescriptionKey?: string;
  }

  let {
    document: doc,
    loading,
    error,
    onRetry,
    contextLevel = null,
    loadingKey = "FUSION.Sheet.Spells.Picker.Details.Loading",
    loadErrorKey = "FUSION.Sheet.Spells.Picker.Details.LoadError",
    retryKey = "FUSION.Sheet.Spells.Picker.Details.Retry",
    selectHintKey = "FUSION.Sheet.Spells.Picker.Details.SelectHint",
    noDescriptionKey = "FUSION.Sheet.Spells.Picker.Details.NoDescription",
  }: Props = $props();

  const header = $derived(doc ? buildDetailsHeader(doc, i18n.locale, contextLevel ?? undefined) : null);
  const mechanicalFields = $derived(
    doc ? buildMechanicalFields(doc, i18n.locale, contextLevel ?? undefined) : [],
  );
  const descriptionHtml = $derived.by(() => {
    if (!doc) return "";
    // Prefer the pt-BR translation when the active locale is pt-BR and the
    // server attached one (doc.i18n.ptBR.description); fall back to the EN
    // system.description otherwise. Sanitized identically either way. T1.
    const description = pickLocalizedDescription(doc, i18n.locale);
    return description !== null ? sanitizeDescriptionHtml(description, i18n.locale) : "";
  });
</script>

<div class="details-panel">
  {#if loading}
    <div class="details-panel__state">{t(loadingKey)}</div>
  {:else if error}
    <div class="details-panel__state details-panel__state--error">
      <span>{t(loadErrorKey)}</span>
      <button type="button" class="details-panel__retry" onclick={onRetry}>
        {t(retryKey)}
      </button>
    </div>
  {:else if !doc || !header}
    <div class="details-panel__state">{t(selectHintKey)}</div>
  {:else}
    <div class="details-panel__header">
      <div class="details-panel__name-block">
        <h3 class="details-panel__name">{header.name}</h3>
        {#if header.subtitleEn}
          <span class="details-panel__name-en" title={header.subtitleEn}>{header.subtitleEn}</span>
        {/if}
      </div>
      {#if header.levelOrRank !== null}
        <span class="details-panel__rank">{header.levelOrRank}</span>
      {/if}
    </div>

    {#if header.traits.length > 0 || header.rarity}
      <div class="details-panel__traits">
        {#if header.rarity && header.rarity !== "common"}
          <span
            class="details-panel__trait details-panel__trait--rarity"
            title={header.rarity}
          >{rarityDisplayName(header.rarity, i18n.locale)}</span>
        {/if}
        {#each header.traits as trait (trait)}
          <!-- pt-BR chip text, EN slug kept in the tooltip for cross-reference. -->
          <span class="details-panel__trait" title={trait}>{traitDisplayName(trait, i18n.locale)}</span>
        {/each}
      </div>
    {/if}

    {#if mechanicalFields.length > 0}
      <dl class="details-panel__fields">
        {#each mechanicalFields as field (field.labelKey + field.value)}
          <div class="details-panel__field">
            <dt>{t(field.labelKey)}</dt>
            <dd>{field.value}</dd>
          </div>
        {/each}
      </dl>
    {/if}

    <div class="details-panel__description">
      {#if descriptionHtml}
        {@html descriptionHtml}
      {:else}
        <p class="details-panel__no-description">{t(noDescriptionKey)}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .details-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    overflow-y: auto;
  }

  .details-panel__state {
    padding: 32px 12px;
    text-align: center;
    font-size: 12.5px;
    color: var(--fusion-text-muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .details-panel__state--error {
    color: var(--fusion-danger);
  }

  .details-panel__retry {
    font-family: var(--fusion-font);
    font-weight: 600;
    cursor: pointer;
    padding: 6px 12px;
    font-size: 12px;
    border-radius: var(--fusion-radius);
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
  }

  .details-panel__retry:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .details-panel__header {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .details-panel__name-block {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .details-panel__name {
    font-size: 14px;
    font-weight: 700;
    margin: 0;
    color: var(--fusion-text);
  }

  .details-panel__name-en {
    font-size: 10.5px;
    font-weight: 500;
    color: var(--fusion-text-subtle);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .details-panel__rank {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font-mono);
  }

  .details-panel__traits {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .details-panel__trait {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    padding: 2px 7px;
    border-radius: var(--fusion-radius-sm);
  }

  .details-panel__trait--rarity {
    color: var(--fusion-accent);
    border-color: var(--fusion-accent);
  }

  .details-panel__fields {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 10px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
  }

  .details-panel__field {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 11.5px;
  }

  .details-panel__field dt {
    color: var(--fusion-text-subtle);
    font-weight: 600;
    flex-shrink: 0;
  }

  .details-panel__field dd {
    margin: 0;
    color: var(--fusion-text);
    text-align: right;
  }

  .details-panel__description {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--fusion-text);
  }

  .details-panel__description :global(p) {
    margin: 0 0 8px;
  }

  .details-panel__description :global(p:last-child) {
    margin-bottom: 0;
  }

  .details-panel__description :global(ul),
  .details-panel__description :global(ol) {
    margin: 0 0 8px;
    padding-left: 18px;
  }

  .details-panel__description :global(hr) {
    border: none;
    border-top: 1px solid var(--fusion-border);
    margin: 10px 0;
  }

  .details-panel__no-description {
    color: var(--fusion-text-subtle);
    font-style: italic;
    margin: 0;
  }
</style>
