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
   *
   * GUIDED 2-STEP FLOW (UX decision):
   *   - "Adicionar ao grimório" (picker "add" mode) → the new grimoire row is
   *     highlighted briefly and a toast offers "Preparar agora" (first empty
   *     slot of the spell's rank; a mini-menu when several are empty).
   *   - An empty slot opens a "Preparar do grimório" mini-menu (eligible
   *     known spells, rank 1..slotRank) with a "buscar no compêndio…" link
   *     that opens the compendium picker pre-filtered to the slot's rank.
   *   - Picking from the compendium in "prepare" mode both adds the spell to
   *     the grimoire AND auto-prepares it into the originating slot once the
   *     created item arrives from the server (pendingPrepare effect below —
   *     the item id only exists after the server ack + mirror broadcast).
   */

  import type { CharacterSheetVM, SpellTabRow, SpellcastingEntryRow } from "../../../lib/sheets/pf2e/characterSheetVM.js";
  import ProficiencyBadge from "./ProficiencyBadge.svelte";
  import SpellPickerDialog from "./SpellPickerDialog.svelte";
  import { t } from "../../../lib/i18n/i18n.js";

  interface Props {
    vm: CharacterSheetVM;
    sendOpFn: (op: unknown) => void;
  }

  let { vm, sendOpFn }: Props = $props();

  let activeTabKey = $state<string | null>(null);

  const tabs = $derived(vm.spellTabs);
  const activeTab = $derived.by((): SpellTabRow | null => {
    if (tabs.length === 0) return null;
    return tabs.find((tb) => tb.key === activeTabKey) ?? tabs[0] ?? null;
  });

  // Picker modal state — "add" (grimoire) or "prepare" (into a specific slot).
  let pickerOpen = $state(false);
  let pickerMode = $state<"add" | "prepare">("add");
  let pickerEntryId = $state<string | null>(null);
  let pickerRank = $state<number | undefined>(undefined);
  let pickerSlotIndex = $state<number | null>(null);

  // "Preparar do grimório" mini-menu (opened from an empty slot).
  let prepareMenu = $state<{ entryId: string; rank: number; slotIndex: number } | null>(null);

  // Slot-choice mini-menu (toast's "Preparar agora" when several slots are empty).
  let slotChoice = $state<{ entryId: string; rank: number; spellName: string; slots: number[] } | null>(null);

  // Toast (bottom-center) after adding a spell to the grimoire.
  let toast = $state<{ message: string; spellName?: string; rank?: number; entryId?: string } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  // Briefly-highlighted grimoire row (the spell just added).
  let recentlyAddedName = $state<string | null>(null);
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;

  // Deferred prepare: the picker's "prepare" mode creates the spell item, but
  // its _id only exists after the server ack + mirror broadcast. This records
  // the intent; the $effect below completes it when the item shows up in vm.
  let pendingPrepare = $state<{
    entryId: string;
    rank: number;
    slotIndex: number;
    spellName: string;
    expiresAt: number;
  } | null>(null);

  $effect(() => {
    const pending = pendingPrepare;
    if (!pending) return;
    if (Date.now() > pending.expiresAt) {
      pendingPrepare = null;
      return;
    }
    const entry = findEntry(pending.entryId);
    if (!entry) return;
    const spell = findGrimoireSpellByName(entry, pending.spellName);
    if (!spell) return; // not mirrored yet — re-runs when vm changes
    pendingPrepare = null;
    const op = vm.prepareSpell(pending.entryId, pending.rank, pending.slotIndex, spell.id);
    if (op) sendOpFn(op);
  });

  function selectTab(key: string): void {
    activeTabKey = key;
  }

  function traditionLabel(tradition: string): string {
    const key = `FUSION.Sheet.Spells.Tradition.${tradition}`;
    const resolved = t(key);
    return resolved === key ? tradition : resolved;
  }

  function findEntry(entryId: string): SpellcastingEntryRow | null {
    return tabs.flatMap((tb) => tb.entries).find((e) => e.entryId === entryId) ?? null;
  }

  /** Known (grimoire) spell matching a name, with its item id and rank. */
  function findGrimoireSpellByName(
    entry: SpellcastingEntryRow,
    name: string,
  ): { id: string; rank: number } | null {
    for (const slot of entry.slots) {
      for (const sp of slot.spells) {
        if (sp.name === name && sp.id) return { id: sp.id, rank: slot.rank };
      }
    }
    return null;
  }

  /** Indices of empty (unprepared) slots for a rank in an entry. */
  function emptySlotIndices(entry: SpellcastingEntryRow, rank: number): number[] {
    const slot = entry.slots.find((s) => s.rank === rank && !s.isCantrip);
    if (!slot) return [];
    const out: number[] = [];
    for (let i = 0; i < slot.max; i++) {
      const prepared = vm.getPreparedSlot(entry.entryId, rank, i);
      if (!prepared || !prepared.id) out.push(i);
    }
    return out;
  }

  function showToast(toastData: NonNullable<typeof toast>, durationMs = 8000): void {
    if (toastTimer !== null) clearTimeout(toastTimer);
    toast = toastData;
    toastTimer = setTimeout(() => {
      toast = null;
    }, durationMs);
  }

  function flashGrimoireRow(name: string): void {
    if (highlightTimer !== null) clearTimeout(highlightTimer);
    recentlyAddedName = name;
    highlightTimer = setTimeout(() => {
      recentlyAddedName = null;
    }, 4000);
  }

  function openAddPicker(entry: SpellcastingEntryRow): void {
    pickerMode = "add";
    pickerEntryId = entry.entryId;
    pickerRank = undefined;
    pickerSlotIndex = null;
    pickerOpen = true;
  }

  function openPreparePicker(entryId: string, rank: number, slotIndex: number): void {
    prepareMenu = null;
    pickerMode = "prepare";
    pickerEntryId = entryId;
    pickerRank = rank;
    pickerSlotIndex = slotIndex;
    pickerOpen = true;
  }

  /** Empty slot click → "Preparar do grimório" mini-menu. */
  function openPrepareMenu(entry: SpellcastingEntryRow, rank: number, slotIndex: number): void {
    prepareMenu = { entryId: entry.entryId, rank, slotIndex };
  }

  /** Eligible grimoire spells for a slot: known, rank 1..slotRank. */
  function prepareMenuSpells(entryId: string, maxRank: number): Array<{ id: string; name: string; rank: number }> {
    const entry = findEntry(entryId);
    if (!entry) return [];
    const out: Array<{ id: string; name: string; rank: number }> = [];
    for (const slot of entry.slots) {
      if (slot.isCantrip || slot.rank > maxRank) continue;
      for (const sp of slot.spells) {
        if (sp.id) out.push({ id: sp.id, name: sp.name, rank: slot.rank });
      }
    }
    return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }

  function prepareFromMenu(spellId: string): void {
    if (!prepareMenu) return;
    const op = vm.prepareSpell(prepareMenu.entryId, prepareMenu.rank, prepareMenu.slotIndex, spellId);
    if (op) sendOpFn(op);
    prepareMenu = null;
  }

  function closePicker(): void {
    pickerOpen = false;
    pickerEntryId = null;
    pickerSlotIndex = null;
  }

  function handlePickerSelect(doc: Record<string, unknown>): void {
    if (!pickerEntryId) return;
    const rawName = doc["name"];
    const spellName = typeof rawName === "string" ? rawName : "";
    const sys = typeof doc["system"] === "object" && doc["system"] !== null
      ? (doc["system"] as Record<string, unknown>)
      : {};
    const rawLevel = sys["level"];
    const spellRank = typeof rawLevel === "number" ? rawLevel : 0;

    if (pickerMode === "add") {
      const op = vm.addSpellToEntry(pickerEntryId, doc);
      if (op) {
        sendOpFn(op);
        flashGrimoireRow(spellName);
        showToast({
          message: t("FUSION.Sheet.Spells.Toast.Added", { name: spellName }),
          spellName,
          rank: spellRank,
          entryId: pickerEntryId,
        });
      }
    } else if (pickerMode === "prepare" && pickerRank !== undefined && pickerSlotIndex !== null) {
      // Guided flow: add to the grimoire (unless already known), then
      // auto-prepare into the originating slot. If the spell is already in
      // the grimoire, prepare immediately; otherwise defer via
      // pendingPrepare until the created item arrives from the server.
      const entry = findEntry(pickerEntryId);
      const known = entry ? findGrimoireSpellByName(entry, spellName) : null;
      if (known) {
        const op = vm.prepareSpell(pickerEntryId, pickerRank, pickerSlotIndex, known.id);
        if (op) sendOpFn(op);
      } else {
        const op = vm.addSpellToEntry(pickerEntryId, doc);
        if (op) {
          sendOpFn(op);
          flashGrimoireRow(spellName);
          pendingPrepare = {
            entryId: pickerEntryId,
            rank: pickerRank,
            slotIndex: pickerSlotIndex,
            spellName,
            expiresAt: Date.now() + 10_000,
          };
        }
      }
    }
    closePicker();
  }

  /** Toast's "Preparar agora": first empty slot of the spell's rank; mini-menu when several. */
  function prepareNowFromToast(): void {
    if (!toast?.spellName || toast.rank === undefined || !toast.entryId) return;
    const entry = findEntry(toast.entryId);
    if (!entry) return;
    const { spellName, rank, entryId } = toast;
    const empty = emptySlotIndices(entry, rank);
    if (empty.length === 0) {
      showToast({ message: t("FUSION.Sheet.Spells.Toast.NoEmptySlot", { rank: String(rank) }) }, 5000);
      return;
    }
    if (empty.length === 1) {
      prepareIntoSlot(entryId, rank, empty[0] ?? 0, spellName);
      toast = null;
      return;
    }
    slotChoice = { entryId, rank, spellName, slots: empty };
    toast = null;
  }

  /** Prepare a named grimoire spell into a slot now (or defer if not mirrored yet). */
  function prepareIntoSlot(entryId: string, rank: number, slotIndex: number, spellName: string): void {
    const entry = findEntry(entryId);
    const known = entry ? findGrimoireSpellByName(entry, spellName) : null;
    if (known) {
      const op = vm.prepareSpell(entryId, rank, slotIndex, known.id);
      if (op) sendOpFn(op);
    } else {
      pendingPrepare = { entryId, rank, slotIndex, spellName, expiresAt: Date.now() + 10_000 };
    }
  }

  function chooseSlot(slotIndex: number): void {
    if (!slotChoice) return;
    prepareIntoSlot(slotChoice.entryId, slotChoice.rank, slotIndex, slotChoice.spellName);
    slotChoice = null;
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

  /**
   * Inverse of castSpell — recover an already-expended slot without waiting
   * for a full Rest (feedback: "Ao usar uma magia, não consigo recuperar os
   * slots dela" — the UI previously had no button that flipped `expended`
   * back to false; toggleSlotExpended already supported both directions).
   */
  function recoverSlot(entry: SpellcastingEntryRow, rank: number, slotIndex: number): void {
    const op = vm.toggleSlotExpended(entry.entryId, rank, slotIndex);
    if (op) sendOpFn(op);
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
                            <button
                              type="button"
                              class="spell-btn spell-btn--recover"
                              onclick={() => recoverSlot(entry, slot.rank, slotIndex)}
                            >
                              {t("FUSION.Sheet.Spells.Recover")}
                            </button>
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
                      onclick={() => openPrepareMenu(entry, slot.rank, slotIndex)}
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
                  <div
                    class="spell-chip spell-chip--row"
                    class:spell-chip--new={spell.name === recentlyAddedName}
                  >
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

{#if pickerOpen && pickerEntryId}
  {@const entry = findEntry(pickerEntryId)}
  {#if entry}
    <SpellPickerDialog
      tradition={entry.tradition}
      traditionLabel={traditionLabel(entry.tradition)}
      entryLabel={entry.label}
      maxRank={pickerMode === "prepare" ? pickerRank : undefined}
      initialRank={pickerMode === "prepare" ? pickerRank : undefined}
      onClose={closePicker}
      onSelect={handlePickerSelect}
    />
  {/if}
{/if}

<!-- "Preparar do grimório" mini-menu (empty slot click) -->
{#if prepareMenu}
  {@const menuSpells = prepareMenuSpells(prepareMenu.entryId, prepareMenu.rank)}
  <div
    class="mini-backdrop"
    role="presentation"
    onclick={() => { prepareMenu = null; }}
    onkeydown={(e) => { if (e.key === "Escape") prepareMenu = null; }}
  >
    <div
      class="mini-menu"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={t("FUSION.Sheet.Spells.PrepareMenu.Title", { rank: String(prepareMenu.rank) })}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Escape") prepareMenu = null; }}
    >
      <h3 class="mini-menu__title">{t("FUSION.Sheet.Spells.PrepareMenu.Title", { rank: String(prepareMenu.rank) })}</h3>
      {#if menuSpells.length === 0}
        <p class="mini-menu__empty">{t("FUSION.Sheet.Spells.PrepareMenu.Empty")}</p>
      {:else}
        <div class="mini-menu__list">
          {#each menuSpells as sp (sp.id)}
            <button type="button" class="mini-menu__item" onclick={() => prepareFromMenu(sp.id)}>
              <span class="mini-menu__item-rank">{sp.rank}</span>
              <span class="mini-menu__item-name">{sp.name}</span>
            </button>
          {/each}
        </div>
      {/if}
      <button
        type="button"
        class="mini-menu__link"
        onclick={() => {
          if (prepareMenu) openPreparePicker(prepareMenu.entryId, prepareMenu.rank, prepareMenu.slotIndex);
        }}
      >
        {t("FUSION.Sheet.Spells.PrepareMenu.SearchCompendium")}
      </button>
    </div>
  </div>
{/if}

<!-- Slot-choice mini-menu (toast's "Preparar agora" with several empty slots) -->
{#if slotChoice}
  <div
    class="mini-backdrop"
    role="presentation"
    onclick={() => { slotChoice = null; }}
    onkeydown={(e) => { if (e.key === "Escape") slotChoice = null; }}
  >
    <div
      class="mini-menu"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={t("FUSION.Sheet.Spells.SlotChoice.Title", { rank: String(slotChoice.rank) })}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Escape") slotChoice = null; }}
    >
      <h3 class="mini-menu__title">{t("FUSION.Sheet.Spells.SlotChoice.Title", { rank: String(slotChoice.rank) })}</h3>
      <div class="mini-menu__list">
        {#each slotChoice.slots as slotIndex (slotIndex)}
          <button type="button" class="mini-menu__item" onclick={() => chooseSlot(slotIndex)}>
            <span class="mini-menu__item-name">{t("FUSION.Sheet.Spells.SlotChoice.Option", { n: String(slotIndex + 1) })}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<!-- Toast (bottom-center) -->
{#if toast}
  <div class="spells-toast" role="status">
    <span class="spells-toast__msg">{toast.message}</span>
    {#if toast.spellName && toast.rank !== undefined && toast.rank > 0}
      <button type="button" class="spells-toast__action" onclick={prepareNowFromToast}>
        {t("FUSION.Sheet.Spells.Toast.PrepareNow")}
      </button>
    {/if}
    <button
      type="button"
      class="spells-toast__close"
      aria-label={t("FUSION.Dialog.Close")}
      onclick={() => { toast = null; }}
    >&times;</button>
  </div>
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

  /* Dim only the name/main area, not the action buttons — a fully-dimmed
     card (previous opacity:0.6 on the whole card) muddied the "Recuperar"
     button's contrast right when it needs to read as an available action. */
  .spell-slot-card--expended .spell-slot-card__main {
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

  /* Recover an expended slot — visually distinct (success/green) from the
     primary "Lançar" action so it reads as "undo the spend", not "cast". */
  .spell-btn--recover {
    background: var(--fusion-success-dim);
    border: 1px solid var(--fusion-success);
    color: var(--fusion-success);
  }

  .spell-btn--recover:hover {
    background: var(--fusion-success);
    color: var(--fusion-on-accent);
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

  /* Recently-added grimoire row highlight (guided 2-step flow) */
  .spell-chip--new {
    animation: spell-chip-flash 4s ease-out;
  }

  @keyframes spell-chip-flash {
    0%,
    60% {
      border-color: var(--fusion-accent);
      background: var(--fusion-accent-dim);
    }
    100% {
      border-color: var(--fusion-border);
      background: var(--fusion-surface-alt);
    }
  }

  /* Toast (bottom-center, above windows; below nothing relevant) */
  .spells-toast {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius);
    box-shadow: var(--fusion-shadow-modal);
    padding: 10px 14px;
    z-index: 120;
    font-size: 12.5px;
    color: var(--fusion-text);
  }

  .spells-toast__action {
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border: none;
    border-radius: var(--fusion-radius-sm);
    font-family: var(--fusion-font);
    font-size: 11px;
    font-weight: 600;
    padding: 5px 11px;
    cursor: pointer;
    white-space: nowrap;
  }

  .spells-toast__action:hover {
    background: var(--fusion-accent-hover);
  }

  .spells-toast__close {
    background: transparent;
    border: none;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    font-family: var(--fusion-font);
  }

  .spells-toast__close:hover {
    color: var(--fusion-text);
  }

  /* Mini-menu (prepare-from-grimoire / slot choice) */
  .mini-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 110;
  }

  .mini-menu {
    width: 340px;
    max-width: 100%;
    max-height: 420px;
    overflow-y: auto;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: var(--fusion-shadow-modal);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mini-menu__title {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
    color: var(--fusion-text);
  }

  .mini-menu__empty {
    font-size: 12px;
    color: var(--fusion-text-muted);
    margin: 0;
    padding: 8px 0;
  }

  .mini-menu__list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mini-menu__item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    font-family: var(--fusion-font);
    text-align: left;
  }

  .mini-menu__item:hover {
    background: var(--fusion-surface-alt);
    border-color: var(--fusion-accent);
  }

  .mini-menu__item-rank {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font-mono);
  }

  .mini-menu__item-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .mini-menu__link {
    background: transparent;
    border: none;
    color: var(--fusion-accent);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 12px;
    text-align: left;
    padding: 4px 0 0;
    text-decoration: underline;
  }

  .mini-menu__link:hover {
    color: var(--fusion-accent-hover);
  }
</style>
