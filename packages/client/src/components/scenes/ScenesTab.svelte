<script lang="ts">
  /**
   * ScenesTab.svelte — the Cenas tab of the side drawer (spec 44, id "scenes").
   *
   * This is the scene panel that used to live INSIDE `chat/AppSidebar.svelte`: the
   * list, the active-scene dot, activate/edit/delete and the three dialogs. It moved
   * out unchanged (plan G016 is a bridge, not a redesign) so the drawer can mount it
   * through the registry like any other tab (REQ-GAV-030, REQ-CEN-001).
   *
   * What did NOT come along, because spec 36 owns it and not this tab:
   *  - the tab bar and the collapse control (REQ-GAV-011 — clicking the active tab in
   *    the rail is the only gesture, so there is no ✕ and no chevron here);
   *  - the drawer's width (REQ-GAV-012) — the panel simply fills what it is given.
   *
   * Everything else spec 44 asks for (the "no ar / em preparo" head, the state dot of
   * REQ-CEN-003..005, the scene count in the header) arrives with that spec's own PR.
   *
   * Content permission: the whole tab is group "gm" in the rail, but that is
   * ergonomics, not a boundary (REQ-GAV-034) — creating, updating, deleting and
   * activating a scene are all refused server-side for a non-privileged role by
   * `isRolePrivileged` (`documents/ownership.ts`), used by `doc:create/update/delete`
   * and by the `world:activeScene` handler.
   */

  import type { SceneDocument } from "@fusion/shared";
  import type { SidebarPanelProps } from "../../lib/sidebar/registry.js";
  import { sidebarState } from "../../lib/scenes/scenesState.svelte.js";
  import { activateScene, OpError } from "../../lib/scenes/sceneController.js";
  import SceneCreateDialog from "./SceneCreateDialog.svelte";
  import SceneDeleteConfirm from "./SceneDeleteConfirm.svelte";
  import { t } from "../../lib/i18n/i18n.js";

  /** The contract the drawer hands every panel (registry, REQ-GAV-030). */
  const { socket, activeSceneId }: SidebarPanelProps = $props();

  let showCreateDialog = $state(false);
  let editTarget = $state<SceneDocument | null>(null);
  let deleteTarget = $state<SceneDocument | null>(null);
  let activatingId = $state<string | null>(null);
  let activateError = $state<string | null>(null);

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
</script>

<div class="scenes-tab">
  <header class="scenes-tab__header">
    <span class="scenes-tab__title">{t("FUSION.Sidebar.Scenes.Title")}</span>
    <button
      class="btn btn--primary btn--sm"
      onclick={() => {
        showCreateDialog = true;
      }}
      aria-label={t("FUSION.Sidebar.Scenes.Create")}
    >
      {t("FUSION.Sidebar.Scenes.Create")}
    </button>
  </header>

  <div class="scenes-tab__body" role="list" aria-label={t("FUSION.Sidebar.Scenes.Title")}>
    {#if sidebarState.scenes.length === 0}
      <!-- Spec 36 §7.4: the empty state of the tab — a world with no scene yet. -->
      <p class="scenes-tab__empty">{t("FUSION.Sidebar.Scenes.Empty")}</p>
    {:else}
      {#each sidebarState.scenes as scene (scene._id)}
        {@const isActive = scene._id === activeSceneId}
        <div class="scene-row" class:scene-row--active={isActive} role="listitem">
          <span
            class="scene-row__dot"
            class:scene-row__dot--on={isActive}
            aria-hidden="true"
            title={isActive
              ? t("FUSION.Sidebar.Scenes.ActiveScene")
              : t("FUSION.Sidebar.Scenes.InactiveScene")}
          ></span>
          <span class="scene-row__name" title={scene.name}>{scene.name}</span>
          <div class="scene-row__actions">
            {#if !isActive}
              <button
                class="action-btn action-btn--activate"
                onclick={() => handleActivate(scene)}
                disabled={activatingId !== null}
                title={t("FUSION.Scene.Dialog.ActivateScene")}
                aria-label="{t('FUSION.Scene.Dialog.ActivateScene')} {scene.name}"
              >
                <!-- Drawn glyphs only (REQ-NPC-094): a play triangle, an angled pen
                     and a bin, in the same 16px box as the rail's icon set. -->
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                  <path d="M5 3.5 12 8l-7 4.5z" fill="currentColor" />
                </svg>
              </button>
            {/if}
            <button
              class="action-btn action-btn--edit"
              onclick={() => {
                editTarget = scene;
              }}
              title={t("FUSION.Scene.Dialog.EditScene")}
              aria-label="{t('FUSION.Scene.Dialog.EditScene')} {scene.name}"
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
            <button
              class="action-btn action-btn--delete"
              onclick={() => {
                deleteTarget = scene;
              }}
              title={t("FUSION.Scene.Dialog.DeleteScene")}
              aria-label="{t('FUSION.Scene.Dialog.DeleteScene')} {scene.name}"
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
    {/if}
    {#if activateError}
      <p class="scenes-tab__error" role="alert">{activateError}</p>
    {/if}
  </div>
</div>

<!-- Scene dialogs — floating, outside the drawer (DEC-GAV-04: detail never widens
     the panel). -->
{#if showCreateDialog}
  <SceneCreateDialog
    mode="create"
    {socket}
    onClose={() => {
      showCreateDialog = false;
    }}
    onSuccess={() => {
      showCreateDialog = false;
    }}
  />
{/if}
{#if editTarget}
  <SceneCreateDialog
    mode="edit"
    scene={editTarget}
    {socket}
    onClose={() => {
      editTarget = null;
    }}
    onSuccess={() => {
      editTarget = null;
    }}
  />
{/if}
{#if deleteTarget}
  <SceneDeleteConfirm
    scene={deleteTarget}
    {socket}
    onClose={() => {
      deleteTarget = null;
    }}
    onSuccess={() => {
      deleteTarget = null;
    }}
  />
{/if}

<style>
  .scenes-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .scenes-tab__header {
    align-items: center;
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 0.6rem 0.75rem;
    flex-shrink: 0;
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

  .scene-row--active {
    background: rgba(124, 92, 252, 0.06);
  }

  .scene-row__dot {
    border-radius: 50%;
    background: var(--fusion-border);
    flex-shrink: 0;
    height: 7px;
    width: 7px;
    transition: background-color var(--fusion-transition);
  }

  .scene-row__dot--on {
    background: var(--fusion-success);
    box-shadow: 0 0 0 2px rgba(61, 220, 132, 0.2);
  }

  .scene-row__name {
    color: var(--fusion-text);
    flex: 1;
    font-size: 0.8125rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scene-row__actions {
    display: flex;
    gap: 0.2rem;
    opacity: 0;
    transition: opacity var(--fusion-transition);
  }

  .scene-row:hover .scene-row__actions {
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

  .action-btn--activate:not(:disabled):hover {
    background: rgba(61, 220, 132, 0.1);
    color: var(--fusion-success);
    border-color: var(--fusion-success);
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
