<script lang="ts">
  /**
   * AppSidebar.svelte — unified right sidebar with tab navigation.
   *
   * Tabs: Scenes (GM only) + Chat (all users).
   * The sidebar can be toggled open/closed. Badge on Chat tab shows unread count.
   *
   * Design: wraps the existing scenes content in a "Scenes" tab and adds a
   * "Chat" tab that renders ChatPanel. This avoids touching ScenesSidebar
   * which already has passing tests.
   *
   * REQ-CHT spec 09: badge de não-lidas na tab.
   */

  import type { Socket } from "socket.io-client";
  import type { SceneDocument } from "@fusion/shared";
  import { chatStore, setChatTabVisible } from "../../lib/chat/chatStore.svelte.js";
  import { sidebarState, toggleSidebar } from "../../lib/scenes/scenesState.svelte.js";
  import { activateScene, OpError } from "../../lib/scenes/sceneController.js";
  import { activeSceneState } from "../../lib/docs/activeScene.svelte.js";
  import { combatStore } from "../../lib/combat/combatStore.svelte.js";
  import SceneCreateDialog from "../scenes/SceneCreateDialog.svelte";
  import SceneDeleteConfirm from "../scenes/SceneDeleteConfirm.svelte";
  import ChatPanel from "./ChatPanel.svelte";
  import CombatPanel from "../combat/CombatPanel.svelte";
  import ActorDirectory from "../actors/ActorDirectory.svelte";
  import CompendiumBrowser from "../compendium/CompendiumBrowser.svelte";
  import { t } from "../../lib/i18n/i18n.js";

  const {
    socket,
    worldId,
    activeSceneId,
    isGm,
    userId,
  }: {
    socket: Socket;
    worldId: string;
    activeSceneId: string | null;
    isGm: boolean;
    /** Current user's ID (for combat panel player-owned combatant logic). */
    userId: string;
  } = $props();

  // ---- Tab state ----
  // Default: GM sees Scenes tab; players see Chat tab
  type Tab = "scenes" | "chat" | "combat" | "actors" | "compendium";
  // _tabOverride tracks explicit user selection; null means use default derived from isGm prop.
  let _tabOverride = $state<Tab | null>(null);
  const activeTab = $derived(_tabOverride ?? (isGm ? "scenes" : "chat"));

  // Expose combatStore for badge (active combat indicator)
  const hasCombat = $derived(combatStore.combat !== null);

  function selectTab(tab: Tab): void {
    _tabOverride = tab;
  }

  // BUG #1 FIX: the unread badge must be tracked here (AppSidebar), not via a
  // prop into ChatLog — ChatLog only exists while activeTab === "chat" (the
  // {#if} below unmounts it otherwise), so an effect living inside it can
  // never observe "tab became invisible" (the component is already gone by
  // then). This effect owns setChatTabVisible for every activeTab value,
  // including the initial default (GM → "scenes", player → "chat").
  $effect(() => {
    setChatTabVisible(activeTab === "chat");
  });

  const chatUnread = $derived(chatStore.unreadCount);

  // ---- Scenes tab state ----

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

<!-- ============================================================
  Sidebar container (right side, fixed)
============================================================ -->
<aside
  class="app-sidebar"
  class:app-sidebar--open={sidebarState.open}
  aria-label={t("FUSION.Sidebar.Tabs.Chat")}
