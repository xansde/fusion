<script lang="ts">
  /**
   * SpellPickerDialog.svelte — compendium spell picker modal (DEC-R10-04).
   *
   * Ports the design contract's SpellPicker.jsx + Modal/SearchBox/Chip/ResultRow
   * (.fusion-build/r10-design/claude-design/ui_kits/ficha-pf2e/SpellPicker.jsx)
   * to Svelte 5. Two modes:
   *   - "add"  — search the tradition's spell pack, pick a spell, emit onAdd(doc)
   *              (VM.addSpellToEntry builds the doc:create op from this).
   *   - "swap" — same search UI but restricted to `maxRank` (used when trading a
   *              prepared slot; caller narrows results to the grimoire/rank).
   *
   * Data comes from compendiumApi.searchPack/getDocument against the active
   * system's spells pack (`<systemId>.spells-core`), filtered client-side via
   * the C2 VM helpers (rank ceiling + tradition + accent-insensitive name
   * search), sorted rank → name.
   *
   * SOCKET: resolved LIVE via getSocket() on every operation — never held as
   * a prop. Sheet windows outlive socket reconnects (componentProps are
   * frozen at open time, and SocketManager.connect() replaces the Socket
   * instance), so a prop-captured socket goes stale and its emits get
   * silently buffered forever — the "endless spinner, zero ops on the
   * server" bug. requireConnectedSocket() fails fast instead, and the error
   * state offers an explicit retry.
   *
   * FILTERS: search box + rank chips are always visible; tradition + trait
   * chips live in a collapsed "More filters" section. The tradition filter
   * is a SOFT default (resolveInitialTradition) — it is only pre-applied
   * when it matches at least one entry, so the list is never empty on open.
   * Trait chips (W2-F) are bucketed into curated semantic groups via
   * lib/sheets/pf2e/traitGroups.ts (groupTraits) instead of one flat
   * alphabetical row — each group renders under its own i18n'd subtitle,
   * plus a free-text trait search box that narrows within groups without
   * changing the selected traitFilter.
   *
   * DETAILS PANEL (W2-C2): selecting a row fetches the full document via
   * compendiumApi.getDocument(uuid) on demand (cached per uuid for this
   * dialog instance via DocumentDetailsCache — see loadDetails/confirmSelection,
   * which reuse the same cache entry to avoid a duplicate round-trip) and
   * renders it in the side (bottom, on narrow viewports) panel:
   * DocumentDetailsPanel.svelte. Description HTML is sanitized (allow-listed
   * tags only, @UUID/@Damage/@Check/@Template inline refs rewritten to
   * readable text — see lib/compendium/documentDetails.ts) — never executed,
   * that's V2. The row list itself still only shows mechanical index fields
   * (rank, traits) — the description/full mechanics only render in the
   * details panel once a row is selected; the footer note reflects that
   * the description content shown is ORC/OGL-gated at import time
   * (W2-C1/stripFlavorProse), not stripped by this component.
   */

  import type { PackIndexEntry } from "@fusion/shared";
  import {
    listPacks,
    searchPack,
    getDocument,
    requireConnectedSocket,
    SocketUnavailableError,
  } from "$lib/compendium/compendiumApi.js";
  import {
    DocumentDetailsCache,
    localizedNameParts,
    formatIndexActionCost,
    traitDisplayName,
  } from "$lib/compendium/documentDetails.js";
  import DocumentDetailsPanel from "./DocumentDetailsPanel.svelte";
  import {
    filterSpellPicker,
    sortSpellPickerEntries,
    resolveInitialTradition,
  } from "../../../lib/sheets/pf2e/characterSheetVM.js";
  import { groupTraits } from "../../../lib/sheets/pf2e/traitGroups.js";
  import { normalizeSearchText } from "@fusion/shared";
  import { session, getSocket } from "$lib/session.svelte.js";
  import { t, i18n } from "$lib/i18n/i18n.js";

  interface Props {
    /** Tradition to pre-filter results to (e.g. "arcane"). Soft default — see docstring. */
    tradition: string;
    /** Human label for the tradition, e.g. "Arcana" (header text). */
    traditionLabel: string;
    /** Entry/grimoire label shown in the modal title. */
    entryLabel: string;
    /** Cap the results to this rank (used for "swap into rank N slot"). Omit for "add any". */
    maxRank?: number | undefined;
    /** Pre-select this rank chip (the slot's rank when opened from an empty slot). */
    initialRank?: number | undefined;
    /** Pre-select this trait chip (e.g. "focus" when adding a focus spell). */
    initialTrait?: string | undefined;
    onClose: () => void;
    onSelect: (doc: Record<string, unknown>) => void;
  }

  let { tradition, traditionLabel, entryLabel, maxRank, initialRank, initialTrait, onClose, onSelect }: Props =
    $props();

  let query = $state("");
  // svelte-ignore state_referenced_locally — intentional: initialRank seeds
  // the chip selection at mount only (the dialog is recreated per opening);
  // later prop changes must NOT clobber the user's manual chip choice.
  let rankFilter = $state<number | null>(initialRank ?? null);
  let traditionFilter = $state<string | null>(null);
  // svelte-ignore state_referenced_locally — initialTrait seeds the trait chip
  // at mount only (the dialog is recreated per opening); later prop changes
  // must not clobber the user's manual chip choice.
  let traitFilter = $state<string | null>(initialTrait ?? null);
  let traitSearch = $state("");
  // Open "More filters" by default when a trait is pre-selected, so the user
  // sees the active focus-trait chip (it lives in that collapsed section).
  // svelte-ignore state_referenced_locally — mount-only seed (see above).
  let moreFiltersOpen = $state(Boolean(initialTrait));
  let selectedUuid = $state<string | null>(null);
  let loading = $state(true);
  let errorKind = $state<"not-connected" | "load" | null>(null);
  let entries = $state<PackIndexEntry[]>([]);
  let submitting = $state(false);

  // --- Details panel state (W2-C2) -----------------------------------------
  // Cache is created once per dialog instance (not module-level) so a
  // closed/reopened dialog always starts with a clean cache and separate
  // dialog instances never share entries.
  const detailsCache = new DocumentDetailsCache();
  let detailsDoc = $state<Record<string, unknown> | null>(null);
  let detailsLoading = $state(false);
  let detailsError = $state(false);

  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");

  $effect(() => {
    void loadSpells();
  });

  async function loadSpells(): Promise<void> {
    loading = true;
    errorKind = null;
    try {
      const sock = requireConnectedSocket(getSocket());
      const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
      const spellPack = packs.find((p) => p.id.endsWith(".spells-core")) ?? packs[0];
      if (!spellPack) {
        entries = [];
        traditionFilter = null;
        return;
      }
      const { entries: found } = await searchPack(sock, { packId: spellPack.id });
      entries = found;
      // Soft tradition default: only pre-apply when it actually matches
      // something, so the picker never opens onto an empty list.
      traditionFilter = resolveInitialTradition(found, tradition);
    } catch (err) {
      errorKind = err instanceof SocketUnavailableError ? "not-connected" : "load";
    } finally {
      loading = false;
    }
  }

  /** Every distinct trait across the loaded index (for the trait filter chips). */
  const availableTraits = $derived.by(() => {
    const set = new Set<string>();
    for (const e of entries) {
      const raw = e.index["system.traits.value"];
      if (Array.isArray(raw)) for (const v of raw) if (typeof v === "string") set.add(v);
    }
    return Array.from(set).sort();
  });

  /**
   * availableTraits bucketed into curated semantic groups (traitGroups.ts,
   * W2-F) — replaces the single flat alphabetical chip row. traitSearch
   * narrows within groups (a trait not matching the search is dropped from
   * its group; groups left empty by the search are omitted, same as an
   * empty group from the base data).
   */
  const groupedTraits = $derived.by(() => {
    const searchNorm = traitSearch.trim() ? normalizeSearchText(traitSearch.trim()) : null;
    const groups = groupTraits(availableTraits);
    if (!searchNorm) return groups;
    return groups
      .map((g) => ({ ...g, traits: g.traits.filter((tr) => normalizeSearchText(tr).includes(searchNorm)) }))
      .filter((g) => g.traits.length > 0);
  });

  const filtered = $derived.by(() => {
    const base = filterSpellPicker(entries, {
      ...(traditionFilter !== null ? { tradition: traditionFilter } : {}),
      search: query,
      ...(maxRank !== undefined ? { maxRank } : {}),
    });
    const chipped = base
      .filter((e) => {
        if (rankFilter === null) return true;
        return e.index["system.level"] === rankFilter;
      })
      .filter((e) => {
        if (!traitFilter) return true;
        const raw = e.index["system.traits.value"];
        return Array.isArray(raw) && raw.includes(traitFilter);
      });
    return sortSpellPickerEntries(chipped);
  });

  function toggleTradition(): void {
    traditionFilter = traditionFilter === null ? tradition.trim() || null : null;
  }

  function rankOf(e: PackIndexEntry): number {
    const raw = e.index["system.level"];
    return typeof raw === "number" ? raw : 0;
  }

  function traitsOf(e: PackIndexEntry): string[] {
    const raw = e.index["system.traits.value"];
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  }

  function selectRow(e: PackIndexEntry): void {
    selectedUuid = e.uuid;
    void loadDetails(e.uuid);
  }

  /**
   * Load the full document for the details panel, on demand, cached by
   * uuid for the lifetime of this dialog instance. Never blocks the
   * confirm flow — confirmSelection() re-fetches (or reuses the same
   * cache) independently.
   */
  async function loadDetails(uuid: string): Promise<void> {
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
      // Guard against a stale response landing after the user selected a
      // different row while this fetch was in flight.
      if (selectedUuid === uuid) detailsDoc = document;
    } catch {
      if (selectedUuid === uuid) {
        detailsError = true;
        detailsDoc = null;
      }
    } finally {
      if (selectedUuid === uuid) detailsLoading = false;
    }
  }

  function retryDetails(): void {
    if (selectedUuid) void loadDetails(selectedUuid);
  }

  async function confirmSelection(): Promise<void> {
    if (!selectedUuid || submitting) return;
    submitting = true;
    errorKind = null;
    try {
      const cached = detailsCache.get(selectedUuid);
      const document = cached ?? (await getDocument(requireConnectedSocket(getSocket()), selectedUuid)).document;
      onSelect(document);
      onClose();
    } catch (err) {
      errorKind = err instanceof SocketUnavailableError ? "not-connected" : "load";
    } finally {
      submitting = false;
    }
  }

  function handleBackdropClick(): void {
    onClose();
  }

  function handleBackdropKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onClose();
  }

  const rankChips = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
