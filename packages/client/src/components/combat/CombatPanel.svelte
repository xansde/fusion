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
    addableTokens,
  } from "../../lib/combat/combatTracker.js";
  import { viewerRole, redactCombatForViewer, canUseGmControls } from "../../lib/combat/combatVisibility.js";
  import { activeSceneState } from "../../lib/docs/activeScene.svelte.js";
  import { t } from "../../lib/i18n/i18n.js";

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

  // ---- GM: add combatants (BUG D FIX) ----
  //
  // Root cause: combat:create + combat:beginCombat already worked, and both
  // the server handler (combat:addCombatant) and the client action
  // (combatActions.addCombatant) already existed — but nothing in the UI
  // ever called it, so a GM had no way to populate a combat, making it look
  // like combat couldn't be started. This wires a simple "Add tokens" popover
  // listing the active scene's tokens that aren't combatants yet. If no
  // combat exists yet, the button creates one first (GM flow: activate a
  // scene → Add tokens → Begin).
  let showAddCombatants = $state(false);

  const addable = $derived(
    addableTokens(activeSceneState.scene?.tokens ?? [], combat),
  );

  async function handleOpenAddCombatants(): Promise<void> {
    if (!combat) {
      const sceneId = activeSceneState.id;
      if (!sceneId) return;
      await combatActions.create(socket, sceneId);
    }
    showAddCombatants = true;
  }

  async function handleAddToken(tokenId: string, actorId: string | null): Promise<void> {
    if (!combat) return;
    await combatActions.addCombatant(socket, combat._id, tokenId, actorId ?? undefined);
  }
</script>

