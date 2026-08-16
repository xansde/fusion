/**
 * drawerState.test.ts — the drawer's one gesture and its single mounted panel (spec 36, G012).
 *
 * The click behaviour of the drawer lives in a module instead of inside the component
 * precisely so it can be tested here: the client's Vitest runs in a node environment
 * with no DOM, so anything interactive has to be reachable as plain logic.
 *
 * Covers REQ-GAV-010 (open / switch), REQ-GAV-011 (the active tab is the only collapse
 * control), REQ-GAV-014 (open + activeTab persisted locally and restored), REQ-GAV-017
 * (only the active panel stays mounted) and RNF-GAV-02 (the registry keeps loaders, and
 * only the active tab's loader is ever called).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { SidebarDrawerState } from "../drawerState.svelte.js";
import { clearSidebarTabs, listVisibleSidebarTabs, registerSidebarTab } from "../registry.js";
import { sidebarPreferencesKey } from "../preferences.js";

// ---------------------------------------------------------------------------
// localStorage mock (same pattern as lib/windows/__tests__/window-manager.test.ts)
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "world-1";
const USER_ID = "user-1";

const ICON = '<svg viewBox="0 0 24 24"><path d="M3 3h18v18H3z" /></svg>';

/** Every loader call is recorded — this is what proves RNF-GAV-02. */
let loadCalls: string[] = [];

/**
 * Resolvers of the loads still in flight, by tab id, in deferred mode.
 *
 * The default fixture hands back `Promise.resolve(...)`, which always settles in call
 * order — so it can never produce the race REQ-GAV-017 exists for. Deferred mode holds
 * each loader open until `resolvePanel(id)` is called, which is what lets a test resolve
 * the *second* tab before the first and see whether the late one still lands.
 */
let pendingLoads = new Map<string, (module: { default: string }) => void>();

const CORE_TABS = [
  { id: "chat", group: "all" as const },
  { id: "combat", group: "all" as const },
  { id: "compendium", group: "all" as const },
  { id: "npcs", group: "gm" as const },
  { id: "scenes", group: "gm" as const },
  { id: "settings", group: "all" as const },
];

function registerCoreTabs(options: { deferred?: boolean } = {}): void {
  for (const tab of CORE_TABS) {
    registerSidebarTab({
      id: tab.id,
      icon: ICON,
      label: `FUSION.Test.Tab.${tab.id}`,
      group: tab.group,
      component: () => {
        loadCalls.push(tab.id);
        if (options.deferred !== true) return Promise.resolve({ default: `panel:${tab.id}` });
        return new Promise<{ default: string }>((resolve) => {
          pendingLoads.set(tab.id, resolve);
        });
      },
    });
  }
}

/** Re-register the same tabs with loaders the test resolves by hand. */
function useDeferredPanels(): void {
  clearSidebarTabs();
  loadCalls = [];
  pendingLoads = new Map();
  registerCoreTabs({ deferred: true });
}

/** Let one in-flight deferred load land. The ORDER of these calls is the point. */
function resolvePanel(id: string): void {
  const resolve = pendingLoads.get(id);
  expect(resolve, `no deferred load is in flight for "${id}"`).toBeDefined();
  pendingLoads.delete(id);
  resolve!({ default: `panel:${id}` });
}

interface DrawerOptions {
  isGm?: boolean;
  userId?: string;
}

function makeDrawer(options: DrawerOptions = {}): SidebarDrawerState {
  const isGm = options.isGm ?? true;
  return new SidebarDrawerState({
    worldId: WORLD_ID,
    userId: options.userId ?? USER_ID,
    isGm,
    visibleTabIds: listVisibleSidebarTabs(isGm).map((tab) => tab.id),
  });
}

function storedPreferences(userId = USER_ID): { open?: boolean; activeTab?: string } {
  const raw = localStorage.getItem(sidebarPreferencesKey(WORLD_ID, userId));
  expect(raw, "nothing was persisted for this user").not.toBeNull();
  return JSON.parse(raw!) as { open?: boolean; activeTab?: string };
}

// ---------------------------------------------------------------------------

