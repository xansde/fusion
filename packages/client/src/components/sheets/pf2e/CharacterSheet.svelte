<script lang="ts">
  /**
   * CharacterSheet.svelte — PF2e Character Sheet component.
   *
   * Thin Svelte 5 wrapper over CharacterSheetVM.
   * All logic lives in characterSheetVM.ts; this file only handles rendering
   * and user events (REQ-PF2-110, REQ-UIF-021..025, spec 11 §DEC-UIF-01).
   *
   * Opens via windowManager.open() with singletonKey = "sheet:Actor:<actorId>".
   * Autosave: field changes debounce → doc:update via sendOp.
   *
   * Props:
   *   doc        — reactive actor document from DocumentMirror
   *   actorId    — actor._id
   *   ownership  — OwnershipLevel for the current user
   *   userId     — current user's id
   *   isGm       — true if current user is GM
   *   sendOpFn   — callback to emit ops via socket (injected for testability)
   */

  import { CharacterSheetVM } from "$lib/sheets/pf2e/characterSheetVM.js";
  import type { RollCheckPayload, DocUpdatePayload, CharacterSheetTab } from "$lib/sheets/pf2e/characterSheetVM.js";

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  interface Props {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    userId: string;
    isGm: boolean;
    sendOpFn?: (op: RollCheckPayload | DocUpdatePayload) => void;
  }

  let {
    doc,
    actorId,
    ownership,
    userId,
    isGm,
    sendOpFn = () => {},
  }: Props = $props();

  // ---------------------------------------------------------------------------
  // View-model — recreated whenever doc changes
  // ---------------------------------------------------------------------------

  const vm = $derived(
    new CharacterSheetVM({ doc, actorId, ownership, userId, isGm }),
  );

  // ---------------------------------------------------------------------------
  // Tab state
  // ---------------------------------------------------------------------------

  let activeTab = $state<CharacterSheetTab>("main");

  // ---------------------------------------------------------------------------
  // Autosave state
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
  // Roll helpers
  // ---------------------------------------------------------------------------

  function rollSkill(slug: string): void {
    sendOpFn(vm.rollSkill(slug));
  }

  function rollSave(name: "fortitude" | "reflex" | "will"): void {
    sendOpFn(vm.rollSave(name));
  }

  function rollPerception(): void {
    sendOpFn(vm.rollPerception());
  }

  function rollStrike(sourceId: string, mapIndex: 0 | 1 | 2): void {
    sendOpFn(vm.rollStrike(sourceId, mapIndex));
  }

  function toggleCondition(slug: string): void {
    const op = vm.toggleCondition(slug);
    if (op) sendOpFn(op);
  }

  // HP inline editing
  function handleHpInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const newValue = parseInt(input.value, 10);
    if (!Number.isNaN(newValue)) {
      const op = vm.fieldUpdate("system.attributes.hp.value", Math.max(0, Math.min(newValue, vm.hpMax)));
      scheduleUpdate(op);
    }
  }
</script>

<!-- ======================================================================
  Character Sheet
  REQ-UIF-061: container queries for responsive layout within the window.
