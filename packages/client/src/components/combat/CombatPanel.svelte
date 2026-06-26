<script lang="ts">
  /**
   * CombatPanel.svelte — Combat tracker sidebar panel.
   *
   * Rendered as the "Combat" tab inside AppSidebar.
   * All logic is delegated to combatStore and combatTracker.ts (pure functions).
   *
   * Supports:
   *   - GM: full combat controls (create, start, roll all/individual, manual init,
   *     next/previous, toggle defeated, toggle hidden, end combat, remove combatant).
   *   - Player: read-only tracker + "Roll my initiative" button on own combatants.
   *   - Empty state: "No active combat" with "Create Combat" button for GM.
   *
   * REQ-CBT-040..047: tracker UI requirements.
   * REQ-CBT-031..035: visibility requirements (server redacts hidden from players).
   *
   * Spec: 10-combate-e-iniciativa.md
   */

  import type { Socket } from "socket.io-client";
  import { combatStore, combatActions, getSortedCombatants } from "../../lib/combat/combatStore.svelte.js";
  import {
    buildTrackerRows,
    controlsState,
    canPlayerRollInitiative,
  } from "../../lib/combat/combatTracker.js";
  import { viewerRole, redactCombatForViewer, canUseGmControls } from "../../lib/combat/combatVisibility.js";
  import { activeSceneState } from "../../lib/docs/activeScene.svelte.js";

  const {
    socket,
    isGm,
    userId,
  }: {
    socket: Socket;
    isGm: boolean;
    /** Current user's ID (for determining which combatants the player owns). */
    userId: string;
  } = $props();

  // ---- Derived state ----

  const combat = $derived(combatStore.combat);
  const busy = $derived(combatStore.busy);
  const error = $derived(combatStore.error);

  // Viewer role drives both control gating and the defense-in-depth hidden
  // filter. The server already redacts hidden combatants from player payloads,
  // but the client re-applies the filter so a leaked hidden combatant is never
  // rendered for a player (REQ-CBT-031/032/033).
  const role = $derived(viewerRole(isGm));
  const gmControls = $derived(canUseGmControls(role));

  // For players, render only non-hidden combatants. For the GM, the original
  // combat (with hidden combatants flagged) is used so they see everything.
  const viewCombat = $derived(combat ? redactCombatForViewer(combat, role) : null);

  const rows = $derived(viewCombat ? buildTrackerRows(viewCombat) : []);
  const controls = $derived(combat ? controlsState(combat) : null);

  // Set of actorIds owned by this user (simplified: we check hasPlayerOwner
  // which the server sets; for full ownership we'd need the actor ownerId list,
  // but for MVP we use hasPlayerOwner as a proxy).
  // Players "own" combatants where hasPlayerOwner === true AND userId matches
  // — we use a simplified check via hasPlayerOwner for now.
  const playerOwnedActorIds = $derived(
    new Set(
      combat?.combatants
        .filter((c) => c.hasPlayerOwner && c.actorId)
        .map((c) => c.actorId!)
        ?? [],
    ),
  );

  // ---- Inline initiative edit state ----
  let editingInitiativeId = $state<string | null>(null);
  let editingInitiativeValue = $state<string>("");

  function startEditInitiative(combatantId: string, current: number | null): void {
    editingInitiativeId = combatantId;
    editingInitiativeValue = current !== null ? current.toString() : "";
  }

  async function commitEditInitiative(combatantId: string): Promise<void> {
    if (!combat) return;
    editingInitiativeId = null;
    const raw = editingInitiativeValue.trim();
    const value = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && (isNaN(value as number) || !isFinite(value as number))) return;
    await combatActions.setInitiative(socket, combat._id, combatantId, value);
  }

  function cancelEditInitiative(): void {
    editingInitiativeId = null;
  }

  // ---- Drag-and-drop reorder state ----
  let dragSourceId = $state<string | null>(null);

  function handleDragStart(combatantId: string): void {
    dragSourceId = combatantId;
  }

  async function handleDrop(targetId: string): Promise<void> {
    if (!combat || !dragSourceId || dragSourceId === targetId) {
      dragSourceId = null;
      return;
    }

    // Build a new order: move dragSourceId to just before targetId
    const currentOrder = getSortedCombatants(combat).map((c) => c._id);
    const srcIdx = currentOrder.indexOf(dragSourceId);
    const tgtIdx = currentOrder.indexOf(targetId);
    if (srcIdx === -1 || tgtIdx === -1) {
      dragSourceId = null;
      return;
    }

    const newOrder = [...currentOrder];
    newOrder.splice(srcIdx, 1);
    const insertAt = newOrder.indexOf(targetId);
    newOrder.splice(insertAt, 0, dragSourceId);

    dragSourceId = null;
    await combatActions.reorder(socket, combat._id, newOrder);
  }

  function handleDragEnd(): void {
    dragSourceId = null;
  }

  // ---- GM: create combat ----
  async function handleCreateCombat(): Promise<void> {
    const sceneId = activeSceneState.id;
    if (!sceneId) return;
    await combatActions.create(socket, sceneId);
  }
