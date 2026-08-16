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
   * Previewing does NOT happen in this panel (G094, DEC-CPD-03): it opens a
   * floating window through `lib/compendium/previewWindow.ts`, so the list stays
   * where it was and two documents can be compared side by side (REQ-CPD-050,
   * REQ-CPD-054). This file therefore holds no preview state at all — the blade
   * that used to replace the list here is gone.
   *
   * Bringing an entry over (G095, DEC-CPD-05) has TWO destinations and one
   * gesture: the world, which stays privileged (REQ-CPD-060), and a SHEET the
   * seat owns, which is open to a player because the predicate is `OWNER` of
   * the destination and it is checked on the server (REQ-CPD-061/073). The
   * destination is chosen once, in the header, and the per-line action follows
   * it — the seal never blocks it, so bringing the same entry twice is two
   * documents (REQ-CPD-064). The batch runs through `lib/compendium/
   * batchImport.ts`, with progress and a cancel that reports what already
   * landed instead of pretending nothing did (REQ-CPD-065).
   *
   * What this panel does NOT do (REQ-CPD-066): create a document from scratch,
   * or edit a pack document. Authoring is spec 42's.
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
    buildSearchAllPayload,
    documentTypeLabelKey,
    normalizeAggregatedSearchResult,
    type AggregatedSearchResult,
    type SortField,
    type CompendiumDragPayload,
  } from "../../lib/compendium/compendiumBrowser.js";
  import {
    buildResultLine,
    buildWorldOriginIndex,
    EMPTY_WORLD_ORIGIN_INDEX,
    type ResultLine,
    type WorldOriginIndex,
  } from "../../lib/compendium/resultLine.js";
  import { openCompendiumPreviewWindow } from "../../lib/compendium/previewWindow.js";
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
  import CompendiumMarks from "./CompendiumMarks.svelte";
  import {
    filterByVisiblePacks,
    isEntryPinned,
    loadBrowserView,
    loadPinnedEntries,
    loadRecentEntries,
    reconcileBrowserView,
    recordRecentEntry,
    saveBrowserView,
    savePinnedEntries,
    saveRecentEntries,
    togglePinnedEntry,
    type CompendiumEntryRef,
    type CompendiumRecentEntry,
    type CompendiumRecentReason,
  } from "../../lib/compendium/compendiumPrefs.js";
  import {
    listPacks,
    getPackIndex,
    importToWorld,
    importToActor,
    searchAllPacks,
  } from "../../lib/compendium/compendiumApi.js";
  import {
    buildSheetTargets,
    canBringToSheet,
    canBringToWorld,
    type SheetTarget,
  } from "../../lib/compendium/importTargets.js";
  import {
    batchOutcomeMessage,
    runBatchImport,
    type BatchImportProgress,
    type BatchImportRun,
  } from "../../lib/compendium/batchImport.js";
  import {
    finishCompendiumBatchImport,
    startCompendiumBatchImport,
  } from "../../lib/compendium/importActivity.js";
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

  // ---- What survives a tab switch, and the marks (REQ-CPD-080..084) ----

  /**
   * The drawer unmounts this panel when the user goes to Chat (REQ-GAV-017), so
   * the scope, the text and the facets are read back from the browser session on
   * the way in (REQ-CPD-080) and written on every change. `sessionStorage` is
   * the whole expiry rule: closing the browser tab starts clean (DEC-CPD-09).
   */
  let viewRestored = false;

  $effect(() => {
    if (viewRestored) return;
    viewRestored = true;
    scopeState = loadBrowserView(worldId, userId);
  });

  $effect(() => {
    if (!viewRestored) return;
    saveBrowserView(worldId, userId, scopeState);
  });

  /** Pinned entries and the recently used block — on the device (REQ-CPD-082/083). */
  let pinnedEntries = $state<readonly CompendiumEntryRef[]>([]);
  let recentEntries = $state<readonly CompendiumRecentEntry[]>([]);

  $effect(() => {
    pinnedEntries = loadPinnedEntries(worldId, userId);
    recentEntries = loadRecentEntries(worldId, userId);
  });

  const visiblePackIds = $derived(packs.map((pack) => pack.id));

  /**
   * REQ-CPD-084: a mark whose pack the seat can no longer see is simply not
   * drawn — no error, nothing else removed, and nothing deleted from the device.
   */
  const drawnPinned = $derived(filterByVisiblePacks(pinnedEntries, visiblePackIds));
  const drawnRecent = $derived(filterByVisiblePacks(recentEntries, visiblePackIds));

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
  /** The world's actors, for the sheet destinations of §5.7 (REQ-CPD-061). */
  let worldActors = $state<unknown[]>([]);

  $effect(() => {
    const refresh = (): void => {
      const actors = worldMirror.getByType<unknown>("Actor");
      worldActors = [...actors];
      worldOrigins = buildWorldOriginIndex([...actors, ...worldMirror.getByType<unknown>("Item")]);
    };
    refresh();
    const offActors = worldMirror.subscribe<unknown>("Actor", refresh);
    const offItems = worldMirror.subscribe<unknown>("Item", refresh);
    return () => {
      offActors();
      offItems();
    };
  });

  // ---- Bringing entries over (G095, DEC-CPD-05) ----

  let importingUuids = $state<Set<string>>(new Set());
  let importSuccess = $state<string | null>(null);

  const viewer = $derived({ userId, isPrivileged: isGm });

  /**
   * The sheets this seat may fill (REQ-CPD-061). Computed here only to avoid
   * offering a door the server would slam — the server re-reads the
   * destination's ownership on every call (REQ-CPD-074).
   */
  const sheetTargets = $derived<SheetTarget[]>(buildSheetTargets(worldActors, viewer));

  /** `"world"` or an actor `_id`. The whole panel brings to one place at a time. */
  let destination = $state<string>("world");

  /**
   * The destination actually in force. A player has no world door, so the
   * stored `"world"` collapses to his first sheet; a seat that lost the sheet
   * it had chosen falls back the same way instead of pointing at nothing.
   */
  const activeDestination = $derived.by<{ kind: "world" } | { kind: "sheet"; target: SheetTarget }>(
    () => {
      if (destination !== "world") {
        const target = sheetTargets.find((s) => s.actorId === destination);
        if (target) return { kind: "sheet", target };
      }
      if (canBringToWorld(viewer)) return { kind: "world" };
      const first = sheetTargets[0];
      return first ? { kind: "sheet", target: first } : { kind: "world" };
    },
  );

  /** Whether a line of this document type can be brought to the destination. */
  function canBring(documentType: string): boolean {
    return activeDestination.kind === "world"
      ? canBringToWorld(viewer)
      : canBringToSheet(documentType, sheetTargets);
  }

  // ---- Batch import (REQ-CPD-065) ----

  let batchRun: BatchImportRun | null = null;
  let batchProgress = $state<BatchImportProgress | null>(null);
  /** What the last run left behind — including the partial-state warning. */
  let batchNotice = $state<string | null>(null);

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
      // A restored scope pointing at a pack this seat no longer sees lands back
      // on the root instead of asking the server for it (REQ-CPD-084).
      scopeState = reconcileBrowserView(
        scopeState,
        packs.map((pack) => pack.id),
      );
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

  // ---- Marks: pinning and recording a use (REQ-CPD-082/083) ----

  /** Open the pack a pinned or recent row came from (REQ-CPD-013). */
  function openPackOfEntry(entry: CompendiumEntryRef): void {
    openPackById(entry.packId, manifestOf(entry.packId)?.label ?? entry.packId);
  }

  function togglePin(entry: CompendiumEntryRef): void {
    const next = togglePinnedEntry(pinnedEntries, entry);
    pinnedEntries = next;
    savePinnedEntries(worldId, userId, next);
  }

  /** Previewing and bringing over are what feed the recent block (REQ-CPD-083). */
  function noteUse(entry: CompendiumEntryRef, reason: CompendiumRecentReason): void {
    const next = recordRecentEntry(recentEntries, entry, reason);
    recentEntries = next;
    saveRecentEntries(worldId, userId, next);
  }

  /** The mark of one drawn line — what a pin or a recent row needs to be listed. */
  function entryRefOf(line: ResultLine): CompendiumEntryRef {
    return {
      uuid: line.uuid,
      packId: line.packId,
      name: line.nameText,
      documentType: line.documentType,
    };
  }

  // ---- Preview (G094) ----

  /**
   * Preview leaves the drawer (REQ-CPD-050, DEC-CPD-03): a window of the window
   * manager opens, keyed by the document's uuid, and this panel keeps drawing
   * the very same list behind it. Pressing preview twice on one line focuses
   * the window already open; two different lines are two windows (REQ-CPD-054).
   * Closing the drawer closes none of them — they are not mounted here.
   */
  function openPreview(line: ResultLine, manifest: PackManifest | null): void {
    noteUse(entryRefOf(line), "preview");
    openCompendiumPreviewWindow(
      {
        uuid: line.uuid,
        name: line.nameText,
        documentType: line.documentType,
        packId: line.packId,
        packLabel: manifest?.label ?? line.packLabel,
        packLicense: manifest?.license ?? null,
        // REQ-CPD-053: the window inherits the line's permission AND its
        // destination, never widens either. A sheet is handed over only when
        // the line itself could have brought this type into it (REQ-CPD-061).
        canImport: activeDestination.kind === "world" && canBringToWorld(viewer),
        sheetTarget:
          activeDestination.kind === "sheet" && canBring(line.documentType)
            ? {
                actorId: activeDestination.target.actorId,
                name: activeDestination.target.name,
              }
            : null,
      },
      t("FUSION.Compendium.Preview.Title"),
    );
  }

  // ---- Bringing one entry over (G095) ----

  /**
   * Send one entry to the destination in force. The two doors of §5.7 are one
   * gesture here on purpose: the panel never asks the user which permission he
   * has, it asks WHERE, and the server answers whether that where is his
   * (REQ-CPD-060, REQ-CPD-061, REQ-CPD-073).
   *
   * Nothing consults the in-world seal: bringing an entry that is already in
   * the world is allowed and makes a second document (REQ-CPD-064).
   */
  async function bringOver(line: ResultLine): Promise<void> {
    const target = activeDestination;
    if (!canBring(line.documentType)) return;

    importingUuids = new Set([...importingUuids, line.uuid]);
    importSuccess = null;
    error = null;
    try {
      if (target.kind === "world") {
        await importToWorld(socket, [line.uuid]);
        importSuccess = t("FUSION.Compendium.Import.ToWorldDone", { name: line.nameText });
      } else {
        await importToActor(socket, [line.uuid], target.target.actorId);
        importSuccess = t("FUSION.Compendium.Import.ToSheetDone", {
          name: line.nameText,
          sheet: target.target.name,
        });
      }
      // Bringing an entry over is a use, like previewing it (REQ-CPD-083).
      noteUse(entryRefOf(line), "import");
    } catch (err) {
      error = err instanceof Error ? err.message : t("FUSION.Compendium.Import.Failed");
    } finally {
      const next = new Set(importingUuids);
      next.delete(line.uuid);
      importingUuids = next;
    }
  }

  // ---- Bringing the whole list over (REQ-CPD-065) ----

  /** The uuids the body is showing right now — what a batch acts on. */
  const listedUuids = $derived.by<string[]>(() => {
    if (openPackId !== null) return filteredEntries.map((entry) => entry.uuid);
    if (!aggregated) return [];
    return aggregated.groups.flatMap((group) => group.lines.map((line) => line.entry.uuid));
  });

  /**
   * Batch import (spec 43 §8.3, REQ-CPD-065). The header offers it to a
   * privileged seat, over whatever the body currently lists.
   *
   * The dot on the tab is lit for the whole run and put out on EVERY exit —
   * finished, failed or cancelled (REQ-CPD-003) — which is why the badge calls
   * are a try/finally around the await and not a happy-path pair.
   */
  function startBatchImport(): void {
    if (batchRun || listedUuids.length === 0 || activeDestination.kind !== "world") return;

    const runId = `compendium-batch-${String(Date.now())}`;
    batchNotice = null;
    startCompendiumBatchImport(runId);

    const run = runBatchImport({
      uuids: listedUuids,
      importChunk: async (uuids) => {
        const result = await importToWorld(socket, [...uuids]);
        return { created: result.created, failed: result.failed };
      },
      onProgress: (progress) => {
        batchProgress = progress;
      },
    });
    batchRun = run;

    void (async () => {
      try {
        const outcome = await run.promise;
        // The warning REQ-CPD-065 demands: a cancelled run that already brought
        // documents over says so, with the count, instead of going quiet. The
        // choice of message lives in `batchOutcomeMessage`, where it is tested.
        const message = batchOutcomeMessage(outcome);
        batchNotice = t(message.key, message.vars);
      } finally {
        finishCompendiumBatchImport(runId);
        batchRun = null;
        batchProgress = null;
      }
    })();
  }

  function cancelBatchImport(): void {
    batchRun?.cancel();
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

  <!--
    Where things go (REQ-CPD-060/061). The picker only appears when there is a
    real choice: a player with one sheet and no world door has nothing to pick,
    and a seat with no destination at all sees no import affordance anywhere.
  -->
  {#if sheetTargets.length > 0 || canBringToWorld(viewer)}
    <div class="compendium-browser__import">
      {#if sheetTargets.length > 0 && (canBringToWorld(viewer) || sheetTargets.length > 1)}
        <label class="compendium-browser__destination">
          <span class="compendium-browser__destination-label">
            {t("FUSION.Compendium.Import.Destination")}
          </span>
          <select bind:value={destination} class="compendium-browser__destination-select">
            {#if canBringToWorld(viewer)}
              <option value="world">{t("FUSION.Compendium.Import.DestinationWorld")}</option>
            {/if}
            {#each sheetTargets as target (target.actorId)}
              <option value={target.actorId}>{target.name}</option>
            {/each}
          </select>
        </label>
      {/if}

      <!--
        Batch import, offered to a privileged seat over what the body lists
        (spec 43 §8.3). While it runs the button becomes progress plus a way
        out, and the result — including the partial-state warning — is written
        under it (REQ-CPD-065).
      -->
      {#if canBringToWorld(viewer) && activeDestination.kind === "world"}
        {#if batchProgress}
          <div class="compendium-browser__batch" role="status">
            <span class="compendium-browser__batch-progress">
              {batchProgress.cancelling
                ? t("FUSION.Compendium.Import.BatchCancelling")
                : t("FUSION.Compendium.Import.BatchProgress", {
                    done: batchProgress.done,
                    total: batchProgress.total,
                  })}
            </span>
            <progress
              class="compendium-browser__batch-bar"
              max={batchProgress.total}
              value={batchProgress.done}
            ></progress>
            <button
              class="btn btn--sm btn--ghost"
              onclick={cancelBatchImport}
              disabled={batchProgress.cancelling}
            >
              {t("FUSION.Compendium.Import.BatchCancel")}
            </button>
          </div>
        {:else if listedUuids.length > 0}
          <button class="btn btn--sm compendium-browser__batch-start" onclick={startBatchImport}>
            {t("FUSION.Compendium.Import.Batch", { count: listedUuids.length })}
          </button>
        {/if}
      {/if}

      {#if batchNotice}
        <p class="compendium-browser__batch-notice" role="status">{batchNotice}</p>
      {/if}
    </div>
  {/if}

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
          <!--
            Pinned first, then the short recently used block, then the packs
            (REQ-CPD-082, REQ-CPD-083). Both lists arrive already filtered by
            what this seat may see (REQ-CPD-084).
          -->
          <CompendiumMarks
            pinned={drawnPinned}
            recent={drawnRecent}
            onOpenPack={openPackOfEntry}
            onUnpin={togglePin}
          />
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
                  {@const built = lineFor(
                    line.entry,
                    {
                      documentType: line.documentType,
                      packId: line.packId,
                      packLabel: line.packLabel,
                    },
                    manifest?.indexFields ?? [],
                  )}
                  <CompendiumResultLine
                    line={built}
                    onPreview={() => openPreview(built, manifest)}
                    onImport={canBring(built.documentType) ? () => bringOver(built) : undefined}
                    importDestination={activeDestination.kind}
                    importing={importingUuids.has(built.uuid)}
                    onTogglePin={() => togglePin(entryRefOf(built))}
                    pinned={isEntryPinned(pinnedEntries, built.uuid)}
                    onDragStart={(event) => {
                      if (manifest) handleDragStart(event, line.entry, manifest);
                    }}
                    onImageError={() => handleImgError(line.entry.uuid)}
                  />
                {/each}
              </ul>
              {#if group.omitted > 0}
                <!--
                  REQ-CPD-032: the truncated group says how many it left out AND
                  offers opening the pack they are in — the count alone leaves
                  the reader with no way to reach the rest.
                -->
                <p class="result-group__omitted">
                  {t("FUSION.Compendium.Omitted", { count: group.omitted })}
                </p>
                {#if group.packs.length > 0}
                  <ul
                    class="result-group__packs"
                    role="list"
                    aria-label={t("FUSION.Compendium.OmittedOpenLabel")}
                  >
                    {#each group.packs as tally (tally.packId)}
                      <li>
                        <button
                          type="button"
                          class="result-group__open-pack"
                          onclick={() => openPackById(tally.packId, tally.label)}
                        >
                          {t("FUSION.Compendium.OpenPackWithMatches", {
                            pack: tally.label,
                            count: tally.matched,
                          })}
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
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
                {@const built = lineFor(
                  entry,
                  {
                    documentType: selectedPack.documentType,
                    packId: selectedPack.id,
                    packLabel: null,
                  },
                  selectedPack.indexFields,
                )}
                <CompendiumResultLine
                  line={built}
                  onPreview={() => openPreview(built, selectedPack)}
                  onImport={canBring(built.documentType) ? () => bringOver(built) : undefined}
                  importDestination={activeDestination.kind}
                  onTogglePin={() => togglePin(entryRefOf(built))}
                  pinned={isEntryPinned(pinnedEntries, built.uuid)}
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

  /*
   * The import bar lives with the header, outside the scrolling area: a batch
   * that is running must stay visible while the user keeps reading the list
   * (REQ-CPD-016, REQ-CPD-065). Like everything else here it declares no width.
   */
  .compendium-browser__import {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .compendium-browser__destination {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: var(--fusion-text-muted, #aaa);
  }

  .compendium-browser__destination-select {
    flex: 1;
    min-width: 0;
    padding: 0.2rem 0.3rem;
    background: var(--fusion-surface-alt, #2a2a2a);
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-text, #eee);
    font-size: 0.75rem;
  }

  .compendium-browser__batch {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: var(--fusion-text-muted, #aaa);
  }

  .compendium-browser__batch-bar {
    flex: 1;
    min-width: 0;
    height: 0.5rem;
  }

  /*
   * The partial-state warning must be readable in full — it names how many
   * documents are already in the world (REQ-CPD-065), so it wraps and is never
   * truncated.
   */
  .compendium-browser__batch-notice {
    margin: 0;
    font-size: 0.75rem;
    color: var(--fusion-text-muted, #aaa);
    white-space: normal;
    overflow-wrap: anywhere;
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

  .result-group__packs {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin: 0.15rem 0 0;
    padding: 0 0.25rem;
  }

  .result-group__open-pack {
    font: inherit;
    font-size: 0.7rem;
    color: var(--fusion-accent, #6aa9ff);
    background: none;
    border: 1px solid var(--fusion-border, #333);
    border-radius: var(--fusion-radius-sm, 3px);
    padding: 0.1rem 0.35rem;
    cursor: pointer;
  }

  .result-group__open-pack:hover {
    color: var(--fusion-accent-hover, #8cc0ff);
    border-color: var(--fusion-accent, #6aa9ff);
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

  /*
   * Preview is not drawn here at all (G094, DEC-CPD-03): it opens in a
   * window of the window manager, so this panel has no rule for it — and no
   * way for it to push the list aside.
   */

  /*
   * The search highlight is drawn by the line itself
   * (`.result-line__match` in CompendiumResultLine.svelte), so this panel no
   * longer reaches into its children to style a `<mark>`.
   */
</style>
