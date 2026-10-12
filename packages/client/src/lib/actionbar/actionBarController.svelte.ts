/**
 * actionBarController.svelte.ts — what the action bar DOES when the user touches it
 * (BAR-F1-04; spec 53 REQ-BAR-033/035/041/042/104, Q-BAR-11, D-15; tasks.md §2.8).
 *
 * `ActionBar.svelte` is markup. Every piece of behaviour lives here, in a module the Svelte plugin
 * compiles under Vitest, so it is tested without a DOM (§2.10): a click that runs an entry, a second
 * click while the first is still running, a refusal, a number key, the tab, folding the bar, the
 * short message on the strip, "Encerrar turno".
 *
 * The rules this file keeps:
 *
 *  - **A click runs the default variant** through `provider.execute(entry, choice, services, ctx)`,
 *    with the targets marked AT THAT INSTANT (`choice.targetTokenIds`; the provider never reads a
 *    target on its own) and the context of the active actor.
 *  - **A slot is busy until its own `execute` settles** — no double roll. Busy is per entry of the
 *    actor, not per bar: another slot runs meanwhile.
 *  - **Faded is a signal, not a lock** (D-15, REQ-BAR-104, Q-BAR-11). A click on an entry faded by
 *    turn or use state reaches `execute` all the same; whoever refuses, when it refuses, is the
 *    sheet's own function (no target, no quantity, no slot, no focus), and the refusal comes back as
 *    a message on the strip. Nothing here counts actions or blocks by cost.
 *  - **Errors never take the bar down**: they become `services.notify`.
 *
 * What is NOT here (D-BA16): remembering the tab or the fold on the device, drag and drop, aim mode,
 * the full slot menu (only "Abrir na ficha" for now), the NPC and group bars.
 */

import { SvelteSet } from "svelte/reactivity";

import { combatActions, combatStore } from "../combat/combatStore.svelte.js";
import { t } from "../i18n/i18n.js";
import { FAVORITE_SLOT_COUNT, type FavoritesSource } from "./favoritesSource.js";
import type {
  ActionBarChoice,
  ActionBarContext,
  ActionBarEntry,
  ActionBarProvider,
  ActionBarServices,
  ActionBarTab,
} from "./types.js";

// ---------------------------------------------------------------------------
// The contract (tasks.md §2.8)
// ---------------------------------------------------------------------------

export interface ActionBarController {
  /** Current tab; "favorites" is the main row, not a tab of entries. */
  readonly tab: ActionBarTab | "favorites";
  readonly collapsed: boolean;
  /** The entry under the mouse (or the keyboard focus): feeds the tooltip's strip preview. */
  readonly hovered: ActionBarEntry | null;
  /** Short message on the strip (`services.notify`); fades on its own. */
  readonly notice: string | null;
  /** Click and menu. */
  runEntry(entry: ActionBarEntry, choice?: Partial<ActionBarChoice>): Promise<void>;
  /** The keys 1–9, 0, − and = (`via: "key"`). */
  runFavorite(index: number): Promise<void>;
  /**
   * Whether `runFavorite(index)` has something to run: a bar is drawn and that favourite is on the
   * sheet. The shortcut asks first, so a number key that would do nothing is not consumed.
   */
  canRunFavorite(index: number): boolean;
  /** Esc: closes the menu (and, once aim mode exists, the aim). */
  cancel(): void;
  /** Whether Esc has something to close; the shortcut asks first, so an idle Esc goes on to the canvas. */
  readonly canCancel: boolean;
}

/** What the bar is drawing right now: the actor's context, its provider and its entries. */
export interface ResolvedBar {
  readonly ctx: ActionBarContext;
  readonly provider: ActionBarProvider;
  readonly entries: readonly ActionBarEntry[];
  /**
   * The ids of the conditions on the strip. With it, a revealed effect whose condition is gone
   * counts as closed; without it (a test double) nothing is checked.
   */
  readonly conditionIds?: readonly string[];
}

/** Timers, injectable so the fade of the notice is testable. */
export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface ControllerDeps {
  /** The bar being drawn, read at the moment of use; `null` when there is none. */
  current(): ResolvedBar | null;
  /** The services lent to the provider. */
  services(): ActionBarServices;
  /** Token ids marked as targets by the local user, right now (`getMyTargets()`). */
  targets(): readonly string[];
  /** The twelve favourites of the active actor; `null` when there is no source. */
  favorites(): FavoritesSource | null;
  /** A successful execution makes the actor the "last used" one (Q-BAR-01). */
  noteUsed(actorId: string): void;
  timers?: Timers;
}

/** The slot menu that is open: which entry, where, and whether the pointer or the keyboard opened it. */
export interface BarMenuState {
  readonly entryId: string;
  readonly x: number;
  readonly y: number;
  readonly via: "pointer" | "keyboard";
}

