<script lang="ts">
  /**
   * ContextMenu.svelte — a generic context menu (BAR-F1-03; spec 53 REQ-BAR-043/045).
   *
   * A list of actions that opens at the pointer or beside a trigger. Unaware of who uses it —
   * the action bar will hang its slot menu on it, a sheet could hang its own:
   *
   *     <ContextMenu bind:open items={entries} label="Golpe de Espada"
   *                  point={{ x: event.clientX, y: event.clientY }} anchor={slot}
   *                  onselect={(id) => run(id)} />
   *
   * `items` is a list of loose items, titled groups and separators (`lib/ui/menu.ts`). An item
   * has a label, an optional trailing `detail` ("+12", "Alt"), an optional `hint` under the
   * label ("depois deste: MAP −10"), and may be `disabled` with a `reason`: it stays on screen,
   * dimmed, with the reason written under it — the arrows skip it and a click does nothing.
   *
   * What it does, and why:
   *  - **Roles.** `role="menu"` named by `label`; each item is a `<button role="menuitem">`
   *    (so Enter and Space click it once, natively); groups are `role="group"` named by their
   *    title; separators are `role="separator"`. A disabled item is `aria-disabled`, not a
   *    native `disabled` button, so a screen reader still finds it, and its reason is its
   *    `aria-describedby`.
   *  - **Keyboard.** Up/Down walk the enabled items and wrap, Home/End jump to the ends
   *    (`lib/ui/menu.ts`). Escape closes and gives the focus back to the trigger; Tab closes —
   *    a menu never traps focus — and the browser's Tab carries on from the trigger
   *    (`lib/ui/dismissableLayer.ts`). Opened by the keyboard (`openedBy="keyboard"`), the
   *    first enabled item is active at once; opened by the pointer, nothing is until the first
   *    arrow, like a native menu.
   *  - **It owns the keyboard while open.** The canvas listens on `window` and moves the
   *    selected token with the arrow keys; a key pressed in the menu must not reach it.
   *  - **Closes on a click outside** (`clickOutside.ts`). Unlike a popover, a click on the
   *    trigger counts as outside: it closes the menu, and a right-click on it opens a fresh one.
   *  - **Opens inward.** Beside the trigger, or at the pointer, and turns the other way when
   *    it would run off the right or bottom edge (`lib/ui/floating.ts`).
   *  - **Above every window**: portaled to `<body>` with the `--fusion-z-menu` token, above the
   *    tooltip token (REQ-UIF-008).
   *
   * Focus: after Escape, Tab or a chosen item it goes back to the trigger — or, if a re-render
   * removed the trigger meanwhile, to whatever had the focus before the menu opened — unless
   * `restoreFocus` is false (a caller that routes focus itself, as the action bar will after a
   * mouse click so its number keys keep working). The focus goes back *before* `onselect` runs,
   * so what `onselect` does with the focus wins.
   *
   * This file is markup and wiring. What the menu *does* — choosing, walking the items,
   * hovering, pressing a disabled item — is `MenuController` (`lib/ui/menuController.svelte.ts`),
   * and how its layer opens and closes is `menuLayerOptions` (`lib/ui/dismissableLayer.ts`):
   * both are tested without a DOM, which this component's script cannot be.
   */

  import { untrack } from "svelte";
  import type { Placement } from "../../lib/ui/floating.js";
  import { floatingLayer } from "../../lib/ui/floatingLayer.js";
  import {
    dismissableLayer,
    menuLayerOptions,
    nextLayerId,
    type DismissReason,
  } from "../../lib/ui/dismissableLayer.js";
  import {
    describeItem,
    flattenMenu,
    layoutMenu,
    type IndexedItem,
    type MenuEntry,
    type MenuItem,
  } from "../../lib/ui/menu.js";
  import { MenuController } from "../../lib/ui/menuController.svelte.js";

  interface Props {
    /** Open state. Bindable. */
    open?: boolean | undefined;
    items: readonly MenuEntry[];
    /** The menu's accessible name. */
    label: string;
    /** Also draw the label as a title row at the top (the prototype shows the entry's name). */
    showLabel?: boolean | undefined;
    /** Open at this viewport point (a right-click). Wins over the anchor for placement. */
    point?: { x: number; y: number } | null | undefined;
    /** The trigger: where to open when there is no point, and where the focus returns. */
    anchor?: HTMLElement | null | undefined;
    placement?: Placement | undefined;
    /** How it was opened. By keyboard, the first enabled item starts active. */
    openedBy?: "keyboard" | "pointer" | undefined;
    /** Give the focus back to the trigger when it closes. Default true. */
    restoreFocus?: boolean | undefined;
    /** An enabled item was chosen. The menu closes right after. */
    onselect?: ((id: string, item: MenuItem) => void) | undefined;
    /** The menu closed itself, with why. Not called when the owner closes it. */
    onclose?: ((reason: DismissReason) => void) | undefined;
  }

  let {
    open = $bindable(false),
    items,
    label,
    showLabel = false,
    point = null,
    anchor = null,
    placement = "bottom-start",
    openedBy = "pointer",
    restoreFocus = true,
    onselect,
    onclose,
  }: Props = $props();

  const menuId = nextLayerId("fusion-menu");

  const rows = $derived(layoutMenu(items));
  const flat = $derived(flattenMenu(items));

  const menu = new MenuController({
    items: () => flat,
    openedBy: () => openedBy,
    focusTargets: () => [anchor],
    restoreFocus: () => restoreFocus,
    setOpen: (value) => {
      open = value;
    },
    onselect: () => onselect,
    onclose: () => onclose,
  });

  // A menu rendered already open has its first highlight in the very first paint.
  untrack(() => {
    if (open) menu.reset();
  });

  // Every time it opens, start from the top — highlight per `openedBy` — and remember the focus
  // (the controller hands it back there if the trigger is gone or cannot take it).
  $effect.pre(() => {
    if (!open) return;
    untrack(() =>
      menu.opened(document.activeElement instanceof HTMLElement ? document.activeElement : null),
    );
  });
