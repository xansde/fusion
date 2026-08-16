/**
 * drawerState.svelte.ts — the side drawer's whole behaviour, as a module.
 *
 * Spec 36 (`specs/36-gaveta-lateral.md`) §5.2. The drawer has exactly one gesture
 * (DEC-GAV-03): clicking a tab opens the drawer on it or switches to it
 * (REQ-GAV-010), and clicking the tab that is already showing collapses the drawer
 * (REQ-GAV-011). There is no second control — no chevron, no ✕, and `Esc` belongs to
 * the canvas, not to us. That is why this class exposes `select()` and read-only
 * getters and nothing else: a `close()` here would become a close button there.
 *
 * It also owns the two consequences of that gesture:
 *  - the panel of the active tab is the only one mounted, and switching drops the
 *    previous one before the next resolves (REQ-GAV-017);
 *  - panel code is imported per tab, on demand, so drawing the rail costs no panel
 *    module at all (RNF-GAV-02) — the registry keeps loaders, never constructors.
 *
 * `open` and `activeTab` are persisted locally after every gesture (REQ-GAV-014) via
 * `./preferences`, which also decides where a fresh seat opens (REQ-GAV-015/016).
 *
 * Living outside the component is deliberate: the client's Vitest has no DOM, so
 * behaviour that hides inside a `.svelte` file is behaviour that cannot be tested.
 * The component (`components/sidebar/Sidebar.svelte`) only wires this to the rail.
 */

import { loadSidebarPanel } from "./registry.js";
import type { SidebarPanelComponent } from "./registry.js";
import { resolveInitialSidebarState, saveSidebarPreferences } from "./preferences.js";

/** What the drawer needs to know about the seat it is rendering for. */
export interface SidebarDrawerInit {
  /** World the user is in — part of the preferences key (REQ-GAV-014). */
  readonly worldId: string;
  /** Local user — the other part of the preferences key. */
  readonly userId: string;
  /** Whether the local role is privileged; decides the first-access tab (REQ-GAV-015). */
  readonly isGm: boolean;
  /**
   * Ids the rail is drawing for this user, in rail order. Passed as data (the caller
   * reads them from the registry) so this module stays independent of registration
   * order and testable without a rail.
   */
  readonly visibleTabIds: readonly string[];
}

export class SidebarDrawerState {
  readonly #worldId: string;
  readonly #userId: string;
  readonly #visibleTabIds: readonly string[];

  #open = $state(false);
  #activeTabId = $state("");
  // `null` while nothing is mounted. The type stays the loose component type of the
  // registry (a Svelte 5 constructor is not expressible here) — writing it as
  // `Component | null` is what the linter rejects, not the intent.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  #panel = $state<SidebarPanelComponent>(null);

  /** In-flight panel import, exposed through `settled()` for tests and callers. */
  #pending: Promise<void> = Promise.resolve();

  constructor(init: SidebarDrawerInit) {
    this.#worldId = init.worldId;
    this.#userId = init.userId;
    this.#visibleTabIds = [...init.visibleTabIds];

    const initial = resolveInitialSidebarState({
      worldId: init.worldId,
      userId: init.userId,
      isGm: init.isGm,
      visibleTabIds: this.#visibleTabIds,
    });
    this.#open = initial.open;
    this.#activeTabId = initial.activeTab;

    // Writing the resolved state back keeps the seat stable: a fallback that was
    // never persisted would be recomputed on every reload (REQ-GAV-014/016).
    this.#persist();

    if (this.#open) this.#loadActivePanel();
  }

  /** Whether the drawer is expanded. Read-only: only `select()` moves it. */
  get open(): boolean {
    return this.#open;
  }

  /** The tab being shown — remembered while collapsed, so the gesture is reversible. */
  get activeTabId(): string {
    return this.#activeTabId;
  }

  /** Panel component of the active tab; `null` while nothing is mounted. */
  get panel(): SidebarPanelComponent {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return this.#panel;
  }

  /** Ids of the tabs this seat can reach, in rail order. */
  get visibleTabIds(): readonly string[] {
    return this.#visibleTabIds;
  }

  /**
   * The single gesture of the drawer (DEC-GAV-03).
   *
   *  - collapsed → opens on `tabId` (REQ-GAV-010);
   *  - open on another tab → switches, without touching size or position (REQ-GAV-010);
   *  - open on `tabId` itself → collapses (REQ-GAV-011).
   *
   * A tab this seat cannot see is ignored: hiding a "gm" tab is ergonomics, and the
   * data behind it is protected on the server anyway (REQ-GAV-034).
   */
  select(tabId: string): void {
    if (!this.#visibleTabIds.includes(tabId)) return;

    if (this.#open && this.#activeTabId === tabId) {
      this.#open = false;
      this.#panel = null; // REQ-GAV-017: nothing stays mounted behind a closed drawer
      this.#persist();
      return;
    }

    if (this.#activeTabId !== tabId) {
      this.#activeTabId = tabId;
      this.#panel = null; // REQ-GAV-017: the previous panel goes before the next arrives
    }
    this.#open = true;
    this.#persist();
    this.#loadActivePanel();
  }

  /** Resolves once the in-flight panel import (if any) has been applied. */
  settled(): Promise<void> {
    return this.#pending;
  }

  #persist(): void {
    saveSidebarPreferences(this.#worldId, this.#userId, {
      open: this.#open,
      activeTab: this.#activeTabId,
    });
  }

  /**
   * Import the active tab's panel and mount it (RNF-GAV-02). Only this tab's loader
   * runs — every other tab stays a function in the registry.
   */
  #loadActivePanel(): void {
    const tabId = this.#activeTabId;

    this.#pending = loadSidebarPanel(tabId)
      .then((component: SidebarPanelComponent) => {
        // The single staleness guard (REQ-GAV-017): an import only mounts if, by the
        // time it lands, the drawer is still open on the very tab it was started for.
        // A switch or a collapse in the meantime drops it on the floor.
        //
        // This is checked against live state rather than a sequence token on purpose.
        // A token would be a second, redundant guard — the registry memoises panels
        // per tab id, so a superseded load for the *same* tab resolves to the exact
        // component the current load will produce. Two guards that shadow each other
        // are two guards no test can pin down individually.
        if (!this.#open || this.#activeTabId !== tabId) return;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        this.#panel = component;
      })
      .catch((error: unknown) => {
        // A panel that fails to load leaves the drawer empty rather than breaking the
        // table; the rail and every other tab keep working.
        console.error(`[fusion] sidebar panel "${tabId}" failed to load`, error);
      });
  }
}
