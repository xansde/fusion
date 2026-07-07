<script lang="ts">
  /**
   * PetCard.svelte — one linked familiar in the Pets tab (spec 29 r16-G4).
   *
   * Shows the familiar's name (editable), an orphan warning when its master
   * link is dangling, the derived statblock (HP editable by the owner, AC,
   * Perception, saves, attack, speeds), the daily-ability chips, and actions
   * (open mini-sheet, remove). The ability picker (FamiliarAbilityPicker)
   * expands inline; it enforces the derived slot budget.
   *
   * Clean-room: remaster (ORC) mechanics only.
   */

  import { t, i18n } from "$lib/i18n/i18n.js";
  import { getSocket } from "$lib/session.svelte.js";
  import {
    buildSetHpOp,
    buildRenameOp,
    buildSetAppearanceOp,
    loadAbilityEntries,
    toAbilityRow,
    classifyAbilitiesLoadError,
    type LinkedFamiliar,
    type AbilityRow,
    type AbilitiesLoadError,
    type UpdateFamiliarOp,
  } from "$lib/sheets/pf2e/petsVM.js";
  import FamiliarAbilityPicker from "./FamiliarAbilityPicker.svelte";
  import ActorPortrait from "../../../common/ActorPortrait.svelte";

  interface Props {
    familiar: LinkedFamiliar;
    editable: boolean;
    systemId: string;
    /** Raw img path from the familiar Actor doc (LinkedFamiliar omits it). */
    img?: string | null;
    onOpenSheet: () => void;
    onRemove: () => void;
    onOp: (op: UpdateFamiliarOp) => void;
  }

  let { familiar, editable, systemId, img = null, onOpenSheet, onRemove, onOp }: Props = $props();

  let editingName = $state(false);
  let nameDraft = $state("");
  let showPicker = $state(false);

  // --- Ability pack rows (shared by the picker + the collapsed chips) -------
  let abilityRows = $state<AbilityRow[]>([]);
  let abilitiesLoading = $state(false);
  let abilitiesError = $state<AbilitiesLoadError>(null);

  async function loadRows(): Promise<void> {
    if (abilityRows.length > 0 || abilitiesLoading) return;
    abilitiesLoading = true;
    abilitiesError = null;
    try {
      const entries = await loadAbilityEntries(getSocket, systemId);
      abilityRows = entries.map((e) => toAbilityRow(e, i18n.locale));
    } catch (err) {
      abilitiesError = classifyAbilitiesLoadError(err);
    } finally {
      abilitiesLoading = false;
    }
  }

  // Load lazily on first mount so the chips can show translated names.
  $effect(() => {
    void loadRows();
  });

  const nameBySlug = $derived.by((): Map<string, string> => {
    const m = new Map<string, string>();
    for (const r of abilityRows) m.set(r.slug, r.name);
    return m;
  });

  function chipName(slug: string): string {
    return nameBySlug.get(slug) ?? slug;
  }

  function fmtMod(n: number): string {
    return n >= 0 ? `+${n}` : `${n}`;
  }

  function startRename(): void {
    nameDraft = familiar.name;
    editingName = true;
  }

  function commitRename(): void {
    if (nameDraft.trim() && nameDraft.trim() !== familiar.name) {
      onOp(buildRenameOp(familiar, nameDraft));
    }
    editingName = false;
  }

  function onHpInput(e: Event): void {
    const raw = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(raw)) onOp(buildSetHpOp(familiar, raw));
  }

  function onAppearanceChange(e: Event): void {
    onOp(buildSetAppearanceOp(familiar, (e.target as HTMLInputElement).value));
  }

  const slotsUsed = $derived(familiar.selectedAbilities.length);
  const slotsMax = $derived(familiar.abilitiesBudget.max);
</script>

