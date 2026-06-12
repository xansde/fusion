<script lang="ts">
  /**
   * ScenesSidebar.svelte — collapsible right sidebar for GM scene management.
   *
   * Only rendered when session.user.role === 4 (GAMEMASTER).
   * Players see nothing from this component.
   *
   * Layout: fixed column on the right side of the table-shell, above the canvas.
   * The sidebar can be toggled open/closed with the chevron button.
   *
   * Scenes tab:
   *   - Lists all scenes from sidebarState.scenes (sourced from DocumentMirror).
   *   - Each row shows: name, active indicator, activate/edit/delete actions.
   *   - "New Scene" button opens SceneCreateDialog.
   *   - Edit and delete actions open their respective dialogs.
   *   - Activate sends doc:update { active: true } to the server.
   */

  import type { Socket } from "socket.io-client";
  import type { SceneDocument } from "@fusion/shared";
  import { sidebarState, toggleSidebar } from "../../lib/scenes/scenesState.svelte.js";
  import { activateScene, OpError } from "../../lib/scenes/sceneController.js";
  import SceneCreateDialog from "./SceneCreateDialog.svelte";
  import SceneDeleteConfirm from "./SceneDeleteConfirm.svelte";
  import { activeSceneState } from "../../lib/docs/activeScene.svelte.js";

  const {
    socket,
    activeSceneId,
  }: {
    socket: Socket;
    /** The currently active scene id (passed from TableScreen for reactivity). */
    activeSceneId: string | null;
  } = $props();

  // ---- Dialog state ----

  let showCreateDialog = $state(false);
  let editTarget = $state<SceneDocument | null>(null);
  let deleteTarget = $state<SceneDocument | null>(null);

  // ---- Activate ----

  let activatingId = $state<string | null>(null);
  let activateError = $state<string | null>(null);

  async function handleActivate(scene: SceneDocument): Promise<void> {
    if (activatingId !== null) return;
    activatingId = scene._id;
    activateError = null;
    try {
      await activateScene(socket, scene._id);
    } catch (err) {
      if (err instanceof OpError) {
        activateError = err.message;
      } else {
        activateError = "Failed to activate scene.";
      }
    } finally {
      activatingId = null;
    }
  }

  // ---- Dialog close helpers ----

  function closeCreate(): void {
    showCreateDialog = false;
  }

  function closeEdit(): void {
    editTarget = null;
  }

  function closeDelete(): void {
    deleteTarget = null;
  }
</script>

<!-- ============================================================
  Sidebar container
  Right-side fixed column, sits above the canvas (z-index: 90).
  Collapsed: only the toggle strip is visible.
============================================================ -->
<aside
  class="scenes-sidebar"
  class:scenes-sidebar--open={sidebarState.open}
  aria-label="Scenes panel"
