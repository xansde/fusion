<script lang="ts">
  /**
   * CompendiumBrowser.svelte — Compendium tab panel.
   *
   * Displays available packs grouped by documentType, allows searching and
   * filtering entries, previewing documents, importing to the world, and
   * drag-and-drop to canvas or sheet.
   *
   * REQ-CMP-012..018, REQ-CMP-021
   * Spec: 16-compendiums-e-importacao.md §Compendium browser (UI)
   */

  import type { Socket } from "socket.io-client";
  import type { PackManifest, PackIndexEntry } from "@fusion/shared";
  import {
    groupPacksByType,
    filterEntries,
    buildSearchQuery,
    buildCompendiumDragPayload,
    sortEntries,
    buildDocumentPreview,
    highlightMatch,
    isKnownPlaceholderImg,
    fallbackIcon,
    type BrowserFilterState,
    type PackGroup,
    type SortField,
    type CompendiumDragPayload,
  } from "../../lib/compendium/compendiumBrowser.js";
  import {
    listPacks,
    getPackIndex,
    getDocument,
    importToWorld,
  } from "../../lib/compendium/compendiumApi.js";

  const { socket, isGm }: { socket: Socket; isGm: boolean } = $props();

  // ---- State ----

  let groups = $state<PackGroup[]>([]);
  let selectedPack = $state<PackManifest | null>(null);
  let packEntries = $state<PackIndexEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let importingUuids = $state<Set<string>>(new Set());
  let importSuccess = $state<string | null>(null);

  // Preview state
  let previewDoc = $state<Record<string, unknown> | null>(null);
  let previewLoading = $state(false);
  let previewImgBroken = $state(false);

  // Filter state
  let filterState = $state<BrowserFilterState>({ text: "" });
  let sortField = $state<SortField>("name");
  let sortAsc = $state(true);

  // ---- Derived ----

  const filteredEntries = $derived.by(() => {
    if (!selectedPack) return [];
    const query = buildSearchQuery(selectedPack.id, filterState);
    const filtered = filterEntries(packEntries, query);
    return sortEntries(filtered, sortField, sortAsc);
  });

  const previewData = $derived(previewDoc ? buildDocumentPreview(previewDoc) : null);

  // ---- Lifecycle ----

  $effect(() => {
    loadPacks();
  });

  async function loadPacks(): Promise<void> {
    loading = true;
    error = null;
    try {
      const result = await listPacks(socket);
      groups = groupPacksByType(result.packs);
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load compendium packs";
    } finally {
      loading = false;
    }
  }

  async function selectPack(pack: PackManifest): Promise<void> {
    selectedPack = pack;
    packEntries = [];
    filterState = { text: "" };
    previewDoc = null;
    loading = true;
    error = null;
    try {
      const result = await getPackIndex(socket, pack.id);
      packEntries = result.entries;
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load pack index";
    } finally {
      loading = false;
    }
  }

  function backToPacks(): void {
    selectedPack = null;
    packEntries = [];
    previewDoc = null;
    error = null;
  }

  async function previewEntry(entry: PackIndexEntry): Promise<void> {
    previewLoading = true;
    previewDoc = null;
    previewImgBroken = false;
    try {
      const result = await getDocument(socket, entry.uuid);
      previewDoc = result.document;
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load document";
    } finally {
      previewLoading = false;
    }
  }

  async function importEntry(entry: PackIndexEntry): Promise<void> {
    if (!isGm) return;
    importingUuids = new Set([...importingUuids, entry.uuid]);
    importSuccess = null;
    error = null;
    try {
      await importToWorld(socket, [entry.uuid]);
      importSuccess = `"${entry.name}" importado para o world.`;
    } catch (err) {
      error = err instanceof Error ? err.message : "Falha ao importar documento";
    } finally {
      const next = new Set(importingUuids);
      next.delete(entry.uuid);
      importingUuids = next;
    }
  }

  // ---- Drag and drop ----

  function handleDragStart(event: DragEvent, entry: PackIndexEntry): void {
    if (!selectedPack || !event.dataTransfer) return;
    const payload: CompendiumDragPayload = buildCompendiumDragPayload(entry, selectedPack);
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  }

  // ---- Sort helpers ----

  function toggleSort(field: SortField): void {
    if (sortField === field) {
      sortAsc = !sortAsc;
    } else {
      sortField = field;
      sortAsc = true;
    }
  }

  function sortArrow(field: SortField): string {
    if (sortField !== field) return "";
    return sortAsc ? " ▲" : " ▼";
  }

  // ---- Image fallback ----
  // Entries store known-placeholder paths (e.g. "icons/placeholder/npc.svg")
  // that were never populated with a real asset and have no serving route.
  // Skip fetching them entirely and render a per-type emoji placeholder
  // instead of a broken-image icon. Real paths that still 404 fall back the
  // same way via onerror.

  let brokenImgUuids = $state<Set<string>>(new Set());

  function handleImgError(uuid: string): void {
    brokenImgUuids = new Set(brokenImgUuids).add(uuid);
  }

  function shouldShowImg(entry: PackIndexEntry): boolean {
    return !isKnownPlaceholderImg(entry.img) && !brokenImgUuids.has(entry.uuid);
  }
