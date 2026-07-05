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
   *
   * NOTE: no `socket` prop — the Spells tab's compendium picker resolves the
   * LIVE socket itself via getSocket() (frozen-socket fix: componentProps are
   * captured once at window-open time and outlive socket reconnects, so a
   * prop-passed Socket reference goes stale). A caller-provided `socket` in
   * componentProps is simply ignored.
   */

  import { CharacterSheetVM } from "$lib/sheets/pf2e/characterSheetVM.js";
  import type { ChatRollPayload, DocUpdatePayload, DocOpPayload, CharacterSheetTab } from "$lib/sheets/pf2e/characterSheetVM.js";
  import { worldMirror } from "$lib/docs/worldSync.js";
  import SpellsTab from "./SpellsTab.svelte";
  import ProficiencyBadge from "./ProficiencyBadge.svelte";
  import PlanColumn from "./plan/PlanColumn.svelte";
  import { t } from "$lib/i18n/i18n.js";

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  interface Props {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    userId: string;
    isGm: boolean;
    worldId?: string;
    sendOpFn?: (op: ChatRollPayload | DocOpPayload) => void;
  }

  let {
    doc,
    actorId,
    ownership,
    userId,
    isGm,
    worldId = "",
    sendOpFn = () => {},
  }: Props = $props();

  // ---------------------------------------------------------------------------
  // Reactivity (REQ-UIF-025) — the sheet must react to doc:update broadcasts
  // that arrive after the window was opened, not just render a frozen
  // snapshot captured at open time (WindowHost stores componentProps once).
  // liveDoc starts as the initial doc and is refreshed from worldMirror
  // whenever an Actor document batch changes; vm is re-derived from liveDoc.
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
  // View-model — recreated whenever the live document changes
  // ---------------------------------------------------------------------------

  const vm = $derived(
    new CharacterSheetVM({ doc: liveDoc, actorId, ownership, userId, isGm, worldId }),
  );

  // ---------------------------------------------------------------------------
  // Tab state
  // ---------------------------------------------------------------------------

  let activeTab = $state<CharacterSheetTab>("main");

  // ---------------------------------------------------------------------------
  // Play / Edit mode toggle (REQ-UIF-023) — local UI state, does not persist.
  // ---------------------------------------------------------------------------

  let editMode = $state(false);

  // ---------------------------------------------------------------------------
  // Plan column visibility (DEC-R10-05) — local UI state, does not persist.
  // The column is navigable regardless of editMode; only its write actions
  // are gated by vm.editable (ownership), not by the Play/Edit toggle.
  // ---------------------------------------------------------------------------

  let planVisible = $state(true);

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

  function rollStrikeDamage(sourceId: string, crit: boolean): void {
    const op = vm.rollStrikeDamage(sourceId, crit);
    if (op) sendOpFn(op);
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

  // ---------------------------------------------------------------------------
  // Hero / Focus points — clickable pips
  // ---------------------------------------------------------------------------

  function clickHeroPip(index: number): void {
    // index is 0-based; clicking pip N sets value to N+1, unless that pip is
    // already the highest filled one, in which case it decrements to N.
    const current = vm.heroPoints.value;
    const newValue = index + 1 === current ? index : index + 1;
    const op = vm.setHeroPoints(newValue);
    if (op) scheduleUpdate(op);
  }

  function clickFocusPip(index: number): void {
    const current = vm.focusPoints.value;
    const newValue = index + 1 === current ? index : index + 1;
    const op = vm.setFocusPoints(newValue);
    if (op) scheduleUpdate(op);
  }

  // ---------------------------------------------------------------------------
  // Edit-mode field handlers (REQ-UIF-023)
  // ---------------------------------------------------------------------------

  function handleNameInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    scheduleUpdate(vm.updateName(input.value));
  }

  function handleLevelInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateLevel(val));
  }

  function handleSpeedInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateSpeed(val));
  }

  function handleHpMaxInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateHpMax(val));
  }

  function handleAbilityScoreInput(slug: string, e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateAbilityScore(slug, val));
  }

  function handleSaveRankChange(name: "fortitude" | "reflex" | "will", e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    const val = parseInt(select.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateSaveRank(name, val));
  }

  function handlePerceptionRankChange(e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    const val = parseInt(select.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updatePerceptionRank(val));
  }

  function handleSkillRankChange(slug: string, e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    const val = parseInt(select.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.updateSkillRank(slug, val));
  }

  function handleHeroMaxInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.fieldUpdate("system.resources.heroPoints.max", val));
  }

  function handleHeroValueInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.setHeroPoints(val));
  }

  function handleFocusMaxInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.fieldUpdate("system.resources.focusPoints.max", val));
  }

  function handleFocusValueInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!Number.isNaN(val)) scheduleUpdate(vm.setFocusPoints(val));
  }

  // TEML rank options shared by the Saves/Perception/Skills edit selects.
  const RANK_OPTIONS = [
    { value: 0, label: "U" },
    { value: 1, label: "T" },
    { value: 2, label: "E" },
    { value: 3, label: "M" },
    { value: 4, label: "L" },
  ];