</script>

<div
  class="picker-backdrop"
  role="presentation"
  onclick={handleBackdropClick}
  onkeydown={handleBackdropKeydown}
>
  <div
    class="picker-modal"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={t("FUSION.Sheet.Spells.Picker.Title", { entry: entryLabel, tradition: traditionLabel })}
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
  >
    <div class="picker-modal__header">
      <h2 class="picker-modal__title">
        {t("FUSION.Sheet.Spells.Picker.Title", { entry: entryLabel, tradition: traditionLabel })}
      </h2>
      <button type="button" class="picker-modal__close" onclick={onClose} aria-label={t("FUSION.Dialog.Close")}>
        &times;
      </button>
    </div>

    <div class="picker-modal__body">
      <div class="picker-modal__main">
      <div class="picker-search">
        <span class="picker-search__icon" aria-hidden="true">&#128269;</span>
        <input
          type="text"
          class="picker-search__input"
          placeholder={t("FUSION.Sheet.Spells.Picker.SearchPlaceholder")}
          bind:value={query}
        />
      </div>

      <div class="picker-filters">
        {#each rankChips as n (n)}
          {#if maxRank === undefined || n <= maxRank}
            <button
              type="button"
              class="picker-chip"
              class:picker-chip--active={rankFilter === n}
              onclick={() => { rankFilter = rankFilter === n ? null : n; }}
            >
              {n}
            </button>
          {/if}
        {/each}
        <span class="picker-filters__sep"></span>
        <button
          type="button"
          class="picker-chip picker-chip--more"
          class:picker-chip--active={moreFiltersOpen}
          aria-expanded={moreFiltersOpen}
          onclick={() => { moreFiltersOpen = !moreFiltersOpen; }}
        >
          {t("FUSION.Sheet.Spells.Picker.MoreFilters")} {moreFiltersOpen ? "▾" : "▸"}
        </button>
      </div>

      {#if moreFiltersOpen}
        <div class="picker-filters picker-filters--more">
          <button
            type="button"
            class="picker-chip"
            class:picker-chip--active={traditionFilter !== null}
            onclick={toggleTradition}
          >
            {t("FUSION.Sheet.Spells.Picker.TraditionFilter", { tradition: traditionLabel })}
          </button>
          {#if availableTraits.length > 0}
            <div class="picker-trait-search">
              <input
                type="text"
                class="picker-trait-search__input"
                placeholder={t("FUSION.Sheet.Spells.Picker.TraitSearchPlaceholder")}
                bind:value={traitSearch}
              />
            </div>
            {#if groupedTraits.length === 0}
              <div class="picker-trait-groups__empty">{t("FUSION.Sheet.Spells.Picker.NoTraitsFound")}</div>
            {:else}
              <div class="picker-trait-groups">
                {#each groupedTraits as group (group.key)}
                  <div class="picker-trait-group">
                    <div class="picker-trait-group__label">{t(group.labelKey)}</div>
                    <div class="picker-filters">
                      {#each group.traits as trait (trait)}
                        <button
                          type="button"
                          class="picker-chip"
                          class:picker-chip--active={traitFilter === trait}
                          onclick={() => { traitFilter = traitFilter === trait ? null : trait; }}
                        >
                          {traitDisplayName(trait, i18n.locale)}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {/if}

      <div class="picker-results">
        {#if loading}
          <div class="picker-empty">{t("FUSION.Sheet.Spells.Picker.Loading")}</div>
        {:else if errorKind}
          <div class="picker-empty picker-empty--error">
            <span>
              {errorKind === "not-connected"
                ? t("FUSION.Sheet.Spells.Picker.NotConnected")
                : t("FUSION.Sheet.Spells.Picker.LoadError")}
            </span>
            <button type="button" class="picker-btn picker-btn--secondary picker-retry" onclick={() => void loadSpells()}>
              {t("FUSION.Sheet.Spells.Picker.Retry")}
            </button>
          </div>
        {:else if filtered.length === 0}
          <div class="picker-empty">
            <span>{t("FUSION.Sheet.Spells.Picker.NoResults")}</span>
            <span class="picker-empty__hint">{t("FUSION.Sheet.Spells.Picker.NoResultsHint")}</span>
          </div>
        {:else}
          {#each filtered as entry (entry.uuid)}
            {@const nameParts = localizedNameParts(entry, i18n.locale)}
            {@const cost = formatIndexActionCost(entry.index["actionCost"], i18n.locale)}
            <div
              class="picker-row"
              class:picker-row--selected={selectedUuid === entry.uuid}
              role="button"
              tabindex="0"
              onclick={() => selectRow(entry)}
              onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") selectRow(entry); }}
            >
              <span class="picker-row__rank">{rankOf(entry)}</span>
              <div class="picker-row__main">
                <div class="picker-row__name">
                  <span class="picker-row__name-text">{nameParts.display}</span>
                  {#if cost}
                    <span class="picker-row__cost" class:picker-row__cost--text={cost.isText} title={cost.title}>{cost.display}</span>
                  {/if}
                  {#if nameParts.subtitleEn}
                    <span class="picker-row__name-en">{nameParts.subtitleEn}</span>
                  {/if}
                </div>
                {#if traitsOf(entry).length > 0}
                  <div class="picker-row__traits">
                    {#each traitsOf(entry) as trait (trait)}
                      <span class="picker-row__trait">{traitDisplayName(trait, i18n.locale)}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
      </div>

      <div class="picker-modal__side">
        <DocumentDetailsPanel document={detailsDoc} loading={detailsLoading} error={detailsError} onRetry={retryDetails} />
      </div>
    </div>

    <div class="picker-modal__footer">
      <span class="picker-modal__note">{t("FUSION.Sheet.Spells.Picker.CleanRoomNote")}</span>
      <div class="picker-modal__actions">
        <button type="button" class="picker-btn picker-btn--secondary" onclick={onClose}>
          {t("FUSION.Dialog.Cancel")}
        </button>
        <button
          type="button"
          class="picker-btn picker-btn--primary"
          disabled={!selectedUuid || submitting}
          onclick={confirmSelection}
        >
          {t("FUSION.Sheet.Spells.Picker.Confirm")}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .picker-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 100;
  }

  .picker-modal {
    width: 960px;
    max-width: 100%;
    max-height: 720px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: var(--fusion-shadow-modal);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  @media (max-width: 720px) {
    .picker-modal {
      width: 680px;
    }
  }

  .picker-modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--fusion-border);
    flex-shrink: 0;
  }

  .picker-modal__title {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    color: var(--fusion-text);
  }

  .picker-modal__close {
    width: 24px;
    height: 24px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--fusion-font);
  }

  .picker-modal__close:hover {
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .picker-modal__body {
    display: flex;
    flex-direction: row;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }

  .picker-modal__main {
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    flex: 1;
    min-width: 0;
  }

  .picker-modal__side {
    width: 300px;
    flex-shrink: 0;
    border-left: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt);
    overflow-y: auto;
  }

  @media (max-width: 720px) {
    .picker-modal__body {
      flex-direction: column;
      overflow-y: auto;
    }

    .picker-modal__main {
      overflow-y: visible;
      flex: none;
    }

    .picker-modal__side {
      width: 100%;
      flex-shrink: 1;
      border-left: none;
      border-top: 1px solid var(--fusion-border);
      max-height: 260px;
    }
  }

  .picker-search {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 8px 12px;
  }

  .picker-search:focus-within {
    border-color: var(--fusion-accent);
  }

  .picker-search__icon {
    color: var(--fusion-text-subtle);
    font-size: 13px;
    line-height: 1;
  }

  .picker-search__input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--fusion-text);
    font-size: 13px;
    font-family: var(--fusion-font);
  }

  .picker-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .picker-filters__sep {
    width: 1px;
    height: 16px;
    background: var(--fusion-border);
    margin: 0 4px;
  }

  .picker-chip {
    display: inline-flex;
    align-items: center;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--fusion-font);
    padding: 4px 11px;
    border-radius: var(--fusion-radius-pill);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
    background: transparent;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }

  .picker-chip:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .picker-chip--active {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .picker-chip--more {
    border-style: dashed;
  }

  .picker-filters--more {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .picker-trait-search__input {
    width: 100%;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 5px 9px;
    font-size: 11.5px;
    font-family: var(--fusion-font);
    color: var(--fusion-text);
    outline: none;
  }

  .picker-trait-search__input:focus {
    border-color: var(--fusion-accent);
  }

  .picker-trait-groups {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 220px;
    overflow-y: auto;
  }

  .picker-trait-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .picker-trait-group__label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-subtle);
  }

  .picker-trait-groups__empty {
    font-size: 11.5px;
    color: var(--fusion-text-muted);
    padding: 6px 2px;
  }

  .picker-results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 4px;
    max-height: 340px;
    overflow-y: auto;
  }

  .picker-empty {
    padding: 32px 12px;
    text-align: center;
    font-size: 13px;
    color: var(--fusion-text-muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .picker-empty--error {
    color: var(--fusion-danger);
  }

  .picker-empty__hint {
    font-size: 11.5px;
    color: var(--fusion-text-subtle);
  }

  .picker-retry {
    align-self: center;
  }

  .picker-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
  }

  .picker-row:hover {
    background: var(--fusion-surface-alt);
  }

  .picker-row--selected {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
  }

  .picker-row__rank {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font-mono);
  }

  .picker-row--selected .picker-row__rank {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .picker-row__main {
    flex: 1;
    min-width: 0;
  }

  .picker-row__name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .picker-row__cost {
    margin-left: 6px;
    font-size: 11px;
    font-weight: 700;
    color: var(--fusion-accent);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .picker-row__cost--text {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--fusion-text-subtle);
    letter-spacing: 0;
  }

  .picker-row__name-en {
    margin-left: 6px;
    font-size: 10.5px;
    font-weight: 400;
    color: var(--fusion-text-subtle);
  }

  .picker-row__traits {
    display: flex;
    gap: 4px;
    margin-top: 3px;
    flex-wrap: wrap;
  }

  .picker-row__trait {
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

  .picker-modal__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 18px;
    border-top: 1px solid var(--fusion-border);
    flex-shrink: 0;
  }

  .picker-modal__note {
    font-size: 10.5px;
    color: var(--fusion-text-subtle);
  }

  .picker-modal__actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .picker-btn {
    font-family: var(--fusion-font);
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    padding: 7px 14px;
    font-size: 13px;
    border-radius: var(--fusion-radius);
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .picker-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .picker-btn--primary {
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border: 1px solid var(--fusion-accent);
  }

  .picker-btn--primary:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
    border-color: var(--fusion-accent-hover);
  }

  .picker-btn--secondary {
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
  }

  .picker-btn--secondary:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }
</style>