</script>

<div class="compendium-browser">
  {#if loading && groups.length === 0 && !selectedPack}
    <p class="compendium-browser__loading" role="status">Carregando compêndios…</p>
  {:else if error}
    <p class="compendium-browser__error" role="alert">{error}</p>
    <button class="btn btn--sm" onclick={loadPacks}>Tentar novamente</button>
  {:else if !selectedPack}
    <!-- Pack list view -->
    <div class="compendium-browser__packs">
      {#if groups.length === 0}
        <p class="compendium-browser__empty">Nenhum compêndio disponível.</p>
      {:else}
        {#each groups as group (group.documentType)}
          <div class="pack-group">
            <h3 class="pack-group__heading">{group.documentType}</h3>
            <ul class="pack-group__list" role="list">
              {#each group.packs as pack (pack.id)}
                <li class="pack-group__item" role="listitem">
                  <button
                    class="pack-btn"
                    onclick={() => selectPack(pack)}
                    title={pack.label}
                  >
                    <span class="pack-btn__label">{pack.label}</span>
                    <span class="pack-btn__count">{pack.documentCount}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
    </div>
  {:else}
    <!-- Entry browser view -->
    <div class="compendium-browser__entries">
      <!-- Header with back button -->
      <div class="entries-header">
        <button class="btn btn--sm btn--ghost" onclick={backToPacks} aria-label="Voltar aos compêndios">
          &#x2190; Voltar
        </button>
        <span class="entries-header__title">{selectedPack.label}</span>
      </div>

      <!-- Search + filters -->
      <div class="entries-filter">
        <input
          class="entries-filter__input"
          type="search"
          placeholder="Buscar…"
          bind:value={filterState.text}
          aria-label="Buscar no compêndio"
        />
        {#if selectedPack.documentType === "Item"}
          <input
            class="entries-filter__input entries-filter__input--sm"
            type="text"
            placeholder="Subtipo (ex: weapon)"
            bind:value={filterState.subtype}
            aria-label="Filtrar por subtipo"
          />
          <input
            class="entries-filter__input entries-filter__input--sm"
            type="text"
            placeholder="Trait"
            bind:value={filterState.trait}
            aria-label="Filtrar por trait"
          />
          <div class="entries-filter__row">
            <input
              class="entries-filter__input entries-filter__input--sm"
              type="number"
              placeholder="Nível mín."
              min={0}
              max={20}
              bind:value={filterState.minLevel}
              aria-label="Nível mínimo"
            />
            <input
              class="entries-filter__input entries-filter__input--sm"
              type="number"
              placeholder="Nível máx."
              min={0}
              max={20}
              bind:value={filterState.maxLevel}
              aria-label="Nível máximo"
            />
          </div>
        {/if}
      </div>

      {#if loading}
        <p class="compendium-browser__loading" role="status">Carregando…</p>
      {:else}
        <!-- Sort bar -->
        <div class="entries-sort" role="toolbar" aria-label="Ordenar por">
          <button class="sort-btn" onclick={() => toggleSort("name")}>
            Nome{sortArrow("name")}
          </button>
          {#if selectedPack.indexFields.includes("system.level.value")}
            <button class="sort-btn" onclick={() => toggleSort("level")}>
              Nível{sortArrow("level")}
            </button>
          {/if}
          <button class="sort-btn" onclick={() => toggleSort("type")}>
            Tipo{sortArrow("type")}
          </button>
        </div>

        <!-- Entry list -->
        <ul class="entry-list" role="list" aria-label="Entradas do compêndio">
          {#if filteredEntries.length === 0}
            <li class="entry-list__empty">Nenhum resultado.</li>
          {:else}
            {#each filteredEntries as entry (entry._id)}
              {@const isImporting = importingUuids.has(entry.uuid)}
              <li
                class="entry-row"
                role="listitem"
                draggable="true"
                ondragstart={(e) => handleDragStart(e, entry)}
                title={`Arraste para o canvas ou ficha. UUID: ${entry.uuid}`}
              >
                {#if shouldShowImg(entry)}
                  <img
                    class="entry-row__img"
                    src={entry.img}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    onerror={() => handleImgError(entry.uuid)}
                  />
                {:else}
                  <span
                    class="entry-row__img entry-row__img--placeholder"
                    aria-hidden="true"
                    title={entry.type ?? selectedPack.documentType}
                  >{fallbackIcon(selectedPack.documentType, entry.type)}</span>
                {/if}

                <div class="entry-row__info">
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <span class="entry-row__name">{@html highlightMatch(entry.name, filterState.text)}</span>
                  {#if entry.type}
                    <span class="entry-row__type">{entry.type}</span>
                  {/if}
                  {#if typeof entry.index["system.level.value"] === "number"}
                    <span class="entry-row__level">Nv {entry.index["system.level.value"]}</span>
                  {/if}
                </div>

                <div class="entry-row__actions">
                  <button
                    class="action-btn action-btn--preview"
                    onclick={() => previewEntry(entry)}
                    aria-label="Pré-visualizar {entry.name}"
                    title="Pré-visualizar"
                  >&#x1F441;</button>
                  {#if isGm}
                    <button
                      class="action-btn action-btn--import"
                      onclick={() => importEntry(entry)}
                      disabled={isImporting}
                      aria-label="Importar {entry.name} para o world"
                      title="Importar para o world"
                    >
                      {isImporting ? "…" : "⬇"}
                    </button>
                  {/if}
                </div>
              </li>
            {/each}
          {/if}
        </ul>

        {#if importSuccess}
          <p class="compendium-browser__success" role="status">{importSuccess}</p>
        {/if}
      {/if}
    </div>

    <!-- Preview panel -->
    {#if previewLoading}
      <div class="preview-panel preview-panel--loading" role="status">Carregando pré-visualização…</div>
    {:else if previewData}
      <div class="preview-panel" role="complementary" aria-label="Pré-visualização">
        <div class="preview-panel__header">
          {#if !isKnownPlaceholderImg(previewData.img) && !previewImgBroken}
            <img
              class="preview-panel__img"
              src={previewData.img}
              alt=""
              aria-hidden="true"
              onerror={() => { previewImgBroken = true; }}
            />
          {:else}
            <span class="preview-panel__img preview-panel__img--placeholder" aria-hidden="true">
              {fallbackIcon(selectedPack?.documentType ?? "", previewData.type)}
            </span>
          {/if}
          <div>
            <h4 class="preview-panel__name">{previewData.name}</h4>
            {#if previewData.type}
              <span class="preview-panel__type">{previewData.type}</span>
            {/if}
            <span class="preview-panel__license">{previewData.licenseLabel}</span>
          </div>
        </div>
        <dl class="preview-panel__fields">
          {#each previewData.fields as field (field.label)}
            <div class="preview-panel__field">
              <dt class="preview-panel__field-label">{field.label}</dt>
              <dd class="preview-panel__field-value">{field.value}</dd>
            </div>
          {/each}
        </dl>
        <button
          class="preview-panel__close btn btn--sm btn--ghost"
          onclick={() => { previewDoc = null; }}
          aria-label="Fechar pré-visualização"
        >
          Fechar
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .compendium-browser {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    height: 100%;
    overflow: hidden;
    padding: 0.5rem;
    font-size: 0.85rem;
  }

  .compendium-browser__loading,
  .compendium-browser__empty,
  .compendium-browser__error,
  .compendium-browser__success {
    padding: 0.5rem;
    text-align: center;
    color: var(--fusion-text-muted, #888);
  }

  .compendium-browser__error { color: var(--fusion-danger, #e74c3c); }
  .compendium-browser__success { color: var(--fusion-success, #27ae60); }

  /* ---- Pack list ---- */
  .compendium-browser__packs {
    overflow-y: auto;
    flex: 1;
  }

  .pack-group { margin-bottom: 0.75rem; }

  .pack-group__heading {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fusion-text-muted, #888);
    margin: 0 0 0.25rem;
    padding: 0 0.25rem;
  }

  .pack-group__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .pack-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.35rem 0.5rem;
    background: var(--fusion-surface-alt, #2a2a2a);
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    cursor: pointer;
    color: var(--fusion-text, #eee);
    text-align: left;
    transition: background 0.15s;
  }

  .pack-btn:hover { background: var(--fusion-border, #444); }

  .pack-btn__count {
    font-size: 0.7rem;
    color: var(--fusion-text-muted, #888);
    background: var(--fusion-surface, #222);
    border-radius: 9999px;
    padding: 0.1rem 0.4rem;
  }

  /* ---- Entry browser ---- */
  .compendium-browser__entries {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    height: 100%;
    overflow: hidden;
  }

  .entries-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .entries-header__title {
    font-weight: 600;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .entries-filter {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .entries-filter__input {
    width: 100%;
    padding: 0.3rem 0.5rem;
    background: var(--fusion-surface-alt, #2a2a2a);
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-text, #eee);
    font-size: 0.8rem;
  }

  .entries-filter__input--sm { font-size: 0.75rem; padding: 0.2rem 0.4rem; }

  .entries-filter__row {
    display: flex;
    gap: 0.25rem;
  }

  .entries-filter__row .entries-filter__input { flex: 1; }

  .entries-sort {
    display: flex;
    gap: 0.25rem;
    padding: 0.2rem 0;
  }

  .sort-btn {
    padding: 0.2rem 0.4rem;
    background: none;
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-text-muted, #888);
    cursor: pointer;
    font-size: 0.7rem;
  }

  .sort-btn:hover { background: var(--fusion-surface-alt, #2a2a2a); }

  /* ---- Entry list ---- */
  .entry-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .entry-list__empty {
    padding: 0.5rem;
    text-align: center;
    color: var(--fusion-text-muted, #888);
    font-size: 0.8rem;
  }

  .entry-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.4rem;
    background: var(--fusion-surface-alt, #2a2a2a);
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    cursor: grab;
  }

  .entry-row:hover { background: var(--fusion-border, #444); }
  .entry-row:active { cursor: grabbing; }

  .entry-row__img {
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .entry-row__img--placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--fusion-surface, #222);
    color: var(--fusion-text-muted, #888);
    font-size: 0.9rem;
    border-radius: 3px;
  }

  .entry-row__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .entry-row__name {
    font-size: 0.82rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fusion-text, #eee);
  }

  .entry-row__type,
  .entry-row__level {
    font-size: 0.7rem;
    color: var(--fusion-text-muted, #888);
  }

  .entry-row__actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .action-btn {
    background: none;
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-text-muted, #888);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0.15rem 0.3rem;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
  }

  .action-btn:hover { background: var(--fusion-surface, #222); color: var(--fusion-text, #eee); }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ---- Preview panel ---- */
  .preview-panel {
    background: var(--fusion-surface, #222);
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    padding: 0.5rem;
    margin-top: 0.25rem;
    flex-shrink: 0;
  }

  .preview-panel--loading {
    color: var(--fusion-text-muted, #888);
    text-align: center;
  }

  .preview-panel__header {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }

  .preview-panel__img {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .preview-panel__img--placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--fusion-surface, #222);
    color: var(--fusion-text-muted, #888);
    font-size: 1.3rem;
  }

  .preview-panel__name {
    font-size: 0.85rem;
    font-weight: 600;
    margin: 0 0 0.1rem;
  }

  .preview-panel__type,
  .preview-panel__license {
    font-size: 0.7rem;
    color: var(--fusion-text-muted, #888);
    margin-right: 0.4rem;
  }

  .preview-panel__fields {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.15rem 0.5rem;
    margin: 0 0 0.4rem;
    font-size: 0.78rem;
  }

  .preview-panel__field { display: contents; }

  .preview-panel__field-label {
    color: var(--fusion-text-muted, #888);
    font-style: italic;
  }

  .preview-panel__field-value { color: var(--fusion-text, #eee); }

  .preview-panel__close {
    margin-top: 0.25rem;
  }

  /* Highlight from search */
  :global(.compendium-browser mark) {
    background: var(--fusion-accent, #c0a060);
    color: var(--fusion-surface, #222);
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