<div class="combat-panel">

  <!-- ---- Error banner ----
    BUG FIX: previously nested inside the {:else} branch below (only rendered
    when `combat` was already truthy), so a failed combatActions.create()
    (e.g. DEC-CBT-06 "combat already exists for this scene") silently no-op'd
    from the GM's perspective whenever the mirror didn't already have a Combat
    doc — exactly the empty-state case where "Criar Combate" is clicked. Hoisted
    above the {#if !combat} split so it renders in both states. -->
  {#if error}
    <div class="combat-panel__error" role="alert">{error}</div>
  {/if}

  {#if !combat}
    <!-- ---- Empty state ---- -->
    <div class="combat-panel__empty">
      <p class="combat-panel__empty-text">{t("FUSION.Combat.Empty")}</p>
      {#if isGm}
        <div class="combat-panel__empty-actions">
          <button
            class="btn btn--primary btn--sm"
            onclick={handleCreateCombat}
            disabled={busy || !activeSceneState.id}
            aria-label={t("FUSION.Combat.Create")}
          >
            {t("FUSION.Combat.Create")}
          </button>
          <button
            class="btn btn--ghost btn--sm"
            onclick={handleOpenAddCombatants}
            disabled={busy || !activeSceneState.id}
            aria-label={t("FUSION.Combat.AddCombatants")}
            title={t("FUSION.Combat.AddCombatantsTitle")}
          >
            {t("FUSION.Combat.AddCombatants")}
          </button>
        </div>
      {/if}
    </div>

  {:else}
    <!-- ---- Header: round + controls ---- -->
    <div class="combat-panel__header">
      <span class="combat-panel__round">
        {#if combat.started && !combat.ended}
          {t("FUSION.Combat.Started", { round: combat.round })}
        {:else if combat.ended}
          {t("FUSION.Combat.Ended")}
        {:else}
          {t("FUSION.Combat.NotStarted")}
        {/if}
      </span>

      {#if isGm && controls}
        <div class="combat-panel__header-btns">
          {#if controls.canStart}
            <button
              class="btn btn--primary btn--xs"
              onclick={() => combatActions.start(socket, combat._id)}
              disabled={busy}
              title={t("FUSION.Combat.Begin")}
            >{t("FUSION.Combat.Begin")}</button>
          {/if}

          {#if controls.canPrevious}
            <button
              class="btn btn--ghost btn--xs"
              onclick={() => combatActions.previousTurn(socket, combat._id)}
              disabled={busy}
              title={t("FUSION.Combat.PreviousTurn")}
              aria-label={t("FUSION.Combat.PreviousTurn")}
            >&#x276E;</button>
          {/if}

          {#if controls.canNext}
            <button
              class="btn btn--accent btn--xs"
              onclick={() => combatActions.nextTurn(socket, combat._id)}
              disabled={busy}
              title={t("FUSION.Combat.NextTurn")}
              aria-label={t("FUSION.Combat.NextTurn")}
            >&#x276F;</button>
          {/if}

          {#if controls.canEnd}
            <button
              class="btn btn--danger btn--xs"
              onclick={() => combatActions.end(socket, combat._id)}
              disabled={busy}
              title={t("FUSION.Combat.End")}
              aria-label={t("FUSION.Combat.End")}
            >{t("FUSION.Combat.End")}</button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- ---- GM sub-controls row ---- -->
    {#if isGm && controls}
      <div class="combat-panel__subcontrols">
        <button
          class="btn btn--ghost btn--xs"
          onclick={handleOpenAddCombatants}
          disabled={busy || !activeSceneState.id}
          title={t("FUSION.Combat.AddCombatantsTitle")}
        >{t("FUSION.Combat.AddCombatants")}</button>
        {#if controls.canRollAll}
          <button
            class="btn btn--ghost btn--xs"
            onclick={() => combatActions.rollInitiative(socket, combat._id)}
            disabled={busy}
            title={t("FUSION.Combat.RollAll")}
          >{t("FUSION.Combat.RollAll")}</button>
        {/if}
        {#if controls.canReset}
          <button
            class="btn btn--ghost btn--xs"
            onclick={() => combatActions.resetInitiative(socket, combat._id)}
            disabled={busy}
            title={t("FUSION.Combat.ResetInit")}
          >{t("FUSION.Combat.ResetInit")}</button>
        {/if}
      </div>
    {/if}

    <!-- ---- Add combatants popover (BUG D FIX) ---- -->
    {#if isGm && showAddCombatants}
      <div class="add-combatants" role="region" aria-label={t("FUSION.Combat.AddCombatantsTitle")}>
        <div class="add-combatants__header">
          <span class="add-combatants__title">{t("FUSION.Combat.AddCombatantsTitle")}</span>
          <button
            class="btn btn--icon"
            onclick={() => { showAddCombatants = false; }}
            aria-label={t("FUSION.Combat.CloseAddCombatants")}
            type="button"
          >&#x2715;</button>
        </div>
        {#if addable.length === 0}
          <p class="add-combatants__empty">{t("FUSION.Combat.AddCombatantsEmpty")}</p>
        {:else}
          <ul class="add-combatants__list" role="list">
            {#each addable as token (token.id)}
              <li class="add-combatants__item">
                <span class="add-combatants__name" title={token.name}>{token.name}</span>
                <button
                  class="btn btn--primary btn--xs"
                  onclick={() => void handleAddToken(token.id, token.actorId)}
                  disabled={busy}
                  aria-label={t("FUSION.Combat.AddToken", { name: token.name })}
                  type="button"
                >{t("FUSION.Combat.AddCombatants")}</button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <!-- ---- Combatant list ---- -->
    <div
      class="combat-panel__list"
      role="list"
      aria-label={t("FUSION.Combat.TurnOrder")}
    >
      {#if rows.length === 0}
        <p class="combat-panel__empty-text">
          {isGm ? t("FUSION.Combat.NoCombatantsGm") : t("FUSION.Combat.NoCombatants")}
        </p>
      {:else}
        {#each rows as row (row.id)}
          <div
            class="combatant-row"
            class:combatant-row--active={row.isActive}
            class:combatant-row--defeated={row.isDefeated}
            class:combatant-row--hidden={row.isHidden}
            class:combatant-row--drag-over={dragSourceId !== null && dragSourceId !== row.id}
            role="listitem"
            aria-label="{row.name} {t('FUSION.Combat.Initiative', { value: row.initiativeLabel })}{row.isActive ? ` (${t('FUSION.Combat.ActiveTurn')})` : ''}{row.isDefeated ? ` (${t('FUSION.Combat.Defeated')})` : ''}"
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
                <span class="combatant-row__defeated-icon" aria-hidden="true" title={t("FUSION.Combat.Defeated")}>&#x2620;</span>
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
                <span class="combatant-row__hidden-badge" title={t("FUSION.Combat.HiddenFromPlayers")} aria-label={t("FUSION.Combat.HiddenFromPlayers")}>&#x1F441;</span>
              {/if}

              {#if row.isActive}
                <span class="combatant-row__active-badge" aria-label={t("FUSION.Combat.ActiveTurn")}>&#x25B6;</span>
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
                  aria-label="{t('FUSION.Combat.RollInitiative')} {row.name}"
                  autofocus
                />
              {:else}
                <button
                  class="combatant-row__init-btn"
                  onclick={() => {
                    if (gmControls) startEditInitiative(row.id, row.initiative);
                  }}
                  title={gmControls ? t("FUSION.Combat.SetInitiativeManually") : t("FUSION.Combat.Initiative", { value: row.initiativeLabel })}
                  aria-label="{t('FUSION.Combat.Initiative', { value: row.initiativeLabel })}"
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
                  title={t("FUSION.Combat.TargetToken")}
                  aria-label="{t('FUSION.Combat.TargetToken')} {row.name}"
                >&#x25CE;</button>
              {/if}

              {#if gmControls}
                <!-- Roll initiative for this combatant -->
                {#if !combat.ended}
                  <button
                    class="action-btn"
                    onclick={() => combatActions.rollInitiative(socket, combat._id, [row.id])}
                    disabled={busy}
                    title={t("FUSION.Combat.RollInitiative")}
                    aria-label="{t('FUSION.Combat.RollInitiative')} {row.name}"
                  >&#x2685;</button>
                {/if}

                <!-- Toggle defeated -->
                <button
                  class="action-btn"
                  class:action-btn--active={row.isDefeated}
                  onclick={() => combatActions.toggleDefeated(socket, combat._id, row.id, !row.isDefeated)}
                  disabled={busy}
                  title={row.isDefeated ? t("FUSION.Combat.UnmarkDefeated") : t("FUSION.Combat.MarkDefeated")}
                  aria-label={row.isDefeated ? t("FUSION.Combat.UnmarkDefeated") : t("FUSION.Combat.MarkDefeated")}
                >&#x2620;</button>

                <!-- Toggle hidden -->
                <button
                  class="action-btn"
                  class:action-btn--active={row.isHidden}
                  onclick={() => combatActions.setHidden(socket, combat._id, row.id, !row.isHidden)}
                  disabled={busy}
                  title={row.isHidden ? t("FUSION.Combat.RevealCombatant") : t("FUSION.Combat.HiddenFromPlayers")}
                  aria-label={row.isHidden ? t("FUSION.Combat.RevealCombatant") : t("FUSION.Combat.HiddenFromPlayers")}
                >&#x1F441;</button>

                <!-- Remove combatant -->
                <button
                  class="action-btn action-btn--danger"
                  onclick={() => combatActions.removeCombatant(socket, combat._id, row.id)}
                  disabled={busy}
                  title={t("FUSION.Combat.RemoveFromCombat")}
                  aria-label="{t('FUSION.Combat.RemoveFromCombat')} {row.name}"
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
                    aria-label={t("FUSION.Combat.RollMyInitiative")}
                  >{t("FUSION.Combat.RollMyInitiative")}</button>
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

  .combat-panel__empty-actions {
    display: flex;
    gap: 0.5rem;
  }

  /* ---- Add combatants popover (BUG D FIX) ---- */
  .add-combatants {
    border-bottom: 1px solid var(--fusion-border);
    flex-shrink: 0;
    padding: 0.5rem 0.75rem;
  }

  .add-combatants__header {
    align-items: center;
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.4rem;
  }

  .add-combatants__title {
    color: var(--fusion-text);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .add-combatants__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.75rem;
    padding: 0.4rem 0;
  }

  .add-combatants__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    list-style: none;
    max-height: 160px;
    overflow-y: auto;
  }

  .add-combatants__item {
    align-items: center;
    background: var(--fusion-surface-alt);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 0.25rem 0.4rem;
  }

  .add-combatants__name {
    color: var(--fusion-text);
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .btn--icon {
    padding: 0.25rem 0.4rem;
  }
</style>