/** How long a message stays on the strip. */
export const NOTICE_MS = 4000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** The text of a failure, as the strip shows it. */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") return error.message.trim();
  return t("FUSION.ActionBar.Error.Generic");
}

export class ActionBarControllerImpl implements ActionBarController {
  readonly #deps: ControllerDeps;
  readonly #timers: Timers;

  #tab = $state<ActionBarTab | "favorites">("favorites");
  #collapsed = $state(false);
  // The id, not the entry: the provider recomputes its entries after a click (the MAP moves), and
  // what the strip previews must follow the NEW entry, not the one the pointer entered.
  #hoveredId = $state<string | null>(null);
  #notice = $state<string | null>(null);
  #menu = $state.raw<BarMenuState | null>(null);
  #openCondition = $state<string | null>(null);
  readonly #busy = new SvelteSet<string>();

  /** Whether the free area is under the fold threshold, as last told by the layout. */
  #narrow = false;
  /** The fold is the layout's doing (the user did not ask for it): widening the area undoes it. */
  #foldedByLayout = false;
  #noticeTimer: unknown = null;

  constructor(deps: ControllerDeps) {
    this.#deps = deps;
    this.#timers = deps.timers ?? realTimers;
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  get tab(): ActionBarTab | "favorites" {
    return this.#tab;
  }

  get collapsed(): boolean {
    return this.#collapsed;
  }

  get hovered(): ActionBarEntry | null {
    const id = this.#hoveredId;
    return id === null ? null : (this.#entryOf(id) ?? null);
  }

  get notice(): string | null {
    return this.#notice;
  }

  get menu(): BarMenuState | null {
    return this.#menu;
  }

  /** The condition whose effect is revealed (D-B23), or null. */
  get openCondition(): string | null {
    return this.#openCondition;
  }

  /** Whether Esc has something to close: an open menu or a revealed effect. */
  get canCancel(): boolean {
    return this.#menu !== null || this.#openCondition !== null;
  }

  // -------------------------------------------------------------------------
  // Running an entry
  // -------------------------------------------------------------------------

  /** Whether the entry of the active actor is still running its `execute`. Reactive. */
  isBusy(entryId: string): boolean {
    const bar = this.#deps.current();
    return bar !== null && this.#busy.has(this.#busyKey(bar.ctx.actorId, entryId));
  }

  async runEntry(entry: ActionBarEntry, choice: Partial<ActionBarChoice> = {}): Promise<void> {
    const bar = this.#deps.current();
    if (bar === null) return;

    // The id of an entry is unique only within its actor, so the busy key carries the actor too.
    const key = this.#busyKey(bar.ctx.actorId, entry.id);
    if (this.#busy.has(key)) return;
    this.#busy.add(key);

    const services = this.#deps.services();
    try {
      await bar.provider.execute(
        entry,
        {
          variants: choice.variants ?? {},
          targetTokenIds: choice.targetTokenIds ?? this.#deps.targets(),
          via: choice.via ?? "click",
        },
        services,
        bar.ctx,
      );
      this.#deps.noteUsed(bar.ctx.actorId);
    } catch (error) {
      services.notify(messageOf(error));
    } finally {
      this.#busy.delete(key);
    }
  }

  async runFavorite(index: number): Promise<void> {
    const entry = this.#favoriteEntry(index);
    if (entry === undefined) return;
    await this.runEntry(entry, { via: "key" });
  }

  canRunFavorite(index: number): boolean {
    return this.#favoriteEntry(index) !== undefined;
  }

  /** The entry of favourite slot `index`, if there is a bar and the entry is still on the sheet. */
  #favoriteEntry(index: number): ActionBarEntry | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= FAVORITE_SLOT_COUNT) return undefined;
    const bar = this.#deps.current();
    const favorites = this.#deps.favorites();
    if (bar === null || favorites === null) return undefined;

    const entryId = favorites.slots()[index];
    if (entryId === null || entryId === undefined) return undefined;
    // A favourite whose entry left the sheet (BAR-F3-01 draws it faded) runs nothing.
    return bar.entries.find((candidate) => candidate.id === entryId);
  }

  #busyKey(actorId: string, entryId: string): string {
    return `${actorId}\u0000${entryId}`;
  }

  // -------------------------------------------------------------------------
  // Tab and fold
  // -------------------------------------------------------------------------

  setTab(tab: ActionBarTab | "favorites"): void {
    this.#tab = tab;
    this.#closeTransient();
  }

  toggleCollapsed(): void {
    this.#collapsed = !this.#collapsed;
    this.#foldedByLayout = false;
    if (this.#collapsed) this.#closeTransient();
  }

  /**
   * The layout tells whether the free area is under the fold threshold (REQ-BAR-025). Crossing it
   * folds the bar by itself — and unfolds it again if it was the layout that folded it. It is a
   * crossing, not a lock: the user can expand a folded bar, and that stands until the area crosses
   * the threshold again.
   */
  syncNarrow(narrow: boolean): void {
    if (narrow === this.#narrow) return;
    this.#narrow = narrow;
    if (narrow) {
      if (!this.#collapsed) {
        this.#collapsed = true;
        this.#foldedByLayout = true;
        this.#closeTransient();
      }
    } else if (this.#foldedByLayout) {
      this.#collapsed = false;
      this.#foldedByLayout = false;
    }
  }

  // -------------------------------------------------------------------------
  // Hover (the entry under the mouse)
  // -------------------------------------------------------------------------

  setHovered(entry: ActionBarEntry): void {
    this.#hoveredId = entry.id;
  }

  /** Leaving a slot clears the hover only if it is still THAT slot: the pointer may already be on the next. */
  clearHovered(entry: ActionBarEntry): void {
    if (this.#hoveredId === entry.id) this.#hoveredId = null;
  }

  // -------------------------------------------------------------------------
  // The short message of the strip
  // -------------------------------------------------------------------------

  /** Shows a message on the strip; it fades on its own, and a new one restarts the count. */
  notify(message: string): void {
    if (this.#noticeTimer !== null) this.#timers.clear(this.#noticeTimer);
    this.#notice = message;
    this.#noticeTimer = this.#timers.set(() => {
      this.#notice = null;
      this.#noticeTimer = null;
    }, NOTICE_MS);
  }

  // -------------------------------------------------------------------------
  // Menu and the effect of a condition
  // -------------------------------------------------------------------------

  openMenu(entryId: string, at: { x: number; y: number }, via: "pointer" | "keyboard"): void {
    this.#menu = { entryId, x: at.x, y: at.y, via };
  }

  closeMenu(): void {
    this.#menu = null;
  }

  /** D-B23: the chip shows only the name; a click reveals the effect, a second click folds it. */
  toggleCondition(conditionId: string): void {
    this.#openCondition = this.#openCondition === conditionId ? null : conditionId;
  }

  cancel(): void {
    this.#menu = null;
    this.#openCondition = null;
  }

  /** The active actor changed: what was open belonged to the other one. The tab stays. */
  resetForActor(): void {
    this.#closeTransient();
  }

  /**
   * Closes what is open on something that has since left the bar: a menu whose entry went off the
   * sheet, an effect whose condition ended, a hover on a slot that is gone. It is closed FOR GOOD:
   * left open but unseen, the next Esc would be spent closing nothing, and the thing would reopen
   * by itself the day it came back. The shell calls it whenever the bar being drawn changes.
   */
  reconcile(): void {
    const bar = this.#deps.current();
    const entryIds = new Set(bar === null ? [] : bar.entries.map((entry) => entry.id));
    // A favourite whose entry left the sheet is an ORPHAN (BAR-F3-01): not in the list, but pinned,
    // and its menu — "Desafixar" — is the only way out of it. It stays until it is unpinned.
    const pinned = bar === null ? [] : (this.#deps.favorites()?.slots() ?? []);
    if (
      this.#menu !== null &&
      !entryIds.has(this.#menu.entryId) &&
      !pinned.includes(this.#menu.entryId)
    ) {
      this.#menu = null;
    }
    if (this.#hoveredId !== null && !entryIds.has(this.#hoveredId)) this.#hoveredId = null;

    const open = this.#openCondition;
    if (open !== null) {
      const ended =
        bar === null || (bar.conditionIds !== undefined && !bar.conditionIds.includes(open));
      if (ended) this.#openCondition = null;
    }
  }

  #closeTransient(): void {
    this.#menu = null;
    this.#openCondition = null;
    this.#hoveredId = null;
  }

  /** The entry of the bar being drawn, looked up on every read: the provider's list is replaced, not edited. */
  #entryOf(entryId: string): ActionBarEntry | undefined {
    return this.#deps.current()?.entries.find((candidate) => candidate.id === entryId);
  }

  // -------------------------------------------------------------------------
  // Encerrar turno
  // -------------------------------------------------------------------------

  /**
   * The same operation as the Combate tab (`combat:nextTurn`, REQ-CBA-072). Hiding the button is
   * convenience: the server decides who may advance the turn (REQ-CBA-080/081), and its refusal is
   * shown on the strip.
   */
  async endTurn(): Promise<void> {
    const combat = combatStore.combat;
    if (combat === null) return;
    const services = this.#deps.services();
    const socket = services.getSocket();
    if (socket === null) return;
    // `combatActions` ignores a call while another op is in flight; its `error` would then be stale.
    if (combatStore.busy) return;

    await combatActions.nextTurn(socket, combat._id);
    if (combatStore.error !== null) services.notify(combatStore.error);
  }
}

export function createActionBarController(deps: ControllerDeps): ActionBarControllerImpl {
  return new ActionBarControllerImpl(deps);
}