</script>

{#snippet itemButton(entry: IndexedItem)}
  {@const item = entry.item}
  {@const description = describeItem(item)}
  {@const descriptionId = `${menuId}-item-${String(entry.index)}-description`}
  <button
    type="button"
    class="fusion-menu__item"
    class:is-active={menu.active === entry.index}
    role="menuitem"
    tabindex={menu.active === entry.index ? 0 : -1}
    aria-disabled={item.disabled === true ? "true" : undefined}
    aria-describedby={description === undefined ? undefined : descriptionId}
    data-item-id={item.id}
    data-item-index={entry.index}
    onclick={() => menu.select(item)}
    onpointerenter={(event) => menu.pointerEnter(event, entry)}
    onmousedown={(event) => menu.pointerDown(event, entry)}
  >
    <span class="fusion-menu__label">{item.label}</span>
    {#if item.detail !== undefined}
      <span class="fusion-menu__detail">{item.detail}</span>
    {/if}
    {#if description !== undefined}
      <!-- A description, not part of the name: hidden from the name computation, and
           referenced by aria-describedby above. -->
      <span class="fusion-menu__hint" id={descriptionId} aria-hidden="true">{description}</span>
    {/if}
  </button>
{/snippet}

{#if open}
  <div
    class="fusion-menu"
    id={menuId}
    role="menu"
    aria-label={label}
    tabindex="-1"
    data-fusion-layer
    use:floatingLayer={{ anchor, point, placement, offset: point == null ? 4 : 0 }}
    use:dismissableLayer={menuLayerOptions({ anchor, restoreFocus, onDismiss: menu.dismiss })}
    onkeydown={(event) => menu.keydown(event, event.currentTarget)}
    oncontextmenu={(event) => menu.contextMenu(event)}
  >
    {#if showLabel}
      <!-- The name is already on the menu; the title is for the eye only. -->
      <div class="fusion-menu__title" aria-hidden="true">{label}</div>
    {/if}
    {#each rows as row, r (r)}
      {#if row.kind === "separator"}
        <div class="fusion-menu__sep" role="separator"></div>
      {:else if row.kind === "group"}
        <div
          class="fusion-menu__group"
          role="group"
          aria-labelledby={row.label === undefined ? undefined : `${menuId}-group-${String(r)}`}
        >
          {#if row.label !== undefined}
            <!-- The group carries the name for assistive technology; this is for the eye. -->
            <div class="fusion-menu__heading" id={`${menuId}-group-${String(r)}`} aria-hidden="true">{row.label}</div>
          {/if}
          {#each row.items as entry (entry.index)}
            {@render itemButton(entry)}
          {/each}
        </div>
      {:else}
        {@render itemButton(row)}
      {/if}
    {/each}
  </div>
{/if}

<style>
  /* The prototype's `.ctx` (docs/design/barra-de-acoes/prototipo-barra-fiel.html). Position
     and reveal are driven by `floatingLayer`; this says what the menu looks like. */
  .fusion-menu {
    position: fixed;
    left: 0;
    top: 0;
    /* Above the tooltip layer (spec 53 §2.7). */
    z-index: var(--fusion-z-menu);
    /* Shown by floatingLayer once it has measured and placed the box. */
    visibility: hidden;
    box-sizing: border-box;
    /* Shrink-wrapped, so the measurement taken before placing stays true after it. */
    width: max-content;
    min-width: 214px;
    max-width: min(360px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 12px;
    box-shadow: var(--fusion-shadow-modal);
  }

  /* The menu holds the focus itself only until the first arrow key; the ring belongs to the
     items, which carry the real position. */
  .fusion-menu:focus-visible {
    outline: none;
  }

  .fusion-menu__title {
    padding: 4px 8px 3px;
    font-size: 12px;
    font-weight: 700;
  }

  .fusion-menu__heading {
    padding: 4px 8px 5px;
    color: var(--fusion-text-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .fusion-menu__sep {
    height: 1px;
    margin: 4px 2px;
    background: var(--fusion-border);
  }

  .fusion-menu__item {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    column-gap: 14px;
    box-sizing: border-box;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    color: var(--fusion-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .fusion-menu__item.is-active {
    background: var(--fusion-accent-dim);
  }

  /* The active row's wash is lighter than the menu's surface, which leaves the muted text on
     it at 4.0:1 — under the 4.5:1 that small text needs (WCAG AA, REQ-A11-005's family). So on
     the active row the secondary text takes the main text colour. */
  .fusion-menu__item.is-active .fusion-menu__detail,
  .fusion-menu__item.is-active .fusion-menu__hint {
    color: var(--fusion-text);
  }

  .fusion-menu__item:focus-visible {
    outline: 2px solid var(--fusion-accent-hover);
    outline-offset: -2px;
  }

  .fusion-menu__label {
    min-width: 0;
  }

  .fusion-menu__detail {
    color: var(--fusion-text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  /* The line under the label: a hint, or the reason an item is disabled. Muted, not
     translucent — it has to stay readable (4.7:1 on the menu's surface; the active row, whose
     wash is lighter, switches to the main text colour above). */
  .fusion-menu__hint {
    grid-column: 1 / -1;
    margin-top: 1px;
    color: var(--fusion-text-muted);
    font-size: 10.5px;
  }

  /* Disabled: dimmed text, never a see-through item — the reason is the point. */
  .fusion-menu__item[aria-disabled="true"] {
    cursor: not-allowed;
    color: var(--fusion-text-muted);
  }
</style>