<div class="pet-card" class:pet-card--orphan={familiar.orphaned}>
  <header class="pet-card__header">
    <div class="pet-card__ident">
      <ActorPortrait {img} name={familiar.name} size={40} />
      <div class="pet-card__title">
      {#if editingName && editable}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="pet-card__name-input"
          type="text"
          bind:value={nameDraft}
          maxlength="60"
          autofocus
          onblur={commitRename}
          onkeydown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") editingName = false; }}
        />
      {:else}
        <button
          class="pet-card__name"
          disabled={!editable}
          onclick={startRename}
          title={editable ? t("FUSION.Sheet.Pets.RenameHint") : ""}
        >
          {familiar.name}
        </button>
      {/if}
      <span class="pet-card__kind">{t(`FUSION.Sheet.Pets.Kind.${familiar.companionKind}`)}</span>
      </div>
    </div>
    <div class="pet-card__actions">
      <button class="pet-icon-btn" onclick={onOpenSheet} title={t("FUSION.Sheet.Pets.OpenSheet")}>
        <span aria-hidden="true">⤢</span>
      </button>
      {#if editable}
        <button class="pet-icon-btn pet-icon-btn--danger" onclick={onRemove} title={t("FUSION.Sheet.Pets.Remove")}>
          <span aria-hidden="true">✕</span>
        </button>
      {/if}
    </div>
  </header>

  {#if familiar.orphaned}
    <p class="pet-card__orphan">{t("FUSION.Sheet.Pets.Orphan")}</p>
  {/if}

  {#if editable}
    <label class="pet-card__appearance">
      <span class="pet-card__appearance-label">{t("FUSION.Sheet.Pets.AppearanceLabel")}</span>
      <input
        class="pet-card__appearance-input"
        type="text"
        value={familiar.appearance}
        maxlength="120"
        placeholder={t("FUSION.Sheet.Pets.AppearancePlaceholder")}
        onchange={onAppearanceChange}
      />
    </label>
  {:else if familiar.appearance}
    <p class="pet-card__appearance-ro">{familiar.appearance}</p>
  {/if}

  <!-- Statblock -->
  <div class="pet-stats">
    <div class="pet-stat pet-stat--hp">
      <span class="pet-stat__label">{t("FUSION.Sheet.Pets.HP")}</span>
      <span class="pet-stat__value">
        {#if editable}
          <input
            class="pet-hp-input"
            type="number"
            min="0"
            max={familiar.hp.max}
            value={familiar.hp.value}
            onchange={onHpInput}
          />
        {:else}
          {familiar.hp.value}
        {/if}
        <span class="pet-stat__sep">/ {familiar.hp.max}</span>
      </span>
    </div>
    <div class="pet-stat">
      <span class="pet-stat__label">{t("FUSION.Sheet.Pets.AC")}</span>
      <span class="pet-stat__value">{familiar.ac}</span>
    </div>
    <div class="pet-stat">
      <span class="pet-stat__label">{t("FUSION.Sheet.Pets.Perception")}</span>
      <span class="pet-stat__value">{fmtMod(familiar.perception)}</span>
    </div>
    <div class="pet-stat">
      <span class="pet-stat__label">{t("FUSION.Sheet.Pets.Attack")}</span>
      <span class="pet-stat__value">{fmtMod(familiar.attack)}</span>
    </div>
    <div class="pet-stat">
      <span class="pet-stat__label">{t("FUSION.Sheet.Labels.Saves.Fort")}</span>
      <span class="pet-stat__value">{fmtMod(familiar.saves.fortitude)}</span>
    </div>
    <div class="pet-stat">
      <span class="pet-stat__label">{t("FUSION.Sheet.Labels.Saves.Ref")}</span>
      <span class="pet-stat__value">{fmtMod(familiar.saves.reflex)}</span>
    </div>
    <div class="pet-stat">
      <span class="pet-stat__label">{t("FUSION.Sheet.Labels.Saves.Will")}</span>
      <span class="pet-stat__value">{fmtMod(familiar.saves.will)}</span>
    </div>
    <div class="pet-stat">
      <span class="pet-stat__label">{t("FUSION.Sheet.Pets.Speed")}</span>
      <span class="pet-stat__value">
        {familiar.speed} {t("FUSION.Sheet.Pets.Feet")}
        {#each familiar.otherSpeeds as sp}
          <span class="pet-stat__other">· {sp.type} {sp.value}</span>
        {/each}
      </span>
    </div>
  </div>

  <!-- Daily abilities -->
  <div class="pet-abilities">
    <div class="pet-abilities__head">
      <span class="pet-abilities__title">
        {t("FUSION.Sheet.Pets.Abilities")}
        <span class="pet-abilities__count" class:pet-abilities__count--full={slotsUsed >= slotsMax}>
          {slotsUsed}/{slotsMax}
        </span>
      </span>
      {#if editable}
        <button
          class="pet-abilities__edit"
          class:pet-abilities__edit--active={showPicker}
          onclick={() => { showPicker = !showPicker; }}
        >
          {showPicker ? t("FUSION.Sheet.Pets.Done") : t("FUSION.Sheet.Pets.ChooseAbilities")}
        </button>
      {/if}
    </div>

    {#if showPicker && editable}
      <FamiliarAbilityPicker
        {familiar}
        rows={abilityRows}
        loading={abilitiesLoading}
        error={abilitiesError}
        onRetry={() => void loadRows()}
        onOp={onOp}
      />
    {:else if familiar.selectedAbilities.length > 0}
      <div class="pet-ability-chips">
        {#each familiar.selectedAbilities as slug (slug)}
          <span class="pet-ability-chip">{chipName(slug)}</span>
        {/each}
      </div>
    {:else}
      <p class="pet-abilities__empty">{t("FUSION.Sheet.Pets.NoAbilities")}</p>
    {/if}
  </div>
</div>

<style>
  .pet-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    border-radius: var(--fusion-radius);
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt);
  }

  .pet-card--orphan {
    border-color: var(--fusion-danger);
  }

  .pet-card__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .pet-card__ident {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .pet-card__title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .pet-card__name {
    font-size: 15px;
    font-weight: 700;
    font-family: var(--fusion-font);
    color: var(--fusion-text);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }

  .pet-card__name:disabled {
    cursor: default;
  }

  .pet-card__name:hover:not(:disabled) {
    color: var(--fusion-accent);
  }

  .pet-card__name-input {
    font-size: 15px;
    font-weight: 700;
    font-family: var(--fusion-font);
    color: var(--fusion-text);
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-sm);
    padding: 2px 6px;
  }

  .pet-card__kind {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    padding: 2px 7px;
    border-radius: var(--fusion-radius-pill);
  }

  .pet-card__actions {
    display: flex;
    gap: 5px;
    flex-shrink: 0;
  }

  .pet-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 13px;
    transition: border-color 0.12s, color 0.12s;
  }

  .pet-icon-btn:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .pet-icon-btn--danger:hover {
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .pet-card__orphan {
    margin: 0;
    font-size: 11.5px;
    color: var(--fusion-danger);
  }

  .pet-card__appearance {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .pet-card__appearance-label {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--fusion-text-muted);
  }

  .pet-card__appearance-input {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 5px 9px;
    color: var(--fusion-text);
    font-size: 12.5px;
    font-family: var(--fusion-font);
    outline: none;
  }

  .pet-card__appearance-input:focus {
    border-color: var(--fusion-accent);
  }

  .pet-card__appearance-ro {
    margin: 0;
    font-size: 12.5px;
    font-style: italic;
    color: var(--fusion-text-muted);
  }

  /* Statblock */
  .pet-stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 8px;
  }

  .pet-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
  }

  .pet-stat__label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-subtle);
  }

  .pet-stat__value {
    font-size: 14px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--fusion-text);
    display: flex;
    align-items: baseline;
    gap: 4px;
  }

  .pet-stat__sep {
    font-size: 11px;
    font-weight: 500;
    color: var(--fusion-text-subtle);
  }

  .pet-stat__other {
    font-size: 10px;
    font-weight: 500;
    color: var(--fusion-text-subtle);
  }

  .pet-hp-input {
    width: 42px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 1px 4px;
    color: var(--fusion-text);
    font-size: 14px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
    outline: none;
  }

  .pet-hp-input:focus {
    border-color: var(--fusion-accent);
  }

  /* Abilities */
  .pet-abilities {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--fusion-border);
    padding-top: 10px;
  }

  .pet-abilities__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .pet-abilities__title {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pet-abilities__count {
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-pill);
    padding: 1px 6px;
  }

  .pet-abilities__count--full {
    color: var(--fusion-accent);
    border-color: var(--fusion-accent);
  }

  .pet-abilities__edit {
    font-family: var(--fusion-font);
    font-weight: 600;
    font-size: 11px;
    cursor: pointer;
    padding: 4px 10px;
    border-radius: var(--fusion-radius-pill);
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }

  .pet-abilities__edit:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .pet-abilities__edit--active {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .pet-ability-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .pet-ability-chip {
    font-size: 11px;
    font-weight: 600;
    color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-pill);
    padding: 2px 9px;
  }

  .pet-abilities__empty {
    margin: 0;
    font-size: 11.5px;
    color: var(--fusion-text-subtle);
  }
</style>