>
  <!-- Toggle button (always visible) -->
  <button
    class="sidebar__toggle"
    onclick={toggleSidebar}
    aria-expanded={sidebarState.open}
    aria-label={sidebarState.open ? "Collapse scenes panel" : "Expand scenes panel"}
    title={sidebarState.open ? "Collapse" : "Scenes"}
  >
    <!-- Theatrical map icon -->
    <span class="sidebar__toggle-icon" aria-hidden="true">
      {sidebarState.open ? "&#x276D;" : "&#x1F5FA;"}
    </span>
  </button>

  <!-- Panel content (hidden when collapsed) -->
  {#if sidebarState.open}
    <div class="sidebar__panel">
      <!-- Tab header -->
      <header class="sidebar__header">
        <span class="sidebar__tab-label">Scenes</span>
        <button
          class="btn btn--primary btn--sm"
          onclick={() => { showCreateDialog = true; }}
          aria-label="Create new scene"
        >
          + New
        </button>
      </header>

      <!-- Scene list -->
      <div class="sidebar__body" role="list" aria-label="Scene list">
        {#if sidebarState.scenes.length === 0}
          <p class="sidebar__empty">No scenes yet. Create one to get started.</p>
        {:else}
          {#each sidebarState.scenes as scene (scene._id)}
            {@const isActive = scene._id === activeSceneId}
            <div
              class="scene-row"
              class:scene-row--active={isActive}
              role="listitem"
            >
              <!-- Active indicator dot -->
              <span
                class="scene-row__dot"
                class:scene-row__dot--on={isActive}
                aria-hidden="true"
                title={isActive ? "Active scene" : "Inactive"}
              ></span>

              <!-- Scene name -->
              <span class="scene-row__name" title={scene.name}>{scene.name}</span>

              <!-- Actions -->
              <div class="scene-row__actions">
                {#if !isActive}
                  <button
                    class="action-btn action-btn--activate"
                    onclick={() => handleActivate(scene)}
                    disabled={activatingId !== null}
                    title="Activate scene"
                    aria-label="Activate {scene.name}"
                  >
                    &#x25B6;
                  </button>
                {/if}

                <button
                  class="action-btn action-btn--edit"
                  onclick={() => { editTarget = scene; }}
                  title="Edit scene"
                  aria-label="Edit {scene.name}"
                >
                  &#x270E;
                </button>

                <button
                  class="action-btn action-btn--delete"
                  onclick={() => { deleteTarget = scene; }}
                  title="Delete scene"
                  aria-label="Delete {scene.name}"
                >
                  &#x1F5D1;
                </button>
              </div>
            </div>
          {/each}
        {/if}

        {#if activateError}
          <p class="sidebar__error" role="alert">{activateError}</p>
        {/if}
      </div>
    </div>
  {/if}
</aside>

<!-- ============================================================
  Dialogs (rendered outside the sidebar for correct z-index)
============================================================ -->
{#if showCreateDialog}
  <SceneCreateDialog
    mode="create"
    {socket}
    onClose={closeCreate}
    onSuccess={closeCreate}
  />
{/if}

{#if editTarget}
  <SceneCreateDialog
    mode="edit"
    scene={editTarget}
    {socket}
    onClose={closeEdit}
    onSuccess={closeEdit}
  />
{/if}

{#if deleteTarget}
  <SceneDeleteConfirm
    scene={deleteTarget}
    {socket}
    onClose={closeDelete}
    onSuccess={closeDelete}
  />
{/if}

<style>
  /* ---- Container ---- */
  .scenes-sidebar {
    position: absolute;
    top: var(--fusion-header-height);
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: row-reverse; /* toggle button on the outer edge */
    z-index: 90;
    pointer-events: none; /* pass-through by default */
  }

  .scenes-sidebar.scenes-sidebar--open {
    pointer-events: auto;
  }

  /* ---- Toggle strip ---- */
  .sidebar__toggle {
    pointer-events: auto;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-right: none;
    border-radius: var(--fusion-radius-sm) 0 0 var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 2.5rem;
    margin-top: 0.5rem;
    padding: 0 0.5rem;
    transition: background-color var(--fusion-transition), color var(--fusion-transition);
    width: 2rem;
    align-self: flex-start;
  }

  .sidebar__toggle:hover {
    background: var(--fusion-border);
    color: var(--fusion-text);
  }

  .sidebar__toggle-icon {
    font-size: 1rem;
    line-height: 1;
    display: block;
  }

  /* ---- Panel ---- */
  .sidebar__panel {
    background: var(--fusion-surface);
    border-left: 1px solid var(--fusion-border);
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    width: var(--fusion-sidebar-width);
  }

  .sidebar__header {
    align-items: center;
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 0.6rem 0.75rem;
    flex-shrink: 0;
  }

  .sidebar__tab-label {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .sidebar__body {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .sidebar__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    padding: 1.5rem 1rem;
    text-align: center;
  }

  .sidebar__error {
    color: var(--fusion-danger);
    font-size: 0.75rem;
    padding: 0.5rem 0.75rem;
  }

  /* ---- Scene row ---- */
  .scene-row {
    align-items: center;
    border-radius: var(--fusion-radius-sm);
    display: flex;
    gap: 0.4rem;
    margin: 0 0.35rem;
    padding: 0.45rem 0.5rem;
    transition: background-color var(--fusion-transition);
  }

  .scene-row:hover {
    background: var(--fusion-surface-alt);
  }

  .scene-row--active {
    background: var(--fusion-accent-dim);
  }

  .scene-row--active:hover {
    background: var(--fusion-accent-dim);
  }

  /* Active dot */
  .scene-row__dot {
    border-radius: 50%;
    display: block;
    flex-shrink: 0;
    height: 7px;
    width: 7px;
    background: var(--fusion-border);
    transition: background-color var(--fusion-transition);
  }

  .scene-row__dot--on {
    background: var(--fusion-success);
    box-shadow: 0 0 0 2px rgba(61, 220, 132, 0.25);
  }

  .scene-row__name {
    color: var(--fusion-text);
    flex: 1;
    font-size: 0.8125rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Action buttons */
  .scene-row__actions {
    display: flex;
    gap: 0.15rem;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--fusion-transition);
  }

  .scene-row:hover .scene-row__actions {
    opacity: 1;
  }

  .action-btn {
    background: transparent;
    border: none;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
    cursor: pointer;
    font-size: 0.875rem;
    line-height: 1;
    padding: 0.2rem 0.3rem;
    transition: color var(--fusion-transition), background-color var(--fusion-transition);
  }

  .action-btn:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .action-btn--activate:hover:not(:disabled) {
    background: var(--fusion-accent-dim);
    color: var(--fusion-accent);
  }

  .action-btn--edit:hover {
    color: var(--fusion-text);
  }

  .action-btn--delete:hover {
    color: var(--fusion-danger);
  }

  /* Inline buttons */
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
    padding: 0.45rem 1rem;
    transition: background-color var(--fusion-transition), opacity var(--fusion-transition);
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
    font-size: 0.75rem;
    padding: 0.25rem 0.6rem;
  }
</style>
