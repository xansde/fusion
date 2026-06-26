<script lang="ts">
  /**
   * ActorDirectory.svelte — Actors tab panel for the sidebar.
   *
   * REQ-UIF-002: Actors tab in sidebar.
   * REQ-UIF-044..046: Drag actor to canvas creates a Token.
   *
   * Displays actors from the DocumentMirror grouped by folder.
   * GM sees all actors; Players see only those they have OBSERVER+ access to.
   * Double-click opens the actor sheet (via windowManager).
   * Drag to canvas creates a linked Token (op sent by the canvas drop handler).
   *
   * Design: thin Svelte shell — all filtering logic in actorDirectory.ts.
   */

  import type { Socket } from "socket.io-client";
  import { worldMirror } from "../../lib/docs/worldSync.js";
  import {
    buildActorDirectory,
    buildActorDragPayload,
    type ActorDocument,
    type ActorDragPayload,
  } from "../../lib/actors/actorDirectory.js";
  import { openActorSheet } from "../../lib/sheets/pf2e/registerPf2eSheets.js";
  import { t } from "../../lib/i18n/i18n.js";

  const {
    socket,
    isGm,
    userId,
  }: {
    socket: Socket;
    isGm: boolean;
    userId: string;
  } = $props();

  // ---- Reactive state ----
  let searchQuery = $state("");
  let actors = $state<ActorDocument[]>([]);

  // Subscribe to DocumentMirror for Actor changes
  $effect(() => {
    const unsub = worldMirror.subscribe<ActorDocument>("Actor", (docs) => {
      actors = docs;
    });
    // Load initial state
    actors = worldMirror.getByType<ActorDocument>("Actor");
    return unsub;
  });

  // ---- Derived directory state ----
  const directory = $derived(
    buildActorDirectory(actors, userId, isGm, searchQuery)
  );

  // ---- Actor actions ----

  function openSheet(actor: ActorDocument): void {
    // Resolve and open the registered PF2e sheet via the sheet registry
    // (REQ-UIF-018..019). openActorSheet uses sheetRegistry.resolve() and
    // falls back gracefully when no sheet is registered for a given subtype.
    openActorSheet(actor._id, actor as unknown as Record<string, unknown>, {
      userId,
      ownership: 3, // OWNER — sidebar actors are always accessible to the opener
      isGm,
    });
  }

  async function deleteActor(actor: ActorDocument): Promise<void> {
    const confirmed = confirm(
      t("FUSION.Dialog.Delete.Body", { name: actor.name ?? actor._id })
    );
    if (!confirmed) return;

    try {
      await new Promise<void>((resolve, reject) => {
        socket.emit(
          "op",
          {
            type: "doc:delete",
            ts: Date.now(),
            payload: { documentType: "Actor", ids: [actor._id] },
          },
          (ack: { ok: boolean; message?: string }) => {
            if (ack.ok) resolve();
            else reject(new Error(ack.message ?? "delete failed"));
          }
        );
      });
    } catch (err) {
      console.error("[ActorDirectory] delete failed:", err);
    }
  }

  // ---- Drag & Drop ----

  function handleDragStart(event: DragEvent, actor: ActorDocument): void {
    if (!event.dataTransfer) return;
    const payload: ActorDragPayload = buildActorDragPayload(actor);
    event.dataTransfer.setData("application/fusion-actor", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  }
</script>

<div class="actor-dir" role="region" aria-label={t("FUSION.Sidebar.Actors.Title")}>
  <!-- Header -->
  <header class="actor-dir__header">
    <span class="actor-dir__title">{t("FUSION.Sidebar.Actors.Title")}</span>
    {#if isGm}
      <button
        class="btn btn--primary btn--sm"
        aria-label={t("FUSION.Sidebar.Actors.Create")}
        onclick={() => {
          socket.emit("op", {
            type: "doc:create",
            ts: Date.now(),
            payload: {
              documentType: "Actor",
              documents: [{
                name: "Novo Ator",
                type: "character",
                ownership: { default: 0 },
                flags: {},
              }],
            },
          });
        }}
      >
        {t("FUSION.Sidebar.Actors.Create")}
      </button>
    {/if}
  </header>

  <!-- Search -->
  <div class="actor-dir__search">
    <input
      type="search"
      class="actor-dir__search-input"
      placeholder={t("FUSION.Sidebar.Actors.Search")}
      bind:value={searchQuery}
      aria-label={t("FUSION.Sidebar.Actors.Search")}
    />
  </div>

  <!-- Actor list -->
  <div class="actor-dir__body" role="list" aria-label="Actor list">
    {#if directory.total === 0}
      <p class="actor-dir__empty">
        {searchQuery
          ? `Nenhum ator encontrado para "${searchQuery}".`
          : t("FUSION.Sidebar.Actors.Empty")}
      </p>
    {:else}
      {#each directory.groups as group (group.folderId)}
        <!-- Group header (only when there are multiple groups) -->
        {#if directory.groups.length > 1}
          <div class="actor-group__header" role="group" aria-label={group.folderId ? group.folderName : t("FUSION.Sidebar.Actors.Folders.Unnamed")}>
            <span class="actor-group__name">
              {group.folderId ? group.folderName : t("FUSION.Sidebar.Actors.Folders.Unnamed")}
            </span>
          </div>
        {/if}

        <!-- Actor rows in this group -->
        {#each group.actors as actor (actor._id)}
          <div
            class="actor-row"
            role="listitem"
            draggable={true}
            ondragstart={(e) => handleDragStart(e, actor)}
            title={t("FUSION.Sidebar.Actors.DragHint")}
          >
            <!-- Actor portrait -->
            <div class="actor-row__img" aria-hidden="true">
              {#if actor.img}
                <img src={actor.img} alt="" class="actor-row__portrait" loading="lazy" />
              {:else}
                <span class="actor-row__portrait-placeholder">
                  {(actor.name ?? "?").charAt(0).toUpperCase()}
                </span>
              {/if}
            </div>

            <!-- Name + type -->
            <div class="actor-row__info">
              <span class="actor-row__name" title={actor.name}>{actor.name ?? "Ator"}</span>
              <span class="actor-row__type">{t(`FUSION.Actors.Types.${actor.type}`, {})}</span>
            </div>

            <!-- Actions -->
            <div class="actor-row__actions">
              <button
                class="action-btn"
                ondblclick={() => openSheet(actor)}
                onclick={() => openSheet(actor)}
                title={t("FUSION.Sidebar.Actors.Actions.Open")}
                aria-label="{t('FUSION.Sidebar.Actors.Actions.Open')}: {actor.name}"
              >&#128203;</button>
              {#if isGm}
                <button
                  class="action-btn action-btn--danger"
                  onclick={() => void deleteActor(actor)}
                  title={t("FUSION.Sidebar.Actors.Actions.Delete")}
                  aria-label="{t('FUSION.Sidebar.Actors.Actions.Delete')}: {actor.name}"
                >&#128465;</button>
              {/if}
            </div>
          </div>
        {/each}
      {/each}
    {/if}
  </div>
</div>

<style>
  .actor-dir {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* Header */
  .actor-dir__header {
    align-items: center;
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    flex-shrink: 0;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 0.6rem 0.75rem;
  }

  .actor-dir__title {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  /* Search */
  .actor-dir__search {
    border-bottom: 1px solid var(--fusion-border);
    flex-shrink: 0;
    padding: 0.4rem 0.75rem;
  }

  .actor-dir__search-input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    outline: none;
    padding: 0.3rem 0.5rem;
    width: 100%;
    transition: border-color var(--fusion-transition);
  }

  .actor-dir__search-input:focus {
    border-color: var(--fusion-accent);
  }

  .actor-dir__search-input::placeholder {
    color: var(--fusion-text-subtle);
  }

  /* Body (scrollable) */
  .actor-dir__body {
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  .actor-dir__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    padding: 1.5rem 1rem;
    text-align: center;
  }

  /* Group header */
  .actor-group__header {
    padding: 0.4rem 0.75rem 0.15rem;
  }

  .actor-group__name {
    color: var(--fusion-text-muted);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  /* Actor row */
  .actor-row {
    align-items: center;
    border-radius: var(--fusion-radius-sm);
    cursor: grab;
    display: flex;
    gap: 0.5rem;
    padding: 0.3rem 0.75rem;
    transition: background-color var(--fusion-transition);
  }

  .actor-row:hover {
    background: var(--fusion-surface-alt);
  }

  .actor-row:active {
    cursor: grabbing;
  }

  .actor-row__img {
    flex-shrink: 0;
    height: 2rem;
    width: 2rem;
  }

  .actor-row__portrait {
    border-radius: var(--fusion-radius-sm);
    height: 100%;
    object-fit: cover;
    width: 100%;
  }

  .actor-row__portrait-placeholder {
    align-items: center;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    display: flex;
    font-size: 0.9rem;
    font-weight: 600;
    height: 100%;
    justify-content: center;
    width: 100%;
  }

  .actor-row__info {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .actor-row__name {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actor-row__type {
    color: var(--fusion-text-subtle);
    font-size: 0.7rem;
  }

  /* Actions (visible on hover) */
  .actor-row__actions {
    display: flex;
    gap: 0.15rem;
    opacity: 0;
    transition: opacity var(--fusion-transition);
  }

  .actor-row:hover .actor-row__actions,
  .actor-row:focus-within .actor-row__actions {
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
    font-size: 0.8125rem;
    height: 1.5rem;
    justify-content: center;
    padding: 0;
    transition: background-color var(--fusion-transition), color var(--fusion-transition);
    width: 1.5rem;
  }

  .action-btn:hover {
    background: rgba(124, 92, 252, 0.1);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .action-btn--danger:hover {
    background: rgba(255, 92, 92, 0.1);
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  /* Buttons (matching sidebar style) */
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