</script>

<div class="combat-panel">

  {#if !combat}
    <!-- ---- Empty state ---- -->
    <div class="combat-panel__empty">
      <p class="combat-panel__empty-text">No active combat.</p>
      {#if isGm}
        <button
          class="btn btn--primary btn--sm"
          onclick={handleCreateCombat}
          disabled={busy || !activeSceneState.id}
          aria-label="Create combat"
        >
          Create Combat
        </button>
      {/if}
    </div>

  {:else}
    <!-- ---- Header: round + controls ---- -->
    <div class="combat-panel__header">
      <span class="combat-panel__round">
        {#if combat.started && !combat.ended}
          Round {combat.round}
        {:else if combat.ended}
          Combat ended
        {:else}
          Not started
        {/if}
      </span>

      {#if isGm && controls}
        <div class="combat-panel__header-btns">
          {#if controls.canStart}
            <button
              class="btn btn--primary btn--xs"
              onclick={() => combatActions.start(socket, combat._id)}
              disabled={busy}
              title="Begin Combat"
            >Begin</button>
          {/if}

          {#if controls.canPrevious}
            <button
              class="btn btn--ghost btn--xs"
              onclick={() => combatActions.previousTurn(socket, combat._id)}
              disabled={busy}
              title="Previous Turn"
              aria-label="Previous turn"
            >&#x276E;</button>
          {/if}

          {#if controls.canNext}
            <button
              class="btn btn--accent btn--xs"
              onclick={() => combatActions.nextTurn(socket, combat._id)}
              disabled={busy}
              title="Next Turn"
              aria-label="Next turn"
            >&#x276F;</button>
          {/if}

          {#if controls.canEnd}
            <button
              class="btn btn--danger btn--xs"
              onclick={() => combatActions.end(socket, combat._id)}
              disabled={busy}
              title="End Combat"
              aria-label="End combat"
            >End</button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- ---- GM sub-controls row ---- -->
    {#if isGm && controls}
      <div class="combat-panel__subcontrols">
        {#if controls.canRollAll}
          <button
            class="btn btn--ghost btn--xs"
            onclick={() => combatActions.rollInitiative(socket, combat._id)}
            disabled={busy}
            title="Roll initiative for all combatants with no value"
          >Roll All</button>
        {/if}
        {#if controls.canReset}
          <button
            class="btn btn--ghost btn--xs"
            onclick={() => combatActions.resetInitiative(socket, combat._id)}
            disabled={busy}
            title="Reset all initiative values"
          >Reset Init</button>
        {/if}
      </div>
    {/if}

    <!-- ---- Error banner ---- -->
    {#if error}
      <div class="combat-panel__error" role="alert">{error}</div>
    {/if}

    <!-- ---- Combatant list ---- -->
    <div
      class="combat-panel__list"
      role="list"
      aria-label="Combat turn order"
    >
      {#if rows.length === 0}
        <p class="combat-panel__empty-text">No combatants. {isGm ? 'Add tokens to join the combat.' : ''}</p>
      {:else}
        {#each rows as row (row.id)}
          <div
            class="combatant-row"
            class:combatant-row--active={row.isActive}
            class:combatant-row--defeated={row.isDefeated}
            class:combatant-row--hidden={row.isHidden}
            class:combatant-row--drag-over={dragSourceId !== null && dragSourceId !== row.id}
            role="listitem"
            aria-label="{row.name} initiative {row.initiativeLabel}{row.isActive ? ' (active turn)' : ''}{row.isDefeated ? ' (defeated)' : ''}"
            draggable={isGm}
            ondragstart={() => handleDragStart(row.id)}
            ondragover={(e) => { e.preventDefault(); }}
            ondrop={() => handleDrop(row.id)}
            ondragend={handleDragEnd}
          >
            <!-- Portrait -->
            <div class="combatant-row__portrait" aria-hidden="true">
              {#if row.img}
                <img
                  src={row.img}
                  alt={row.name}
                  class="combatant-row__img"
                  loading="lazy"
                  onerror={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              {:else}
                <span class="combatant-row__img-placeholder">
                  {row.name.charAt(0).toUpperCase()}
                </span>
              {/if}

              {#if row.isDefeated}
                <span class="combatant-row__defeated-icon" aria-hidden="true" title="Defeated">&#x2620;</span>
              {/if}
            </div>

            <!-- Name + status icons -->
            <div class="combatant-row__info">
              <span
                class="combatant-row__name"
                class:combatant-row__name--defeated={row.isDefeated}
                title={row.name}
              >{row.name}</span>

              {#if row.isHidden}
                <span class="combatant-row__hidden-badge" title="Hidden from players" aria-label="Hidden">&#x1F441;</span>
              {/if}

              {#if row.isActive}
                <span class="combatant-row__active-badge" aria-label="Active turn">&#x25B6;</span>
              {/if}
            </div>

            <!-- Tracked resource (REQ-CBT-047): shown alongside initiative -->
            {#if row.trackedResource}
              <div
                class="combatant-row__resource"
                title="{row.trackedResource.label}: {row.trackedResource.value}/{row.trackedResource.max}"
                aria-label="{row.trackedResource.label} {row.trackedResource.value} of {row.trackedResource.max}"
              >
                <span class="combatant-row__resource-value">{row.trackedResource.value}</span><span class="combatant-row__resource-sep">/</span><span class="combatant-row__resource-max">{row.trackedResource.max}</span>
              </div>
            {/if}

            <!-- Initiative value / edit -->
            <div class="combatant-row__initiative">
              {#if gmControls && editingInitiativeId === row.id}
                <!-- Inline edit input -->
                <input
                  class="combatant-row__init-input"
                  type="number"
                  value={editingInitiativeValue}
                  oninput={(e) => { editingInitiativeValue = (e.target as HTMLInputElement).value; }}
                  onblur={() => commitEditInitiative(row.id)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') void commitEditInitiative(row.id);
                    if (e.key === 'Escape') cancelEditInitiative();
                  }}
                  aria-label="Initiative for {row.name}"
                  autofocus
                />
              {:else}
                <button
                  class="combatant-row__init-btn"
                  onclick={() => {
                    if (gmControls) startEditInitiative(row.id, row.initiative);
                  }}
                  title={gmControls ? 'Click to set initiative manually' : `Initiative: ${row.initiativeLabel}`}
                  aria-label="Initiative {row.initiativeLabel}"
                  disabled={!gmControls}
                  type="button"
                >
                  {row.initiativeLabel}
                </button>
              {/if}
            </div>

            <!-- Action buttons -->
            <div class="combatant-row__actions">
              <!-- Target toggle: any user may target a token (server scopes by
                   userId). Shown when the row's combatant has a token. -->
              {#if row.tokenId}
                {@const tokenId = row.tokenId}
                <button
                  class="action-btn"
                  onclick={() => combatActions.target(socket, tokenId, true)}
                  disabled={busy}
                  title="Target this token"
                  aria-label="Target {row.name}"
                >&#x25CE;</button>
              {/if}

              {#if gmControls}
                <!-- Roll initiative for this combatant -->
                {#if !combat.ended}
                  <button
                    class="action-btn"
                    onclick={() => combatActions.rollInitiative(socket, combat._id, [row.id])}
                    disabled={busy}
                    title="Roll initiative"
                    aria-label="Roll initiative for {row.name}"
                  >&#x2685;</button>
                {/if}

                <!-- Toggle defeated -->
                <button
                  class="action-btn"
                  class:action-btn--active={row.isDefeated}
                  onclick={() => combatActions.toggleDefeated(socket, combat._id, row.id, !row.isDefeated)}
                  disabled={busy}
                  title={row.isDefeated ? 'Unmark defeated' : 'Mark defeated'}
                  aria-label={row.isDefeated ? 'Unmark defeated' : 'Mark defeated'}
                >&#x2620;</button>

                <!-- Toggle hidden -->
                <button
                  class="action-btn"
                  class:action-btn--active={row.isHidden}
                  onclick={() => combatActions.setHidden(socket, combat._id, row.id, !row.isHidden)}
                  disabled={busy}
                  title={row.isHidden ? 'Reveal combatant' : 'Hide from players'}
                  aria-label={row.isHidden ? 'Reveal' : 'Hide'}
                >&#x1F441;</button>

                <!-- Remove combatant -->
                <button
                  class="action-btn action-btn--danger"
                  onclick={() => combatActions.removeCombatant(socket, combat._id, row.id)}
                  disabled={busy}
                  title="Remove from combat"
                  aria-label="Remove {row.name} from combat"
                >&#x2715;</button>

              {:else}
                <!-- Player: show "Roll" button on own combatant if initiative is null -->
                {@const rowCombatant = combat.combatants.find((c) => c._id === row.id)}
                {#if rowCombatant && canPlayerRollInitiative(
                  rowCombatant,
                  combat,
                  userId,
                  playerOwnedActorIds,
                  false,
                )}
                  <button
                    class="btn btn--primary btn--xs"
                    onclick={() => combatActions.rollInitiative(socket, combat._id, [row.id])}
                    disabled={busy}
                    aria-label="Roll your initiative"
                  >Roll</button>
                {/if}
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}

</div>

<style>
  .combat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ---- Empty state ---- */
  .combat-panel__empty {
    align-items: center;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    justify-content: center;
    padding: 2rem 1rem;
    text-align: center;
  }

  .combat-panel__empty-text {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
  }

  /* ---- Header ---- */
  .combat-panel__header {
    align-items: center;
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    flex-shrink: 0;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
  }

  .combat-panel__round {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .combat-panel__header-btns {
    display: flex;
    gap: 0.25rem;
  }

  /* ---- Sub-controls ---- */
  .combat-panel__subcontrols {
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    flex-shrink: 0;
    gap: 0.25rem;
    padding: 0.3rem 0.5rem;
  }

  /* ---- Error ---- */
  .combat-panel__error {
    color: var(--fusion-danger);
    font-size: 0.75rem;
    padding: 0.4rem 0.75rem;
  }

  /* ---- List ---- */
  .combat-panel__list {
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  /* ---- Combatant row ---- */
  .combatant-row {
    align-items: center;
    border-left: 3px solid transparent;
    cursor: default;
    display: flex;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem 0.3rem 0.6rem;
    transition: background-color var(--fusion-transition);
    user-select: none;
  }

  .combatant-row:hover {
    background: var(--fusion-surface-alt);
  }

  .combatant-row--active {
    background: rgba(255, 215, 0, 0.06);
    border-left-color: #ffd700;
  }

  .combatant-row--defeated {
    opacity: 0.55;
  }

  .combatant-row--hidden {
    background: rgba(124, 92, 252, 0.04);
  }

  /* Drag-over highlight */
  .combatant-row--drag-over {
    border-top: 2px solid var(--fusion-accent);
  }

  /* ---- Portrait ---- */
  .combatant-row__portrait {
    position: relative;
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
  }

  .combatant-row__img {
    border-radius: var(--fusion-radius-sm);
    display: block;
    height: 2rem;
    object-fit: cover;
    width: 2rem;
  }

  .combatant-row__img-placeholder {
    align-items: center;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    display: flex;
    font-size: 0.875rem;
    font-weight: 600;
    height: 2rem;
    justify-content: center;
    width: 2rem;
  }

  .combatant-row__defeated-icon {
    bottom: -0.25rem;
    font-size: 0.75rem;
    position: absolute;
    right: -0.25rem;
  }

  /* ---- Info ---- */
  .combatant-row__info {
    align-items: center;
    display: flex;
    flex: 1;
    gap: 0.2rem;
    min-width: 0;
    overflow: hidden;
  }

  .combatant-row__name {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .combatant-row__name--defeated {
    text-decoration: line-through;
    color: var(--fusion-text-subtle);
  }

  .combatant-row__hidden-badge,
  .combatant-row__active-badge {
    flex-shrink: 0;
    font-size: 0.7rem;
  }

  .combatant-row__active-badge {
    color: #ffd700;
  }

  .combatant-row__hidden-badge {
    color: var(--fusion-text-subtle);
  }

  /* ---- Tracked resource (REQ-CBT-047) ---- */
  .combatant-row__resource {
    align-items: baseline;
    color: var(--fusion-text-muted);
    display: flex;
    flex-shrink: 0;
    font-family: var(--fusion-font-mono);
    font-size: 0.7rem;
    gap: 0.05rem;
    min-width: 2.5rem;
    justify-content: flex-end;
  }

  .combatant-row__resource-value {
    color: var(--fusion-text);
    font-weight: 600;
  }

  .combatant-row__resource-sep,
  .combatant-row__resource-max {
    color: var(--fusion-text-subtle);
  }

  /* ---- Initiative ---- */
  .combatant-row__initiative {
    flex-shrink: 0;
    min-width: 2.25rem;
    text-align: right;
  }

  .combatant-row__init-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font-mono);
    font-size: 0.8125rem;
    font-weight: 600;
    min-width: 2rem;
    padding: 0.1rem 0.25rem;
    text-align: right;
    transition: border-color var(--fusion-transition), background-color var(--fusion-transition);
  }

  .combatant-row__init-btn:not(:disabled):hover {
    background: var(--fusion-surface-alt);
    border-color: var(--fusion-border);
  }

  .combatant-row__init-btn:disabled {
    cursor: default;
    opacity: 1;
  }

  .combatant-row__init-input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
    font-size: 0.8125rem;
    padding: 0.1rem 0.2rem;
    text-align: right;
    width: 3rem;
    -moz-appearance: textfield;
  }

  .combatant-row__init-input::-webkit-inner-spin-button,
  .combatant-row__init-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* ---- Actions ---- */
  .combatant-row__actions {
    align-items: center;
    display: flex;
    flex-shrink: 0;
    gap: 0.15rem;
    opacity: 0;
    transition: opacity var(--fusion-transition);
  }

  .combatant-row:hover .combatant-row__actions {
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
    font-size: 0.7rem;
    height: 1.4rem;
    justify-content: center;
    padding: 0;
    transition: background-color var(--fusion-transition), color var(--fusion-transition);
    width: 1.4rem;
  }

  .action-btn:not(:disabled):hover {
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
  }

  .action-btn:disabled {
    cursor: not-allowed;
    opacity: 0.3;
  }

  .action-btn--active {
    color: var(--fusion-accent);
  }

  .action-btn--danger:not(:disabled):hover {
    background: rgba(255, 92, 92, 0.1);
    color: var(--fusion-danger);
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
    transition: background-color var(--fusion-transition), opacity var(--fusion-transition);
    white-space: nowrap;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .btn--primary:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
  }

  .btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .btn--ghost:hover:not(:disabled) {
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
  }

  .btn--accent {
    background: rgba(255, 215, 0, 0.15);
    border-color: #ffd700;
    color: #ffd700;
  }

  .btn--accent:hover:not(:disabled) {
    background: rgba(255, 215, 0, 0.25);
  }

  .btn--danger {
    background: transparent;
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .btn--danger:hover:not(:disabled) {
    background: rgba(255, 92, 92, 0.1);
  }

  .btn--sm {
    font-size: 0.8125rem;
    padding: 0.3rem 0.75rem;
  }

  .btn--xs {
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
  }
</style>
