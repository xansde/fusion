<script lang="ts">
  /**
   * SlotGrid.svelte — the slots of the action bar: the twelve favourites, or the groups of a tab
   * (BAR-F1-04; spec 53 REQ-BAR-026, REQ-BAR-029, D-BA07; prototype T1–T5).
   *
   * **Favorites** is the main row: twelve positions, the keys 1–9, 0, − and = as the seal of each
   * (the key only labels the slot; the shortcuts are BAR-F1-05's). An empty position is drawn as an
   * empty box with its key, so the twelve bindings stay readable.
   *
   * **A tab** lists its entries in groups ("Truques", "1º patamar", "Atletismo"…) with the counter
   * of the group in the header (the slots of a rank "2/3", the pips of focus). A tab with nothing in
   * it does NOT disappear or break: it says it is empty (REQ-BAR-026).
   *
   * Only draws; the slot decides how an entry looks (`Slot.svelte`) and the controller what a click
   * does. Drag and drop is not here (D-BA16).
   */

  import type { Component } from "svelte";

  import { t } from "../../lib/i18n/i18n.js";
  import { FAVORITE_KEYS } from "../../lib/actionbar/favoriteKeys.js";
  import { entriesForTab, groupEntries } from "../../lib/actionbar/slotModel.js";
  import type { ActionBarEntry, ActionBarTab } from "../../lib/actionbar/types.js";
  import Slot from "./Slot.svelte";

  interface Props {
    tab: ActionBarTab | "favorites";
    entries: readonly ActionBarEntry[];
    /** The twelve favourite ids in key order, `null` for an empty position. */
    favorites: ReadonlyArray<string | null>;
    isBusy: (entryId: string) => boolean;
    altHeld: boolean;
    Details?: Component<{ entry: ActionBarEntry }> | undefined;
    /** Entry whose slot menu is open, if any. */
    menuEntryId: string | null;
    onrun: (entry: ActionBarEntry) => void;
    oncontext: (
      entry: ActionBarEntry,
      at: { x: number; y: number },
      via: "pointer" | "keyboard",
      anchor: HTMLElement,
    ) => void;
    onhover: (entry: ActionBarEntry) => void;
    onleave: (entry: ActionBarEntry) => void;
  }

  const {
    tab,
    entries,
    favorites,
    isBusy,
    altHeld,
    Details,
    menuEntryId,
    onrun,
    oncontext,
    onhover,
    onleave,
  }: Props = $props();

  const byId = $derived(new Map(entries.map((entry) => [entry.id, entry] as const)));
  /** The favourite at a position, when its entry is still on the sheet. */
  const favoriteEntries = $derived(
    FAVORITE_KEYS.map((_, index) => {
      const id = favorites[index];
      return id === null || id === undefined ? undefined : byId.get(id);
    }),
  );
  const hasFavorites = $derived(favoriteEntries.some((entry) => entry !== undefined));

  const groups = $derived(tab === "favorites" ? [] : groupEntries(entriesForTab(entries, tab)));
  /** Long groups wrap to a second row of slots, like the prototype's tabs with many entries. */
  const rows = $derived(Math.max(0, ...groups.map((group) => group.entries.length)) > 7 ? 2 : 1);
</script>

{#snippet slotOf(entry: ActionBarEntry, keyIndex: number | undefined)}
  <Slot
    {entry}
    keyLabel={keyIndex === undefined ? undefined : FAVORITE_KEYS[keyIndex]?.label}
    keyShortcut={keyIndex === undefined ? undefined : FAVORITE_KEYS[keyIndex]?.shortcut}
    busy={isBusy(entry.id)}
    {altHeld}
    {Details}
    menuOpen={menuEntryId === entry.id}
    {onrun}
    {oncontext}
    {onhover}
    {onleave}
  />
{/snippet}

{#if tab === "favorites"}
  {#if hasFavorites}
    <div class="fav" role="group" aria-label={t("FUSION.ActionBar.Tabs.Favorites")}>
      {#each favoriteEntries as entry, index (index)}
        {#if entry !== undefined}
          {@render slotOf(entry, index)}
        {:else}
          <div class="slot-empty" aria-hidden="true">
            <i class="slot-empty__k">{FAVORITE_KEYS[index]?.label}</i>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="empty">{t("FUSION.ActionBar.Empty.Favorites")}</p>
  {/if}
{:else if groups.length === 0}
  <p class="empty">{t("FUSION.ActionBar.Empty.Tab")}</p>
{:else}
  {#each groups as group, index (group.name ?? `#${String(index)}`)}
    <div class="grp" role="group" aria-label={group.name ?? t("FUSION.ActionBar.Slots.Label")}>
      {#if group.name !== undefined || group.uses !== undefined}
        <div class="grp__h">
          {#if group.name !== undefined}<span>{group.name}</span>{/if}
          {#if group.uses !== undefined}
            {#if group.uses.style === "pips"}
              <span class="pips" aria-hidden="true">
                {#each { length: group.uses.max } as _, pip (pip)}
                  <span class="pip" class:pip--on={pip < group.uses.value}></span>
                {/each}
              </span>
            {/if}
            <em>{group.uses.value}/{group.uses.max}</em>
          {/if}
        </div>
      {/if}
      <div class="grp__g" style:--rows={rows}>
        {#each group.entries as entry (entry.id)}
          {@render slotOf(entry, undefined)}
        {/each}
      </div>
    </div>
  {/each}
{/if}

<style>
  /* Favorites: twelve equal columns that fill the bar (prototype `.fav`). */
  .fav {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(12, minmax(52px, 1fr));
    gap: 4px;
    min-width: 0;
  }

  .slot-empty {
    position: relative;
    box-sizing: border-box;
    height: 64px;
    border: 1px dashed var(--fusion-border);
    border-radius: var(--fusion-radius);
    opacity: 0.55;
  }

  .slot-empty__k {
    position: absolute;
    left: 4px;
    bottom: 4px;
    color: var(--fusion-text-muted);
    font: 600 9px/1 var(--fusion-font-mono);
    font-style: normal;
  }

  /* A tab: groups side by side, each with its header over a grid of slots (prototype `.grp`). */
  .grp {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 4px;
  }

  .grp__h {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 2px;
    color: var(--fusion-text-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .grp__h em {
    color: var(--fusion-text);
    font-style: normal;
    font-weight: 600;
  }

  .pips {
    display: inline-flex;
    align-items: center;
    color: var(--fusion-accent-hover);
  }

  .pip {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 2px;
    border: 1px solid currentColor;
    border-radius: 50%;
  }

  .pip--on {
    background: currentColor;
  }

  .grp__g {
    display: grid;
    grid-auto-columns: 56px;
    grid-auto-flow: column;
    grid-template-rows: repeat(var(--rows, 1), 64px);
    gap: 4px;
  }

  .empty {
    align-self: center;
    margin: 0;
    padding: 14px 4px;
    color: var(--fusion-text-muted);
    font-size: 12px;
  }
</style>
