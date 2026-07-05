<script lang="ts">
  /**
   * ActionsTab.svelte — Pathbuilder-style action browser for the PF2e sheet's
   * Actions tab (below the existing Strikes section, which lives in
   * CharacterSheet.svelte and is NOT owned here).
   *
   * LAYOUT
   *   - A filter grid of group checkboxes (Class, Skills, Gear, Basic,
   *     Exploration, Downtime, Ancestry, Archetype, Background, Other — all
   *     enabled by default), each rendered with its localized label.
   *   - A cost sub-filter row (◆ / ◆◆ / ◆◆◆ / ⟳ / ◇) toggling the action-cost
   *     kinds, plus a name search box.
   *   - The result list: each row shows name, cost glyphs, a group badge, and a
   *     "do personagem" badge when the action comes from an embedded actor item.
   *     Character actions sort first. Light client-side pagination caps the
   *     rendered rows (the pack has hundreds of actions) with a "show more".
   *   - Clicking a row opens the shared DocumentDetailsPanel with the full,
   *     sanitized description fetched on demand (pack rows only — character-only
   *     rows have no compendium uuid and show their inline info).
   *
   * DATA / SOCKET
   *   The actions-core pack is loaded through the SAME compendium socket API the
   *   pickers use (actionsVM.loadActionEntries), resolving the LIVE socket via
   *   getSocket() on demand — never a frozen prop (r10 lesson). Explicit
   *   loading / not-connected / load-error states with retry (never an endless
   *   spinner). Embedded actor actions are merged in from the `doc.items` array.
   *
   * Clean-room: description prose shown in the details panel is ORC/OGL-gated at
   * import time (W2-C1/stripFlavorProse) and only rendered here (sanitized,
   * allow-listed tags, @Tag[...] refs rewritten to text — documentDetails.ts).
   */

  import type { PackIndexEntry } from "@fusion/shared";
  import DocumentDetailsPanel from "./DocumentDetailsPanel.svelte";
  import { getDocument, requireConnectedSocket } from "../../../lib/compendium/compendiumApi.js";
  import { DocumentDetailsCache } from "../../../lib/compendium/documentDetails.js";
  import {
    loadActionEntries,
    classifyLoadError,
    mergeActionRows,
    filterActionRows,
    sortActionRows,
    buildEmbeddedDetailsDoc,
    paginate,
    ACTIONS_PAGE_SIZE,
    GROUP_ORDER,
    type ActionRow,
    type ActionCostFilter,
    type ActionsLoadError,
  } from "../../../lib/sheets/pf2e/actionsVM.js";
  import {
    ACTION_GROUP_LABELS,
    groupLabelKey,
    type ActionGroup,
  } from "../../../lib/sheets/pf2e/actionCategories.js";
  import { session, getSocket } from "../../../lib/session.svelte.js";
  import { t } from "../../../lib/i18n/i18n.js";

  interface Props {
    /** The reactive actor document — its `items` array feeds character actions. */
    doc: Record<string, unknown>;
  }

  let { doc }: Props = $props();

  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");

  // --- Load state -----------------------------------------------------------
  let loading = $state(true);
  let errorKind = $state<ActionsLoadError>(null);
  let packEntries = $state<PackIndexEntry[]>([]);

  // --- Filter state ---------------------------------------------------------
  // Runes can't hold a Set reactively across mutation the way we want without a
  // reassign, so we mirror the group toggles / cost toggles as plain reactive
  // structures and rebuild the ActionFilterState in a $derived.
  let enabledGroups = $state<Set<ActionGroup>>(new Set(GROUP_ORDER));
  let enabledCosts = $state<Set<ActionCostFilter>>(new Set());
  let search = $state("");

  // --- Details panel state --------------------------------------------------
  const detailsCache = new DocumentDetailsCache();
  let selectedKey = $state<string | null>(null);
  let detailsDoc = $state<Record<string, unknown> | null>(null);
  let detailsLoading = $state(false);
  let detailsError = $state(false);

  // --- Pagination -----------------------------------------------------------
  let visibleCount = $state(ACTIONS_PAGE_SIZE);

  const COST_CHIPS: Array<{ cost: ActionCostFilter; glyphs: string; labelKey: string }> = [
    { cost: "1", glyphs: "◆", labelKey: "FUSION.Sheet.Actions.Cost.One" },
    { cost: "2", glyphs: "◆◆", labelKey: "FUSION.Sheet.Actions.Cost.Two" },
    { cost: "3", glyphs: "◆◆◆", labelKey: "FUSION.Sheet.Actions.Cost.Three" },
    { cost: "reaction", glyphs: "⟳", labelKey: "FUSION.Sheet.Actions.Cost.Reaction" },
    { cost: "free", glyphs: "◇", labelKey: "FUSION.Sheet.Actions.Cost.Free" },
  ];

  $effect(() => {
    void loadActions();
  });

  async function loadActions(): Promise<void> {
    loading = true;
    errorKind = null;
    try {
      packEntries = await loadActionEntries(getSocket, systemId);
    } catch (err) {
      errorKind = classifyLoadError(err);
      packEntries = [];
    } finally {
      loading = false;
    }
  }

  const embeddedItems = $derived.by((): Array<Record<string, unknown>> => {
    const items = doc["items"];
    if (!Array.isArray(items)) return [];
    return items.filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null);
  });

  // Index embedded items by their _id so a selected character row can render
  // its OWN description without any compendium fetch (key is "embedded:<_id>").
  const embeddedById = $derived.by((): Map<string, Record<string, unknown>> => {
    const map = new Map<string, Record<string, unknown>>();
    for (const it of embeddedItems) {
      const id = it["_id"];
      if (typeof id === "string") map.set(id, it);
    }
    return map;
  });

  const allRows = $derived(mergeActionRows(packEntries, embeddedItems));

  const filtered = $derived.by(() => {
    const rows = filterActionRows(allRows, {
      groups: enabledGroups,
      costs: enabledCosts,
      search,
    });
    return sortActionRows(rows);
  });

  const page = $derived(paginate(filtered, visibleCount));
  const visibleRows = $derived(page.visible);

  // Reset pagination whenever the filter result set changes shape.
  $effect(() => {
    // Touch the length so this re-runs when filters change.
    void filtered.length;
    visibleCount = ACTIONS_PAGE_SIZE;
  });

  function toggleGroup(group: ActionGroup): void {
    const next = new Set(enabledGroups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    enabledGroups = next;
  }

  function toggleCost(cost: ActionCostFilter): void {
    const next = new Set(enabledCosts);
    if (next.has(cost)) next.delete(cost);
    else next.add(cost);
    enabledCosts = next;
  }

  function selectRow(rowItem: ActionRow): void {
    selectedKey = rowItem.key;
    if (rowItem.uuid) {
      void loadDetails(rowItem.key, rowItem.uuid);
    } else {
      // Character-only action with no compendium uuid — render the embedded
      // item's OWN description directly (no fetch). Key is "embedded:<_id>".
      const itemId = rowItem.key.startsWith("embedded:") ? rowItem.key.slice("embedded:".length) : "";
      detailsDoc = buildEmbeddedDetailsDoc(embeddedById.get(itemId));
      detailsLoading = false;
      detailsError = false;
    }
  }

  async function loadDetails(key: string, uuid: string): Promise<void> {
    const cached = detailsCache.get(uuid);
    if (cached) {
      detailsDoc = cached;
      detailsError = false;
      return;
    }
    detailsLoading = true;
    detailsError = false;
    try {
      const sock = requireConnectedSocket(getSocket());
      const { document } = await getDocument(sock, uuid);
      detailsCache.set(uuid, document);
      if (selectedKey === key) detailsDoc = document;
    } catch {
      if (selectedKey === key) {
        detailsError = true;
        detailsDoc = null;
      }
    } finally {
      if (selectedKey === key) detailsLoading = false;
    }
  }

  function retryDetails(): void {
    const rowItem = filtered.find((r) => r.key === selectedKey);
    if (rowItem?.uuid) void loadDetails(rowItem.key, rowItem.uuid);
  }

  function groupBadgeLabel(group: ActionGroup): string {
    return t(groupLabelKey(group)) || ACTION_GROUP_LABELS[group];
  }
</script>

<div class="actions-browser">
  <div class="actions-browser__main">
    <!-- Group filter grid -->
    <div class="actions-filters" role="group" aria-label={t("FUSION.Sheet.Actions.GroupsLabel")}>
      {#each GROUP_ORDER as group (group)}
        <label class="actions-check" class:actions-check--on={enabledGroups.has(group)}>
          <input
            type="checkbox"
            checked={enabledGroups.has(group)}
            onchange={() => toggleGroup(group)}
          />
          <span>{groupBadgeLabel(group)}</span>
        </label>
      {/each}
    </div>

    <!-- Cost sub-filter + search -->
    <div class="actions-controls">
      <div class="actions-cost-filters" role="group" aria-label={t("FUSION.Sheet.Actions.CostLabel")}>
        {#each COST_CHIPS as chip (chip.cost)}
          <button
            type="button"
            class="actions-cost-chip"
            class:actions-cost-chip--active={enabledCosts.has(chip.cost)}
            aria-pressed={enabledCosts.has(chip.cost)}
            aria-label={t(chip.labelKey)}
            title={t(chip.labelKey)}
            onclick={() => toggleCost(chip.cost)}
          >
            <span class="actions-cost-chip__glyph">{chip.glyphs}</span>
          </button>
        {/each}
      </div>
      <div class="actions-search">
        <span class="actions-search__icon" aria-hidden="true">&#128269;</span>
        <input
          type="text"
          class="actions-search__input"
          placeholder={t("FUSION.Sheet.Actions.SearchPlaceholder")}
          bind:value={search}
        />
      </div>
    </div>

    <!-- Result list -->
    <div class="actions-results">
      {#if loading}
        <div class="actions-empty">{t("FUSION.Sheet.Actions.Loading")}</div>
      {:else if errorKind}
        <div class="actions-empty actions-empty--error">
          <span>
            {errorKind === "not-connected"
              ? t("FUSION.Sheet.Actions.NotConnected")
              : t("FUSION.Sheet.Actions.LoadError")}
          </span>
          <button type="button" class="actions-retry" onclick={() => void loadActions()}>
            {t("FUSION.Sheet.Actions.Retry")}
          </button>
        </div>
      {:else if filtered.length === 0}
        <div class="actions-empty">
          <span>{t("FUSION.Sheet.Actions.NoResults")}</span>
          <span class="actions-empty__hint">{t("FUSION.Sheet.Actions.NoResultsHint")}</span>
        </div>
      {:else}
        {#each visibleRows as rowItem (rowItem.key)}
          <div
            class="actions-row"
            class:actions-row--selected={selectedKey === rowItem.key}
            role="button"
            tabindex="0"
            onclick={() => selectRow(rowItem)}
            onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectRow(rowItem); } }}
          >
            <span class="actions-row__cost" aria-hidden="true">{rowItem.cost.glyphs}</span>
            <div class="actions-row__main">
              <div class="actions-row__name">{rowItem.name}</div>
              {#if rowItem.traits.length > 0}
                <div class="actions-row__traits">
                  {#each rowItem.traits as trait (trait)}
                    <span class="actions-row__trait">{trait}</span>
                  {/each}
                </div>
              {/if}
            </div>
            <div class="actions-row__badges">
              {#if rowItem.fromCharacter}
                <span class="actions-badge actions-badge--character">
                  {t("FUSION.Sheet.Actions.FromCharacter")}
                </span>
              {/if}
              <span class="actions-badge actions-badge--group">{groupBadgeLabel(rowItem.group)}</span>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    {#if !loading && !errorKind && page.hasMore}
      <button
        type="button"
        class="actions-showmore"
        onclick={() => { visibleCount += ACTIONS_PAGE_SIZE; }}
      >
        {t("FUSION.Sheet.Actions.ShowMore", { count: page.remaining })}
      </button>
    {/if}
  </div>

  <div class="actions-browser__side">
    {#if selectedKey === null}
      <div class="actions-side-hint">{t("FUSION.Sheet.Actions.Details.SelectHint")}</div>
    {:else}
      <DocumentDetailsPanel
        document={detailsDoc}
        loading={detailsLoading}
        error={detailsError}
        onRetry={retryDetails}
        loadingKey="FUSION.Sheet.Actions.Details.Loading"
        loadErrorKey="FUSION.Sheet.Actions.Details.LoadError"
        retryKey="FUSION.Sheet.Actions.Details.Retry"
        selectHintKey="FUSION.Sheet.Actions.Details.SelectHint"
        noDescriptionKey="FUSION.Sheet.Actions.Details.NoDescription"
      />
    {/if}
  </div>
</div>

<style>
  .actions-browser {
    display: flex;
    flex-direction: row;
    gap: 14px;
    min-height: 0;
  }

  .actions-browser__main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .actions-browser__side {
    width: 300px;
    flex-shrink: 0;
    border-left: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt);
    border-radius: var(--fusion-radius);
    overflow-y: auto;
    max-height: 480px;
  }

  @media (max-width: 720px) {
    .actions-browser {
      flex-direction: column;
    }

    .actions-browser__side {
      width: 100%;
      border-left: none;
      border-top: 1px solid var(--fusion-border);
      max-height: 260px;
    }
  }

  .actions-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .actions-check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--fusion-font);
    padding: 4px 10px;
    border-radius: var(--fusion-radius-pill);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
    background: transparent;
    cursor: pointer;
    user-select: none;
  }

  .actions-check input {
    accent-color: var(--fusion-accent);
    cursor: pointer;
    margin: 0;
  }

  .actions-check--on {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .actions-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .actions-cost-filters {
    display: flex;
    gap: 5px;
  }

  .actions-cost-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--fusion-radius);
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-family: var(--fusion-font-mono);
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }

  .actions-cost-chip:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .actions-cost-chip--active {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .actions-cost-chip__glyph {
    font-size: 11px;
    line-height: 1;
    letter-spacing: -1px;
  }

  .actions-search {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 160px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 6px 12px;
  }

  .actions-search:focus-within {
    border-color: var(--fusion-accent);
  }

  .actions-search__icon {
    color: var(--fusion-text-subtle);
    font-size: 13px;
    line-height: 1;
  }

  .actions-search__input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--fusion-text);
    font-size: 13px;
    font-family: var(--fusion-font);
  }

  .actions-results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 4px;
    /*
     * No inner max-height/overflow: the whole list flows in the tab panel,
     * which is the single vertical scroller (.tab-panel: overflow-y: auto).
     * A nested scroller here buried the "show more" button (r12 blocker) and
     * fought the outer scroll — keeping one scroller lets the user reach every
     * row and the button below the list.
     */
  }

  .actions-empty {
    padding: 28px 12px;
    text-align: center;
    font-size: 13px;
    color: var(--fusion-text-muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .actions-empty--error {
    color: var(--fusion-danger);
  }

  .actions-empty__hint {
    font-size: 11.5px;
    color: var(--fusion-text-subtle);
  }

  .actions-retry {
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

  .actions-retry:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .actions-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
  }

  .actions-row:hover {
    background: var(--fusion-surface-alt);
  }

  .actions-row--selected {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
  }

  .actions-row__cost {
    min-width: 30px;
    text-align: center;
    flex-shrink: 0;
    font-family: var(--fusion-font-mono);
    font-size: 11px;
    letter-spacing: -1px;
    color: var(--fusion-text-muted);
  }

  .actions-row--selected .actions-row__cost {
    color: var(--fusion-accent);
  }

  .actions-row__main {
    flex: 1;
    min-width: 0;
  }

  .actions-row__name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .actions-row__traits {
    display: flex;
    gap: 4px;
    margin-top: 3px;
    flex-wrap: wrap;
  }

  .actions-row__trait {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    padding: 1px 6px;
    border-radius: var(--fusion-radius-sm);
  }

  .actions-row__badges {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  .actions-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 7px;
    border-radius: var(--fusion-radius-sm);
    white-space: nowrap;
  }

  .actions-badge--group {
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
  }

  .actions-badge--character {
    color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
    border: 1px solid var(--fusion-accent);
  }

  .actions-showmore {
    align-self: center;
    margin: 2px 0;
    font-family: var(--fusion-font);
    font-weight: 600;
    font-size: 11.5px;
    cursor: pointer;
    padding: 6px 14px;
    border-radius: var(--fusion-radius-pill);
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
  }

  .actions-showmore:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .actions-side-hint {
    padding: 32px 14px;
    text-align: center;
    font-size: 12.5px;
    color: var(--fusion-text-muted);
  }
</style>
