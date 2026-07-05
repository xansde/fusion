<script lang="ts">
  /**
   * CompendiumPickerDialog.svelte — generic compendium picker modal for the
   * Plan column's slots (R10-D item 2/D2), modeled on SpellPickerDialog
   * post-fix (same SOCKET/loading/error/retry rules — see that file's
   * docstring for the frozen-socket rationale).
   *
   * Unlike SpellPickerDialog (which is spell-specific: rank chips, tradition
   * filter, prepared-slot semantics), this dialog is a thin, reusable browser
   * over ANY pf2e pack: it lists `packId`'s full index, applies an optional
   * caller-supplied predicate (`filterFn` — pre-applied server-shape filters
   * like slot category/level/trait per DEC-R10-05's picker filters), and lets
   * the user narrow further with a free-text search box (accent/case
   * insensitive via `normalizeSearchText` from @fusion/shared — the same
   * helper the server's compendium service uses for text search, REQ-CMP-013).
   *
   * SOCKET: resolved LIVE via getSocket() on every operation — never held as
   * a prop (see SpellPickerDialog.svelte's docstring for the frozen-socket
   * bug this avoids).
   *
   * Clean-room: only mechanical index fields are shown — no prose.
   */

  import type { PackIndexEntry } from "@fusion/shared";
  import { normalizeSearchText } from "@fusion/shared";
  import {
    listPacks,
    searchPack,
    getDocument,
    requireConnectedSocket,
    SocketUnavailableError,
  } from "../../../../lib/compendium/compendiumApi.js";
  import { session, getSocket } from "../../../../lib/session.svelte.js";
  import { t } from "../../../../lib/i18n/i18n.js";

  interface Props {
    /** Pack slug suffix to search, e.g. "feats-core" (resolved to "<systemId>.<packSlug>"). */
    packSlug: string;
    /** Modal title. */
    title: string;
    /** Non-blocking eligibility predicate — ineligible entries are hidden. */
    filterFn?: ((entry: PackIndexEntry) => boolean) | undefined;
    /** Extra trait chips derived from the entries (e.g. traits.value) shown for further narrowing. */
    showTraitFilter?: boolean;
    onClose: () => void;
    onSelect: (doc: Record<string, unknown>) => void;
  }

  let { packSlug, title, filterFn, showTraitFilter = false, onClose, onSelect }: Props = $props();

  let query = $state("");
  let traitFilter = $state<string | null>(null);
  let selectedUuid = $state<string | null>(null);
  let loading = $state(true);
  let errorKind = $state<"not-connected" | "load" | null>(null);
  let entries = $state<PackIndexEntry[]>([]);
  let submitting = $state(false);

  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");

  $effect(() => {
    void loadEntries();
  });

  async function loadEntries(): Promise<void> {
    loading = true;
    errorKind = null;
    try {
      const sock = requireConnectedSocket(getSocket());
      const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
      const pack = packs.find((p) => p.id.endsWith(`.${packSlug}`));
      if (!pack) {
        entries = [];
        return;
      }
      const { entries: found } = await searchPack(sock, { packId: pack.id });
      entries = found;
    } catch (err) {
      errorKind = err instanceof SocketUnavailableError ? "not-connected" : "load";
    } finally {
      loading = false;
    }
  }

  function traitsOf(e: PackIndexEntry): string[] {
    const raw = e.index["system.traits.value"];
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  }

  function levelOf(e: PackIndexEntry): number | null {
    const raw = e.index["system.level"];
    return typeof raw === "number" ? raw : null;
  }

  const eligible = $derived.by(() => (filterFn ? entries.filter(filterFn) : entries));

  const availableTraits = $derived.by(() => {
    if (!showTraitFilter) return [];
    const set = new Set<string>();
    for (const e of eligible) for (const trait of traitsOf(e)) set.add(trait);
    return Array.from(set).sort();
  });

  const filtered = $derived.by(() => {
    const searchNorm = query.trim() ? normalizeSearchText(query.trim()) : null;
    return eligible
      .filter((e) => (searchNorm ? normalizeSearchText(e.name).includes(searchNorm) : true))
      .filter((e) => (traitFilter ? traitsOf(e).includes(traitFilter) : true))
      .sort((a, b) => {
        const levelDiff = (levelOf(a) ?? 0) - (levelOf(b) ?? 0);
        if (levelDiff !== 0) return levelDiff;
        return normalizeSearchText(a.name).localeCompare(normalizeSearchText(b.name));
      });
  });

  function selectRow(e: PackIndexEntry): void {
    selectedUuid = e.uuid;
  }

  async function confirmSelection(): Promise<void> {
    if (!selectedUuid || submitting) return;
    submitting = true;
    errorKind = null;
    try {
      const sock = requireConnectedSocket(getSocket());
      const { document } = await getDocument(sock, selectedUuid);
      onSelect(document);
      onClose();
    } catch (err) {
      errorKind = err instanceof SocketUnavailableError ? "not-connected" : "load";
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
</script>

<div class="picker-backdrop" role="presentation" onclick={handleBackdropClick} onkeydown={handleBackdropKeydown}>
  <div
    class="picker-modal"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={title}
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
  >
    <div class="picker-modal__header">
      <h2 class="picker-modal__title">{title}</h2>
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
          placeholder={t("FUSION.Sheet.Plan.Picker.SearchPlaceholder")}
          bind:value={query}
        />
      </div>

      {#if showTraitFilter && availableTraits.length > 0}
        <div class="picker-filters">
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
        </div>
      {/if}

      <div class="picker-results">
        {#if loading}
          <div class="picker-empty">{t("FUSION.Sheet.Plan.Picker.Loading")}</div>
        {:else if errorKind}
          <div class="picker-empty picker-empty--error">
            <span>
              {errorKind === "not-connected"
                ? t("FUSION.Sheet.Spells.Picker.NotConnected")
                : t("FUSION.Sheet.Plan.Picker.LoadError")}
            </span>
            <button type="button" class="picker-btn picker-btn--secondary picker-retry" onclick={() => void loadEntries()}>
              {t("FUSION.Sheet.Spells.Picker.Retry")}
            </button>
          </div>
        {:else if filtered.length === 0}
          <div class="picker-empty">
            <span>{t("FUSION.Sheet.Plan.Picker.NoResults")}</span>
          </div>
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
              {#if levelOf(entry) !== null}
                <span class="picker-row__rank">{levelOf(entry)}</span>
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
          {t("FUSION.Sheet.Plan.Picker.Confirm")}
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
    width: 640px;
    max-width: 100%;
    max-height: 700px;
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

  .picker-results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: 4px;
    max-height: 380px;
    overflow-y: auto;
  }

  .picker-empty {
    padding: 32px 12px;
    text-align: center;
    font-size: 13px;
    color: var(--fusion-text-muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .picker-empty--error {
    color: var(--fusion-danger);
  }

  .picker-retry {
    align-self: center;
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