describe("SidebarDrawerState", () => {
  beforeEach(() => {
    localStorage.clear();
    clearSidebarTabs();
    loadCalls = [];
    pendingLoads = new Map();
    registerCoreTabs();
  });

  describe("one gesture: open, switch, collapse (REQ-GAV-010, REQ-GAV-011)", () => {
    it("REQ-GAV-010: clicking a tab with the drawer collapsed opens it on that tab", async () => {
      const drawer = makeDrawer();
      await drawer.settled();

      drawer.select(drawer.activeTabId); // collapse first (REQ-GAV-011)
      expect(drawer.open).toBe(false);

      drawer.select("combat");
      await drawer.settled();

      expect(drawer.open).toBe(true);
      expect(drawer.activeTabId).toBe("combat");
    });

    it("REQ-GAV-010: clicking another tab with the drawer open only switches the tab", async () => {
      const drawer = makeDrawer();
      await drawer.settled();
      expect(drawer.open).toBe(true);

      drawer.select("compendium");
      await drawer.settled();

      expect(drawer.open).toBe(true);
      expect(drawer.activeTabId).toBe("compendium");
    });

    it("REQ-GAV-011: clicking the active tab collapses the drawer, and clicking it again reopens the same tab", async () => {
      const drawer = makeDrawer();
      drawer.select("chat");
      await drawer.settled();

      drawer.select("chat");
      expect(drawer.open).toBe(false);
      // The tab is remembered while collapsed, so the gesture is reversible.
      expect(drawer.activeTabId).toBe("chat");

      drawer.select("chat");
      await drawer.settled();
      expect(drawer.open).toBe(true);
      expect(drawer.activeTabId).toBe("chat");
    });

    it("REQ-GAV-011: selecting a tab is the only way to change `open` — there is no second collapse control", () => {
      const drawer = makeDrawer();
      const surface = [
        ...Object.getOwnPropertyNames(SidebarDrawerState.prototype),
        ...Object.getOwnPropertyNames(drawer),
      ];

      for (const forbidden of ["close", "collapse", "toggle", "expand", "hide"]) {
        expect(surface).not.toContain(forbidden);
      }
      // `open` is read-only from the outside: the gesture is the only writer.
      expect(() => {
        (drawer as unknown as { open: boolean }).open = false;
      }).toThrow();
    });

    it("REQ-GAV-010: a tab the user cannot see is ignored, and never becomes active", async () => {
      const player = makeDrawer({ isGm: false });
      await player.settled();

      player.select("scenes"); // gm group — not on this rail
      player.select("nope"); // not registered at all
      await player.settled();

      expect(player.activeTabId).toBe("chat");
      expect(player.open).toBe(true);
    });
  });

  describe("only the active panel is mounted (REQ-GAV-017)", () => {
    it("REQ-GAV-017: switching tabs drops the previous panel before the next one resolves", async () => {
      const drawer = makeDrawer();
      drawer.select("chat");
      await drawer.settled();
      expect(drawer.panel).toBe("panel:chat");

      drawer.select("combat");
      expect(drawer.panel).toBeNull(); // the previous panel is gone immediately

      await drawer.settled();
      expect(drawer.panel).toBe("panel:combat");
    });

    it("REQ-GAV-017: collapsing the drawer unmounts the panel", async () => {
      const drawer = makeDrawer();
      drawer.select("chat");
      await drawer.settled();
      expect(drawer.panel).toBe("panel:chat");

      drawer.select("chat");
      expect(drawer.open).toBe(false);
      expect(drawer.panel).toBeNull();
    });

    it("REQ-GAV-017: a late-resolving panel never lands on a tab the user already left", async () => {
      useDeferredPanels();

      const drawer = makeDrawer(); // opens on "scenes"; that import stays in flight
      drawer.select("chat");
      const chatLoad = drawer.settled();
      drawer.select("combat");
      const combatLoad = drawer.settled();

      // The tab the user is actually on resolves first...
      resolvePanel("combat");
      await combatLoad;
      expect(drawer.panel).toBe("panel:combat");

      // ...and only then does the import of the tab they left come back. It is late,
      // so it must be dropped instead of overwriting what is on screen.
      resolvePanel("chat");
      await chatLoad;

      expect(drawer.activeTabId).toBe("combat");
      expect(drawer.panel).toBe("panel:combat");
    });

    it("REQ-GAV-017: a panel that resolves after the drawer collapsed is never mounted", async () => {
      useDeferredPanels();

      const drawer = makeDrawer();
      drawer.select("chat");
      const chatLoad = drawer.settled();

      drawer.select("chat"); // collapse (REQ-GAV-011) with the import still in flight
      expect(drawer.open).toBe(false);

      resolvePanel("chat");
      await chatLoad;

      expect(drawer.open).toBe(false);
      expect(drawer.panel).toBeNull(); // nothing mounts behind a closed drawer
    });
  });

  describe("panel code is loaded per active tab (RNF-GAV-02)", () => {
    it("RNF-GAV-02: the registry holds loaders, and listing the tabs calls none of them", () => {
      const tabs = listVisibleSidebarTabs(true);

      expect(tabs).toHaveLength(6);
      for (const tab of tabs) {
        expect(typeof tab.component).toBe("function");
      }
      expect(loadCalls).toEqual([]);
    });

    it("RNF-GAV-02: building the drawer loads the active tab's panel and nothing else", async () => {
      const drawer = makeDrawer();
      await drawer.settled();

      expect(drawer.activeTabId).toBe("scenes"); // REQ-GAV-015, privileged first access
      expect(loadCalls).toEqual(["scenes"]);
    });

    it("RNF-GAV-02: each visited tab loads once, and untouched tabs are never loaded", async () => {
      const drawer = makeDrawer();
      await drawer.settled();

      drawer.select("chat");
      await drawer.settled();
      drawer.select("combat");
      await drawer.settled();
      drawer.select("chat"); // back to a tab already loaded
      await drawer.settled();

      expect(loadCalls).toEqual(["scenes", "chat", "combat"]);
      expect(loadCalls).not.toContain("compendium");
      expect(loadCalls).not.toContain("npcs");
      expect(loadCalls).not.toContain("settings");
    });

    it("RNF-GAV-02: a collapsed drawer loads no panel at all", async () => {
      localStorage.setItem(
        sidebarPreferencesKey(WORLD_ID, USER_ID),
        JSON.stringify({ open: false, activeTab: "chat" }),
      );

      const drawer = makeDrawer();
      await drawer.settled();

      expect(drawer.open).toBe(false);
      expect(drawer.panel).toBeNull();
      expect(loadCalls).toEqual([]);
    });
  });

  describe("the gesture is persisted locally (REQ-GAV-014)", () => {
    it("REQ-GAV-014: opening, switching and collapsing all write open + activeTab", async () => {
      const drawer = makeDrawer();
      await drawer.settled();

      drawer.select("combat");
      expect(storedPreferences()).toEqual({ open: true, activeTab: "combat" });

      drawer.select("combat");
      expect(storedPreferences()).toEqual({ open: false, activeTab: "combat" });

      drawer.select("chat");
      expect(storedPreferences()).toEqual({ open: true, activeTab: "chat" });
    });

    it("REQ-GAV-014: a fresh drawer (reload) comes back where the user left it", async () => {
      const first = makeDrawer();
      await first.settled();
      first.select("compendium");
      first.select("compendium"); // collapsed on compendium
      await first.settled();

      const reloaded = makeDrawer();
      await reloaded.settled();

      expect(reloaded.open).toBe(false);
      expect(reloaded.activeTabId).toBe("compendium");
    });

    it("REQ-GAV-014: another user on the same browser gets their own drawer", async () => {
      const gm = makeDrawer();
      await gm.settled();
      gm.select("scenes");
      await gm.settled();

      const player = makeDrawer({ isGm: false, userId: "user-2" });
      await player.settled();

      // The GM's "scenes" never reaches the player's seat (REQ-GAV-016 fallback).
      expect(player.activeTabId).toBe("chat");
      expect(storedPreferences("user-2")).toEqual({ open: true, activeTab: "chat" });
    });
  });
});