====================================================================== -->
<div class="pf2e-sheet pf2e-character-sheet" role="document" aria-label="Character Sheet: {vm.name}">

  <!-- ---- Header ---- -->
  <header class="sheet-header">
    {#if vm.img}
      <img
        class="sheet-portrait"
        src={vm.img}
        alt="Portrait of {vm.name}"
        width="64"
        height="64"
      />
    {/if}

    <div class="sheet-header__info">
      <h2 class="sheet-header__name">{vm.name}</h2>
      <div class="sheet-header__subtitle">
        {vm.ancestryLabel}
        {#if vm.ancestryLabel && vm.classLabel} · {/if}
        {vm.classLabel}
        Level {vm.level}
      </div>
    </div>

    <!-- HP editor -->
    <div class="sheet-hp" aria-label="Hit Points">
      <label class="sheet-hp__label" for="hp-input-{actorId}">HP</label>
      <div class="sheet-hp__row">
        {#if vm.editable}
          <input
            id="hp-input-{actorId}"
            class="sheet-hp__value"
            type="number"
            min="0"
            max={vm.hpMax}
            value={vm.hpCurrent}
            oninput={handleHpInput}
            aria-label="Current HP"
          />
        {:else}
          <span class="sheet-hp__value sheet-hp__value--readonly">{vm.hpCurrent}</span>
        {/if}
        <span class="sheet-hp__sep">/</span>
        <span class="sheet-hp__max">{vm.hpMax}</span>
        {#if vm.hpTemp > 0}
          <span class="sheet-hp__temp">(+{vm.hpTemp})</span>
        {/if}
      </div>
      {#if saveStatus === "saving"}
        <span class="sheet-save-status sheet-save-status--saving" aria-live="polite">saving…</span>
      {:else if saveStatus === "saved"}
        <span class="sheet-save-status sheet-save-status--saved" aria-live="polite">saved</span>
      {/if}
    </div>

    <!-- AC / Perception row -->
    <div class="sheet-defenses">
      <div class="defense-block" aria-label="Armor Class {vm.ac}">
        <span class="defense-block__value">{vm.ac}</span>
        <span class="defense-block__label">AC</span>
      </div>
      <button
        class="defense-block defense-block--rollable"
        onclick={rollPerception}
        aria-label="Roll Perception {vm.perception.totalFormatted}"
      >
        <span class="defense-block__value">{vm.perception.totalFormatted}</span>
        <span class="defense-block__label">Perception</span>
      </button>
    </div>

    <!-- Dying / Wounded / Doomed badges (visible only when > 0) -->
    {#if vm.dying > 0 || vm.wounded > 0 || vm.doomed > 0}
      <div class="sheet-status-badges" role="status" aria-label="Character status">
        {#if vm.dying > 0}
          <span class="status-badge status-badge--dying">Dying {vm.dying}/{vm.dyingMax}</span>
        {/if}
        {#if vm.wounded > 0}
          <span class="status-badge status-badge--wounded">Wounded {vm.wounded}</span>
        {/if}
        {#if vm.doomed > 0}
          <span class="status-badge status-badge--doomed">Doomed {vm.doomed}</span>
        {/if}
      </div>
    {/if}

    <!-- Hero / Focus Points -->
    <div class="sheet-resources">
      <div class="resource-pip-group" aria-label="Hero Points {vm.heroPoints.value}/{vm.heroPoints.max}">
        {#each { length: vm.heroPoints.max } as _, i}
          <span class="resource-pip" class:resource-pip--filled={i < vm.heroPoints.value} aria-hidden="true"></span>
        {/each}
        <span class="resource-label">HP</span>
      </div>
      {#if vm.focusPoints.max > 0}
        <div class="resource-pip-group" aria-label="Focus Points {vm.focusPoints.value}/{vm.focusPoints.max}">
          {#each { length: vm.focusPoints.max } as _, i}
            <span class="resource-pip resource-pip--focus" class:resource-pip--filled={i < vm.focusPoints.value} aria-hidden="true"></span>
          {/each}
          <span class="resource-label">Focus</span>
        </div>
      {/if}
    </div>
  </header>

  <!-- ---- Ability Scores row ---- -->
  <div class="ability-row" role="list" aria-label="Ability Scores">
    {#each vm.abilities as ability (ability.slug)}
      <div class="ability-block" role="listitem" aria-label="{ability.longLabel} {ability.score}">
        <span class="ability-block__label">{ability.label}</span>
        <span class="ability-block__score">{ability.score}</span>
        <span class="ability-block__mod">{ability.modFormatted}</span>
      </div>
    {/each}
  </div>

  <!-- ---- Saves row ---- -->
  <div class="saves-row" role="list" aria-label="Saving Throws">
    {#each vm.saves as save (save.slug)}
      <button
        class="save-block"
        role="listitem"
        onclick={() => rollSave(save.slug as "fortitude" | "reflex" | "will")}
        aria-label="Roll {save.label} save ({save.totalFormatted})"
      >
        <span class="save-block__mod">{save.totalFormatted}</span>
        <span class="save-block__label">{save.label}</span>
        <span class="save-block__rank" aria-label="Rank: {save.rankLabel}">{save.rankLabel}</span>
      </button>
    {/each}
  </div>

  <!-- ---- Active Conditions ---- -->
  {#if vm.conditions.length > 0}
    <div class="conditions-bar" role="list" aria-label="Active Conditions">
      {#each vm.conditions as cond (cond.itemId)}
        <button
          class="condition-chip"
          role="listitem"
          onclick={() => toggleCondition(cond.slug)}
          aria-label="{cond.label}{cond.value != null ? ' ' + String(cond.value) : ''} — click to remove"
          title="Click to remove {cond.label}"
        >
          {cond.label}{cond.value != null ? ` ${String(cond.value)}` : ""}
          <span class="condition-chip__remove" aria-hidden="true">✕</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- ---- Tab bar ---- -->
  <div class="tab-bar" role="tablist" aria-label="Character sheet sections">
    {#each (["main", "skills", "actions", "spells", "inventory"] as const) as tab}
      <button
        class="tab-btn"
        class:tab-btn--active={activeTab === tab}
        role="tab"
        aria-selected={activeTab === tab}
        aria-controls="tab-panel-{tab}"
        id="tab-{tab}"
        onclick={() => { activeTab = tab; }}
      >
        {tab.charAt(0).toUpperCase() + tab.slice(1)}
      </button>
    {/each}
  </div>

  <!-- ---- Tab panels ---- -->

  <!-- MAIN tab: Speed, Class DC -->
  {#if activeTab === "main"}
    <section
      id="tab-panel-main"
      role="tabpanel"
      aria-labelledby="tab-main"
      class="tab-panel tab-panel--main"
    >
      <div class="stat-row">
        <div class="stat-block">
          <span class="stat-block__value">{vm.speed} ft</span>
          <span class="stat-block__label">Speed</span>
        </div>
        <div class="stat-block">
          <span class="stat-block__value">{vm.perception.totalFormatted}</span>
          <span class="stat-block__label">Perc. ({vm.perception.rankLabel})</span>
        </div>
      </div>
    </section>

  <!-- SKILLS tab -->
  {:else if activeTab === "skills"}
    <section
      id="tab-panel-skills"
      role="tabpanel"
      aria-labelledby="tab-skills"
      class="tab-panel tab-panel--skills"
    >
      <ul class="skill-list" aria-label="Skills">
        {#each vm.skills as skill (skill.slug)}
          <li class="skill-row">
            <span class="skill-row__rank" title={skill.rankLabelFull} aria-label="Rank: {skill.rankLabelFull}">
              {skill.rankLabel}
            </span>
            <button
              class="skill-row__name skill-row__rollable"
              onclick={() => rollSkill(skill.slug)}
              aria-label="Roll {skill.label} ({skill.totalFormatted})"
            >
              {skill.label}
            </button>
            <span class="skill-row__ability">{skill.abilityLabel}</span>
            <span class="skill-row__total">{skill.totalFormatted}</span>
          </li>
        {/each}
      </ul>
    </section>

  <!-- ACTIONS tab: Strikes -->
  {:else if activeTab === "actions"}
    <section
      id="tab-panel-actions"
      role="tabpanel"
      aria-labelledby="tab-actions"
      class="tab-panel tab-panel--actions"
    >
      {#if vm.strikes.length > 0}
        <h3 class="section-header">Strikes</h3>
        <ul class="strike-list" aria-label="Strikes">
          {#each vm.strikes as strike (strike.sourceId)}
            <li class="strike-row">
              <div class="strike-row__header">
                <span class="strike-row__name">{strike.label}</span>
                {#if strike.isRanged}
                  <span class="trait-badge">ranged</span>
                {/if}
                {#if strike.isAgile}
                  <span class="trait-badge">agile</span>
                {/if}
              </div>
              <div class="strike-row__variants" role="group" aria-label="Attack rolls for {strike.label}">
                {#each strike.variants as variant, i}
                  <button
                    class="map-btn"
                    onclick={() => rollStrike(strike.sourceId, i as 0 | 1 | 2)}
                    aria-label="Roll {strike.label} at MAP {String(i)} ({variant.totalFormatted})"
                  >
                    <span class="map-btn__total">{variant.totalFormatted}</span>
                    <span class="map-btn__label">MAP {String(i)}</span>
                  </button>
                {/each}
              </div>
              <div class="strike-row__damage">
                Damage: <span class="damage-formula">{strike.damageFormula}</span>
                <span class="damage-type">{strike.damageType}</span>
              </div>
              {#if strike.traits.length > 0}
                <div class="strike-row__traits">
                  {#each strike.traits as trait}
                    <span class="trait-badge">{trait}</span>
                  {/each}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-state">No strikes available. Equip a weapon.</p>
      {/if}
    </section>

  <!-- SPELLS tab -->
  {:else if activeTab === "spells"}
    <section
      id="tab-panel-spells"
      role="tabpanel"
      aria-labelledby="tab-spells"
      class="tab-panel tab-panel--spells"
    >
      {#if vm.spellcastingEntries.length > 0}
        {#each vm.spellcastingEntries as entry (entry.entryId)}
          <div class="spellcasting-entry">
            <h3 class="spellcasting-entry__header">
              {entry.label}
              <span class="spellcasting-entry__meta">
                {entry.tradition} · {entry.prepared}
              </span>
            </h3>
            <div class="spellcasting-entry__stats">
              <span>DC {entry.spellDC}</span>
              <span>Attack {entry.spellAttackFormatted}</span>
            </div>
          </div>
        {/each}
      {:else}
        <p class="empty-state">No spellcasting entries.</p>
      {/if}
    </section>

  <!-- INVENTORY tab -->
  {:else if activeTab === "inventory"}
    <section
      id="tab-panel-inventory"
      role="tabpanel"
      aria-labelledby="tab-inventory"
      class="tab-panel tab-panel--inventory"
    >
      {#if vm.inventory.length > 0}
        <ul class="inventory-list" aria-label="Inventory">
          {#each vm.inventory as item (item.id)}
            <li class="inventory-row">
              {#if item.img}
                <img class="inventory-row__icon" src={item.img} alt="" width="24" height="24" aria-hidden="true" />
              {/if}
              <span class="inventory-row__name">{item.name}</span>
              <span class="inventory-row__qty">×{item.quantity}</span>
              <span class="inventory-row__bulk">Bulk {String(item.bulk)}</span>
              {#if item.equipped}
                <span class="inventory-row__equipped" aria-label="Equipped">E</span>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-state">Empty inventory.</p>
      {/if}
    </section>
  {/if}

</div>

<style>
  /* ---- Container query: adapt to the window width ---- */
  .pf2e-character-sheet {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-primary, #e0e0ff);
    font-size: 13px;
  }

  /* ---- Header ---- */
  .sheet-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--fusion-color-surface-raised, #16213e);
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
  }

  .sheet-portrait {
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .sheet-header__info {
    flex: 1;
    min-width: 120px;
  }

  .sheet-header__name {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--fusion-color-text-primary, #e0e0ff);
  }

  .sheet-header__subtitle {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    margin-top: 2px;
  }

  /* HP */
  .sheet-hp {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .sheet-hp__label {
    font-size: 10px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .sheet-hp__row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sheet-hp__value {
    width: 44px;
    text-align: center;
    background: var(--fusion-color-surface, #1a1a2e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-color-text-primary, #e0e0ff);
    font-size: 16px;
    font-weight: 700;
    padding: 2px 4px;
  }

  .sheet-hp__value--readonly {
    background: transparent;
    border-color: transparent;
  }

  .sheet-hp__sep {
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .sheet-hp__max,
  .sheet-hp__temp {
    font-size: 14px;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .sheet-hp__temp {
    color: var(--fusion-color-info, #66aaff);
    font-size: 12px;
  }

  .sheet-save-status {
    font-size: 10px;
  }
  .sheet-save-status--saving { color: var(--fusion-color-warning, #ffcc00); }
  .sheet-save-status--saved { color: var(--fusion-color-success, #44cc88); }

  /* Defenses */
  .sheet-defenses {
    display: flex;
    gap: 8px;
  }

  .defense-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 48px;
    padding: 4px 8px;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: var(--fusion-color-surface, #1a1a2e);
    cursor: default;
  }

  .defense-block--rollable {
    cursor: pointer;
    transition: background 0.15s;
  }

  .defense-block--rollable:hover,
  .defense-block--rollable:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .defense-block__value {
    font-size: 16px;
    font-weight: 700;
    line-height: 1;
  }

  .defense-block__label {
    font-size: 9px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
    margin-top: 2px;
  }

  /* Status badges */
  .sheet-status-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    width: 100%;
  }

  .status-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: var(--fusion-radius-sm, 4px);
  }

  .status-badge--dying { background: rgba(200, 40, 40, 0.35); color: #ff8080; }
  .status-badge--wounded { background: rgba(200, 120, 40, 0.35); color: #ffcc88; }
  .status-badge--doomed { background: rgba(100, 40, 140, 0.35); color: #cc88ff; }

  /* Resources */
  .sheet-resources {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .resource-pip-group {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .resource-pip {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: transparent;
    transition: background 0.15s;
  }

  .resource-pip--filled {
    background: var(--fusion-color-accent, #5b8dee);
  }

  .resource-pip--focus {
    border-color: var(--fusion-color-magic, #aa66ff);
  }

  .resource-pip--focus.resource-pip--filled {
    background: var(--fusion-color-magic, #aa66ff);
  }

  .resource-label {
    font-size: 9px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
    margin-left: 2px;
  }

  /* ---- Abilities ---- */
  .ability-row {
    display: flex;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
    background: var(--fusion-color-surface, #1a1a2e);
  }

  .ability-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 2px;
    border-radius: var(--fusion-radius-sm, 4px);
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .ability-block__label {
    font-size: 9px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
  }

  .ability-block__score {
    font-size: 14px;
    font-weight: 700;
    line-height: 1.1;
  }

  .ability-block__mod {
    font-size: 11px;
    color: var(--fusion-color-text-secondary, #b0b0cc);
  }

  /* ---- Saves ---- */
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
    padding: 4px 4px;
    border-radius: var(--fusion-radius-sm, 4px);
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
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

  .save-block__rank {
    font-size: 9px;
    color: var(--fusion-color-accent, #5b8dee);
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
    gap: 4px;
    padding: 2px 6px;
    border-radius: 10px;
    background: rgba(255, 120, 60, 0.25);
    border: 1px solid rgba(255, 120, 60, 0.5);
    color: #ffaa88;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .condition-chip:hover,
  .condition-chip:focus-visible {
    background: rgba(255, 120, 60, 0.4);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .condition-chip__remove {
    font-size: 9px;
    opacity: 0.7;
  }

  /* ---- Tab bar ---- */
  .tab-bar {
    display: flex;
    border-bottom: 2px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
    background: var(--fusion-color-surface-raised, #16213e);
    overflow-x: auto;
  }

  .tab-btn {
    padding: 7px 14px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    color: var(--fusion-color-text-muted, #9999cc);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tab-btn:hover,
  .tab-btn:focus-visible {
    color: var(--fusion-color-text-primary, #e0e0ff);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
    outline-offset: -2px;
  }

  .tab-btn--active {
    color: var(--fusion-color-text-primary, #e0e0ff);
    border-bottom-color: var(--fusion-color-accent, #5b8dee);
  }

  /* ---- Tab panels ---- */
  .tab-panel {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .section-header {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fusion-color-text-muted, #9999cc);
    margin: 0 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  /* Stat row (main tab) */
  .stat-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .stat-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 14px;
    border-radius: var(--fusion-radius-sm, 4px);
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .stat-block__value {
    font-size: 16px;
    font-weight: 700;
  }

  .stat-block__label {
    font-size: 10px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
  }

  /* Skills */
  .skill-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .skill-row {
    display: grid;
    grid-template-columns: 20px 1fr 40px 44px;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    border-radius: var(--fusion-radius-sm, 4px);
  }

  .skill-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .skill-row__rank {
    font-size: 10px;
    font-weight: 700;
    color: var(--fusion-color-accent, #5b8dee);
    text-align: center;
  }

  .skill-row__rollable {
    background: transparent;
    border: none;
    text-align: left;
    color: var(--fusion-color-text-primary, #e0e0ff);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
  }

  .skill-row__rollable:hover,
  .skill-row__rollable:focus-visible {
    color: var(--fusion-color-accent, #5b8dee);
    text-decoration: underline;
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .skill-row__ability {
    font-size: 10px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-align: center;
  }

  .skill-row__total {
    font-size: 12px;
    font-weight: 600;
    text-align: right;
  }

  /* Strikes */
  .strike-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .strike-row {
    padding: 8px 10px;
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .strike-row__header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .strike-row__name {
    font-size: 13px;
    font-weight: 600;
  }

  .strike-row__variants {
    display: flex;
    gap: 6px;
  }

  .map-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 10px;
    background: var(--fusion-color-surface, #1a1a2e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    cursor: pointer;
    transition: background 0.15s;
    min-width: 54px;
  }

  .map-btn:hover,
  .map-btn:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .map-btn__total {
    font-size: 14px;
    font-weight: 700;
    color: var(--fusion-color-text-primary, #e0e0ff);
  }

  .map-btn__label {
    font-size: 9px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
  }

  .strike-row__damage {
    font-size: 12px;
    color: var(--fusion-color-text-secondary, #b0b0cc);
  }

  .damage-formula {
    font-family: var(--fusion-font-mono, monospace);
    color: var(--fusion-color-text-primary, #e0e0ff);
  }

  .damage-type {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    margin-left: 2px;
  }

  .strike-row__traits {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .trait-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(91, 141, 238, 0.15);
    border: 1px solid rgba(91, 141, 238, 0.3);
    color: #8ab0f0;
  }

  /* Spellcasting */
  .spellcasting-entry {
    margin-bottom: 12px;
    padding: 8px 10px;
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
  }

  .spellcasting-entry__header {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .spellcasting-entry__meta {
    font-size: 11px;
    font-weight: 400;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .spellcasting-entry__stats {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: var(--fusion-color-text-secondary, #b0b0cc);
  }

  /* Inventory */
  .inventory-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .inventory-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: var(--fusion-radius-sm, 4px);
  }

  .inventory-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .inventory-row__icon {
    width: 22px;
    height: 22px;
    object-fit: cover;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .inventory-row__name {
    flex: 1;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inventory-row__qty {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    min-width: 24px;
    text-align: right;
  }

  .inventory-row__bulk {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    min-width: 44px;
    text-align: right;
  }

  .inventory-row__equipped {
    font-size: 10px;
    font-weight: 700;
    color: var(--fusion-color-success, #44cc88);
    min-width: 12px;
  }

  /* Empty state */
  .empty-state {
    color: var(--fusion-color-text-muted, #9999cc);
    font-size: 12px;
    text-align: center;
    padding: 24px 0;
  }

  /* ---- Container query: narrow layout (<400px) ---- */
  @container (max-width: 400px) {
    .ability-row {
      gap: 2px;
    }

    .ability-block {
      padding: 3px 1px;
    }

    .tab-btn {
      padding: 6px 8px;
      font-size: 11px;
    }

    .skill-row {
      grid-template-columns: 18px 1fr 32px 38px;
    }
  }
</style>
