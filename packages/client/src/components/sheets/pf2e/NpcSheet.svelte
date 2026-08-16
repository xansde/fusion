<script lang="ts">
  /**
   * NpcSheet.svelte — PF2e NPC Sheet component (compact GM-focused statblock).
   *
   * Thin Svelte 5 wrapper over NpcSheetVM.
   * Optimised for speed-of-reading during combat:
   *   - Flat statblock at the top (AC, HP, Saves, Perception, Skills)
   *   - Strikes/actions list
   *   - Inline condition management
   *
   * REQ-PF2-111, REQ-UIF-021..025.
   * Spec: 17-sistema-pf2e.md §DEC-PF2-09.
   */

  import { NpcSheetVM, SCAFFOLDING_CONDITION_CATALOG } from "$lib/sheets/pf2e/npcSheetVM.js";
  import type {
    DocUpdatePayload,
    DocCreateEmbeddedPayload,
    DocDeleteEmbeddedPayload,
    RollCheckPayload,
  } from "$lib/sheets/pf2e/npcSheetVM.js";
  import { worldMirror } from "$lib/docs/worldSync.js";
  import { t } from "$lib/i18n/i18n.js";
  import ActorPortrait from "../../common/ActorPortrait.svelte";

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  interface Props {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    isGm: boolean;
    worldId?: string;
    sendOpFn?: (
      op: RollCheckPayload | DocUpdatePayload | DocCreateEmbeddedPayload | DocDeleteEmbeddedPayload,
    ) => void;
  }

  let {
    doc,
    actorId,
    ownership,
    isGm,
    worldId = "",
    sendOpFn = () => {},
  }: Props = $props();

  // ---------------------------------------------------------------------------
  // Reactivity (REQ-UIF-025) — see CharacterSheet.svelte for the full
  // rationale: WindowHost captures componentProps once at open time, so
  // without this the sheet renders a frozen snapshot and never reacts to
  // doc:update broadcasts. liveDoc is refreshed from worldMirror on every
  // Actor batch change; vm is re-derived from liveDoc.
  // ---------------------------------------------------------------------------

  let liveDoc = $state(doc);

  $effect(() => {
    const unsub = worldMirror.subscribe<Record<string, unknown>>("Actor", (docs) => {
      const fresh = docs.find((d) => (d as { _id?: unknown })._id === actorId);
      if (fresh) liveDoc = fresh;
    });
    return unsub;
  });

  // ---------------------------------------------------------------------------
  // View-model
  // ---------------------------------------------------------------------------

  const vm = $derived(
    new NpcSheetVM({ doc: liveDoc, actorId, ownership, isGm }),
  );

  // ---------------------------------------------------------------------------
  // Autosave
  // ---------------------------------------------------------------------------

  let saveStatus = $state<"idle" | "saving" | "saved">("idle");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 400;

  function scheduleUpdate(op: DocUpdatePayload | null): void {
    if (!op) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    saveStatus = "saving";
    debounceTimer = setTimeout(() => {
      sendOpFn(op);
      saveStatus = "saved";
      setTimeout(() => { saveStatus = "idle"; }, 1500);
    }, DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function rollSave(name: "fortitude" | "reflex" | "will"): void {
    sendOpFn(vm.rollSave(name));
  }

  function rollPerception(): void {
    sendOpFn(vm.rollPerception());
  }

  function rollStrike(id: string): void {
    sendOpFn(vm.rollStrike(id));
  }

  function rollSkill(slug: string): void {
    sendOpFn(vm.rollSkill(slug));
  }

  function toggleCondition(slug: string): void {
    const op = vm.toggleCondition(slug);
    if (op) sendOpFn(op);
  }

  // SCAFFOLDING (T034): conditions not already active, for the "+ Condition"
  // add picker below (see SCAFFOLDING_CONDITION_CATALOG docstring).
  const availableConditions = $derived(
    SCAFFOLDING_CONDITION_CATALOG.filter(
      (c) => !vm.conditions.some((active) => active.slug === c.slug),
    ),
  );

  function handleAddCondition(e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    const slug = select.value;
    select.value = "";
    if (slug) toggleCondition(slug);
  }

  function handleHpInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) {
      scheduleUpdate(vm.applyHpDelta(val - vm.hpCurrent));
    }
  }
