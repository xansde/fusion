<script lang="ts">
  /**
   * SpellPickerDialog.svelte — compendium spell picker modal (DEC-R10-04).
   *
   * Ports the design contract's SpellPicker.jsx + Modal/SearchBox/Chip/ResultRow
   * (.fusion-build/r10-design/claude-design/ui_kits/ficha-pf2e/SpellPicker.jsx)
   * to Svelte 5. Two modes:
   *   - "add"  — search the tradition's spell pack, pick a spell, emit onAdd(doc)
   *              (VM.addSpellToEntry builds the doc:create op from this).
   *   - "swap" — same search UI but restricted to `maxRank` (used when trading a
   *              prepared slot; caller narrows results to the grimoire/rank).
   *
   * Data comes from compendiumApi.searchPack/getDocument against the active
   * system's spells pack (`<systemId>.spells-core`), filtered client-side via
   * the C2 VM helper filterSpellPicker (rank ceiling + tradition + name search).
   *
   * Clean-room: only mechanical index fields (rank, traits, source) are shown —
   * no prose (footer note documents this, matching the design contract).
   */

  import type { Socket } from "socket.io-client";
  import type { PackIndexEntry } from "@fusion/shared";
  import { listPacks, searchPack, getDocument } from "../../../lib/compendium/compendiumApi.js";
  import { filterSpellPicker, type SpellPickerEntry } from "../../../lib/sheets/pf2e/characterSheetVM.js";
  import { session } from "../../../lib/session.svelte.js";
  import { t } from "../../../lib/i18n/i18n.js";

  interface Props {
    socket: Socket;
    /** Tradition to restrict results to (e.g. "arcane"). */
    tradition: string;
    /** Human label for the tradition, e.g. "Arcana" (header text). */
    traditionLabel: string;
    /** Entry/grimoire label shown in the modal title. */
    entryLabel: string;
    /** Cap the results to this rank (used for "swap into rank N slot"). Omit for "add any". */
    maxRank?: number | undefined;
    onClose: () => void;
    onSelect: (doc: Record<string, unknown>) => void;
  }

  let { socket, tradition, traditionLabel, entryLabel, maxRank, onClose, onSelect }: Props = $props();

  let query = $state("");
  let rankFilter = $state<number | null>(null);
  let traitFilter = $state<string | null>(null);
  let selectedUuid = $state<string | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let entries = $state<PackIndexEntry[]>([]);
  let submitting = $state(false);

  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");

  $effect(() => {
    void loadSpells();
  });

  async function loadSpells(): Promise<void> {
    loading = true;
    error = null;
    try {
      const { packs } = await listPacks(socket, { systemId, documentType: "Item" });
      const spellPack = packs.find((p) => p.id.endsWith(".spells-core")) ?? packs[0];
      if (!spellPack) {
        entries = [];
        return;
      }
      const { entries: found } = await searchPack(socket, { packId: spellPack.id });
      entries = found;
    } catch (err) {
      error = err instanceof Error ? err.message : t("FUSION.Sheet.Spells.Picker.LoadError");
    } finally {
      loading = false;
    }
  }

  /** Every distinct trait across the loaded index (for the trait filter chips). */
  const availableTraits = $derived.by(() => {
    const set = new Set<string>();
    for (const e of entries) {
      const raw = e.index["system.traits.value"];
      if (Array.isArray(raw)) for (const v of raw) if (typeof v === "string") set.add(v);
    }
    return Array.from(set).sort();
  });

  const filtered = $derived.by(() => {
    const pickerEntries: SpellPickerEntry[] = entries.map((e) => ({ name: e.name, index: e.index }));
    const byTraditionAndRank = filterSpellPicker(pickerEntries, {
      tradition,
      search: query,
      ...(maxRank !== undefined ? { maxRank } : {}),
    });
    const allowedNames = new Set(byTraditionAndRank.map((e) => e.name));
    return entries
      .filter((e) => allowedNames.has(e.name))
      .filter((e) => {
        if (rankFilter === null) return true;
        const raw = e.index["system.level"];
        return raw === rankFilter;
      })
      .filter((e) => {
        if (!traitFilter) return true;
        const raw = e.index["system.traits.value"];
        return Array.isArray(raw) && raw.includes(traitFilter);
      });
  });

  function rankOf(e: PackIndexEntry): number {
    const raw = e.index["system.level"];
    return typeof raw === "number" ? raw : 0;
  }

  function traitsOf(e: PackIndexEntry): string[] {
    const raw = e.index["system.traits.value"];
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  }

  function actionCostOf(e: PackIndexEntry): string | null {
    // castTime isn't in indexFields for spells-core — no per-row action-cost
    // badge is available from the index alone; omit rather than guess.
    void e;
    return null;
  }

  function selectRow(e: PackIndexEntry): void {
    selectedUuid = e.uuid;
  }

  async function confirmSelection(): Promise<void> {
    if (!selectedUuid || submitting) return;
    submitting = true;
    error = null;
    try {
      const { document } = await getDocument(socket, selectedUuid);
      onSelect(document);
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : t("FUSION.Sheet.Spells.Picker.LoadError");
    } finally {
      submitting = false;
    }
  }

  function handleBackdropClick(): void {
    onClose();
  }

  function handleBackdropKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onClose();
  }

  const rankChips = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
