<script lang="ts">
  /**
   * ScenesTab.svelte — the Cenas tab of the side drawer (spec 44, id "scenes").
   *
   * This is the scene panel that used to live INSIDE the pre-drawer sidebar: the
   * list, the active-scene dot, activate/edit/delete and the three dialogs. It moved
   * out unchanged (plan G016 is a bridge, not a redesign) so the drawer can mount it
   * through the registry like any other tab (REQ-GAV-030, REQ-CEN-001).
   *
   * What did NOT come along, because spec 36 owns it and not this tab:
   *  - the tab bar and the collapse control (REQ-GAV-011 — clicking the active tab in
   *    the rail is the only gesture, so there is no ✕ and no chevron here);
   *  - the drawer's width (REQ-GAV-012) — the panel simply fills what it is given.
   *
   * What spec 44 has already added on top of that move:
   *  - the "no ar" head (REQ-CEN-010..015): the top of the panel, outside the scroll,
   *    answering "what is the table looking at right now" before "which scenes exist"
   *    (DEC-CEN-01). Its rule lives in `lib/scenes/scenesTabVM.ts`; what is here is
   *    markup and the asset-token dance the VM deliberately does not do.
   *  - the dialogs as WINDOWS (REQ-CEN-060/061/063): creating, configuring
   *    and the delete confirmation open through `lib/scenes/sceneWindows.ts` — a
   *    form does not fit in 300px and the drawer never widens (DEC-CEN-09,
   *    DEC-GAV-04);
   *  - the archive (REQ-CEN-030..037, REQ-CEN-039): the other scenes of the world,
   *    grouped by folder in the manual order of the document, from
   *    `lib/scenes/sceneShelf.ts`. The scene on air is NOT repeated here — it lives in
   *    the head (REQ-CEN-036).
   *
   * Still to come with the rest of spec 44: the state dot of REQ-CEN-003..005 and the
   * local "preparo" of REQ-CEN-050..056.
   *
   * REQ-CEN-020..025 (the environment shortcuts and the perception door of the head)
   * were retired from this UI on 2026-08-17 — Alexandre's r1 test, item 25 ("fora por
   * enquanto", a decision, not a bug). DEC-SEP-05 (F2, 2026-08-23) went further and
   * REMOVED the server-side logic they used to trigger (`sceneEnvironment.ts`'s
   * darkness/fog/fog-reset gestures, and the perception window itself,
   * `ScenePerceptionDialog` + `openScenePerceptionWindow`) along with the rest of
   * the fog/vision pipeline — see `docs/design/separacao-repos/design.md`. The
   * configuration window's own door into perception is gone too: the only
   * surviving door out of this tab is `.scene-head__config`, straight into
   * `openSceneConfigWindow`. See `specs/44-aba-cenas.md` §5.3 (and its
   * DEC-SEP-05 banner) for the emended requirements.
   *
   * Content permission: the whole tab is group "gm" in the rail, but that is
   * ergonomics, not a boundary (REQ-GAV-034, DEC-CEN-11). Both halves are closed
   * server-side by `isRolePrivileged` (`documents/ownership.ts`):
   *  - the WRITES — creating, updating, deleting and activating a scene are
   *    refused for a non-privileged role by `doc:create/update/delete` and by the
   *    `world:activeScene` handler;
   *  - the READ — the list this panel draws (`sceneListState.scenes`) is fed by
   *    the world mirror, and every emission path that carries a Scene body
   *    (live broadcast, join snapshot, delta replay) funnels non-privileged
   *    sockets through `redactSceneDocsForNonPrivileged` (`net/redaction.ts`), so
   *    only the scene on air ever leaves the server (REQ-CEN-071..073).
   */

  import type { SceneDocument } from "@fusion/shared";
  import type { SidebarPanelProps } from "../../lib/sidebar/registry.js";
  import { sceneListState } from "../../lib/scenes/scenesState.svelte.js";
  import { activateScene, OpError } from "../../lib/scenes/sceneController.js";
  import {
    openSceneConfigWindow,
    openSceneCreateWindow,
    openSceneDeleteWindow,
  } from "../../lib/scenes/sceneWindows.js";
  import { t } from "../../lib/i18n/i18n.js";
  import { buildSceneHeadVM } from "../../lib/scenes/scenesTabVM.js";
  import {
    SCENE_SHELF_KEYS,
    buildSceneShelfVM,
    loadCollapsedSceneFolders,
    persistSceneOrder,
    reorderTargetIndexForKey,
    reorderWithinGroup,
    saveCollapsedSceneFolders,
    toggleCollapsedSceneFolder,
    type SceneShelfGroupVM,
  } from "../../lib/scenes/sceneShelf.js";
  import { needsAssetQueryToken, resolveAssetUrl } from "../../lib/assets/assetApi.js";
  import { fusionApi } from "../../lib/api.js";
  import TokenAddDialog from "./TokenAddDialog.svelte";
  import {
    enterScenePrepare,
    exitScenePrepare,
    scenePrepareState,
  } from "../../lib/scenes/prepareState.svelte.js";

  /** The contract the drawer hands every panel (registry, REQ-GAV-030). */
  const { socket, activeSceneId, userId, worldId }: SidebarPanelProps = $props();

  // --- The "no ar" head (REQ-CEN-010..015) -------------------------------------
  // A pure projection of the world: recomputing is how the head follows a change of
  // scene on air from ANY origin, with no reload and no local copy (REQ-CEN-015).
  const head = $derived(
    buildSceneHeadVM({ scenes: sceneListState.scenes, activeSceneId: activeSceneId }),
  );

  /**
   * The head's image once it is fetchable. Our `/assets/*` route needs a freshly minted
   * short-lived query-token and an `<img>` cannot send an Authorization header, so the
   * URL is resolved here (the r5 pattern of `ActorPortrait.svelte`). While it is in
   * flight the scene's own background colour is already painted underneath, so the head
   * never flashes empty and never changes height (REQ-CEN-012/013).
   */
  let resolvedBackground = $state<string | null>(null);

  /** An external URL or data URI needs no token — paint it without waiting a tick. */
  const immediateBackground = $derived(
    head.kind === "on-air" &&
      head.background.kind === "image" &&
      !needsAssetQueryToken(head.background.src)
      ? head.background.src
      : null,
  );

  const backgroundSrc = $derived(resolvedBackground ?? immediateBackground);

  $effect(() => {
    const onAir = head.kind === "on-air" ? head : null;
    const background = onAir?.background ?? null;
    if (background === null || background.kind !== "image") {
      resolvedBackground = null;
      return;
    }
    const raw = background.src;
    if (!needsAssetQueryToken(raw)) {
      resolvedBackground = raw;
      return;
    }
    const token = fusionApi.getToken();
    if (!token || !userId || onAir === null) {
      // No session to mint a token with → the colour box is the honest fallback.
      resolvedBackground = null;
      return;
    }
    let cancelled = false;
    // T025: the background is a field of the scene ON AIR, so that scene is the
    // document the grant is asked for. A player who cannot see the scene gets no
    // grant and the head keeps its colour box — the same thing it already shows
    // while the resolve is in flight, so nothing flashes.
    void resolveAssetUrl(raw, token, userId, { table: "scenes", id: onAir.sceneId })
      .then((url) => {
        if (!cancelled) resolvedBackground = url;
      })
      .catch(() => {
        if (!cancelled) resolvedBackground = null;
      });
    return () => {
      cancelled = true;
    };
  });

  // --- Adding a token (TK022-client, REQ-TOK-002, DEC-TOK-04) -------------------
  // `TokenAddDialog.svelte` already exists — form, actor search, validation, its own
  // test — but nothing in the tree ever mounted it, so a piece could only be created
  // by dragging an NPC row onto the canvas. It is a self-contained modal (its own
  // backdrop/`<dialog>`, unlike the four dialogs in `sceneWindows.ts`), so it mounts
  // inline here instead of through the window manager, gated on the scene actually
  // on air — there is no scene to drop the token onto otherwise.

  /** The document of the scene on air, straight from the world mirror. */
  function sceneOnAir(): SceneDocument | null {
    if (head.kind !== "on-air") return null;
    return sceneListState.scenes.find((scene) => scene._id === head.sceneId) ?? null;
  }

  let tokenAddOpen = $state(false);

  function openTokenAdd(): void {
    tokenAddOpen = true;
  }

  function closeTokenAdd(): void {
    tokenAddOpen = false;
  }

  /**
   * The offer of REQ-CEN-014 with no scene on air. Putting a scene on air is a choice
   * of WHICH scene, and this tab already draws that list right below — so the offer
   * moves the keyboard to the archive instead of picking a scene on the GM's behalf.
   */
  let archiveEl = $state<HTMLElement | null>(null);
  function focusArchive(): void {
    archiveEl?.focus();
  }

  // --- The archive (REQ-CEN-030..037, REQ-CEN-039) ------------------------------
  // Everything below the head: the OTHER scenes of the world, grouped by the folder of
  // each document and ordered by the document's manual `sort` (DEC-CEN-05). The rule
  // lives in `lib/scenes/sceneShelf.ts`; here there is markup, the device preference and
  // the drag wiring.

  /**
   * What this user collapsed on THIS device, in THIS world (REQ-CEN-033, DEC-UIF-10).
   *
   * Read once, on mount: the world and the user of a mounted panel do not change without
   * a new session, and re-reading storage on every keystroke would fight the toggles.
   */
  // svelte-ignore state_referenced_locally
  let collapsedGroups = $state<string[]>(loadCollapsedSceneFolders(worldId, userId));
  /** What the GM typed in the search field (REQ-CEN-034). */
  let searchQuery = $state("");

  const shelf = $derived(
    buildSceneShelfVM({
      scenes: sceneListState.scenes,
      activeSceneId: activeSceneId,
      folders: sceneListState.folders,
      collapsedFolderIds: collapsedGroups,
      query: searchQuery,
      // REQ-CEN-056: the archive marks the scene THIS Master is preparing.
      preparingSceneId: scenePrepareState.sceneId,
    }),
  );

  /**
   * Open a scene in prepare, or leave it when it is already the prepared one
   * (REQ-CEN-050, REQ-CEN-053).
   *
   * No socket in sight: the prepare is a value of this client and writing it to the
   * server would be the bug the requirement exists to prevent (REQ-CEN-051, RNF-CEN-03).
   */
  function togglePrepare(sceneId: string): void {
    if (scenePrepareState.sceneId === sceneId) exitScenePrepare();
    else enterScenePrepare(sceneId, activeSceneId);
  }

  function toggleGroup(groupKey: string): void {
    collapsedGroups = toggleCollapsedSceneFolder(collapsedGroups, groupKey);
    saveCollapsedSceneFolders(worldId, userId, collapsedGroups);
  }

  function groupLabel(group: SceneShelfGroupVM): string {
    return group.label ?? t(group.labelKey ?? SCENE_SHELF_KEYS.noFolder);
  }

  /** The document behind a line — the dialogs and the activation want the whole thing. */
  function sceneById(sceneId: string): SceneDocument | null {
    return sceneListState.scenes.find((scene) => scene._id === sceneId) ?? null;
  }

  // --- The four windows (REQ-CEN-060..064, DEC-CEN-09) -------------------------
  // None of them lives inside the drawer: 300px is not a form, so each opens as a
  // real window of the manager (`lib/scenes/sceneWindows.ts`, REQ-UIF-009). The tab
  // keeps no `showDialog` flag — the manager's registry IS the state, which is what
  // lets a window survive this panel being unmounted by a tab switch (REQ-GAV-017).

  let activatingId = $state<string | null>(null);
  let activateError = $state<string | null>(null);
  let shelfError = $state<string | null>(null);

  async function handleActivate(scene: SceneDocument): Promise<void> {
    if (activatingId !== null) return;
    activatingId = scene._id;
    activateError = null;
    try {
      await activateScene(socket, scene._id);
    } catch (err) {
      activateError = err instanceof OpError ? err.message : t("FUSION.Scene.Dialog.UnexpectedError");
    } finally {
      activatingId = null;
    }
  }

  // --- Reordering: by drag and by keyboard (REQ-CEN-037, REQ-CEN-090) -----------
  // Inside a group only: moving a scene to ANOTHER folder is a change of folder, and
  // that is the configuration window's business (DEC-CEN-05, REQ-CEN-061). A drop that
  // lands outside the dragged scene's own group simply computes no update.
  //
  // The drag is the gesture REQ-CEN-037 names, and it is a POINTER gesture: REQ-CEN-090
  // requires every action of the line to be reachable from the keyboard too, so the grip
  // is a real button and ↑/↓ on it walk the scene through its group. Both paths end in
  // `applyReorder`, so they cannot compute different orders.

  let draggingSceneId = $state<string | null>(null);

  async function applyReorder(
    group: SceneShelfGroupVM,
    movedSceneId: string,
    targetIndex: number,
  ): Promise<void> {
    const updates = reorderWithinGroup(group.entries, movedSceneId, targetIndex);
    if (updates.length === 0) return;

    shelfError = null;
    try {
      await persistSceneOrder(socket, updates);
    } catch (err) {
      shelfError = err instanceof OpError ? err.message : t(SCENE_SHELF_KEYS.reorderFailed);
    }
  }

  function handleDragStart(event: DragEvent, sceneId: string): void {
    draggingSceneId = sceneId;
    event.dataTransfer?.setData("text/plain", sceneId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(event: DragEvent): void {
    if (draggingSceneId === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function handleDragEnd(): void {
    draggingSceneId = null;
  }

  async function handleDrop(
    event: DragEvent,
    group: SceneShelfGroupVM,
    targetIndex: number,
  ): Promise<void> {
    event.preventDefault();
    const moved = draggingSceneId;
    draggingSceneId = null;
    if (moved === null) return;

    await applyReorder(group, moved, targetIndex);
  }

  /**
   * The same reorder from the keyboard (REQ-CEN-090): ↑/↓ on the grip move the line one
   * position inside its group. Any other key is left to the browser — the grip is also
   * the row's first tab stop.
   */
  function handleGripKeydown(event: KeyboardEvent, group: SceneShelfGroupVM, index: number): void {
    const target = reorderTargetIndexForKey(event.key, index);
    if (target === null) return;
    const entry = group.entries[index];
    if (entry === undefined) return;
    // The arrows would otherwise scroll the archive out from under the moving line.
    event.preventDefault();
    void applyReorder(group, entry.sceneId, target);
  }
</script>

<div class="scenes-tab">
  <!-- The scene on air (REQ-CEN-010): top of the panel, outside the scrolling archive,
       at the one height the theme token fixes — nothing inside it may change that
       height (REQ-CEN-013). -->
  <section class="scene-head" aria-label={t("FUSION.Scene.Head.OnAir")}>
    {#if head.kind === "on-air"}
      {@const bg = head.background}
      <!-- REQ-CEN-011/012: the scene's background image, scaled into the fixed box, over
           the scene's own background colour — which is all a scene without an image
           shows, at exactly the same height. -->
      <div class="scene-head__canvas" style="background-color: {bg.color};">
        {#if backgroundSrc}
          <img
            class="scene-head__image"
            src={backgroundSrc}
            sizes={bg.kind === "image" ? bg.sizes : undefined}
            alt=""
            aria-hidden="true"
            decoding="async"
          />
        {/if}
      </div>
      <!-- REQ-CEN-020..025: the perception door and the three environment gestures
           that used to float here were retired from the head's UI on 2026-08-17
           (Alexandre's r1 test, item 25 — a decision, not a bug). DEC-SEP-05 (F2,
           2026-08-23) removed the server-side logic too, along with the rest of
           the fog/vision pipeline — see `docs/design/separacao-repos/design.md`.
           See `specs/44-aba-cenas.md` §5.3. -->
      <!-- Ajustes r1, item 27: the "no ar" flag is its own element, pinned to the
           head's TOP edge (`position: absolute; top: 0.4rem`) — a sibling of
           `.scene-head__info`, never nested inside it, so it stays isolated from the
           name/dimensions block that anchors to the footer. Chip background
           (Ajustes r1 review, 2026-08-17): plain text directly on the scene's own
           image was unreadable over a light map — the same reason every other
           control that used to sit on this canvas carried one. -->
      <span class="scene-head__flag">
        <span class="scene-head__flag-dot" aria-hidden="true"></span>
        {t("FUSION.Scene.Head.OnAir")}
      </span>
      <!-- Ajustes r1 review (2026-08-17), REQ-CEN-061: the archive never repeats
           the scene ON AIR (REQ-CEN-036), so once item 25 took the head's direct
           perception door out, this button became the ONLY reachable door into
           that scene's configuration (DEC-SEP-05, F2: the configuration window's
           own door into perception is gone too — see `lib/scenes/sceneWindows.ts`).
           Out of flow, opposite corner from the flag, so it cannot add a pixel to
           the fixed head (REQ-CEN-013). Same pencil glyph as the archive row's
           edit action, so "configure" reads as one verb across the whole tab. -->
      <button
        class="scene-head__config"
        title="{t('FUSION.Scene.Dialog.EditScene')} {head.name}"
        aria-label="{t('FUSION.Scene.Dialog.EditScene')} {head.name}"
        onclick={() => {
          const scene = sceneById(head.sceneId);
          if (scene) openSceneConfigWindow(socket, scene);
        }}
      >
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m10.6 2.9 2.5 2.5L5.5 13H3v-2.5z" />
          <path d="M9.2 4.3l2.5 2.5" />
        </svg>
      </button>
      <!-- TK022-client: the door into TokenAddDialog — the form path stays reachable
           even when no drag is in progress. Floats over the fixed head, sitting right
           next to `.scene-head__config` in the same top-right corner (a small gap
           between the two), so neither adds a pixel of height (REQ-CEN-013). -->
      <button
        class="scene-head__addToken"
        title={t("FUSION.Scenes.TokenAdd.Title")}
        aria-label={t("FUSION.Scenes.TokenAdd.Title")}
        onclick={openTokenAdd}
      >
        <!-- Drawn glyph (REQ-NPC-094): a token disc with a plus, "put a piece here". -->
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5.4v5.2M5.4 8h5.2" />
        </svg>
      </button>
      <div class="scene-head__info">
        <span class="scene-head__name" title={head.name}>{head.name}</span>
        <span class="scene-head__meta">
          {t(head.dimensions.key, head.dimensions.vars)} · {t(head.grid.key, head.grid.vars)}
        </span>
      </div>
    {:else if head.kind === "pending"}
      <!-- The world says something is on air, this client has not received it yet. -->
      <div class="scene-head__state">
        <span class="scene-head__title">{t(head.title.key)}</span>
      </div>
    {:else}
      <!-- REQ-CEN-014: says it plainly, says where that leaves the players, and offers
           to fix it. -->
      <div class="scene-head__state">
        <span class="scene-head__title">{t(head.title.key)}</span>
        <span class="scene-head__notice">{t(head.notice.key)}</span>
        {#if head.action}
          <button class="btn btn--sm scene-head__action" onclick={focusArchive}>
            {t(head.action.key)}
          </button>
        {/if}
      </div>
    {/if}
  </section>

  <header class="scenes-tab__header">
    <div class="scenes-tab__header-row">
      <span class="scenes-tab__title">{t("FUSION.Sidebar.Scenes.Title")}</span>
      <!-- REQ-CEN-060: creating opens a floating window; REQ-CEN-065: it does not put
           the new scene on air. -->
      <button
        class="btn btn--primary btn--sm"
        onclick={() => openSceneCreateWindow(socket)}
        aria-label={t("FUSION.Sidebar.Scenes.Create")}
      >
        {t("FUSION.Sidebar.Scenes.Create")}
      </button>
    </div>
    <!-- REQ-CEN-034: the search only appears once the archive is bigger than the panel
         can show at once — a field over four scenes is furniture, not help. -->
    {#if shelf.searchable}
      <input
        class="scenes-tab__search"
        type="search"
        bind:value={searchQuery}
        aria-label={t(SCENE_SHELF_KEYS.search)}
        placeholder={t(SCENE_SHELF_KEYS.searchPlaceholder)}
      />
    {/if}
  </header>

  <!-- `tabindex="-1"` is the landing spot for the head's offer (REQ-CEN-014): it is a
       programmatic focus target only, never a tab stop of its own. -->
  <div class="scenes-tab__body" tabindex="-1" bind:this={archiveEl}>
    {#if !shelf.hasResults}
      <!-- Spec 36 §7.4: the empty state of the tab — and WHICH emptiness it is comes
           from the VM, never from a bare "the archive is empty". A world with no scene
           gets the invitation to create the first (REQ-CEN-080); a world whose only
           scene is on air says exactly that, because the head above is naming it
           (REQ-CEN-036); a search that matched nothing says so with the head still in
           place (REQ-CEN-081). -->
      <p class="scenes-tab__empty">{t(shelf.emptyKey ?? SCENE_SHELF_KEYS.noResults)}</p>
    {:else}
      {#each shelf.groups as group (group.key)}
        <!-- REQ-CEN-030/032: one section per folder, the scenes with no folder last. -->
        <section class="scene-group">
          <button
            class="scene-group__header"
            aria-expanded={!group.collapsed}
            aria-label="{group.collapsed
              ? t(SCENE_SHELF_KEYS.expand)
              : t(SCENE_SHELF_KEYS.collapse)}: {groupLabel(group)}"
            onclick={() => toggleGroup(group.key)}
          >
            <!-- Drawn glyph (REQ-NPC-094): a chevron that points down when open. -->
            <svg
              class="scene-group__chevron"
              class:scene-group__chevron--collapsed={group.collapsed}
              viewBox="0 0 16 16"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
            <span class="scene-group__name" title={groupLabel(group)}>{groupLabel(group)}</span>
            <span class="scene-group__count">{group.entries.length}</span>
          </button>

          {#if !group.collapsed}
            <div class="scene-group__items" role="list" aria-label={groupLabel(group)}>
              {#each group.entries as entry, index (entry.sceneId)}
                {@const scene = sceneById(entry.sceneId)}
                <!-- REQ-CEN-037: a line is draggable, and a drop inside its own group
                     writes the new `sort` to the documents. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- REQ-CEN-056 / REQ-CEN-091: the prepared line is distinguished three
                     ways that do not need colour — a written mark below the name, a
                     left rule, and `aria-current` for a screen reader. -->
                <div
                  class="scene-row"
                  class:scene-row--dragging={draggingSceneId === entry.sceneId}
                  class:scene-row--preparing={entry.preparing}
                  aria-current={entry.preparing ? "true" : undefined}
                  role="listitem"
                  draggable="true"
                  ondragstart={(event) => handleDragStart(event, entry.sceneId)}
                  ondragover={handleDragOver}
                  ondrop={(event) => handleDrop(event, group, index)}
                  ondragend={handleDragEnd}
                >
                  <!-- REQ-CEN-090: the grip is a real button, not decoration — reordering
                       is an action of the line, so it has to be focusable and operable
                       without a mouse (↑/↓, REQ-CEN-037). -->
                  <button
                    class="scene-row__grip"
                    type="button"
                    title={t(SCENE_SHELF_KEYS.reorder)}
                    aria-label="{t(SCENE_SHELF_KEYS.reorder)}: {entry.name}"
                    onkeydown={(event) => handleGripKeydown(event, group, index)}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="10"
                      height="14"
                      fill="currentColor"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <circle cx="6" cy="4" r="1.1" />
                      <circle cx="10" cy="4" r="1.1" />
                      <circle cx="6" cy="8" r="1.1" />
                      <circle cx="10" cy="8" r="1.1" />
                      <circle cx="6" cy="12" r="1.1" />
                      <circle cx="10" cy="12" r="1.1" />
                    </svg>
                  </button>
                  <!-- REQ-CEN-035: name and the environment marks that are on —
                       written out, never carried by colour alone (REQ-CEN-091). -->
                  <span class="scene-row__text">
                    <span class="scene-row__name" title={entry.name}>{entry.name}</span>
                    <span class="scene-row__meta">
                      {#each entry.marks as mark (mark.id)}
                        <span class="scene-row__mark" title={t(mark.labelKey)}
                          >{t(mark.labelKey)}</span
                        >
                      {/each}
                    </span>
                  </span>
                  <div class="scene-row__actions">
                    <button
                      class="action-btn action-btn--activate"
                      onclick={() => {
                        if (scene) void handleActivate(scene);
                      }}
                      disabled={activatingId !== null}
                      title={t("FUSION.Scene.Dialog.ActivateScene")}
                      aria-label="{t('FUSION.Scene.Dialog.ActivateScene')} {entry.name}"
                    >
                      <!-- Drawn glyphs only (REQ-NPC-094): a play triangle, an angled pen
                           and a bin, in the same 16px box as the rail's icon set. -->
                      <svg
                        viewBox="0 0 16 16"
                        width="14"
                        height="14"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M5 3.5 12 8l-7 4.5z" fill="currentColor" />
                      </svg>
                    </button>
                    <!-- REQ-CEN-050: open this scene on THIS canvas without touching the
                         one on air; pressed, the same control leaves the prepare
                         (REQ-CEN-053). It writes nothing (RNF-CEN-03). -->
                    <button
                      class="action-btn action-btn--prepare"
                      class:action-btn--prepare-on={entry.preparing}
                      aria-pressed={entry.preparing}
                      onclick={() => togglePrepare(entry.sceneId)}
                      title={entry.preparing
                        ? t(SCENE_SHELF_KEYS.prepareExit)
                        : t(SCENE_SHELF_KEYS.prepare)}
                      aria-label="{entry.preparing
                        ? t(SCENE_SHELF_KEYS.prepareExit)
                        : t(SCENE_SHELF_KEYS.prepare)}: {entry.name}"
                    >
                      <!-- Drawn glyph (REQ-NPC-094): an eye, "I am looking at this". -->
                      <svg
                        viewBox="0 0 16 16"
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" />
                        <circle cx="8" cy="8" r="1.8" />
                      </svg>
                    </button>
                    <!-- REQ-CEN-061: configuring never happens inside the drawer. -->
                    <button
                      class="action-btn action-btn--edit"
                      onclick={() => {
                        if (scene) openSceneConfigWindow(socket, scene);
                      }}
                      title={t("FUSION.Scene.Dialog.EditScene")}
                      aria-label="{t('FUSION.Scene.Dialog.EditScene')} {entry.name}"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="m10.6 2.9 2.5 2.5L5.5 13H3v-2.5z" />
                        <path d="M9.2 4.3l2.5 2.5" />
                      </svg>
                    </button>
                    <!-- REQ-CEN-063/064: the confirmation names the cascade, and
                         refuses outright for the scene on air. -->
                    <button
                      class="action-btn action-btn--delete"
                      onclick={() => {
                        if (scene) openSceneDeleteWindow(socket, scene);
                      }}
                      title={t("FUSION.Scene.Dialog.DeleteScene")}
                      aria-label="{t('FUSION.Scene.Dialog.DeleteScene')} {entry.name}"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M3 4.5h10" />
                        <path d="M6.5 4.5V3h3v1.5" />
                        <path d="M4.5 4.5 5 13h6l.5-8.5" />
                      </svg>
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    {/if}
    {#if activateError}
      <p class="scenes-tab__error" role="alert">{activateError}</p>
    {/if}
    <!-- REQ-CEN-037: a refused reorder is a message too — the lines keep the order the
         documents actually hold. -->
    {#if shelfError}
      <p class="scenes-tab__error" role="alert">{shelfError}</p>
    {/if}
  </div>

  <!-- REQ-CEN-039 / DEC-CEN-10: "o mapa" means two things at this table, so the panel
       says out loud that the region map lives in the Hub. A note, not a door — this tab
       offers no navigation into it. -->
  <footer class="scenes-tab__footer">{t(shelf.footer.key)}</footer>
</div>

<!-- The four scene dialogs are NOT mounted here any more: they are windows of the
     window manager, opened by `lib/scenes/sceneWindows.ts` and rendered once by
     `WindowHost` (REQ-UIF-009, DEC-CEN-09). A form inside the drawer would either
     widen it or be unusable at 300px (DEC-GAV-04). TokenAddDialog is the one
     exception: it already paints its own backdrop/`<dialog>` frame (built before
     sceneWindows.ts existed), so it mounts inline here instead of being migrated
     into a window it was never written for (TK022-client). -->
{#if tokenAddOpen}
  {@const scene = sceneOnAir()}
  {#if scene}
    <TokenAddDialog
      sceneId={scene._id}
      {scene}
      onClose={closeTokenAdd}
      onSuccess={closeTokenAdd}
      {socket}
    />
  {/if}
{/if}

<style>
  .scenes-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* REQ-CEN-010: ONE height, from the theme token, for every state of the head — a
     fixed `height` and not a `min-height`, so a long name, a missing image or the
     future environment row cannot grow it (REQ-CEN-013). `flex-shrink: 0` keeps it
     out of the archive's scrolling area. */
  .scene-head {
    position: relative;
    height: var(--fusion-scene-head-height);
    flex-shrink: 0;
    overflow: hidden;
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }

  .scene-head__canvas {
    position: absolute;
    inset: 0;
  }

  /* The image is scaled INTO the fixed box (DEC-CEN-04) — it never sizes the head. */
  .scene-head__image {
    display: block;
    height: 100%;
    width: 100%;
    object-fit: cover;
  }

  /* REQ-CEN-020..025: the environment row and the DIRECT perception door that used to
     float in the corners of the head were retired from this UI on 2026-08-17 (item 25
     — decision, not a bug). DEC-SEP-05 (F2, 2026-08-23) removed their underlying rules
     too (`lib/scenes/sceneEnvironment.ts` is gone; `lib/scenes/sceneWindows.ts` no
     longer has a perception window kind) along with the rest of the fog/vision
     pipeline. `.scene-head__config` below is a DIFFERENT door — it opens the
     configuration window, never perception — restored on 2026-08-17 (Ajustes r1
     review) because without it the archive's exclusion of the scene on air
     (REQ-CEN-036) left that scene with no reachable door at all, contradicting
     REQ-CEN-061. */

  /* TK022-client: the token-add door, sharing the head's top-right corner with
     `.scene-head__config` — same fixed size and vertical position as that button,
     offset left by its own width plus a small gap so the two never overlap
     (REQ-CEN-013: no pixel of height either way). */
  .scene-head__addToken {
    align-items: center;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: var(--fusion-radius-sm);
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
    display: flex;
    justify-content: center;
    padding: 0.2rem;
    position: absolute;
    right: calc(0.4rem + 1.5rem + 0.3rem);
    top: 0.4rem;
    width: 1.5rem;
    z-index: 1;
  }

  .scene-head__addToken:hover {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: #fff;
  }

  .scene-head__addToken:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }

  .scene-head__info {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem 0.75rem;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.82), rgba(0, 0, 0, 0));
  }

  /* Ajustes r1, item 27: anchored to the head's own top edge — independent of the
     footer's `.scene-head__info` gradient block, so it never grows/shrinks with the
     name (REQ-CEN-013) and stays isolated at the top, as the prototype's `.lbl` does.
     Chip background + explicit `left` (Ajustes r1 review, 2026-08-17): the flag used
     to sit on plain gradient-backed ground; alone at the top edge it sat directly on
     the scene's own image, and green text with no anteparo is unreadable over a
     light map. Same treatment `.scene-head__perception` used to give any control
     placed straight on the canvas. */
  .scene-head__flag {
    align-items: center;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-success);
    display: flex;
    font-size: 0.6875rem;
    font-weight: 600;
    gap: 0.3rem;
    left: 0.4rem;
    letter-spacing: 0.08em;
    padding: 0.25rem 0.5rem;
    position: absolute;
    text-transform: uppercase;
    top: 0.4rem;
    z-index: 1;
  }

  /* REQ-CEN-061/062, Ajustes r1 review (2026-08-17): the scene on air's only
     reachable door into configuration (see the note above `.scene-head__info`).
     Opposite corner from the flag, out of flow, same chip treatment
     `.scene-head__perception` used to have before item 25 retired it. */
  .scene-head__config {
    align-items: center;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: var(--fusion-radius-sm);
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
    display: flex;
    justify-content: center;
    padding: 0.2rem;
    position: absolute;
    right: 0.4rem;
    top: 0.4rem;
    width: 1.5rem;
    z-index: 1;
  }

  .scene-head__config:hover {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: #fff;
  }

  .scene-head__config:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }

  .scene-head__flag-dot {
    background: var(--fusion-success);
    border-radius: 50%;
    box-shadow: 0 0 8px rgba(61, 220, 132, 0.6);
    flex-shrink: 0;
    height: 7px;
    width: 7px;
  }

  /* REQ-CEN-013: what does not fit is truncated legibly — the whole name stays in the
     `title` tooltip, and the line never wraps into a second one. */
  .scene-head__name {
    color: #fff;
    font-size: 0.9375rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scene-head__meta {
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scene-head__state {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.3rem;
    padding: 0.6rem 0.75rem;
  }

  .scene-head__title {
    color: var(--fusion-text);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .scene-head__notice {
    color: var(--fusion-text-muted);
    font-size: 0.75rem;
  }

  /* Same visible ring the row actions use (REQ-CEN-090 / REQ-UIF-064). */
  .scene-head__action:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }

  .scenes-tab__header {
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem 0.75rem;
    flex-shrink: 0;
  }

  .scenes-tab__header-row {
    align-items: center;
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
  }

  /* REQ-CEN-034: the search never widens the drawer — it fills the width it is given
     (REQ-GAV-012, RNF-CEN-04). */
  .scenes-tab__search {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    min-width: 0;
    padding: 0.3rem 0.5rem;
    width: 100%;
  }

  .scenes-tab__search:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: -1px;
  }

  .scenes-tab__title {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .scenes-tab__body {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .scenes-tab__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    padding: 1.5rem 1rem;
    text-align: center;
  }

  .scenes-tab__error {
    color: var(--fusion-danger);
    font-size: 0.75rem;
    padding: 0.5rem 0.75rem;
  }

  /* REQ-CEN-039: the region-map note, outside the scrolling archive so it is read once
     and does not compete with the list. */
  .scenes-tab__footer {
    border-top: 1px solid var(--fusion-border);
    color: var(--fusion-text-subtle);
    flex-shrink: 0;
    font-size: 0.6875rem;
    line-height: 1.35;
    padding: 0.45rem 0.75rem;
  }

  /* REQ-CEN-030/032: one section per folder. The header is sticky so the group a long
     list is scrolling through stays named. */
  .scene-group {
    display: flex;
    flex-direction: column;
  }

  .scene-group__header {
    align-items: center;
    background: var(--fusion-surface);
    border: none;
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: flex;
    font-family: var(--fusion-font);
    font-size: 0.75rem;
    font-weight: 600;
    gap: 0.35rem;
    letter-spacing: 0.03em;
    padding: 0.35rem 0.75rem;
    position: sticky;
    text-align: left;
    text-transform: uppercase;
    top: 0;
    width: 100%;
    z-index: 1;
  }

  .scene-group__header:hover {
    color: var(--fusion-text);
  }

  .scene-group__header:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: -2px;
  }

  .scene-group__chevron {
    flex-shrink: 0;
    transition: transform var(--fusion-transition);
  }

  /* The state is in `aria-expanded` first; the rotation is the visual echo of it. */
  .scene-group__chevron--collapsed {
    transform: rotate(-90deg);
  }

  .scene-group__name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scene-group__count {
    color: var(--fusion-text-subtle);
    font-weight: 500;
  }

  .scene-row {
    align-items: center;
    border-radius: var(--fusion-radius-sm);
    display: flex;
    gap: 0.4rem;
    padding: 0.35rem 0.75rem;
    transition: background-color var(--fusion-transition);
  }

  .scene-row:hover {
    background: var(--fusion-surface-alt);
  }

  /* REQ-CEN-037: the line being dragged is dimmed while it travels. */
  .scene-row--dragging {
    opacity: 0.5;
  }

  /* REQ-CEN-056 / REQ-CEN-091: the prepared line carries a left rule and a tinted
     ground ON TOP of the written "Em preparo" chip — the shape reads without colour,
     which is exactly what the requirement asks. */
  .scene-row--preparing {
    background: rgba(124, 92, 252, 0.08);
    box-shadow: inset 2px 0 0 var(--fusion-accent);
  }

  /* REQ-CEN-090: a button, so it takes focus and the arrows reach it — styled back down
     to the bare grip it looks like. */
  .scene-row__grip {
    align-items: center;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
    cursor: grab;
    display: flex;
    flex-shrink: 0;
    padding: 0;
  }

  /* Same visible ring as every other control of the panel (REQ-CEN-090 / REQ-UIF-064). */
  .scene-row__grip:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: -1px;
  }

  .scene-row__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .scene-row__name {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* REQ-CEN-035: marks, on one truncating line under the name. `min-height` (Ajustes
     r1 review, 2026-08-17): since A051 removed the dimensions text, a scene with no
     marks (`entry.marks` empty) renders this as a childless flex container, which
     collapses to zero height — so a row with marks and a row without ended up two
     different heights in the same archive. The floor keeps every row the same shape
     whether or not it has anything to say (REQ-CEN-035 draws the same line either
     way, just sometimes empty). */
  .scene-row__meta {
    min-height: 1rem;
    color: var(--fusion-text-subtle);
    display: flex;
    font-size: 0.6875rem;
    gap: 0.3rem;
    overflow: hidden;
    white-space: nowrap;
  }

  /* REQ-CEN-091: a mark is a written word in a chip, never a coloured dot on its own. */
  .scene-row__mark {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    padding: 0 0.25rem;
  }

  .scene-row__actions {
    display: flex;
    gap: 0.2rem;
    opacity: 0;
    transition: opacity var(--fusion-transition);
  }

  /* REQ-CEN-090 / REQ-UIF-064: the actions may fade in on hover, but hover must not
     be the ONLY way to reveal them — tabbing into any of them lights the whole group,
     otherwise the keyboard user focuses a button drawn at `opacity: 0`. */
  .scene-row:hover .scene-row__actions,
  .scene-row:focus-within .scene-row__actions {
    opacity: 1;
  }

  .action-btn {
    align-items: center;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
    cursor: pointer;
    display: flex;
    height: 1.5rem;
    justify-content: center;
    padding: 0;
    transition:
      background-color var(--fusion-transition),
      color var(--fusion-transition);
    width: 1.5rem;
  }

  .action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* REQ-CEN-090: same focus ring the rail uses (`SidebarRail.svelte`), so the row
     action the keyboard landed on is unmistakable. */
  .action-btn:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: -2px;
  }

  .action-btn--activate:not(:disabled):hover {
    background: rgba(61, 220, 132, 0.1);
    color: var(--fusion-success);
    border-color: var(--fusion-success);
  }

  /* REQ-CEN-056: the prepare toggle stays lit while it is the prepared scene, with a
     ring so "pressed" is not carried by hue alone (REQ-CEN-091). */
  .action-btn--prepare-on {
    background: rgba(124, 92, 252, 0.16);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .action-btn--prepare:not(:disabled):hover {
    background: rgba(124, 92, 252, 0.1);
    color: var(--fusion-accent);
    border-color: var(--fusion-accent);
  }

  .action-btn--edit:not(:disabled):hover {
    background: rgba(124, 92, 252, 0.1);
    color: var(--fusion-accent);
    border-color: var(--fusion-accent);
  }

  .action-btn--delete:not(:disabled):hover {
    background: rgba(255, 92, 92, 0.1);
    color: var(--fusion-danger);
    border-color: var(--fusion-danger);
  }

  .btn {
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    display: inline-flex;
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    font-weight: 500;
    justify-content: center;
    padding: 0.5rem 1.25rem;
    transition: background-color var(--fusion-transition);
    white-space: nowrap;
  }

  .btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .btn--primary:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
  }

  .btn--sm {
    font-size: 0.8125rem;
    padding: 0.3rem 0.75rem;
  }
</style>
