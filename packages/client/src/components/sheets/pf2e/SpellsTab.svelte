<script lang="ts">
  /**
   * SpellsTab.svelte — Spells tab body (DEC-R10-03, DEC-R10-04).
   *
   * Ports the design contract's MagiasTab.jsx
   * (.fusion-build/r10-design/claude-design/ui_kits/ficha-pf2e/MagiasTab.jsx)
   * to Svelte 5. Sub-tabs come from vm.spellTabs (one per non-focus
   * spellcasting entry + a collapsed "Focus" tab + a conditional "Rituals"
   * tab). Renders:
   *   - "entry" tab: stats bar (DC/Attack/Tradition/Ability/Proficiency),
   *     cantrips row, ranked slots (prepared/empty-dashed/expended states
   *     with Lançar/Trocar/Gastar), grimoire list with "+ Adicionar magia".
   *   - "focus" tab: focus pips (cap 3, DEC-R10-02) + focus spell(s) with Lançar.
   *   - "rituals" tab: empty state (REQ-PF2-087 is V2).
   *
   * Item ops (add/remove/prepare/unprepare/expend) are sent IMMEDIATELY (no
   * debounce) via sendOpFn — unlike field autosave, there's no "typing" to
   * coalesce and the UI needs instant feedback for slot state.
   */

  import type { Socket } from "socket.io-client";
  import type { CharacterSheetVM, SpellTabRow, SpellcastingEntryRow } from "../../../lib/sheets/pf2e/characterSheetVM.js";
  import ProficiencyBadge from "./ProficiencyBadge.svelte";
  import SpellPickerDialog from "./SpellPickerDialog.svelte";
  import { t } from "../../../lib/i18n/i18n.js";

  interface Props {
    vm: CharacterSheetVM;
    socket?: Socket | undefined;
    sendOpFn: (op: unknown) => void;
  }

  let { vm, socket, sendOpFn }: Props = $props();

  let activeTabKey = $state<string | null>(null);

  const tabs = $derived(vm.spellTabs);
  const activeTab = $derived.by((): SpellTabRow | null => {
    if (tabs.length === 0) return null;
    return tabs.find((tb) => tb.key === activeTabKey) ?? tabs[0] ?? null;
  });

  // Picker modal state — "add" (grimoire) or "swap"/"prepare" (into a specific slot).
  let pickerOpen = $state(false);
  let pickerMode = $state<"add" | "prepare">("add");
  let pickerEntryId = $state<string | null>(null);
  let pickerRank = $state<number | undefined>(undefined);
  let pickerSlotIndex = $state<number | null>(null);

  function selectTab(key: string): void {
    activeTabKey = key;
  }

  function traditionLabel(tradition: string): string {
    const key = `FUSION.Sheet.Spells.Tradition.${tradition}`;
    const resolved = t(key);
    return resolved === key ? tradition : resolved;
  }

  function openAddPicker(entry: SpellcastingEntryRow): void {
    pickerMode = "add";
    pickerEntryId = entry.entryId;
    pickerRank = undefined;
    pickerSlotIndex = null;
    pickerOpen = true;
  }

  function openPreparePicker(entry: SpellcastingEntryRow, rank: number, slotIndex: number): void {
    pickerMode = "prepare";
    pickerEntryId = entry.entryId;
    pickerRank = rank;
    pickerSlotIndex = slotIndex;
    pickerOpen = true;
  }

  function closePicker(): void {
    pickerOpen = false;
    pickerEntryId = null;
    pickerSlotIndex = null;
  }

  function handlePickerSelect(doc: Record<string, unknown>): void {
    if (!pickerEntryId) return;
    if (pickerMode === "add") {
      const op = vm.addSpellToEntry(pickerEntryId, doc);
      if (op) sendOpFn(op);
    } else if (pickerMode === "prepare" && pickerRank !== undefined && pickerSlotIndex !== null) {
      // Prepared-slot flow: add the spell to the grimoire first (if it isn't
      // already known), THEN prepare it into the target slot. The picker
      // returns the full compendium document (no _id yet) — addSpellToEntry
      // creates it; the resulting item id isn't known client-side until the
      // server acks, so preparation is a manual follow-up step for now (the
      // user re-opens the slot's "Preparar" from the grimoire row).
      const op = vm.addSpellToEntry(pickerEntryId, doc);
      if (op) sendOpFn(op);
    }
    closePicker();
  }

  function castSpell(entry: SpellcastingEntryRow, rank: number, slotIndex: number, spellId: string, spellName: string): void {
    const preparedOp = vm.toggleSlotExpended(entry.entryId, rank, slotIndex);
    if (preparedOp) sendOpFn(preparedOp);
    // Roll cast: no dedicated "cast" roll exists yet beyond spell attack —
    // spell attack rolls are available from the header "Attack" stat; a bare
    // "cast" click just marks the slot expended for now (feedback item 5:
    // preparing/expending, not a full cast automation, which is out of scope).
    void spellId;
    void spellName;
  }

  function unprepare(entry: SpellcastingEntryRow, rank: number, slotIndex: number): void {
    const op = vm.unprepareSlot(entry.entryId, rank, slotIndex);
    if (op) sendOpFn(op);
  }

  function rollSpellAttack(entryId: string): void {
    const op = vm.rollSpellAttack(entryId);
    if (op) sendOpFn(op);
  }

  function removeFromGrimoire(spellItemId: string): void {
    const op = vm.removeSpell(spellItemId);
    if (op) sendOpFn(op);
  }

  function spellNameById(entry: SpellcastingEntryRow, rank: number, id: string): string {
    const slot = entry.slots.find((s) => s.rank === rank);
    return slot?.spells.find((sp) => sp.id === id)?.name ?? id;
  }

  /** Every known spell across all ranks for an entry — used for the Grimório section. */
  function grimoireSpells(entry: SpellcastingEntryRow): Array<{ id: string; name: string; rank: number }> {
    const out: Array<{ id: string; name: string; rank: number }> = [];
    for (const slot of entry.slots) {
      if (slot.isCantrip) continue;
      for (const sp of slot.spells) out.push({ id: sp.id, name: sp.name, rank: slot.rank });
    }
    return out;
  }

  function cantrips(entry: SpellcastingEntryRow): Array<{ id: string; name: string }> {
    const slot = entry.slots.find((s) => s.isCantrip);
    return slot?.spells.map((sp) => ({ id: sp.id, name: sp.name })) ?? [];
  }
