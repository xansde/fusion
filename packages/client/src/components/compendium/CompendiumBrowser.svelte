<script lang="ts">
  /**
   * CompendiumBrowser.svelte — the Compendium tab of the side drawer.
   *
   * Spec 43 (`specs/43-aba-compendio.md`) §5.2, DEC-CPD-01: one panel, two
   * bodies — the **shelf** and the **search result** — and the body is derived
   * from the scope plus what is typed (REQ-CPD-010). There is no mode switch to
   * press: at root with an empty search you get the shelf (REQ-CPD-011); type
   * anything, or set a facet, and the same panel answers over the whole visible
   * collection (REQ-CPD-012); open a pack and the body is that pack's index,
   * with the search confined to it and an explicit way to widen the same text
   * back to everything (REQ-CPD-013/014).
   *
   * The decision itself lives in `lib/compendium/browserScope.ts` as pure
   * transitions — this file holds one `$state` of that shape and renders it.
   *
   * The header always names the scope and offers the way back (REQ-CPD-015),
   * and the search bar sits OUTSIDE the single scrolling area so it never
   * scrolls away in either body (REQ-CPD-016). Nothing here sets a width: the
   * drawer owns it, so switching body cannot move it (REQ-CPD-017, REQ-GAV-012).
   *
   * The shelf body itself is `CompendiumShelf.svelte` (G092): packs grouped by
   * document type, collapsible, each row showing its license (REQ-CPD-020..025).
   * This file owns what surrounds it — the loading, the scope, and the collapse
   * state it persists per world and user.
   *
   * Every line of either body is `CompendiumResultLine.svelte` (G093), built by
   * `lib/compendium/resultLine.ts`: two names, the fields the pack declared, the
   * matched run marked, and the in-world seal (REQ-CPD-040..046). This file
   * supplies what the entry cannot know — the reader's role, the open pack's
   * declared index fields, and the world's origin index.
   *
   * Still here from the pre-drawer browser and owned by other tasks of this
   * phase: the preview — which moves to a floating window (G094) — and
   * importing (G095).
   *
   * REQ-CMP-012..018, REQ-CMP-021.
   */

  import type { Socket } from "socket.io-client";
  import type { PackManifest, PackIndexEntry } from "@fusion/shared";
  import {
    filterEntries,
    buildSearchQuery,
    buildCompendiumDragPayload,
    sortEntries,
    buildDocumentPreview,
    buildSearchAllPayload,
    documentTypeLabelKey,
    isKnownPlaceholderImg,
    fallbackIcon,
    normalizeAggregatedSearchResult,
    type AggregatedSearchResult,
    type SortField,
    type CompendiumDragPayload,
  } from "../../lib/compendium/compendiumBrowser.js";
  import {
    buildResultLine,
    buildWorldOriginIndex,
    EMPTY_WORLD_ORIGIN_INDEX,
    type WorldOriginIndex,
  } from "../../lib/compendium/resultLine.js";
  import CompendiumResultLine from "./CompendiumResultLine.svelte";
  import { worldMirror } from "../../lib/docs/index.js";
  import {
    backToShelf,
    bodyMode,
    buildScopedSearchQuery,
    canWidenToWholeCollection,
    describeScope,
    initialBrowserScope,
    openPack,
    setFacet,
    clearFacet,
    setSearch,
    widenToWholeCollection,
    type ScopedSearchQuery,
  } from "../../lib/compendium/browserScope.js";
  import CompendiumShelf from "./CompendiumShelf.svelte";
  import {
    buildShelfGroups,
    loadCollapsedGroups,
    saveCollapsedGroups,
    toggleCollapsedGroup,
  } from "../../lib/compendium/compendiumShelf.js";
  import {
    listPacks,
    getPackIndex,
    getDocument,
    importToWorld,
    searchAllPacks,
  } from "../../lib/compendium/compendiumApi.js";
  import { i18n, t } from "../../lib/i18n/i18n.js";

  /**
   * The drawer hands every panel the same bag (`SidebarPanelProps`).
   * `worldId`/`userId` scope what this panel keeps on the device — today the
   * collapsed shelf groups (REQ-CPD-023); G096 adds the scope and the pinned
   * packs to the same scoping.
   */
  interface Props {
    socket: Socket;
    isGm?: boolean;
    worldId?: string;
    userId?: string;
    activeSceneId?: string | null;
  }

  const { socket, isGm = false, worldId = "", userId = "" }: Props = $props();

  // ---- Scope (REQ-CPD-010..015) ----

  let scopeState = $state(initialBrowserScope());

  const mode = $derived(bodyMode(scopeState));
  const scopeInfo = $derived(describeScope(scopeState));
  const canWiden = $derived(canWidenToWholeCollection(scopeState));
  const openPackId = $derived(scopeState.scope.kind === "pack" ? scopeState.scope.packId : null);

  // ---- Shelf state ----

  let packs = $state<PackManifest[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  const selectedPack = $derived(packs.find((pack) => pack.id === openPackId) ?? null);

  /**
   * Which shelf groups are collapsed (REQ-CPD-023). Read from the device for
   * this world and user, and written back on every toggle — spec 43 §7 keeps it
   * local because it is ergonomics, not world state (DEC-UIF-10).
   */
  let collapsedGroups = $state<ReadonlySet<string>>(new Set<string>());

  $effect(() => {
    collapsedGroups = loadCollapsedGroups(worldId, userId);
  });

  const shelfGroups = $derived(
    buildShelfGroups(packs, { viewerIsPrivileged: isGm, collapsed: collapsedGroups }),
  );

  // ---- Pack index state (scope = one pack) ----

  let packEntries = $state<PackIndexEntry[]>([]);
  let loadedPackId = $state<string | null>(null);
  /** System-declared filters of the open pack (REQ-CPD-035) — pack-local. */
  let packFilters = $state<{ subtype?: string; trait?: string }>({});
  let sortField = $state<SortField>("name");
  let sortAsc = $state(true);

  // ---- Aggregated result state (scope = root, something asked for) ----

  let aggregated = $state<AggregatedSearchResult | null>(null);
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  /** Guards against an older answer landing after a newer one. */
  let searchToken = 0;

  // ---- The world's origin index, for the in-world seal (REQ-CPD-043) ----

  /**
   * Which entries already produced a document in the world. Read off the world
   * mirror's Actors and Items — the import preserves `flags.fusion`, which is
   * the only identity that survives the clone (DEC-CPD-12) — and refreshed
   * whenever either type changes, so bringing an entry over lights its own seal.
   */
  let worldOrigins = $state<WorldOriginIndex>(EMPTY_WORLD_ORIGIN_INDEX);

  $effect(() => {
    const refresh = (): void => {
      worldOrigins = buildWorldOriginIndex([
        ...worldMirror.getByType<unknown>("Actor"),
        ...worldMirror.getByType<unknown>("Item"),
      ]);
    };
    refresh();
    const offActors = worldMirror.subscribe<unknown>("Actor", refresh);
    const offItems = worldMirror.subscribe<unknown>("Item", refresh);
    return () => {
      offActors();
      offItems();
    };
  });

  // ---- Import / preview (G094, G095 own these) ----

  let importingUuids = $state<Set<string>>(new Set());
  let importSuccess = $state<string | null>(null);
  let previewDoc = $state<Record<string, unknown> | null>(null);
  let previewLoading = $state(false);
  let previewImgBroken = $state(false);
  let previewError = $state<string | null>(null);
  let lastPreviewEntry = $state<PackIndexEntry | null>(null);

  // ---- Derived bodies ----

  const filteredEntries = $derived.by(() => {
    if (!openPackId) return [];
    const query = buildSearchQuery(openPackId, {
      text: scopeState.search,
      ...(packFilters.subtype !== undefined ? { subtype: packFilters.subtype } : {}),
      ...(packFilters.trait !== undefined ? { trait: packFilters.trait } : {}),
      ...(scopeState.facets.minLevel !== undefined
        ? { minLevel: scopeState.facets.minLevel }
        : {}),
      ...(scopeState.facets.maxLevel !== undefined
        ? { maxLevel: scopeState.facets.maxLevel }
        : {}),
    });
    return sortEntries(filterEntries(packEntries, query), sortField, sortAsc);
  });

  const previewData = $derived(previewDoc ? buildDocumentPreview(previewDoc, i18n.locale) : null);

  // ---- Lifecycle ----

  $effect(() => {
    void loadPacks();
  });

  /** Load the index of the open pack, once per pack (RNF-CPD-04: never eagerly). */
  $effect(() => {
    const packId = openPackId;
    if (packId === null || packId === loadedPackId) return;
    void loadPackIndex(packId);
  });

  /**
   * The aggregated body: ONE server query over every visible pack
   * (REQ-CPD-012, DEC-CPD-02), re-run whenever the question changes.
   */
  $effect(() => {
    const state = scopeState;
    if (state.scope.kind !== "root" || bodyMode(state) !== "results") {
      aggregated = null;
      searchError = null;
      return;
    }
    void runAggregatedSearch(buildScopedSearchQuery(state));
  });

  async function loadPacks(): Promise<void> {
    loading = true;
    error = null;
    try {
      const result = await listPacks(socket);
      packs = result.packs;
    } catch (err) {
      error = err instanceof Error ? err.message : t("FUSION.Compendium.LoadFailed");
    } finally {
      loading = false;
    }
  }

  async function loadPackIndex(packId: string): Promise<void> {
    loading = true;
    error = null;
    packEntries = [];
    try {
      const result = await getPackIndex(socket, packId);
      packEntries = result.entries;
      loadedPackId = packId;
    } catch (err) {
      error = err instanceof Error ? err.message : t("FUSION.Compendium.LoadFailed");
    } finally {
      loading = false;
    }
  }

  async function runAggregatedSearch(query: ScopedSearchQuery): Promise<void> {
    const token = ++searchToken;
    searching = true;
    searchError = null;
    try {
      const raw = await searchAllPacks(socket, buildSearchAllPayload(query));
      if (token !== searchToken) return;
      aggregated = normalizeAggregatedSearchResult(raw);
    } catch (err) {
      if (token !== searchToken) return;
      aggregated = null;
      searchError = err instanceof Error ? err.message : t("FUSION.Compendium.SearchFailed");
    } finally {
      if (token === searchToken) searching = false;
    }
  }

  // ---- Scope gestures ----

  function selectPack(pack: { id: string; label: string }): void {
    scopeState = openPack(scopeState, { id: pack.id, label: pack.label });
    previewDoc = null;
    error = null;
  }

  /** Collapse/expand one shelf group and remember it on the device (REQ-CPD-023). */
  function toggleGroup(documentType: string): void {
    const next = toggleCollapsedGroup(collapsedGroups, documentType);
    collapsedGroups = next;
    saveCollapsedGroups(worldId, userId, next);
  }

  /** REQ-CPD-015: the way back the header always offers. */
  function goBackToShelf(): void {
    scopeState = backToShelf(scopeState);
    packEntries = [];
    loadedPackId = null;
    packFilters = {};
    previewDoc = null;
    error = null;
  }

  /** REQ-CPD-014: same text, whole collection. */
  function widenSearch(): void {
    scopeState = widenToWholeCollection(scopeState);
    packEntries = [];
    loadedPackId = null;
    packFilters = {};
  }

  function onSearchInput(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value;
    scopeState = setSearch(scopeState, value);
  }

  function onLevelInput(bound: "minLevel" | "maxLevel", event: Event): void {
    const raw = (event.currentTarget as HTMLInputElement).value;
    const value = Number.parseInt(raw, 10);
    scopeState = Number.isFinite(value)
      ? setFacet(scopeState, bound, value)
      : clearFacet(scopeState, bound);
  }

  /** Open the pack a truncated group points at (REQ-CPD-032, from the result). */
  function openPackById(packId: string, packLabel: string): void {
    scopeState = openPack(scopeState, { id: packId, label: packLabel });
  }

  // ---- Preview / import (owned by G094 / G095) ----

  async function previewEntry(entry: PackIndexEntry): Promise<void> {
    lastPreviewEntry = entry;
    previewLoading = true;
    previewDoc = null;
    previewImgBroken = false;
    previewError = null;
    try {
      const result = await getDocument(socket, entry.uuid);
      previewDoc = result.document;
    } catch (err) {
      previewError = err instanceof Error ? err.message : "Falha ao carregar documento";
    } finally {
      previewLoading = false;
    }
  }

  function retryPreview(): void {
    if (lastPreviewEntry) void previewEntry(lastPreviewEntry);
  }

  function closePreview(): void {
    previewDoc = null;
    previewError = null;
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

  function handleDragStart(event: DragEvent, entry: PackIndexEntry, manifest: PackManifest): void {
    if (!event.dataTransfer) return;
    const payload: CompendiumDragPayload = buildCompendiumDragPayload(entry, manifest);
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

  // ---- Image fallback (REQ-CPD-045) ----

  /** Uuids whose `<img>` failed here, so the line draws its type icon instead. */
  let brokenImgUuids = $state<Set<string>>(new Set());

  function handleImgError(uuid: string): void {
    brokenImgUuids = new Set(brokenImgUuids).add(uuid);
  }

  // ---- Result lines (REQ-CPD-040..046) ----

  /**
   * Build one line. Everything the entry cannot know comes from here: the
   * reader's role (which decides whether a creature statistic may be drawn at
   * all, REQ-CPD-046), the fields the owning pack declared (REQ-CPD-041), the
   * world's origin index, and the live set of broken images.
   */
  function lineFor(
    entry: PackIndexEntry,
    source: { documentType: string; packId: string; packLabel: string | null },
    indexFields: readonly string[],
  ): ReturnType<typeof buildResultLine> {
    return buildResultLine(entry, {
      documentType: source.documentType,
      packId: source.packId,
      packLabel: source.packLabel,
      indexFields,
      locale: i18n.locale,
      search: scopeState.search,
      viewerIsPrivileged: isGm,
      worldOrigins,
      brokenImages: brokenImgUuids,
    });
  }

  /** The manifest of a pack named by an aggregated line, when it is loaded. */
  function manifestOf(packId: string): PackManifest | null {
    return packs.find((pack) => pack.id === packId) ?? null;
  }
</script>

<div class="compendium-browser">
  <!--
    Header and search bar are OUTSIDE `.compendium-browser__scroll`, the panel's
    only scrolling area: both stay visible in either body and in any scope
    (REQ-CPD-015, REQ-CPD-016).
  -->
  <div class="compendium-browser__scope" data-mode={mode}>
    <span class="compendium-browser__scope-label">
      {scopeInfo.packLabel === null
        ? t(scopeInfo.labelKey)
        : t(scopeInfo.labelKey, { pack: scopeInfo.packLabel })}
    </span>
    {#if scopeInfo.canGoBack}
      <button class="btn btn--sm btn--ghost compendium-browser__back" onclick={goBackToShelf}>
        {t("FUSION.Compendium.BackToShelf")}
      </button>
    {/if}
  </div>

  <div class="compendium-browser__search">
    <input
      class="compendium-browser__search-input"
      type="search"
      value={scopeState.search}
      oninput={onSearchInput}
      placeholder={scopeInfo.packLabel === null
        ? t("FUSION.Compendium.SearchAll")
        : t("FUSION.Compendium.SearchInPack", { pack: scopeInfo.packLabel })}
      aria-label={t("FUSION.Compendium.SearchLabel")}
    />
    {#if canWiden}
      <!-- REQ-CPD-014: same text, root scope — an explicit action, never implicit. -->
      <button class="btn btn--sm compendium-browser__widen" onclick={widenSearch}>
        {t("FUSION.Compendium.WidenSearch")}
      </button>
    {/if}
  </div>

  <div class="compendium-browser__scroll">
    {#if error}
      <p class="compendium-browser__error" role="alert">{error}</p>
      <button class="btn btn--sm" onclick={loadPacks}>{t("FUSION.Compendium.Retry")}</button>
    {:else if mode === "shelf"}
      <!--
        Shelf: every visible pack, grouped by document type (REQ-CPD-011,
        REQ-CPD-020). It is a branch of the same `{#if}` as the result body, so
        the two can never be on screen together (REQ-CPD-024).
      -->
      <div class="compendium-browser__shelf">
        {#if loading && packs.length === 0}
          <p class="compendium-browser__loading" role="status">
            {t("FUSION.Compendium.Loading")}
          </p>
        {:else if shelfGroups.length === 0}
          <p class="compendium-browser__empty">{t("FUSION.Compendium.Empty")}</p>
        {:else}
          <CompendiumShelf
            groups={shelfGroups}
            onOpenPack={selectPack}
            onToggleGroup={toggleGroup}
          />
        {/if}
      </div>
    {:else if openPackId === null}
      <!-- Aggregated result over the whole visible collection (REQ-CPD-012). -->
      <div class="compendium-browser__results compendium-browser__results--all">
        {#if searching}
          <p class="compendium-browser__loading" role="status">
            {t("FUSION.Compendium.Searching")}
          </p>
        {:else if searchError}
          <p class="compendium-browser__error" role="alert">{searchError}</p>
        {:else if !aggregated || aggregated.groups.length === 0}
          <p class="compendium-browser__empty">
            {t("FUSION.Compendium.NoResultsInScope", {
              query: scopeState.search,
              scope: t("FUSION.Compendium.Scope.All"),
            })}
          </p>
        {:else}
          {#each aggregated.groups as group (group.documentType)}
            <div class="result-group">
              <h3 class="result-group__heading">
                {t(documentTypeLabelKey(group.documentType))}
                <span class="result-group__count">{group.total}</span>
              </h3>
              <ul class="entry-list" role="list">
                {#each group.lines as line (line.entry.uuid)}
                  {@const manifest = manifestOf(line.packId)}
                  <CompendiumResultLine
                    line={lineFor(
                      line.entry,
                      {
                        documentType: line.documentType,
                        packId: line.packId,
                        packLabel: line.packLabel,
                      },
                      manifest?.indexFields ?? [],
                    )}
                    onPreview={() => previewEntry(line.entry)}
                    onDragStart={(event) => {
                      if (manifest) handleDragStart(event, line.entry, manifest);
                    }}
                    onImageError={() => handleImgError(line.entry.uuid)}
                  />
                {/each}
              </ul>
              {#if group.omitted > 0}
                <p class="result-group__omitted">
                  {t("FUSION.Compendium.Omitted", { count: group.omitted })}
                </p>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <!-- The open pack's own index; the search above filters only it (REQ-CPD-013/014). -->
      <div class="compendium-browser__results compendium-browser__results--pack">
        {#if selectedPack && selectedPack.documentType === "Item"}
          <div class="entries-filter">
            <input
              class="entries-filter__input entries-filter__input--sm"
              type="text"
              placeholder={t("FUSION.Compendium.FilterSubtype")}
              bind:value={packFilters.subtype}
              aria-label={t("FUSION.Compendium.FilterSubtype")}
            />
            <input
              class="entries-filter__input entries-filter__input--sm"
              type="text"
              placeholder={t("FUSION.Compendium.FilterTrait")}
              bind:value={packFilters.trait}
              aria-label={t("FUSION.Compendium.FilterTrait")}
            />
            <div class="entries-filter__row">
              <input
                class="entries-filter__input entries-filter__input--sm"
                type="number"
                placeholder={t("FUSION.Compendium.FilterMinLevel")}
                min={0}
                max={20}
                value={scopeState.facets.minLevel ?? ""}
                oninput={(e) => onLevelInput("minLevel", e)}
                aria-label={t("FUSION.Compendium.FilterMinLevel")}
              />
              <input
                class="entries-filter__input entries-filter__input--sm"
                type="number"
                placeholder={t("FUSION.Compendium.FilterMaxLevel")}
                min={0}
                max={20}
                value={scopeState.facets.maxLevel ?? ""}
                oninput={(e) => onLevelInput("maxLevel", e)}
                aria-label={t("FUSION.Compendium.FilterMaxLevel")}
              />
            </div>
          </div>
        {/if}

        {#if loading}
          <p class="compendium-browser__loading" role="status">{t("FUSION.Compendium.Loading")}</p>
        {:else if selectedPack}
          <div class="entries-sort" role="toolbar" aria-label={t("FUSION.Compendium.SortBy")}>
            <button class="sort-btn" onclick={() => toggleSort("name")}>
              {t("FUSION.Compendium.SortName")}{sortArrow("name")}
            </button>
            {#if selectedPack.indexFields.includes("system.level.value")}
              <button class="sort-btn" onclick={() => toggleSort("level")}>
                {t("FUSION.Compendium.SortLevel")}{sortArrow("level")}
              </button>
            {/if}
            <button class="sort-btn" onclick={() => toggleSort("type")}>
              {t("FUSION.Compendium.SortType")}{sortArrow("type")}
            </button>
          </div>

          <ul class="entry-list" role="list" aria-label={t("FUSION.Compendium.EntriesLabel")}>
            {#if filteredEntries.length === 0}
              <li class="entry-list__empty">
                {t("FUSION.Compendium.NoResultsInScope", {
                  query: scopeState.search,
                  scope: selectedPack.label,
                })}
                {#if canWiden}
                  <button class="btn btn--sm btn--ghost" onclick={widenSearch}>
                    {t("FUSION.Compendium.WidenSearch")}
                  </button>
                {/if}
              </li>
            {:else}
              {#each filteredEntries as entry (entry._id)}
                <CompendiumResultLine
                  line={lineFor(
                    entry,
                    {
                      documentType: selectedPack.documentType,
                      packId: selectedPack.id,
                      packLabel: null,
                    },
                    selectedPack.indexFields,
                  )}
                  onPreview={() => previewEntry(entry)}
                  onImport={isGm ? () => importEntry(entry) : undefined}
                  importing={importingUuids.has(entry.uuid)}
                  onDragStart={(event) => handleDragStart(event, entry, selectedPack)}
                  onImageError={() => handleImgError(entry.uuid)}
                />
              {/each}
            {/if}
          </ul>

          {#if importSuccess}
            <p class="compendium-browser__success" role="status">{importSuccess}</p>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- Preview panel — moves to a floating window in G094 (DEC-CPD-03). -->
    {#if previewLoading}
      <div class="preview-panel preview-panel--loading" role="status">
        Carregando pré-visualização…
      </div>
    {:else if previewError}
      <div class="preview-panel preview-panel--error" role="alert">
        <p class="preview-panel__error-msg">Falha ao carregar a pré-visualização.</p>
        <div class="preview-panel__error-actions">
          <button class="btn btn--sm" onclick={retryPreview}>Tentar novamente</button>
          <button class="btn btn--sm btn--ghost" onclick={closePreview}>Fechar</button>
        </div>
      </div>
    {:else if previewData}
      <svelte:boundary>
        <div class="preview-panel" role="complementary" aria-label="Pré-visualização">
          <div class="preview-panel__header">
            {#if !isKnownPlaceholderImg(previewData.img) && !previewImgBroken}
              <img
                class="preview-panel__img"
                src={previewData.img}
                alt=""
                aria-hidden="true"
                onerror={() => {
                  previewImgBroken = true;
                }}
              />
            {:else}
              <span class="preview-panel__img preview-panel__img--placeholder" aria-hidden="true">
                {fallbackIcon(selectedPack?.documentType ?? "", previewData.type)}
              </span>
            {/if}
            <div>
              <h4 class="preview-panel__name">{previewData.name}</h4>
              {#if previewData.nameSecondary}
                <span class="preview-panel__name-en" title={previewData.nameSecondary}>
                  {previewData.nameSecondary}
                </span>
              {/if}
              {#if previewData.type}
                <span class="preview-panel__type">{previewData.type}</span>
              {/if}
              <span class="preview-panel__license">{previewData.licenseLabel}</span>
            </div>
          </div>
          {#if previewData.description}
            <p class="preview-panel__description">{previewData.description}</p>
          {/if}
          <dl class="preview-panel__fields">
            {#each previewData.fields as field (field.key)}
              <div class="preview-panel__field">
                <dt class="preview-panel__field-label">{field.label}</dt>
                <dd class="preview-panel__field-value">{field.value}</dd>
              </div>
            {/each}
          </dl>
          <button
            class="preview-panel__close btn btn--sm btn--ghost"
            onclick={closePreview}
            aria-label="Fechar pré-visualização"
          >
            Fechar
          </button>
        </div>

        {#snippet failed(_error, reset)}
          <div class="preview-panel preview-panel--error" role="alert">
            <p class="preview-panel__error-msg">Não foi possível exibir esta pré-visualização.</p>
            <div class="preview-panel__error-actions">
              <button
                class="btn btn--sm"
                onclick={() => {
                  reset();
                  retryPreview();
                }}
              >
                Tentar novamente
              </button>
              <button class="btn btn--sm btn--ghost" onclick={closePreview}>Fechar</button>
            </div>
          </div>
        {/snippet}
      </svelte:boundary>
    {/if}
  </div>
</div>

<style>
  /*
   * The panel declares no width of its own, and neither body does: the drawer
   * owns the one fixed width (REQ-GAV-012), so switching between shelf and
   * result cannot move it (REQ-CPD-017). Wide content is clipped by the scroll
   * area instead of pushing the column. Layout is a fixed head (scope + search)
   * over ONE scrolling area (REQ-CPD-016).
   */
  .compendium-browser {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    height: 100%;
    overflow: hidden;
    padding: 0.5rem;
    font-size: 0.85rem;
  }

  .compendium-browser__scope {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .compendium-browser__scope-label {
    font-weight: 600;
    color: var(--fusion-text, #eee);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compendium-browser__search {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .compendium-browser__search-input,
  .entries-filter__input {
    /* Stretches to whatever the drawer gives it — never asks for a size. */
    width: 100%;
    box-sizing: border-box;
    padding: 0.3rem 0.5rem;
    background: var(--fusion-surface-alt, #2a2a2a);
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-text, #eee);
    font-size: 0.8rem;
  }

  .compendium-browser__scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .compendium-browser__loading,
  .compendium-browser__empty,
  .compendium-browser__error,
  .compendium-browser__success {
    padding: 0.5rem;
    text-align: center;
    color: var(--fusion-text-muted, #888);
  }

  .compendium-browser__error {
    color: var(--fusion-danger, #e74c3c);
  }
  .compendium-browser__success {
    color: var(--fusion-success, #27ae60);
  }

  /* ---- Bodies: same box, different content (REQ-CPD-010, REQ-CPD-017) ---- */
  .compendium-browser__shelf,
  .compendium-browser__results {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  /* The shelf's own rules live in CompendiumShelf.svelte, which draws it. */
  .result-group__heading {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fusion-text-muted, #888);
    margin: 0 0 0.25rem;
    padding: 0 0.25rem;
    display: flex;
    justify-content: space-between;
    gap: 0.4rem;
  }

  .result-group__count {
    font-size: 0.7rem;
    color: var(--fusion-text-muted, #888);
    background: var(--fusion-surface, #222);
    border-radius: 9999px;
    padding: 0.1rem 0.4rem;
  }

  /* ---- Results (both scopes) ---- */
  .result-group {
    margin-bottom: 0.75rem;
  }

  .result-group__omitted {
    font-size: 0.7rem;
    color: var(--fusion-text-muted, #888);
    margin: 0.2rem 0 0;
    padding: 0 0.25rem;
  }

  .entries-filter {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.3rem;
  }

  .entries-filter__input--sm {
    font-size: 0.75rem;
    padding: 0.2rem 0.4rem;
  }

  .entries-filter__row {
    display: flex;
    gap: 0.25rem;
  }

  .entries-filter__row .entries-filter__input {
    flex: 1;
  }

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

  .sort-btn:hover {
    background: var(--fusion-surface-alt, #2a2a2a);
  }

  .entry-list {
    list-style: none;
    margin: 0;
    padding: 0;
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

  /*
   * The line's own rules live in CompendiumResultLine.svelte, which draws it
   * (G093). What stays here is the list that holds the lines.
   */

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

  .preview-panel__name-en {
    display: block;
    font-size: 0.7rem;
    font-style: italic;
    color: var(--fusion-text-muted, #888);
    margin-bottom: 0.1rem;
  }

  .preview-panel__description {
    font-size: 0.78rem;
    color: var(--fusion-text, #eee);
    margin: 0 0 0.4rem;
    line-height: 1.35;
    white-space: pre-wrap;
  }

  .preview-panel__type,
  .preview-panel__license {
    font-size: 0.7rem;
    color: var(--fusion-text-muted, #888);
    margin-right: 0.4rem;
  }

  .preview-panel--error {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: center;
    text-align: center;
  }

  .preview-panel__error-msg {
    margin: 0;
    color: var(--fusion-danger, #e74c3c);
    font-size: 0.8rem;
  }

  .preview-panel__error-actions {
    display: flex;
    gap: 0.4rem;
  }

  .preview-panel__fields {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.15rem 0.5rem;
    margin: 0 0 0.4rem;
    font-size: 0.78rem;
  }

  .preview-panel__field {
    display: contents;
  }

  .preview-panel__field-label {
    color: var(--fusion-text-muted, #888);
    font-style: italic;
  }

  .preview-panel__field-value {
    color: var(--fusion-text, #eee);
  }

  .preview-panel__close {
    margin-top: 0.25rem;
  }

  /*
   * The search highlight is drawn by the line itself
   * (`.result-line__match` in CompendiumResultLine.svelte), so this panel no
   * longer reaches into its children to style a `<mark>`.
   */
</style>