>
  <!-- Toggle button (always visible) -->
  <button
    class="sidebar__toggle"
    onclick={toggleSidebar}
    aria-expanded={sidebarState.open}
    aria-label={sidebarState.open ? t("FUSION.Header.CollapsePanel") : t("FUSION.Header.ExpandPanel")}
    title={sidebarState.open ? t("FUSION.Header.CollapsePanel") : t("FUSION.Header.ExpandPanel")}
  >
    <span class="sidebar__toggle-icon" aria-hidden="true">
      {sidebarState.open ? "❯" : "☰"}
    </span>
    {#if !sidebarState.open && chatUnread > 0}
      <span class="sidebar__badge" aria-label={t("FUSION.Header.UnreadMessages", { count: chatUnread })}>
        {chatUnread > 99 ? "99+" : chatUnread}
      </span>
    {/if}
  </button>

  <!-- Panel content -->
  {#if sidebarState.open}
    <div class="sidebar__panel">

      <!-- Tab bar -->
      <div class="sidebar__tabs" role="tablist" aria-label={t("FUSION.Sidebar.Tabs.Chat")}>
        {#if isGm}
          <button
            class="sidebar__tab"
            class:sidebar__tab--active={activeTab === "scenes"}
            role="tab"
            aria-selected={activeTab === "scenes"}
            onclick={() => selectTab("scenes")}
          >
            {t("FUSION.Sidebar.Tabs.Scenes")}
          </button>
        {/if}
        <button
          class="sidebar__tab"
          class:sidebar__tab--active={activeTab === "combat"}
          role="tab"
          aria-selected={activeTab === "combat"}
          onclick={() => selectTab("combat")}
          title={t("FUSION.Combat.TrackerTitle")}
        >
          {t("FUSION.Sidebar.Tabs.Combat")}
          {#if hasCombat && activeTab !== "combat"}
            <span class="sidebar__tab-badge sidebar__tab-badge--combat" aria-label={t("FUSION.Header.ActiveCombat")}>&#x2694;</span>
          {/if}
        </button>
        <button
          class="sidebar__tab"
          class:sidebar__tab--active={activeTab === "chat"}
          role="tab"
          aria-selected={activeTab === "chat"}
          onclick={() => selectTab("chat")}
        >
          {t("FUSION.Sidebar.Tabs.Chat")}
          {#if chatUnread > 0 && activeTab !== "chat"}
            <span class="sidebar__tab-badge" aria-label={t("FUSION.Header.UnreadMessages", { count: chatUnread })}>
              {chatUnread > 99 ? "99+" : chatUnread}
            </span>
          {/if}
        </button>
        <button
          class="sidebar__tab"
          class:sidebar__tab--active={activeTab === "actors"}
          role="tab"
          aria-selected={activeTab === "actors"}
          onclick={() => selectTab("actors")}
          title={t("FUSION.Sidebar.Tabs.Actors")}
        >
          {t("FUSION.Sidebar.Tabs.Actors")}
        </button>
        <button
          class="sidebar__tab"
          class:sidebar__tab--active={activeTab === "compendium"}
          role="tab"
          aria-selected={activeTab === "compendium"}
          onclick={() => selectTab("compendium")}
          title={t("FUSION.Sidebar.Tabs.Compendium")}
        >
          {t("FUSION.Sidebar.Tabs.Compendium")}
        </button>
      </div>

      <!-- Tab content -->
      <div class="sidebar__content" role="tabpanel">
        {#if activeTab === "scenes" && isGm}
          <!-- Scenes tab -->
          <div class="sidebar__tab-body">
            <header class="sidebar__header">
              <span class="sidebar__tab-label">{t("FUSION.Sidebar.Scenes.Title")}</span>
              <button
                class="btn btn--primary btn--sm"
                onclick={() => { showCreateDialog = true; }}
                aria-label={t("FUSION.Sidebar.Scenes.Create")}
              >
                {t("FUSION.Sidebar.Scenes.Create")}
              </button>
            </header>

            <div class="sidebar__body" role="list" aria-label={t("FUSION.Sidebar.Scenes.Title")}>
              {#if sidebarState.scenes.length === 0}
                <p class="sidebar__empty">{t("FUSION.Sidebar.Scenes.Empty")}</p>
              {:else}
                {#each sidebarState.scenes as scene (scene._id)}
                  {@const isActive = scene._id === activeSceneId}
                  <div
                    class="scene-row"
                    class:scene-row--active={isActive}
                    role="listitem"
                  >
                    <span
                      class="scene-row__dot"
                      class:scene-row__dot--on={isActive}
                      aria-hidden="true"
                      title={isActive ? t("FUSION.Sidebar.Scenes.ActiveScene") : t("FUSION.Sidebar.Scenes.InactiveScene")}
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
                        >&#x25B6;</button>
                      {/if}
                      <button
                        class="action-btn action-btn--edit"
                        onclick={() => { editTarget = scene; }}
                        title={t("FUSION.Scene.Dialog.EditScene")}
                        aria-label="{t('FUSION.Scene.Dialog.EditScene')} {scene.name}"
                      >&#x270E;</button>
                      <button
                        class="action-btn action-btn--delete"
                        onclick={() => { deleteTarget = scene; }}
                        title={t("FUSION.Scene.Dialog.DeleteScene")}
                        aria-label="{t('FUSION.Scene.Dialog.DeleteScene')} {scene.name}"
                      >&#x1F5D1;</button>
                    </div>
                  </div>
                {/each}
              {/if}
              {#if activateError}
                <p class="sidebar__error" role="alert">{activateError}</p>
              {/if}
            </div>
          </div>

        {:else if activeTab === "combat"}
          <!-- Combat tab -->
          <CombatPanel {socket} {isGm} {userId} />

        {:else if activeTab === "chat"}
          <!-- Chat tab -->
          <ChatPanel {socket} {worldId} {isGm} {userId} visible={activeTab === "chat"} />

        {:else if activeTab === "actors"}
          <!-- Actors tab -->
          <ActorDirectory {socket} {isGm} {userId} {worldId} />
        {:else if activeTab === "compendium"}
          <!-- Compendium tab -->
          <CompendiumBrowser {socket} {isGm} />
        {/if}
      </div>

    </div>
  {/if}
</aside>

<!-- Scene dialogs -->
{#if showCreateDialog}
  <SceneCreateDialog
    mode="create"
    {socket}
    onClose={() => { showCreateDialog = false; }}
    onSuccess={() => { showCreateDialog = false; }}
  />
{/if}
{#if editTarget}
  <SceneCreateDialog
    mode="edit"
    scene={editTarget}
    {socket}
    onClose={() => { editTarget = null; }}
    onSuccess={() => { editTarget = null; }}
  />
{/if}
{#if deleteTarget}
  <SceneDeleteConfirm
    scene={deleteTarget}
    {socket}
    onClose={() => { deleteTarget = null; }}
    onSuccess={() => { deleteTarget = null; }}
  />
{/if}

<style>
  /* ---- Container ---- */
  .app-sidebar {
    position: absolute;
    top: var(--fusion-header-height);
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: row-reverse;
    z-index: 90;
    pointer-events: none;
  }

  .app-sidebar.app-sidebar--open {
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
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    margin-top: 0.5rem;
    padding: 0.4rem 0.5rem;
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

  .sidebar__badge {
    background: var(--fusion-danger);
    border-radius: 0.75rem;
    color: #fff;
    font-size: 0.6rem;
    font-weight: 700;
    line-height: 1;
    min-width: 1.1rem;
    padding: 0.15rem 0.2rem;
    text-align: center;
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

  /* ---- Tab bar ---- */
  .sidebar__tabs {
    display: flex;
    border-bottom: 1px solid var(--fusion-border);
    flex-shrink: 0;
  }

  .sidebar__tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--fusion-font);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 0.5rem 0.75rem;
    text-transform: uppercase;
    transition: color var(--fusion-transition), border-color var(--fusion-transition);
  }

  .sidebar__tab:hover {
    color: var(--fusion-text);
  }

  .sidebar__tab--active {
    border-bottom-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .sidebar__tab-badge {
    background: var(--fusion-danger);
    border-radius: 0.75rem;
    color: #fff;
    font-size: 0.6rem;
    line-height: 1;
    min-width: 1.1rem;
    padding: 0.1rem 0.25rem;
    text-align: center;
  }

  .sidebar__tab-badge--combat {
    background: rgba(255, 215, 0, 0.2);
    border: 1px solid #ffd700;
    color: #ffd700;
    padding: 0;
    font-size: 0.65rem;
  }

  /* ---- Content area ---- */
  .sidebar__content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar__tab-body {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ---- Scenes tab inner styles (mirror ScenesSidebar) ---- */
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

  /* ---- Scene rows ---- */
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
    background: none;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
    cursor: pointer;
    font-size: 0.8125rem;
    height: 1.5rem;
    padding: 0;
    transition: background-color var(--fusion-transition), color var(--fusion-transition);
    width: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
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

  /* ---- Buttons ---- */
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