</script>

<!-- ======================================================================
  Character Sheet
  REQ-UIF-061: container queries for responsive layout within the window.
  DEC-R10-05: the Plan column sits to the left of the sheet body, always
  navigable (editMode does not hide it) — only its write actions require
  vm.editable. "Ocultar plano"/"Mostrar plano" is local UI state, not
  persisted.
====================================================================== -->
<div class="pf2e-sheet-shell">
  {#if planVisible}
    <PlanColumn
      doc={liveDoc}
      {actorId}
      editable={vm.editable}
      sendOpFn={(op) => sendOpFn(op)}
      onHide={() => { planVisible = false; }}
    />
  {/if}

  <div class="pf2e-sheet pf2e-character-sheet" role="document" aria-label="Character Sheet: {vm.name}">

  <!-- ---- Header ---- -->
  <header class="sheet-header">
    {#if !planVisible}
      <button type="button" class="show-plan-btn" onclick={() => { planVisible = true; }}>
        {t("FUSION.Sheet.Plan.Show")}
      </button>
    {/if}
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

    <!-- Play/Edit toggle (REQ-UIF-023) — visible only to editors; local UI state -->
    {#if vm.editable}
      <button
        class="mode-toggle"
        aria-pressed={editMode}
        aria-label={editMode ? "Switch to Play mode" : "Switch to Edit mode"}
        onclick={() => { editMode = !editMode; }}
      >
        {editMode ? "Play" : "Edit"}
      </button>
    {/if}

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
          <button
            class="resource-pip"
            class:resource-pip--filled={i < vm.heroPoints.value}
            title="Set Hero Points to {i < vm.heroPoints.value ? i : i + 1}"
            aria-label="Hero point {i + 1}"
            onclick={() => clickHeroPip(i)}
          ></button>
        {/each}
        <span class="resource-label">HP</span>
      </div>
      {#if vm.focusPoints.max > 0 || vm.focusPoints.value > 0}
        <!-- Focus pips always render up to the DEC-R10-02 hard cap (3), even
             when the character's current max is lower — pips beyond `max`
             render locked/hatched (unclickable), matching the design
             contract's PipRow "locked" state (guidelines/pips.card.html). -->
        <div class="resource-pip-group" aria-label="Focus Points {vm.focusPoints.value}/{vm.focusPoints.max}">
          {#each { length: 3 } as _, i}
            {#if i < vm.focusPoints.max}
              <button
                class="resource-pip resource-pip--focus"
                class:resource-pip--filled={i < vm.focusPoints.value}
                title="Set Focus Points to {i < vm.focusPoints.value ? i : i + 1}"
                aria-label="Focus point {i + 1}"
                onclick={() => clickFocusPip(i)}
              ></button>
            {:else}
              <span
                class="resource-pip resource-pip--focus resource-pip--locked"
                title="Beyond your current Focus Points maximum"
                aria-label="Focus point {i + 1} (locked)"
              ></span>
            {/if}
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
    {#each (["main", "skills", "actions", "spells", "inventory", "feats", "bio"] as const) as tab}
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

  <!-- MAIN tab: Speed, Class DC, Spell DC, Senses -->
  {#if activeTab === "main"}
    <section
      id="tab-panel-main"
      role="tabpanel"
      aria-labelledby="tab-main"
      class="tab-panel tab-panel--main"
    >
      {#if editMode}
        <div class="edit-field">
          <label for="edit-name-{actorId}">Name</label>
          <input id="edit-name-{actorId}" type="text" value={vm.name} oninput={handleNameInput} />
        </div>
        <div class="edit-field-row">
          <div class="edit-field">
            <label for="edit-level-{actorId}">Level</label>
            <input id="edit-level-{actorId}" type="number" min="1" max="20" value={vm.level} oninput={handleLevelInput} />
          </div>
          <div class="edit-field">
            <label for="edit-speed-{actorId}">Speed</label>
            <input id="edit-speed-{actorId}" type="number" min="0" value={vm.speed} oninput={handleSpeedInput} />
          </div>
          <div class="edit-field">
            <label for="edit-hpmax-{actorId}">HP Max</label>
            <input id="edit-hpmax-{actorId}" type="number" min="0" value={vm.hpMax} oninput={handleHpMaxInput} />
          </div>
        </div>

        <h3 class="section-header">Abilities</h3>
        <div class="edit-field-row edit-field-row--abilities">
          {#each vm.abilities as ability (ability.slug)}
            <div class="edit-field">
              <label for="edit-ability-{ability.slug}-{actorId}">{ability.label}</label>
              <input
                id="edit-ability-{ability.slug}-{actorId}"
                type="number"
                value={ability.score}
                oninput={(e) => handleAbilityScoreInput(ability.slug, e)}
              />
            </div>
          {/each}
        </div>

        <h3 class="section-header">Saves &amp; Perception</h3>
        <div class="edit-field-row">
          {#each vm.saves as save (save.slug)}
            <div class="edit-field">
              <label for="edit-save-{save.slug}-{actorId}">{save.label}</label>
              <select
                id="edit-save-{save.slug}-{actorId}"
                value={save.rank}
                onchange={(e) => handleSaveRankChange(save.slug as "fortitude" | "reflex" | "will", e)}
              >
                {#each RANK_OPTIONS as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
          {/each}
          <div class="edit-field">
            <label for="edit-perception-{actorId}">Perception</label>
            <select id="edit-perception-{actorId}" value={vm.perception.rank} onchange={handlePerceptionRankChange}>
              {#each RANK_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <h3 class="section-header">Resources</h3>
        <div class="edit-field-row">
          <div class="edit-field">
            <label for="edit-hero-value-{actorId}">Hero Points</label>
            <input id="edit-hero-value-{actorId}" type="number" min="0" value={vm.heroPoints.value} oninput={handleHeroValueInput} />
          </div>
          <div class="edit-field">
            <label for="edit-hero-max-{actorId}">Hero Max</label>
            <input id="edit-hero-max-{actorId}" type="number" min="0" value={vm.heroPoints.max} oninput={handleHeroMaxInput} />
          </div>
          <div class="edit-field">
            <label for="edit-focus-value-{actorId}">Focus Points</label>
            <input id="edit-focus-value-{actorId}" type="number" min="0" value={vm.focusPoints.value} oninput={handleFocusValueInput} />
          </div>
          <div class="edit-field">
            <label for="edit-focus-max-{actorId}">Focus Max</label>
            <input id="edit-focus-max-{actorId}" type="number" min="0" value={vm.focusPoints.max} oninput={handleFocusMaxInput} />
          </div>
        </div>
      {:else}
        <div class="stat-row">
          <div class="stat-block">
            <span class="stat-block__value">{vm.speed} ft</span>
            <span class="stat-block__label">Speed</span>
          </div>
          <div class="stat-block">
            <span class="stat-block__value">{vm.perception.totalFormatted}</span>
            <span class="stat-block__label">Perc. ({vm.perception.rankLabel})</span>
          </div>
          <div class="stat-block">
            <span class="stat-block__value">{vm.classDC.dc}</span>
            <span class="stat-block__label">Class DC</span>
          </div>
          {#if vm.spellcastingEntries.length > 0}
            <div class="stat-block">
              <span class="stat-block__value">{vm.spellcastingEntries[0]!.spellDC}</span>
              <span class="stat-block__label">Spell DC</span>
            </div>
          {/if}
        </div>
        {#if vm.senses.length > 0}
          <div class="senses-row" aria-label="Senses">
            <span class="senses-row__label">Senses:</span>
            <span class="senses-row__value">{vm.senses.join(", ")}</span>
          </div>
        {/if}
      {/if}
    </section>

  <!-- SKILLS tab -->
  {:else if activeTab === "skills"}
    <section
      id="tab-panel-skills"
      role="tabpanel"
      aria-labelledby="tab-skills"
      class="tab-panel tab-panel--skills"
    >
      {#if editMode}
        <ul class="skill-list" aria-label="Skills">
          {#each vm.skills as skill (skill.slug)}
            <li class="skill-row skill-row--edit">
              <span class="skill-row__name">{skill.label}</span>
              <select
                aria-label="{skill.label} rank"
                value={skill.rank}
                onchange={(e) => handleSkillRankChange(skill.slug, e)}
              >
                {#each RANK_OPTIONS as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </li>
          {/each}
        </ul>
      {:else}
        <!-- All 16 canonical skills + lores, untrained included (feedback item
             2 / DEC-R10-07) — every row stays clickable via rollSkill,
             untrained rows just get a slightly reduced opacity so the eye
             still lands on trained+ skills first. -->
        <ul class="skill-list" aria-label="Skills">
          {#each vm.skills as skill (skill.slug)}
            <li class="skill-row" class:skill-row--untrained={skill.rank === 0}>
              <ProficiencyBadge rank={skill.rankLabel as "U" | "T" | "E" | "M" | "L"} size={18} title={skill.rankLabelFull} />
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
      {/if}
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
                {#if vm.rollStrikeDamage(strike.sourceId, false)}
                  <button
                    class="map-btn map-btn--damage"
                    onclick={() => rollStrikeDamage(strike.sourceId, false)}
                    aria-label="Roll {strike.label} damage"
                  >
                    <span class="map-btn__label">Damage</span>
                  </button>
                {/if}
                {#if vm.rollStrikeDamage(strike.sourceId, true)}
                  <button
                    class="map-btn map-btn--crit"
                    onclick={() => rollStrikeDamage(strike.sourceId, true)}
                    aria-label="Roll {strike.label} critical damage"
                  >
                    <span class="map-btn__label">Crit</span>
                  </button>
                {/if}
              </div>
              <div class="strike-row__damage">
                <!-- damageFormula already ends with the damage type word -->
                Damage: <span class="damage-formula">{strike.damageFormula}</span>
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

  <!-- SPELLS tab (DEC-R10-03/04) -->
  {:else if activeTab === "spells"}
    <section
      id="tab-panel-spells"
      role="tabpanel"
      aria-labelledby="tab-spells"
      class="tab-panel tab-panel--spells"
    >
      <SpellsTab {vm} sendOpFn={(op) => sendOpFn(op as ChatRollPayload | DocOpPayload)} />
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

  <!-- FEATS tab -->
  {:else if activeTab === "feats"}
    <section
      id="tab-panel-feats"
      role="tabpanel"
      aria-labelledby="tab-feats"
      class="tab-panel tab-panel--feats"
    >
      {#if vm.feats.length > 0}
        <ul class="feat-list" aria-label="Feats">
          {#each vm.feats as feat (feat.id)}
            <li class="feat-row">
              <span class="feat-row__name">{feat.name}</span>
              <span class="trait-badge">{feat.subtype}</span>
              {#if feat.level != null}
                <span class="feat-row__level">Lvl {feat.level}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-state">No feats.</p>
      {/if}
    </section>

  <!-- BIO tab -->
  {:else if activeTab === "bio"}
    <section
      id="tab-panel-bio"
      role="tabpanel"
      aria-labelledby="tab-bio"
      class="tab-panel tab-panel--bio"
    >
      <div class="bio-details">
        <div class="bio-details__row"><strong>Ancestry:</strong> {vm.detailsInfo.ancestry || "—"}</div>
        <div class="bio-details__row"><strong>Background:</strong> {vm.detailsInfo.background || "—"}</div>
        <div class="bio-details__row"><strong>Class:</strong> {vm.detailsInfo.class || "—"}</div>
        <div class="bio-details__row"><strong>Key Ability:</strong> {vm.detailsInfo.keyAbility || "—"}</div>
      </div>
      <p class="bio-text">{vm.biography}</p>
    </section>
  {/if}

  </div>
</div>

<style>
  /* ---- Shell: Plan column + sheet body side by side (DEC-R10-05) ---- */
  .pf2e-sheet-shell {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  .show-plan-btn {
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-secondary, #b0b0cc);
    cursor: pointer;
    flex-shrink: 0;
  }

  .show-plan-btn:hover,
  .show-plan-btn:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  /* ---- Container query: adapt to the window width ---- */
  .pf2e-character-sheet {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    flex: 1;
    min-width: 0;
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

  .resource-pip--locked {
    cursor: default;
    opacity: 0.4;
    background: repeating-linear-gradient(
      45deg,
      var(--fusion-surface-alt),
      var(--fusion-surface-alt) 2px,
      transparent 2px,
      transparent 4px
    );
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

  .skill-row--untrained {
    opacity: 0.82;
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

  /* ---- Play/Edit toggle ---- */
  .mode-toggle {
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-secondary, #b0b0cc);
    cursor: pointer;
    transition: background 0.15s;
    flex-shrink: 0;
  }

  .mode-toggle:hover,
  .mode-toggle:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: 2px solid var(--fusion-color-focus, #5b8dee);
  }

  .mode-toggle[aria-pressed="true"] {
    background: var(--fusion-color-accent, #5b8dee);
    color: #fff;
    border-color: var(--fusion-color-accent, #5b8dee);
  }

  /* ---- Edit-mode fields (main tab) ---- */
  .edit-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 64px;
  }

  .edit-field label {
    font-size: 10px;
    color: var(--fusion-color-text-muted, #9999cc);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .edit-field input,
  .edit-field select {
    background: var(--fusion-color-surface, #1a1a2e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-color-text-primary, #e0e0ff);
    font-size: 12px;
    padding: 4px 6px;
  }

  .edit-field-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
  }

  .edit-field-row--abilities {
    gap: 6px;
  }

  .skill-row--edit {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 4px;
  }

  .skill-row--edit select {
    background: var(--fusion-color-surface, #1a1a2e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-color-text-primary, #e0e0ff);
    font-size: 11px;
    padding: 2px 4px;
  }

  /* ---- Senses row (main tab) ---- */
  .senses-row {
    margin-top: 8px;
    font-size: 12px;
    color: var(--fusion-color-text-secondary, #b0b0cc);
  }

  .senses-row__label {
    color: var(--fusion-color-text-muted, #9999cc);
    margin-right: 4px;
  }

  /* ---- Strike damage/crit buttons ---- */
  .map-btn--damage,
  .map-btn--crit {
    min-width: 44px;
  }

  .map-btn--crit .map-btn__label {
    color: var(--fusion-color-warning, #ffcc00);
  }

  /* ---- Feats tab ---- */
  .feat-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .feat-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
  }

  .feat-row__name {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
  }

  .feat-row__level {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  /* ---- Bio tab ---- */
  .bio-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
    font-size: 12px;
  }

  .bio-details__row strong {
    color: var(--fusion-color-text-muted, #9999cc);
    margin-right: 4px;
  }

  .bio-text {
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
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