</script>

<div class="pf2e-sheet pf2e-npc-sheet" role="document" aria-label="NPC Sheet: {vm.name}">

  <!-- ---- Header ---- -->
  <header class="npc-header">
    <!-- Portrait (r19-W4): circular, with an initials fallback. -->
    <ActorPortrait
      img={vm.img}
      name={vm.name}
      size={48}
      label={t("FUSION.Sheet.Portrait.Alt", { name: vm.name })}
    />

    <div class="npc-header__info">
      <h2 class="npc-header__name">{vm.name}</h2>
      <div class="npc-header__level">Creature {vm.level}</div>
    </div>

    <!-- HP -->
    <div class="npc-hp" aria-label="Hit Points">
      {#if vm.editable}
        <input
          class="npc-hp__input"
          type="number"
          min="0"
          max={vm.hpMax}
          value={vm.hpCurrent}
          oninput={handleHpInput}
          aria-label="Current HP (of {vm.hpMax})"
        />
      {:else}
        <span class="npc-hp__value">{vm.hpCurrent}</span>
      {/if}
      <span class="npc-hp__sep">/</span>
      <span class="npc-hp__max">{vm.hpMax}</span>
      <span class="npc-hp__label">HP</span>
      {#if saveStatus === "saving"}
        <span class="save-status" aria-live="polite">…</span>
      {/if}
    </div>
  </header>

  <!-- ---- Statblock row ---- -->
  <div class="statblock-row">
    <!-- AC -->
    <div class="stat-block" aria-label="Armor Class {vm.ac.total}">
      <span class="stat-block__value">{vm.ac.total}</span>
      <span class="stat-block__label">AC</span>
      {#if vm.acDetails}
        <span class="stat-block__detail">{vm.acDetails}</span>
      {/if}
    </div>

    <!-- Perception -->
    <button
      class="stat-block stat-block--rollable"
      onclick={rollPerception}
      aria-label="Roll Perception {vm.perception.totalFormatted}"
    >
      <span class="stat-block__value">{vm.perception.totalFormatted}</span>
      <span class="stat-block__label">Perc</span>
    </button>

    <!-- Speed -->
    <div class="stat-block" aria-label="Speed {vm.speed} ft">
      <span class="stat-block__value">{vm.speed}</span>
      <span class="stat-block__label">Speed</span>
    </div>
  </div>

  <!-- ---- Saves row ---- -->
  <div class="saves-row">
    {#each vm.saves as save (save.label)}
      <button
        class="save-block"
        onclick={() => rollSave(save.label.toLowerCase() as "fortitude" | "reflex" | "will")}
        aria-label="Roll {save.label} ({save.totalFormatted})"
      >
        <span class="save-block__mod">{save.totalFormatted}</span>
        <span class="save-block__label">{save.label.slice(0, 4)}</span>
      </button>
    {/each}
  </div>

  <!-- ---- Skills (compact) ---- -->
  {#if vm.skills.length > 0}
    <div class="npc-skills">
      <span class="npc-skills__label">Skills</span>
      <div class="npc-skills__list">
        {#each vm.skills as skill (skill.slug)}
          <button
            class="skill-chip"
            onclick={() => rollSkill(skill.slug)}
            aria-label="Roll {skill.label} ({skill.totalFormatted})"
          >
            {skill.label} {skill.totalFormatted}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- ---- Conditions ---- -->
  {#if vm.conditions.length > 0 || vm.editable}
    <div class="conditions-bar" role="list" aria-label="Active Conditions">
      {#each vm.conditions as cond (cond.itemId)}
        <button
          class="condition-chip"
          onclick={() => toggleCondition(cond.slug)}
          aria-label="{cond.label}{cond.value != null ? ' ' + String(cond.value) : ''} — click to remove"
        >
          {cond.label}{cond.value != null ? ` ${String(cond.value)}` : ""}
          <span aria-hidden="true"> ✕</span>
        </button>
      {/each}
      {#if vm.editable && availableConditions.length > 0}
        <!--
          SCAFFOLDING (T034): minimal add-condition control — makes
          vm.toggleCondition's "add" branch reachable from the UI. See
          SCAFFOLDING_CONDITION_CATALOG in characterSheetVM.ts.
        -->
        <select
          class="condition-add-select"
          aria-label="Add condition"
          onchange={handleAddCondition}
        >
          <option value="">+ Condition…</option>
          {#each availableConditions as c (c.slug)}
            <option value={c.slug}>{c.label}</option>
          {/each}
        </select>
      {/if}
    </div>
  {/if}

  <!-- ---- Strikes ---- -->
  {#if vm.strikes.length > 0}
    <section class="npc-section" aria-label="Strikes">
      <h3 class="npc-section__header">Strikes</h3>
      <ul class="npc-strike-list" aria-label="Strike list">
        {#each vm.strikes as strike (strike.id)}
          <li class="npc-strike-row">
            <button
              class="npc-strike-btn"
              onclick={() => rollStrike(strike.id)}
              aria-label="Roll {strike.name} ({strike.bonusFormatted})"
            >
              <span class="npc-strike-btn__name">{strike.name}</span>
              <span class="npc-strike-btn__bonus">{strike.bonusFormatted}</span>
            </button>
            <div class="npc-strike-damage">
              {#each strike.damageEntries as dmg, i}
                {#if i > 0}<span class="npc-strike-damage__sep"> + </span>{/if}
                <span class="npc-strike-damage__formula">{dmg.formula}</span>
                <span class="npc-strike-damage__type">{dmg.damageType}</span>
              {/each}
            </div>
            {#if strike.traits.length > 0}
              <div class="npc-strike-traits">
                {#each strike.traits as trait}
                  <span class="trait-badge">{trait}</span>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- ---- Actions/Abilities ---- -->
  {#if vm.actions.length > 0}
    <section class="npc-section" aria-label="Actions">
      <h3 class="npc-section__header">Actions</h3>
      <ul class="npc-action-list" aria-label="Action list">
        {#each vm.actions as action (action.id)}
          <li class="npc-action-row">
            <div class="npc-action-header">
              {#if action.actionCost !== null}
                <span class="action-cost" aria-label="{action.actionCost} action">{action.actionCost}</span>
              {/if}
              <span class="npc-action-name">{action.name}</span>
              {#each action.traits as trait}
                <span class="trait-badge">{trait}</span>
              {/each}
            </div>
            {#if action.description}
              <p class="npc-action-desc">{action.description}</p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

</div>

<style>
  .pf2e-npc-sheet {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-primary, #e0e0ff);
    font-size: 13px;
  }

  /* ---- Header ---- */
  .npc-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--fusion-color-surface-raised, #16213e);
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
  }

  .npc-header__info {
    flex: 1;
  }

  .npc-header__name {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.2;
  }

  .npc-header__level {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    margin-top: 2px;
  }

  /* HP */
  .npc-hp {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .npc-hp__input {
    width: 42px;
    text-align: center;
    background: var(--fusion-color-surface, #1a1a2e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-color-text-primary, #e0e0ff);
    font-size: 16px;
    font-weight: 700;
    padding: 2px 4px;
  }

  .npc-hp__value {
    font-size: 16px;
    font-weight: 700;
  }

  .npc-hp__sep {
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .npc-hp__max {
    font-size: 13px;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .npc-hp__label {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
  }

  .save-status {
    font-size: 11px;
    color: var(--fusion-color-warning, #ffcc00);
  }

  /* ---- Statblock row ---- */
  .statblock-row {
    display: flex;
    gap: 4px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
  }

  .stat-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 12px;
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    cursor: default;
  }

  .stat-block--rollable {
    cursor: pointer;
    transition: background 0.15s;
  }

  .stat-block--rollable:hover,
  .stat-block--rollable:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .stat-block__value {
    font-size: 16px;
    font-weight: 700;
    line-height: 1;
  }

  .stat-block__label {
    font-size: 9px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
    margin-top: 2px;
  }

  .stat-block__detail {
    font-size: 9px;
    color: var(--fusion-color-text-subtle, #6666aa);
  }

  /* ---- Saves row ---- */
  .saves-row {
    display: flex;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
  }

  .save-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px;
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    cursor: pointer;
    transition: background 0.15s;
  }

  .save-block:hover,
  .save-block:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .save-block__mod {
    font-size: 14px;
    font-weight: 700;
  }

  .save-block__label {
    font-size: 9px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
  }

  /* ---- Skills compact ---- */
  .npc-skills {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .npc-skills__label {
    font-size: 10px;
    font-weight: 700;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .npc-skills__list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .skill-chip {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 10px;
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: transparent;
    color: var(--fusion-color-text-secondary, #b0b0cc);
    cursor: pointer;
    transition: background 0.15s;
  }

  .skill-chip:hover,
  .skill-chip:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  /* ---- Conditions bar ---- */
  .conditions-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
  }

  .condition-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    border-radius: 10px;
    background: rgba(255, 120, 60, 0.2);
    border: 1px solid rgba(255, 120, 60, 0.4);
    color: #ffaa88;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .condition-chip:hover,
  .condition-chip:focus-visible {
    background: rgba(255, 120, 60, 0.35);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  /* ---- Condition add picker (SCAFFOLDING, T034) ---- */
  .condition-add-select {
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 10px;
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-secondary, #b0b0cc);
    border: 1px dashed var(--fusion-color-border, #3a3a5c);
    cursor: pointer;
  }

  /* ---- Sections (Strikes / Actions) ---- */
  .npc-section {
    padding: 8px 12px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .npc-section__header {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fusion-color-text-muted, #9999cc);
    margin: 0 0 6px;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  /* Strikes */
  .npc-strike-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .npc-strike-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .npc-strike-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    cursor: pointer;
    color: var(--fusion-color-text-primary, #e0e0ff);
    transition: background 0.15s;
  }

  .npc-strike-btn:hover,
  .npc-strike-btn:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .npc-strike-btn__name {
    font-size: 12px;
    font-weight: 600;
  }

  .npc-strike-btn__bonus {
    font-size: 13px;
    font-weight: 700;
  }

  .npc-strike-damage {
    font-size: 11px;
    color: var(--fusion-color-text-secondary, #b0b0cc);
    padding-left: 8px;
  }

  .npc-strike-damage__formula {
    font-family: var(--fusion-font-mono, monospace);
    color: var(--fusion-color-text-primary, #e0e0ff);
  }

  .npc-strike-damage__type {
    color: var(--fusion-color-text-muted, #9999cc);
    margin-left: 2px;
  }

  .npc-strike-damage__sep {
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .npc-strike-traits {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    padding-left: 8px;
  }

  /* Actions */
  .npc-action-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .npc-action-row {
    padding: 6px 8px;
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
  }

  .npc-action-header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }

  .action-cost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--fusion-color-accent, #5b8dee);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .npc-action-name {
    font-size: 12px;
    font-weight: 600;
    flex: 1;
  }

  .npc-action-desc {
    font-size: 11px;
    color: var(--fusion-color-text-secondary, #b0b0cc);
    margin: 0;
    line-height: 1.4;
  }

  /* Trait badges */
  .trait-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(91, 141, 238, 0.12);
    border: 1px solid rgba(91, 141, 238, 0.25);
    color: #8ab0f0;
    flex-shrink: 0;
  }
</style>