</script>

<div class="spells-tab">
  {#if tabs.length === 0}
    <p class="spells-empty">{t("FUSION.Sheet.Spells.NoEntries")}</p>
  {:else}
    <div class="spells-subtabs" role="tablist" aria-label={t("FUSION.Sheet.Tabs.Spells")}>
      {#each tabs as tab (tab.key)}
        <button
          type="button"
          class="spells-subtab"
          class:spells-subtab--active={activeTab?.key === tab.key}
          role="tab"
          aria-selected={activeTab?.key === tab.key}
          onclick={() => selectTab(tab.key)}
        >
          {tab.kind === "focus" ? t("FUSION.Sheet.Spells.FocusTab") : tab.kind === "rituals" ? t("FUSION.Sheet.Spells.RitualsTab") : tab.label}
        </button>
      {/each}
    </div>

    {#if activeTab?.kind === "entry"}
      {#each activeTab.entries as entry (entry.entryId)}
        <div class="spells-entry">
          <div class="spells-statsbar">
            <div class="spells-stat">
              <span class="spells-stat__label">{t("FUSION.Sheet.Spells.DC")}</span>
              <span class="spells-stat__value">{entry.spellDC}</span>
            </div>
            <button
              type="button"
              class="spells-stat spells-stat--rollable"
              onclick={() => rollSpellAttack(entry.entryId)}
              aria-label={t("FUSION.Sheet.Spells.RollAttack", { value: entry.spellAttackFormatted })}
            >
              <span class="spells-stat__label">{t("FUSION.Sheet.Spells.Attack")}</span>
              <span class="spells-stat__value">{entry.spellAttackFormatted}</span>
            </button>
            <div class="spells-stat">
              <span class="spells-stat__label">{t("FUSION.Sheet.Spells.Tradition")}</span>
              <span class="spells-stat__value">{traditionLabel(entry.tradition)}</span>
            </div>
            <div class="spells-stat">
              <span class="spells-stat__label">{t("FUSION.Sheet.Labels.Ability." + entry.ability)}</span>
            </div>
            <div class="spells-stat">
              <span class="spells-stat__label">{t("FUSION.Sheet.Labels.Proficiency")}</span>
              <ProficiencyBadge rank={entry.proficiencyRankLabel as "U" | "T" | "E" | "M" | "L"} variant="filled" size={20} />
            </div>
          </div>

          {#if cantrips(entry).length > 0}
            <div class="spells-section">
              <h3 class="spells-section__label">
                {t("FUSION.Sheet.Spells.Cantrips")}
                <span class="spells-section__hint">{t("FUSION.Sheet.Spells.CantripsHeightenHint")}</span>
              </h3>
              <div class="spells-chips">
                {#each cantrips(entry) as cantrip (cantrip.id)}
                  <div class="spell-chip">
                    <span class="spell-chip__name">{cantrip.name}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#each entry.slots.filter((s) => !s.isCantrip) as slot (slot.rank)}
            <div class="spells-section">
              <h3 class="spells-section__label">{t("FUSION.Sheet.Spells.Rank", { rank: slot.rank })}</h3>
              <div class="spells-slots">
                {#each Array.from({ length: slot.max }) as _, slotIndex (slotIndex)}
                  {@const prepared = vm.getPreparedSlot(entry.entryId, slot.rank, slotIndex)}
                  {#if prepared && prepared.id}
                    <div class="spell-slot-card" class:spell-slot-card--expended={prepared.expended}>
                      <div class="spell-slot-card__main">
                        <span class="spell-slot-card__name">
                          {spellNameById(entry, slot.rank, prepared.id)}
                          {#if !prepared.expended}
                            <span class="spell-slot-card__dot" title={t("FUSION.Sheet.Spells.SlotAvailable")}></span>
                          {/if}
                        </span>
                      </div>
                      <div class="spell-slot-card__actions">
                        {#if vm.editable}
                          {#if !prepared.expended}
                            <button
                              type="button"
                              class="spell-btn spell-btn--primary"
                              onclick={() => castSpell(entry, slot.rank, slotIndex, prepared.id, spellNameById(entry, slot.rank, prepared.id))}
                            >
                              {t("FUSION.Sheet.Spells.Cast")}
                            </button>
                          {:else}
                            <span class="spell-slot-card__expended-label">{t("FUSION.Sheet.Spells.Expended")}</span>
                          {/if}
                          <button
                            type="button"
                            class="spell-btn spell-btn--ghost"
                            onclick={() => unprepare(entry, slot.rank, slotIndex)}
                          >
                            {t("FUSION.Sheet.Spells.Swap")}
                          </button>
                        {/if}
                      </div>
                    </div>
                  {:else}
                    <button
                      type="button"
                      class="spell-slot-empty"
                      disabled={!vm.editable}
                      onclick={() => openPreparePicker(entry, slot.rank, slotIndex)}
                    >
                      {t("FUSION.Sheet.Spells.PrepareEllipsis")}
                    </button>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}

          <div class="spells-section">
            <div class="spells-section__header">
              <h3 class="spells-section__label">{t("FUSION.Sheet.Spells.Grimoire")}</h3>
              {#if vm.editable}
                <button type="button" class="spell-btn spell-btn--primary" onclick={() => openAddPicker(entry)}>
                  {t("FUSION.Sheet.Spells.AddSpell")}
                </button>
              {/if}
            </div>
            {#if grimoireSpells(entry).length === 0}
              <p class="spells-empty spells-empty--inline">{t("FUSION.Sheet.Spells.GrimoireEmpty")}</p>
            {:else}
              <div class="spells-grimoire">
                {#each grimoireSpells(entry) as spell (spell.id)}
                  <div class="spell-chip spell-chip--row">
                    <span class="spell-chip__name">{spell.name}</span>
                    {#if vm.editable}
                      <button type="button" class="spell-btn spell-btn--ghost" onclick={() => removeFromGrimoire(spell.id)}>
                        {t("FUSION.Sheet.Spells.Remove")}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    {:else if activeTab?.kind === "focus"}
      <div class="spells-section">
        <div class="spells-statsbar">
          <div class="spells-stat">
            <span class="spells-stat__label">{t("FUSION.Sheet.Spells.FocusPoints")}</span>
            <span class="spells-stat__value">{vm.focusPoints.value} / {t("FUSION.Sheet.Spells.MaxAbbrev")} {vm.focusPoints.max}</span>
          </div>
        </div>
        {#each activeTab.entries as entry (entry.entryId)}
          {#each entry.slots.filter((s) => s.isCantrip) as slot (slot.rank)}
            {#each slot.spells as spell (spell.id)}
              <div class="focus-spell-row">
                <div class="focus-spell-row__main">
                  <div class="focus-spell-row__name">{spell.name}</div>
                </div>
                {#if vm.editable}
                  <button type="button" class="spell-btn spell-btn--primary">
                    {t("FUSION.Sheet.Spells.Cast")}
                  </button>
                {/if}
              </div>
            {/each}
          {/each}
        {/each}
        <div class="focus-refocus-note">
          <strong>{t("FUSION.Sheet.Spells.RefocusLabel")}:</strong> {t("FUSION.Sheet.Spells.RefocusHint")}
        </div>
      </div>
    {:else if activeTab?.kind === "rituals"}
      <p class="spells-empty">{t("FUSION.Sheet.Spells.NoRituals")}</p>
    {/if}
  {/if}
</div>

{#if pickerOpen && socket && pickerEntryId}
  {@const entry = tabs.flatMap((tb) => tb.entries).find((e) => e.entryId === pickerEntryId)}
  {#if entry}
    <SpellPickerDialog
      {socket}
      tradition={entry.tradition}
      traditionLabel={traditionLabel(entry.tradition)}
      entryLabel={entry.label}
      maxRank={pickerMode === "prepare" ? pickerRank : undefined}
      onClose={closePicker}
      onSelect={handlePickerSelect}
    />
  {/if}
{/if}

<style>
  .spells-tab {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .spells-subtabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .spells-subtab {
    display: inline-flex;
    align-items: center;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--fusion-font);
    padding: 4px 11px;
    border-radius: var(--fusion-radius-pill);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
    background: transparent;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }

  .spells-subtab:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .spells-subtab--active {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .spells-entry {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .spells-statsbar {
    display: flex;
    align-items: center;
    gap: 18px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 10px 14px;
    flex-wrap: wrap;
  }

  .spells-stat {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .spells-stat__label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-subtle);
  }

  .spells-stat__value {
    font-size: 15px;
    font-weight: 700;
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
  }

  .spells-stat--rollable {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    font-family: var(--fusion-font);
    text-align: left;
  }

  .spells-stat--rollable:hover .spells-stat__value {
    color: var(--fusion-accent-hover);
  }

  .spells-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .spells-section__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .spells-section__label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-muted);
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .spells-section__hint {
    font-size: 10.5px;
    font-weight: 400;
    text-transform: none;
    color: var(--fusion-text-subtle);
    letter-spacing: 0;
  }

  .spells-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .spells-grimoire {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .spell-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 8px 10px;
  }

  .spell-chip--row {
    justify-content: space-between;
  }

  .spell-chip__name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .spells-slots {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .spell-slot-card {
    flex: 1;
    min-width: 160px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .spell-slot-card--expended {
    opacity: 0.6;
  }

  .spell-slot-card__main {
    flex: 1;
    min-width: 0;
  }

  .spell-slot-card__name {
    font-size: 13px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .spell-slot-card__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--fusion-accent);
    display: inline-block;
    margin-left: 6px;
    vertical-align: middle;
  }

  .spell-slot-card__expended-label {
    font-size: 10.5px;
    color: var(--fusion-text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .spell-slot-card__actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .spell-slot-empty {
    flex: 1;
    min-width: 160px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--fusion-border);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text-muted);
    font-size: 12.5px;
    padding: 14px;
    cursor: pointer;
    background: transparent;
    font-family: var(--fusion-font);
    transition: border-color 0.12s, color 0.12s;
  }

  .spell-slot-empty:hover:not(:disabled) {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent-hover);
  }

  .spell-slot-empty:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .spell-btn {
    font-family: var(--fusion-font);
    font-weight: 600;
    cursor: pointer;
    border-radius: var(--fusion-radius-sm);
    font-size: 11px;
    padding: 5px 11px;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    white-space: nowrap;
  }

  .spell-btn--primary {
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border: none;
  }

  .spell-btn--primary:hover {
    background: var(--fusion-accent-hover);
  }

  .spell-btn--ghost {
    background: transparent;
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .spell-btn--ghost:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent-hover);
  }

  .focus-spell-row {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 14px;
  }

  .focus-spell-row__main {
    flex: 1;
  }

  .focus-spell-row__name {
    font-size: 14px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .focus-refocus-note {
    font-size: 11.5px;
    color: var(--fusion-text-muted);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 8px 10px;
  }

  .focus-refocus-note strong {
    color: var(--fusion-text);
  }

  .spells-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 40px 20px;
    color: var(--fusion-text-muted);
    text-align: center;
    font-size: 13px;
  }

  .spells-empty--inline {
    padding: 12px;
  }
</style>