</script>

<div
  class="picker-backdrop"
  role="presentation"
  onclick={handleBackdropClick}
  onkeydown={handleBackdropKeydown}
>
  <div
    class="picker-modal"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={t("FUSION.Sheet.Spells.Picker.Title", { entry: entryLabel, tradition: traditionLabel })}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="picker-modal__header">
      <h2 class="picker-modal__title">
        {t("FUSION.Sheet.Spells.Picker.Title", { entry: entryLabel, tradition: traditionLabel })}
      </h2>
      <button type="button" class="picker-modal__close" onclick={onClose} aria-label={t("FUSION.Dialog.Close")}>
        &times;
      </button>
    </div>

    <div class="picker-modal__body">
      <div class="picker-search">
        <span class="picker-search__icon" aria-hidden="true">&#128269;</span>
        <input
          type="text"
          class="picker-search__input"
          placeholder={t("FUSION.Sheet.Spells.Picker.SearchPlaceholder")}
          bind:value={query}
        />
      </div>

      <div class="picker-filters">
        {#each rankChips as n (n)}
          {#if maxRank === undefined || n <= maxRank}
            <button
              type="button"
              class="picker-chip"
              class:picker-chip--active={rankFilter === n}
              onclick={() => { rankFilter = rankFilter === n ? null : n; }}
            >
              {n}
            </button>
          {/if}
        {/each}
        <span class="picker-filters__sep"></span>
        <span class="picker-chip picker-chip--fixed">
          {t("FUSION.Sheet.Spells.Picker.TraditionFixed", { tradition: traditionLabel })}
        </span>
        {#if availableTraits.length > 0}
          <span class="picker-filters__sep"></span>
          {#each availableTraits as trait (trait)}
            <button
              type="button"
              class="picker-chip"
              class:picker-chip--active={traitFilter === trait}
              onclick={() => { traitFilter = traitFilter === trait ? null : trait; }}
            >
              {trait}
            </button>
          {/each}
        {/if}
      </div>

      <div class="picker-results">
        {#if loading}
          <div class="picker-empty">{t("FUSION.Sheet.Spells.Picker.Loading")}</div>
        {:else if error}
          <div class="picker-empty picker-empty--error">{error}</div>
        {:else if filtered.length === 0}
          <div class="picker-empty">{t("FUSION.Sheet.Spells.Picker.NoResults")}</div>
        {:else}
          {#each filtered as entry (entry.uuid)}
            <div
              class="picker-row"
              class:picker-row--selected={selectedUuid === entry.uuid}
              role="button"
              tabindex="0"
              onclick={() => selectRow(entry)}
              onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") selectRow(entry); }}
            >
              <span class="picker-row__rank">{rankOf(entry)}</span>
              {#if actionCostOf(entry)}
                <span class="picker-row__cost">{actionCostOf(entry)}</span>
              {/if}
              <div class="picker-row__main">
                <div class="picker-row__name">{entry.name}</div>
                {#if traitsOf(entry).length > 0}
                  <div class="picker-row__traits">
                    {#each traitsOf(entry) as trait (trait)}
                      <span class="picker-row__trait">{trait}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <div class="picker-modal__footer">
      <span class="picker-modal__note">{t("FUSION.Sheet.Spells.Picker.CleanRoomNote")}</span>
      <div class="picker-modal__actions">
        <button type="button" class="picker-btn picker-btn--secondary" onclick={onClose}>
          {t("FUSION.Dialog.Cancel")}
        </button>
        <button
          type="button"
          class="picker-btn picker-btn--primary"
          disabled={!selectedUuid || submitting}
          onclick={confirmSelection}
        >
          {t("FUSION.Sheet.Spells.Picker.Confirm")}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .picker-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 100;
  }

  .picker-modal {
    width: 680px;
    max-width: 100%;
    max-height: 720px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: var(--fusion-shadow-modal);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .picker-modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--fusion-border);
    flex-shrink: 0;
  }

  .picker-modal__title {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    color: var(--fusion-text);
  }

  .picker-modal__close {
    width: 24px;
    height: 24px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--fusion-font);
  }

  .picker-modal__close:hover {
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .picker-modal__body {
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
  }

  .picker-search {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 8px 12px;
  }

  .picker-search:focus-within {
    border-color: var(--fusion-accent);
  }

  .picker-search__icon {
    color: var(--fusion-text-subtle);
    font-size: 13px;
    line-height: 1;
  }

  .picker-search__input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--fusion-text);
    font-size: 13px;
    font-family: var(--fusion-font);
  }

  .picker-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .picker-filters__sep {
    width: 1px;
    height: 16px;
    background: var(--fusion-border);
    margin: 0 4px;
  }

  .picker-chip {
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

  .picker-chip:hover {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .picker-chip--active {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .picker-chip--fixed {
    background: var(--fusion-surface-alt);
    border-style: dashed;
    cursor: default;
  }

  .picker-chip--fixed:hover {
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .picker-results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 4px;
    max-height: 340px;
    overflow-y: auto;
  }

  .picker-empty {
    padding: 32px 12px;
    text-align: center;
    font-size: 13px;
    color: var(--fusion-text-muted);
  }

  .picker-empty--error {
    color: var(--fusion-danger);
  }

  .picker-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
  }

  .picker-row:hover {
    background: var(--fusion-surface-alt);
  }

  .picker-row--selected {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
  }

  .picker-row__rank {
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

  .picker-row--selected .picker-row__rank {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .picker-row__cost {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 1px solid var(--fusion-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
    color: var(--fusion-text-subtle);
    font-family: var(--fusion-font-mono);
  }

  .picker-row__main {
    flex: 1;
    min-width: 0;
  }

  .picker-row__name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fusion-text);
  }

  .picker-row__traits {
    display: flex;
    gap: 4px;
    margin-top: 3px;
    flex-wrap: wrap;
  }

  .picker-row__trait {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    padding: 1px 6px;
    border-radius: var(--fusion-radius-sm);
  }

  .picker-modal__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 18px;
    border-top: 1px solid var(--fusion-border);
    flex-shrink: 0;
  }

  .picker-modal__note {
    font-size: 10.5px;
    color: var(--fusion-text-subtle);
  }

  .picker-modal__actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .picker-btn {
    font-family: var(--fusion-font);
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    padding: 7px 14px;
    font-size: 13px;
    border-radius: var(--fusion-radius);
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .picker-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .picker-btn--primary {
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border: 1px solid var(--fusion-accent);
  }

  .picker-btn--primary:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
    border-color: var(--fusion-accent-hover);
  }

  .picker-btn--secondary {
    background: transparent;
    color: var(--fusion-text-muted);
    border: 1px solid var(--fusion-border);
  }

  .picker-btn--secondary:hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }
</style>
