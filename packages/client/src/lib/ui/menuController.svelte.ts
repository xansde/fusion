/**
 * menuController.svelte.ts — what the context menu does, apart from how it is drawn
 * (BAR-F1-03; spec 53 REQ-BAR-043/045).
 *
 * `ContextMenu.svelte` is markup plus handlers that call this class. Everything that is a
 * *decision* lives here, over a few callbacks, so it is tested without a DOM
 * (docs/design/barra-de-acoes/tasks.md §2.10; `.svelte.ts` is compiled by the Svelte plugin in
 * Vitest, so the reactive `active` works in a test too):
 *
 *  - which item is highlighted, and where an arrow, Home or End takes it (`menu.ts`);
 *  - choosing an item: a disabled one does nothing; an enabled one gives the focus back to the
 *    trigger FIRST, then tells the owner, then closes — so what the owner does with the focus
 *    (open a sheet, say) wins over the menu's own tidying-up;
 *  - hovering highlights an enabled item and moves the focus with it, as in a native menu;
 *  - pressing a disabled item must not move the focus onto it, or the keyboard would carry on
 *    from the wrong place;
 *  - an open menu owns the keyboard.
 */

import { createDismissHandler, returnFocusTo, shouldRestoreFocus } from "./dismissableLayer.js";
import type { DismissReason } from "./dismissableLayer.js";
import { initialActiveIndex, menuKeyHandling, type IndexedItem, type MenuItem } from "./menu.js";

interface FocusTarget {
  focus(options?: FocusOptions): void;
  isConnected?: boolean | undefined;
}

export interface MenuControllerDeps {
  /** The items in keyboard order (`flattenMenu`). Asked for when needed, so a changed list counts. */
  items(): readonly MenuItem[];
  openedBy(): "keyboard" | "pointer";
  /**
   * Where the focus goes back to after a choice: the trigger (or several candidates, in order).
   * What had the focus before the menu opened is remembered by the controller (`opened`) and
   * comes last.
   */
  focusTargets(): ReadonlyArray<FocusTarget | null | undefined>;
  restoreFocus(): boolean;
  setOpen(open: boolean): void;
  onselect(): ((id: string, item: MenuItem) => void) | undefined;
  onclose(): ((reason: DismissReason) => void) | undefined;
}

export class MenuController {
  /** Index (in keyboard order) of the highlighted item; its button holds the focus. */
  active = $state<number | null>(null);

  /** The layer asks to close (Escape, a click outside, Tab): close and say why. */
  readonly dismiss: (reason: DismissReason) => void;

  readonly #deps: MenuControllerDeps;

  /** What had the focus before the menu opened: the fallback when the trigger cannot take it. */
  #previouslyFocused: FocusTarget | null = null;

  constructor(deps: MenuControllerDeps) {
    this.#deps = deps;
    this.dismiss = createDismissHandler({
      setOpen: (open) => {
        deps.setOpen(open);
      },
      onclose: () => deps.onclose(),
    });
  }

  /** Nothing highlighted by the pointer, the first enabled item by keyboard. */
  reset(): void {
    this.active = initialActiveIndex(this.#deps.items(), this.#deps.openedBy());
  }

  /**
   * Every time the menu opens: start from the top (`reset`) and remember what had the focus, so a
   * choice can hand it back there if the trigger was removed — or cannot take it — meanwhile.
   */
  opened(previouslyFocused: FocusTarget | null): void {
    this.#previouslyFocused = previouslyFocused;
    this.reset();
  }

  /** An item was chosen (a click, or Enter/Space on its button). */
  select(item: MenuItem): void {
    if (item.disabled === true) return;
    if (this.#deps.restoreFocus() && shouldRestoreFocus("select")) {
      returnFocusTo(...this.#deps.focusTargets(), this.#previouslyFocused);
    }
    this.#deps.onselect()?.(item.id, item);
    this.dismiss("select");
  }

  /**
   * A key pressed inside the menu. Arrows, Home and End move the highlight and the focus —
   * scrolling the menu if it has to, so an item below the fold of a short menu comes into
   * view — and the open menu keeps its keys from the rest of the app.
   */
  keydown(event: KeyboardEvent, layer: HTMLElement): void {
    const handling = menuKeyHandling(event, { items: this.#deps.items(), active: this.active });
    if (handling.stopPropagation) event.stopPropagation();
    if (handling.preventDefault) event.preventDefault();
    if (handling.move === null) return;
    this.active = handling.move;
    layer.querySelector<HTMLElement>(`[data-item-index="${String(handling.move)}"]`)?.focus();
  }

  /** Hovering highlights an enabled item and moves the focus with it. */
  pointerEnter(
    event: { currentTarget: { focus(options?: FocusOptions): void } | null },
    entry: IndexedItem,
  ): void {
    if (entry.item.disabled === true) return;
    this.active = entry.index;
    event.currentTarget?.focus({ preventScroll: true });
  }

  /** Pressing a disabled item must not take the focus. */
  pointerDown(event: { preventDefault(): void }, entry: IndexedItem): void {
    if (entry.item.disabled === true) event.preventDefault();
  }

  /** A right-click inside the menu must not open the browser's own menu on top of ours. */
  contextMenu(event: { preventDefault(): void }): void {
    event.preventDefault();
  }
}
