<script lang="ts">
  /**
   * SlotGrid.svelte — the slots of the action bar: the twelve favourites, or the groups of a tab
   * (BAR-F1-04; spec 53 REQ-BAR-026, REQ-BAR-029, D-BA07; prototype T1–T5).
   *
   * **Favorites** is the main row: twelve positions, the keys 1–9, 0, − and = as the seal of each
   * (the key only labels the slot; the shortcuts are BAR-F1-05's). An empty position is drawn as an
   * empty box with its key, so the twelve bindings stay readable. A favourite whose entry left the
   * sheet — an item sold, a spell swapped — is drawn FADED as "não está mais na ficha", in its own
   * position, with "Desafixar" in its menu (BAR-F3-01, REQ-BAR-066); `favoriteCells` decides which
   * positions are which, and when a missing entry is an orphan rather than just late.
   *
   * **A tab** lists its entries in groups ("Truques", "1º grau", "Atletismo"…) with the counter
   * of the group in the header (the slots of a rank "2/3", the pips of focus). A tab with nothing in
   * it does NOT disappear or break: it says it is empty (REQ-BAR-026).
   *
   * Only draws; the slot decides how an entry looks (`Slot.svelte`) and the controller what a click
   * does. The orphan is the ordinary slot fed a stand-in entry; its click is NOT a run — it goes to
   * `onorphan`, because there is nothing on the sheet to run. Drag and drop is not here (D-BA16).
   */

  import type { Component } from "svelte";

  import { t } from "../../lib/i18n/i18n.js";
  import { FAVORITE_KEYS } from "../../lib/actionbar/favoriteKeys.js";
  import { favoriteCells } from "../../lib/actionbar/orphan.js";
  import { entriesForTab, groupEntries } from "../../lib/actionbar/slotModel.js";
  import type { ActionBarEntry, ActionBarTab } from "../../lib/actionbar/types.js";
  import Slot from "./Slot.svelte";

  interface Props {
    tab: ActionBarTab | "favorites";
    entries: readonly ActionBarEntry[];
    /** The twelve favourite ids in key order, `null` for an empty position. */
    favorites: ReadonlyArray<string | null>;
    /** The load window has passed: a pinned entry that is missing is an orphan, not just late. */
    showOrphans?: boolean | undefined;
    isBusy: (entryId: string) => boolean;
    altHeld: boolean;
    Details?: Component<{ entry: ActionBarEntry }> | undefined;
    /** Entry whose slot menu is open, if any. */
    menuEntryId: string | null;
    onrun: (entry: ActionBarEntry) => void;
    /** A click on an orphan: it runs nothing, there is nothing on the sheet to run. */
    onorphan?: ((entry: ActionBarEntry) => void) | undefined;
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
    showOrphans = true,
    isBusy,
    altHeld,
    Details,
    menuEntryId,
    onrun,
    onorphan = () => undefined,
    oncontext,
    onhover,
    onleave,
  }: Props = $props();

  /** What each of the twelve positions draws: its entry, an orphan, or an empty box. */
  const cells = $derived(favoriteCells(favorites, entries, showOrphans));
  /** Something is pinned — even if nothing has resolved yet, the row is not "empty". */
  const hasFavorites = $derived(favorites.some((id) => id !== null));

  const groups = $derived(tab === "favorites" ? [] : groupEntries(entriesForTab(entries, tab)));
  /**
   * The Testes tab draws each check as a ROW (icon, whole name, bonus) in columns of up to five, so the
   * eighteen skills fit the bar in four columns without a cut name (ui-mesa-hud, 22/10/2026). The other tabs keep
   * tiles; a long group wraps to a second row, like the prototype's tabs with many entries.
   */
  const layout = $derived<"tile" | "row">(tab === "checks" ? "row" : "tile");
  const longest = $derived(Math.max(0, ...groups.map((group) => group.entries.length)));
  const rows = $derived(
    layout === "row" ? Math.min(5, Math.max(1, Math.ceil(longest / 4))) : longest > 7 ? 2 : 1,
  );
</script>

{#snippet slotOf(entry: ActionBarEntry, keyIndex: number | undefined, run: (entry: ActionBarEntry) => void)}
  <Slot
    {entry}
    keyLabel={keyIndex === undefined ? undefined : FAVORITE_KEYS[keyIndex]?.label}
    keyShortcut={keyIndex === undefined ? undefined : FAVORITE_KEYS[keyIndex]?.shortcut}
    busy={isBusy(entry.id)}
    {altHeld}
    {Details}
    menuOpen={menuEntryId === entry.id}
    {layout}
    onrun={run}
    {oncontext}
    {onhover}
    {onleave}
  />
{/snippet}

{#if tab === "favorites"}
  {#if hasFavorites}
    <div class="fav" role="group" aria-label={t("FUSION.ActionBar.Tabs.Favorites")}>
      {#each cells as cell, index (index)}
        {#if cell.kind !== "empty"}
          {@render slotOf(cell.entry, index, cell.kind === "orphan" ? onorphan : onrun)}
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
      <div class="grp__g" class:grp__g--rows={layout === "row"} style:--rows={rows}>
        {#each group.entries as entry (entry.id)}
          {@render slotOf(entry, undefined, onrun)}
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
    grid-template-columns: repeat(12, minmax(64px, 1fr));
    gap: var(--fusion-space-1);
    min-width: 0;
  }

  /* An empty position: a faint outline and its key, so the twelve bindings stay readable without
     competing with the slots that hold something. */
  .slot-empty {
    position: relative;
    box-sizing: border-box;
    height: 80px;
    border: 1px dashed var(--fusion-border);
    border-radius: var(--fusion-radius);
  }

  .slot-empty__k {
    position: absolute;
    left: 5px;
    bottom: 4px;
    color: var(--fusion-text-subtle);
    font: var(--fusion-text-xs) / 1.2 var(--fusion-font-mono);
    font-style: normal;
  }

  /* A tab: groups side by side, each with its header over a grid of slots (prototype `.grp`). */
  .grp {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--fusion-space-1);
  }

  .grp__h {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 2px;
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
    font-weight: var(--fusion-weight-bold);
    white-space: nowrap;
  }

  .grp__h em {
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
    font-style: normal;
  }

  .pips {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--fusion-accent);
  }

  .pip {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1.5px solid currentColor;
    border-radius: 50%;
  }

  .pip--on {
    background: currentColor;
  }

  /* Tiles: each column as wide as its longest name (never under 64 px), so no name is cut. */
  .grp__g {
    display: grid;
    grid-auto-columns: minmax(64px, max-content);
    grid-auto-flow: column;
    grid-template-rows: repeat(var(--rows, 1), 80px);
    gap: var(--fusion-space-1);
  }

  /* Rows (Testes): columns of checks, read top to bottom. */
  .grp__g--rows {
    grid-auto-columns: minmax(150px, max-content);
    grid-template-rows: repeat(var(--rows, 1), 44px);
  }

  .empty {
    align-self: center;
    margin: 0;
    padding: var(--fusion-space-3) var(--fusion-space-1);
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
  }
</style>
